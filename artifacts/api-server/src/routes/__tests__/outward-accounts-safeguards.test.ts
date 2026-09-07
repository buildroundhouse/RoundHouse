/**
 * Tests for the outward-account safeguards introduced alongside the
 * personal-profile / multi-skin work (task #562):
 *
 *   - POST /outward-accounts enforces a per-kind cap of 5 for the
 *     business kinds (trade_pro, facilities) and returns the structured
 *     409 envelope (`code: "kind_cap_reached"`).
 *   - POST /outward-accounts/:id/archive and /:id/delete refuse to
 *     strand the user with zero accounts (`code: "last_account"`) or
 *     to nuke the currently-active one (`code: "active_account"`).
 *   - POST /outward-accounts/:id/transfer-avatar moves the avatar URL
 *     from a business source to a business target (happy path) and
 *     refuses if either side is non-business (`code: "non_business_kind"`).
 *   - GET / PUT /users/me/personal returns only the personal subset of
 *     the users row, never overlays per-account fields, and rejects
 *     malformed input.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";

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

const { db, usersTable, outwardAccountsTable, userConnectionsTable } =
  await import("@workspace/db");
const outwardAccountsRouter = (await import("../outward-accounts")).default;
const usersRouter = (await import("../users")).default;
const { withActiveOutwardAccount } = await import(
  "../../middlewares/withActiveOutwardAccount"
);
const { PER_KIND_CREATE_CAPS } = await import("../outward-accounts");

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
  app.use("/api", usersRouter);
  return app;
}

const tag = `t562-${Date.now()}`;
const capClerk = `${tag}-cap`;
const safeClerk = `${tag}-safe`;
const avatarClerk = `${tag}-av`;
const personalClerk = `${tag}-pers`;
const allClerks = [capClerk, safeClerk, avatarClerk, personalClerk];

let app: Express;

beforeAll(async () => {
  app = makeApp();
  await db.insert(usersTable).values(
    allClerks.map((clerkId, idx) => ({
      clerkId,
      email: `${clerkId}@example.test`,
      name: `User ${idx}`,
      username: clerkId,
    })),
  );
});

afterAll(async () => {
  const ownedAccountIds = (
    await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(inArray(outwardAccountsTable.ownerClerkId, allClerks))
  ).map((r) => r.id);
  if (ownedAccountIds.length > 0) {
    await db
      .delete(userConnectionsTable)
      .where(
        inArray(userConnectionsTable.fromOutwardAccountId, ownedAccountIds),
      );
    await db
      .delete(userConnectionsTable)
      .where(inArray(userConnectionsTable.toOutwardAccountId, ownedAccountIds));
  }
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, allClerks));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, allClerks));
});

describe("per-kind creation caps (#562)", () => {
  it("returns kind_cap_reached after the 5th trade_pro account", async () => {
    const cap = PER_KIND_CREATE_CAPS.trade_pro!;
    expect(cap).toBe(5);

    // Lazy-seed the default home account so trade_pro slots are clean.
    const seed = await request(app)
      .get("/api/outward-accounts")
      .set("x-test-user", capClerk);
    expect(seed.status).toBe(200);

    for (let i = 0; i < cap; i++) {
      const ok = await request(app)
        .post("/api/outward-accounts")
        .set("x-test-user", capClerk)
        .send({
          kind: "trade_pro",
          title: `Trade ${i}`,
          displayName: `Trade ${i}`,
        });
      expect(ok.status).toBe(201);
    }

    const blocked = await request(app)
      .post("/api/outward-accounts")
      .set("x-test-user", capClerk)
      .send({ kind: "trade_pro", title: "Trade 6", displayName: "Trade 6" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("kind_cap_reached");
    expect(blocked.body.kind).toBe("trade_pro");
    expect(blocked.body.limit).toBe(cap);
    expect(blocked.body.currentCount).toBe(cap);

    // Facilities is capped independently, so the 6th trade_pro being
    // refused doesn't keep the user from creating a fresh facilities one.
    const facilities = await request(app)
      .post("/api/outward-accounts")
      .set("x-test-user", capClerk)
      .send({
        kind: "facilities",
        title: "Fac 1",
        displayName: "Fac 1",
      });
    expect(facilities.status).toBe(201);
  });

  it("does not count archived accounts against the cap", async () => {
    // Use the same capClerk: pick one trade_pro to archive then try
    // creating again. We need to switch off it first because it might
    // be active, and we need at least one other live account (we have
    // many at this point).
    const trades = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, capClerk),
          eq(outwardAccountsTable.kind, "trade_pro"),
        ),
      );
    expect(trades.length).toBe(5);
    const firstTrade = trades[0];

    // Make sure firstTrade isn't active by switching to the most recent
    // facilities account, which we know exists from the previous test.
    const list = await request(app)
      .get("/api/outward-accounts")
      .set("x-test-user", capClerk);
    const facAcct = list.body.accounts.find(
      (a: any) => a.kind === "facilities",
    );
    expect(facAcct).toBeTruthy();
    const switched = await request(app)
      .post(`/api/outward-accounts/${facAcct.id}/switch`)
      .set("x-test-user", capClerk);
    expect(switched.status).toBe(200);

    const archived = await request(app)
      .post(`/api/outward-accounts/${firstTrade.id}/archive`)
      .set("x-test-user", capClerk);
    expect(archived.status).toBe(200);

    // Now creation should succeed because only 4 live trade_pro remain.
    const ok = await request(app)
      .post("/api/outward-accounts")
      .set("x-test-user", capClerk)
      .send({
        kind: "trade_pro",
        title: "Trade Refill",
        displayName: "Trade Refill",
      });
    expect(ok.status).toBe(201);
  });
});

describe("active-account and protected-baseline safeguards (#562, #572)", () => {
  // #572 reframed the lazy seed: every user gets a permanent
  // Collaborator / Friend (`collab`) outward account that's first in
  // their switcher and refused by archive/delete. The legacy
  // `last_account` 409 is therefore only reachable in pathological
  // shapes (no collab at all), so the suite now exercises
  // `protected_baseline` plus the still-live `active_account` path.

  it("lazy seed creates the Collaborator / Friend baseline first", async () => {
    const seed = await request(app)
      .get("/api/outward-accounts")
      .set("x-test-user", safeClerk);
    expect(seed.status).toBe(200);
    expect(seed.body.accounts.length).toBe(1);
    expect(seed.body.accounts[0].kind).toBe("collab");
    expect(seed.body.activeOutwardAccountId).toBe(seed.body.accounts[0].id);
  });

  it("archive refuses the collab baseline with protected_baseline", async () => {
    const list = await request(app)
      .get("/api/outward-accounts")
      .set("x-test-user", safeClerk);
    const collab = list.body.accounts.find((a: any) => a.kind === "collab");
    expect(collab).toBeTruthy();

    // Even when other accounts exist (so last_account isn't a factor)
    // and the collab isn't active, archive must still refuse.
    const second = await request(app)
      .post("/api/outward-accounts")
      .set("x-test-user", safeClerk)
      .send({ kind: "trade_pro", title: "Second", displayName: "Second" });
    expect(second.status).toBe(201);
    await request(app)
      .post(`/api/outward-accounts/${second.body.id}/switch`)
      .set("x-test-user", safeClerk);

    const refused = await request(app)
      .post(`/api/outward-accounts/${collab.id}/archive`)
      .set("x-test-user", safeClerk);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("protected_baseline");
  });

  it("delete refuses the collab baseline with protected_baseline", async () => {
    const list = await request(app)
      .get("/api/outward-accounts")
      .set("x-test-user", safeClerk);
    const collab = list.body.accounts.find((a: any) => a.kind === "collab");
    expect(collab).toBeTruthy();

    const refused = await request(app)
      .post(`/api/outward-accounts/${collab.id}/delete`)
      .set("x-test-user", safeClerk);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("protected_baseline");

    // delete-impact preview surfaces the same envelope so the client
    // can hide the destructive control without probing /delete itself.
    const impact = await request(app)
      .get(`/api/outward-accounts/${collab.id}/delete-impact`)
      .set("x-test-user", safeClerk);
    expect(impact.status).toBe(409);
    expect(impact.body.code).toBe("protected_baseline");
  });

  it("archive returns active_account, then succeeds after switching", async () => {
    // Use two trade_pro accounts so neither is the protected baseline.
    const first = await request(app)
      .post("/api/outward-accounts")
      .set("x-test-user", safeClerk)
      .send({ kind: "trade_pro", title: "Active First", displayName: "Active First" });
    expect(first.status).toBe(201);
    const firstId: number = first.body.id;

    await request(app)
      .post(`/api/outward-accounts/${firstId}/switch`)
      .set("x-test-user", safeClerk);

    const second = await request(app)
      .post("/api/outward-accounts")
      .set("x-test-user", safeClerk)
      .send({ kind: "trade_pro", title: "Active Second", displayName: "Active Second" });
    expect(second.status).toBe(201);
    const secondId: number = second.body.id;

    const refused = await request(app)
      .post(`/api/outward-accounts/${firstId}/archive`)
      .set("x-test-user", safeClerk);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("active_account");

    const switched = await request(app)
      .post(`/api/outward-accounts/${secondId}/switch`)
      .set("x-test-user", safeClerk);
    expect(switched.status).toBe(200);

    const ok = await request(app)
      .post(`/api/outward-accounts/${firstId}/archive`)
      .set("x-test-user", safeClerk);
    expect(ok.status).toBe(200);
  });

  it("delete returns active_account when targeting the active business skin", async () => {
    const list = await request(app)
      .get("/api/outward-accounts")
      .set("x-test-user", safeClerk);
    // The currently-active id is whichever trade_pro the previous test
    // switched to; deleting it must refuse with active_account.
    const activeId: number = list.body.activeOutwardAccountId;
    expect(activeId).toBeTruthy();

    const refused = await request(app)
      .post(`/api/outward-accounts/${activeId}/delete`)
      .set("x-test-user", safeClerk);
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("active_account");
  });
});

describe("collab baseline auto-provisioning (#572)", () => {
  // Fresh user (separate clerkId) — confirms backfill on first
  // /users/me load creates the baseline without needing any client-side
  // POST and that sort order pins it first in the switcher.
  const baselineClerk = `${tag}-baseline`;

  beforeAll(async () => {
    await db.insert(usersTable).values({
      clerkId: baselineClerk,
      email: `${baselineClerk}@example.test`,
      name: "Baseline User",
      username: baselineClerk,
    });
    allClerks.push(baselineClerk);
  });

  it("/users/me backfills the Collaborator / Friend baseline", async () => {
    const me = await request(app)
      .get("/api/users/me")
      .set("x-test-user", baselineClerk);
    expect(me.status).toBe(200);
    const collabRows = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, baselineClerk),
          eq(outwardAccountsTable.kind, "collab"),
        ),
      );
    expect(collabRows.length).toBe(1);
  });

  it("backfill is idempotent across repeated /users/me calls", async () => {
    await request(app).get("/api/users/me").set("x-test-user", baselineClerk);
    await request(app).get("/api/users/me").set("x-test-user", baselineClerk);
    const collabRows = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, baselineClerk),
          eq(outwardAccountsTable.kind, "collab"),
        ),
      );
    expect(collabRows.length).toBe(1);
  });

  it("backfills displayName/avatarUrl from identity when the baseline was seeded before identity completed", async () => {
    // Simulate the race where /users/me created the baseline before
    // the user uploaded an avatar / picked a name. We model that by
    // wiping the baseline's display fields, then updating the user
    // row with identity info, and finally calling /users/me again to
    // confirm the next backfill pass fills the empty fields without
    // clobbering anything else.
    await db
      .update(outwardAccountsTable)
      .set({ displayName: null, avatarUrl: null })
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, baselineClerk),
          eq(outwardAccountsTable.kind, "collab"),
        ),
      );
    await db
      .update(usersTable)
      .set({
        name: "Backfilled Name",
        avatarUrl: "https://cdn.example.test/backfilled.png",
      })
      .where(eq(usersTable.clerkId, baselineClerk));

    await request(app).get("/api/users/me").set("x-test-user", baselineClerk);

    const [collab] = await db
      .select({
        displayName: outwardAccountsTable.displayName,
        avatarUrl: outwardAccountsTable.avatarUrl,
      })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, baselineClerk),
          eq(outwardAccountsTable.kind, "collab"),
        ),
      );
    expect(collab.displayName).toBe("Backfilled Name");
    expect(collab.avatarUrl).toBe("https://cdn.example.test/backfilled.png");
  });

  it("collab baseline is pinned first in the outward-account list", async () => {
    // Add a couple of business skins after the baseline was seeded —
    // sort order must still keep `collab` first, regardless of id order.
    await request(app)
      .post("/api/outward-accounts")
      .set("x-test-user", baselineClerk)
      .send({ kind: "trade_pro", title: "Pin A", displayName: "Pin A" });
    await request(app)
      .post("/api/outward-accounts")
      .set("x-test-user", baselineClerk)
      .send({ kind: "facilities", title: "Pin B", displayName: "Pin B" });
    const list = await request(app)
      .get("/api/outward-accounts")
      .set("x-test-user", baselineClerk);
    expect(list.status).toBe(200);
    expect(list.body.accounts.length).toBeGreaterThanOrEqual(3);
    expect(list.body.accounts[0].kind).toBe("collab");
  });

  it("concurrent first-login traffic produces exactly one collab baseline (race)", async () => {
    // Fresh user, then fire several /users/me + /outward-accounts
    // requests in parallel. The partial unique index +
    // onConflictDoNothing in `ensureCollabBaselineOutwardAccount`
    // must guarantee exactly one live `collab` baseline survives.
    const raceClerk = `${tag}-race`;
    await db.insert(usersTable).values({
      clerkId: raceClerk,
      email: `${raceClerk}@example.test`,
      name: "Race User",
      username: raceClerk,
    });
    allClerks.push(raceClerk);

    await Promise.all([
      request(app).get("/api/users/me").set("x-test-user", raceClerk),
      request(app).get("/api/users/me").set("x-test-user", raceClerk),
      request(app).get("/api/outward-accounts").set("x-test-user", raceClerk),
      request(app).get("/api/outward-accounts").set("x-test-user", raceClerk),
      request(app).get("/api/users/me/modes").set("x-test-user", raceClerk),
    ]);

    const collabRows = await db
      .select({ id: outwardAccountsTable.id })
      .from(outwardAccountsTable)
      .where(
        and(
          eq(outwardAccountsTable.ownerClerkId, raceClerk),
          eq(outwardAccountsTable.kind, "collab"),
        ),
      );
    expect(collabRows.length).toBe(1);
  });
});

describe("POST /outward-accounts/:id/transfer-avatar (#562)", () => {
  it("moves the avatar between two business accounts (happy path)", async () => {
    // Seed the default account, then create two trade_pro skins.
    await request(app)
      .get("/api/outward-accounts")
      .set("x-test-user", avatarClerk);

    const source = await request(app)
      .post("/api/outward-accounts")
      .set("x-test-user", avatarClerk)
      .send({
        kind: "trade_pro",
        title: "Avatar Source",
        displayName: "Avatar Source",
        avatarUrl: "https://cdn.example.test/avatar-A.png",
      });
    expect(source.status).toBe(201);
    const sourceId: number = source.body.id;

    const target = await request(app)
      .post("/api/outward-accounts")
      .set("x-test-user", avatarClerk)
      .send({
        kind: "facilities",
        title: "Avatar Target",
        displayName: "Avatar Target",
      });
    expect(target.status).toBe(201);
    const targetId: number = target.body.id;

    const res = await request(app)
      .post(`/api/outward-accounts/${sourceId}/transfer-avatar`)
      .set("x-test-user", avatarClerk)
      .send({ targetId });
    expect(res.status).toBe(200);
    expect(res.body.target.id).toBe(targetId);
    expect(res.body.target.avatarUrl).toBe("https://cdn.example.test/avatar-A.png");
    expect(res.body.source.id).toBe(sourceId);
    expect(res.body.source.avatarUrl).toBeNull();

    // Persisted state matches the response.
    const rows = await db
      .select({ id: outwardAccountsTable.id, avatarUrl: outwardAccountsTable.avatarUrl })
      .from(outwardAccountsTable)
      .where(inArray(outwardAccountsTable.id, [sourceId, targetId]));
    const byId = new Map(rows.map((r) => [r.id, r.avatarUrl]));
    expect(byId.get(sourceId)).toBeNull();
    expect(byId.get(targetId)).toBe("https://cdn.example.test/avatar-A.png");
  });

  it("refuses transfer when either side is a non-business kind", async () => {
    // Find the lazy-seeded Collaborator / Friend (#572 baseline) and a
    // trade_pro with an avatar — collab is non-business so it stands in
    // for the prior `home` lookup.
    const accounts = await db
      .select({
        id: outwardAccountsTable.id,
        kind: outwardAccountsTable.kind,
        avatarUrl: outwardAccountsTable.avatarUrl,
      })
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.ownerClerkId, avatarClerk));
    const home = accounts.find((a) => a.kind === "collab")!;
    const tradeWithAvatar = accounts.find((a) => a.kind === "trade_pro")!;
    expect(home).toBeTruthy();
    expect(tradeWithAvatar).toBeTruthy();

    // Give the trade_pro an avatar so the source-has-avatar precondition
    // doesn't short-circuit before the kind check.
    await db
      .update(outwardAccountsTable)
      .set({ avatarUrl: "https://cdn.example.test/avatar-B.png" })
      .where(eq(outwardAccountsTable.id, tradeWithAvatar.id));

    // Business → non-business: rejected.
    const toHome = await request(app)
      .post(`/api/outward-accounts/${tradeWithAvatar.id}/transfer-avatar`)
      .set("x-test-user", avatarClerk)
      .send({ targetId: home.id });
    expect(toHome.status).toBe(409);
    expect(toHome.body.code).toBe("non_business_kind");

    // Non-business → business: also rejected (give the home an avatar
    // so the source-has-avatar gate is satisfied first).
    await db
      .update(outwardAccountsTable)
      .set({ avatarUrl: "https://cdn.example.test/avatar-home.png" })
      .where(eq(outwardAccountsTable.id, home.id));
    const fromHome = await request(app)
      .post(`/api/outward-accounts/${home.id}/transfer-avatar`)
      .set("x-test-user", avatarClerk)
      .send({ targetId: tradeWithAvatar.id });
    expect(fromHome.status).toBe(409);
    expect(fromHome.body.code).toBe("non_business_kind");
  });
});

describe("GET / PUT /users/me/personal (#562)", () => {
  it("returns the personal subset and never overlays per-account fields", async () => {
    // Seed an outward account for personalClerk and switch to it; then
    // assert /personal still reflects the raw users row, untouched.
    const created = await request(app)
      .post("/api/outward-accounts")
      .set("x-test-user", personalClerk)
      .send({
        kind: "trade_pro",
        title: "Persona Skin",
        displayName: "Persona Skin",
        bio: "skin-level bio",
        companyName: "Skin Co.",
      });
    expect(created.status).toBe(201);
    const acctId: number = created.body.id;
    await request(app)
      .post(`/api/outward-accounts/${acctId}/switch`)
      .set("x-test-user", personalClerk);

    const res = await request(app)
      .get("/api/users/me/personal")
      .set("x-test-user", personalClerk)
      .set("x-active-outward-account-id", String(acctId));
    expect(res.status).toBe(200);
    // Response contains only the personal subset (plus id+clerkId).
    expect(res.body.clerkId).toBe(personalClerk);
    const allowed = new Set([
      "id",
      "clerkId",
      "name",
      "email",
      "avatarUrl",
      "phone",
      "notifyJobStarted",
      "notifyJobCompleted",
    ]);
    for (const key of Object.keys(res.body)) {
      expect(allowed.has(key)).toBe(true);
    }
    // Per-account fields must NOT leak in.
    expect("bio" in res.body).toBe(false);
    expect("companyName" in res.body).toBe(false);
  });

  it("PUT updates the personal fields and returns the same shape", async () => {
    const res = await request(app)
      .put("/api/users/me/personal")
      .set("x-test-user", personalClerk)
      .send({
        name: "Updated Name",
        phone: "555-0100",
        notifyJobStarted: false,
      });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Updated Name");
    expect(res.body.phone).toBe("555-0100");
    expect(res.body.notifyJobStarted).toBe(false);

    // Persisted on the users row.
    const [row] = await db
      .select({
        name: usersTable.name,
        phone: usersTable.phone,
        notifyJobStarted: usersTable.notifyJobStarted,
      })
      .from(usersTable)
      .where(eq(usersTable.clerkId, personalClerk));
    expect(row.name).toBe("Updated Name");
    expect(row.phone).toBe("555-0100");
    expect(row.notifyJobStarted).toBe(false);
  });

  it("PUT rejects malformed email and empty payloads", async () => {
    const badEmail = await request(app)
      .put("/api/users/me/personal")
      .set("x-test-user", personalClerk)
      .send({ email: "not-an-email" });
    expect(badEmail.status).toBe(400);

    const empty = await request(app)
      .put("/api/users/me/personal")
      .set("x-test-user", personalClerk)
      .send({});
    expect(empty.status).toBe(400);
  });
});
