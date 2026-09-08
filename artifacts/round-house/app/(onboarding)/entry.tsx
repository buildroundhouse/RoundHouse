import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { ENTRY_CHOICES } from "@/lib/entry-intake";

export default function EntryScreen() {
  const colors = useColors(); const insets = useSafeAreaInsets(); const router = useRouter();
  return <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}><ScrollView contentContainerStyle={styles.scroll}>
    <Text style={[styles.title, { color: colors.foreground }]}>How are you accessing Roundhouse?</Text>
    <Text style={[styles.intro, { color: colors.mutedForeground }]}>Choose what you are trying to access or establish right now.</Text>
    {ENTRY_CHOICES.map((choice) => <Pressable key={choice.kind} onPress={() => router.push({ pathname: "/(onboarding)/entry-entity", params: { path: choice.kind } })} style={({ pressed }) => [styles.tile, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}><View style={[styles.icon, { backgroundColor: colors.primary + "22" }]}><Feather name={choice.icon} size={22} color={colors.primary} /></View><View style={{ flex: 1 }}><Text style={[styles.tileTitle, { color: colors.foreground }]}>{choice.label}</Text><Text style={[styles.description, { color: colors.mutedForeground }]}>{choice.description}</Text></View><Feather name="chevron-right" size={20} color={colors.mutedForeground} /></Pressable>)}
  </ScrollView></View>;
}
const styles = StyleSheet.create({ root: { flex: 1 }, scroll: { paddingHorizontal: 20, paddingBottom: 32, gap: 12 }, title: { fontSize: 26, fontFamily: "Inter_700Bold", marginTop: 4 }, intro: { fontSize: 14, lineHeight: 20, marginBottom: 12 }, tile: { borderWidth: 1, borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 14 }, icon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }, tileTitle: { fontSize: 16, fontFamily: "Inter_700Bold" }, description: { fontSize: 13, lineHeight: 18, marginTop: 2 } });
