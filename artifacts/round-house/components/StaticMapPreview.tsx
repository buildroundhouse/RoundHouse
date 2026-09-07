import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { useColors } from "@/hooks/useColors";

const STATIC_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;

interface Props {
  lat: number;
  lng: number;
  height?: number;
}

export function StaticMapPreview({ lat, lng, height = 140 }: Props) {
  const colors = useColors();
  if (!STATIC_MAPS_KEY) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const center = `${lat},${lng}`;
  const url =
    "https://maps.googleapis.com/maps/api/staticmap" +
    `?center=${encodeURIComponent(center)}` +
    "&zoom=15" +
    "&size=600x280" +
    "&scale=2" +
    `&markers=${encodeURIComponent(`color:red|${center}`)}` +
    `&key=${STATIC_MAPS_KEY}`;

  return (
    <View
      style={[
        styles.wrap,
        { height, backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Image
        source={{ uri: url }}
        style={styles.image}
        resizeMode="cover"
        accessibilityLabel="Map preview of selected address"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
  },
  image: { width: "100%", height: "100%" },
});
