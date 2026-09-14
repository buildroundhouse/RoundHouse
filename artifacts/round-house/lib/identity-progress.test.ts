import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  profile: { identityCompletedAt: "2026-09-14", avatarUrl: "" } as { identityCompletedAt: string | null; avatarUrl: string },
  mode: null as null | { id: number; kind: string; intakeCompletedAt: string | null },
  segment: "identity",
}));
vi.mock("expo-router", () => ({ Redirect: () => null, Stack: Object.assign(() => null, { Screen: () => null }), useSegments: () => ["(onboarding)", state.segment] }));
vi.mock("react-native", () => ({ View: () => null, ActivityIndicator: () => null }));
vi.mock("@/components/SetupRetry", () => ({ SetupRetry: () => null }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ isSignedIn: true, isLoaded: true }) }));
vi.mock("@/lib/profile", () => ({ useProfile: () => ({ status: { kind: "needs-intake" }, profile: state.profile, activeMode: state.mode }) }));
import OnboardingLayout from "../app/(onboarding)/_layout";
import { hasSavedIdentity } from "./identity-progress";
beforeEach(() => { state.profile = { identityCompletedAt: "2026-09-14", avatarUrl: "" }; state.mode = null; state.segment = "identity"; });
describe("saved identity checkpoint", () => {
  it("keeps completed identity even when the display photo is empty", () => {
    expect(hasSavedIdentity(state.profile)).toBe(true);
    expect(OnboardingLayout().props.href).toEqual({ pathname: "/(onboarding)/entry" });
  });
  it("resumes the unfinished space instead of reopening identity", () => {
    state.mode = { id: 42, kind: "home", intakeCompletedAt: null };
    expect(OnboardingLayout().props.href).toEqual({ pathname: "/(onboarding)/intake", params: { modeId: "42", kind: "home" } });
  });
  it("uses entity selection when only the legacy baseline exists", () => {
    state.mode = { id: 1, kind: "collab", intakeCompletedAt: "2026-09-14" };
    expect(OnboardingLayout().props.href.pathname).toBe("/(onboarding)/entry");
  });
  it("does not reset completed identity while moving between space screens", () => {
    state.segment = "entry-role";
    expect(OnboardingLayout().props.href).toBeUndefined();
  });
  it("still requires first-time users to save identity", () => {
    state.profile.identityCompletedAt = null;
    expect(hasSavedIdentity(state.profile)).toBe(false);
    expect(OnboardingLayout().props.href).toBeUndefined();
  });
});
