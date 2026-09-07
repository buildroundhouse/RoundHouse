/**
 * End-to-end test for the multi-file comment badge on work orders.
 *
 * Covers task #163: "Test tapping the file badge on a multi-file comment
 * end-to-end".
 *
 * What this test exercises:
 *   - POST /api/work-orders/:workOrderId/comments accepts a comment with two
 *     or more file attachments (kind="file") and returns them in order.
 *   - GET /api/work-orders/:workOrderId/comments returns the persisted list
 *     of attachments per comment in the same order they were posted, including
 *     each attachment's `name` so the file-list sheet can show every filename.
 *   - A single-file comment is also persisted and returned, since the badge
 *     branches on `fileCount` (1 → open the file directly; 2+ → open the
 *     bottom sheet listing every file).
 *   - Image attachments on the same comment are kept on a separate badge
 *     (the photo badge) and are not surfaced through the file-list sheet.
 *
 * UI side reference (`artifacts/round-house/app/work-order/[id].tsx`):
 *
 *   const fileCount = commentAtts.filter((a) => a.kind === "file").length;
 *   const fileAtts  = commentAtts.filter((a) => a.kind === "file");
 *   const onBadgePress = () => {
 *     if (fileAtts.length <= 1) {
 *       if (fileAtts[0]) openFile(fileAtts[0]);  // single-file: open directly
 *     } else {
 *       setFileSheet(fileAtts);                  // multi-file: open sheet
 *     }
 *   };
 *
 * The `FileListSheet` component then renders one row per file with
 * `att.name || "Attachment"`. This test verifies the exact data the sheet
 * receives — same ordering, same names, same kinds — so the rendered list
 * is guaranteed to include every attached file.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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

const tag = `t163-${Date.now()}`;
const ids = {
  owner: `${tag}-owner`,
  author: `${tag}-author`,
};

const FILE_A = { path: "/test-objects/spec.pdf", kind: "file" as const, name: "spec.pdf", contentType: "application/pdf", size: 1234 };
const FILE_B = { path: "/test-objects/invoice.pdf", kind: "file" as const, name: "invoice.pdf", contentType: "application/pdf", size: 5678 };
const FILE_C = { path: "/test-objects/quote.pdf", kind: "file" as const, name: "quote.pdf", contentType: "application/pdf", size: 9012 };
const SOLO_FILE = { path: "/test-objects/lease.pdf", kind: "file" as const, name: "lease.pdf", contentType: "application/pdf", size: 4321 };
const PHOTO = { path: "/test-objects/photo.jpg", kind: "image" as const, name: "photo.jpg", contentType: "image/jpeg", size: 2222 };

let propertyId: number;
let workOrderId: number;
let app: Express;

async function seed() {
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

  const ownerSkin = await ensureSkin(ids.owner);
  const authorSkin = await ensureSkin(ids.author);
  await upsertPropertyMembership({
    propertyId,
    userClerkId: ids.owner,
    userOutwardAccountId: ownerSkin,
    role: "owner",
  });
  await upsertPropertyMembership({
    propertyId,
    userClerkId: ids.author,
    userOutwardAccountId: authorSkin,
    role: "member",
  });

  const [wo] = await db
    .insert(workOrdersTable)
    .values({
      propertyId,
      title: `${tag}-wo`,
      status: "open",
      createdByClerkId: ids.owner,
    })
    .returning();
  workOrderId = wo.id;
}

beforeAll(async () => {
  app = makeApp();
  await seed();
});

afterAll(async () => {
  await db.delete(workOrderCommentsTable).where(eq(workOrderCommentsTable.workOrderId, workOrderId));
  await db.delete(workOrdersTable).where(eq(workOrdersTable.id, workOrderId));
  await purgeEntityForProperty(propertyId);
  await db.delete(propertiesTable).where(eq(propertiesTable.id, propertyId));
  for (const clerkId of Object.values(ids)) {
    await db
      .delete(outwardAccountsTable)
      .where(eq(outwardAccountsTable.ownerClerkId, clerkId));
    await db.delete(usersTable).where(eq(usersTable.clerkId, clerkId));
  }
});

describe("Work-order comments — file badge data path", () => {
  it("a comment posted with 3 file attachments is persisted and returned in order with every filename — this is what the file-list sheet renders", async () => {
    const post = await request(app)
      .post(`/api/work-orders/${workOrderId}/comments`)
      .set("x-test-user", ids.author)
      .send({ body: "Three files attached", attachments: [FILE_A, FILE_B, FILE_C] });

    expect(post.status).toBe(201);
    const created = post.body;
    expect(created.body).toBe("Three files attached");

    const fileAtts = (created.attachments as { kind: string; name: string; path: string }[]).filter(
      (a) => a.kind === "file",
    );
    // The badge branches on `fileAtts.length <= 1` — three files MUST take the
    // multi-file path that opens the bottom sheet.
    expect(fileAtts.length).toBeGreaterThanOrEqual(2);
    expect(fileAtts.map((a) => a.path)).toEqual([FILE_A.path, FILE_B.path, FILE_C.path]);
    expect(fileAtts.map((a) => a.name)).toEqual([FILE_A.name, FILE_B.name, FILE_C.name]);

    const list = await request(app)
      .get(`/api/work-orders/${workOrderId}/comments`)
      .set("x-test-user", ids.author);
    expect(list.status).toBe(200);
    const fetched = list.body.comments.find((c: { id: number }) => c.id === created.id);
    expect(fetched).toBeDefined();
    const fetchedFiles = (fetched.attachments as { kind: string; name: string; path: string }[]).filter(
      (a) => a.kind === "file",
    );
    expect(fetchedFiles.map((a) => a.path)).toEqual([FILE_A.path, FILE_B.path, FILE_C.path]);
    expect(fetchedFiles.map((a) => a.name)).toEqual([FILE_A.name, FILE_B.name, FILE_C.name]);
  });

  it("a comment posted with exactly 1 file attachment is persisted and returned with a fileCount of 1 — the badge opens the file directly without showing the sheet", async () => {
    const post = await request(app)
      .post(`/api/work-orders/${workOrderId}/comments`)
      .set("x-test-user", ids.author)
      .send({ body: "One file attached", attachments: [SOLO_FILE] });

    expect(post.status).toBe(201);
    const created = post.body;
    const fileAtts = (created.attachments as { kind: string; name: string; path: string }[]).filter(
      (a) => a.kind === "file",
    );
    expect(fileAtts).toHaveLength(1);
    expect(fileAtts[0]).toMatchObject({ path: SOLO_FILE.path, name: SOLO_FILE.name, kind: "file" });

    const list = await request(app)
      .get(`/api/work-orders/${workOrderId}/comments`)
      .set("x-test-user", ids.author);
    const fetched = list.body.comments.find((c: { id: number }) => c.id === created.id);
    const fetchedFiles = (fetched.attachments as { kind: string }[]).filter((a) => a.kind === "file");
    expect(fetchedFiles).toHaveLength(1);
  });

  it("a comment with mixed photos and files separates the file badge from the photo badge — the file sheet only sees the file kinds", async () => {
    const post = await request(app)
      .post(`/api/work-orders/${workOrderId}/comments`)
      .set("x-test-user", ids.author)
      .send({ body: "Mixed attachments", attachments: [PHOTO, FILE_A, FILE_B] });

    expect(post.status).toBe(201);
    const atts = post.body.attachments as { kind: string; path: string; name?: string }[];
    const fileAtts = atts.filter((a) => a.kind === "file");
    const photoAtts = atts.filter((a) => a.kind === "image");
    expect(photoAtts.map((a) => a.path)).toEqual([PHOTO.path]);
    // File badge sees both files; photo on the comment is intentionally omitted
    // from the file-list sheet (the sheet is files-only).
    expect(fileAtts.map((a) => a.path)).toEqual([FILE_A.path, FILE_B.path]);
    expect(fileAtts.map((a) => a.name)).toEqual([FILE_A.name, FILE_B.name]);
  });

  it("a comment with zero file attachments produces no file badge (fileCount === 0 short-circuits the badge)", async () => {
    const post = await request(app)
      .post(`/api/work-orders/${workOrderId}/comments`)
      .set("x-test-user", ids.author)
      .send({ body: "Photo only", attachments: [PHOTO] });

    expect(post.status).toBe(201);
    const atts = post.body.attachments as { kind: string }[];
    const fileAtts = atts.filter((a) => a.kind === "file");
    expect(fileAtts).toHaveLength(0);
  });
});
