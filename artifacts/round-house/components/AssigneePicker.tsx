import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { PropertyMember } from "@workspace/api-client-react";

interface Props {
  members: PropertyMember[];
  selected: string | null;
  onChange: (clerkId: string | null) => void;
}

export function AssigneePicker({ members, selected, onChange }: Props) {
  const colors = useColors();
  const active = members.filter((m) => !m.archivedAt);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      <TouchableOpacity
        onPress={() => onChange(null)}
        style={[
          styles.chip,
          {
            backgroundColor: selected === null ? colors.primary : colors.card,
            borderColor: selected === null ? colors.primary : colors.border,
          },
        ]}
      >
        <Feather
          name="user-x"
          size={13}
          color={selected === null ? colors.primaryForeground : colors.mutedForeground}
        />
        <Text
          style={[
            styles.chipText,
            { color: selected === null ? colors.primaryForeground : colors.foreground },
          ]}
        >
          Unassigned
        </Text>
      </TouchableOpacity>
      {active.map((m) => {
        const isSel = selected === m.userClerkId;
        return (
          <TouchableOpacity
            key={m.id}
            onPress={() => onChange(m.userClerkId)}
            style={[
              styles.chip,
              {
                backgroundColor: isSel ? colors.primary : colors.card,
                borderColor: isSel ? colors.primary : colors.border,
              },
            ]}
          >
            <View style={[styles.avatar, { backgroundColor: isSel ? colors.primaryForeground + "33" : colors.muted }]}>
              <Text
                style={[
                  styles.avatarText,
                  { color: isSel ? colors.primaryForeground : colors.foreground },
                ]}
              >
                {(m.user?.name || "?")[0].toUpperCase()}
              </Text>
            </View>
            <View>
              <Text
                style={[
                  styles.chipText,
                  { color: isSel ? colors.primaryForeground : colors.foreground },
                ]}
                numberOfLines={1}
              >
                {m.user?.name}
              </Text>
              {m.tradeType ? (
                <Text
                  style={[
                    styles.tradeText,
                    { color: isSel ? colors.primaryForeground : colors.mutedForeground },
                  ]}
                  numberOfLines={1}
                >
                  {m.tradeType}
                </Text>
              ) : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8, paddingVertical: 4 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 22,
    borderWidth: 1.5,
    maxWidth: 200,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  tradeText: { fontSize: 10, fontFamily: "Inter_400Regular", marginTop: 1 },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 11, fontFamily: "Inter_700Bold" },
});
