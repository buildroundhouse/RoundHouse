import React from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { resolveStorageUrl } from "@/lib/uploads";
import type { RelationshipPerson } from "@workspace/api-client-react";

interface Props {
  people: RelationshipPerson[];
  onPress: () => void;
  loading?: boolean;
}

export function PeoplePreview({ people, onPress, loading }: Props) {
  const colors = useColors();
  const visible = people.slice(0, 8);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Feather name="users" size={16} color={colors.primary} />
          <Text style={[styles.title, { color: colors.foreground }]}>People</Text>
        </View>
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      </View>

      {visible.length === 0 ? (
        <Text style={[styles.empty, { color: colors.mutedForeground }]}>
          {loading ? "Loading…" : "No connections yet."}
        </Text>
      ) : (
        <View style={styles.row}>
          {visible.map((p, idx) => {
            const uri = resolveStorageUrl(p.avatarUrl ?? null);
            return (
              <View
                key={p.clerkId}
                style={[
                  styles.avatar,
                  {
                    backgroundColor: colors.muted,
                    borderColor: colors.background,
                    marginLeft: idx === 0 ? 0 : -10,
                    zIndex: visible.length - idx,
                  },
                ]}
              >
                {uri ? (
                  <Image source={{ uri }} style={styles.avatarImg} />
                ) : (
                  <Text style={[styles.initial, { color: colors.mutedForeground }]}>
                    {(p.name || "?").trim().charAt(0).toUpperCase()}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  row: { flexDirection: "row", alignItems: "center", paddingTop: 2 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  initial: { fontSize: 13, fontFamily: "Inter_700Bold" },
  empty: { fontSize: 13, fontFamily: "Inter_400Regular" },
});
