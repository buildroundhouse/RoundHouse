/**
 * #640 — Per-skin "show last initial only" toggle must shorten the
 * sender's owner name in the entity-scoped chat surfaces too:
 *   - GET /api/entities/:entityId/messages — per-message `sender.name`
 *     for messages authored by another participant whose outward
 *     account has lastInitialOnly = true.
 *   - GET /api/entities/me/threads — `lastMessage.sender.name` for
 *     the most-recent message in each thread.
 *
 * The viewer's own name is never shortened to themselves — the toggle
 * only affects how OTHER participants appear to YOU.
 *
 * Rebased onto Task #663 (entity-only messaging). The legacy
 * avatar-to-avatar `/api/messages` and `/api/messages/:otherTarget`
 * routes are 410 stubs in the new model, so we exercise the privacy
 * contract through the entity handlers that replaced them.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) {
      _res.status(401).json({ error: "missing x-test-user" });
      return;
    }
    req.userId = String(uid);
    next();
  },
}));

const {
  db,
  usersTable,
  outwardAccountsTable,
  messagesTable,
  entitiesTable,
  entityMembersTable,
} = await import("@workspace/db");
const messagesRouter = (await import("../messages")).default;
const { resolveActiveOutwardAccountId } = await import(
  "../../lib/outwardAccounts"
);

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", messagesRouter);
  return app;
}

const tag = `t640m-${Date.now()}`;
const meClerk = `${tag}-me`;
const otherClerk = `${tag}-other`;

let app: Express;
let myAcct: number;
let otherAcct: number;
let entityId: number;

beforeAll(async () => {
  app = makeApp();
  await db.insert(usersTable).values([
    {
      clerkId: meClerk,
      email: `${tag}-me@example.test`,
      name: "Mia Reader",
      username: `me_${tag}`,
    },
    {
      clerkId: otherClerk,
      email: `${tag}-other@example.test`,
      name: "Priya Singh",
      username: `other_${tag}`,
    },
  ]);

  // Seed each user's outward account (auto-creates the collab baseline
  // via the helper). Promote each into a trade_pro skin so the per-skin
  // privacy flag governs a non-collab account, then flip the OTHER
  // user's lastInitialOnly ON so the viewer (me) should see them as
  // "Priya S." in entity-thread + thread-list surfaces.
  const m = await resolveActiveOutwardAccountId(meClerk);
  const o = await resolveActiveOutwardAccountId(otherClerk);
  if (m == null || o == null) throw new Error("failed to seed outward accounts");
  myAcct = m;
  otherAcct = o;
  await db
    .update(outwardAccountsTable)
    .set({ kind: "trade_pro", lastInitialOnly: false })
    .where(eq(outwardAccountsTable.id, myAcct));
  await db
    .update(outwardAccountsTable)
    .set({ kind: "trade_pro", lastInitialOnly: true })
    .where(eq(outwardAccountsTable.id, otherAcct));
  // Promote per-skin pair onto users so resolveActiveOutwardAccount
  // picks the right active account for each side.
  await db
    .update(usersTable)
    .set({ activeOutwardAccountId: myAcct })
    .where(eq(usersTable.clerkId, meClerk));
  await db
    .update(usersTable)
    .set({ activeOutwardAccountId: otherAcct })
    .where(eq(usersTable.clerkId, otherClerk));

  // A shared business entity that both users participate in. Messaging
  // is gated on an approved entity_members row (see canParticipateInEntity).
  const [entity] = await db
    .insert(entitiesTable)
    .values({
      kind: "business",
      name: `${tag} Entity`,
      controllerOutwardAccountId: myAcct,
      controllerUserClerkId: meClerk,
      createdByUserClerkId: meClerk,
    })
    .returning();
  entityId = entity.id;
  await db.insert(entityMembersTable).values([
    {
      entityId,
      userClerkId: meClerk,
      userOutwardAccountId: myAcct,
      role: "owner",
      status: "approved",
      direction: "invite",
    },
    {
      entityId,
      userClerkId: otherClerk,
      userOutwardAccountId: otherAcct,
      role: "employee",
      status: "approved",
      direction: "invite",
    },
  ]);

  // One message in each direction so the entity-thread payload has a
  // sample of both, and listMyEntityThreads has a fresh "from-other"
  // last message (Priya's was inserted first; Mia's is the latest).
  await db.insert(messagesTable).values([
    {
      senderClerkId: otherClerk,
      recipientClerkId: null,
      senderOutwardAccountId: otherAcct,
      recipientOutwardAccountId: null,
      entityId,
      content: "Hello from Priya",
    },
    {
      senderClerkId: meClerk,
      recipientClerkId: null,
      senderOutwardAccountId: myAcct,
      recipientOutwardAccountId: null,
      entityId,
      content: "Reply from me",
    },
  ]);
});

afterAll(async () => {
  const clerkIds = [meClerk, otherClerk];
  await db.delete(messagesTable).where(eq(messagesTable.entityId, entityId));
  await db
    .delete(entityMembersTable)
    .where(eq(entityMembersTable.entityId, entityId));
  await db.delete(entitiesTable).where(eq(entitiesTable.id, entityId));
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, clerkIds));
});

describe("/api/entities/:entityId/messages — per-skin lastInitialOnly (#640)", () => {
  it("shortens the other side's sender name on every message they authored when their flag is ON", async () => {
    const res = await request(app)
      .get(`/api/entities/${entityId}/messages`)
      .set("x-test-user", meClerk);
    expect(res.status).toBe(200);
    const fromOther = (res.body.messages ?? []).filter(
      (m: { senderClerkId?: string }) => m.senderClerkId === otherClerk,
    );
    expect(fromOther.length).toBeGreaterThan(0);
    for (const m of fromOther) {
      expect(m.sender?.name).toBe("Priya S.");
    }
    // Viewer's own messages keep their full name on this surface.
    const fromMe = (res.body.messages ?? []).filter(
      (m: { senderClerkId?: string }) => m.senderClerkId === meClerk,
    );
    expect(fromMe.length).toBeGreaterThan(0);
    for (const m of fromMe) {
      expect(m.sender?.name).toBe("Mia Reader");
    }
  });

  it("does NOT shorten the viewer's own name on the same surface", async () => {
    // From the OTHER user's POV, the viewer ("Mia Reader") is the
    // OTHER side and HER skin's flag is OFF — so her name is the full
    // "Mia Reader" in this user's entity-message payload too.
    const res = await request(app)
      .get(`/api/entities/${entityId}/messages`)
      .set("x-test-user", otherClerk);
    expect(res.status).toBe(200);
    const fromMia = (res.body.messages ?? []).filter(
      (m: { senderClerkId?: string }) => m.senderClerkId === meClerk,
    );
    expect(fromMia.length).toBeGreaterThan(0);
    for (const m of fromMia) {
      expect(m.sender?.name).toBe("Mia Reader");
    }
  });
});

describe("/api/entities/me/threads — per-skin lastInitialOnly (#640)", () => {
  it("shortens lastMessage.sender.name when the latest sender's flag is ON", async () => {
    // First mutate so Priya is the latest — insert another message
    // from her, then read Mia's threads.
    await db.insert(messagesTable).values({
      senderClerkId: otherClerk,
      recipientClerkId: null,
      senderOutwardAccountId: otherAcct,
      recipientOutwardAccountId: null,
      entityId,
      content: "Latest from Priya",
    });
    const res = await request(app)
      .get("/api/entities/me/threads")
      .set("x-test-user", meClerk);
    expect(res.status).toBe(200);
    const row = (res.body.threads ?? []).find(
      (t: { entityId?: number }) => t.entityId === entityId,
    );
    expect(row).toBeTruthy();
    expect(row.lastMessage?.sender?.name).toBe("Priya S.");
  });

  it("flips back to the full name immediately after the toggle is turned off", async () => {
    await db
      .update(outwardAccountsTable)
      .set({ lastInitialOnly: false })
      .where(eq(outwardAccountsTable.id, otherAcct));
    const res = await request(app)
      .get(`/api/entities/${entityId}/messages`)
      .set("x-test-user", meClerk);
    expect(res.status).toBe(200);
    const fromOther = (res.body.messages ?? []).filter(
      (m: { senderClerkId?: string }) => m.senderClerkId === otherClerk,
    );
    expect(fromOther.length).toBeGreaterThan(0);
    for (const m of fromOther) {
      expect(m.sender?.name).toBe("Priya Singh");
    }
  });
});
