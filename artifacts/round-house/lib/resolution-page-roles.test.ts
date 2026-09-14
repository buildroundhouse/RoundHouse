import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ kind: "home", contexts: [{ id: 1, name: "Home", people: [] }] as unknown[] }));
vi.mock("react-native", () => {
  const node = ({ children, accessibilityLabel }: any) => React.createElement("div", { "aria-label": accessibilityLabel }, children);
  return { View: node, Text: node, Pressable: node, ScrollView: node, KeyboardAvoidingView: node,
    ActivityIndicator: () => null, RefreshControl: () => null, TextInput: () => null,
    Modal: ({ visible, children }: any) => visible ? children : null,
    Platform: { OS: "web" }, StyleSheet: { create: (s: unknown) => s } };
});
vi.mock("expo-router", () => ({ useRouter: () => ({ replace: vi.fn() }), useLocalSearchParams: () => ({}) }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({}) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ userId: "person" }) }));
vi.mock("@/lib/profile", () => ({ useProfile: () => ({ activeOutwardAccountId: 1, activeOutwardAccount: { id: 1, kind: state.kind }, activeMode: { id: 1, kind: state.kind } }) }));
vi.mock("@/lib/useResolutions", () => ({ useResolutions: () => ({ data: { resolutions: [] } }) }));
vi.mock("@/lib/personal-profile", () => import("./personal-profile"));
vi.mock("@/lib/resolutions", () => import("./resolutions"));
vi.mock("@/components/ResolutionIndicator", () => ({ ResolutionIndicator: () => null }));
vi.mock("@workspace/api-client-react", () => ({ customFetch: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}), useMutation: () => ({}), useQuery: () => ({ data: { contexts: state.contexts } }) }));
import ResolutionCenter from "../app/(tabs)/resolutions";
describe("Resolution Center account controls", () => {
  it.each(["home", "home_teammate", "trade_pro", "trade_pro_teammate", "facilities", "facilities_teammate"])("%s can create when the server provides a permitted context", kind => {
    state.kind = kind; state.contexts = [{ id: 1 }];
    const html = renderToStaticMarkup(React.createElement(ResolutionCenter));
    expect(html).toContain("New resolution"); expect(html).toContain('aria-label="Back to Command Center"');
  });
  it.each(["collab", "trade_pro_collab", "facilities_collab", "viewer"])("%s stays read-only even with stale contexts", kind => {
    state.kind = kind; state.contexts = [{ id: 1 }];
    const html = renderToStaticMarkup(React.createElement(ResolutionCenter));
    expect(html).not.toContain("New resolution"); expect(html).toContain("Read-only history");
  });
  it("does not offer creation to a teammate without a permitted space", () => {
    state.kind = "home_teammate"; state.contexts = [];
    expect(renderToStaticMarkup(React.createElement(ResolutionCenter))).not.toContain("New resolution");
  });
});
