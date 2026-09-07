/**
 * Task #614: Teammate kinds are scoped strictly to their parent account
 * family. POST /users/me/modes must reject creating a `home_teammate`
 * unless the user already holds a `home` mode (and the symmetric guards
 * for trade_pro_teammate / facilities_teammate). Nothing with "home"
 * attaches to a facility, and nothing with "facility" attaches to a
 * home. Collaborator kinds are unrestricted.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";

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

const { db, usersTable, userModesTable } = await import("@workspace/db");
const usersRouter = (await import("../users")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  return app;
}

const tag = `t614-${Date.now()}`;
const blankClerk = `${tag}-blank`;
const homeClerk = `${tag}-home`;
const proClerk = `${tag}-pro`;
const facClerk = `${tag}-fac`;
const allClerks = [blankClerk, homeClerk, proClerk, facClerk];

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
  await db.insert(userModesTable).values([
    { userClerkId: homeClerk, kind: "home", intakeData: {} },
    { userClerkId: proClerk, kind: "trade_pro", intakeData: {} },
    { userClerkId: facClerk, kind: "facilities", intakeData: {} },
  ]);
});

afterAll(async () => {
  await db
    .delete(userModesTable)
    .where(inArray(userModesTable.userClerkId, allClerks));
  await db.delete(usersTable).where(inArray(usersTable.clerkId, allClerks));
});

describe("POST /users/me/modes — teammate parent-kind scoping (#614)", () => {
  it("rejects home_teammate when user has no home parent mode", async () => {
    const res = await request(app)
      .post("/api/users/me/modes")
      .set("x-test-user", blankClerk)
      .send({ kind: "home_teammate" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Home Teammate.*Home/);
  });

  it("rejects home_teammate when user only has a facilities account", async () => {
    const res = await request(app)
      .post("/api/users/me/modes")
      .set("x-test-user", facClerk)
      .send({ kind: "home_teammate" });
    expect(res.status).toBe(400);
  });

  it("rejects facilities_teammate when user only has a home account", async () => {
    const res = await request(app)
      .post("/api/users/me/modes")
      .set("x-test-user", homeClerk)
      .send({ kind: "facilities_teammate" });
    expect(res.status).toBe(400);
  });

  it("rejects trade_pro_teammate when user only has a home account", async () => {
    const res = await request(app)
      .post("/api/users/me/modes")
      .set("x-test-user", homeClerk)
      .send({ kind: "trade_pro_teammate" });
    expect(res.status).toBe(400);
  });

  it("allows home_teammate when user already has a home account", async () => {
    const res = await request(app)
      .post("/api/users/me/modes")
      .set("x-test-user", homeClerk)
      .send({ kind: "home_teammate" });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("home_teammate");
    // cleanup the created teammate row to keep the fixture stable
    await db.delete(userModesTable).where(eq(userModesTable.id, res.body.id));
  });

  it("allows trade_pro_teammate when user already has a trade_pro account", async () => {
    const res = await request(app)
      .post("/api/users/me/modes")
      .set("x-test-user", proClerk)
      .send({ kind: "trade_pro_teammate" });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("trade_pro_teammate");
    await db.delete(userModesTable).where(eq(userModesTable.id, res.body.id));
  });

  it("allows facilities_teammate when user already has a facilities account", async () => {
    const res = await request(app)
      .post("/api/users/me/modes")
      .set("x-test-user", facClerk)
      .send({ kind: "facilities_teammate" });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("facilities_teammate");
    await db.delete(userModesTable).where(eq(userModesTable.id, res.body.id));
  });

  it("allows collab without any parent kind (collaborator is unrestricted)", async () => {
    const res = await request(app)
      .post("/api/users/me/modes")
      .set("x-test-user", blankClerk)
      .send({ kind: "collab" });
    expect(res.status).toBe(201);
    expect(res.body.kind).toBe("collab");
  });
});
