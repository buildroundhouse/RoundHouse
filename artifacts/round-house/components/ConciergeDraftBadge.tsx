import React from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

interface Props {
  style?: StyleProp<ViewStyle>;
}

/**
 * Small pill rendered next to a message (in the inbox row preview and inside
 * the thread bubble) whenever `MessageItem.source === "concierge_draft"`.
 * The wording matches the spec from Task #585: messages drafted by the AI
 * concierge that the sender confirmed and sent via `POST /concierge/send-draft`.
 *
 * Rendering this badge is purely additive — it never modifies the message
 * content, it just sits beside the bubble so both the recipient and the
 * sender's own copy can see how the message was composed.
 */
export function ConciergeDraftBadge({ style }: Props) {
  const colors = useColors();
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="Drafted with concierge"
      style={[
        styles.badge,
        {
          backgroundColor: colors.muted,
          borderColor: colors.border,
        },
        style,
      ]}
    >
      <Feather name="zap" size={10} color={colors.mutedForeground} />
      <Text
        style={[styles.label, { color: colors.mutedForeground }]}
        numberOfLines={1}
      >
        drafted with concierge
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: "flex-start",
  },
  label: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },
});
