/**
 * End-to-end test for per-photo deletion from a work log.
 *
 * Covers task #144: "Test deleting one photo from a work log end-to-end".
 *
 * What this test exercises:
 *   - The single-photo delete path (DELETE /api/logs/:logId/attachments?path=...)
 *     used by the photo viewer's trash button after the 5-second client-side
 *     undo timer expires.
 *   - Both author and admin permission paths (member who is the log's author,
 *     and member with the "admin" role on the property).
 *   - Verification that the parent work log row is preserved and that any
 *     sibling photos on the same log are preserved.
 *   - The undo timer itself lives entirely on the client (see
 *     `requestDeletePhoto`/`undoPhotoDelete` in
 *     `artifacts/round-house/app/property/[id].tsx`): the API call is simply
 *     deferred for ~5 seconds and never fired if the user taps Undo. From the
 *     server's perspective, "undo" is just "no DELETE call was made", which
 *     this test asserts by confirming that without invoking the endpoint the
 *     attachments and photoUrl remain intact.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";

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

vi.mock("../../lib/objectStorage", () => {
  return {
    ObjectStorageService: class {
      normalizeObjectEntityPath(p: string) {
        return p;
      }
      async deleteObjectEntity(_p: string) {
        /* no-op for tests */
      }
    },
  };
});

vi.mock("../../lib/objectAccess", () => ({
  assertCallerOwnsUploads: async () => {},
}));

vi.mock("../../lib/push", () => ({
  sendPushToUser: vi.fn(),
  sendPushToUsers: vi.fn(),
}));

vi.mock("../../lib/notificationPrefs", () => ({
  filterRecipientsByPref: async (ids: string[]) => ids,
  shouldNotify: async () => false,
}));

const {
  db,
  workLogsTable,
  propertiesTable,
  outwardAccountsTable,
  usersTable,
} = await import("@workspace/db");
const { upsertPropertyMembership, purgeEntityForProperty } = await import(
  "../../lib/migratePropertyEntities"
);

async function ensureSkin(clerkId: string): Promise<number> {
  const [existing] = await db
    .select({ id: outwardAccountsTable.id })
    .from(outwardAccountsTable)
    .where(eq(outwardAccountsTable.ownerClerkId, clerkId))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(outwardAccountsTable)
    .values({ ownerClerkId: clerkId, kind: "home", title: clerkId })
    .returning({ id: outwardAccountsTable.id });
  return created.id;
}
const logsRouter = (await import("../logs")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", logsRouter);
  return app;
}

const tag = `t144-${Date.now()}`;
const ids = {
  owner: `${tag}-owner`,
  author: `${tag}-author`,
  admin: `${tag}-admin`,
  member: `${tag}-member`,
  stranger: `${tag}-stranger`,
};

const PRIMARY = "/test-objects/primary.jpg";
const SIBLING_A = "/test-objects/sibling-a.jpg";
const SIBLING_B = "/test-objects/sibling-b.jpg";

let propertyId: number;
let app: Express;

async function seedUsers() {
  await db
    .insert(usersTable)
    .values(
      Object.entries(ids).map(([role, clerkId]) => ({
        clerkId,
        email: `${clerkId}@example.test`,
        name: role,
        username: clerkId,
      })),
    )
    .onConflictDoNothing();
}

async function seedProperty() {
  const [p] = await db
    .insert(propertiesTable)
    .values({
      name: `${tag}-property`,
      address: "1 Test Way",
      type: "home",
      ownerClerkId: ids.owner,
    })
    .returning();
  propertyId = p.id;
  for (const m of [
    { clerkId: ids.owner, role: "owner" as const },
    { clerkId: ids.author, role: "member" as const },
    { clerkId: ids.admin, role: "admin" as const },
    { clerkId: ids.member, role: "member" as const },
  ]) {
    const skinId = await ensureSkin(m.clerkId);
    await upsertPropertyMembership({
      propertyId,
      userClerkId: m.clerkId,
      userOutwardAccountId: skinId,
      role: m.role,
    });
  }
}

async function seedLogWithThreePhotos(authorClerkId: string) {
  const nowIso = new Date().toISOString();
  const [log] = await db
    .insert(workLogsTable)
    .values({
      propertyId,
      authorClerkId,
      note: "test log with three photos",
      photoUrl: PRIMARY,
      attachments: [
        { path: SIBLING_A, kind: "image", addedAt: nowIso, addedByClerkId: authorClerkId },
        { path: SIBLING_B, kind: "image", addedAt: nowIso, addedByClerkId: authorClerkId },
      ],
      isRealTime: true,
    })
    .returning();
  return log;
}

async function readLog(logId: number) {
  const [row] = await db.select().from(workLogsTable).where(eq(workLogsTable.id, logId));
  return row;
}

beforeAll(async () => {
  app = makeApp();
  await seedUsers();
  await seedProperty();
});

