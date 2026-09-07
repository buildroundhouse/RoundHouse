import React, { useMemo, useRef, useEffect } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
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

function computeRegion(properties: MappableProperty[]) {
  if (properties.length === 0) {
    return {
      latitude: 39.5,
      longitude: -98.35,
      latitudeDelta: 60,
      longitudeDelta: 60,
    };
  }
  if (properties.length === 1) {
    return {
      latitude: properties[0].latitude,
      longitude: properties[0].longitude,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };
  }
  const lats = properties.map((p) => p.latitude);
  const lngs = properties.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latitude = (minLat + maxLat) / 2;
  const longitude = (minLng + maxLng) / 2;
  const latitudeDelta = Math.max((maxLat - minLat) * 1.6, 0.05);
  const longitudeDelta = Math.max((maxLng - minLng) * 1.6, 0.05);
  return { latitude, longitude, latitudeDelta, longitudeDelta };
}

export function PropertiesMapView({ properties, onPressMarker }: Props) {
  const colors = useColors();
  const region = useMemo(() => computeRegion(properties), [properties]);
  const mapRef = useRef<MapView | null>(null);

  useEffect(() => {
    if (mapRef.current && properties.length > 0) {
      mapRef.current.animateToRegion(region, 400);
    }
  }, [region, properties.length]);

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
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      provider={PROVIDER_DEFAULT}
      initialRegion={region}
      showsUserLocation={Platform.OS !== "web"}
      showsMyLocationButton={false}
    >
      {properties.map((p) => (
        <Marker
          key={p.id}
          coordinate={{ latitude: p.latitude, longitude: p.longitude }}
          title={p.name}
          description={p.address ?? undefined}
          pinColor={p.coverColor || colors.primary}
          onPress={() => onPressMarker(p.id)}
          onCalloutPress={() => onPressMarker(p.id)}
        />
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
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
