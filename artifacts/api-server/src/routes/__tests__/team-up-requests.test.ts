/**
 * Task #501: end-to-end coverage for the unified team-up request
 * foundation.
 *
 * Exercises the request → accept → message → remove flow end-to-end:
 *   - POST /users/:id/connect creates a pending request, stores a
 *     system invite message + optional personal note, and the
 *     duplicate-pending guardrail returns 409.
 *   - POST /users/:id/team-up/respond accepts (creates reciprocal)
 *     and declines (no reciprocal).
 *   - POST /messages/:other is gated until accepted (403
 *     `team_up_required`) and works after.
 *   - DELETE /users/:id/connect flips both directions to "removed";
 *     a fresh /connect call reactivates as a brand-new pending request.
 *   - GET /users/me/team-up-requests surfaces incoming + outgoing.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { and, eq, inArray, or } from "drizzle-orm";

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

const {
  db,
  outwardAccountsTable,
  userConnectionsTable,
  usersTable,
  messagesTable,
  notificationsTable,
} = await import("@workspace/db");
type UserModeKind = import("@workspace/db").UserModeKind;
const usersRouter = (await import("../users")).default;
const messagesRouter = (await import("../messages")).default;
const { resolveActiveOutwardAccountId } = await import("../../lib/outwardAccounts");
const { composeTeamUpInviteMessage } = await import("../../lib/teamUpRequests");

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  app.use("/api", messagesRouter);
  return app;
}

const tag = `t501-${Date.now()}`;
const homeClerk = `${tag}-home`;
const proClerk = `${tag}-pro`;
const allClerkIds = [homeClerk, proClerk];

let app: Express;
let homeAcct: number;
let proAcct: number;

beforeAll(async () => {
  app = makeApp();
  await db.insert(usersTable).values([
    {
      clerkId: homeClerk,
      email: `${tag}-home@example.test`,
      name: "Hannah Home",
      username: `home_${tag}`,
    },
    {
      clerkId: proClerk,
      email: `${tag}-pro@example.test`,
      name: "Pat Pro",
      username: `pro_${tag}`,
    },
  ]);
  const h = await resolveActiveOutwardAccountId(homeClerk);
  const p = await resolveActiveOutwardAccountId(proClerk);
  if (h == null || p == null) throw new Error("failed to seed outward accounts");
  homeAcct = h;
  proAcct = p;
  // Set realistic kinds so the system message composer picks the
  // homeowner/pro pair branch.
  await db
    .update(outwardAccountsTable)
    .set({ kind: "home" satisfies UserModeKind })
    .where(eq(outwardAccountsTable.id, homeAcct));
  await db
    .update(outwardAccountsTable)
    .set({ kind: "trade_pro" satisfies UserModeKind, companyName: "ACME Plumbing" })
    .where(eq(outwardAccountsTable.id, proAcct));
});

afterAll(async () => {
  const ownedAccountIds = (
    await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(inArray(outwardAccountsTable.ownerClerkId, allClerkIds))
  ).map((r) => r.id);
  if (ownedAccountIds.length > 0) {
    await db
      .delete(userConnectionsTable)
      .where(
        or(
          inArray(userConnectionsTable.fromOutwardAccountId, ownedAccountIds),
          inArray(userConnectionsTable.toOutwardAccountId, ownedAccountIds),
        ),
      );
  }
  await db
    .delete(messagesTable)
    .where(inArray(messagesTable.senderClerkId, allClerkIds));
  await db
    .update(usersTable)
    .set({ activeOutwardAccountId: null })
    .where(inArray(usersTable.clerkId, allClerkIds));
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, allClerkIds));
  await db
    .delete(usersTable)
    .where(inArray(usersTable.clerkId, allClerkIds));
});

async function clearConnections() {
  await db
    .delete(userConnectionsTable)
    .where(
      or(
        inArray(userConnectionsTable.fromOutwardAccountId, [homeAcct, proAcct]),
        inArray(userConnectionsTable.toOutwardAccountId, [homeAcct, proAcct]),
      ),
    );
  // #599 — accept now writes a `team_up_note` opener message into the
  // thread; tests that re-run the accept flow need a clean message
  // table so per-test assertions don't pick up the previous opener.
  await db
    .delete(messagesTable)
    .where(inArray(messagesTable.senderClerkId, allClerkIds));
  // #656 — POST /connect now also drops a system team-up-request
  // notification on the recipient. Wipe between tests so per-test
  // assertions on the notifications table see a clean slate.
  await db
    .delete(notificationsTable)
    .where(inArray(notificationsTable.userClerkId, allClerkIds));
}

describe("composeTeamUpInviteMessage (#501)", () => {
  it("uses the homeowner→pro spec wording", () => {
    expect(
      composeTeamUpInviteMessage({
        senderKind: "home",
        recipientKind: "trade_pro",
        connectionKind: "client",
        senderName: "Hannah Home",
        senderCompany: null,
      }),
    ).toBe("Hi, this is Hannah Home. Let's team up to work on my home.");
  });

  it("uses the pro→homeowner spec wording (with company)", () => {
    expect(
      composeTeamUpInviteMessage({
        senderKind: "trade_pro",
        recipientKind: "home",
        connectionKind: "client",
        senderName: "Pat Pro",
        senderCompany: "ACME Plumbing",
      }),
    ).toBe(
      "Hi, this is Pat Pro. Let's team up to work on and improve your home.",
    );
  });

  it("pro→outside-service-provider spec wording (kind=client)", () => {
    expect(
      composeTeamUpInviteMessage({
        senderKind: "trade_pro",
        recipientKind: "trade_pro",
        connectionKind: "client",
        senderName: "Pat Pro",
        senderCompany: "ACME Plumbing",
      }),
    ).toBe(
      "Hi, this is Pat Pro. Let's team up — I could use your services on my jobs.",
    );
  });

  it("outside-service-provider→pro spec wording (kind=core)", () => {
    expect(
      composeTeamUpInviteMessage({
        senderKind: "trade_pro",
        recipientKind: "trade_pro",
        connectionKind: "core",
        senderName: "Sam Subcontractor",
        senderCompany: "Sub Co.",
      }),
    ).toBe(
      "Hi, this is Sam Subcontractor. Let's team up — I provide services for projects like yours.",
    );
  });

  it("facility→pro spec wording uses [Company] phrasing", () => {
    expect(
      composeTeamUpInviteMessage({
        senderKind: "facilities",
        recipientKind: "trade_pro",
        connectionKind: "client",
        senderName: "Fiona Facility",
        senderCompany: "Towers LLC",
      }),
    ).toBe(
      "Hi, this is Towers LLC. Let's team up to maintain our properties.",
    );
  });

  it("pro→facility spec wording uses [Company] phrasing", () => {
    expect(
      composeTeamUpInviteMessage({
        senderKind: "trade_pro",
        recipientKind: "facilities",
        connectionKind: "client",
        senderName: "Pat Pro",
        senderCompany: "ACME Plumbing",
      }),
    ).toBe(
      "Hi, this is ACME Plumbing. Let's team up to maintain our properties.",
    );
  });

  it("collaborator spec wording is the literal sentence (no name)", () => {
    expect(
      composeTeamUpInviteMessage({
        senderKind: "trade_pro",
        recipientKind: "trade_pro",
        connectionKind: "collaborator",
        senderName: "Pat Pro",
        senderCompany: "ACME Plumbing",
      }),
    ).toBe("Hi, let's team up and follow the work.");
  });
});

describe("POST /users/:userId/connect (#501 team-up request)", () => {
  it("creates a pending request with system message + personal note", async () => {
    await clearConnections();
    const res = await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client", personalNote: "Hi! Saw your reviews." });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");

    const [row] = await db
      .select()
      .from(userConnectionsTable)
      .where(
        eq(userConnectionsTable.fromOutwardAccountId, homeAcct),
      );
    expect(row).toBeDefined();
    expect(row.toOutwardAccountId).toBe(proAcct);
    expect(row.status).toBe("pending");
    expect(row.inviteMessage).toBe(
      "Hi, this is Hannah Home. Let's team up to work on my home.",
    );
    expect(row.personalNote).toBe("Hi! Saw your reviews.");
    expect(row.requestedAt).not.toBeNull();
  });

  it("returns 409 when a pending request to the same skin already exists", async () => {
    const res = await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("team_up_pending");
  });

  it("returns 409 when an inbound pending request from the other skin already exists (bidirectional guard)", async () => {
    await clearConnections();
    // Pro sends to Home first.
    const first = await request(app)
      .post(`/api/users/${homeClerk}/connect`)
      .set("x-test-user", proClerk)
      .send({ kind: "client" });
    expect(first.status).toBe(200);

    // Home tries to send back the other direction — must be blocked.
    const res = await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("team_up_pending");
  });

  it("ignores client-supplied status=accepted and forces pending (no bypass of approval flow)", async () => {
    await clearConnections();
    const res = await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client", status: "accepted" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");

    // Messaging must still be gated since no real accept happened.
    const msg = await request(app)
      .post(`/api/messages/${proClerk}`)
      .set("x-test-user", homeClerk)
      .send({ content: "should be blocked" });
    expect(msg.status).toBe(403);
    expect(msg.body.code).toBe("team_up_required");

    // Only one row exists — no reciprocal accepted-row was created.
    const rows = await db
      .select()
      .from(userConnectionsTable)
      .where(
        or(
          eq(userConnectionsTable.fromOutwardAccountId, homeAcct),
          eq(userConnectionsTable.fromOutwardAccountId, proAcct),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
  });
});

describe("POST /users/:userId/team-up/respond (#501)", () => {
  it("decline marks the request declined and creates no reciprocal", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });

    const res = await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "decline" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("declined");

    const rows = await db
      .select()
      .from(userConnectionsTable)
      .where(
        or(
          eq(userConnectionsTable.fromOutwardAccountId, homeAcct),
          eq(userConnectionsTable.fromOutwardAccountId, proAcct),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("declined");
    expect(rows[0].respondedAt).not.toBeNull();
  });

  it("accept stamps respondedAt and creates the reciprocal accepted row", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });

    const res = await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");

    const rows = await db
      .select()
      .from(userConnectionsTable)
      .where(
        or(
          eq(userConnectionsTable.fromOutwardAccountId, homeAcct),
          eq(userConnectionsTable.fromOutwardAccountId, proAcct),
        ),
      );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "accepted")).toBe(true);
  });

  it("returns 409 team_up_ambiguous when the same user has multiple pending requests and disambiguates via requesterOutwardAccountId", async () => {
    await clearConnections();
    // Create a second outward account on the requester (homeowner) so
    // they have two skins both sending pending requests to the pro.
    const [secondHome] = await db
      .insert(outwardAccountsTable)
      .values({
        ownerClerkId: homeClerk,
        kind: "home" satisfies UserModeKind,
        displayName: "Hannah's other home",
      })
      .returning({ id: outwardAccountsTable.id });

    // First pending: from default home skin.
    await db.insert(userConnectionsTable).values({
      fromOutwardAccountId: homeAcct,
      toOutwardAccountId: proAcct,
      kind: "client",
      status: "pending",
      requestedAt: new Date(),
    });
    // Second pending: from the second home skin.
    await db.insert(userConnectionsTable).values({
      fromOutwardAccountId: secondHome.id,
      toOutwardAccountId: proAcct,
      kind: "client",
      status: "pending",
      requestedAt: new Date(),
    });

    // Without disambiguation → 409 ambiguous.
    const ambiguous = await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept" });
    expect(ambiguous.status).toBe(409);
    expect(ambiguous.body.code).toBe("team_up_ambiguous");

    // With disambiguation → only the targeted row flips to accepted.
    const ok = await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept", requesterOutwardAccountId: secondHome.id });
    expect(ok.status).toBe(200);

    const targeted = await db
      .select()
      .from(userConnectionsTable)
      .where(eq(userConnectionsTable.fromOutwardAccountId, secondHome.id));
    expect(targeted[0].status).toBe("accepted");

    const untouched = await db
      .select()
      .from(userConnectionsTable)
      .where(
        and(
          eq(userConnectionsTable.fromOutwardAccountId, homeAcct),
          eq(userConnectionsTable.toOutwardAccountId, proAcct),
        ),
      );
    expect(untouched[0].status).toBe("pending");
  });

  it("returns 404 when no pending request from that user exists", async () => {
    await clearConnections();
    const res = await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept" });
    expect(res.status).toBe(404);
  });

  // #599 — On accept, the requester's personalNote (if any) is carried
  // into the new direct-message thread as a `team_up_note` opener so
  // both sides see why the connection was made. Decline must not
  // create the opener.
  it("carries the requester's personal note into the new thread on accept", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client", personalNote: "Saw your reviews — would love your help." });

    const res = await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept" });
    expect(res.status).toBe(200);

    const opener = await db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.senderClerkId, homeClerk),
          eq(messagesTable.recipientClerkId, proClerk),
          eq(messagesTable.source, "team_up_note"),
        ),
      );
    expect(opener).toHaveLength(1);
    expect(opener[0].content).toBe("Saw your reviews — would love your help.");
    expect(opener[0].senderOutwardAccountId).toBe(homeAcct);
    expect(opener[0].recipientOutwardAccountId).toBe(proAcct);
  });

  // #603 — Every accept now also drops a system "you're now connected"
  // anchor at the top of the new thread so the freshly-unlocked
  // composer isn't completely blank. Independent of whether a
  // personal note was attached.
  it("inserts a system_connected anchor at the top of the new thread on accept", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client", personalNote: "Saw your reviews — would love your help." });

    const res = await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept" });
    expect(res.status).toBe(200);

    const systemRows = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.source, "system_connected"));
    expect(systemRows).toHaveLength(1);
    expect(systemRows[0].content).toBe(
      "Hannah Home and Pat Pro are now connected. Say hi!",
    );
    expect(systemRows[0].senderOutwardAccountId).toBe(homeAcct);
    expect(systemRows[0].recipientOutwardAccountId).toBe(proAcct);
    expect(systemRows[0].isRead).toBe(true);

    // The system anchor must precede the team_up_note opener so it is
    // the first row in the chronologically-ordered thread.
    const noteRows = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.source, "team_up_note"));
    expect(noteRows).toHaveLength(1);
    expect(systemRows[0].id).toBeLessThan(noteRows[0].id);
  });

  it("inserts the system_connected anchor even when there is no personal note", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });

    await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept" });

    const systemRows = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.source, "system_connected"));
    expect(systemRows).toHaveLength(1);
    expect(systemRows[0].content).toBe(
      "Hannah Home and Pat Pro are now connected. Say hi!",
    );
  });

  it("does not insert a system_connected anchor on decline", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });

    await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "decline" });

    const systemRows = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.source, "system_connected"));
    expect(systemRows).toHaveLength(0);
  });

  it("does not create a team_up_note opener when there is no personal note", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });

    await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept" });

    const opener = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.source, "team_up_note"));
    expect(opener).toHaveLength(0);
  });

  it("does not create a team_up_note opener on decline", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client", personalNote: "Hello there" });

    await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "decline" });

    const opener = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.source, "team_up_note"));
    expect(opener).toHaveLength(0);
  });
});

describe("POST /messages/:otherTarget gating (#501)", () => {
  it("returns 403 with team_up_required when no accepted connection", async () => {
    await clearConnections();
    const res = await request(app)
      .post(`/api/messages/${proClerk}`)
      .set("x-test-user", homeClerk)
      .send({ content: "Hello?" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("team_up_required");
  });

  it("succeeds once a request is accepted", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });
    await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept" });

    const res = await request(app)
      .post(`/api/messages/${proClerk}`)
      .set("x-test-user", homeClerk)
      .send({ content: "Hello after accept!" });
    expect(res.status).toBe(201);
    expect(res.body.content).toBe("Hello after accept!");
  });
});

describe("GET /messages/:otherTarget pre-emptive team-up gate (#644)", () => {
  it("reports canMessage=false / teamUpStatus=team_up_required before any accepted connection", async () => {
    await clearConnections();
    const res = await request(app)
      .get(`/api/messages/${proClerk}`)
      .set("x-test-user", homeClerk);
    expect(res.status).toBe(200);
    expect(res.body.canMessage).toBe(false);
    expect(res.body.teamUpStatus).toBe("team_up_required");
    expect(res.body.otherOutwardAccountId).toBe(proAcct);
    // The POST handler must agree — same gate, same code.
    const send = await request(app)
      .post(`/api/messages/${proClerk}`)
      .set("x-test-user", homeClerk)
      .send({ content: "should still be blocked" });
    expect(send.status).toBe(403);
    expect(send.body.code).toBe("team_up_required");
  });

  it("flips to canMessage=true / teamUpStatus=connected once the connection is accepted", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });
    await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept" });

    const res = await request(app)
      .get(`/api/messages/${proClerk}`)
      .set("x-test-user", homeClerk);
    expect(res.status).toBe(200);
    expect(res.body.canMessage).toBe(true);
    expect(res.body.teamUpStatus).toBe("connected");
    expect(res.body.otherOutwardAccountId).toBe(proAcct);

    // Symmetric: the recipient sees the same gate from their side.
    const back = await request(app)
      .get(`/api/messages/${homeClerk}`)
      .set("x-test-user", proClerk);
    expect(back.status).toBe(200);
    expect(back.body.canMessage).toBe(true);
    expect(back.body.teamUpStatus).toBe("connected");
    expect(back.body.otherOutwardAccountId).toBe(homeAcct);
  });

  it("reports the gate when the target user can't be resolved", async () => {
    const res = await request(app)
      .get(`/api/messages/no-such-clerk-${tag}`)
      .set("x-test-user", homeClerk);
    expect(res.status).toBe(200);
    expect(res.body.canMessage).toBe(false);
    expect(res.body.teamUpStatus).toBe("team_up_required");
    expect(res.body.otherOutwardAccountId).toBeNull();
  });
});

describe("DELETE /users/:userId/connect + reconnect (#501)", () => {
  it("removes both directions and a follow-up /connect creates a fresh pending request", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });
    await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept" });

    const del = await request(app)
      .delete(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk);
    expect(del.status).toBe(200);

    const removedRows = await db
      .select()
      .from(userConnectionsTable)
      .where(
        or(
          eq(userConnectionsTable.fromOutwardAccountId, homeAcct),
          eq(userConnectionsTable.fromOutwardAccountId, proAcct),
        ),
      );
    expect(removedRows.every((r) => r.status === "removed")).toBe(true);
    expect(removedRows.every((r) => r.removedAt != null)).toBe(true);

    // Reconnect must create a fresh pending request, not auto-restore.
    const reconnect = await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });
    expect(reconnect.status).toBe(200);
    expect(reconnect.body.status).toBe("pending");

    // And messages are blocked again until re-accepted.
    const msg = await request(app)
      .post(`/api/messages/${proClerk}`)
      .set("x-test-user", homeClerk)
      .send({ content: "still locked out" });
    expect(msg.status).toBe(403);
  });
});

describe("POST /users/:userId/connect ignores legacy archived rows (#501)", () => {
  it("treats archived-but-accepted legacy rows as inactive and creates a fresh pending request", async () => {
    await clearConnections();
    // Simulate a pre-#501 disconnect: status still "accepted" but
    // archivedAt is set. The old idempotency check would short-circuit
    // here; the new logic must allow a fresh pending request instead.
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);
    await db.insert(userConnectionsTable).values({
      fromOutwardAccountId: homeAcct,
      toOutwardAccountId: proAcct,
      kind: "client",
      status: "accepted",
      archivedAt: past,
    });

    const res = await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");

    const [row] = await db
      .select()
      .from(userConnectionsTable)
      .where(
        and(
          eq(userConnectionsTable.fromOutwardAccountId, homeAcct),
          eq(userConnectionsTable.toOutwardAccountId, proAcct),
        ),
      );
    expect(row.status).toBe("pending");
    expect(row.archivedAt).toBeNull();
  });
});

describe("POST /users/:userId/connect drops team-up-request system message + notification (#656)", () => {
  it("inserts a team_up_request system message addressed both ways and a notification on the recipient", async () => {
    await clearConnections();
    const res = await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({
        kind: "collaborator",
        personalNote: "Want to partner on the Elm St remodel?",
      });
    expect(res.status).toBe(200);

    // The system-style message lands once, addressed both ways with
    // the kind-aware summary up top and the personal note quoted on a
    // second paragraph (so MessageRow can split them cleanly).
    const msgs = await db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.senderClerkId, homeClerk),
          eq(messagesTable.recipientClerkId, proClerk),
        ),
      );
    expect(msgs).toHaveLength(1);
    const sysMsg = msgs[0];
    expect(sysMsg.source).toBe("team_up_request");
    expect(sysMsg.senderOutwardAccountId).toBe(homeAcct);
    expect(sysMsg.recipientOutwardAccountId).toBe(proAcct);
    expect(sysMsg.content).toBe(
      'Asked to team up as Collaborator\n\n"Want to partner on the Elm St remodel?"',
    );
    // Marked read so the per-thread unread badge doesn't double-count
    // with the dedicated team-up-request notification + /invites row.
    expect(sysMsg.isRead).toBe(true);

    // Recipient gets the team-up-request notification, pinned to the
    // recipient's outward account (not the requester's), with the
    // message id as relatedId so deep links can target the thread.
    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userClerkId, proClerk));
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe("team_up_request");
    expect(notifs[0].outwardAccountId).toBe(proAcct);
    expect(notifs[0].relatedId).toBe(String(sysMsg.id));
    expect(notifs[0].body).toContain("Hannah Home");
    expect(notifs[0].body?.toLowerCase()).toContain("collaborator");
  });

  it("omits the quoted note paragraph when no personalNote was sent", async () => {
    await clearConnections();
    const res = await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "core" });
    expect(res.status).toBe(200);

    const [sysMsg] = await db
      .select()
      .from(messagesTable)
      .where(
        and(
          eq(messagesTable.senderClerkId, homeClerk),
          eq(messagesTable.recipientClerkId, proClerk),
          eq(messagesTable.source, "team_up_request"),
        ),
      );
    expect(sysMsg.content).toBe("Asked to team up as Core");
  });

  it("surfaces pendingTeamUpFromOther on the recipient's inbox row and routes the tap to /invites", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client", personalNote: "Excited to work together" });

    // Recipient's inbox: row carries the pending flag so the client
    // can show the "Review team-up request" CTA and route the tap to
    // /invites instead of opening the gated chat. The row preview
    // surfaces the kind-aware request summary (and quoted personal
    // note) — NOT the empty-state "say hi" placeholder, since a
    // pending request IS the actionable content.
    const recipientRes = await request(app)
      .get("/api/messages")
      .set("x-test-user", proClerk);
    expect(recipientRes.status).toBe(200);
    const recipientRow = recipientRes.body.conversations.find(
      (c: { otherUser?: { clerkId?: string } }) =>
        c.otherUser?.clerkId === homeClerk,
    );
    expect(recipientRow).toBeDefined();
    expect(recipientRow.pendingTeamUpFromOther).toBe(true);
    // Critical: the row must NOT be flagged empty so the inbox
    // preview renders the lastMessage content (the kind-aware
    // summary) instead of the "You're now connected — say hi"
    // placeholder. The recipient needs to see what they're being
    // asked into, not a generic chat affordance.
    expect(recipientRow.isEmpty).toBeFalsy();
    expect(recipientRow.lastMessage.source).toBe("team_up_request");
    expect(recipientRow.lastMessage.content).toContain(
      "Asked to team up as Client",
    );
    expect(recipientRow.lastMessage.content).toContain(
      "Excited to work together",
    );

    // Requester's own inbox row also exists (so the requester has a
    // thread to look at) but does NOT carry the pending flag — they
    // sent the request, so /invites isn't where they need to go.
    const requesterRes = await request(app)
      .get("/api/messages")
      .set("x-test-user", homeClerk);
    expect(requesterRes.status).toBe(200);
    const requesterRow = requesterRes.body.conversations.find(
      (c: { otherUser?: { clerkId?: string } }) =>
        c.otherUser?.clerkId === proClerk,
    );
    expect(requesterRow).toBeDefined();
    expect(requesterRow.pendingTeamUpFromOther).toBeUndefined();
    // Requester also sees the kind-aware summary they sent.
    expect(requesterRow.lastMessage.source).toBe("team_up_request");
  });

  it("clears pendingTeamUpFromOther once the recipient accepts", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });
    await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept" });

    const res = await request(app)
      .get("/api/messages")
      .set("x-test-user", proClerk);
    const row = res.body.conversations.find(
      (c: { otherUser?: { clerkId?: string } }) =>
        c.otherUser?.clerkId === homeClerk,
    );
    expect(row).toBeDefined();
    expect(row.pendingTeamUpFromOther).toBeUndefined();
  });
});

describe("GET /messages surfaces empty conversations from accepted connections (#604)", () => {
  it("returns an empty conversation row right after accept (no real messages exchanged)", async () => {
    await clearConnections();
    // Send + accept WITHOUT a personal note. Post-#656 the connect
    // call writes a `team_up_request` system row and accept writes a
    // `system_connected` row, both addressed FROM the requester to the
    // responder. Neither counts as a real DM, so the recipient's row
    // is still flagged isEmpty=true. The requester's row is no longer
    // empty (the team_up_request system pill they "sent" anchors the
    // thread for them per #656), so /inbox/[other] always opens to a
    // visible thread instead of a blank composer.
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });
    await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept" });

    // Sanity: only system-authored rows exist for this pair —
    // system_connected and team_up_note from /respond accept
    // (#603/#599 — the team_up_note is the auto-composed
    // `inviteMessage` letter carried into the chat even when no
    // personal note was attached). The team_up_request row inserted
    // by /connect (#656) is intentionally deleted by the accept
    // handler so the thread is clean post-accept.
    const msgsBefore = await db
      .select()
      .from(messagesTable)
      .where(
        or(
          and(
            eq(messagesTable.senderClerkId, homeClerk),
            eq(messagesTable.recipientClerkId, proClerk),
          ),
          and(
            eq(messagesTable.senderClerkId, proClerk),
            eq(messagesTable.recipientClerkId, homeClerk),
          ),
        ),
      );
    expect(msgsBefore.map((m) => m.source).sort()).toEqual([
      "system_connected",
      "team_up_note",
    ]);

    // Recipient (pro): row stays flagged empty so the "say hi"
    // affordance still renders. lastMessage points at the real
    // team_up_note row (the last system row inserted by accept,
    // chronologically latest of the 2 system messages above) — not
    // the pre-#604 synthetic id=0 row.
    const proRes = await request(app)
      .get("/api/messages")
      .set("x-test-user", proClerk);
    expect(proRes.status).toBe(200);
    const proConvo = proRes.body.conversations.find(
      (c: { otherUser?: { clerkId?: string } }) =>
        c.otherUser?.clerkId === homeClerk,
    );
    expect(proConvo).toBeDefined();
    expect(proConvo.isEmpty).toBe(true);
    expect(proConvo.otherOutwardAccountId).toBe(homeAcct);
    expect(proConvo.unreadCount).toBe(0);
    expect(proConvo.lastMessage.source).toBe("team_up_note");

    // Requester (home): the team_up_request pill they "sent" anchors
    // the thread, so the row is no longer empty.
    const homeRes = await request(app)
      .get("/api/messages")
      .set("x-test-user", homeClerk);
    expect(homeRes.status).toBe(200);
    const homeConvo = homeRes.body.conversations.find(
      (c: { otherUser?: { clerkId?: string } }) =>
        c.otherUser?.clerkId === proClerk,
    );
    expect(homeConvo).toBeDefined();
    expect(homeConvo.isEmpty).toBeFalsy();
    expect(homeConvo.otherOutwardAccountId).toBe(proAcct);
    expect(homeConvo.lastMessage.source).toBe("team_up_note");
  });

  it("merges with the real conversation once a message is sent (no duplicate row)", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });
    await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept" });
    await request(app)
      .post(`/api/messages/${proClerk}`)
      .set("x-test-user", homeClerk)
      .send({ content: "First real message" });

    const res = await request(app)
      .get("/api/messages")
      .set("x-test-user", homeClerk);
    expect(res.status).toBe(200);
    const matching = res.body.conversations.filter(
      (c: { otherUser?: { clerkId?: string } }) =>
        c.otherUser?.clerkId === proClerk,
    );
    expect(matching).toHaveLength(1);
    expect(matching[0].isEmpty).toBeFalsy();
    expect(matching[0].lastMessage.content).toBe("First real message");
    expect(matching[0].otherOutwardAccountId).toBe(proAcct);
  });

  // #610 — when the requester's personal note has been carried into
  // the thread by #599, the recipient's inbox row should still flag
  // the conversation as empty (so the "Tap to start the conversation"
  // affordance from #604/#606 still shows) until the recipient sends
  // their first reply. The requester's own row should not be flagged
  // empty because they wrote the note.
  it("keeps isEmpty=true on the recipient's row while the only message is the carried-over team_up_note (#610)", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client", personalNote: "Saw your reviews — let's team up." });
    await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept" });

    // Sanity: the carry-over note exists, attributed to the requester.
    const noteRows = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.source, "team_up_note"));
    expect(noteRows).toHaveLength(1);
    expect(noteRows[0].senderClerkId).toBe(homeClerk);
    expect(noteRows[0].recipientClerkId).toBe(proClerk);

    // Recipient (the responder) — row stays flagged empty so the
    // "Tap to start the conversation" CTA still renders.
    const proRes = await request(app)
      .get("/api/messages")
      .set("x-test-user", proClerk);
    expect(proRes.status).toBe(200);
    const proConvo = proRes.body.conversations.find(
      (c: { otherUser?: { clerkId?: string } }) =>
        c.otherUser?.clerkId === homeClerk,
    );
    expect(proConvo).toBeDefined();
    expect(proConvo.isEmpty).toBe(true);
    expect(proConvo.otherOutwardAccountId).toBe(homeAcct);
    // The note itself stays available inside the thread — the inbox
    // row's lastMessage still points at the real note row, the client
    // just renders the empty-state preview because isEmpty is true.
    expect(proConvo.lastMessage.id).toBe(noteRows[0].id);
    expect(proConvo.lastMessage.source).toBe("team_up_note");

    // Requester (who wrote the note) — they did "send" something, so
    // their row is not flagged empty.
    const homeRes = await request(app)
      .get("/api/messages")
      .set("x-test-user", homeClerk);
    expect(homeRes.status).toBe(200);
    const homeConvo = homeRes.body.conversations.find(
      (c: { otherUser?: { clerkId?: string } }) =>
        c.otherUser?.clerkId === proClerk,
    );
    expect(homeConvo).toBeDefined();
    expect(homeConvo.isEmpty).toBeFalsy();
    expect(homeConvo.lastMessage.source).toBe("team_up_note");

    // Once the recipient actually replies, isEmpty must drop off.
    await request(app)
      .post(`/api/messages/${homeClerk}`)
      .set("x-test-user", proClerk)
      .send({ content: "Thanks for reaching out!" });

    const proAfter = await request(app)
      .get("/api/messages")
      .set("x-test-user", proClerk);
    const proConvoAfter = proAfter.body.conversations.find(
      (c: { otherUser?: { clerkId?: string } }) =>
        c.otherUser?.clerkId === homeClerk,
    );
    expect(proConvoAfter).toBeDefined();
    expect(proConvoAfter.isEmpty).toBeFalsy();
    expect(proConvoAfter.lastMessage.content).toBe("Thanks for reaching out!");
  });

  it("hides the empty row when the other-side outward account is archived (#607)", async () => {
    await clearConnections();
    // Accept a connection so both sides have a synthetic empty row.
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });
    await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "accept" });

    // Sanity: home sees the empty row before archiving.
    const before = await request(app)
      .get("/api/messages")
      .set("x-test-user", homeClerk);
    expect(
      before.body.conversations.find(
        (c: { otherOutwardAccountId?: number }) =>
          c.otherOutwardAccountId === proAcct,
      ),
    ).toBeDefined();

    // Archive the pro's outward account directly. Now the empty row
    // on home's side points at an account that no longer exists.
    await db
      .update(outwardAccountsTable)
      .set({ archivedAt: new Date() })
      .where(eq(outwardAccountsTable.id, proAcct));

    try {
      const res = await request(app)
        .get("/api/messages")
        .set("x-test-user", homeClerk);
      expect(res.status).toBe(200);
      const matching = res.body.conversations.filter(
        (c: { otherOutwardAccountId?: number; otherUser?: { clerkId?: string } }) =>
          c.otherOutwardAccountId === proAcct ||
          c.otherUser?.clerkId === proClerk,
      );
      expect(matching).toHaveLength(0);
    } finally {
      // Restore so subsequent tests in this file can keep using proAcct.
      await db
        .update(outwardAccountsTable)
        .set({ archivedAt: null })
        .where(eq(outwardAccountsTable.id, proAcct));
    }
  });

  it("declined requests do NOT surface as a conversation", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client" });
    await request(app)
      .post(`/api/users/${homeClerk}/team-up/respond`)
      .set("x-test-user", proClerk)
      .send({ action: "decline" });

    const res = await request(app)
      .get("/api/messages")
      .set("x-test-user", homeClerk);
    expect(res.status).toBe(200);
    const matching = res.body.conversations.filter(
      (c: { otherUser?: { clerkId?: string } }) =>
        c.otherUser?.clerkId === proClerk,
    );
    expect(matching).toHaveLength(0);
  });
});

describe("GET /users/me/team-up-requests (#501)", () => {
  it("surfaces incoming and outgoing pending requests", async () => {
    await clearConnections();
    await request(app)
      .post(`/api/users/${proClerk}/connect`)
      .set("x-test-user", homeClerk)
      .send({ kind: "client", personalNote: "from home" });

    const fromPro = await request(app)
      .get("/api/users/me/team-up-requests")
      .set("x-test-user", proClerk);
    expect(fromPro.status).toBe(200);
    expect(fromPro.body.incoming).toHaveLength(1);
    expect(fromPro.body.outgoing).toHaveLength(0);
    expect(fromPro.body.incoming[0].otherClerkId).toBe(homeClerk);
    expect(fromPro.body.incoming[0].personalNote).toBe("from home");

    const fromHome = await request(app)
      .get("/api/users/me/team-up-requests")
      .set("x-test-user", homeClerk);
    expect(fromHome.body.outgoing).toHaveLength(1);
    expect(fromHome.body.incoming).toHaveLength(0);
  });
});
