import React, { type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import type { EntryChoice } from "@/lib/entry-intake";
export function EntryStep({
  title,
  intro,
  step,
  choices = [],
  onSelect,
  children,
}: {
  title: string;
  intro: string;
  step: number;
  choices?: EntryChoice[];
  onSelect?: (value: string) => void;
  children?: ReactNode;
}) {
  const colors = useColors(),
    insets = useSafeAreaInsets(),
    router = useRouter();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace("/(onboarding)/entry")
          }
          style={styles.back}
        >
          <Feather name="chevron-left" size={24} color={colors.foreground} />
          <Text style={{ color: colors.foreground }}>Back</Text>
        </Pressable>
        <Text style={{ color: colors.mutedForeground }}>Step {step}</Text>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.foreground }]}
        >
          {title}
        </Text>
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>
          {intro}
        </Text>
        {choices.map((choice) => (
          <Pressable
            key={choice.value}
            accessibilityRole="button"
            accessibilityLabel={choice.label}
            onPress={() => onSelect?.(choice.value)}
            style={({ pressed }) => [
              styles.tile,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                opacity: pressed ? 0.8 : 1,
              },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: colors.foreground }]}>
                {choice.label}
              </Text>
              {choice.description ? (
                <Text
                  style={[
                    styles.description,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {choice.description}
                </Text>
              ) : null}
            </View>
            <Feather
              name="chevron-right"
              size={22}
              color={colors.mutedForeground}
            />
          </Pressable>
        ))}
        {children}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 20, gap: 12 },
  back: {
    minHeight: 48,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 24,
  },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  intro: { fontSize: 15, lineHeight: 22, marginBottom: 8 },
  tile: {
    minHeight: 64,
    padding: 18,
    borderWidth: 1,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  label: { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  description: { fontSize: 14, lineHeight: 20, marginTop: 4 },
});
