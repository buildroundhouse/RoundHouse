import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const state = vi.hoisted(() => ({ publicMedia: false, allowed: false, uploads: vi.fn(), read: vi.fn(), track: vi.fn() }));
const token = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "owner", exp: Math.floor(Date.now() / 1000) + 1800 })).toString("base64url")}.test`;
vi.mock("../../middlewares/requireAuth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (req.headers.authorization !== `Bearer ${token}`) return res.sendStatus(401);
    req.userId = "owner"; req.activeOutwardAccountId = 5; next();
  },
  tryAttachAuth: async (req: any) => { if (req.headers.authorization === `Bearer ${token}`) req.userId = "owner"; },
}));
vi.mock("../../lib/objectAccess", () => ({
  isPublicProfileMedia: async () => state.publicMedia,
  canUserAccessObjectPath: async () => state.allowed,
  recordObjectUpload: state.track,
}));
vi.mock("../../lib/objectStorage", () => ({
  ObjectNotFoundError: class extends Error {},
  ObjectStorageService: class { requestUpload = state.uploads; downloadObjectEntity = state.read; },
}));
const router = (await import("../storage")).default;
const app = express(); app.use(express.json()); app.use("/api", router);
const path = "/api/storage/objects/neon/12345678-1234-1234-1234-123456789abc";
beforeEach(() => {
  state.publicMedia = false; state.allowed = false;
  state.read.mockReset().mockImplementation(async () => new Response("photo", { headers: { "Cache-Control": "private, no-store" } }));
  state.uploads.mockReset().mockResolvedValue({ uploadURL: "https://storage.example.test/signed", objectPath: path.replace("/api/storage", "") });
  state.track.mockReset();
});
describe("browser upload and file access", () => {
  it("requires sign-in and records ownership before returning an upload URL", async () => {
    const body = { name: "photo.jpg", size: 5, contentType: "image/jpeg" };
    await request(app).post("/api/storage/uploads/request-url").send(body).expect(401);
    await request(app).post("/api/storage/uploads/request-url").set("Authorization", `Bearer ${token}`).send(body).expect(200);
    expect(state.uploads).toHaveBeenCalledWith("image/jpeg", 5);
    expect(state.track).toHaveBeenCalledWith("owner", path.replace("/api/storage", ""), 5);
  });
  it("rejects oversized uploads before signing", async () => {
    await request(app).post("/api/storage/uploads/request-url").set("Authorization", `Bearer ${token}`)
      .send({ name: "large", size: 26 * 1024 * 1024, contentType: "image/jpeg" }).expect(400);
    expect(state.uploads).not.toHaveBeenCalled();
  });
  it("sets a scoped HttpOnly cookie only after bearer authentication, and clears it at logout", async () => {
    await request(app).post("/api/storage/session").expect(401);
    const r = await request(app).post("/api/storage/session").set("Authorization", `Bearer ${token}`).expect(204);
    const cookie = r.headers["set-cookie"][0];
    expect(cookie).toContain("HttpOnly"); expect(cookie).toContain("SameSite=Strict"); expect(cookie).toContain("Path=/api/storage");
    const cleared = await request(app).delete("/api/storage/session").expect(204);
    expect(cleared.headers["set-cookie"][0]).toContain("Expires=Thu, 01 Jan 1970");
  });
  it("allows same-origin image cookies only with file membership", async () => {
    const cookie = `roundhouse_media=${token}`;
    await request(app).get(path).set("Cookie", cookie).expect(403);
    expect(state.read).not.toHaveBeenCalled();
    state.allowed = true;
    const r = await request(app).get(path).set("Cookie", cookie).expect(200);
    expect(r.text).toBe("photo"); expect(r.headers["cache-control"]).toBe("private, no-store");
  });
  it("rejects unauthenticated, invalid-cookie and cross-origin reads", async () => {
    state.allowed = true;
    await request(app).get(path).expect(401);
    await request(app).get(path).set("Cookie", "roundhouse_media=invalid").expect(401);
    await request(app).get(path).set("Cookie", `roundhouse_media=${token}`).set("Origin", "https://other.example").expect(401);
    await request(app).get(path).set("Cookie", `roundhouse_media=${token}`).set("Sec-Fetch-Site", "cross-site").expect(401);
    expect(state.read).not.toHaveBeenCalled();
  });
  it("keeps approved public profile media accessible without authentication", async () => {
    state.publicMedia = true;
    await request(app).get(path).expect(200);
  });
});
