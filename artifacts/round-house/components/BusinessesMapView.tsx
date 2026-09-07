import React, { useEffect, useMemo, useRef } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Callout, PROVIDER_DEFAULT } from "react-native-maps";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import type { BusinessSearchResult } from "@workspace/api-client-react";

interface Props {
  businesses: BusinessSearchResult[];
  onOpen: (clerkId: string) => void;
  bottomPad: number;
}

interface Coords {
  lat: number;
  lng: number;
}

interface PinnedBusiness {
  business: BusinessSearchResult;
  coords: Coords;
}

function computeRegion(pins: PinnedBusiness[]) {
  if (pins.length === 0) {
    return {
      latitude: 39.5,
      longitude: -98.35,
      latitudeDelta: 60,
      longitudeDelta: 60,
    };
  }
  if (pins.length === 1) {
    return {
      latitude: pins[0].coords.lat,
      longitude: pins[0].coords.lng,
      latitudeDelta: 0.08,
      longitudeDelta: 0.08,
    };
  }
  const lats = pins.map((p) => p.coords.lat);
  const lngs = pins.map((p) => p.coords.lng);
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

export function BusinessesMapView({ businesses, onOpen, bottomPad }: Props) {
  const colors = useColors();
  const mapRef = useRef<MapView | null>(null);

  // Map only businesses whose intake captured real coordinates. We never
  // geocode service-area text on the fly — pros without saved coords show
  // up only in list view until they re-save their service area.
  const pins = useMemo<PinnedBusiness[]>(
    () =>
      businesses
        .filter(
          (b): b is BusinessSearchResult & { lat: number; lng: number } =>
            typeof b.lat === "number" &&
            typeof b.lng === "number" &&
            Number.isFinite(b.lat) &&
            Number.isFinite(b.lng),
        )
        .map((b) => ({ business: b, coords: { lat: b.lat, lng: b.lng } })),
    [businesses],
  );

  const region = useMemo(() => computeRegion(pins), [pins]);

  useEffect(() => {
    if (mapRef.current) {
      mapRef.current.animateToRegion(region, 400);
    }
  }, [region]);

  const missingCoordsCount = businesses.length - pins.length;

  return (
    <View style={[styles.root, { paddingBottom: bottomPad }]}>
      <View style={[styles.mapWrap, { borderColor: colors.border, backgroundColor: colors.muted }]}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_DEFAULT}
          initialRegion={region}
          showsUserLocation={Platform.OS !== "web"}
          showsMyLocationButton={false}
        >
          {pins.map(({ business, coords }) => {
            const title = business.companyName ?? business.name;
            const subBits: string[] = [];
            if (business.tradeLabel) subBits.push(business.tradeLabel);
            if (business.region) subBits.push(business.region);
            return (
              <Marker
                key={business.id}
                coordinate={{ latitude: coords.lat, longitude: coords.lng }}
                title={title}
                description={subBits.join(" · ") || `@${business.username}`}
                onCalloutPress={() => onOpen(business.clerkId)}
              >
                <Callout tooltip onPress={() => onOpen(business.clerkId)}>
                  <View style={[styles.callout, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Text style={[styles.calloutTitle, { color: colors.foreground }]} numberOfLines={1}>
                      {title}
                    </Text>
                    {subBits.length > 0 ? (
                      <Text
                        style={[styles.calloutSub, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {subBits.join(" · ")}
                      </Text>
                    ) : null}
                    <View style={styles.calloutCta}>
                      <Text style={[styles.calloutCtaText, { color: colors.primary }]}>
                        View profile
                      </Text>
                      <Feather name="chevron-right" size={12} color={colors.primary} />
                    </View>
                  </View>
                </Callout>
              </Marker>
            );
          })}
        </MapView>

        {pins.length === 0 ? (
          <View style={styles.overlay} pointerEvents="box-none">
            <View style={[styles.overlayCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Feather name="map-pin" size={20} color={colors.mutedForeground} />
              <Text style={[styles.overlayTitle, { color: colors.foreground }]}>
                No locations to map
              </Text>
              <Text style={[styles.overlayBody, { color: colors.mutedForeground }]}>
                {businesses.length === 0
                  ? "No businesses match your search."
                  : "These businesses haven't saved their location yet. Switch to list view to see them all."}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      {missingCoordsCount > 0 && pins.length > 0 ? (
        <Pressable style={styles.note} accessibilityRole="text">
          <Feather name="info" size={12} color={colors.mutedForeground} />
          <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
            {pins.length === 1 ? "1 pin on the map" : `${pins.length} pins on the map`}
            {" · "}
            {missingCoordsCount}{" "}
            {missingCoordsCount === 1 ? "result" : "results"} without a saved location.
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16, paddingTop: 8, gap: 8 },
  mapWrap: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    minHeight: 240,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  overlayCard: {
    maxWidth: 320,
    alignItems: "center",
    gap: 6,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  overlayTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  overlayBody: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 17 },
  callout: {
    minWidth: 180,
    maxWidth: 240,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 2,
  },
  calloutTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  calloutSub: { fontSize: 11, fontFamily: "Inter_400Regular" },
  calloutCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    marginTop: 4,
  },
  calloutCtaText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 4,
  },
  noteText: { fontSize: 11, fontFamily: "Inter_400Regular", flex: 1 },
});
