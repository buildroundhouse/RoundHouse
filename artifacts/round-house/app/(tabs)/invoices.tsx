import React, { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { TopBarAccountIdentity } from "@/components/TopBarAvatar";

type Tab = "invoices" | "estimates" | "receipts";

const TABS: { key: Tab; label: string; empty: string }[] = [
  { key: "invoices", label: "Invoices", empty: "No invoices yet" },
  { key: "estimates", label: "Estimates", empty: "No estimates yet" },
  { key: "receipts", label: "Receipts", empty: "No receipts yet" },
];

export default function InvoicesScreen({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState<Tab>("invoices");
  const current = TABS.find((t) => t.key === active)!;

  const topPad = embedded ? 4 : Platform.OS === "web" ? 24 : insets.top + 12;
  const bottomPad = embedded
    ? 24
    : Platform.OS === "web"
      ? 34 + 100
      : insets.bottom + 100;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad }]}>
        {embedded ? null : (
          <View style={styles.headerTop}>
            <TopBarAccountIdentity />
          </View>
        )}
        <View style={[styles.segmented, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {TABS.map((t) => {
            const isActive = active === t.key;
            return (
              <Pressable
                key={t.key}
                onPress={() => setActive(t.key)}
                style={[
                  styles.segment,
                  isActive ? { backgroundColor: colors.primary } : null,
                ]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: isActive ? colors.primaryForeground : colors.foreground },
                  ]}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: bottomPad, gap: 12 }}>
        <View style={[styles.empty, { borderColor: colors.border }]}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>{current.empty}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 8, gap: 12 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  segmented: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
  },
  segment: { flex: 1, paddingVertical: 8, alignItems: "center", borderRadius: 8 },
  segmentText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  empty: {
    paddingVertical: 28,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
  },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
