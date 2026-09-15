import React from "react";
import { Pressable, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

export function SetupRetry({ onRetry }: { onRetry: () => void }) {
  const colors = useColors();
  return <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 16, backgroundColor: colors.background }}>
    <Text style={{ color: colors.foreground }}>Couldn't check your space access. Your saved setup is safe.</Text>
    <Pressable accessibilityRole="button" onPress={onRetry} style={{ minHeight: 48, justifyContent: "center" }}>
      <Text style={{ color: colors.primary }}>Try again</Text>
    </Pressable>
  </View>;
}
