import React from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import { useRouter, usePathname } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useProfile } from "@/lib/profile";
import { ADMIN_THEME } from "@/lib/adminTheme";

export function AdminQuickExit() {
  const { profile } = useProfile();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  if (!profile?.isAdmin) return null;
  if (
    pathname?.startsWith("/account/admin") ||
    pathname?.startsWith("/account/rooms") ||
    pathname?.startsWith("/account/wardrobe") ||
    pathname?.startsWith("/account/skins")
  ) {
    return null;
  }

  return (
    <View pointerEvents="box-none" style={[s.wrap, { top: insets.top + 56 }]}>
      <Pressable
        onPress={() => router.replace("/account/admin")}
        accessibilityRole="button"
        accessibilityLabel="Back to admin hub"
        style={({ pressed }) => [
          s.chip,
          { transform: [{ scale: pressed ? 0.96 : 1 }] },
        ]}
      >
        <Feather name="chevron-left" size={14} color={ADMIN_THEME.brassBright} />
        <Text style={s.label}>HUB</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: "absolute",
    right: 12,
    zIndex: 9999,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: ADMIN_THEME.velvetDeep,
    borderWidth: 1.5,
    borderColor: ADMIN_THEME.brass,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  label: {
    color: ADMIN_THEME.brassBright,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 2,
  },
});
