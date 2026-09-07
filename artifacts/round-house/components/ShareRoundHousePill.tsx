import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { RisingSunSticker } from "./RisingSunSticker";

export function ShareRoundHousePill({
  onPress,
  onLongPress,
  accentColor,
}: {
  onPress: () => void;
  onLongPress?: () => void;
  accentColor?: string;
}) {
  const tint = accentColor ?? "#FFC83D";
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel="Share Round House and earn 10 points"
      style={({ pressed }) => [styles.pill, { opacity: pressed ? 0.85 : 1 }]}
    >
      <Feather name="share-2" size={11} color={tint} />
      <Text style={[styles.label, { color: tint }]}>Share</Text>
      <View style={styles.sticker}>
        <RisingSunSticker size={18} points={10} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingLeft: 8,
    paddingRight: 12,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(14,17,22,0.85)",
    borderWidth: 1,
    borderColor: "rgba(255,200,61,0.6)",
  },
  label: { fontFamily: "Inter_600SemiBold", fontSize: 11 },
  sticker: { position: "absolute", right: -5, top: -6 },
});
