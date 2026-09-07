/**
 * End-to-end tests for the share-and-earn app-invite endpoints (task #271).
 *
 * Covers the surfaces described in the task spec:
 *   - POST /app-invites — create + reuse-on-same-phone idempotency, validation
 *   - GET /app-invites — masked-phone formatter via the serializer
 *   - GET /app-invites/by-token/:token — happy path, unknown 404, lazy expiry
 *   - POST /app-invites/accept — happy path awards exactly 10 points once
 *     (idempotent on `app_invite:<id>` source ref), inserts notification +
 *     fires push, refuses self-accept, refuses replay by another account,
 *     refuses expired/cancelled invites, and respects the recipient's
 *     `app_invite_signup` notification preference.
 *
 * Also exercises the intake-completion accept path the mobile client takes
 * after readPendingAppInviteToken(): the request body is exactly
 * `{ token }` and a successful accept returns the canonical signup URL,
 * which is what the mobile client uses to clear the stored token.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) {
      res.status(401).json({ error: "missing x-test-user" });
      return;
    }
    req.userId = String(uid);
    next();
  },
}));

const sendPushToUserMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/push", () => ({
  sendPushToUser: (...args: unknown[]) => sendPushToUserMock(...args),
  sendPushToUsers: vi.fn().mockResolvedValue(undefined),
}));

const {
  db,
  appInvitesTable,
  notificationsTable,
  outwardAccountsTable,
  pointsLedgerTable,
  userModesTable,
  userNotificationPrefsTable,
  usersTable,
} = await import("@workspace/db");
const appInvitesRouter = (await import("../app-invites")).default;
const { resolveActiveOutwardAccountId } = await import("../../lib/outwardAccounts");

/**
 * Resolve (lazy-seeding if necessary) the default outward account id for
 * a clerk user. Tests that bypass the POST route and insert app_invites
 * directly need a sender outward account id since `from_clerk_id` was
 * dropped.
 */
async function outwardAccountFor(clerkId: string): Promise<number> {
  const id = await resolveActiveOutwardAccountId(clerkId);
  if (id == null) throw new Error(`no outward account seeded for ${clerkId}`);
  return id;
}

async function outwardAccountIdsFor(clerkIds: string[]): Promise<number[]> {
  if (clerkIds.length === 0) return [];
  const rows = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds));
  return rows.map((r) => r.id);
}

/**
 * Delete every app_invite row whose sender outward account is owned by
 * one of the given clerks. Used by test cleanup blocks now that
 * `from_clerk_id` is no longer a column on app_invites.
 */
async function deleteInvitesFor(clerkIds: string[]): Promise<void> {
  const ids = await outwardAccountIdsFor(clerkIds);
  if (ids.length === 0) return;
  await db
    .delete(appInvitesTable)
    .where(inArray(appInvitesTable.senderOutwardAccountId, ids));
}

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", appInvitesRouter);
  return app;
}

