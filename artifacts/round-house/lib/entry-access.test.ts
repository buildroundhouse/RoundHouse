import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  replace: vi.fn(), invalidateQueries: vi.fn(), accept: vi.fn(),
  invites: [] as any[], modes: [] as any[], switchMode: vi.fn(),
}));
vi.mock("react", async (original) => ({ ...await original<any>(), useState: () => ["", vi.fn()] }));
vi.mock("react-native", () => ({ ActivityIndicator: "spinner", Pressable: "button", Text: "text", View: "view" }));
vi.mock("expo-router", () => ({
  Redirect: () => null, useRouter: () => ({ replace: state.replace }),
  useLocalSearchParams: () => ({ entity: "property", propertyType: "residential", relationship: "viewer" }),
}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({}) }));
vi.mock("@/components/EntryStep", () => ({ EntryStep: "step" }));
vi.mock("@/lib/profile", () => ({ useProfile: () => ({ modes: state.modes, refetchModes: vi.fn(), refetchProfile: vi.fn(), refetchOutwardAccounts: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: state.invalidateQueries }) }));
vi.mock("@workspace/api-client-react", () => ({
  useSwitchActiveMode: () => ({ mutateAsync: state.switchMode }),
  useListMyEntityInvites: () => ({ data: { invites: state.invites }, refetch: vi.fn() }),
  useRespondToEntityMembership: () => ({ mutateAsync: state.accept }),
}));
import { SavedSpaces } from "../components/SavedSpaces";
import EntryAccessScreen from "../app/(onboarding)/entry-access";
function nodes(node: any): any[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
const buttons = () => nodes(EntryAccessScreen()).filter((node) => node.type === "button");
beforeEach(() => { vi.clearAllMocks(); state.invites = []; state.modes = []; });
describe("invitation intake navigation", () => {
  it("offers a different setup path instead of entering without membership", () => {
    buttons().at(-1).props.onPress();
    expect(state.replace).toHaveBeenCalledWith("/(onboarding)/entry");
  });
  it("refreshes accepted access and navigates through the gate", async () => {
    state.invites = [{ id: 5, entity: { kind: "residential_property", name: "Home" } }];
    await buttons()[0].props.onPress();
    expect(state.accept).toHaveBeenCalledWith({ memberId: 5, data: { action: "accept" } });
    expect(state.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["/api/entities/mine"] });
    expect(state.replace).toHaveBeenCalledWith("/");
  });
  it("does not advance if acceptance fails", async () => {
    state.invites = [{ id: 5, entity: { kind: "residential_property", name: "Home" } }];
    state.accept.mockRejectedValueOnce(new Error("Access could not be granted"));
    await buttons()[0].props.onPress();
    expect(state.replace).not.toHaveBeenCalled();
  });
});


describe("saved space recovery", () => {
  it.each([null, "complete"])("reopens existing space with completion %s", async (intakeCompletedAt) => {
    state.modes = [{ id: 42, kind: "home", intakeCompletedAt, intakeData: { placeName: "My Home" } }];
    const tree = nodes(SavedSpaces());
    const action = tree.find((node) => node.type === "button");
    await action.props.onPress();
    expect(state.switchMode).toHaveBeenCalledWith({ data: { modeId: 42 } });
    expect(state.replace).toHaveBeenCalledWith("/");
  });
  it("does not offer the automatic baseline as a saved space", () => {
    state.modes = [{ id: 1, kind: "collab", intakeCompletedAt: "automatic" }];
    expect(SavedSpaces()).toBeNull();
  });
});
