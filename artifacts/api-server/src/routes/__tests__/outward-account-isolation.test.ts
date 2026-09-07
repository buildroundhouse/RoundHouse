/**
 * End-to-end isolation tests for task #307.
 *
 * The same human under two outward-facing skins must NOT share:
 *   - Conversations / message threads
 *   - Notifications feed
 *   - Accepted business invites (which form skin-pair connections)
 *   - Search rows (each skin must appear as its own search result)
 *
 * These tests mount the real route handlers behind the same
 * `withActiveOutwardAccount` middleware as production and switch the
 * caller's active skin via the `x-active-outward-account-id` header.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = String(req.headers["x-test-user"] ?? "");
    if (!req.userId) {
      _res.status(401).json({ error: "missing x-test-user" });
      return;
    }
    next();
  },
}));

const {
  db,
  usersTable,
  outwardAccountsTable,
  messagesTable,
  notificationsTable,
  businessInvitesTable,
  userConnectionsTable,
} = await import("@workspace/db");
const messagesRouter = (await import("../messages")).default;
const notificationsRouter = (await import("../notifications")).default;
const invitesRouter = (await import("../invites")).default;
const usersRouter = (await import("../users")).default;
const outwardAccountsRouter = (await import("../outward-accounts")).default;
const { withActiveOutwardAccount } = await import(
  "../../middlewares/withActiveOutwardAccount"
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
  app.use("/api", outwardAccountsRouter);
  app.use("/api", messagesRouter);
  app.use("/api", notificationsRouter);
  app.use("/api", invitesRouter);
  app.use("/api", usersRouter);
  return app;
}

const tag = `t307-${Date.now()}`;
const aliceClerk = `${tag}-alice`;
const bobClerk = `${tag}-bob`;
const carolClerk = `${tag}-carol`;

let app: Express;
let aliceTradeAccountId: number;
let aliceHomeAccountId: number;
let bobAccountId: number;

beforeAll(async () => {
  app = makeApp();

  await db.insert(usersTable).values([
    {
      clerkId: aliceClerk,
      email: `${tag}-alice@example.test`,
      name: "Alice Owner",
      username: `alice_${tag}`,
    },
    {
      clerkId: bobClerk,
      email: `${tag}-bob@example.test`,
      name: "Bob Other",
      username: `bob_${tag}`,
    },
    {
      clerkId: carolClerk,
      email: `${tag}-carol@example.test`,
      name: "Carol Searcher",
      username: `carol_${tag}`,
    },
  ]);

  // Alice has TWO outward skins: a trade-pro skin and a home skin.
  const accounts = await db
    .insert(outwardAccountsTable)
    .values([
      {
        ownerClerkId: aliceClerk,
        kind: "trade_pro",
        title: "Alice Plumbing",
        displayName: "Alice Plumbing",
        companyName: "Alice Plumbing LLC",
      },
      {
        ownerClerkId: aliceClerk,
        kind: "home",
        title: "Alice (home)",
        displayName: "Alice at Home",
      },
    ])
    .returning();
  aliceTradeAccountId = accounts[0].id;
  aliceHomeAccountId = accounts[1].id;

  // Set Alice's default active skin to trade.
  await db
    .update(usersTable)
    .set({ activeOutwardAccountId: aliceTradeAccountId })
    .where(eq(usersTable.clerkId, aliceClerk));

  // Bob: single skin.
  const [bobAcct] = await db
    .insert(outwardAccountsTable)
    .values({
      ownerClerkId: bobClerk,
      kind: "trade_pro",
      title: "Bob's HVAC",
      displayName: "Bob's HVAC",
    })
    .returning();
  bobAccountId = bobAcct.id;
  await db
    .update(usersTable)
    .set({ activeOutwardAccountId: bobAccountId })
    .where(eq(usersTable.clerkId, bobClerk));

  // Carol: single skin (acts as the searcher in the search test).
  const [carolAcct] = await db
    .insert(outwardAccountsTable)
    .values({
      ownerClerkId: carolClerk,
      kind: "home",
      title: "Carol Home",
      displayName: "Carol Home",
    })
    .returning();
  await db
    .update(usersTable)
    .set({ activeOutwardAccountId: carolAcct.id })
    .where(eq(usersTable.clerkId, carolClerk));
});

afterAll(async () => {
  const clerkIds = [aliceClerk, bobClerk, carolClerk];
  await db
    .delete(messagesTable)
    .where(inArray(messagesTable.senderClerkId, clerkIds));
  await db
    .delete(messagesTable)
    .where(inArray(messagesTable.recipientClerkId, clerkIds));
  await db
    .delete(notificationsTable)
    .where(inArray(notificationsTable.userClerkId, clerkIds));
  // user_connections is now keyed entirely by outward-account ids;
  // delete via the test-owned outward accounts we created in beforeAll.
  const ownAcctIds = [
    aliceHomeAccountId,
    aliceTradeAccountId,
    bobAccountId,
  ].filter((n): n is number => typeof n === "number" && n > 0);
  if (ownAcctIds.length > 0) {
    await db
      .delete(userConnectionsTable)
      .where(inArray(userConnectionsTable.fromOutwardAccountId, ownAcctIds));
    await db
      .delete(userConnectionsTable)
      .where(inArray(userConnectionsTable.toOutwardAccountId, ownAcctIds));
    await db
      .delete(businessInvitesTable)
      .where(inArray(businessInvitesTable.senderOutwardAccountId, ownAcctIds));
  }
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, clerkIds));
});

describe("outward-account scoping isolation (#307)", () => {
  it("messages: a thread sent to Alice's trade skin does NOT appear in her home skin", async () => {
    // Bob sends a message addressed to Alice's TRADE outward account
    // (numeric id targeting — explicit skin selection).
    const sent = await request(app)
      .post(`/api/messages/${aliceTradeAccountId}`)
      .set("x-test-user", bobClerk)
      .set("x-active-outward-account-id", String(bobAccountId))
      .send({ content: "Trade-only quote request" });
    expect([200, 201]).toContain(sent.status);

    // Alice on her TRADE skin: should see the conversation.
    const tradeList = await request(app)
      .get("/api/messages")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(aliceTradeAccountId));
    expect(tradeList.status).toBe(200);
    const tradeOthers = (tradeList.body.conversations ?? []).map(
      (c: any) => c.otherOutwardAccountId,
    );
    expect(tradeOthers).toContain(bobAccountId);

    // Alice on her HOME skin: must NOT see Bob's thread.
    const homeList = await request(app)
      .get("/api/messages")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(aliceHomeAccountId));
    expect(homeList.status).toBe(200);
    const homeOthers = (homeList.body.conversations ?? []).map(
      (c: any) => c.otherOutwardAccountId,
    );
    expect(homeOthers).not.toContain(bobAccountId);

    // The thread fetch itself is also scoped: as HOME, the trade
    // message is invisible.
    const homeThread = await request(app)
      .get(`/api/messages/${bobAccountId}`)
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(aliceHomeAccountId));
    expect(homeThread.status).toBe(200);
    expect(homeThread.body.messages).toEqual([]);

    const tradeThread = await request(app)
      .get(`/api/messages/${bobAccountId}`)
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(aliceTradeAccountId));
    expect(tradeThread.status).toBe(200);
    expect(tradeThread.body.messages.length).toBeGreaterThanOrEqual(1);
    expect(tradeThread.body.messages[0].content).toBe(
      "Trade-only quote request",
    );
  });

  it("notifications: feed follows the person — every notification surfaces from any avatar", async () => {
    // The personal inbox is owner-scoped: a notification stamped to
    // one avatar must be visible from EVERY other avatar the same
    // person owns. This is the entity/property model — the inbox
    // anchors to the human, not the skin. Insert one row pinned to
    // the trade skin and assert it appears from BOTH avatars.
    const [seeded] = await db
      .insert(notificationsTable)
      .values({
        userClerkId: aliceClerk,
        outwardAccountId: aliceTradeAccountId,
        type: "system",
        title: "Cross-skin visibility ping",
        body: "Stamped to trade, must surface from home too",
        isRead: false,
      })
      .returning();

    const tradeNotifs = await request(app)
      .get("/api/notifications")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(aliceTradeAccountId));
    expect(tradeNotifs.status).toBe(200);
    const tradeIds = (tradeNotifs.body.notifications ?? []).map(
      (n: any) => n.id,
    );
    expect(tradeIds).toContain(seeded.id);

    const homeNotifs = await request(app)
      .get("/api/notifications")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(aliceHomeAccountId));
    expect(homeNotifs.status).toBe(200);
    const homeIds = (homeNotifs.body.notifications ?? []).map(
      (n: any) => n.id,
    );
    expect(homeIds).toContain(seeded.id);
  });

  it("notifications: read-all clears every unread for the person, regardless of active avatar", async () => {
    // Seed an unread notification pinned to the home skin.
    await db.insert(notificationsTable).values({
      userClerkId: aliceClerk,
      outwardAccountId: aliceHomeAccountId,
      type: "system",
      title: "Home-only ping",
      body: "Stamped to the home skin",
      isRead: false,
    });
    // And one pinned to the trade skin.
    await db.insert(notificationsTable).values({
      userClerkId: aliceClerk,
      outwardAccountId: aliceTradeAccountId,
      type: "system",
      title: "Trade-only ping",
      body: "Stamped to the trade skin",
      isRead: false,
    });

    // Both pings are visible from EITHER avatar (owner-scoped feed).
    const tradeBefore = await request(app)
      .get("/api/notifications")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(aliceTradeAccountId));
    const tradeBeforeTitles = (tradeBefore.body.notifications ?? []).map(
      (n: any) => n.title,
    );
    expect(tradeBeforeTitles).toContain("Home-only ping");
    expect(tradeBeforeTitles).toContain("Trade-only ping");

    // Read-all from TRADE clears unreads stamped to BOTH skins,
    // because the inbox belongs to the person, not the avatar.
    const readAll = await request(app)
      .post("/api/notifications/read-all")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(aliceTradeAccountId));
    expect(readAll.status).toBe(204);

    const tradeAfter = await request(app)
      .get("/api/notifications")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(aliceTradeAccountId));
    expect(tradeAfter.body.unreadCount).toBe(0);

    const homeAfter = await request(app)
      .get("/api/notifications")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(aliceHomeAccountId));
    expect(homeAfter.body.unreadCount).toBe(0);
    // Both pings still show in the feed (they're now read, not gone).
    const homeAfterTitles = (homeAfter.body.notifications ?? []).map(
      (n: any) => n.title,
    );
    expect(homeAfterTitles).toContain("Home-only ping");
    expect(homeAfterTitles).toContain("Trade-only ping");
  });

  it("invites: accepting on one skin forms a connection scoped to that skin only", async () => {
    // Bob sends Alice a business invite. Stamp the sender's skin as bob.
    const token = `${tag}-invite`;
    const [invite] = await db
      .insert(businessInvitesTable)
      .values({
        senderOutwardAccountId: bobAccountId,
        email: `${tag}-alice@example.test`,
        businessName: "Bob's HVAC",
        token,
        status: "sent",
        sentAt: new Date(),
      })
      .returning();
    expect(invite.id).toBeGreaterThan(0);

    // Alice accepts it while her ACTIVE skin is HOME — connection lands
    // on the home skin, not the trade one.
    const accepted = await request(app)
      .post("/api/invites/business/accept")
      .set("x-test-user", aliceClerk)
      .set("x-active-outward-account-id", String(aliceHomeAccountId))
      .send({ token });
    expect(accepted.status).toBe(200);

    // user_connections rows are now identified purely by the outward-
    // account pair on each side. Look up both directions of the pair.
    const conns = await db
      .select()
      .from(userConnectionsTable)
      .where(
        inArray(userConnectionsTable.fromOutwardAccountId, [
          aliceHomeAccountId,
          bobAccountId,
        ]),
      );
    const aliceSide = conns.find(
      (c) =>
        c.fromOutwardAccountId === aliceHomeAccountId &&
        c.toOutwardAccountId === bobAccountId,
    );
    const bobSide = conns.find(
      (c) =>
        c.fromOutwardAccountId === bobAccountId &&
        c.toOutwardAccountId === aliceHomeAccountId,
    );
    expect(aliceSide).toBeTruthy();
    expect(bobSide).toBeTruthy();

    // The invite row itself records which of Alice's skins owns it.
    const [reread] = await db
      .select()
      .from(businessInvitesTable)
      .where(eq(businessInvitesTable.id, invite.id));
    expect(reread.recipientOutwardAccountId).toBe(aliceHomeAccountId);
  });

  it("search: returns one row per non-archived skin so each persona is independently bookable (#636)", async () => {
    // #636 supersedes the older single-row-per-person collapse:
    // each non-archived outward account ("skin") gets its own row in
    // People search so admin/operator skins (a Game Room, a
    // facility, …) are discoverable alongside the owner's
    // collab/personal skin. Alice owns a trade and a home skin, so
    // Finder must surface both — keyed by `outwardAccountId` — and
    // the caller still must never see herself.
    const res = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(`alice_${tag}`)}`)
      .set("x-test-user", carolClerk)
      .set("x-active-outward-account-id", "0");
    expect(res.status).toBe(200);
    const aliceRows = (res.body.users ?? []).filter(
      (u: any) => u.clerkId === aliceClerk,
    );
    const accountIds: number[] = aliceRows
      .map((u: any) => u.outwardAccountId)
      .filter((v: any): v is number => typeof v === "number");
    expect(accountIds).toContain(aliceTradeAccountId);
    expect(accountIds).toContain(aliceHomeAccountId);
    // Caller never sees themselves.
    const carolRows = (res.body.users ?? []).filter(
      (u: any) => u.clerkId === carolClerk,
    );
    expect(carolRows).toEqual([]);
  });
});