const tag = `t271-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const inviterClerkId = `${tag}-inviter`;
const inviteeClerkId = `${tag}-invitee`;
const intruderClerkId = `${tag}-intruder`;

let app: Express;

beforeAll(async () => {
  app = makeApp();
  await db.insert(usersTable).values([
    {
      clerkId: inviterClerkId,
      email: `${tag}-inviter@example.test`,
      name: "Ivy Inviter",
      username: `inviter_${tag}`,
      companyName: "Inviter Co",
    },
    {
      clerkId: inviteeClerkId,
      email: `${tag}-invitee@example.test`,
      name: "Ned Newuser",
      username: `invitee_${tag}`,
    },
    {
      clerkId: intruderClerkId,
      email: `${tag}-intruder@example.test`,
      name: "Imogen Intruder",
      username: `intruder_${tag}`,
    },
  ]);

  // Give the inviter an active "home" mode so loadSenderContext returns a
  // sensible kind for SMS body composition.
  const [mode] = await db
    .insert(userModesTable)
    .values({
      userClerkId: inviterClerkId,
      kind: "home",
      intakeCompletedAt: new Date(),
    })
    .returning();
  await db
    .update(usersTable)
    .set({ lastActiveModeId: mode.id })
    .where(eq(usersTable.clerkId, inviterClerkId));
});

afterAll(async () => {
  const allClerkIds = [inviterClerkId, inviteeClerkId, intruderClerkId];
  await db
    .delete(notificationsTable)
    .where(inArray(notificationsTable.userClerkId, allClerkIds));
  await db
    .delete(pointsLedgerTable)
    .where(inArray(pointsLedgerTable.userClerkId, allClerkIds));
  const accountIds = await outwardAccountIdsFor(allClerkIds);
  if (accountIds.length > 0) {
    await db
      .delete(appInvitesTable)
      .where(inArray(appInvitesTable.senderOutwardAccountId, accountIds));
  }
  await db
    .delete(userNotificationPrefsTable)
    .where(inArray(userNotificationPrefsTable.userClerkId, allClerkIds));
  await db
    .update(usersTable)
    .set({ lastActiveModeId: null, activeOutwardAccountId: null })
    .where(inArray(usersTable.clerkId, allClerkIds));
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, allClerkIds));
  await db
    .delete(userModesTable)
    .where(inArray(userModesTable.userClerkId, allClerkIds));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, allClerkIds));
});

beforeEach(() => {
  sendPushToUserMock.mockClear();
});

let phoneCounter = 0;
function nextPhoneDigits(): string {
  phoneCounter += 1;
  // Always 10 digits, unique per test, never colliding with another invite.
  return `555${String(1000000 + phoneCounter).padStart(7, "0")}`;
}

async function createInviteRequest(opts?: {
  phoneDigits?: string;
  recipientName?: string;
  invitedKind?: string;
  asUser?: string;
}) {
  return request(app)
    .post("/api/app-invites")
    .set("x-test-user", opts?.asUser ?? inviterClerkId)
    .send({
      recipientName: opts?.recipientName ?? "Polly Recipient",
      recipientPhone: opts?.phoneDigits ?? nextPhoneDigits(),
      invitedKind: opts?.invitedKind ?? "home",
    });
}

describe("POST /app-invites", () => {
  it("returns 400 when the recipient name is missing", async () => {
    const res = await request(app)
      .post("/api/app-invites")
      .set("x-test-user", inviterClerkId)
      .send({ recipientName: "", recipientPhone: "5551234567", invitedKind: "home" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the phone number is too short", async () => {
    const res = await request(app)
      .post("/api/app-invites")
      .set("x-test-user", inviterClerkId)
      .send({ recipientName: "Ok", recipientPhone: "12", invitedKind: "home" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the invited kind is not a valid mode", async () => {
    const res = await request(app)
      .post("/api/app-invites")
      .set("x-test-user", inviterClerkId)
      .send({
        recipientName: "Ok",
        recipientPhone: "5551234567",
        invitedKind: "wizard",
      });
    expect(res.status).toBe(400);
  });

  it("creates an invite, returns the signup url and an SMS draft URI", async () => {
    const phone = nextPhoneDigits();
    const res = await createInviteRequest({
      phoneDigits: phone,
      recipientName: "Sam Sample",
    });
    expect(res.status).toBe(200);
    expect(res.body.invite.recipientPhone).toBe(phone);
    expect(res.body.invite.invitedKind).toBe("home");
    expect(res.body.invite.status).toBe("sent");
    expect(res.body.signupUrl).toContain("/invite/app/");
    // The SMS draft is what the mobile modal hands off to Linking.openURL.
    expect(res.body.smsUri.startsWith(`sms:${phone}?body=`)).toBe(true);
    expect(decodeURIComponent(res.body.smsUri)).toContain(res.body.signupUrl);
    // The masked-phone formatter only ever exposes the last 4 digits.
    expect(res.body.invite.recipientPhoneMasked).toBe(`••• ${phone.slice(-4)}`);
    expect(res.body.invite.recipientPhoneMasked).not.toContain(phone.slice(0, 6));
  });

  it("reuses the existing sent invite when the same phone is invited again", async () => {
    const phone = nextPhoneDigits();
    const first = await createInviteRequest({
      phoneDigits: phone,
      recipientName: "First Name",
    });
    expect(first.status).toBe(200);
    const firstId = first.body.invite.id;
    const firstToken = first.body.invite.token ?? first.body.signupUrl.split("/").pop();

    const second = await createInviteRequest({
      phoneDigits: phone,
      recipientName: "Updated Name",
      invitedKind: "trade_pro",
    });
    expect(second.status).toBe(200);
    expect(second.body.invite.id).toBe(firstId);
    // Updated metadata is reflected, but the token (and signup URL) is preserved.
    expect(second.body.invite.recipientName).toBe("Updated Name");
    expect(second.body.invite.invitedKind).toBe("trade_pro");
    expect(second.body.signupUrl).toBe(first.body.signupUrl);

    // And only one row exists for that phone.
    const inviterAccountIds = await outwardAccountIdsFor([inviterClerkId]);
    const rows = await db
      .select({ id: appInvitesTable.id })
      .from(appInvitesTable)
      .where(
        and(
          inArray(appInvitesTable.senderOutwardAccountId, inviterAccountIds),
          eq(appInvitesTable.recipientPhone, phone),
        ),
      );
    expect(rows.length).toBe(1);
    expect(firstToken).toBeTruthy();
  });

  it("masks phones with fewer than 5 digits by showing the whole digit string", async () => {
    // 7-digit minimum is enforced by the route, but the masker handles edge
    // cases too. Hit it via a low-id row inserted directly.
    const phone = "1234"; // 4 digits exactly
    const [direct] = await db
      .insert(appInvitesTable)
      .values({
        senderOutwardAccountId: await outwardAccountFor(inviterClerkId),
        recipientName: "Edge",
        recipientPhone: phone,
        invitedKind: "home",
        token: `${tag}-mask-edge`,
        status: "sent",
        sentAt: new Date(),
      })
      .returning();
    const list = await request(app)
      .get("/api/app-invites")
      .set("x-test-user", inviterClerkId);
    expect(list.status).toBe(200);
    const found = list.body.invites.find(
      (i: { id: number }) => i.id === direct.id,
    );
    expect(found.recipientPhoneMasked).toBe("••• 1234");
  });
});

describe("Daily invite cap (APP_INVITE_DAILY_LIMIT)", () => {
  // Use a per-block inviter so the cap math is local and not polluted by
  // invites the other suites in this file have already created.
  const capInviter = `${tag}-cap-inviter`;

  beforeAll(async () => {
    await db.insert(usersTable).values({
      clerkId: capInviter,
      email: `${capInviter}@example.test`,
      name: "Cappy Capson",
      username: `cap_${tag}`,
    });
    const [mode] = await db
      .insert(userModesTable)
      .values({
        userClerkId: capInviter,
        kind: "home",
        intakeCompletedAt: new Date(),
      })
      .returning();
    await db
      .update(usersTable)
      .set({ lastActiveModeId: mode.id })
      .where(eq(usersTable.clerkId, capInviter));
  });

  afterAll(async () => {
    await deleteInvitesFor([capInviter]);
    await db
      .update(usersTable)
      .set({ lastActiveModeId: null, activeOutwardAccountId: null })
      .where(eq(usersTable.clerkId, capInviter));
    await db
      .delete(outwardAccountsTable)
      .where(eq(outwardAccountsTable.ownerClerkId, capInviter));
    await db
      .delete(userModesTable)
      .where(eq(userModesTable.userClerkId, capInviter));
    await db.delete(usersTable).where(eq(usersTable.clerkId, capInviter));
  });

  beforeEach(async () => {
    // Tighten the cap to 2 so we can drive it from green to 429 quickly.
    vi.stubEnv("APP_INVITE_DAILY_LIMIT", "2");
    // Clean slate per test so cap counts are predictable.
    await deleteInvitesFor([capInviter]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows a new invite while under the cap", async () => {
    const res = await createInviteRequest({ asUser: capInviter });
    expect(res.status).toBe(200);
    expect(res.body.invite.status).toBe("sent");
  });

  it("returns 429 with a clear message and dailyRemaining=0 when at the cap", async () => {
    const a = await createInviteRequest({ asUser: capInviter });
    expect(a.status).toBe(200);
    const b = await createInviteRequest({ asUser: capInviter });
    expect(b.status).toBe(200);

    const blocked = await createInviteRequest({ asUser: capInviter });
    expect(blocked.status).toBe(429);
    expect(blocked.body.dailyLimit).toBe(2);
    expect(blocked.body.dailyUsed).toBe(2);
    expect(blocked.body.dailyRemaining).toBe(0);
    // The error string is what the modal surfaces under the form.
    expect(typeof blocked.body.error).toBe("string");
    expect(blocked.body.error).toMatch(/2 invites/);
    expect(blocked.body.error).toMatch(/24 hours/i);

    // And no invite row was inserted past the cap.
    const capAccountIds = await outwardAccountIdsFor([capInviter]);
    const rows = await db
      .select({ id: appInvitesTable.id })
      .from(appInvitesTable)
      .where(inArray(appInvitesTable.senderOutwardAccountId, capAccountIds));
    expect(rows.length).toBe(2);
  });

  it("reusing an existing open invite for the same recipient does NOT consume from the cap", async () => {
    const phoneA = nextPhoneDigits();
    const phoneB = nextPhoneDigits();

    const first = await createInviteRequest({
      asUser: capInviter,
      phoneDigits: phoneA,
      recipientName: "Alpha",
    });
    expect(first.status).toBe(200);

    // Re-invite the SAME phone many times — each should reuse the existing
    // invite row and never trip the cap, even though limit is 2.
    for (let i = 0; i < 5; i += 1) {
      const reuse = await createInviteRequest({
        asUser: capInviter,
        phoneDigits: phoneA,
        recipientName: `Alpha v${i}`,
      });
      expect(reuse.status).toBe(200);
      expect(reuse.body.invite.id).toBe(first.body.invite.id);
    }

    // We should still have one cap slot left for a brand-new recipient.
    const second = await createInviteRequest({
      asUser: capInviter,
      phoneDigits: phoneB,
      recipientName: "Bravo",
    });
    expect(second.status).toBe(200);

    // A third distinct recipient is the one that finally trips the cap.
    const third = await createInviteRequest({
      asUser: capInviter,
      phoneDigits: nextPhoneDigits(),
      recipientName: "Charlie",
    });
    expect(third.status).toBe(429);
  });
});

describe("GET /app-invites/share-context (daily cap counters)", () => {
  const ctxInviter = `${tag}-ctx-inviter`;

  beforeAll(async () => {
    await db.insert(usersTable).values({
      clerkId: ctxInviter,
      email: `${ctxInviter}@example.test`,
      name: "Cora Counter",
      username: `ctx_${tag}`,
    });
    const [mode] = await db
      .insert(userModesTable)
      .values({
        userClerkId: ctxInviter,
        kind: "home",
        intakeCompletedAt: new Date(),
      })
      .returning();
    await db
      .update(usersTable)
      .set({ lastActiveModeId: mode.id })
      .where(eq(usersTable.clerkId, ctxInviter));
  });

  afterAll(async () => {
    await deleteInvitesFor([ctxInviter]);
    await db
      .update(usersTable)
      .set({ lastActiveModeId: null, activeOutwardAccountId: null })
      .where(eq(usersTable.clerkId, ctxInviter));
    await db
      .delete(outwardAccountsTable)
      .where(eq(outwardAccountsTable.ownerClerkId, ctxInviter));
    await db
      .delete(userModesTable)
      .where(eq(userModesTable.userClerkId, ctxInviter));
    await db.delete(usersTable).where(eq(usersTable.clerkId, ctxInviter));
  });

  beforeEach(async () => {
    vi.stubEnv("APP_INVITE_DAILY_LIMIT", "3");
    await deleteInvitesFor([ctxInviter]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports dailyLimit/dailyUsed/dailyRemaining accurately as invites are sent", async () => {
    const fresh = await request(app)
      .get("/api/app-invites/share-context")
      .set("x-test-user", ctxInviter);
    expect(fresh.status).toBe(200);
    expect(fresh.body.dailyLimit).toBe(3);
    expect(fresh.body.dailyUsed).toBe(0);
    expect(fresh.body.dailyRemaining).toBe(3);

    const sent = await createInviteRequest({ asUser: ctxInviter });
    expect(sent.status).toBe(200);

    const after = await request(app)
      .get("/api/app-invites/share-context")
      .set("x-test-user", ctxInviter);
    expect(after.status).toBe(200);
    expect(after.body.dailyLimit).toBe(3);
    expect(after.body.dailyUsed).toBe(1);
    expect(after.body.dailyRemaining).toBe(2);

    // Reusing the same recipient does not advance dailyUsed.
    const reuse = await createInviteRequest({
      asUser: ctxInviter,
      phoneDigits: sent.body.invite.recipientPhone,
    });
    expect(reuse.status).toBe(200);

    const stillOne = await request(app)
      .get("/api/app-invites/share-context")
      .set("x-test-user", ctxInviter);
    expect(stillOne.body.dailyUsed).toBe(1);
    expect(stillOne.body.dailyRemaining).toBe(2);
  });

  it("clamps dailyRemaining to 0 (never negative) once the cap is reached", async () => {
    for (let i = 0; i < 3; i += 1) {
      const r = await createInviteRequest({ asUser: ctxInviter });
      expect(r.status).toBe(200);
    }
    // Insert one more directly to simulate stale rows just over the limit.
    await db.insert(appInvitesTable).values({
      senderOutwardAccountId: await outwardAccountFor(ctxInviter),
      recipientName: "Overflow",
      recipientPhone: nextPhoneDigits(),
      invitedKind: "home",
      token: `${tag}-ctx-overflow-${Math.random().toString(36).slice(2, 8)}`,
      status: "sent",
      sentAt: new Date(),
    });

    const ctx = await request(app)
      .get("/api/app-invites/share-context")
      .set("x-test-user", ctxInviter);
    expect(ctx.status).toBe(200);
    expect(ctx.body.dailyLimit).toBe(3);
    expect(ctx.body.dailyUsed).toBe(4);
    expect(ctx.body.dailyRemaining).toBe(0);
  });

  it("bounces back when an open invite is cancelled or expires (task #277)", async () => {
    // Hit the cap with three live `sent` invites.
    const sent = await Promise.all(
      Array.from({ length: 3 }, () => createInviteRequest({ asUser: ctxInviter })),
    );
    for (const r of sent) expect(r.status).toBe(200);

    const reached = await request(app)
      .get("/api/app-invites/share-context")
      .set("x-test-user", ctxInviter);
    expect(reached.body.dailyUsed).toBe(3);
    expect(reached.body.dailyRemaining).toBe(0);

    // Cancel one — its slot should free up immediately on the next read.
    await db
      .update(appInvitesTable)
      .set({ status: "cancelled" })
      .where(eq(appInvitesTable.id, sent[0].body.invite.id));

    const afterCancel = await request(app)
      .get("/api/app-invites/share-context")
      .set("x-test-user", ctxInviter);
    expect(afterCancel.body.dailyUsed).toBe(2);
    expect(afterCancel.body.dailyRemaining).toBe(1);

    // Mark another invite past-due and verify the share-context endpoint's
    // lazy expiry sweep flips it and the slot returns.
    await db
      .update(appInvitesTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(appInvitesTable.id, sent[1].body.invite.id));

    const afterExpire = await request(app)
      .get("/api/app-invites/share-context")
      .set("x-test-user", ctxInviter);
    expect(afterExpire.body.dailyUsed).toBe(1);
    expect(afterExpire.body.dailyRemaining).toBe(2);

    const [reloaded] = await db
      .select()
      .from(appInvitesTable)
      .where(eq(appInvitesTable.id, sent[1].body.invite.id));
    expect(reloaded.status).toBe("expired");
  });
});

describe("GET /app-invites/by-token/:token", () => {
  it("returns 404 for an unknown token", async () => {
    const res = await request(app).get(`/api/app-invites/by-token/${tag}-no-such`);
    expect(res.status).toBe(404);
  });

  it("returns the invite with inviter info for a valid token", async () => {
    const created = await createInviteRequest();
    const token = created.body.signupUrl.split("/").pop();
    const res = await request(app).get(`/api/app-invites/by-token/${token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("sent");
    expect(res.body.inviter?.clerkId).toBe(inviterClerkId);
    expect(res.body.inviter?.name).toBe("Ivy Inviter");
  });

  it("lazily flips a past-due sent invite to expired on read", async () => {
    const [row] = await db
      .insert(appInvitesTable)
      .values({
        senderOutwardAccountId: await outwardAccountFor(inviterClerkId),
        recipientName: "Expired Pending",
        recipientPhone: nextPhoneDigits(),
        invitedKind: "home",
        token: `${tag}-tok-expired-read`,
        status: "sent",
        sentAt: new Date(Date.now() - 60_000),
        expiresAt: new Date(Date.now() - 1000),
      })
      .returning();
    const res = await request(app).get(`/api/app-invites/by-token/${row.token}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("expired");
    const [reloaded] = await db
      .select()
      .from(appInvitesTable)
      .where(eq(appInvitesTable.id, row.id));
    expect(reloaded.status).toBe("expired");
  });
});

describe("POST /app-invites/accept", () => {
  async function freshInvite(opts?: {
    expiresAt?: Date;
    status?: "sent" | "cancelled" | "expired";
  }) {
    const [row] = await db
      .insert(appInvitesTable)
      .values({
        senderOutwardAccountId: await outwardAccountFor(inviterClerkId),
        recipientName: "Accept Target",
        recipientPhone: nextPhoneDigits(),
        invitedKind: "home",
        token: `${tag}-accept-${Math.random().toString(36).slice(2, 10)}`,
        status: opts?.status ?? "sent",
        sentAt: new Date(),
        expiresAt:
          opts?.expiresAt ?? new Date(Date.now() + 1000 * 60 * 60 * 24),
      })
      .returning();
    return row;
  }

  it("returns 400 when the token is missing", async () => {
    const res = await request(app)
      .post("/api/app-invites/accept")
      .set("x-test-user", inviteeClerkId)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app)
      .post("/api/app-invites/accept")
      .send({ token: "anything" });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown token", async () => {
    const res = await request(app)
      .post("/api/app-invites/accept")
      .set("x-test-user", inviteeClerkId)
      .send({ token: `${tag}-no-such-token` });
    expect(res.status).toBe(404);
  });

  it("refuses to let the inviter accept their own invite", async () => {
    const invite = await freshInvite();
    const res = await request(app)
      .post("/api/app-invites/accept")
      .set("x-test-user", inviterClerkId)
      .send({ token: invite.token });
    expect(res.status).toBe(400);
  });

  it("refuses to accept an expired invite and flips its status", async () => {
    const invite = await freshInvite({
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await request(app)
      .post("/api/app-invites/accept")
      .set("x-test-user", inviteeClerkId)
      .send({ token: invite.token });
    expect(res.status).toBe(409);
    const [reloaded] = await db
      .select()
      .from(appInvitesTable)
      .where(eq(appInvitesTable.id, invite.id));
    expect(reloaded.status).toBe("expired");
  });

  it("refuses to accept a cancelled invite", async () => {
    const invite = await freshInvite({ status: "cancelled" });
    const res = await request(app)
      .post("/api/app-invites/accept")
      .set("x-test-user", inviteeClerkId)
      .send({ token: invite.token });
    expect(res.status).toBe(409);
  });

  it("awards exactly 10 points once and inserts a notification + push", async () => {
    const invite = await freshInvite();
    const res = await request(app)
      .post("/api/app-invites/accept")
      .set("x-test-user", inviteeClerkId)
      .send({ token: invite.token });
    expect(res.status).toBe(200);
    expect(res.body.invite.status).toBe("signed_up");
    expect(res.body.invite.acceptedByClerkId).toBe(inviteeClerkId);
    expect(res.body.signupUrl).toContain(invite.token);

    // Exactly one ledger row, exactly 10 points, idempotent on app_invite:<id>.
    const ledger = await db
      .select()
      .from(pointsLedgerTable)
      .where(
        and(
          eq(pointsLedgerTable.userClerkId, inviterClerkId),
          eq(pointsLedgerTable.eventType, "app_invite_signup"),
          eq(pointsLedgerTable.sourceRef, `app_invite:${invite.id}`),
        ),
      );
    expect(ledger.length).toBe(1);
    expect(ledger[0].points).toBe(10);

    // Notification fanned out to the inviter with the awarded points in the body.
    const notes = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userClerkId, inviterClerkId),
          eq(notificationsTable.relatedId, String(invite.id)),
        ),
      );
    expect(notes.length).toBe(1);
    expect(notes[0].type).toBe("app_invite_signup");
    expect(notes[0].body).toContain("10 points");
    expect(notes[0].title).toContain("joined Round House");

    // Push hit (mocked) once with the matching invite id.
    expect(sendPushToUserMock).toHaveBeenCalledTimes(1);
    expect(sendPushToUserMock.mock.calls[0][0]).toBe(inviterClerkId);
    expect(sendPushToUserMock.mock.calls[0][1].data.appInviteId).toBe(invite.id);
  });

  it("is idempotent — re-accepting by the same user does not double-award or double-notify", async () => {
    const invite = await freshInvite();

    const first = await request(app)
      .post("/api/app-invites/accept")
      .set("x-test-user", inviteeClerkId)
      .send({ token: invite.token });
    expect(first.status).toBe(200);

    sendPushToUserMock.mockClear();

    const second = await request(app)
      .post("/api/app-invites/accept")
      .set("x-test-user", inviteeClerkId)
      .send({ token: invite.token });
    expect(second.status).toBe(200);
    expect(second.body.invite.status).toBe("signed_up");

    // No second push, no second notification, no second ledger row.
    expect(sendPushToUserMock).not.toHaveBeenCalled();

    const ledger = await db
      .select()
      .from(pointsLedgerTable)
      .where(
        and(
          eq(pointsLedgerTable.userClerkId, inviterClerkId),
          eq(pointsLedgerTable.eventType, "app_invite_signup"),
          eq(pointsLedgerTable.sourceRef, `app_invite:${invite.id}`),
        ),
      );
    expect(ledger.length).toBe(1);

    const notes = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userClerkId, inviterClerkId),
          eq(notificationsTable.relatedId, String(invite.id)),
        ),
      );
    expect(notes.length).toBe(1);
  });

  it("rejects a replay attempt by a different account once already accepted", async () => {
    const invite = await freshInvite();
    const ok = await request(app)
      .post("/api/app-invites/accept")
      .set("x-test-user", inviteeClerkId)
      .send({ token: invite.token });
    expect(ok.status).toBe(200);

    const intruder = await request(app)
      .post("/api/app-invites/accept")
      .set("x-test-user", intruderClerkId)
      .send({ token: invite.token });
    expect(intruder.status).toBe(409);

    const [saved] = await db
      .select()
      .from(appInvitesTable)
      .where(eq(appInvitesTable.id, invite.id));
    expect(saved.acceptedByClerkId).toBe(inviteeClerkId);
  });

  it("respects the inviter's app_invite_signup notification preference (no notification, no push)", async () => {
    await db
      .insert(userNotificationPrefsTable)
      .values({
        userClerkId: inviterClerkId,
        notificationType: "app_invite_signup",
        enabled: false,
      })
      .onConflictDoUpdate({
        target: [
          userNotificationPrefsTable.userClerkId,
          userNotificationPrefsTable.notificationType,
        ],
        set: { enabled: false },
      });

    const invite = await freshInvite();
    const res = await request(app)
      .post("/api/app-invites/accept")
      .set("x-test-user", inviteeClerkId)
      .send({ token: invite.token });
    expect(res.status).toBe(200);

    // Points are still awarded — the opt-out only suppresses the notification.
    const ledger = await db
      .select()
      .from(pointsLedgerTable)
      .where(
        and(
          eq(pointsLedgerTable.userClerkId, inviterClerkId),
          eq(pointsLedgerTable.sourceRef, `app_invite:${invite.id}`),
        ),
      );
    expect(ledger.length).toBe(1);

    const notes = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.userClerkId, inviterClerkId),
          eq(notificationsTable.relatedId, String(invite.id)),
        ),
      );
    expect(notes.length).toBe(0);
    expect(sendPushToUserMock).not.toHaveBeenCalled();

    // Re-enable for any subsequent tests in this file.
    await db
      .delete(userNotificationPrefsTable)
      .where(
        and(
          eq(userNotificationPrefsTable.userClerkId, inviterClerkId),
          eq(userNotificationPrefsTable.notificationType, "app_invite_signup"),
        ),
      );
  });

  /**
   * Mirrors the mobile intake-completion flow:
   *   const inviteToken = await readPendingAppInviteToken();
   *   if (inviteToken) await acceptAppInvite({ token: inviteToken });
   *   await clearPendingAppInviteToken();
   * The client posts exactly `{ token }`. This test pins the contract that
   * call site relies on — a successful 200 with the canonical signup URL,
   * which is the signal the client uses to clear the stored token.
   */
  it("supports the intake-completion accept call shape used by the mobile client", async () => {
    const invite = await freshInvite();
    const res = await request(app)
      .post("/api/app-invites/accept")
      .set("x-test-user", inviteeClerkId)
      .send({ token: invite.token });
    expect(res.status).toBe(200);
    expect(res.body.invite.id).toBe(invite.id);
    expect(res.body.signupUrl.endsWith(`/invite/app/${invite.token}`)).toBe(true);
  });
});

describe("POST /app-invites/:id/cancel", () => {
  async function freshSentInvite(opts?: {
    fromClerkId?: string;
    expiresAt?: Date;
    status?: "sent" | "cancelled" | "expired" | "signed_up";
  }) {
    const senderClerk = opts?.fromClerkId ?? inviterClerkId;
    const [row] = await db
      .insert(appInvitesTable)
      .values({
        senderOutwardAccountId: await outwardAccountFor(senderClerk),
        recipientName: "Cancel Target",
        recipientPhone: nextPhoneDigits(),
        invitedKind: "home",
        token: `${tag}-cancel-${Math.random().toString(36).slice(2, 10)}`,
        status: opts?.status ?? "sent",
        sentAt: new Date(),
        expiresAt:
          opts?.expiresAt ?? new Date(Date.now() + 1000 * 60 * 60 * 24),
      })
      .returning();
    return row;
  }

  it("returns 401 when not authenticated", async () => {
    const res = await request(app).post("/api/app-invites/1/cancel");
    expect(res.status).toBe(401);
  });

  it("returns 400 when the id is not a positive integer", async () => {
    const res = await request(app)
      .post("/api/app-invites/not-a-number/cancel")
      .set("x-test-user", inviterClerkId);
    expect(res.status).toBe(400);
  });

  it("returns 404 when the invite belongs to another user", async () => {
    const invite = await freshSentInvite();
    const res = await request(app)
      .post(`/api/app-invites/${invite.id}/cancel`)
      .set("x-test-user", intruderClerkId);
    expect(res.status).toBe(404);
  });

  it("flips a sent invite to cancelled and frees up the daily-cap slot", async () => {
    const capInviter2 = `${tag}-cap-cancel`;
    await db.insert(usersTable).values({
      clerkId: capInviter2,
      email: `${capInviter2}@example.test`,
      name: "Carla Cancel",
      username: `cap_cancel_${tag}`,
    });
    try {
      vi.stubEnv("APP_INVITE_DAILY_LIMIT", "2");
      const a = await freshSentInvite({ fromClerkId: capInviter2 });
      const b = await freshSentInvite({ fromClerkId: capInviter2 });

      const before = await request(app)
        .get("/api/app-invites/share-context")
        .set("x-test-user", capInviter2);
      expect(before.body.dailyUsed).toBe(2);
      expect(before.body.dailyRemaining).toBe(0);

      const res = await request(app)
        .post(`/api/app-invites/${a.id}/cancel`)
        .set("x-test-user", capInviter2);
      expect(res.status).toBe(200);
      expect(res.body.invite.id).toBe(a.id);
      expect(res.body.invite.status).toBe("cancelled");
      // Phone is still masked in the response — never echo full digits.
      expect(res.body.invite.recipientPhoneMasked.startsWith("••• ")).toBe(true);

      const [reloaded] = await db
        .select()
        .from(appInvitesTable)
        .where(eq(appInvitesTable.id, a.id));
      expect(reloaded.status).toBe("cancelled");

      const after = await request(app)
        .get("/api/app-invites/share-context")
        .set("x-test-user", capInviter2);
      expect(after.body.dailyUsed).toBe(1);
      expect(after.body.dailyRemaining).toBe(1);

      // Sibling invite untouched.
      const [siblingReloaded] = await db
        .select()
        .from(appInvitesTable)
        .where(eq(appInvitesTable.id, b.id));
      expect(siblingReloaded.status).toBe("sent");
    } finally {
      vi.unstubAllEnvs();
      await deleteInvitesFor([capInviter2]);
      await db
        .update(usersTable)
        .set({ activeOutwardAccountId: null })
        .where(eq(usersTable.clerkId, capInviter2));
      await db
        .delete(outwardAccountsTable)
        .where(eq(outwardAccountsTable.ownerClerkId, capInviter2));
      await db.delete(usersTable).where(eq(usersTable.clerkId, capInviter2));
    }
  });

  it("returns 409 when the invite has already been signed up", async () => {
    const invite = await freshSentInvite({ status: "signed_up" });
    const res = await request(app)
      .post(`/api/app-invites/${invite.id}/cancel`)
      .set("x-test-user", inviterClerkId);
    expect(res.status).toBe(409);
    const [reloaded] = await db
      .select()
      .from(appInvitesTable)
      .where(eq(appInvitesTable.id, invite.id));
    expect(reloaded.status).toBe("signed_up");
  });

  it("returns 409 when the invite has already been cancelled", async () => {
    const invite = await freshSentInvite({ status: "cancelled" });
    const res = await request(app)
      .post(`/api/app-invites/${invite.id}/cancel`)
      .set("x-test-user", inviterClerkId);
    expect(res.status).toBe(409);
  });

  it("returns 409 and lazily flips a past-due sent invite to expired", async () => {
    const invite = await freshSentInvite({
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await request(app)
      .post(`/api/app-invites/${invite.id}/cancel`)
      .set("x-test-user", inviterClerkId);
    expect(res.status).toBe(409);
    const [reloaded] = await db
      .select()
      .from(appInvitesTable)
      .where(eq(appInvitesTable.id, invite.id));
    expect(reloaded.status).toBe("expired");
  });
});

describe("GET /app-invites (analytics list)", () => {
  it("summarizes sent / signed up / conversion / points and includes masked phones", async () => {
    // Use a brand-new inviter for this test so the summary math is local
    // and not polluted by other tests in this file.
    const localInviter = `${tag}-summary`;
    await db.insert(usersTable).values({
      clerkId: localInviter,
      email: `${localInviter}@example.test`,
      name: "Sandy Summary",
      username: `summary_${tag}`,
    });
    try {
      // One signed-up invite + one still-sent invite -> 50% conversion, 10 pts.
      const phoneA = nextPhoneDigits();
      const phoneB = nextPhoneDigits();
      const localSenderId = await outwardAccountFor(localInviter);
      const [signedRow] = await db
        .insert(appInvitesTable)
        .values([
          {
            senderOutwardAccountId: localSenderId,
            recipientName: "Joined Person",
            recipientPhone: phoneA,
            invitedKind: "home",
            token: `${tag}-sum-a`,
            status: "signed_up",
            sentAt: new Date(),
            signedUpAt: new Date(),
            acceptedByClerkId: inviteeClerkId,
            acceptedKind: "home",
          },
          {
            senderOutwardAccountId: localSenderId,
            recipientName: "Pending Person",
            recipientPhone: phoneB,
            invitedKind: "home",
            token: `${tag}-sum-b`,
            status: "sent",
            sentAt: new Date(),
            expiresAt: new Date(Date.now() + 60_000),
          },
        ])
        .returning();
      await db.insert(pointsLedgerTable).values({
        userClerkId: localInviter,
        eventType: "app_invite_signup",
        points: 10,
        sourceRef: `app_invite:${signedRow.id}`,
      });

      const res = await request(app)
        .get("/api/app-invites")
        .set("x-test-user", localInviter);
      expect(res.status).toBe(200);
      expect(res.body.summary).toEqual({
        sent: 2,
        signedUp: 1,
        conversionPct: 50,
        pointsEarned: 10,
      });
      const masked = res.body.invites.map(
        (i: { recipientPhoneMasked: string }) => i.recipientPhoneMasked,
      );
      expect(masked).toContain(`••• ${phoneA.slice(-4)}`);
      expect(masked).toContain(`••• ${phoneB.slice(-4)}`);
      // The full phone is never echoed in the masked field.
      expect(masked.every((m: string) => !m.includes(phoneA.slice(0, 6)))).toBe(true);
    } finally {
      await db
        .delete(pointsLedgerTable)
        .where(eq(pointsLedgerTable.userClerkId, localInviter));
      await deleteInvitesFor([localInviter]);
      await db
        .update(usersTable)
        .set({ activeOutwardAccountId: null })
        .where(eq(usersTable.clerkId, localInviter));
      await db
        .delete(outwardAccountsTable)
        .where(eq(outwardAccountsTable.ownerClerkId, localInviter));
      await db.delete(usersTable).where(eq(usersTable.clerkId, localInviter));
    }
  });
});
