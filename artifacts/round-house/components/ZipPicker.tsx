import React, { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { ZipMap } from "./ZipMap";

const ZIP_RE = /^\d{5}$/;

interface Props {
  primaryZip: string;
  value: string[];
  onChange: (next: string[]) => void;
  /** How many nearby suggestions to show by default before "Show more". */
  initialSuggestionCount?: number;
}

/**
 * Visual / guided picker for served ZIP codes around a primary ZIP.
 *
 * Replaces the previous comma-separated text input. Strategy:
 *   - Shows currently-selected ZIPs as removable chips.
 *   - Surfaces "nearby" ZIP suggestions seeded from the primary ZIP
 *     (numerically adjacent ZIPs sharing the same first 3 digits — i.e.
 *     same USPS sectional center — which generally cluster geographically).
 *   - Lets pros add any other 5-digit ZIP via an inline add field for
 *     ZIPs not in the suggestion grid.
 */
export function ZipPicker({ primaryZip, value, onChange, initialSuggestionCount = 12 }: Props) {
  const colors = useColors();
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState("");
  const [showAll, setShowAll] = useState(false);

  const selected = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const z of value) {
      if (ZIP_RE.test(z) && !seen.has(z) && z !== primaryZip) {
        seen.add(z);
        out.push(z);
      }
    }
    return out;
  }, [value, primaryZip]);

  const allNearby = useMemo(() => nearbyZipSuggestions(primaryZip, 50), [primaryZip]);
  const visibleNearby = showAll ? allNearby : allNearby.slice(0, initialSuggestionCount);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = (zip: string) => {
    if (!ZIP_RE.test(zip) || zip === primaryZip) return;
    if (selectedSet.has(zip)) {
      onChange(selected.filter((z) => z !== zip));
    } else {
      onChange([...selected, zip]);
    }
  };

  const remove = (zip: string) => onChange(selected.filter((z) => z !== zip));

  const submitDraft = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (!ZIP_RE.test(trimmed)) {
      setDraftError("Enter a 5-digit ZIP.");
      return;
    }
    if (trimmed === primaryZip) {
      setDraftError("That's your primary ZIP.");
      return;
    }
    if (selectedSet.has(trimmed)) {
      setDraftError("Already added.");
      return;
    }
    onChange([...selected, trimmed]);
    setDraft("");
    setDraftError("");
  };

  const hasPrimary = ZIP_RE.test(primaryZip);

  return (
    <View style={styles.wrap}>
      {/* Selected chips (primary + additional) */}
      <View style={styles.chips}>
        {hasPrimary ? (
          <View style={[styles.chip, styles.primaryChip, { backgroundColor: colors.primary, borderColor: colors.primary }]}>
            <Feather name="map-pin" size={11} color={colors.primaryForeground} />
            <Text style={[styles.chipText, { color: colors.primaryForeground }]}>{primaryZip}</Text>
            <Text style={[styles.primaryTag, { color: colors.primaryForeground }]}>· primary</Text>
          </View>
        ) : null}
        {selected.map((zip) => (
          <Pressable
            key={zip}
            onPress={() => remove(zip)}
            accessibilityLabel={`Remove ZIP ${zip}`}
            accessibilityRole="button"
            style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Text style={[styles.chipText, { color: colors.foreground }]}>{zip}</Text>
            <Feather name="x" size={12} color={colors.mutedForeground} />
          </Pressable>
        ))}
        {!hasPrimary && selected.length === 0 ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            Enter your primary ZIP above to see nearby suggestions.
          </Text>
        ) : null}
      </View>

      {/* Real map of primary + selected + nearby ZIPs */}
      {hasPrimary ? (
        <ZipMap
          primaryZip={primaryZip}
          selected={selected}
          candidates={allNearby.slice(0, 24)}
          onToggle={toggle}
        />
      ) : null}

      {/* Nearby suggestions */}
      {hasPrimary && allNearby.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            NEARBY ZIPS · tap to add
          </Text>
          <View style={styles.grid}>
            {visibleNearby.map((zip) => {
              const isOn = selectedSet.has(zip);
              return (
                <Pressable
                  key={zip}
                  onPress={() => toggle(zip)}
                  style={[
                    styles.suggestion,
                    {
                      backgroundColor: isOn ? colors.primary : colors.card,
                      borderColor: isOn ? colors.primary : colors.border,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isOn }}
                  accessibilityLabel={`${isOn ? "Remove" : "Add"} ZIP ${zip}`}
                >
                  <Text
                    style={[
                      styles.suggestionText,
                      { color: isOn ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {zip}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {allNearby.length > initialSuggestionCount ? (
            <Pressable
              onPress={() => setShowAll((s) => !s)}
              style={styles.showMore}
              hitSlop={8}
            >
              <Text style={[styles.showMoreText, { color: colors.primary }]}>
                {showAll ? "Show fewer" : `Show all ${allNearby.length} nearby`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Manual add */}
      <View style={styles.section}>
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          ADD ANOTHER ZIP
        </Text>
        <View style={styles.addRow}>
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.card,
                borderColor: draftError ? "#E55" : colors.border,
                color: colors.foreground,
              },
            ]}
            value={draft}
            onChangeText={(t) => {
              setDraft(t.replace(/[^\d]/g, "").slice(0, 5));
              if (draftError) setDraftError("");
            }}
            placeholder="ZIP"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="number-pad"
            maxLength={5}
            onSubmitEditing={submitDraft}
            returnKeyType="done"
          />
          <Pressable
            onPress={submitDraft}
            disabled={draft.length === 0}
            style={[
              styles.addBtn,
              {
                backgroundColor: draft.length === 5 ? colors.primary : colors.muted,
                opacity: draft.length === 0 ? 0.5 : 1,
              },
            ]}
          >
            <Feather
              name="plus"
              size={16}
              color={draft.length === 5 ? colors.primaryForeground : colors.mutedForeground}
            />
            <Text
              style={[
                styles.addBtnText,
                {
                  color: draft.length === 5 ? colors.primaryForeground : colors.mutedForeground,
                },
              ]}
            >
              Add
            </Text>
          </Pressable>
        </View>
        {draftError ? (
          <Text style={[styles.error, { color: "#E55" }]}>{draftError}</Text>
        ) : null}
      </View>
    </View>
  );
}

/**
 * Generate a list of nearby ZIP candidates from a primary ZIP.
 * Shares the first 3 digits (USPS sectional center) and is sorted by
 * numeric distance to the primary's last-two digits — a simple proxy
 * for geographic proximity that requires no external data.
 */
export function nearbyZipSuggestions(primary: string, count = 50): string[] {
  if (!ZIP_RE.test(primary)) return [];
  const prefix = primary.slice(0, 3);
  const base = parseInt(primary.slice(3), 10);
  const candidates: { zip: string; dist: number }[] = [];
  for (let i = 0; i < 100; i++) {
    if (i === base) continue;
    const last = String(i).padStart(2, "0");
    candidates.push({ zip: `${prefix}${last}`, dist: Math.abs(i - base) });
  }
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates.slice(0, count).map((c) => c.zip);
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  primaryChip: { paddingRight: 14 },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  primaryTag: { fontSize: 11, fontFamily: "Inter_500Medium", opacity: 0.85 },
  empty: { fontSize: 12, fontFamily: "Inter_400Regular", paddingVertical: 4 },
  section: { gap: 8 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  suggestion: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 56,
    alignItems: "center",
  },
  suggestionText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  showMore: { paddingTop: 4, alignSelf: "flex-start" },
  showMoreText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
    letterSpacing: 1,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 14,
    height: 44,
    borderRadius: 10,
  },
  addBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  error: { fontSize: 12, fontFamily: "Inter_400Regular" },
});
