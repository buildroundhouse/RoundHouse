import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ kind: "trade_pro", allowCreate: true, failed: false, replace: vi.fn(), buttons: [] as any[], documents: [] as any[] }));
vi.mock("react-native", () => {
  const node = (tag: string) => ({ children, accessibilityLabel, disabled, onPress }: any) => {
    if (onPress) state.buttons.push({ label: accessibilityLabel, onPress, disabled });
    return React.createElement(tag, { "aria-label": accessibilityLabel, disabled }, children);
  };
  return { View: node("div"), Text: node("span"), Pressable: node("button"), ScrollView: node("section"), KeyboardAvoidingView: node("div"),
    TextInput: () => null, RefreshControl: () => null, ActivityIndicator: () => null,
    Modal: ({ visible, children }: any) => visible ? children : null, Platform: { OS: "web" }, StyleSheet: { create: (s: unknown) => s } };
});
vi.mock("expo-router", () => ({ useRouter: () => ({ replace: state.replace }), useLocalSearchParams: () => ({}) }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 25, bottom: 20 }) }));
vi.mock("@expo/vector-icons", () => ({ Feather: () => null }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({}) }));
vi.mock("@/lib/confirm", () => ({ confirm: async () => true }));
vi.mock("@/lib/profile", () => ({ useProfile: () => ({ profile: { clerkId: "person" }, activeOutwardAccountId: 1, activeOutwardAccount: { id: 1, kind: state.kind }, activeMode: { id: 2, kind: state.kind } }) }));
vi.mock("@/lib/personal-profile", () => import("./personal-profile"));
vi.mock("@/lib/financial-documents", () => import("./financial-documents"));
vi.mock("@workspace/api-client-react", () => ({ customFetch: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useMutation: () => ({}), useQueryClient: () => ({}), useQuery: ({ queryKey }: any) => queryKey[0] === "financial-documents"
  ? { data: { documents: state.documents }, isError: state.failed }
  : { data: { issuers: state.allowCreate ? [{ id: 1, name: "Workshop" }] : [], properties: [{ id: 2, name: "Home", clients: [{ accountId: 3, name: "Client" }] }] } } }));
import InvoicesScreen from "../app/(tabs)/invoices";
import { amountInCents } from "./financial-documents";
beforeEach(() => { state.kind = "trade_pro"; state.allowCreate = true; state.failed = false; state.documents = []; state.buttons = []; state.replace.mockClear(); });
describe("Estimates / Invoices page", () => {
  it("has direct Command Center navigation and the specified simple workspace", async () => {
    const html = renderToStaticMarkup(React.createElement(InvoicesScreen));
    expect(html).toContain('aria-label="Back to Command Center"');
    expect(html).toContain("Create Estimate"); expect(html).toContain("Create Invoice"); expect(html).toContain("Convert Estimate to Invoice");
    expect(html).toContain("QuickBooks Integration — Coming Soon"); expect(html).not.toContain("Receipts");
    await state.buttons.find(b => b.label === "Back to Command Center").onPress(); expect(state.replace).toHaveBeenCalledWith("/(tabs)");
  });
  it.each(["home", "home_teammate", "facilities", "trade_pro_teammate"])("%s without finance authority sees review information rather than creation controls", kind => {
    state.kind = kind; state.allowCreate = false;
    const html = renderToStaticMarkup(React.createElement(InvoicesScreen));
    expect(html).not.toContain('aria-label="Create Invoice"'); expect(html).toContain("Client documents appear here for review");
  });
  it.each(["collab", "trade_pro_collab", "facilities_collab"])("%s stays read-only even if contexts are stale", kind => {
    state.kind = kind;
    const html = renderToStaticMarkup(React.createElement(InvoicesScreen));
    expect(html).not.toContain('aria-label="Create Invoice"'); expect(html).toContain("View-only financial records");
  });
  it("shows number, client, property, amount, date and status in the combined list", () => {
    state.documents = [{ id: 1, kind: "invoice", number: 100, clientName: "Client Name", propertyName: "Oak Home", amountCents: 12345, status: "pending", updatedAt: "2026-09-14T10:00:00Z" }];
    const html = renderToStaticMarkup(React.createElement(InvoicesScreen));
    for (const text of ["Invoice #100", "Client Name", "Oak Home", "$123.45", "Pending", "2026"]) expect(html).toContain(text);
  });
  it("shows a recoverable load error rather than a false empty state", () => {
    state.failed = true;
    expect(renderToStaticMarkup(React.createElement(InvoicesScreen))).toContain("couldn’t be loaded");
  });
  it("converts entered dollars to exact cents and rejects invalid precision", () => {
    expect(amountInCents("123.45")).toBe(12345); expect(amountInCents("0.01")).toBe(1); expect(amountInCents("1.1")).toBe(110);
    for (const invalid of ["", "0", "-1", "1.005", "1e3", "NaN", "1000000.01"]) expect(amountInCents(invalid)).toBeNull();
  });
});
