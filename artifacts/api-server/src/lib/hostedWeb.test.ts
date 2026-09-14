import express from "express";
import request from "supertest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { attachHostedWeb } from "./hostedWeb";

const directory = mkdtempSync(path.join(tmpdir(), "roundhouse-web-"));
mkdirSync(path.join(directory, "_expo"));
writeFileSync(path.join(directory, "index.html"), "<!doctype html><title>RoundHouse</title>");
writeFileSync(path.join(directory, "_expo", "app.js"), "window.roundhouse = true;");
writeFileSync(path.join(directory, ".env"), "PRIVATE=never-serve");
const fontDirectory = path.join(directory, "assets/__node_modules/.pnpm/font-package/fonts");
mkdirSync(fontDirectory, { recursive: true });
writeFileSync(path.join(fontDirectory, "font.ttf"), "exported-font");
writeFileSync(path.join(fontDirectory, ".env"), "PRIVATE=never-serve");
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function createApp() {
  const app = express();
  app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  attachHostedWeb(app, directory);
  return app;
}

describe("hosted web app", () => {
  it("serves Expo's pnpm fonts while denying hidden files inside the export", async () => {
    await request(createApp()).get("/assets/__node_modules/.pnpm/font-package/fonts/font.ttf").expect(200);
    await request(createApp()).get("/assets/__node_modules/.pnpm/font-package/fonts/.env").expect(404);
  });
  it.each(["/", "/property/123", "/account/profile"])("opens %s directly", async (url) => {
    const response = await request(createApp()).get(url).expect(200);
    expect(response.text).toContain("<title>RoundHouse</title>");
    expect(response.headers["cache-control"]).toBe("no-cache");
  });
  it("serves the exported JavaScript and preserves the API response", async () => {
    await request(createApp()).get("/_expo/app.js").expect(200).expect(/window.roundhouse/);
    await request(createApp()).get("/api/health").expect(200, { status: "ok" });
  });
  it("keeps unknown API requests as JSON 404s for GET and POST", async () => {
    await request(createApp()).get("/api/missing").expect(404, { error: "Not found" });
    await request(createApp()).post("/api/missing").expect(404, { error: "Not found" });
  });
  it.each(["/_expo/missing.js", "/assets/missing", "/favicon.ico", "/.env"])("does not return app HTML for %s", async (url) => {
    const response = await request(createApp()).get(url).expect(404);
    expect(response.text).not.toContain("<title>RoundHouse</title>");
    expect(response.text).not.toContain("PRIVATE=");
  });
  it("leaves an API-only service unchanged when no directory is configured", async () => {
    const app = express();
    attachHostedWeb(app);
    await request(app).get("/").expect(404);
  });
  it("fails before listening when the configured export does not exist", () => {
    expect(() => attachHostedWeb(express(), path.join(directory, "missing"))).toThrow();
  });
});
