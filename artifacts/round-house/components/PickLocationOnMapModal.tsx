import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import MapView, { MapPressEvent, Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import * as Haptics from "expo-haptics";

interface Props {
  visible: boolean;
  onClose: () => void;
  initialLatitude?: number | null;
  initialLongitude?: number | null;
  title?: string;
  onSave: (lat: number, lng: number) => Promise<void> | void;
}

const DEFAULT_REGION = {
  latitude: 39.5,
  longitude: -98.35,
  latitudeDelta: 60,
  longitudeDelta: 60,
};

export function PickLocationOnMapModal({
  visible,
  onClose,
  initialLatitude,
  initialLongitude,
  title = "Pick on map",
  onSave,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView | null>(null);
  const hasInitial =
    typeof initialLatitude === "number" &&
    Number.isFinite(initialLatitude) &&
    typeof initialLongitude === "number" &&
    Number.isFinite(initialLongitude);

  const [pin, setPin] = useState<{ latitude: number; longitude: number } | null>(
    hasInitial ? { latitude: initialLatitude as number, longitude: initialLongitude as number } : null,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setPin(
        hasInitial
          ? { latitude: initialLatitude as number, longitude: initialLongitude as number }
          : null,
      );
      setSaving(false);
      const region = hasInitial
        ? {
            latitude: initialLatitude as number,
            longitude: initialLongitude as number,
            latitudeDelta: 0.02,
            longitudeDelta: 0.02,
          }
        : DEFAULT_REGION;
      requestAnimationFrame(() => {
        mapRef.current?.animateToRegion(region, 250);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialLatitude, initialLongitude]);

  const initialRegion = hasInitial
    ? {
        latitude: initialLatitude as number,
        longitude: initialLongitude as number,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }
    : DEFAULT_REGION;

  const handleMapPress = (e: MapPressEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    Haptics.selectionAsync();
    setPin({ latitude, longitude });
  };

  async function save() {
    if (!pin || saving) return;
    setSaving(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await onSave(pin.latitude, pin.longitude);
      onClose();
    } catch (e) {
      Alert.alert("Could not save location", e instanceof Error ? e.message : "Try again.");
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingTop: Platform.OS === "web" ? 24 : 0,
            },
          ]}
        >
          <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
            <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <TouchableOpacity
            onPress={save}
            disabled={!pin || saving}
            style={[
              styles.saveBtn,
              { backgroundColor: pin && !saving ? colors.primary : colors.muted },
            ]}
          >
            <Text
              style={[
                styles.saveText,
                { color: pin && !saving ? colors.primaryForeground : colors.mutedForeground },
              ]}
            >
              {saving ? "…" : "Save"}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hintWrap}>
          <Feather name="map-pin" size={14} color={colors.mutedForeground} />
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            {pin
              ? "Drag the pin or tap a new spot to adjust."
              : "Tap on the map to drop a pin."}
          </Text>
        </View>

        <View style={styles.mapWrap}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            provider={PROVIDER_DEFAULT}
            initialRegion={initialRegion}
            showsUserLocation={Platform.OS !== "web"}
            showsMyLocationButton={false}
            onPress={handleMapPress}
          >
            {pin ? (
              <Marker
                coordinate={pin}
                draggable
                onDragEnd={(e) => {
                  const { latitude, longitude } = e.nativeEvent.coordinate;
                  Haptics.selectionAsync();
                  setPin({ latitude, longitude });
                }}
                pinColor={colors.primary}
              />
            ) : null}
          </MapView>
        </View>

        {pin ? (
          <View
            style={[
              styles.coords,
              {
                paddingBottom: insets.bottom + 16,
                backgroundColor: colors.background,
                borderTopColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.coordsLabel, { color: colors.mutedForeground }]}>
              SELECTED COORDINATES
            </Text>
            <Text style={[styles.coordsValue, { color: colors.foreground }]}>
              {pin.latitude.toFixed(6)}, {pin.longitude.toFixed(6)}
            </Text>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cancelBtn: { minWidth: 56 },
  cancelText: { fontSize: 16, fontFamily: "Inter_400Regular" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    minWidth: 56,
    alignItems: "center",
  },
  saveText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  hintWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  hint: { fontSize: 13, fontFamily: "Inter_400Regular" },
  mapWrap: { flex: 1, overflow: "hidden" },
  coords: {
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  coordsLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  coordsValue: { fontSize: 14, fontFamily: "Inter_500Medium" },
});
