import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  kind: "home", entityRole: "owner", name: "Danny Tierney", replace: vi.fn(), push: vi.fn(),
}));
vi.mock("react-native", () => {
  const node = (tag: string) => ({ children, accessibilityLabel, testID }: any) => React.createElement(tag, { "aria-label": accessibilityLabel, "data-testid": testID }, children);
  return { View: node("div"), Text: node("span"), Pressable: node("button"), ScrollView: node("section"),
    Image: () => null, ActivityIndicator: () => null, Switch: () => null, TextInput: () => null,
    Modal: ({ visible, children }: any) => visible ? children : null,
    Platform: { OS: "web" }, StyleSheet: { create: (s: unknown) => s } };
});
vi.mock("expo-router", () => ({ useRouter: () => ({ replace: state.replace, push: state.push }) }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 24, bottom: 20 }) }));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("expo-image-picker", () => ({}));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ foreground: "#111", background: "#fff", mutedForeground: "#666", border: "#ddd", primary: "#126" }) }));
vi.mock("@/lib/confirm", () => ({ confirm: vi.fn() }));
vi.mock("@/components/ProfileNavigation", () => import("../components/ProfileNavigation"));
vi.mock("@/components/ProfilePreview", () => import("../components/ProfilePreview"));
vi.mock("@/lib/ownerNameDisplay", () => import("./ownerNameDisplay"));
vi.mock("@/lib/personal-profile", () => import("./personal-profile"));
vi.mock("@/lib/uploads", () => ({ resolveStorageUrl: () => null, uploadAsset: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({ customFetch: vi.fn(), useCompleteModeIntake: () => ({}), useUpdateMe: () => ({}), useGetMyPersonalProfile: () => ({ data: { email: "private@example.com" } }), useUpdateMyPersonalProfile: () => ({}), useSwitchActiveMode: () => ({}) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}), useQuery: () => ({ data: { entities: [{ id: 12, displayName: "Oak House", kind: state.kind.startsWith("trade_pro") && state.kind !== "trade_pro_collab" ? "business" : state.kind.startsWith("facilities") ? "facility" : "property", myMembership: { status: "approved", role: state.entityRole } }] } }) }));
vi.mock("@/lib/profile", () => ({ useProfile: () => ({
  profile: { name: state.name }, modes: [], outwardAccounts: [], activeOutwardAccount: { id: 7, lastInitialOnly: true },
  activeMode: { id: 4, kind: state.kind, intakeData: { entityId: 12, companyName: "Legacy Business", businessEmail: "private-business@example.com", personalProfile: {
    bio: { value: "Public carpenter biography", public: true }, email: { value: "private@example.com", public: false },
  } } },
}) }));
import PersonalProfileScreen from "../app/account/personal";
import { CurrentProfileScreen } from "../components/CurrentProfileScreen";
import { ProfilePreview } from "../components/ProfilePreview";
import { FullProfileModal } from "../components/FullProfileModal";
import { ProfileNavigation } from "../components/ProfileNavigation";
import { profileContext } from "./personal-profile";

beforeEach(() => { state.kind = "home"; state.entityRole = "owner"; state.replace.mockClear(); });
const roles = [
  ["home", "owner", "Homeowner"], ["home", "manager", "Home Manager"],
  ["home_teammate", "employee", "Home Team Member"], ["facilities", "manager", "Commercial Management (Manager)"], ["facilities_teammate", "employee", "Commercial Team Member"], ["trade_pro", "owner", "Trade Professional (Owner)"],
  ["trade_pro_teammate", "employee", "Trade Team Member"], ["collab", "collaborator", "Viewer"],
  ["trade_pro_collab", "collaborator", "Viewer"], ["facilities_collab", "collaborator", "Viewer"],
];
describe("profile navigation and preview across avatars", () => {
  it.each(roles)("%s / %s has both controls and current role %s", (kind, membership, label) => {
    state.kind = kind; state.entityRole = membership;
    const html = renderToStaticMarkup(React.createElement(CurrentProfileScreen, { onSettings: vi.fn() }));
    expect(html).toContain('aria-label="Back to Command Center"');
    expect(html).toContain('aria-label="View Profile"');
    expect(html).toContain(label);
    expect(html).toContain("Authority &amp; Permissions");
    expect(html.indexOf('aria-label="Invite / Share Roundhouse"')).toBeLessThan(html.indexOf('aria-label="Find a Trade Professional"'));
  });
  it.each(roles)("%s / %s preview shows %s and excludes private and Entity fields", (kind, membership, label) => {
    state.kind = kind; state.entityRole = membership;
    const html = renderToStaticMarkup(React.createElement(ProfilePreview, { visible: true, onClose: vi.fn() }));
    expect(html).toContain(label);
    expect(html).toContain("Public carpenter biography");
    expect(html).toContain("Danny T.");
    expect(html).not.toContain("private@example.com");
    expect(html).not.toContain("private-business@example.com");
    expect(html).not.toContain("Legacy Business");
    expect(html).toContain('aria-label="Back to Command Center"');
    expect(html).toContain('aria-label="Back to Profile"');
  });
  it("returns directly to Command Center without switching the avatar", () => {
    const header = ProfileNavigation({});
    const back = header.props.children[0];
    back.props.onPress();
    expect(state.replace).toHaveBeenCalledExactlyOnceWith("/(tabs)");
    expect(state.kind).toBe("home");
  });
  it("gives the private account page both navigation doorways", () => {
    const html = renderToStaticMarkup(React.createElement(PersonalProfileScreen));
    expect(html).toContain('aria-label="Back to Command Center"');
    expect(html).toContain("View Profile");
    expect(html).not.toContain("Edit intake information");
  });
  it("closes the preview before navigating directly to Command Center", () => {
    const onClose = vi.fn();
    const modal = ProfilePreview({ visible: true, onClose });
    const navigation = modal.props.children.props.children[0];
    navigation.props.onExit();
    expect(onClose).toHaveBeenCalledOnce();
    expect(state.replace).toHaveBeenCalledExactlyOnceWith("/(tabs)");
  });
  it("retires the duplicate preview implementation", () => { expect(FullProfileModal).toBe(ProfilePreview); });
  it("does not treat an unapproved or descriptive Manager title as authority", () => {
    const result = profileContext("home_teammate", { roleTitle: "Manager", entityId: 12 }, [{ id: 12, displayName: "Oak House", kind: "property", myMembership: { role: "manager", status: "invited" } }]);
    expect(result.role).toBe("Home Team Member"); expect(result.memberships).toEqual([]);
  });
  it("does not promote a Viewer because of a legacy authority value", () => {
    const result = profileContext("collab", {}, [{ id: 12, displayName: "Oak House", kind: "property", myMembership: { role: "manager", status: "approved" } }]);
    expect(result.role).toBe("Viewer");
  });
});
