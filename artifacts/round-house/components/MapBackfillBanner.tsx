import React, { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useQueryClient } from "@tanstack/react-query";
import {
  useBackfillPropertyGeocode,
  getGetPropertyQueryKey,
} from "@workspace/api-client-react";

const PLACES_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;
const SEARCH_TEXT_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

interface PlacesPlace {
  id?: string;
  location?: { latitude?: number; longitude?: number };
}
interface PlacesSearchTextResponse {
  places?: PlacesPlace[];
}

interface Props {
  propertyId: number;
  address: string;
  onDone?: () => void;
}

export function MapBackfillBanner({ propertyId, address, onDone }: Props) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const backfill = useBackfillPropertyGeocode();
  const [resolving, setResolving] = useState(false);

  if (!PLACES_API_KEY) return null;
  if (!address || address.trim().length === 0) return null;

  async function findOnMap() {
    setResolving(true);
    try {
      const res = await fetch(SEARCH_TEXT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": PLACES_API_KEY!,
          "X-Goog-FieldMask": "places.id,places.location",
        },
        body: JSON.stringify({ textQuery: address }),
      });
      if (!res.ok) {
        Alert.alert(
          "Could not find on map",
          "We couldn't look up that address right now. Try editing the address from the property settings.",
        );
        return;
      }
      const data = (await res.json()) as PlacesSearchTextResponse;
      const first = data.places?.[0];
      const placeId = first?.id;
      const lat = first?.location?.latitude;
      const lng = first?.location?.longitude;
      if (!placeId || typeof lat !== "number" || typeof lng !== "number") {
        Alert.alert(
          "No match found",
          "Google couldn't match that address. Open the property and edit the address to pick a suggestion.",
        );
        return;
      }

      await backfill.mutateAsync({
        propertyId,
        data: { placeId, latitude: lat, longitude: lng },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetPropertyQueryKey(propertyId),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onDone?.();
    } catch (e) {
      Alert.alert(
        "Could not find on map",
        e instanceof Error ? e.message : "Something went wrong looking up that address.",
      );
    } finally {
      setResolving(false);
    }
  }

  const busy = resolving || backfill.isPending;

  return (
    <TouchableOpacity
      onPress={() => {
        if (busy) return;
        void findOnMap();
      }}
      activeOpacity={0.85}
      style={[
        styles.wrap,
        {
          backgroundColor: colors.primary + "12",
          borderColor: colors.primary + "40",
        },
      ]}
    >
      <Feather name="map-pin" size={18} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.primary }]}>Find this on the map</Text>
        <Text style={[styles.body, { color: colors.foreground }]} numberOfLines={2}>
          Save the location for the saved address so it shows up on the map.
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Feather name="chevron-right" size={16} color={colors.primary} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  title: { fontSize: 13, fontFamily: "Inter_700Bold" },
  body: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
