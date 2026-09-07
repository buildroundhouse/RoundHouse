/**
 * #679 — When `GET /api/users/:userId?outwardAccountId=...` is called with
 * an OA that carries a `sourceUserModeId`, the public-profile response's
 * Work-snapshot fields (`activeModeKind` + `intakeSnapshot`) must be
 * sourced from THAT skin's intake — not from the owner's
 * `lastActiveModeId`. Otherwise PublicProfileModal would render the
 * picked skin's header chip ("Connecting to Gameop Game Room · Facility
 * Management") above a Work snapshot that still says "Trade Pro ·
 * Plumber" because that's the owner's currently-active mode.
 *
 * Cases covered:
 *   1. OA with `sourceUserModeId` set → snapshot reflects the OA's mode,
 *      not the owner's last-active mode.
 *   2. No `outwardAccountId` param → snapshot falls back to the owner's
 *      last-active mode (legacy behavior).
 *   3. OA with `sourceUserModeId = NULL` → snapshot falls back to the
 *      owner's last-active mode.
 *   4. OA owned by a different user (rejected by the owner-scoped
 *      lookup) → snapshot falls back to the owner's last-active mode.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";

vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = String(req.headers["x-test-user"] ?? "");
    next();
  },
}));

const { db, usersTable, userModesTable, outwardAccountsTable } = await import(
  "@workspace/db"
);
const usersRouter = (await import("../users")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  return app;
}

const tag = `t679-${Date.now()}`;
const callerClerk = `${tag}-caller`;
const targetClerk = `${tag}-target`;
const otherClerk = `${tag}-other`;

let app: Express;
let tradeModeId: number;
let facilitiesModeId: number;
let gameRoomOAId: number;
let unsourcedOAId: number;
let foreignOAId: number;
let foreignModeId: number;

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

  // Target's two intake-bearing modes. lastActiveModeId points at the
  // trade_pro one so we can prove the picked-OA path overrides it.
  const modes = await db
    .insert(userModesTable)
    .values([
      {
        userClerkId: targetClerk,
        kind: "trade_pro",
        intakeData: {
          companyName: `Plumber Co ${tag}`,
          trade: "plumber",
          region: "Northeast",
          primaryZip: "10001",
          additionalZips: ["10002"],
          experience: "10+ years",
        },
      },
      {
        userClerkId: targetClerk,
        kind: "facilities",
        intakeData: {
          companyName: `Gameop Game Room ${tag}`,
          operationKind: "game_room",
          maintenanceGoals: ["uptime"],
          teamSize: "5-10",
        },
      },
    ])
    .returning();
  tradeModeId = modes[0].id;
  facilitiesModeId = modes[1].id;

  await db
    .update(usersTable)
    .set({ lastActiveModeId: tradeModeId })
    .where(inArray(usersTable.clerkId, [targetClerk]));

  const targetOAs = await db
    .insert(outwardAccountsTable)
    .values([
      {
        ownerClerkId: targetClerk,
        kind: "facilities",
        companyName: `Gameop Game Room ${tag}`,
        sourceUserModeId: facilitiesModeId,
      },
      {
        ownerClerkId: targetClerk,
        kind: "facilities",
        companyName: `Unsourced Skin ${tag}`,
        sourceUserModeId: null,
      },
    ])
    .returning();
  gameRoomOAId = targetOAs[0].id;
  unsourcedOAId = targetOAs[1].id;

  const foreignModes = await db
    .insert(userModesTable)
    .values([
      {
        userClerkId: otherClerk,
        kind: "trade_pro",
        intakeData: { trade: "electrician", companyName: `Foreign ${tag}` },
      },
    ])
    .returning();
  foreignModeId = foreignModes[0].id;

  const foreignOAs = await db
    .insert(outwardAccountsTable)
    .values([
      {
        ownerClerkId: otherClerk,
        kind: "trade_pro",
        companyName: `Foreign Co ${tag}`,
        sourceUserModeId: foreignModeId,
      },
    ])
    .returning();
  foreignOAId = foreignOAs[0].id;
});

afterAll(async () => {
  const clerkIds = [callerClerk, targetClerk, otherClerk];
  await db
    .delete(outwardAccountsTable)
    .where(inArray(outwardAccountsTable.ownerClerkId, clerkIds));
  // Detach lastActiveModeId before deleting modes so the FK-less pointer
  // doesn't dangle while other tests run.
  await db
    .update(usersTable)
    .set({ lastActiveModeId: null })
    .where(inArray(usersTable.clerkId, clerkIds));
  await db
    .delete(userModesTable)
    .where(inArray(userModesTable.userClerkId, clerkIds));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, clerkIds));
});

describe("/api/users/:userId Work-snapshot hydration from picked skin (#679)", () => {
  it("hydrates activeModeKind + intakeSnapshot from the OA's sourceUserModeId when an outwardAccountId is provided", async () => {
    const res = await request(app)
      .get(`/api/users/${targetClerk}?outwardAccountId=${gameRoomOAId}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    expect(res.body.activeModeKind).toBe("facilities");
    expect(res.body.intakeSnapshot).toMatchObject({
      companyName: `Gameop Game Room ${tag}`,
      operationKind: "game_room",
    });
    // Belt-and-suspenders: the trade-pro intake from lastActiveModeId
    // must NOT bleed in.
    expect(res.body.intakeSnapshot.trade).toBeUndefined();
    expect(res.body.intakeSnapshot.primaryZip).toBeUndefined();
  });

  it("falls back to the owner's lastActiveModeId when no outwardAccountId is provided", async () => {
    const res = await request(app)
      .get(`/api/users/${targetClerk}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    expect(res.body.activeModeKind).toBe("trade_pro");
    expect(res.body.intakeSnapshot).toMatchObject({
      companyName: `Plumber Co ${tag}`,
      trade: "plumber",
      primaryZip: "10001",
    });
  });

  it("falls back to the owner's lastActiveModeId when the picked OA has no sourceUserModeId", async () => {
    const res = await request(app)
      .get(`/api/users/${targetClerk}?outwardAccountId=${unsourcedOAId}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    expect(res.body.activeModeKind).toBe("trade_pro");
    expect(res.body.intakeSnapshot).toMatchObject({
      trade: "plumber",
      primaryZip: "10001",
    });
  });

  it("falls back to the owner's lastActiveModeId when the OA's sourceUserModeId points at a missing/foreign mode (data-drift hardening)", async () => {
    // Seed a fresh OA whose sourceUserModeId points at a mode owned by
    // a DIFFERENT user. The owner-scoped mode lookup will return no
    // row; the response must still surface the owner's last-active
    // snapshot rather than an empty Work snapshot.
    const driftOAs = await db
      .insert(outwardAccountsTable)
      .values([
        {
          ownerClerkId: targetClerk,
          kind: "facilities",
          companyName: `Drift Skin ${tag}`,
          sourceUserModeId: foreignModeId,
        },
      ])
      .returning();
    const driftOAId = driftOAs[0].id;
    const res = await request(app)
      .get(`/api/users/${targetClerk}?outwardAccountId=${driftOAId}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    expect(res.body.activeModeKind).toBe("trade_pro");
    expect(res.body.intakeSnapshot).toMatchObject({
      trade: "plumber",
      primaryZip: "10001",
    });
  });

  it("falls back to the owner's lastActiveModeId when the outwardAccountId belongs to a different user (no foreign-mode probing)", async () => {
    const res = await request(app)
      .get(`/api/users/${targetClerk}?outwardAccountId=${foreignOAId}`)
      .set("x-test-user", callerClerk);
    expect(res.status).toBe(200);
    expect(res.body.activeModeKind).toBe("trade_pro");
    expect(res.body.intakeSnapshot).toMatchObject({
      trade: "plumber",
      primaryZip: "10001",
    });
    expect(res.body.counterpartOutwardAccount).toBeNull();
  });
});
