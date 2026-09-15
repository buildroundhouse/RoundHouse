import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

// Task 663 removed the avatar handshake. Guard against bringing it back as
// a way around Entity consent. Current request/approval persistence is covered
// by approved-intake-database.test.ts against an isolated PostgreSQL engine.
vi.mock("@workspace/db", async () => ({ ...(await import("../../../../../lib/db/src/schema")), db: {} }));
vi.mock("../../middlewares/requireAuth", () => ({ requireAuth: (req: any, _res: any, next: any) => { req.userId = "test-person"; next(); } }));
import usersRouter from "../users";
const app = express();
app.use(express.json());
app.use(usersRouter);

describe("retired avatar-to-avatar handshake", () => {
  it.each(["/users/another-person/connect", "/users/another-person/team-up/respond"])("cannot grant access through POST %s", async (path) => {
    expect((await request(app).post(path).send({ status: "accepted", action: "accept" })).status).toBe(410);
  });
  it("cannot remove an Entity relationship through the retired connection endpoint", async () => {
    expect((await request(app).delete("/users/another-person/connect")).status).toBe(410);
  });
});
