import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT, type Region } from "react-native-maps";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import * as Haptics from "expo-haptics";

const GOOGLE_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;

interface Props {
  primaryZip: string;
  selected: string[];
  candidates: string[];
  onToggle: (zip: string) => void;
  height?: number;
}

interface Coords {
  lat: number;
  lng: number;
}

const zipGeocodeCache = new Map<string, Promise<Coords | null>>();

async function geocodeZip(zip: string): Promise<Coords | null> {
  if (!GOOGLE_KEY || !/^\d{5}$/.test(zip)) return null;
  const cached = zipGeocodeCache.get(zip);
  if (cached) return cached;
  const promise = (async () => {
    try {
      const url =
        "https://maps.googleapis.com/maps/api/geocode/json" +
        `?components=postal_code:${zip}|country:US` +
        `&key=${GOOGLE_KEY}`;
      const res = await fetch(url);
      const json: unknown = await res.json();
      const loc = (json as {
        results?: { geometry?: { location?: { lat?: number; lng?: number } } }[];
      })?.results?.[0]?.geometry?.location;
      if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
        return { lat: loc.lat, lng: loc.lng };
      }
      return null;
    } catch {
      return null;
    }
  })();
  zipGeocodeCache.set(zip, promise);
  return promise;
}

function regionFor(coords: Coords[], primary?: Coords | null): Region {
  if (coords.length === 0) {
    if (primary) {
      return {
        latitude: primary.lat,
        longitude: primary.lng,
        latitudeDelta: 0.4,
        longitudeDelta: 0.4,
      };
    }
    return { latitude: 39.5, longitude: -98.35, latitudeDelta: 60, longitudeDelta: 60 };
  }
  const lats = coords.map((c) => c.lat);
  const lngs = coords.map((c) => c.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.6, 0.05),
    longitudeDelta: Math.max((maxLng - minLng) * 1.6, 0.05),
  };
}

/**
 * Interactive map of nearby ZIPs around the primary ZIP.
 *
 * Renders a marker per ZIP (primary, selected, and candidate suggestions).
 * Tapping a non-primary marker toggles that ZIP in the served list — giving
 * trade pros a true geographic view of their coverage instead of relying on
 * numerical adjacency alone.
 */
export function ZipMap({ primaryZip, selected, candidates, onToggle, height = 220 }: Props) {
  const colors = useColors();
  const mapRef = useRef<MapView | null>(null);

  const allZips = useMemo(() => {
    const set = new Set<string>();
    if (/^\d{5}$/.test(primaryZip)) set.add(primaryZip);
    for (const z of selected) if (/^\d{5}$/.test(z)) set.add(z);
    for (const z of candidates) if (/^\d{5}$/.test(z)) set.add(z);
    return Array.from(set);
  }, [primaryZip, selected, candidates]);

  const [coordsMap, setCoordsMap] = useState<Record<string, Coords>>({});
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!GOOGLE_KEY || allZips.length === 0) {
      setCoordsMap({});
      setResolving(false);
      return () => {
        cancelled = true;
      };
    }
    setResolving(true);
    (async () => {
      const entries = await Promise.all(
        allZips.map(async (z) => {
          const c = await geocodeZip(z);
          return c ? ([z, c] as const) : null;
        }),
      );
      if (cancelled) return;
      const next: Record<string, Coords> = {};
      for (const e of entries) {
        if (e) next[e[0]] = e[1];
      }
      setCoordsMap(next);
      setResolving(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [allZips]);

  const primaryCoords = coordsMap[primaryZip] ?? null;
  const placedCoords = useMemo(() => Object.values(coordsMap), [coordsMap]);
  const region = useMemo(() => regionFor(placedCoords, primaryCoords), [placedCoords, primaryCoords]);

  useEffect(() => {
    if (mapRef.current && placedCoords.length > 0) {
      mapRef.current.animateToRegion(region, 350);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [region.latitude, region.longitude, region.latitudeDelta]);

  if (!GOOGLE_KEY) {
    return (
      <View
        style={[
          styles.placeholder,
          { height, borderColor: colors.border, backgroundColor: colors.muted },
        ]}
      >
        <Feather name="map" size={20} color={colors.mutedForeground} />
        <Text style={[styles.placeholderText, { color: colors.mutedForeground }]}>
          Map preview unavailable. Tap nearby ZIPs below to add them.
        </Text>
      </View>
    );
  }

  const selectedSet = new Set(selected);
  const placedCount = Object.keys(coordsMap).length;

  return (
    <View style={[styles.wrap, { borderColor: colors.border, height }]}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={region}
        showsUserLocation={Platform.OS !== "web"}
        showsMyLocationButton={false}
      >
        {Object.entries(coordsMap).map(([zip, c]) => {
          const isPrimary = zip === primaryZip;
          const isOn = isPrimary || selectedSet.has(zip);
          const pinColor = isPrimary
            ? colors.primary
            : isOn
              ? "#22A06B"
              : colors.mutedForeground;
          return (
            <Marker
              key={zip}
              coordinate={{ latitude: c.lat, longitude: c.lng }}
              title={isPrimary ? `${zip} (primary)` : zip}
              description={
                isPrimary
                  ? "Your home base"
                  : isOn
                    ? "Tap to remove from served ZIPs"
                    : "Tap to add to served ZIPs"
              }
              pinColor={pinColor}
              onPress={() => {
                if (isPrimary) return;
                Haptics.selectionAsync();
                onToggle(zip);
              }}
            />
          );
        })}
      </MapView>

      <View style={styles.legendWrap} pointerEvents="none">
        <View style={[styles.legend, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <LegendDot color={colors.primary} label="Primary" />
          <LegendDot color="#22A06B" label="Served" />
          <LegendDot color={colors.mutedForeground} label="Nearby" />
        </View>
      </View>

      {resolving && placedCount === 0 ? (
        <View style={styles.overlay} pointerEvents="none">
          <View style={[styles.overlayPill, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Feather name="map-pin" size={12} color={colors.mutedForeground} />
            <Text style={[styles.overlayText, { color: colors.mutedForeground }]}>
              Locating ZIPs…
            </Text>
          </View>
        </View>
      ) : !resolving && placedCount === 0 ? (
        <View style={styles.overlay} pointerEvents="none">
          <View style={[styles.overlayPill, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Feather name="alert-circle" size={12} color={colors.mutedForeground} />
            <Text style={[styles.overlayText, { color: colors.mutedForeground }]}>
              Could not place ZIPs on the map.
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  const colors = useColors();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.legendText, { color: colors.foreground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
  },
  placeholder: {
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    gap: 6,
  },
  placeholderText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  legendWrap: {
    position: "absolute",
    bottom: 8,
    left: 8,
    right: 8,
    alignItems: "center",
  },
  legend: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  overlayPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  overlayText: { fontSize: 12, fontFamily: "Inter_500Medium" },
});
