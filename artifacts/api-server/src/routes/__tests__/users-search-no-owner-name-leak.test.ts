/**
 * #617 — `GET /api/users/search` must never leak the underlying owner's
 * personal name (`users.name`) on a result row whose skin is not the
 * owner's personal one. The personal skin is the auto-seeded
 * Collaborator / Friend baseline (kind = "collab"); for every other
 * skin (`trade_pro`, `home`, `facilities`, …) the public-facing name
 * must come from the skin's own fields and the owner's real name must
 * stay hidden. Search ranking must also stop matching on the private
 * `users.name` column so a query that only matches the owner's name
 * cannot surface a non-personal skin at all.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";

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

const { db, usersTable, outwardAccountsTable } = await import("@workspace/db");
const usersRouter = (await import("../users")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  return app;
}

const tag = `t617-${Date.now()}`;
const callerClerk = `${tag}-caller`;
const ownerClerk = `${tag}-owner`;
let app: Express;
let tradeAccountId: number;
let collabAccountId: number;
let displayOnlyAccountId: number;

beforeAll(async () => {
  app = makeApp();

  await db.insert(usersTable).values([
    {
      clerkId: callerClerk,
      email: `${tag}-caller@example.test`,
      name: "Carol Caller",
      username: `caller_${tag}`,
    },
    {
      clerkId: ownerClerk,
      email: `${tag}-owner@example.test`,
      // Distinctive token only present in the owner's PRIVATE name.
      name: `PrivateOwner_${tag}`,
      username: `pubuser_${tag}`,
    },
  ]);

  // Three skins for the same owner:
  //   1. trade_pro skin with NO displayName / companyName / title.
  //      Pre-#617 this row's `name` would fall back to the owner's
  //      private name. Post-#617 it must fall back to the public
  //      username instead.
  //   2. collab baseline (the owner's personal skin) — fine to expose
  //      the owner name; it is what the user picked for that skin.
  //   3. trade_pro skin WITH a displayName, used for the
  //      "search-by-private-name" leak test.
  const accounts = await db
    .insert(outwardAccountsTable)
    .values([
      { ownerClerkId: ownerClerk, kind: "trade_pro" },
      {
        ownerClerkId: ownerClerk,
        kind: "collab",
        displayName: `PrivateOwner_${tag}`,
      },
      {
        ownerClerkId: ownerClerk,
        kind: "trade_pro",
        displayName: `PublicSkin_${tag}`,
      },
    ])
    .returning();
  tradeAccountId = accounts[0].id;
  collabAccountId = accounts[1].id;
  displayOnlyAccountId = accounts[2].id;
});

afterAll(async () => {
  const clerkIds = [callerClerk, ownerClerk];
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, clerkIds));
});

describe("/api/users/search owner-name leak prevention (#617 + #640)", () => {
  it("falls back to @username, not the private owner name, on non-personal skins (and excludes the collab/personal baseline outright)", async () => {
    const res = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(`pubuser_${tag}`)}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    // #640 — Search dedupes to one row per owner. The bare trade skin
    // has the lowest id and wins the dedupe, so we expect to see *it*
    // (with the @username fallback, not the private owner name) and
    // NOT the personal/collab baseline anywhere in the response.
    const ids: number[] = (res.body.users ?? []).map(
      (u: any) => u.outwardAccountId,
    );
    expect(ids).toContain(tradeAccountId);
    expect(ids).not.toContain(collabAccountId);
    const tradeRow = (res.body.users ?? []).find(
      (u: any) => u.outwardAccountId === tradeAccountId,
    );
    expect(tradeRow).toBeTruthy();
    expect(tradeRow.name).not.toBe(`PrivateOwner_${tag}`);
    expect(tradeRow.name).toBe(`@pubuser_${tag}`);
  });

  it("does not surface a skin just because the query matches the owner's private name (collab is excluded entirely)", async () => {
    const res = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(`PrivateOwner_${tag}`)}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    const accountIds: number[] = (res.body.users ?? [])
      .map((u: any) => u.outwardAccountId)
      .filter((v: any): v is number => typeof v === "number");
    // #640 — Collab baseline is now excluded from People search even
    // when its OWN displayName matches the query. Personal/friend
    // baselines surface only via the dedicated friends/inbox flows.
    expect(accountIds).not.toContain(collabAccountId);
    // The bare trade skin has no public field that contains the
    // private owner name, so it must NOT appear.
    expect(accountIds).not.toContain(tradeAccountId);
    // The other trade skin's public displayName is `PublicSkin_…`
    // which doesn't contain the private name either.
    expect(accountIds).not.toContain(displayOnlyAccountId);
  });
});
