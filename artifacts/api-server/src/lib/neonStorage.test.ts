import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ send: vi.fn(), sign: vi.fn() }));
vi.mock("@aws-sdk/client-s3", () => {
  class Command { constructor(public input: unknown) {} }
  return { S3Client: class { send = state.send; }, PutObjectCommand: Command, GetObjectCommand: Command, DeleteObjectCommand: Command, PutBucketCorsCommand: Command };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: state.sign }));
beforeEach(() => {
  vi.resetModules(); state.send.mockReset().mockResolvedValue({}); state.sign.mockReset().mockResolvedValue("https://storage.example.test/signed");
  vi.stubEnv("NEON_STORAGE_BUCKET", "test-uploads"); vi.stubEnv("NEON_STORAGE_ENDPOINT", "https://storage.example.test");
  vi.stubEnv("NEON_STORAGE_ACCESS_KEY_ID", "test-key"); vi.stubEnv("NEON_STORAGE_SECRET_ACCESS_KEY", "test-secret");
  vi.stubEnv("NEON_STORAGE_ALLOWED_ORIGINS", "https://app.example.test");
});
describe("Neon storage isolation", () => {
  it("assigns new paths separately, scopes CORS, and signs the actual file size", async () => {
    const storage = await import("./neonStorage");
    const upload = await storage.createNeonUpload("image/jpeg", 123);
    expect(upload.objectPath).toMatch(/^\/objects\/neon\/[a-f0-9-]{36}$/);
    expect(state.send.mock.calls[0][0].input.CORSConfiguration.CORSRules[0].AllowedOrigins).toEqual(["https://app.example.test"]);
    expect(state.sign.mock.calls[0][1].input).toMatchObject({ Bucket: "test-uploads", ContentLength: 123, ContentType: "image/jpeg" });
    expect(state.sign.mock.calls[0][2]).toEqual({ expiresIn: 900 });
    await expect(storage.deleteNeonObject("/objects/uploads/legacy-id")).rejects.toThrow("Invalid Neon object path");
    expect(state.send).toHaveBeenCalledTimes(1);
  });
  it("keeps downloaded active content sandboxed and out of shared caches", async () => {
    const storage = await import("./neonStorage");
    state.send.mockResolvedValue({ ContentType: "text/html", Body: { transformToWebStream: () => new Response("<script>bad()</script>").body } });
    const result = await storage.downloadNeonObject("/objects/neon/12345678-1234-1234-1234-123456789abc");
    expect(result.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("does not accept a broad wildcard browser origin", async () => {
    vi.stubEnv("NEON_STORAGE_ALLOWED_ORIGINS", "*");
    const storage = await import("./neonStorage");
    await expect(storage.createNeonUpload("image/jpeg", 1)).rejects.toThrow();
    expect(state.send).not.toHaveBeenCalled();
  });
});
