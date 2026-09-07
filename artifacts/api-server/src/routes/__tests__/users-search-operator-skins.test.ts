/**
 * #636 — `GET /api/users/search` must surface admin operator skins
 * (each non-archived outward account owned by an admin user) as their
 * own search rows in Finder. The same admin can run a Game Room, a
 * facility, and a workshop side by side — every one of those is a
 * different "company / facility" that the world books separately, and
 * they each need their own bookable Finder row.
 *
 * Hard guarantees enforced here:
 *
 *   1. The admin shows up once per active operator skin (operator =
 *      kind != "collab"). Each row carries the skin's own
 *      `outwardAccountId`, public face (companyName ?? title ??
 *      displayName), and `activeModeKind` so the UI can render the
 *      role tag and route Connect to the right OA.
 *   2. The admin's collab baseline still appears as its own row — the
 *      personal/collab skin keeps its existing behavior (free to
 *      surface the owner's real name).
 *   3. Operator skins MUST NOT leak the admin's personal owner name
 *      (#617): a row with no public face must fall back to
 *      `@username`, never to `users.name`.
 *   4. Archived operator skins are excluded.
 *   5. Demo personas (`admin_demo_profiles` entries) are excluded —
 *      even if they own perfectly normal `outward_accounts` rows.
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
  usersTable,
  outwardAccountsTable,
  adminDemoProfilesTable,
} = await import("@workspace/db");
const usersRouter = (await import("../users")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  return app;
}

const tag = `t636-${Date.now()}`;
const callerClerk = `${tag}-caller`;
const adminClerk = `${tag}-admin`;
const demoClerk = `${tag}-demo`;

let app: Express;
let collabBaselineId: number;
let gameRoomId: number;
let facilityId: number;
let bareTradeProId: number;
let archivedFacilityId: number;
let demoTradeProId: number;

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
      clerkId: adminClerk,
      email: `${tag}-admin@example.test`,
      // Distinctive token only present in the admin's PRIVATE name.
      // No operator skin should ever surface this string.
      name: `PrivateAdmin_${tag}`,
      username: `gameop_${tag}`,
      isAdmin: true,
    },
    {
      clerkId: demoClerk,
      email: `${tag}-demo@example.test`,
      name: "Demo Persona",
      username: `gameop_demo_${tag}`,
    },
  ]);

  // Five outward accounts on the admin (one humble collab baseline +
  // three live operator skins + one archived facility) plus one demo
  // persona's trade_pro skin under the matching username root.
  const adminOAs = await db
    .insert(outwardAccountsTable)
    .values([
      // The admin's personal collab baseline.
      { ownerClerkId: adminClerk, kind: "collab" },
      // Operator skin #1 — Game Room with a companyName public face.
      {
        ownerClerkId: adminClerk,
        kind: "facilities",
        companyName: `Gameop Game Room ${tag}`,
      },
      // Operator skin #2 — Facility with a title-only public face.
      {
        ownerClerkId: adminClerk,
        kind: "facilities",
        title: `Gameop Facility ${tag}`,
      },
      // Operator skin #3 — bare trade_pro with NO public face.
      // Must fall back to @username, NOT to PrivateAdmin_{tag} (#617).
      { ownerClerkId: adminClerk, kind: "trade_pro" },
      // Operator skin #4 — archived facility. Excluded from search.
      {
        ownerClerkId: adminClerk,
        kind: "facilities",
        companyName: `Gameop Archived ${tag}`,
        archivedAt: new Date(),
      },
    ])
    .returning();
  collabBaselineId = adminOAs[0].id;
  gameRoomId = adminOAs[1].id;
  facilityId = adminOAs[2].id;
  bareTradeProId = adminOAs[3].id;
  archivedFacilityId = adminOAs[4].id;

  const demoOAs = await db
    .insert(outwardAccountsTable)
    .values([
      {
        ownerClerkId: demoClerk,
        kind: "trade_pro",
        companyName: `Gameop Demo Co ${tag}`,
      },
    ])
    .returning();
  demoTradeProId = demoOAs[0].id;

  await db.insert(adminDemoProfilesTable).values({
    adminClerkId: adminClerk,
    demoClerkId: demoClerk,
    roleKind: "trade_pro",
    displayName: "Demo Persona",
  });
  // #677 — the discovery filter now reads `users.is_demo` (denormalized
  // mirror of admin_demo_profiles), so flip the column the way the
  // production write path (`insertAdminDemoProfile`) does.
  await db
    .update(usersTable)
    .set({ isDemo: true })
    .where(eq(usersTable.clerkId, demoClerk));
});

afterAll(async () => {
  const clerkIds = [callerClerk, adminClerk, demoClerk];
  await db
    .delete(adminDemoProfilesTable)
    .where(eq(adminDemoProfilesTable.adminClerkId, adminClerk));
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, clerkIds));
});

describe("/api/users/search admin operator skins (#636)", () => {
  it("returns one row per active operator skin owned by an admin, hides archived skins, and never leaks the admin's private owner name", async () => {
    const res = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(`gameop_${tag}`)}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);

    const adminRows = (res.body.users ?? []).filter(
      (u: any) => u.clerkId === adminClerk,
    );
    const idsSeen: number[] = adminRows
      .map((u: any) => u.outwardAccountId)
      .filter((v: any): v is number => typeof v === "number");

    // (1) Each non-archived skin is its own row.
    expect(idsSeen).toContain(collabBaselineId);
    expect(idsSeen).toContain(gameRoomId);
    expect(idsSeen).toContain(facilityId);
    expect(idsSeen).toContain(bareTradeProId);

    // (4) Archived facility is filtered out.
    expect(idsSeen).not.toContain(archivedFacilityId);

    // (1)/(2) Public face per row matches the skin, with the role kind
    // carried through as `activeModeKind` so the UI can render the tag.
    const gameRoomRow = adminRows.find(
      (u: any) => u.outwardAccountId === gameRoomId,
    );
    expect(gameRoomRow).toBeTruthy();
    expect(gameRoomRow.name).toBe(`Gameop Game Room ${tag}`);
    expect(gameRoomRow.activeModeKind).toBe("facilities");

    const facilityRow = adminRows.find(
      (u: any) => u.outwardAccountId === facilityId,
    );
    expect(facilityRow).toBeTruthy();
    expect(facilityRow.name).toBe(`Gameop Facility ${tag}`);
    expect(facilityRow.activeModeKind).toBe("facilities");

    // (3) The bare operator skin has no public face — it must fall
    // back to @username, NEVER to the admin's private name.
    const bareRow = adminRows.find(
      (u: any) => u.outwardAccountId === bareTradeProId,
    );
    expect(bareRow).toBeTruthy();
    expect(bareRow.name).toBe(`@gameop_${tag}`);
    expect(bareRow.name).not.toBe(`PrivateAdmin_${tag}`);
    expect(bareRow.activeModeKind).toBe("trade_pro");

    // The collab baseline keeps its existing fallback behavior — it
    // is the admin's personal skin and may surface the owner's name.
    const collabRow = adminRows.find(
      (u: any) => u.outwardAccountId === collabBaselineId,
    );
    expect(collabRow).toBeTruthy();
    expect(collabRow.activeModeKind).toBe("collab");

    // No operator row leaks the admin's private owner name in `name`.
    for (const row of adminRows) {
      if (row.outwardAccountId === collabBaselineId) continue;
      expect(row.name).not.toBe(`PrivateAdmin_${tag}`);
    }
  });

  it("excludes demo personas (admin_demo_profiles) from search results, even when their public skin matches the query", async () => {
    const res = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(`gameop`)}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    const clerkIds = (res.body.users ?? []).map((u: any) => u.clerkId);
    expect(clerkIds).not.toContain(demoClerk);
    // Sanity: the admin's operator skins still surface so we know the
    // query itself was wide enough to have hit the demo.
    expect(clerkIds).toContain(adminClerk);
  });
});
