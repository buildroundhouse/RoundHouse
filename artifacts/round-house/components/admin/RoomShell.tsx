import React from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Stack, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { ADMIN_THEME } from "@/lib/adminTheme";

interface RoomShellProps {
  title: string;
  marquee?: string;
  tagline?: string;
  bgGrad: readonly [string, string];
  accent: string;
  glow?: string;
  icon?: React.ComponentProps<typeof Feather>["name"];
  children: React.ReactNode;
}

export function RoomShell({
  title,
  marquee,
  tagline,
  bgGrad,
  accent,
  glow,
  icon,
  children,
}: RoomShellProps) {
  const router = useRouter();
  return (
    <LinearGradient
      colors={bgGrad}
      style={{ flex: 1 }}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingTop: 56,
          paddingBottom: 80,
          gap: 24,
        }}
      >
        <View style={s.topbar}>
          <LobbyChip accent={accent} onPress={() => router.back()} />
        </View>

        <View style={[s.marqueeWrap, { borderColor: accent }]}>
          <View style={[s.marqueeBulbsRow, { backgroundColor: ADMIN_THEME.velvetDeep }]}>
            {Array.from({ length: 14 }).map((_, i) => (
              <View
                key={i}
                style={[
                  s.bulb,
                  {
                    backgroundColor: i % 2 === 0 ? accent : (glow ?? accent),
                    shadowColor: glow ?? accent,
                  },
                ]}
              />
            ))}
          </View>
          <View style={[s.marqueeBody, { backgroundColor: ADMIN_THEME.velvet }]}>
            {marquee ? (
              <Text style={[s.marqueeKicker, { color: accent }]}>
                {marquee}
              </Text>
            ) : null}
            <Text style={[s.marqueeTitle, { color: ADMIN_THEME.bone }]}>
              {title}
            </Text>
            {tagline ? (
              <Text
                style={[s.marqueeTag, { color: ADMIN_THEME.ash }]}
                numberOfLines={1}
              >
                {tagline}
              </Text>
            ) : null}
          </View>
          <View style={[s.marqueeBulbsRow, { backgroundColor: ADMIN_THEME.velvetDeep }]}>
            {Array.from({ length: 14 }).map((_, i) => (
              <View
                key={`b${i}`}
                style={[
                  s.bulb,
                  {
                    backgroundColor: i % 2 === 0 ? (glow ?? accent) : accent,
                    shadowColor: glow ?? accent,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        {icon ? (
          <View style={{ alignItems: "center", marginTop: -8 }}>
            <View
              style={[
                s.crest,
                {
                  borderColor: accent,
                  backgroundColor: "rgba(0,0,0,0.35)",
                },
              ]}
            >
              <Feather name={icon} size={22} color={accent} />
            </View>
          </View>
        ) : null}

        <View style={{ gap: 16 }}>{children}</View>
      </ScrollView>
    </LinearGradient>
  );
}

export function LobbyChip({
  accent,
  onPress,
  label = "Lobby",
}: {
  accent: string;
  onPress: () => void;
  label?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={`Back to ${label}`}
      style={[s.brassChip, { borderColor: accent }]}
    >
      <Feather name="chevron-left" size={16} color={accent} />
      <Text style={[s.brassChipText, { color: accent }]}>{label}</Text>
    </Pressable>
  );
}

export function VelvetCard({
  children,
  accent,
}: {
  children: React.ReactNode;
  accent: string;
}) {
  return (
    <View
      style={[
        s.velvetCard,
        { borderColor: accent, backgroundColor: "rgba(0,0,0,0.35)" },
      ]}
    >
      {children}
    </View>
  );
}

export function BrassButton({
  label,
  onPress,
  accent,
  icon,
}: {
  label: string;
  onPress: () => void;
  accent: string;
  icon?: React.ComponentProps<typeof Feather>["name"];
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.brassBtn,
        {
          borderColor: accent,
          backgroundColor: pressed ? "rgba(255,255,255,0.05)" : "transparent",
          transform: [{ translateY: pressed ? 1 : 0 }],
        },
      ]}
    >
      {icon ? <Feather name={icon} size={16} color={accent} /> : null}
      <Text style={[s.brassBtnText, { color: accent }]}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  topbar: {
    flexDirection: "row",
    alignItems: "center",
  },
  brassChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  brassChipText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  marqueeWrap: {
    borderWidth: 2,
    borderRadius: 14,
    overflow: "hidden",
  },
  marqueeBulbsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  bulb: {
    width: 6,
    height: 6,
    borderRadius: 3,
    shadowOpacity: 0.9,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 0 },
  },
  marqueeBody: {
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 4,
  },
  marqueeKicker: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 4,
    textTransform: "uppercase",
  },
  marqueeTitle: {
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: 2,
    textAlign: "center",
  },
  marqueeTag: {
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  crest: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  velvetCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  brassBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  brassBtnText: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
});
