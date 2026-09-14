import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

/** Direct navigation preserves the active avatar and works without back history. */
export function ProfileNavigation({ title = "Profile", onExit }: { title?: string; onExit?: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.background, borderColor: colors.border }]}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back to Command Center" testID="profile-back-command-center"
      onPress={onExit ?? (() => router.replace("/(tabs)"))} style={styles.back}>
      <Feather name="arrow-left" size={26} color={colors.foreground}/>
      <Text style={[styles.backText, { color: colors.foreground }]}>Back to Command Center</Text>
    </Pressable>
    <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
  </View>;
}
const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: 1, gap: 12 },
  back: { flex: 1, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  backText: { flexShrink: 1, fontSize: 14, fontWeight: "600" },
  title: { fontSize: 15, fontWeight: "600", flexShrink: 1 },
});
