/**
 * #671 — `GET /api/users/:userId?outwardAccountId=...` must surface the
 * picked operator skin's public face on the public-profile response so
 * PublicProfileModal can render a header chip identifying the company /
 * role the visitor is connecting to (instead of falling back to the
 * owner's collab persona). Behavior covered:
 *
 *   1. When `outwardAccountId` matches an active OA owned by the target
 *      user, the response includes `counterpartOutwardAccount` with
 *      `{ id, kind, title, displayName, companyName }`.
 *   2. Without the param, `counterpartOutwardAccount` is null (legacy
 *      callers / collab baseline behavior is preserved).
 *   3. An OA id that exists but is owned by someone else returns null
 *      (no foreign-OA probing through this endpoint).
 *   4. An archived OA id returns null (archived skins are not surfaced).
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

const { db, usersTable, outwardAccountsTable } = await import("@workspace/db");
const usersRouter = (await import("../users")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  return app;
}

const tag = `t671-${Date.now()}`;
const callerClerk = `${tag}-caller`;
const targetClerk = `${tag}-target`;
const otherClerk = `${tag}-other`;

let app: Express;
let gameRoomOAId: number;
let archivedOAId: number;
let otherUsersOAId: number;

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
      clerkId: targetClerk,
      email: `${tag}-target@example.test`,
      name: "Owner Name",
      username: `target_${tag}`,
    },
    {
      clerkId: otherClerk,
      email: `${tag}-other@example.test`,
      name: "Some One Else",
      username: `other_${tag}`,
    },
  ]);

  const targetOAs = await db
    .insert(outwardAccountsTable)
    .values([
      {
        ownerClerkId: targetClerk,
        kind: "facilities",
        companyName: `Gameop Game Room ${tag}`,
      },
      {
        ownerClerkId: targetClerk,
        kind: "facilities",
        companyName: `Gameop Archived ${tag}`,
        archivedAt: new Date(),
      },
    ])
    .returning();
  gameRoomOAId = targetOAs[0].id;
  archivedOAId = targetOAs[1].id;

  const otherOAs = await db
    .insert(outwardAccountsTable)
    .values([
      {
        ownerClerkId: otherClerk,
        kind: "trade_pro",
        companyName: `Some Other Co ${tag}`,
      },
    ])
    .returning();
  otherUsersOAId = otherOAs[0].id;
});

afterAll(async () => {
  const clerkIds = [callerClerk, targetClerk, otherClerk];
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, clerkIds));
});

describe("/api/users/:userId counterpartOutwardAccount (#671)", () => {
  it("returns the picked skin's public face when outwardAccountId is provided and valid", async () => {
    const res = await request(app)
      .get(`/api/users/${targetClerk}?outwardAccountId=${gameRoomOAId}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    expect(res.body.counterpartOutwardAccount).toEqual({
      id: gameRoomOAId,
      kind: "facilities",
      title: null,
      displayName: null,
      companyName: `Gameop Game Room ${tag}`,
    });
  });

  it("returns null counterpartOutwardAccount when no outwardAccountId is provided", async () => {
    const res = await request(app)
      .get(`/api/users/${targetClerk}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    expect(res.body.counterpartOutwardAccount).toBeNull();
  });

  it("returns null when outwardAccountId belongs to a different user (no foreign-OA probing)", async () => {
    const res = await request(app)
      .get(`/api/users/${targetClerk}?outwardAccountId=${otherUsersOAId}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    expect(res.body.counterpartOutwardAccount).toBeNull();
  });

  it("returns null when the requested outward account is archived", async () => {
    const res = await request(app)
      .get(`/api/users/${targetClerk}?outwardAccountId=${archivedOAId}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    expect(res.body.counterpartOutwardAccount).toBeNull();
  });

  it("ignores garbage outwardAccountId values without erroring", async () => {
    const res = await request(app)
      .get(`/api/users/${targetClerk}?outwardAccountId=not-a-number`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    expect(res.body.counterpartOutwardAccount).toBeNull();
  });
});
