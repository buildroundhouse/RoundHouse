/**
 * End-to-end test for task #161:
 * "Test the work-order row photo preview opens with no spinner"
 *
 * What this test exercises:
 *   The camera-hint badge on an assigned work-order row in My Jobs
 *   (artifacts/round-house/components/MyJobsView.tsx :: previewWorkOrderPhotos)
 *   opens the photo viewer directly from data already on the
 *   GET /api/work-orders/mine response. There is no follow-up fetch and no
 *   loading spinner: the viewer is constructed synchronously from the row
 *   payload, including each photo's URL plus the latest comment's author
 *   name and creation timestamp shown as the in-viewer annotation.
 *
 * What "no extra round-trip / no spinner" means at the API contract level:
 *   The /work-orders/mine response MUST already include, on each row:
 *     - latestCommentHasPhoto: boolean
 *     - latestCommentPhotoCount: number
 *     - latestCommentPhotoPath: string | null  (first photo, used by the badge thumb)
 *     - latestCommentPhotoPaths: string[]      (every photo, opened in the viewer)
 *     - latestCommentAuthorName: string | null (annotation author)
 *     - latestCommentCreatedAt: string | null  (annotation timestamp, ISO)
 *
 *   If any of these go missing the client falls back to fetching them on tap,
 *   which reintroduces the spinner this task is meant to lock out — and these
 *   assertions will fail.
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

vi.mock("../../lib/objectStorage", () => {
  return {
    ObjectStorageService: class {
      normalizeObjectEntityPath(p: string) {
        return p;
      }
      async deleteObjectEntity(_p: string) {
        /* no-op */
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
  workOrdersTable,
  workOrderCommentsTable,
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
const workOrdersRouter = (await import("../work-orders")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", workOrdersRouter);
  return app;
}

const tag = `t161-${Date.now()}`;
const ids = {
  owner: `${tag}-owner`,
  assignee: `${tag}-assignee`,
  commenter: `${tag}-commenter`,
};

const OLDER_PHOTO = "/test-objects/t161-older.jpg";
const LATEST_PHOTO_A = "/test-objects/t161-latest-a.jpg";
const LATEST_PHOTO_B = "/test-objects/t161-latest-b.jpg";
const LATEST_PHOTO_C = "/test-objects/t161-latest-c.jpg";

let propertyId: number;
let workOrderId: number;
let app: Express;

beforeAll(async () => {
  app = makeApp();

  await db
    .insert(usersTable)
    .values([
      { clerkId: ids.owner, email: `${ids.owner}@example.test`, name: "Owner Person", username: ids.owner },
      { clerkId: ids.assignee, email: `${ids.assignee}@example.test`, name: "Assignee Person", username: ids.assignee },
      { clerkId: ids.commenter, email: `${ids.commenter}@example.test`, name: "Commenter Person", username: ids.commenter },
    ])
    .onConflictDoNothing();

  const [p] = await db
    .insert(propertiesTable)
    .values({
      name: `${tag}-property`,
      address: "1 Photo Lane",
      type: "home",
      ownerClerkId: ids.owner,
    })
    .returning();
  propertyId = p.id;

  for (const m of [
    { clerkId: ids.owner, role: "owner" as const },
    { clerkId: ids.assignee, role: "member" as const },
    { clerkId: ids.commenter, role: "member" as const },
  ]) {
    const skinId = await ensureSkin(m.clerkId);
    await upsertPropertyMembership({
      propertyId,
      userClerkId: m.clerkId,
      userOutwardAccountId: skinId,
      role: m.role,
    });
  }

  const [wo] = await db
    .insert(workOrdersTable)
    .values({
      propertyId,
      title: `${tag} fix the thing`,
      description: "",
      status: "assigned",
      assigneeClerkId: ids.assignee,
      createdByClerkId: ids.owner,
    })
    .returning();
  workOrderId = wo.id;

  // Seed two comments. The OLDER one has a photo that must NOT show up in the
  // viewer (only the newest comment's photos are previewed), the NEWER one has
  // three photos which all should show up — that's the multi-photo viewer
  // case the task locks in.
  const olderTime = new Date(Date.now() - 60 * 60 * 1000);
  const newerTime = new Date();

  await db.insert(workOrderCommentsTable).values([
    {
      workOrderId,
      authorClerkId: ids.owner,
      body: "older comment with one photo (should be ignored by the badge)",
      attachments: [
        { path: OLDER_PHOTO, kind: "image", addedAt: olderTime.toISOString(), addedByClerkId: ids.owner },
      ],
      createdAt: olderTime,
      updatedAt: olderTime,
    },
    {
      workOrderId,
      authorClerkId: ids.commenter,
      body: "latest comment with three photos",
      attachments: [
        { path: LATEST_PHOTO_A, kind: "image", addedAt: newerTime.toISOString(), addedByClerkId: ids.commenter },
        { path: LATEST_PHOTO_B, kind: "image", addedAt: newerTime.toISOString(), addedByClerkId: ids.commenter },
        { path: LATEST_PHOTO_C, kind: "image", addedAt: newerTime.toISOString(), addedByClerkId: ids.commenter },
      ],
      createdAt: newerTime,
      updatedAt: newerTime,
    },
  ]);
});

