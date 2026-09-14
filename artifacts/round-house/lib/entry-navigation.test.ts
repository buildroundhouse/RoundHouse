import { beforeEach, describe, expect, it, vi } from "vitest";
const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  params: {} as Record<string, string>,
  storage: new Map<string, string>(),
}));
vi.mock("expo-router", () => ({
  useRouter: () => ({ push: navigation.push }),
  useLocalSearchParams: () => navigation.params,
  Redirect: () => null,
}));
vi.mock("@/components/EntryStep", () => ({ EntryStep: () => null }));
vi.mock("@/components/SavedSpaces", () => ({ SavedSpaces: () => null }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    setItem: async (key: string, value: string) => {
      navigation.storage.set(key, value);
    },
    getItem: async (key: string) => navigation.storage.get(key) ?? null,
    removeItem: async (key: string) => {
      navigation.storage.delete(key);
    },
  },
}));
import EntryScreen from "../app/(onboarding)/entry";
import PropertyTypeScreen from "../app/(onboarding)/entry-property-type";
import EntryRoleScreen from "../app/(onboarding)/entry-role";
import { loadEntryDraft, saveEntryDraft, clearEntryDraft } from "./entry-draft";
beforeEach(() => {
  navigation.push.mockClear();
  navigation.params = {};
  navigation.storage.clear();
});
describe("actual intake screen transitions", () => {
  it("opens separate property and business type screens", () => {
    const props = EntryScreen().props;
    expect(props.choices.map((c: { label: string }) => c.label)).toEqual([
      "Property",
      "Business",
    ]);
    props.onSelect("property");
    expect(navigation.push).toHaveBeenLastCalledWith(
      "/(onboarding)/entry-property-type",
    );
    props.onSelect("business");
    expect(navigation.push).toHaveBeenLastCalledWith(
      "/(onboarding)/entry-business-type",
    );
  });
  it.each(["residential", "commercial"])(
    "carries %s to its own relationship screen",
    (propertyType) => {
      PropertyTypeScreen().props.onSelect(propertyType);
      const target = navigation.push.mock.lastCall![0];
      expect(target.pathname).toBe("/(onboarding)/entry-role");
      navigation.params = target.params;
      const props = EntryRoleScreen().props;
      expect(props.choices.map((c: { label: string }) => c.label)).toEqual([
        "Owner",
        "Manager",
        "Home Team Member",
        "Viewer",
      ]);
      for (const relationship of [
        "owner",
        "manager",
        "team_member",
        "viewer",
      ]) {
        props.onSelect(relationship);
        expect(navigation.push).toHaveBeenLastCalledWith({
          pathname:
            relationship === "owner"
              ? "/(onboarding)/entry-entity"
              : "/(onboarding)/entry-access",
          params: { entity: "property", propertyType, relationship },
        });
      }
    },
  );
  it("preserves business type through the relationship screen", () => {
    navigation.params = { entity: "business", businessType: "Designer" };
    const props = EntryRoleScreen().props;
    expect(props.choices.map((c: { label: string }) => c.label)).toEqual([
      "Owner",
      "Manager",
      "Business Team Member",
      "Viewer",
    ]);
    props.onSelect("owner");
    expect(navigation.push).toHaveBeenLastCalledWith({
      pathname: "/(onboarding)/entry-business",
      params: {
        entity: "business",
        businessType: "Designer",
        relationship: "owner",
      },
    });
  });
  it("recovers incomplete direct links without silently selecting owner", () => {
    navigation.params = { entity: "property" };
    expect(EntryRoleScreen().props.href).toBe("/(onboarding)/entry");
    expect(navigation.push).not.toHaveBeenCalled();
  });
});
it("restores selection and data only for the same user and pending profile", async () => {
  const draft = {
    selection: {
      entity: "property" as const,
      propertyType: "commercial" as const,
      relationship: "owner" as const,
    },
    data: { placeAddress: "301 W 2nd St, Austin, TX 78701" },
  };
  await saveEntryDraft("user-a", 8, draft);
  expect(await loadEntryDraft("user-a", 8)).toEqual(draft);
  expect(await loadEntryDraft("user-b", 8)).toBeNull();
  expect(await loadEntryDraft("user-a", 9)).toBeNull();
  await clearEntryDraft("user-a", 8);
  expect(await loadEntryDraft("user-a", 8)).toBeNull();
});
