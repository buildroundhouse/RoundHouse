import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  signedIn: true,
  profile: { identityCompletedAt: "saved", isAdmin: false, clerkId: "person" },
  modes: [{ id: 1, kind: "collab", intakeCompletedAt: "automatic" }] as any[],
  activeModeId: 1,
  memberships: [] as any[],
  pending: false,
  failed: false,
}));
vi.mock("react", async (original) => ({ ...await original<any>(),
  useMemo: (fn: () => unknown) => fn(), useEffect: () => {}, useRef: () => ({ current: null }),
}));
vi.mock("./auth", () => ({ useAuth: () => ({ isSignedIn: state.signedIn, isLoaded: true, userId: "person" }) }));
vi.mock("@workspace/api-client-react", () => ({
  useGetMe: () => ({ data: state.profile, isPending: false, refetch: vi.fn() }),
  useListMyModes: () => ({ data: { modes: state.modes, activeModeId: state.activeModeId }, isPending: false, refetch: vi.fn() }),
  useListMyOutwardAccounts: () => ({ data: { accounts: [{ id: 9 }], activeOutwardAccountId: 9 }, isPending: false, refetch: vi.fn() }),
  customFetch: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({
  data: { entities: state.memberships }, isPending: state.pending, isError: state.failed, refetch: vi.fn(),
}) }));
import { ProfileProvider } from "./profile";
const status = () => ProfileProvider({ children: null }).props.value.status;
beforeEach(() => {
  state.signedIn = true;
  state.profile.identityCompletedAt = "saved"; state.profile.isAdmin = false;
  state.modes = [{ id: 1, kind: "collab", intakeCompletedAt: "automatic" }];
  state.activeModeId = 1; state.memberships = []; state.pending = false; state.failed = false;
});
describe("actual profile onboarding gate", () => {
  it("does not treat auto-completed baseline as space intake", () => expect(status().kind).toBe("needs-mode-picker"));
  it.each(["invited", "requested", "rejected"])("does not activate %s access", (value) => {
    state.memberships = [{ myMembership: { status: value } }];
    expect(status().kind).toBe("needs-mode-picker");
  });
  it("lets approved viewers enter without owner intake", () => {
    state.memberships = [{ myMembership: { status: "approved" } }];
    expect(status().kind).toBe("ready");
  });
  it("does not count archived membership", () => {
    state.memberships = [{ myMembership: { status: "approved", archivedAt: "yesterday" } }];
    expect(status().kind).toBe("needs-mode-picker");
  });
  it("waits for membership verification before rendering command center", () => {
    state.pending = true; expect(status().kind).toBe("loading");
  });
  it("offers retry when verification fails", () => {
    state.failed = true; expect(status().kind).toBe("error"); expect(status().retry).toBeTypeOf("function");
  });
  it.each(["home", "facilities", "trade_pro"])("resumes unfinished %s intake", (kind) => {
    state.modes = [{ id: 1, kind, intakeCompletedAt: null }];
    expect(status()).toEqual({ kind: "needs-intake", mode: state.modes[0] });
    state.modes[0].intakeCompletedAt = "saved";
    expect(status().kind).toBe("ready");
  });
  it("still requires a new person's identity", () => {
    state.profile.identityCompletedAt = ""; expect(status().kind).toBe("needs-identity");
  });
  it("preserves administrator access", () => {
    state.profile.isAdmin = true; expect(status().kind).toBe("ready");
  });
});
