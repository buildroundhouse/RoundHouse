/**
 * End-to-end tests for service-tag based people search.
 *
 * Covers task #245: tapping a service chip on a public profile opens the
 * people-search modal with the chosen service as an active filter and lists
 * only pros that actually offer that service. The wire-level guarantee that
 * makes that flow work is `GET /api/users/search?service=...` — these tests
 * lock in its behavior so a future regression (dropping the JSONB EXISTS
 * branch, accidentally case-sensitive matching, partial-substring leakage,
 * or losing the `q + service` AND-combination) is caught.
 *
 * What this exercises:
 *   - service= alone returns pros whose `services[].name` matches the value
 *     (case-insensitively) and excludes everyone else
 *   - service= matching is exact on the entry name, NOT a substring match
 *   - q + service combined are AND-ed (both must match)
 *   - clearing the service filter (no q, no service) restores the
 *     empty/typeahead response shape `{ users: [] }`
 *   - the caller is never returned in their own results
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

const { db, usersTable } = await import("@workspace/db");
const usersRouter = (await import("../users")).default;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", usersRouter);
  return app;
}

const tag = `t245-${Date.now()}`;
const ids = {
  caller: `${tag}-caller`,
  matchExact: `${tag}-exact`,
  matchMixedCase: `${tag}-mixedcase`,
  matchOther: `${tag}-other`,
  noServices: `${tag}-noservices`,
  partialOnly: `${tag}-partial`,
  callerWithService: `${tag}-caller-also-offers`,
};

let app: Express;

async function seedUser(
  clerkId: string,
  name: string,
  services: { name: string; isCustom?: boolean }[],
) {
  await db
    .insert(usersTable)
    .values({
      clerkId,
      email: `${clerkId}@example.test`,
      name,
      username: clerkId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 24),
      services,
    })
    .onConflictDoNothing();
}

beforeAll(async () => {
  app = makeApp();

  await seedUser(ids.caller, `caller-${tag}`, []);
  // Caller themselves also offers the searched service — must still be
  // excluded from their own results.
  await seedUser(ids.callerWithService, `caller-also-${tag}`, [
    { name: "Drain Cleaning" },
  ]);
  await seedUser(ids.matchExact, `exact-${tag}`, [
    { name: "Drain Cleaning" },
    { name: "Water Heater Install" },
  ]);
  await seedUser(ids.matchMixedCase, `mixed-${tag}`, [
    { name: "drain cleaning", isCustom: true },
  ]);
  await seedUser(ids.matchOther, `other-${tag}`, [
    { name: "Roof Inspection" },
  ]);
  await seedUser(ids.noServices, `nosvc-${tag}`, []);
  // Pro whose only service NAME *contains* the searched string but isn't
  // equal to it — must NOT match (we use exact equality, not substring).
  await seedUser(ids.partialOnly, `partial-${tag}`, [
    { name: "Emergency Drain Cleaning Specialist" },
  ]);
});

afterAll(async () => {
  const clerkIds = Object.values(ids);
  await db.delete(usersTable).where(inArray(usersTable.clerkId, clerkIds));
});

function search(params: Record<string, string>, callerId = ids.caller) {
  return request(app)
    .get("/api/users/search")
    .query(params)
    .set("x-test-user", callerId);
}

describe("GET /api/users/search?service=... — service-tag people search", () => {
  it("returns pros whose services array contains an entry with the exact name", async () => {
    const res = await search({ service: "Drain Cleaning" });
    expect(res.status).toBe(200);
    const returned = (res.body.users ?? []).map((u: { clerkId: string }) => u.clerkId);
    expect(returned).toContain(ids.matchExact);
  });

  it("matches case-insensitively on the service entry name", async () => {
    // The seeded entry is "drain cleaning" (lowercase, isCustom). The query
    // sends the user-typed casing "Drain Cleaning" — both must match.
    const res = await search({ service: "Drain Cleaning" });
    expect(res.status).toBe(200);
    const returned = (res.body.users ?? []).map((u: { clerkId: string }) => u.clerkId);
    expect(returned).toContain(ids.matchMixedCase);
  });

  it("excludes pros whose services don't contain that name", async () => {
    const res = await search({ service: "Drain Cleaning" });
    expect(res.status).toBe(200);
    const returned = (res.body.users ?? []).map((u: { clerkId: string }) => u.clerkId);
    expect(returned).not.toContain(ids.matchOther);
    expect(returned).not.toContain(ids.noServices);
  });

  it("does NOT match on substring — entry names must equal the searched service", async () => {
    const res = await search({ service: "Drain Cleaning" });
    expect(res.status).toBe(200);
    const returned = (res.body.users ?? []).map((u: { clerkId: string }) => u.clerkId);
    // "Emergency Drain Cleaning Specialist" contains the phrase but isn't equal.
    expect(returned).not.toContain(ids.partialOnly);
  });

  it("never includes the caller in their own results, even if they offer that service", async () => {
    const res = await search({ service: "Drain Cleaning" }, ids.callerWithService);
    expect(res.status).toBe(200);
    const returned = (res.body.users ?? []).map((u: { clerkId: string }) => u.clerkId);
    expect(returned).not.toContain(ids.callerWithService);
    // Sanity: another matching pro is still returned for that caller.
    expect(returned).toContain(ids.matchExact);
  });

  it("AND-combines a text query with the service filter", async () => {
    // Both pros offer "Drain Cleaning", but only matchExact's username
    // contains "exact". The q filter should narrow within the service
    // results. (#617 removed `users.name` from the search match-set
    // because that field is the underlying owner's private personal
    // name; we now narrow on the public username instead.)
    const res = await search({ service: "Drain Cleaning", q: "exact" });
    expect(res.status).toBe(200);
    const returned = (res.body.users ?? []).map((u: { clerkId: string }) => u.clerkId);
    expect(returned).toContain(ids.matchExact);
    expect(returned).not.toContain(ids.matchMixedCase);
  });

  it("returns an empty users array when neither q nor service is provided (typeahead empty state)", async () => {
    // This mirrors the UserSearchModal behavior after the chip is cleared and
    // the search box is empty — the modal should fall back to its empty hint.
    const res = await search({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ users: [] });
  });

  it("returns an empty users array when service is whitespace-only", async () => {
    const res = await search({ service: "   " });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ users: [] });
  });

  it("returns an empty users array when no pro offers the requested service", async () => {
    const res = await search({ service: "Underwater Basket Weaving" });
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([]);
  });
});
