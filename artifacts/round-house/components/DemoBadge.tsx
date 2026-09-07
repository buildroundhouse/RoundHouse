/**
 * DemoBadge — small "DEMO" pill rendered next to any user-facing
 * identity that originated from an admin Wardrobe demo avatar.
 *
 * Goal (from the founder): anywhere demo data appears in the UI, the
 * person looking at the screen should be able to tell BEFORE they
 * interact that it isn't real production data. Behavior and
 * permissions are unchanged — this is a visual marker only.
 *
 * Render this badge inline next to:
 *  - search and autocomplete result rows
 *  - profile / avatar headers
 *  - business / entity headers
 *  - property headers and cards
 *  - inbox rows and message thread headers
 *  - notifications about demo entities
 *
 * Three sizes:
 *  - "sm"  — inline next to a name in a list row (default)
 *  - "md"  — header chips (profile / property / business hero)
 *  - "lg"  — large empty-state callouts (rare)
 */
import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

type Size = "sm" | "md" | "lg";

const SIZE_STYLES: Record<Size, { padH: number; padV: number; font: number; radius: number; letter: number }> = {
  sm: { padH: 5, padV: 1, font: 9, radius: 3, letter: 0.6 },
  md: { padH: 7, padV: 2, font: 10, radius: 4, letter: 0.7 },
  lg: { padH: 9, padV: 3, font: 12, radius: 5, letter: 0.8 },
};

export function DemoBadge({
  size = "sm",
  style,
}: {
  size?: Size;
  style?: StyleProp<ViewStyle>;
}) {
  const s = SIZE_STYLES[size];
  return (
    <View
      accessibilityLabel="Demo data"
      style={[
        styles.badge,
        {
          paddingHorizontal: s.padH,
          paddingVertical: s.padV,
          borderRadius: s.radius,
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.text,
          { fontSize: s.font, letterSpacing: s.letter },
        ]}
      >
        DEMO
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: "#7C3AED", // distinct from PRO orange so the two badges read as different things
    alignSelf: "flex-start",
  },
  text: {
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
  },
});
