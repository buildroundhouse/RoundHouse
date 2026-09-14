import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const state = vi.hoisted(() => ({ user: {} as Record<string, any>, updates: {} as Record<string, any>, owned: vi.fn() }));
vi.mock("../../middlewares/requireAuth", () => ({ requireAuth: (req: any, res: any, next: any) => {
  if (!req.headers["x-test-user"]) return res.sendStatus(401);
  req.userId = req.headers["x-test-user"]; next();
} }));
vi.mock("drizzle-orm", () => ({ eq: (column: string, value: string) => ({ column, value }) }));
vi.mock("@workspace/db", () => ({ usersTable: { clerkId: "clerkId" }, db: {
  select: () => ({ from: () => ({ where: async (condition: any) => state.user.clerkId === condition.value ? [state.user] : [] }) }),
  update: () => ({ set: (updates: any) => { state.updates = updates; return { where: (condition: any) => ({ returning: async () => {
    if (condition.value !== state.user.clerkId) throw new Error("wrong user");
    state.user = { ...state.user, ...updates }; return [state.user];
  } }) }; } }),
} }));
vi.mock("../../lib/objectAccess", () => ({ assertCallerOwnsUploads: state.owned }));
const router = (await import("../entry-profile")).default;
const app = express(); app.use(express.json()); app.use("/api", router);
const payload = { firstName: "Test", lastName: "Person", nickname: "Tester", phone: "5125550100", avatarUrl: "https://example.test/existing.jpg" };
beforeEach(() => {
  state.user = { clerkId: "test-user", name: "Old Name", username: "keep-my-username", email: "test@example.test", avatarUrl: payload.avatarUrl, identityCompletedAt: null };
  state.updates = {}; state.owned.mockReset();
});
describe("entry profile completion", () => {
  it("persists completion on the authenticated user so the server gate can let them enter", async () => {
    const r = await request(app).put("/api/users/me/entry-profile").set("x-test-user", "test-user").send(payload).expect(200);
    expect(r.body.identityCompletedAt).toBeTruthy();
    expect(state.user).toMatchObject({ name: "Tester Person", phone: payload.phone, username: "keep-my-username", email: "test@example.test" });
    expect(state.owned).toHaveBeenCalledWith("test-user", [payload.avatarUrl]);
  });
  it("does not reset existing completion or change someone else's profile", async () => {
    const completed = new Date("2026-01-01"); state.user.identityCompletedAt = completed;
    await request(app).put("/api/users/me/entry-profile").set("x-test-user", "other-user").send(payload).expect(409);
    expect(state.updates).toEqual({});
    await request(app).put("/api/users/me/entry-profile").set("x-test-user", "test-user").send(payload).expect(200);
    expect(state.user.identityCompletedAt).toBe(completed);
  });
  it("rejects unauthenticated requests and temporary device photos instead of marking signup complete", async () => {
    await request(app).put("/api/users/me/entry-profile").send(payload).expect(401);
    for (const avatarUrl of ["blob:temporary", "file:///photo.jpg", "data:image/svg+xml,<svg/>"]) {
      await request(app).put("/api/users/me/entry-profile").set("x-test-user", "test-user").send({ ...payload, avatarUrl }).expect(400);
    }
    expect(state.user.identityCompletedAt).toBeNull();
  });
});
