/**
 * Task #583: end-to-end coverage for the concierge "send drafted
 * client note" flow.
 *
 * Exercises the happy path that fires when the user taps Confirm on a
 * `draft_client_note` proposal:
 *   - GET /concierge/recipients lists every outward-account counterpart
 *     the active skin has an accepted, non-archived connection to (and
 *     hides outsiders/archived rows).
 *   - POST /concierge/send-draft with channel="in_app" inserts a real
 *     row into `messages`, fans out a `message` notification to the
 *     recipient, and appends a "Sent draft to …" system note to the
 *     concierge thread for the sender's active skin.
 *   - Validation: recipient required, content required, only `in_app`
 *     channel is supported today.
 *
 * Plus the team-up gate: a send to an outward account that has not
 * accepted a connection from the active skin returns 403 with
 * `team_up_required` and writes nothing.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { and, asc, eq, inArray, or } from "drizzle-orm";

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
  conciergeConversationsTable,
  conciergeMessagesTable,
  messagesTable,
  notificationsTable,
  outwardAccountsTable,
  userConnectionsTable,
  usersTable,
} = await import("@workspace/db");
type UserModeKind = import("@workspace/db").UserModeKind;
const conciergeRouter = (await import("../concierge")).default;
const { withActiveOutwardAccount } = await import(
  "../../middlewares/withActiveOutwardAccount"
);
const { resolveActiveOutwardAccountId } = await import(
  "../../lib/outwardAccounts"
);

function attachTestUserId(req: any, _res: any, next: any) {
  const uid = req.headers["x-test-user"];
  if (uid) req.userId = String(uid);
  next();
}

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", attachTestUserId, withActiveOutwardAccount);
  app.use("/api", conciergeRouter);
  return app;
}

const tag = `t583-${Date.now()}`;
const homeClerk = `${tag}-home`;
const proClerk = `${tag}-pro`;
const strangerClerk = `${tag}-stranger`;
const archivedClerk = `${tag}-archived`;
const allClerkIds = [homeClerk, proClerk, strangerClerk, archivedClerk];

let app: Express;
let homeAcct: number;
let proAcct: number;
let strangerAcct: number;
let archivedAcct: number;

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
    {
      clerkId: strangerClerk,
      email: `${tag}-stranger@example.test`,
      name: "Sam Stranger",
      username: `stranger_${tag}`,
    },
    {
      clerkId: archivedClerk,
      email: `${tag}-archived@example.test`,
      name: "Archie Archived",
      username: `archived_${tag}`,
    },
  ]);
  const h = await resolveActiveOutwardAccountId(homeClerk);
  const p = await resolveActiveOutwardAccountId(proClerk);
  const s = await resolveActiveOutwardAccountId(strangerClerk);
  const a = await resolveActiveOutwardAccountId(archivedClerk);
  if (h == null || p == null || s == null || a == null) {
    throw new Error("failed to seed outward accounts");
  }
  homeAcct = h;
  proAcct = p;
  strangerAcct = s;
  archivedAcct = a;

  // Realistic kinds + display name so the picker has something to show.
  await db
    .update(outwardAccountsTable)
    .set({ kind: "home" satisfies UserModeKind, displayName: "Hannah Home" })
    .where(eq(outwardAccountsTable.id, homeAcct));
  await db
    .update(outwardAccountsTable)
    .set({
      kind: "trade_pro" satisfies UserModeKind,
      companyName: "ACME Plumbing",
      displayName: "Pat Pro",
    })
    .where(eq(outwardAccountsTable.id, proAcct));
  await db
    .update(outwardAccountsTable)
    .set({
      kind: "trade_pro" satisfies UserModeKind,
      displayName: "Sam Stranger",
    })
    .where(eq(outwardAccountsTable.id, strangerAcct));
  await db
    .update(outwardAccountsTable)
    .set({
      kind: "trade_pro" satisfies UserModeKind,
      displayName: "Archie Archived",
    })
    .where(eq(outwardAccountsTable.id, archivedAcct));

  // Grant the home skin the ai_concierge paid capability so the routes
  // don't 402 on us.
  await db
    .update(outwardAccountsTable)
    .set({ capabilityState: "expanded" })
    .where(eq(outwardAccountsTable.id, homeAcct));
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
    await db
      .delete(conciergeMessagesTable)
      .where(
        inArray(
          conciergeMessagesTable.conversationId,
          db
            .select({ id: conciergeConversationsTable.id })
            .from(conciergeConversationsTable)
            .where(
              inArray(
                conciergeConversationsTable.outwardAccountId,
                ownedAccountIds,
              ),
            ),
        ),
      );
    await db
      .delete(conciergeConversationsTable)
      .where(
        inArray(
          conciergeConversationsTable.outwardAccountId,
          ownedAccountIds,
        ),
      );
  }
  await db
    .delete(messagesTable)
    .where(inArray(messagesTable.senderClerkId, allClerkIds));
  await db
    .delete(notificationsTable)
    .where(inArray(notificationsTable.userClerkId, allClerkIds));
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
  const ids = [homeAcct, proAcct, strangerAcct, archivedAcct];
  await db
    .delete(userConnectionsTable)
    .where(
      or(
        inArray(userConnectionsTable.fromOutwardAccountId, ids),
        inArray(userConnectionsTable.toOutwardAccountId, ids),
      ),
    );
}

async function clearSendArtifacts() {
  await db
    .delete(messagesTable)
    .where(inArray(messagesTable.senderClerkId, allClerkIds));
  await db
    .delete(notificationsTable)
    .where(inArray(notificationsTable.userClerkId, allClerkIds));
  const convs = await db
    .select({ id: conciergeConversationsTable.id })
    .from(conciergeConversationsTable)
    .where(eq(conciergeConversationsTable.userClerkId, homeClerk));
  if (convs.length > 0) {
    await db
      .delete(conciergeMessagesTable)
      .where(
        inArray(
          conciergeMessagesTable.conversationId,
          convs.map((c) => c.id),
        ),
      );
  }
}

async function acceptConnection(fromAcct: number, toAcct: number) {
  // Reciprocal accepted rows mirror what the team-up accept handler
  // produces — `hasAcceptedConnection` only looks for the from→to row
  // but production always writes the pair, so we do too.
  const now = new Date();
  await db.insert(userConnectionsTable).values([
    {
      fromOutwardAccountId: fromAcct,
      toOutwardAccountId: toAcct,
      kind: "client",
      status: "accepted",
      requestedAt: now,
      respondedAt: now,
    },
    {
      fromOutwardAccountId: toAcct,
      toOutwardAccountId: fromAcct,
      kind: "client",
      status: "accepted",
      requestedAt: now,
      respondedAt: now,
    },
  ]);
}

describe("GET /concierge/recipients (#583)", () => {
  it("returns only outward-account counterparts with an accepted, non-archived connection from the active skin", async () => {
    await clearConnections();
    // Home → Pro: accepted (should show up).
    await acceptConnection(homeAcct, proAcct);
    // Home → Archived: accepted but archived (must be hidden).
    const now = new Date();
    await db.insert(userConnectionsTable).values({
      fromOutwardAccountId: homeAcct,
      toOutwardAccountId: archivedAcct,
      kind: "client",
      status: "accepted",
      requestedAt: now,
      respondedAt: now,
      archivedAt: now,
    });
    // Home → Stranger: only pending (must be hidden).
    await db.insert(userConnectionsTable).values({
      fromOutwardAccountId: homeAcct,
      toOutwardAccountId: strangerAcct,
      kind: "client",
      status: "pending",
      requestedAt: now,
    });

    const res = await request(app)
      .get("/api/concierge/recipients")
      .set("x-test-user", homeClerk);
    expect(res.status).toBe(200);
    const ids = res.body.recipients.map((r: any) => r.outwardAccountId);
    expect(ids).toEqual([proAcct]);
    expect(res.body.recipients[0]).toMatchObject({
      outwardAccountId: proAcct,
      name: "Pat Pro",
      kind: "trade_pro",
      companyName: "ACME Plumbing",
    });
  });

  it("returns 402 capability-required when the active skin has not paid", async () => {
    // Flip capability off temporarily.
    await db
      .update(outwardAccountsTable)
      .set({ capabilityState: "standard" })
      .where(eq(outwardAccountsTable.id, homeAcct));
    try {
      const res = await request(app)
        .get("/api/concierge/recipients")
        .set("x-test-user", homeClerk);
      expect(res.status).toBe(402);
      expect(res.body.capability).toBe("ai_concierge");
    } finally {
      await db
        .update(outwardAccountsTable)
        .set({ capabilityState: "expanded" })
        .where(eq(outwardAccountsTable.id, homeAcct));
    }
  });
});

describe("POST /concierge/send-draft happy path (#583)", () => {
  it("inserts a /messages row, fans out a notification, and writes a system note to the concierge thread", async () => {
    await clearConnections();
    await clearSendArtifacts();
    await acceptConnection(homeAcct, proAcct);

    const res = await request(app)
      .post("/api/concierge/send-draft")
      .set("x-test-user", homeClerk)
      .send({
        recipientOutwardAccountId: proAcct,
        content: "Hi Pat — the concierge drafted this for you.",
        channel: "in_app",
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      recipientOutwardAccountId: proAcct,
    });
    expect(typeof res.body.messageId).toBe("number");

    // Real /messages row addressed skin-to-skin and clerk-to-clerk.
    const [msg] = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.id, res.body.messageId));
    expect(msg).toBeDefined();
    expect(msg.senderClerkId).toBe(homeClerk);
    expect(msg.recipientClerkId).toBe(proClerk);
    expect(msg.senderOutwardAccountId).toBe(homeAcct);
    expect(msg.recipientOutwardAccountId).toBe(proAcct);
    expect(msg.content).toBe("Hi Pat — the concierge drafted this for you.");
    // #585: drafts sent through the concierge are tagged so the inbox
    // can render a "drafted with concierge" badge on the recipient side.
    expect(msg.source).toBe("concierge_draft");

    // Push/in-app notification fanned out to the recipient.
    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userClerkId, proClerk));
    expect(notifs).toHaveLength(1);
    expect(notifs[0]).toMatchObject({
      type: "message",
      title: "New message",
      relatedId: String(msg.id),
      outwardAccountId: proAcct,
    });
    expect(notifs[0].body).toContain("Hannah Home");

    // System note appended to the sender's concierge thread.
    const [conv] = await db
      .select()
      .from(conciergeConversationsTable)
      .where(
        and(
          eq(conciergeConversationsTable.userClerkId, homeClerk),
          eq(conciergeConversationsTable.outwardAccountId, homeAcct),
        ),
      );
    expect(conv).toBeDefined();
    const convMsgs = await db
      .select()
      .from(conciergeMessagesTable)
      .where(eq(conciergeMessagesTable.conversationId, conv.id))
      .orderBy(asc(conciergeMessagesTable.createdAt));
    const systemNote = convMsgs.find((m) => m.role === "system");
    expect(systemNote).toBeDefined();
    // Recipient label prefers outward-account title/displayName, falling
    // back to the user name.
    expect(systemNote!.content).toBe(
      "Sent draft to Pat Pro via in-app message.",
    );
  });

  it("rejects unsupported channels with channel_unsupported", async () => {
    // Only in_app / sms / email are wired; anything else is rejected
    // before any other validation runs.
    const res = await request(app)
      .post("/api/concierge/send-draft")
      .set("x-test-user", homeClerk)
      .send({
        recipientOutwardAccountId: proAcct,
        content: "anything",
        channel: "fax",
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("channel_unsupported");
  });

  it("requires recipientOutwardAccountId and content", async () => {
    const noRecipient = await request(app)
      .post("/api/concierge/send-draft")
      .set("x-test-user", homeClerk)
      .send({ content: "hi" });
    expect(noRecipient.status).toBe(400);

    const noContent = await request(app)
      .post("/api/concierge/send-draft")
      .set("x-test-user", homeClerk)
      .send({ recipientOutwardAccountId: proAcct, content: "   " });
    expect(noContent.status).toBe(400);
  });
});

describe("POST /concierge/send-draft brand-new contact (#587)", () => {
  it("sends an SMS draft to a brand-new contact (no recipientOutwardAccountId, no team-up needed)", async () => {
    await clearConnections();
    await clearSendArtifacts();

    const res = await request(app)
      .post("/api/concierge/send-draft")
      .set("x-test-user", homeClerk)
      .send({
        recipientName: "Jamie Lead",
        recipientPhone: "+15551112222",
        content: "Hi Jamie — heard you're looking for a contractor.",
        channel: "sms",
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      channel: "sms",
      messageId: null,
    });
    // No outward-account counterpart for brand-new contacts.
    expect(res.body.recipientOutwardAccountId == null).toBe(true);
    expect(typeof res.body.composeUri).toBe("string");
    expect(res.body.composeUri).toContain("sms:+15551112222");

    // System note reflects the typed name + phone.
    const [conv] = await db
      .select()
      .from(conciergeConversationsTable)
      .where(
        and(
          eq(conciergeConversationsTable.userClerkId, homeClerk),
          eq(conciergeConversationsTable.outwardAccountId, homeAcct),
        ),
      );
    expect(conv).toBeDefined();
    const convMsgs = await db
      .select()
      .from(conciergeMessagesTable)
      .where(eq(conciergeMessagesTable.conversationId, conv.id))
      .orderBy(asc(conciergeMessagesTable.createdAt));
    const systemNote = convMsgs.find((m) => m.role === "system");
    expect(systemNote).toBeDefined();
    expect(systemNote!.content).toBe(
      "Prepared SMS draft for Jamie Lead (+15551112222).",
    );

    // No /messages row was inserted — SMS sends never write to the in-app inbox.
    const sent = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.senderClerkId, homeClerk));
    expect(sent).toHaveLength(0);
  });

  it("sends an email draft to a brand-new contact via mailto compose URI when no email provider is configured", async () => {
    await clearConnections();
    await clearSendArtifacts();

    const res = await request(app)
      .post("/api/concierge/send-draft")
      .set("x-test-user", homeClerk)
      .send({
        recipientName: "Jamie Lead",
        recipientEmail: "jamie@example.test",
        content: "Hi Jamie — quick intro from Roundhouse.",
        channel: "email",
        subject: "Intro",
      });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ok: true,
      channel: "email",
      messageId: null,
    });
    expect(res.body.recipientOutwardAccountId == null).toBe(true);
    // Without a server-side email provider configured the route hands
    // delivery off to the user's mail app via a mailto: URI.
    expect(typeof res.body.composeUri).toBe("string");
    expect(res.body.composeUri).toContain("mailto:");
    expect(res.body.composeUri).toContain("jamie%40example.test");

    const [conv] = await db
      .select()
      .from(conciergeConversationsTable)
      .where(
        and(
          eq(conciergeConversationsTable.userClerkId, homeClerk),
          eq(conciergeConversationsTable.outwardAccountId, homeAcct),
        ),
      );
    expect(conv).toBeDefined();
    const convMsgs = await db
      .select()
      .from(conciergeMessagesTable)
      .where(eq(conciergeMessagesTable.conversationId, conv.id))
      .orderBy(asc(conciergeMessagesTable.createdAt));
    const systemNote = convMsgs.find((m) => m.role === "system");
    expect(systemNote).toBeDefined();
    // mailto handoff is phrased as "Prepared … draft" since the user
    // still has to tap Send in their mail app.
    expect(systemNote!.content).toBe(
      "Prepared email draft for Jamie Lead (jamie@example.test).",
    );

    // No /messages row inserted for email sends.
    const sent = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.senderClerkId, homeClerk));
    expect(sent).toHaveLength(0);
  });

  it("rejects brand-new-contact in-app sends (in-app needs a real recipient account)", async () => {
    const res = await request(app)
      .post("/api/concierge/send-draft")
      .set("x-test-user", homeClerk)
      .send({
        recipientName: "Jamie Lead",
        content: "should be blocked",
        channel: "in_app",
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("in_app_requires_recipient");
  });

  it("requires a recipient name when sending to a brand-new contact", async () => {
    const res = await request(app)
      .post("/api/concierge/send-draft")
      .set("x-test-user", homeClerk)
      .send({
        recipientPhone: "+15551112222",
        content: "no name",
        channel: "sms",
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("recipient_name_required");
  });
});

describe("POST /concierge/send-draft team-up gate (#583)", () => {
  it("returns 403 team_up_required when the recipient has not accepted a connection, and writes nothing", async () => {
    await clearConnections();
    await clearSendArtifacts();

    const res = await request(app)
      .post("/api/concierge/send-draft")
      .set("x-test-user", homeClerk)
      .send({
        recipientOutwardAccountId: strangerAcct,
        content: "should be blocked",
        channel: "in_app",
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("team_up_required");

    // Nothing landed in /messages or notifications.
    const sent = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.senderClerkId, homeClerk));
    expect(sent).toHaveLength(0);
    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userClerkId, strangerClerk));
    expect(notifs).toHaveLength(0);

    // And no system note was appended to the concierge thread.
    const convs = await db
      .select({ id: conciergeConversationsTable.id })
      .from(conciergeConversationsTable)
      .where(eq(conciergeConversationsTable.userClerkId, homeClerk));
    if (convs.length > 0) {
      const systemNotes = await db
        .select()
        .from(conciergeMessagesTable)
        .where(
          and(
            eq(
              conciergeMessagesTable.conversationId,
              convs[0].id,
            ),
            eq(conciergeMessagesTable.role, "system"),
          ),
        );
      expect(systemNotes).toHaveLength(0);
    }
  });

  it("rejects sends targeting a connection that is only pending (not yet accepted)", async () => {
    await clearConnections();
    await clearSendArtifacts();
    await db.insert(userConnectionsTable).values({
      fromOutwardAccountId: homeAcct,
      toOutwardAccountId: strangerAcct,
      kind: "client",
      status: "pending",
      requestedAt: new Date(),
    });

    const res = await request(app)
      .post("/api/concierge/send-draft")
      .set("x-test-user", homeClerk)
      .send({
        recipientOutwardAccountId: strangerAcct,
        content: "still blocked",
        channel: "in_app",
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("team_up_required");
  });
});
