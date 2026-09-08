import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { ENTRY_CHOICES, type EntryChoice } from "@/lib/entry-intake";

/**
 * Entry is intentionally front-first.
 *
 * This screen does not activate a legacy mode and does not write to the API.
 * It establishes the UX and vocabulary first. Backend entity search, claims,
 * stewardship, memberships and permissions will be attached behind this flow
 * only after their contracts are rebuilt around Roundhouse entities.
 */
export default function EntryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const choose = (choice: EntryChoice) => {
    router.push({
      pathname: "/(onboarding)/entry-entity",
      params: { path: choice.kind },
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.title, { color: colors.foreground }]}>How are you entering Roundhouse?</Text>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Pick what fits right now. This does not permanently define your account.
        </Text>

        {ENTRY_CHOICES.map((choice) => (
          <Pressable
            key={choice.kind}
            onPress={() => choose(choice)}
            style={({ pressed }) => [
              styles.tile,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <View style={[styles.tileIcon, { backgroundColor: colors.primary + "22" }]}>
              <Feather name={choice.icon} size={22} color={colors.primary} />
            </View>
            <View style={styles.tileBody}>
              <Text style={[styles.tileTitle, { color: colors.foreground }]}>{choice.label}</Text>
              <Text style={[styles.tileDescription, { color: colors.mutedForeground }]}>
                {choice.description}
              </Text>
              <Text style={[styles.tileTagline, { color: colors.primary }]}>{choice.tagline}</Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 32, gap: 12 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", marginTop: 4 },
  intro: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 12 },
  tile: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  tileIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  tileBody: { flex: 1 },
  tileTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  tileDescription: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 2 },
  tileTagline: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 4, fontStyle: "italic" },
});
