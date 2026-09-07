import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { BusinessSearchResult } from "@workspace/api-client-react";

interface Props {
  businesses: BusinessSearchResult[];
  zip: string;
  onOpen: (clerkId: string) => void;
  bottomPad: number;
}

export function BusinessesMapView({ businesses }: Props) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.root,
        { backgroundColor: colors.muted, borderColor: colors.border },
      ]}
    >
      <Feather name="map" size={28} color={colors.mutedForeground} />
      <Text style={[styles.title, { color: colors.foreground }]}>Map view</Text>
      <Text style={[styles.body, { color: colors.mutedForeground }]}>
        {businesses.length === 0
          ? "No businesses to show on the map yet."
          : `Map preview is available in the mobile app (${businesses.length} ${businesses.length === 1 ? "business" : "businesses"}).`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 6,
  },
  title: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  body: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
});
