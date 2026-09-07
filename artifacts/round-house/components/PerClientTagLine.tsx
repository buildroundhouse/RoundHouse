import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { composeLabelChipLine } from "@/lib/connectionTags";

export type ConnectionTag = {
  roleContext?: string | null;
  serviceTitle?: string | null;
  onSiteIdentity?: string | null;
  onSiteIdentityOther?: string | null;
  chip?: string | null;
  chipOther?: string | null;
} | null | undefined;

type Props = {
  tag: ConnectionTag;
  colors: ReturnType<typeof useColors>;
  alignRight?: boolean;
  compact?: boolean;
};

// #537/#545 — Renders the composed `Label · Chip` line under a
// person's name. Used on the work-order detail screen, comment rows
// and the work-order list cards (Mine tab + per-property list) so
// every place a name appears can show the viewer's per-client tag.
// Returns null when the viewer has no per-client tag for this person.
export function PerClientTagLine({ tag, colors, alignRight, compact }: Props) {
  if (!tag) return null;
  const composed = composeLabelChipLine({
    roleContext: tag.roleContext ?? null,
    serviceTitle: tag.serviceTitle ?? null,
    onSiteIdentity: tag.onSiteIdentity ?? null,
    onSiteIdentityOther: tag.onSiteIdentityOther ?? null,
    chip: tag.chip ?? null,
    chipOther: tag.chipOther ?? null,
  });
  if (!composed.label && !composed.chip) return null;
  return (
    <View
      style={[
        styles.row,
        alignRight ? { justifyContent: "flex-end" } : { justifyContent: "flex-start" },
      ]}
    >
      {composed.label ? (
        <Text
          style={[
            compact ? styles.labelCompact : styles.label,
            { color: colors.foreground },
          ]}
          numberOfLines={1}
        >
          {composed.label}
        </Text>
      ) : null}
      {composed.label && composed.chip ? (
        <Text
          style={[
            compact ? styles.dotCompact : styles.dot,
            { color: colors.mutedForeground },
          ]}
        >
          {" · "}
        </Text>
      ) : null}
      {composed.chip ? (
        <View
          style={[
            compact ? styles.chipCompact : styles.chip,
            { borderColor: colors.border, backgroundColor: colors.muted },
          ]}
        >
          <Text
            style={[
              compact ? styles.chipTextCompact : styles.chipText,
              { color: colors.foreground },
            ]}
          >
            {composed.chip}
            {composed.chipHeart ? " ♥" : ""}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 2,
  },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  dot: { fontSize: 13, fontFamily: "Inter_500Medium" },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.2 },
  labelCompact: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  dotCompact: { fontSize: 11, fontFamily: "Inter_500Medium" },
  chipCompact: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipTextCompact: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.2 },
});
