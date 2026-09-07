import React, { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

interface Props {
  visible: boolean;
  onClose: () => void;
  initialLatitude?: number | null;
  initialLongitude?: number | null;
  title?: string;
  onSave: (lat: number, lng: number) => Promise<void> | void;
}

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
  const [lat, setLat] = useState(
    initialLatitude != null ? String(initialLatitude) : "",
  );
  const [lng, setLng] = useState(
    initialLongitude != null ? String(initialLongitude) : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLat(initialLatitude != null ? String(initialLatitude) : "");
    setLng(initialLongitude != null ? String(initialLongitude) : "");
    setError(null);
    setSaving(false);
  }, [visible, initialLatitude, initialLongitude]);

  const parsedLat = parseFloat(lat);
  const parsedLng = parseFloat(lng);
  const valid =
    !Number.isNaN(parsedLat) &&
    !Number.isNaN(parsedLng) &&
    parsedLat >= -90 &&
    parsedLat <= 90 &&
    parsedLng >= -180 &&
    parsedLng <= 180;

  async function handleSave() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(parsedLat, parsedLng);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save location.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingTop: Platform.OS === "web" ? 16 : insets.top + 8,
            },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={12} style={styles.iconBtn}>
            <Feather name="x" size={20} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {title}
          </Text>
          <View style={{ width: 36 }} />
        </View>

        <View style={styles.body}>
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>
            Map picker is only available in the mobile app. Enter coordinates
            manually here.
          </Text>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            LATITUDE
          </Text>
          <TextInput
            value={lat}
            onChangeText={setLat}
            placeholder="39.5"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="numbers-and-punctuation"
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            LONGITUDE
          </Text>
          <TextInput
            value={lng}
            onChangeText={setLng}
            placeholder="-98.35"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="numbers-and-punctuation"
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          />

          {error ? (
            <Text style={[styles.error, { color: colors.destructive }]}>
              {error}
            </Text>
          ) : null}

          <Pressable
            onPress={handleSave}
            disabled={!valid || saving}
            style={[
              styles.primaryBtn,
              {
                backgroundColor: valid ? colors.primary : colors.muted,
                opacity: saving ? 0.7 : 1,
              },
            ]}
          >
            <Text
              style={[
                styles.primaryBtnText,
                {
                  color: valid
                    ? colors.primaryForeground
                    : colors.mutedForeground,
                },
              ]}
            >
              {saving ? "Saving…" : "Save"}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  body: { padding: 20, gap: 8 },
  intro: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 19,
    marginBottom: 8,
  },
  label: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.7,
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  error: { fontSize: 13, fontFamily: "Inter_500Medium", marginTop: 12 },
  primaryBtn: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
