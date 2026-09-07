import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { RewardsBadge } from "@workspace/api-client-react";

const TIER_COLORS: Record<string, { fg: string; bg: string }> = {
  bronze: { fg: "#8B5A2B", bg: "#F2E6D8" },
  silver: { fg: "#5A6470", bg: "#E5E9EE" },
  gold: { fg: "#9A7B00", bg: "#FFF3C4" },
  platinum: { fg: "#3B4856", bg: "#E2E8EE" },
};

interface Props {
  badges: RewardsBadge[];
}

export function BadgesGrid({ badges }: Props) {
  const colors = useColors();
  const [activeKey, setActiveKey] = React.useState<string | null>(null);
  const active = badges.find((b) => b.key === activeKey) ?? null;

  return (
    <View style={styles.container}>
      <View style={styles.grid}>
        {badges.map((b) => {
          const tone = TIER_COLORS[b.tier] ?? TIER_COLORS.bronze;
          const earned = b.earned;
          return (
            <Pressable
              key={b.key}
              onPress={() => setActiveKey(b.key === activeKey ? null : b.key)}
              style={[
                styles.tile,
                {
                  backgroundColor: earned ? tone.bg : colors.muted,
                  borderColor: earned ? tone.fg : colors.border,
                  opacity: earned ? 1 : 0.55,
                },
              ]}
            >
              <Feather
                name={earned ? "award" : "lock"}
                size={22}
                color={earned ? tone.fg : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.label,
                  { color: earned ? tone.fg : colors.mutedForeground },
                ]}
                numberOfLines={2}
              >
                {b.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {active ? (
        <View style={[styles.detail, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Text style={[styles.detailTitle, { color: colors.foreground }]}>{active.label}</Text>
          <Text style={[styles.detailBody, { color: colors.mutedForeground }]}>
            {active.description}
          </Text>
          {!active.earned ? (
            <Text style={[styles.detailHow, { color: colors.foreground }]}>
              How to earn: {active.howTo}
            </Text>
          ) : (
            <Text style={[styles.detailHow, { color: colors.foreground }]}>Earned ✓</Text>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  tile: {
    width: "31%",
    aspectRatio: 1,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  detail: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  detailTitle: { fontFamily: "Inter_700Bold", fontSize: 14 },
  detailBody: { fontFamily: "Inter_400Regular", fontSize: 13 },
  detailHow: { fontFamily: "Inter_600SemiBold", fontSize: 12, marginTop: 4 },
});
