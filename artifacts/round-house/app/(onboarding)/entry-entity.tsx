import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { getEntryChoice } from "@/lib/entry-intake";

export default function EntryEntityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { path } = useLocalSearchParams<{ path?: string }>();
  const choice = useMemo(() => getEntryChoice(path), [path]);
  const [query, setQuery] = useState("");

  if (!choice) return <View style={{ flex: 1, backgroundColor: colors.background }} />;

  const isProperty = choice.entityKind === "property";
  const isBusiness = choice.entityKind === "business";
  const entity = isProperty ? "property" : isBusiness ? "business" : "property or business";
  const hasQuery = query.trim().length > 0;

  const intro = isProperty
    ? "Search first so an existing property keeps one permanent Roundhouse record."
    : isBusiness
      ? "Search first so an existing business keeps one permanent Roundhouse record."
      : "Search first so an existing property or business keeps one permanent Roundhouse record.";

  const addLabel = isProperty ? "Add property" : isBusiness ? "Add business" : "Add new record";

  return (
    <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => router.back()} style={styles.back}>
          <Feather name="chevron-left" size={22} color={colors.foreground} />
          <Text style={{ color: colors.foreground }}>Back</Text>
        </Pressable>

        <Text style={[styles.eyebrow, { color: colors.primary }]}>{choice.label}</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Find the {entity}</Text>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>{intro}</Text>

        <View style={[styles.search, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={19} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={isProperty ? "Address or property name" : isBusiness ? "Business name" : "Property or business"}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { color: colors.foreground }]}
            returnKeyType="search"
          />
        </View>

        {hasQuery ? (
          <Pressable
            onPress={() => {}}
            style={({ pressed }) => [
              styles.addButton,
              { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Feather name="plus-circle" size={20} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.addTitle, { color: colors.foreground }]}>{addLabel}</Text>
              <Text style={[styles.addText, { color: colors.mutedForeground }]}>{query.trim()}</Text>
            </View>
            <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingBottom: 32, gap: 12 },
  back: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8 },
  eyebrow: { fontSize: 12, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  intro: { fontSize: 14, lineHeight: 20 },
  search: { borderWidth: 1, borderRadius: 14, minHeight: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 10 },
  input: { flex: 1, fontSize: 15, paddingVertical: 12 },
  addButton: { borderWidth: 1, borderRadius: 16, padding: 16, flexDirection: "row", alignItems: "center", gap: 12 },
  addTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  addText: { fontSize: 13, lineHeight: 18, marginTop: 2 },
});
