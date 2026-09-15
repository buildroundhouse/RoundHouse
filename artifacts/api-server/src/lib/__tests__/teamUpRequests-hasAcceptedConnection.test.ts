import { beforeEach, describe, expect, it, vi } from "vitest";

// The retired user_connections/team-seat handshake is not authorization.
// Its compatibility helper delegates to approved Entity relationships.
const access = vi.hoisted(() => ({ owners: vi.fn(), shared: vi.fn() }));
vi.mock("../entityAccess", () => ({ ownerClerkIdsForOutwardAccounts: access.owners, shareAnyEntity: access.shared }));
import { hasAcceptedConnection } from "../teamUpRequests";

beforeEach(() => {
  vi.resetAllMocks();
  access.owners.mockResolvedValue(new Map([[10, "alice"], [20, "bob"]]));
  access.shared.mockResolvedValue(false);
});

describe("Entity-backed connection compatibility", () => {
  it("denies participants without an approved shared Entity", async () => {
    expect(await hasAcceptedConnection(10, 20)).toBe(false);
    expect(access.shared).toHaveBeenCalledWith("alice", "bob");
  });
  it("allows approved shared Entity participants in either direction", async () => {
    access.shared.mockResolvedValue(true);
    expect(await hasAcceptedConnection(10, 20)).toBe(true);
    expect(await hasAcceptedConnection(20, 10)).toBe(true);
    expect(access.shared).toHaveBeenLastCalledWith("bob", "alice");
  });
  it("denies an account whose owner cannot be resolved", async () => {
    access.owners.mockResolvedValue(new Map([[10, "alice"]]));
    expect(await hasAcceptedConnection(10, 20)).toBe(false);
    expect(access.shared).not.toHaveBeenCalled();
  });
  it("recognizes accounts belonging to the same person", async () => {
    access.owners.mockResolvedValue(new Map([[10, "alice"], [20, "alice"]]));
    expect(await hasAcceptedConnection(10, 20)).toBe(true);
    expect(access.shared).not.toHaveBeenCalled();
  });
});
