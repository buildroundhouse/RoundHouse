import React, { useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

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

/**
 * Web variant of <ZipMap>: uses Google Static Maps to render a non-interactive
 * map image with markers for the primary, selected, and candidate ZIPs.
 * Toggling happens via the suggestion grid below — the static image is purely
 * for visual confirmation of coverage.
 */
export function ZipMap({ primaryZip, selected, candidates, height = 220 }: Props) {
  const colors = useColors();

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
  const placed = Object.entries(coordsMap);

  const url = (() => {
    if (placed.length === 0) return null;
    const groups: Record<string, string[]> = { primary: [], served: [], nearby: [] };
    for (const [zip, c] of placed) {
      const coord = `${c.lat},${c.lng}`;
      if (zip === primaryZip) groups.primary.push(coord);
      else if (selectedSet.has(zip)) groups.served.push(coord);
      else groups.nearby.push(coord);
    }
    const markerStrings: string[] = [];
    if (groups.primary.length > 0) {
      markerStrings.push(`color:red|label:P|${groups.primary.join("|")}`);
    }
    if (groups.served.length > 0) {
      markerStrings.push(`color:0x22A06B|${groups.served.join("|")}`);
    }
    if (groups.nearby.length > 0) {
      markerStrings.push(`color:gray|${groups.nearby.join("|")}`);
    }
    const markersParam = markerStrings.map((m) => `markers=${encodeURIComponent(m)}`).join("&");
    return (
      "https://maps.googleapis.com/maps/api/staticmap" +
      "?size=600x320&scale=2&" +
      markersParam +
      `&key=${GOOGLE_KEY}`
    );
  })();

  return (
    <View style={[styles.wrap, { borderColor: colors.border, height, backgroundColor: colors.muted }]}>
      {url ? (
        <Image
          source={{ uri: url }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityLabel="Map preview of served ZIPs"
        />
      ) : null}

      <View style={styles.legendWrap} pointerEvents="none">
        <View style={[styles.legend, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <LegendDot color={colors.primary} label="Primary" />
          <LegendDot color="#22A06B" label="Served" />
          <LegendDot color={colors.mutedForeground} label="Nearby" />
        </View>
      </View>

      {resolving && placed.length === 0 ? (
        <View style={styles.overlay} pointerEvents="none">
          <View style={[styles.overlayPill, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <Feather name="map-pin" size={12} color={colors.mutedForeground} />
            <Text style={[styles.overlayText, { color: colors.mutedForeground }]}>
              Locating ZIPs…
            </Text>
          </View>
        </View>
      ) : !resolving && placed.length === 0 ? (
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
