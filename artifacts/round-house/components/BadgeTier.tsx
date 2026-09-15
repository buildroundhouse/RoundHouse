import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

export interface Tier {
  key: "wood" | "iron";
  label: string;
  fg: string;
  bg: string;
  min: number;
}

// Current Reward Center direction. Additional status names and thresholds remain
// configurable; legacy Bronze / Silver / Gold / Platinum must not surface here.
const TIERS: Tier[] = [
  { key: "wood", label: "Wood", fg: "#6F4E37", bg: "#EFE2D2", min: 0 },
  { key: "iron", label: "Iron", fg: "#4E5964", bg: "#E4E8EB", min: 1500 },
];

export function tierForScore(score: number): Tier {
  let current = TIERS[0];
  for (const t of TIERS) if (score >= t.min) current = t;
  return current;
}

export function nextTier(score: number): Tier | null {
  for (const t of TIERS) if (t.min > score) return t;
  return null;
}

interface Props {
  score: number;
  size?: "sm" | "md";
  onPress?: () => void;
}

export function BadgeTier({ score, size = "sm", onPress }: Props) {
  const tier = tierForScore(score);
  const dim = size === "md" ? 14 : 12;
  const padV = size === "md" ? 4 : 2;
  const padH = size === "md" ? 10 : 8;
  const fontSize = size === "md" ? 13 : 12;

  const content = (
    <View style={[styles.pill, { backgroundColor: tier.bg, paddingVertical: padV, paddingHorizontal: padH }]}>
      <Feather name="award" size={dim} color={tier.fg} />
      <Text style={[styles.text, { color: tier.fg, fontSize }]}>{tier.label}</Text>
    </View>
  );

  if (!onPress) return content;
  return <Pressable onPress={onPress} hitSlop={8}>{content}</Pressable>;
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, alignSelf: "flex-start" },
  text: { fontFamily: "Inter_700Bold" },
});
