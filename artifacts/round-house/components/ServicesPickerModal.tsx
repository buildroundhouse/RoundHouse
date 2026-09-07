import React, { useMemo, useState, useEffect } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { SERVICE_CATEGORIES, SERVICE_GROUPS, displayServiceName } from "@/lib/serviceCategories";
import { matchesService } from "@/lib/serviceSynonyms";
import { useServiceCategoryView } from "@/lib/presetChips";
import type { ServiceEntry } from "@workspace/api-client-react";

type Props = {
  visible: boolean;
  initial: ServiceEntry[];
  onClose: () => void;
  onSave: (services: ServiceEntry[]) => Promise<void> | void;
};

const norm = (s: string) => s.trim().toLowerCase();

export function ServicesPickerModal({ visible, initial, onClose, onSave }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const liveCategories = useServiceCategoryView();
  // Live preset values when available; otherwise fall back to the
  // bundled service category lists.
  const allCategoryNames: string[] = liveCategories
    ? liveCategories.all.map((c) => c.label)
    : SERVICE_CATEGORIES;
  const groupView: { label: string; items: string[] }[] = liveCategories
    ? liveCategories.groups.map((g) => ({ label: g.label, items: g.items.map((i) => i.label) }))
    : SERVICE_GROUPS;
  // Custom services are not allowed — every entry must come from the
  // curated SERVICE_CATEGORIES list. Any legacy custom entries on the
  // existing user record are dropped on open.
  const [picked, setPicked] = useState<ServiceEntry[]>([]);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      const presetSet = new Set(allCategoryNames.map((c) => norm(c)));
      setPicked(
        initial
          .filter((s) => presetSet.has(norm(s.name)))
          .map((s) => ({ name: s.name, isCustom: false })),
      );
      setQuery("");
      setSaving(false);
    }
  }, [visible, initial]);

  const pickedSet = useMemo(() => new Set(picked.map((p) => norm(p.name))), [picked]);
  const q = query.trim();
  const matches = useMemo(() => {
    if (!q) return allCategoryNames;
    return allCategoryNames.filter((c) => matchesService(c, q));
  }, [q, allCategoryNames]);

  function togglePreset(name: string) {
    const key = norm(name);
    setPicked((cur) =>
      cur.some((s) => norm(s.name) === key)
        ? cur.filter((s) => norm(s.name) !== key)
        : [...cur, { name, isCustom: false }],
    );
  }

  function removePicked(name: string) {
    const key = norm(name);
    setPicked((cur) => cur.filter((s) => norm(s.name) !== key));
  }

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(picked);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[s.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            s.header,
            { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : insets.top + 8 },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={20} style={{ padding: 8 }}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[s.title, { color: colors.foreground }]}>Services</Text>
          <Pressable onPress={handleSave} disabled={saving} hitSlop={20} style={{ padding: 8 }}>
            <Text style={[s.save, { color: saving ? colors.mutedForeground : colors.primary }]}>
              {saving ? "…" : "Save"}
            </Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <View
            style={[
              s.searchRow,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search services"
              placeholderTextColor={colors.mutedForeground}
              style={[s.searchInput, { color: colors.foreground }]}
              autoCapitalize="words"
              autoCorrect={false}
              returnKeyType="done"
            />
          </View>
        </View>

        {picked.length > 0 ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>SELECTED</Text>
            <View style={s.chipWrap}>
              {picked.map((p) => (
                <Pressable
                  key={p.name}
                  onPress={() => removePicked(p.name)}
                  style={[s.chipActive, { backgroundColor: colors.primary }]}
                >
                  <Text style={[s.chipActiveText, { color: colors.primaryForeground ?? "#fff" }]}>
                    {displayServiceName(p.name)}
                  </Text>
                  <Feather name="x" size={12} color={colors.primaryForeground ?? "#fff"} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 24,
            gap: 14,
          }}
        >
          {q ? (
            <View style={{ gap: 8 }}>
              <Text style={[s.sectionLabel, { color: colors.mutedForeground }]}>
                MATCHES
              </Text>
              <View style={s.chipWrap}>
                {matches.map((name) => {
                  const active = pickedSet.has(norm(name));
                  return (
                    <Pressable
                      key={name}
                      onPress={() => togglePreset(name)}
                      style={[
                        active ? s.chipActive : s.chip,
                        {
                          borderColor: active ? colors.primary : colors.border,
                          backgroundColor: active ? colors.primary : colors.card,
                        },
                      ]}
                    >
                      <Text
                        style={
                          active
                            ? [s.chipActiveText, { color: colors.primaryForeground ?? "#fff" }]
                            : [s.chipText, { color: colors.foreground }]
                        }
                      >
                        {displayServiceName(name)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {matches.length === 0 ? (
                <Text style={{ color: colors.mutedForeground, fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 8 }}>
                  No matches. Try a different search term.
                </Text>
              ) : null}
            </View>
          ) : (
            groupView.map((group, idx) => (
              <View key={group.label} style={{ gap: 8 }}>
                {/* Group divider: thin gray hairline with the group name
                    sitting in-line on the left in a small muted label.
                    First group skips the top rule so the picker doesn't
                    open with a stray line above the very first label. */}
                <View style={[s.groupDivider, idx === 0 && s.groupDividerFirst]}>
                  <Text style={[s.groupLabel, { color: colors.mutedForeground }]}>
                    {group.label}
                  </Text>
                  <View style={[s.groupRule, { backgroundColor: colors.border }]} />
                </View>
                <View style={s.chipWrap}>
                  {group.items.map((name) => {
                    const active = pickedSet.has(norm(name));
                    return (
                      <Pressable
                        key={name}
                        onPress={() => togglePreset(name)}
                        style={[
                          active ? s.chipActive : s.chip,
                          {
                            borderColor: active ? colors.primary : colors.border,
                            backgroundColor: active ? colors.primary : colors.card,
                          },
                        ]}
                      >
                        <Text
                          style={
                            active
                              ? [s.chipActiveText, { color: colors.primaryForeground ?? "#fff" }]
                              : [s.chipText, { color: colors.foreground }]
                          }
                        >
                          {displayServiceName(name)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  save: { fontSize: 15, fontFamily: "Inter_700Bold" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular" },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
    marginBottom: 8,
  },
  // Divider row used between service groups in the picker. Renders the
  // group name (sentence case, small + muted) on the left, then a thin
  // hairline that fills the rest of the row to give the eye a clear
  // separator without being noisy.
  groupDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 8,
  },
  groupDividerFirst: {
    marginTop: 0,
  },
  groupLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },
  groupRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  chipActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipActiveText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  customTag: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  customTagText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
    color: "#fff",
  },
});
