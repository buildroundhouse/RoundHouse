import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import router from "../address-lookup";

const app = express();
app.use(express.json());
app.use("/api", router);
const address = { street: "301 W 2nd St", city: "Austin", state: "TX" };
const match = { matchedAddress: "301 W 2ND ST, AUSTIN, TX, 78701", addressComponents: { city: "AUSTIN", state: "TX", zip: "78701" }, coordinates: { x: -97.74, y: 30.26 } };
afterEach(() => vi.unstubAllGlobals());
describe("automatic address ZIP lookup", () => {
  it("looks up a street/city/state without requiring the ZIP being looked up", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify({ result: { addressMatches: [match] } })));
    vi.stubGlobal("fetch", fetch);
    const r = await request(app).post("/api/address-lookup").send(address).expect(200);
    expect(r.body.matches[0]).toMatchObject({ zip: "78701", status: "matched", state: "TX" });
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect(url.hostname).toBe("geocoding.geo.census.gov");
    expect(url.searchParams.get("street")).toBe(address.street);
    expect(url.searchParams.has("zip")).toBe(false);
  });
  it("does not guess from only a city or from the wrong house number", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ result: { addressMatches: [{ ...match, matchedAddress: "399 W 2ND ST, AUSTIN, TX, 78701" }] } })));
    vi.stubGlobal("fetch", fetch);
    await request(app).post("/api/address-lookup").send({ city: "Austin", state: "TX" }).expect(400);
    expect(fetch).not.toHaveBeenCalled();
    const r = await request(app).post("/api/address-lookup").send(address).expect(200);
    expect(r.body.matches).toEqual([]);
  });
  it("keeps manual entry available during provider failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
    const r = await request(app).post("/api/address-lookup").send(address).expect(503);
    expect(r.body.error).toContain("enter your ZIP Code and continue");
  });
});
