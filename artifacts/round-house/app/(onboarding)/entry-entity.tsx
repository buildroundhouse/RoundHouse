import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { getEntryChoice } from "@/lib/entry-intake";

/**
 * UX contract for the second Entry step.
 * Search-before-create is deliberate: one real Property or Business should
 * map to one Roundhouse entity. Search and create are placeholders until the
 * new entity API is built; this screen makes no legacy user_modes writes.
 */
export default function EntryEntityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { path } = useLocalSearchParams<{ path?: string }>();
  const choice = useMemo(() => getEntryChoice(path), [path]);
  const [query, setQuery] = useState("");

  if (!choice) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  const entityLabel = choice.entityKind === "property" ? "property" : "business";
  const hasQuery = query.trim().length > 1;

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} style={styles.back} hitSlop={12}>
          <Feather name="chevron-left" size={22} color={colors.foreground} />
          <Text style={[styles.backText, { color: colors.foreground }]}>Back</Text>
        </Pressable>

        <Text style={[styles.eyebrow, { color: colors.primary }]}>{choice.label}</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Find the {entityLabel}</Text>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          Roundhouse searches first so the same real-world {entityLabel} does not get a second record.
        </Text>

        <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={19} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={choice.entityKind === "property" ? "Address or property name" : "Business name"}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground }]}
            autoCorrect={false}
            autoCapitalize="words"
          />
        </View>

        {hasQuery ? (
          <View style={[styles.notice, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Text style={[styles.noticeTitle, { color: colors.foreground }]}>Search connection comes next</Text>
            <Text style={[styles.noticeText, { color: colors.mutedForeground }]}>
              This front-first build intentionally stops before Replit's mode/account APIs. The next backend slice will return possible entity matches here.
            </Text>
          </View>
        ) : null}

        <Text style={[styles.or, { color: colors.mutedForeground }]}>Can't find it?</Text>
        <Pressable
          onPress={() => {}}
          style={({ pressed }) => [
            styles.createButton,
            { borderColor: colors.border, backgroundColor: colors.card, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Feather name="plus-circle" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.createTitle, { color: colors.foreground }]}>Create this {entityLabel}</Text>
            <Text style={[styles.createText, { color: colors.mutedForeground }]}>
              Creating the record establishes stewardship. It does not by itself prove ownership.
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 32, gap: 12 },
  back: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8 },
  backText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  eyebrow: { fontSize: 12, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.7 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  intro: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 8 },
  searchBox: { borderWidth: 1, borderRadius: 14, minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 10 },
  input: { flex: 1, fontSize: 15, fontFamily: "Inter_400Regular", paddingVertical: 12 },
  notice: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 4 },
  noticeTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  noticeText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  or: { fontSize: 13, fontFamily: "Inter_500Medium", textAlign: "center", marginVertical: 4 },
  createButton: { borderWidth: 1, borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  createTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  createText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17, marginTop: 2 },
});
