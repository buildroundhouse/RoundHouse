import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { displayServiceName } from "@/lib/serviceCategories";
import type { ServiceEntry } from "@workspace/api-client-react";

type Props = {
  services: ServiceEntry[];
  editable?: boolean;
  onEdit?: () => void;
};

export function ServicesSection({ services, editable, onEdit }: Props) {
  const colors = useColors();
  const items = services ?? [];
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.headerRow}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>SERVICES</Text>
        {editable ? (
          <Pressable hitSlop={10} onPress={onEdit} style={styles.editBtn}>
            <Feather name="edit-2" size={12} color={colors.mutedForeground} />
            <Text style={[styles.editText, { color: colors.mutedForeground }]}>Edit</Text>
          </Pressable>
        ) : null}
      </View>
      {items.length === 0 ? (
        <Pressable
          onPress={onEdit}
          disabled={!editable}
          style={[
            styles.emptyBox,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            {editable ? "Add the services you offer so customers know what you do." : "No services listed."}
          </Text>
        </Pressable>
      ) : (
        <View style={styles.chipWrap}>
          {items.map((s) => (
            <View
              key={s.name}
              style={[styles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.chipText, { color: colors.foreground }]}>{displayServiceName(s.name)}</Text>
              {s.isCustom ? (
                <View style={[styles.customTag, { borderColor: colors.border, backgroundColor: colors.muted }]}>
                  <Text style={[styles.customTagText, { color: colors.mutedForeground }]}>Custom</Text>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  label: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
  },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  editText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  customTag: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  customTagText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },
  emptyBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
});
