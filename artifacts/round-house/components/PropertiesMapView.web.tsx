import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export interface MappableProperty {
  id: number;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  coverColor?: string | null;
}

interface Props {
  properties: MappableProperty[];
  onPressMarker: (id: number) => void;
}

export function PropertiesMapView({ properties, onPressMarker }: Props) {
  const colors = useColors();

  if (properties.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: colors.muted }]}>
        <Feather name="map-pin" size={28} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No mapped properties</Text>
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
          Add a property using the address autocomplete to drop a pin on the map.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.muted }]}>
      <View style={styles.header}>
        <Feather name="map" size={14} color={colors.mutedForeground} />
        <Text style={[styles.headerText, { color: colors.mutedForeground }]}>
          Map preview ({properties.length} {properties.length === 1 ? "pin" : "pins"})
        </Text>
      </View>
      <ScrollView contentContainerStyle={styles.pinsList}>
        {properties.map((p) => (
          <TouchableOpacity
            key={p.id}
            accessibilityLabel={`Map pin: ${p.name}`}
            style={[styles.pinRow, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => onPressMarker(p.id)}
            activeOpacity={0.85}
          >
            <View style={[styles.pinDot, { backgroundColor: p.coverColor || colors.primary }]}>
              <Feather name="map-pin" size={14} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.pinName, { color: colors.foreground }]}>{p.name}</Text>
              {p.address ? (
                <Text style={[styles.pinAddress, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {p.address}
                </Text>
              ) : null}
              <Text style={[styles.pinCoords, { color: colors.mutedForeground }]}>
                {p.latitude.toFixed(4)}, {p.longitude.toFixed(4)}
              </Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
  },
  headerText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  pinsList: { padding: 12, gap: 8 },
  pinRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  pinDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  pinName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  pinAddress: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  pinCoords: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  empty: {
    margin: 16,
    padding: 24,
    borderRadius: 14,
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
});
