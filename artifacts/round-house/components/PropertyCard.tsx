import React from "react";
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { Property } from "@/context/AppContext";
import { DemoBadge } from "@/components/DemoBadge";

interface Props {
  property: Property;
  logCount: number;
  score: number;
  onPress: () => void;
  onLongPress?: () => void;
}

const TYPE_LABELS: Record<Property["type"], string> = {
  home: "Home",
  commercial: "Commercial",
  rental: "Rental",
};

const TYPE_ICONS: Record<Property["type"], string> = {
  home: "home",
  commercial: "briefcase",
  rental: "key",
};

export function PropertyCard({ property, logCount, score, onPress, onLongPress }: Props) {
  const colors = useColors();

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.85}
    >
      <View style={[styles.colorBar, { backgroundColor: property.coverColor }]} />
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.typeRow}>
            <View style={[styles.typeBadge, { backgroundColor: colors.muted }]}>
              <Feather
                name={TYPE_ICONS[property.type] as any}
                size={11}
                color={colors.mutedForeground}
              />
              <Text style={[styles.typeText, { color: colors.mutedForeground }]}>
                {TYPE_LABELS[property.type]}
              </Text>
            </View>
            {property.isPro && (
              <View style={[styles.proBadge, { backgroundColor: property.coverColor }]}>
                <Text style={styles.proText}>PRO</Text>
              </View>
            )}
            {property.isAdminDemo ? <DemoBadge size="sm" /> : null}
          </View>
          <View style={styles.scoreContainer}>
            <Text style={[styles.scoreValue, { color: property.coverColor }]}>{score}</Text>
            <Text style={[styles.scoreLabel, { color: colors.mutedForeground }]}>pts</Text>
          </View>
        </View>

        <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
          {property.name}
        </Text>
        <Text style={[styles.address, { color: colors.mutedForeground }]} numberOfLines={1}>
          {property.address}
        </Text>

        {(() => {
          const mapped =
            typeof property.latitude === "number" &&
            Number.isFinite(property.latitude) &&
            typeof property.longitude === "number" &&
            Number.isFinite(property.longitude);
          const hasAddress = !!property.address && property.address.trim().length > 0;
          if (!mapped && !hasAddress) return null;
          const label = mapped ? "Mapped" : "Address only";
          const icon = mapped ? "map-pin" : "type";
          const tint = mapped ? property.coverColor : colors.mutedForeground;
          return (
            <View
              style={[
                styles.locationBadge,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
              accessibilityLabel={mapped ? "Property location is mapped" : "Property has address only"}
            >
              <Feather name={icon as any} size={10} color={tint} />
              <Text style={[styles.locationBadgeText, { color: tint }]}>{label}</Text>
            </View>
          );
        })()}

        <View style={styles.footer}>
          <View style={styles.footerStat}>
            <Feather name="clipboard" size={12} color={colors.mutedForeground} />
            <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
              {logCount} {logCount === 1 ? "log" : "logs"}
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.border} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 12,
    flexDirection: "row",
  },
  colorBar: {
    width: 4,
  },
  content: {
    flex: 1,
    padding: 16,
    gap: 4,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  typeRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  typeBadge: {
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  typeText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  proBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  proText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
  },
  scoreContainer: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
  },
  scoreValue: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  scoreLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  name: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },
  address: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    marginBottom: 8,
  },
  locationBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  locationBadgeText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
  },
  footerStat: {
    flexDirection: "row",
    gap: 5,
    alignItems: "center",
  },
  footerText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
