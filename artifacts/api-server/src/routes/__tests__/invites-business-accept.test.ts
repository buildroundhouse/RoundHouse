/**
 * End-to-end test for the business-invite accept endpoint that backs the
 * mobile invite landing screen (task #222).
 *
 * Exercises:
 *   - GET /invites/business/:token returns 404 for unknown tokens, and 200 with
 *     inviter info for valid ones.
 *   - POST /invites/business/accept rejects invalid input, refuses self-accept,
 *     and on success marks the invite accepted, sets acceptedAt, and creates
 *     a two-way collaborator connection (keyed on outward-account ids) so the
 *     inviter sees the accepted invite reflected in their relationships.
 *   - Re-accepting the same token is idempotent (status stays "accepted",
 *     acceptedAt is preserved).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

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
  businessInvitesTable,
  outwardAccountsTable,
  userConnectionsTable,
  usersTable,
} = await import("@workspace/db");
const invitesRouter = (await import("../invites")).default;
const { resolveActiveOutwardAccountId } = await import("../../lib/outwardAccounts");

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", invitesRouter);
  return app;
}

const tag = `t222-${Date.now()}`;
const inviterClerkId = `${tag}-inviter`;
const recipientClerkId = `${tag}-recipient`;
const intruderClerkId = `${tag}-intruder`;
const allClerkIds = [inviterClerkId, recipientClerkId, intruderClerkId];

let app: Express;
let inviterAccountId: number;

beforeAll(async () => {
  app = makeApp();
  await db.insert(usersTable).values([
    {
      clerkId: inviterClerkId,
      email: `${tag}-inviter@example.test`,
      name: "Iris Inviter",
      username: `inviter_${tag}`,
    },
    {
      clerkId: recipientClerkId,
      email: `${tag}-recipient@example.test`,
      name: "Reggie Recipient",
      username: `recipient_${tag}`,
    },
    {
      clerkId: intruderClerkId,
      email: `${tag}-intruder@example.test`,
      name: "Imogen Intruder",
      username: `intruder_${tag}`,
    },
  ]);
  // Seed the inviter's default outward account so we can sender-stamp
  // invites in makeInvite below.
  const id = await resolveActiveOutwardAccountId(inviterClerkId);
  if (id == null) throw new Error("failed to seed inviter outward account");
  inviterAccountId = id;
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
      .where(inArray(userConnectionsTable.fromOutwardAccountId, ownedAccountIds));
    await db
      .delete(userConnectionsTable)
      .where(inArray(userConnectionsTable.toOutwardAccountId, ownedAccountIds));
    await db
      .delete(businessInvitesTable)
      .where(inArray(businessInvitesTable.senderOutwardAccountId, ownedAccountIds));
  }
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

async function makeInvite(token: string, businessName: string | null = "ACME Plumbing") {
  const [row] = await db
    .insert(businessInvitesTable)
    .values({
      senderOutwardAccountId: inviterAccountId,
      email: `${tag}-${token}@example.test`,
      businessName,
      token,
      status: "sent",
      sentAt: new Date(),
    })
    .returning();
  return row;
}

async function accountIdsFor(clerkIds: string[]): Promise<number[]> {
  if (clerkIds.length === 0) return [];
  const rows = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds));
  return rows.map((r) => r.id);
}

describe("GET /invites/business/:token", () => {
  it("returns 404 for an unknown token", async () => {
    const res = await request(app).get(`/api/invites/business/${tag}-missing`);
    expect(res.status).toBe(404);
  });

  it("returns the invite with inviter info for a valid token", async () => {
    const invite = await makeInvite(`${tag}-lookup`);
    const res = await request(app).get(`/api/invites/business/${invite.token}`);
    expect(res.status).toBe(200);
    expect(res.body.businessName).toBe("ACME Plumbing");
    expect(res.body.inviter?.name).toBe("Iris Inviter");
    expect(res.body.inviter?.clerkId).toBe(inviterClerkId);
  });
});

describe("POST /invites/business/accept", () => {
  it("returns 400 when the token is missing", async () => {
    const res = await request(app)
      .post("/api/invites/business/accept")
      .set("x-test-user", recipientClerkId)
      .send({});
    expect(res.status).toBe(400);
  });

  it("returns 401 when the caller isn't authenticated", async () => {
    const res = await request(app)
      .post("/api/invites/business/accept")
      .send({ token: "anything" });
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown token", async () => {
    const res = await request(app)
      .post("/api/invites/business/accept")
      .set("x-test-user", recipientClerkId)
      .send({ token: `${tag}-not-real` });
    expect(res.status).toBe(404);
  });

  it("refuses to let the inviter accept their own invite", async () => {
    const invite = await makeInvite(`${tag}-self`);
    const res = await request(app)
      .post("/api/invites/business/accept")
      .set("x-test-user", inviterClerkId)
      .send({ token: invite.token });
    expect(res.status).toBe(400);
  });

  it("marks the invite accepted and creates a two-way connection", async () => {
    const invite = await makeInvite(`${tag}-ok`);
    const res = await request(app)
      .post("/api/invites/business/accept")
      .set("x-test-user", recipientClerkId)
      .send({ token: invite.token });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("accepted");
    expect(typeof res.body.acceptedAt).toBe("string");
    expect(res.body.inviter.clerkId).toBe(inviterClerkId);

    const [saved] = await db
      .select()
      .from(businessInvitesTable)
      .where(eq(businessInvitesTable.id, invite.id));
    expect(saved.status).toBe("accepted");
    expect(saved.acceptedAt).not.toBeNull();

    // Connections live on outward-account pairs now. The recipient's
    // default outward account was lazy-seeded by the accept route.
    const inviterAccountIds = await accountIdsFor([inviterClerkId]);
    const recipientAccountIds = await accountIdsFor([recipientClerkId]);
    expect(recipientAccountIds.length).toBeGreaterThan(0);
    const conns = await db
      .select()
      .from(userConnectionsTable)
      .where(
        inArray(
          userConnectionsTable.fromOutwardAccountId,
          [...inviterAccountIds, ...recipientAccountIds],
        ),
      );
    const fromInviter = conns.find(
      (c) =>
        inviterAccountIds.includes(c.fromOutwardAccountId) &&
        recipientAccountIds.includes(c.toOutwardAccountId),
    );
    const fromRecipient = conns.find(
      (c) =>
        recipientAccountIds.includes(c.fromOutwardAccountId) &&
        inviterAccountIds.includes(c.toOutwardAccountId),
    );
    expect(fromInviter?.status).toBe("accepted");
    expect(fromInviter?.kind).toBe("collaborator");
    expect(fromRecipient?.status).toBe("accepted");
    expect(fromRecipient?.kind).toBe("collaborator");
  });

  it("rejects a replay attempt by a different account and creates no new connection", async () => {
    const invite = await makeInvite(`${tag}-replay`);
    const first = await request(app)
      .post("/api/invites/business/accept")
      .set("x-test-user", recipientClerkId)
      .send({ token: invite.token });
    expect(first.status).toBe(200);

    // Snapshot connections rooted in any of the three users' outward
    // accounts after the legitimate accept so we can prove the intruder
    // doesn't add to them.
    const allAccountIds = await accountIdsFor(allClerkIds);
    const baseline = await db
      .select()
      .from(userConnectionsTable)
      .where(inArray(userConnectionsTable.fromOutwardAccountId, allAccountIds));

    const replay = await request(app)
      .post("/api/invites/business/accept")
      .set("x-test-user", intruderClerkId)
      .send({ token: invite.token });
    expect(replay.status).toBe(409);

    const afterAccountIds = await accountIdsFor(allClerkIds);
    const after = await db
      .select()
      .from(userConnectionsTable)
      .where(inArray(userConnectionsTable.fromOutwardAccountId, afterAccountIds));
    expect(after.length).toBe(baseline.length);

    // No connection should ever exist between the inviter and the
    // intruder, in either direction.
    const inviterAccountIds = await accountIdsFor([inviterClerkId]);
    const intruderAccountIds = await accountIdsFor([intruderClerkId]);
    const intruderLink = after.find(
      (c) =>
        (inviterAccountIds.includes(c.fromOutwardAccountId) &&
          intruderAccountIds.includes(c.toOutwardAccountId)) ||
        (intruderAccountIds.includes(c.fromOutwardAccountId) &&
          inviterAccountIds.includes(c.toOutwardAccountId)),
    );
    expect(intruderLink).toBeUndefined();

    // The accepting user is still recorded as the original recipient.
    const [saved] = await db
      .select()
      .from(businessInvitesTable)
      .where(eq(businessInvitesTable.id, invite.id));
    expect(saved.acceptedByClerkId).toBe(recipientClerkId);
  });

  it("is idempotent when the same token is accepted twice", async () => {
    const invite = await makeInvite(`${tag}-twice`);
    const first = await request(app)
      .post("/api/invites/business/accept")
      .set("x-test-user", recipientClerkId)
      .send({ token: invite.token });
    expect(first.status).toBe(200);
    const firstAcceptedAt = first.body.acceptedAt;

    const second = await request(app)
      .post("/api/invites/business/accept")
      .set("x-test-user", recipientClerkId)
      .send({ token: invite.token });
    expect(second.status).toBe(200);
    expect(second.body.status).toBe("accepted");
    expect(second.body.acceptedAt).toBe(firstAcceptedAt);
  });
});