afterAll(async () => {
  await db.delete(workOrderCommentsTable).where(eq(workOrderCommentsTable.workOrderId, workOrderId));
  await db.delete(workOrdersTable).where(eq(workOrdersTable.id, workOrderId));
  await purgeEntityForProperty(propertyId);
  await db.delete(propertiesTable).where(eq(propertiesTable.id, propertyId));
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, Object.values(ids)));
  await db
    .delete(usersTable)
    .where(inArray(usersTable.clerkId, Object.values(ids)));
});

/**
 * Mirror of the inline `previewWorkOrderPhotos` reducer in MyJobsView.tsx.
 * It builds the viewer payload purely from a /work-orders/mine row — no
 * network, no async work — and that is what makes the preview open with
 * no spinner. We replicate it here so the test fails the moment the row
 * payload is no longer self-sufficient (e.g. paths drop off, author name
 * goes missing) and the client would have to refetch.
 */
function buildViewerPayloadFromRow(row: any) {
  const paths: string[] =
    row.latestCommentPhotoPaths ??
    (row.latestCommentPhotoPath ? [row.latestCommentPhotoPath] : []);
  const addedAt: string | undefined = row.latestCommentCreatedAt ?? undefined;
  const addedByName: string | undefined = row.latestCommentAuthorName ?? undefined;
  return paths.map((path) => ({ path, addedAt, addedByName }));
}

describe("GET /api/work-orders/mine — photo preview opens with no spinner (task #161)", () => {
  it("rejects unauthenticated callers (sanity check on the test harness)", async () => {
    const res = await request(app).get("/api/work-orders/mine");
    expect(res.status).toBe(401);
  });

  it("returns the assigned work-order row with every field the photo viewer needs, taken from the LATEST comment only", async () => {
    const res = await request(app)
      .get("/api/work-orders/mine")
      .set("x-test-user", ids.assignee);

    expect(res.status).toBe(200);
    const row = (res.body.workOrders ?? []).find((w: any) => w.id === workOrderId);
    expect(row).toBeDefined();

    // The badge / viewer reads these fields directly. If any disappear the
    // client would have to fetch them on tap (spinner!), so we lock them in.
    expect(row.latestCommentHasPhoto).toBe(true);
    expect(row.latestCommentPhotoCount).toBe(3);
    expect(row.latestCommentPhotoPath).toBe(LATEST_PHOTO_A);
    expect(row.latestCommentPhotoPaths).toEqual([
      LATEST_PHOTO_A,
      LATEST_PHOTO_B,
      LATEST_PHOTO_C,
    ]);
    // Older comment's photo must NOT leak into the badge / viewer payload.
    expect(row.latestCommentPhotoPaths).not.toContain(OLDER_PHOTO);

    // Annotation shown inside the viewer ("by Commenter Person · <time>").
    expect(row.latestCommentAuthorName).toBe("Commenter Person");
    expect(typeof row.latestCommentCreatedAt).toBe("string");
    expect(() => new Date(row.latestCommentCreatedAt!).toISOString()).not.toThrow();
  });

  it("the viewer payload can be built synchronously from the row alone — no extra fetch, no spinner state", async () => {
    const res = await request(app)
      .get("/api/work-orders/mine")
      .set("x-test-user", ids.assignee);

    expect(res.status).toBe(200);
    const row = (res.body.workOrders ?? []).find((w: any) => w.id === workOrderId);
    expect(row).toBeDefined();

    const items = buildViewerPayloadFromRow(row);

    // All three latest-comment photos open in the viewer.
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.path)).toEqual([
      LATEST_PHOTO_A,
      LATEST_PHOTO_B,
      LATEST_PHOTO_C,
    ]);

    // Each photo carries the same author/time annotation, sourced from the row.
    for (const item of items) {
      expect(item.addedByName).toBe("Commenter Person");
      expect(item.addedAt).toBe(row.latestCommentCreatedAt);
    }
  });
});