afterAll(async () => {
  // Clean up everything we inserted under this test tag.
  await db.delete(workLogsTable).where(eq(workLogsTable.propertyId, propertyId));
  await purgeEntityForProperty(propertyId);
  await db.delete(propertiesTable).where(eq(propertiesTable.id, propertyId));
  for (const clerkId of Object.values(ids)) {
    await db
      .delete(outwardAccountsTable)
      .where(eq(outwardAccountsTable.ownerClerkId, clerkId));
    await db.delete(usersTable).where(eq(usersTable.clerkId, clerkId));
  }
});

describe("DELETE /api/logs/:logId/attachments — single-photo delete", () => {
  let logId: number;

  beforeEach(async () => {
    const log = await seedLogWithThreePhotos(ids.author);
    logId = log.id;
  });

  it("simulating the undo path: if the endpoint is never called, the log keeps every photo", async () => {
    // The 5-second undo timer is a purely client-side defer. When the user
    // taps Undo, the request is cancelled before it fires. We assert here that
    // the server state matches what the user would see after Undo.
    const before = await readLog(logId);
    expect(before.photoUrl).toBe(PRIMARY);
    expect((before.attachments ?? []).map((a) => a.path)).toEqual([SIBLING_A, SIBLING_B]);
  });

  it("when the timer expires, the author can delete a sibling attachment without affecting the log or the other photos", async () => {
    const res = await request(app)
      .delete(`/api/logs/${logId}/attachments`)
      .query({ path: SIBLING_A })
      .set("x-test-user", ids.author);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(logId);
    expect(res.body.photoUrl).toBe(PRIMARY);
    expect((res.body.attachments ?? []).map((a: { path: string }) => a.path)).toEqual([SIBLING_B]);

    const after = await readLog(logId);
    expect(after).toBeDefined();
    expect(after.note).toBe("test log with three photos");
    expect(after.photoUrl).toBe(PRIMARY);
    expect((after.attachments ?? []).map((a) => a.path)).toEqual([SIBLING_B]);
  });

  it("an admin (non-author) can also delete a single photo, leaving the log and remaining photos intact", async () => {
    const res = await request(app)
      .delete(`/api/logs/${logId}/attachments`)
      .query({ path: SIBLING_B })
      .set("x-test-user", ids.admin);

    expect(res.status).toBe(200);
    expect(res.body.photoUrl).toBe(PRIMARY);
    expect((res.body.attachments ?? []).map((a: { path: string }) => a.path)).toEqual([SIBLING_A]);

    const after = await readLog(logId);
    expect(after).toBeDefined();
    expect(after.photoUrl).toBe(PRIMARY);
    expect((after.attachments ?? []).map((a) => a.path)).toEqual([SIBLING_A]);
  });

  it("deleting the primary photo clears photoUrl but preserves both sibling attachments and the log itself", async () => {
    const res = await request(app)
      .delete(`/api/logs/${logId}/attachments`)
      .query({ path: PRIMARY })
      .set("x-test-user", ids.author);

    expect(res.status).toBe(200);
    expect(res.body.photoUrl).toBeNull();
    expect((res.body.attachments ?? []).map((a: { path: string }) => a.path)).toEqual([
      SIBLING_A,
      SIBLING_B,
    ]);

    const after = await readLog(logId);
    expect(after).toBeDefined();
    expect(after.photoUrl).toBeNull();
    expect((after.attachments ?? []).map((a) => a.path)).toEqual([SIBLING_A, SIBLING_B]);
  });

  it("a regular member who is neither the author nor an admin cannot delete a photo (403) and the log is unchanged", async () => {
    const res = await request(app)
      .delete(`/api/logs/${logId}/attachments`)
      .query({ path: SIBLING_A })
      .set("x-test-user", ids.member);

    expect(res.status).toBe(403);

    const after = await readLog(logId);
    expect(after.photoUrl).toBe(PRIMARY);
    expect((after.attachments ?? []).map((a) => a.path)).toEqual([SIBLING_A, SIBLING_B]);
  });

  it("a non-member cannot delete a photo (403) and the log is unchanged", async () => {
    const res = await request(app)
      .delete(`/api/logs/${logId}/attachments`)
      .query({ path: SIBLING_A })
      .set("x-test-user", ids.stranger);

    expect(res.status).toBe(403);

    const after = await readLog(logId);
    expect(after.photoUrl).toBe(PRIMARY);
    expect((after.attachments ?? []).map((a) => a.path)).toEqual([SIBLING_A, SIBLING_B]);
  });

  it("attempting to delete a path that's not on the log returns 404 and leaves it intact", async () => {
    const res = await request(app)
      .delete(`/api/logs/${logId}/attachments`)
      .query({ path: "/test-objects/not-on-this-log.jpg" })
      .set("x-test-user", ids.author);

    expect(res.status).toBe(404);

    const after = await readLog(logId);
    expect(after.photoUrl).toBe(PRIMARY);
    expect((after.attachments ?? []).map((a) => a.path)).toEqual([SIBLING_A, SIBLING_B]);
  });
});
