/**
 * Vitest for the admin demo-profiles router.
 *
 * Covers:
 *   - GET returns empty list and the full availableRoleKinds set.
 *   - POST happy-path provisions a Firebase user (mocked global.fetch),
 *     inserts users + outward_accounts + admin_demo_profiles rows, and
 *     returns the serialized profile.
 *   - POST duplicate role_kind for the same admin succeeds (multiple
 *     demos per kind are allowed since the unique index was dropped).
 *   - Non-admin caller is rejected with 401.
 *   - DELETE happy-path cascades the demo user's outward_accounts,
 *     users row, and admin_demo_profiles row.
 *   - DELETE for a profile owned by a different admin returns 404.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  tryAttachAuth: async (req: any) => {
    const uid = req.headers["x-test-user"];
    if (uid) req.userId = String(uid);
  },
}));

const adminAllowlist = new Set<string>();
vi.mock("../../lib/rewards", () => ({
  isAdminUser: async (clerkId: string | null | undefined) => {
    if (!clerkId) return false;
    return adminAllowlist.has(clerkId);
  },
}));

const {
  db,
  adminDemoProfilesTable,
  outwardAccountsTable,
  userModesTable,
  usersTable,
} = await import("@workspace/db");
const adminDemoProfilesRouter = (await import("../admin-demo-profiles")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", adminDemoProfilesRouter);
  return app;
}

const tag = `tadp-${Date.now()}`;
const adminA = `${tag}-admin-a`;
const adminB = `${tag}-admin-b`;
const memberC = `${tag}-member-c`;

let app: Express;
const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;
const originalApiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;

async function cleanupDemos(): Promise<void> {
  // Snapshot demo clerk ids belonging to either test admin, then nuke
  // their downstream rows + the admin_demo_profiles entries themselves.
  const demoRows = await db
    .select({
      id: adminDemoProfilesTable.id,
      demoClerkId: adminDemoProfilesTable.demoClerkId,
    })
    .from(adminDemoProfilesTable);
  const mine = demoRows.filter((r) => r.demoClerkId.startsWith(`${tag}-fb-`));
  for (const row of mine) {
    await db
      .delete(outwardAccountsTable)
      .where(eq(outwardAccountsTable.ownerClerkId, row.demoClerkId));
    await db
      .delete(userModesTable)
      .where(eq(userModesTable.userClerkId, row.demoClerkId));
    await db.delete(usersTable).where(eq(usersTable.clerkId, row.demoClerkId));
    await db
      .delete(adminDemoProfilesTable)
      .where(eq(adminDemoProfilesTable.id, row.id));
  }
}

beforeAll(async () => {
  app = makeApp();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  process.env.EXPO_PUBLIC_FIREBASE_API_KEY = "test-fb-key";

  adminAllowlist.add(adminA);
  adminAllowlist.add(adminB);

  await db.insert(usersTable).values([
    {
      clerkId: adminA,
      email: `${tag}-a@example.test`,
      name: "Admin A",
      username: `admin_a_${tag}`,
      isAdmin: true,
    },
    {
      clerkId: adminB,
      email: `${tag}-b@example.test`,
      name: "Admin B",
      username: `admin_b_${tag}`,
      isAdmin: true,
    },
    {
      clerkId: memberC,
      email: `${tag}-c@example.test`,
      name: "Member C",
      username: `member_c_${tag}`,
    },
  ]);
});

afterAll(async () => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) {
    delete process.env.EXPO_PUBLIC_FIREBASE_API_KEY;
  } else {
    process.env.EXPO_PUBLIC_FIREBASE_API_KEY = originalApiKey;
  }
  await cleanupDemos();
  for (const id of [adminA, adminB, memberC]) {
    await db.delete(usersTable).where(eq(usersTable.clerkId, id));
  }
  adminAllowlist.clear();
});

beforeEach(async () => {
  fetchMock.mockReset();
  await cleanupDemos();
});

let demoCounter = 0;
function mockFirebaseSignUp(): string {
  demoCounter += 1;
  const localId = `${tag}-fb-${demoCounter}`;
  fetchMock.mockImplementationOnce(async (url: string) => {
    expect(String(url)).toContain("accounts:signUp");
    return new Response(JSON.stringify({ localId }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return localId;
}

describe("admin demo profiles router", () => {
  it("GET returns an empty list and the full availableRoleKinds", async () => {
    const res = await request(app)
      .get("/api/admin/demo-profiles")
      .set("x-test-user", adminA);
    expect(res.status).toBe(200);
    expect(res.body.profiles).toEqual([]);
    expect(res.body.availableRoleKinds).toEqual([
      "trade_pro",
      "home",
      "facilities",
      "trade_pro_teammate",
      "facilities_teammate",
      "trade_pro_collab",
      "facilities_collab",
      // Bare-baseline option used by the wardrobe's "Stitch a new
      // avatar" button — creates a demo with only the collab baseline
      // and routes the admin through the regular signup gauntlet.
      "collab",
    ]);
  });

  it("rejects non-admin callers with 401", async () => {
    const res = await request(app)
      .get("/api/admin/demo-profiles")
      .set("x-test-user", memberC);
    expect(res.status).toBe(401);
  });

  it("POST provisions a demo user (Firebase mocked) and returns the profile", async () => {
    const expectedUid = mockFirebaseSignUp();
    const res = await request(app)
      .post("/api/admin/demo-profiles")
      .set("x-test-user", adminA)
      .send({ roleKind: "trade_pro", displayName: "Demo Pro" });
    expect(res.status).toBe(201);
    expect(res.body.demoClerkId).toBe(expectedUid);
    expect(res.body.roleKind).toBe("trade_pro");
    expect(res.body.displayName).toBe("Demo Pro");
    expect(res.body.outwardAccountKind).toBe("trade_pro");
    expect(typeof res.body.outwardAccountId).toBe("number");
    expect(res.body.demoUsername).toMatch(/^demo-trade-pro-/);

    // Side-effects in DB — demo creation now mirrors the production
    // sign-up flow, so the demo user should end up with the same row
    // shape a real account would have after onboarding:
    //   * users row stamped identity-complete + active-mode/account ids
    //   * collab baseline user_mode + outward_account
    //   * the requested kind's user_mode + outward_account (linked as active)
    const [userRow] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, expectedUid));
    expect(userRow).toBeTruthy();
    // #638 — A freshly-created demo no longer has identityCompletedAt
    // pre-stamped. The admin walks through the real identity screen
    // (set username + avatar) the first time they "wear" it, exactly
    // like a brand-new real user.
    expect(userRow.identityCompletedAt).toBeNull();
    expect(userRow.lastActiveModeId).not.toBeNull();
    expect(userRow.activeOutwardAccountId).not.toBeNull();

    const oas = await db
      .select()
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.ownerClerkId, expectedUid));
    const tradeOa = oas.find((r) => r.kind === "trade_pro");
    const collabOa = oas.find((r) => r.kind === "collab");
    expect(tradeOa).toBeTruthy();
    expect(collabOa).toBeTruthy();
    expect(userRow.activeOutwardAccountId).toBe(tradeOa!.id);

    const modes = await db
      .select()
      .from(userModesTable)
      .where(eq(userModesTable.userClerkId, expectedUid));
    const tradeMode = modes.find((m) => m.kind === "trade_pro");
    const collabMode = modes.find((m) => m.kind === "collab");
    expect(tradeMode).toBeTruthy();
    expect(collabMode).toBeTruthy();
    expect(userRow.lastActiveModeId).toBe(tradeMode!.id);
    // Intake seed mirrors POST /users/me/modes (displayName/ownerName
    // for trade_pro inherited from the user's name).
    expect((tradeMode!.intakeData as Record<string, unknown>).displayName).toBe(
      "Demo Pro",
    );
    expect((tradeMode!.intakeData as Record<string, unknown>).ownerName).toBe(
      "Demo Pro",
    );

    const [profile] = await db
      .select()
      .from(adminDemoProfilesTable)
      .where(eq(adminDemoProfilesTable.demoClerkId, expectedUid));
    expect(profile.demoPassword?.length).toBeGreaterThan(0);
    expect(profile.adminClerkId).toBe(adminA);
  });

  it("POST with empty body creates a bare-baseline demo (collab kind, placeholder name)", async () => {
    // Mirrors the wardrobe's "Stitch a new avatar" button, which fires
    // an empty POST so the admin lands at /(onboarding)/identity and
    // walks through the regular signup gauntlet AS the demo. The
    // resulting account should match a brand-new real user: only the
    // collab baseline mode + outward account, identityCompletedAt
    // null, placeholder display name on the wardrobe row.
    const expectedUid = mockFirebaseSignUp();
    const res = await request(app)
      .post("/api/admin/demo-profiles")
      .set("x-test-user", adminA)
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.demoClerkId).toBe(expectedUid);
    expect(res.body.roleKind).toBe("collab");
    expect(res.body.displayName).toBe("New Avatar");
    expect(res.body.outwardAccountKind).toBe("collab");

    const [userRow] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, expectedUid));
    expect(userRow.identityCompletedAt).toBeNull();

    const modes = await db
      .select()
      .from(userModesTable)
      .where(eq(userModesTable.userClerkId, expectedUid));
    expect(modes.map((m) => m.kind)).toEqual(["collab"]);

    const oas = await db
      .select()
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.ownerClerkId, expectedUid));
    expect(oas.map((o) => o.kind)).toEqual(["collab"]);
  });

  it("POST for a teammate kind auto-seeds the parent kind so production validation passes", async () => {
    const expectedUid = mockFirebaseSignUp();
    const res = await request(app)
      .post("/api/admin/demo-profiles")
      .set("x-test-user", adminA)
      .send({ roleKind: "trade_pro_teammate", displayName: "Demo Teammate" });
    expect(res.status).toBe(201);
    // Production's `POST /users/me/modes` rejects a teammate kind
    // unless the user already owns the matching parent kind (#614).
    // The demo route routes through that same validation, so it
    // auto-seeds the parent kind first to keep the demo account
    // representative of a real "owner who also has a teammate seat"
    // user shape rather than bypassing the rule.
    const modes = await db
      .select()
      .from(userModesTable)
      .where(eq(userModesTable.userClerkId, expectedUid));
    expect(modes.map((m) => m.kind).sort()).toEqual(
      ["collab", "trade_pro", "trade_pro_teammate"].sort(),
    );

    // The teammate kind is the user's last active mode — that's what
    // the wardrobe is creating, so it should be the one the admin
    // walks into when stepping onto this skin.
    const [userRow] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, expectedUid));
    const teammateMode = modes.find((m) => m.kind === "trade_pro_teammate");
    expect(userRow.lastActiveModeId).toBe(teammateMode!.id);

    // Outward accounts: production's `POST /users/me/modes` does NOT
    // create an outward_accounts row — that's a separate step the user
    // takes via `POST /outward-accounts`. The demo route mirrors that:
    // it only seeds an OA for the explicitly requested owner-facing
    // role kind. A teammate request neither creates a teammate OA
    // (teammates ride the collab baseline) nor a parent OA (the
    // auto-seeded parent mode is just a mode, not a fully-built-out
    // business). So we expect only the collab baseline OA.
    const oas = await db
      .select()
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.ownerClerkId, expectedUid));
    expect(oas.map((o) => o.kind)).toEqual(["collab"]);
  });

  it("POST duplicate role_kind for same admin succeeds — multiple demos per kind allowed", async () => {
    // The unique index on (admin_clerk_id, role_kind) was dropped so
    // an admin can create as many Facilities (or Trade Pro, etc) demos
    // as they want and step into each one through the regular
    // onboarding gauntlet. Each create gets its own Firebase identity
    // (the email carries a per-create suffix) so we expect a fresh
    // signUp call for each POST.
    mockFirebaseSignUp();
    const first = await request(app)
      .post("/api/admin/demo-profiles")
      .set("x-test-user", adminA)
      .send({ roleKind: "facilities", displayName: "Dup Facilities" });
    expect(first.status).toBe(201);

    mockFirebaseSignUp();
    const second = await request(app)
      .post("/api/admin/demo-profiles")
      .set("x-test-user", adminA)
      .send({ roleKind: "facilities", displayName: "Dup Facilities Again" });
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const rows = await db
      .select()
      .from(adminDemoProfilesTable)
      .where(eq(adminDemoProfilesTable.adminClerkId, adminA));
    expect(rows.filter((r) => r.roleKind === "facilities")).toHaveLength(2);
  });

  it("DELETE cascades outward_accounts + users + admin_demo_profiles", async () => {
    const uid = mockFirebaseSignUp();
    const created = await request(app)
      .post("/api/admin/demo-profiles")
      .set("x-test-user", adminA)
      .send({ roleKind: "home", displayName: "Demo Home" });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const del = await request(app)
      .delete(`/api/admin/demo-profiles/${id}`)
      .set("x-test-user", adminA);
    expect(del.status).toBe(204);

    const remainingProfile = await db
      .select()
      .from(adminDemoProfilesTable)
      .where(eq(adminDemoProfilesTable.id, id));
    expect(remainingProfile).toEqual([]);
    const remainingUser = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkId, uid));
    expect(remainingUser).toEqual([]);
    const remainingOa = await db
      .select()
      .from(outwardAccountsTable)
      .where(eq(outwardAccountsTable.ownerClerkId, uid));
    expect(remainingOa).toEqual([]);
  });

  it("DELETE another admin's profile returns 404", async () => {
    mockFirebaseSignUp();
    const created = await request(app)
      .post("/api/admin/demo-profiles")
      .set("x-test-user", adminA)
      .send({ roleKind: "trade_pro_teammate", displayName: "Demo Teammate" });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const del = await request(app)
      .delete(`/api/admin/demo-profiles/${id}`)
      .set("x-test-user", adminB);
    expect(del.status).toBe(404);

    // The row is still present.
    const [row] = await db
      .select()
      .from(adminDemoProfilesTable)
      .where(eq(adminDemoProfilesTable.id, id));
    expect(row).toBeTruthy();
  });
});
