/**
 * #638 / #636 — Regression: a demo profile created from the Admin Hub
 * lives as an ordinary `users` row but must NOT leak into the public
 * Finder for real users.
 *
 * Historical context: an earlier version of this test also exercised
 * the avatar-to-avatar team-up / connect flow against a demo. That
 * pipeline (`POST /users/:userId/connect`,
 * `POST /users/:userId/team-up/respond`, the `system_connected` /
 * `team_up_note` anchors) was retired by #663's switch to the
 * entity-only connection model — those endpoints now return 410 Gone
 * — so the only post-#663 invariant left is the search-visibility
 * one: demos are hidden from Finder. The Admin Hub still owns the
 * inverse path of "step into the demo and operate as it".
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
} from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { and, eq, inArray, or } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  tryAttachAuth: async (req: any) => {
    const uid = req.headers["x-test-user"];
    if (uid) req.userId = String(uid);
  },
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
  userConnectionsTable,
  userModesTable,
  usersTable,
  messagesTable,
} = await import("@workspace/db");

const adminDemoProfilesRouter = (await import("../admin-demo-profiles"))
  .default;
const usersRouter = (await import("../users")).default;
const messagesRouter = (await import("../messages")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", adminDemoProfilesRouter);
  app.use("/api", usersRouter);
  app.use("/api", messagesRouter);
  return app;
}

const tag = `t638-${Date.now()}`;
const adminClerk = `${tag}-admin`;
const realClerk = `${tag}-real`;

let app: Express;
const fetchMock = vi.fn();
const originalFetch = globalThis.fetch;
const originalApiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY;

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

async function nukeDemoUser(clerkId: string): Promise<void> {
  const oas = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(eq(outwardAccountsTable.ownerClerkId, clerkId));
  const oaIds = oas.map((r) => r.id);
  if (oaIds.length > 0) {
    await db
      .delete(userConnectionsTable)
      .where(
        or(
          inArray(userConnectionsTable.fromOutwardAccountId, oaIds),
          inArray(userConnectionsTable.toOutwardAccountId, oaIds),
        ),
      );
  }
  await db
    .delete(messagesTable)
    .where(eq(messagesTable.senderClerkId, clerkId));
  await db
    .update(usersTable)
    .set({ activeOutwardAccountId: null, lastActiveModeId: null })
    .where(eq(usersTable.clerkId, clerkId));
  await db
    .delete(outwardAccountsTable)
    .where(eq(outwardAccountsTable.ownerClerkId, clerkId));
  await db
    .delete(userModesTable)
    .where(eq(userModesTable.userClerkId, clerkId));
  await db
    .delete(adminDemoProfilesTable)
    .where(eq(adminDemoProfilesTable.demoClerkId, clerkId));
  await db.delete(usersTable).where(eq(usersTable.clerkId, clerkId));
}

beforeAll(async () => {
  app = makeApp();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  process.env.EXPO_PUBLIC_FIREBASE_API_KEY = "test-fb-key";
  adminAllowlist.add(adminClerk);

  await db.insert(usersTable).values([
    {
      clerkId: adminClerk,
      email: `${tag}-admin@example.test`,
      name: "Admin Person",
      username: `admin_${tag}`,
      isAdmin: true,
    },
    {
      clerkId: realClerk,
      email: `${tag}-real@example.test`,
      name: "Real Person",
      username: `real_${tag}`,
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
  // Snapshot every demo created under our tag so we can scrub the
  // downstream rows before nuking the admin/real users.
  const demoRows = await db
    .select({ demoClerkId: adminDemoProfilesTable.demoClerkId })
    .from(adminDemoProfilesTable)
    .where(eq(adminDemoProfilesTable.adminClerkId, adminClerk));
  for (const r of demoRows) await nukeDemoUser(r.demoClerkId);
  await nukeDemoUser(realClerk);
  await nukeDemoUser(adminClerk);
  adminAllowlist.clear();
  fetchMock.mockReset();
});

describe("#638 / #636 admin demo profiles stay out of public search", () => {
  it("admin-created demo personas are excluded from /api/users/search even when the query exactly matches the demo's auto-generated username", async () => {
    const expectedUid = mockFirebaseSignUp();
    const created = await request(app)
      .post("/api/admin/demo-profiles")
      .set("x-test-user", adminClerk)
      .send({ roleKind: "trade_pro", displayName: "Demo Pro 638" });
    expect(created.status).toBe(201);
    expect(created.body.demoClerkId).toBe(expectedUid);
    const demoUsername = created.body.demoUsername as string;
    const demoOutwardAccountId = created.body.outwardAccountId as number;
    expect(demoUsername).toMatch(/^demo-trade-pro-/);
    expect(typeof demoOutwardAccountId).toBe("number");

    // #636 — Demos must NOT surface in Finder. Search by the
    // auto-generated username from a regular signed-in user
    // returns zero rows for this clerkId, even though the demo
    // owns matching skins, because admin_demo_profiles entries are
    // filtered out at the query level via a LEFT JOIN + IS NULL.
    const search = await request(app)
      .get(`/api/users/search?q=${encodeURIComponent(demoUsername)}`)
      .set("x-test-user", realClerk);
    expect(search.status).toBe(200);
    const demoHits = (search.body.users as Array<Record<string, unknown>>)
      .filter((u) => u.clerkId === expectedUid);
    expect(demoHits).toHaveLength(0);
  });
});
