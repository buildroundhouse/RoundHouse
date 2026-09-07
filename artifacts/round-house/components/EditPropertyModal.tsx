import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { uploadAsset, resolveStorageUrl } from "@/lib/uploads";
import { AddressAutocompleteInput, type PickedLocation } from "@/components/AddressAutocompleteInput";
import { StaticMapPreview } from "@/components/StaticMapPreview";
import { PickLocationOnMapModal } from "@/components/PickLocationOnMapModal";

type PropertyType = "home" | "commercial" | "rental";

interface EditPropertyValues {
  name: string;
  address: string;
  type: PropertyType;
  coverPhotoUrl: string;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  initial: {
    name: string;
    address: string;
    type: string;
    coverPhotoUrl: string | null;
    placeId?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  onSubmit: (values: EditPropertyValues) => Promise<void> | void;
}

const TYPES: PropertyType[] = ["home", "commercial", "rental"];
const TYPE_LABELS: Record<PropertyType, string> = {
  home: "Home",
  commercial: "Commercial",
  rental: "Rental",
};
type FeatherIconName = React.ComponentProps<typeof Feather>["name"];
const TYPE_ICONS: Record<PropertyType, FeatherIconName> = {
  home: "home",
  commercial: "briefcase",
  rental: "key",
};

function normalizeType(t: string): PropertyType {
  return TYPES.includes(t as PropertyType) ? (t as PropertyType) : "home";
}

export function EditPropertyModal({ visible, onClose, initial, onSubmit }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.address);
  const [placeId, setPlaceId] = useState<string | null>(initial.placeId ?? null);
  const [latitude, setLatitude] = useState<number | null>(initial.latitude ?? null);
  const [longitude, setLongitude] = useState<number | null>(initial.longitude ?? null);
  const [type, setType] = useState<PropertyType>(normalizeType(initial.type));
  const [coverPhotoUrl, setCoverPhotoUrl] = useState<string | null>(initial.coverPhotoUrl);
  const [pickedPreview, setPickedPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPickOnMap, setShowPickOnMap] = useState(false);
  const [location, setLocation] = useState<PickedLocation | null>(
    typeof initial.latitude === "number" && typeof initial.longitude === "number"
      ? { lat: initial.latitude, lng: initial.longitude }
      : null,
  );

  useEffect(() => {
    if (visible) {
      setName(initial.name);
      setAddress(initial.address);
      setPlaceId(initial.placeId ?? null);
      setLatitude(initial.latitude ?? null);
      setLongitude(initial.longitude ?? null);
      setType(normalizeType(initial.type));
      setCoverPhotoUrl(initial.coverPhotoUrl);
      setPickedPreview(null);
      setUploading(false);
      setSaving(false);
      setLocation(
        typeof initial.latitude === "number" && typeof initial.longitude === "number"
          ? { lat: initial.latitude, lng: initial.longitude }
          : null,
      );
    }
  }, [visible, initial]);

  async function pickPhoto() {
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow photo access to change the property photo.");
        return;
      }
    }
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.85,
      });
    } catch (e) {
      Alert.alert("Could not open photos", e instanceof Error ? e.message : "Try again.");
      return;
    }
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setPickedPreview(asset.uri);
    setUploading(true);
    try {
      const uploaded = await uploadAsset({
        uri: asset.uri,
        name: asset.fileName ?? "property-cover.jpg",
        contentType: asset.mimeType ?? "image/jpeg",
        size: asset.fileSize ?? null,
      });
      setCoverPhotoUrl(uploaded.path);
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Try again.");
      setPickedPreview(null);
    } finally {
      setUploading(false);
    }
  }

  const canSave = name.trim().length > 0 && !!coverPhotoUrl && !uploading && !saving;

  async function save() {
    if (!canSave || !coverPhotoUrl) return;
    setSaving(true);
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const trimmed = address.trim();
      const keepPlaceId = !!placeId && trimmed === address.trim();
      const lat = location ? location.lat : null;
      const lng = location ? location.lng : null;
      await onSubmit({
        name: name.trim(),
        address: trimmed,
        type,
        coverPhotoUrl,
        placeId: keepPlaceId ? placeId : null,
        latitude: lat,
        longitude: lng,
      });
      onClose();
    } catch (e) {
      Alert.alert("Could not save", e instanceof Error ? e.message : "Try again.");
    } finally {
      setSaving(false);
    }
  }

  const previewUri = pickedPreview ?? resolveStorageUrl(coverPhotoUrl);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : 0 }]}>
          <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
            <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Edit Property</Text>
          <TouchableOpacity
            onPress={save}
            disabled={!canSave}
            style={[styles.saveBtn, { backgroundColor: canSave ? colors.primary : colors.muted }]}
          >
            <Text style={[styles.saveText, { color: canSave ? colors.primaryForeground : colors.mutedForeground }]}>
              {saving ? "…" : "Save"}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: colors.mutedForeground }]}>PROPERTY PHOTO (REQUIRED)</Text>
          <TouchableOpacity
            onPress={pickPhoto}
            disabled={uploading}
            style={[styles.photoBox, { backgroundColor: colors.card, borderColor: colors.border }]}
            activeOpacity={0.8}
          >
            {previewUri ? (
              <Image source={{ uri: previewUri }} style={styles.photoImage} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Feather name="camera" size={28} color={colors.mutedForeground} />
                <Text style={[styles.photoBtnText, { color: colors.foreground }]}>
                  {uploading ? "Uploading…" : "Upload Photo"}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          {previewUri ? (
            <TouchableOpacity onPress={pickPhoto} disabled={uploading} style={styles.changePhotoBtn}>
              <Text style={[styles.changePhotoText, { color: colors.primary }]}>
                {uploading ? "Uploading…" : "Change Photo"}
              </Text>
            </TouchableOpacity>
          ) : null}

          <Text style={[styles.label, { color: colors.mutedForeground }]}>PROPERTY NAME</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            value={name}
            onChangeText={setName}
            returnKeyType="next"
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>PROPERTY ADDRESS</Text>
          <AddressAutocompleteInput
            value={address}
            onChangeText={(t) => {
              setAddress(t);
              if (location) setLocation(null);
              if (placeId) {
                setPlaceId(null);
                setLatitude(null);
                setLongitude(null);
              }
            }}
            onPickPlace={(p) => {
              setAddress(p.formattedAddress);
              setPlaceId(p.placeId);
              setLatitude(p.latitude);
              setLongitude(p.longitude);
            }}
            placeholder="Street address"
            returnKeyType="done"
            onLocationPicked={setLocation}
          />
          {location ? (
            <>
              <StaticMapPreview lat={location.lat} lng={location.lng} />
              <View style={styles.pickOnMapRow}>
                <TouchableOpacity
                  onPress={() => setShowPickOnMap(true)}
                  style={styles.pickOnMapBtn}
                >
                  <Feather name="map-pin" size={14} color={colors.primary} />
                  <Text style={[styles.pickOnMapText, { color: colors.primary }]}>
                    Adjust pin on map
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setLocation(null);
                    setLatitude(null);
                    setLongitude(null);
                    setPlaceId(null);
                  }}
                  style={styles.pickOnMapBtn}
                >
                  <Feather name="x" size={14} color={colors.mutedForeground} />
                  <Text style={[styles.pickOnMapText, { color: colors.mutedForeground }]}>
                    Clear pin
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <TouchableOpacity
              onPress={() => setShowPickOnMap(true)}
              style={[
                styles.pickOnMapCta,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
              accessibilityLabel="Pick location on map"
            >
              <Feather name="map-pin" size={16} color={colors.primary} />
              <Text style={[styles.pickOnMapCtaText, { color: colors.foreground }]}>
                Pick on map
              </Text>
              <Text style={[styles.pickOnMapCtaSub, { color: colors.mutedForeground }]}>
                Drop a pin to set this property's location.
              </Text>
            </TouchableOpacity>
          )}

          <Text style={[styles.label, { color: colors.mutedForeground }]}>PROPERTY TYPE</Text>
          <View style={styles.typeRow}>
            {TYPES.map((t) => (
              <TouchableOpacity
                key={t}
                style={[
                  styles.typeBtn,
                  {
                    backgroundColor: type === t ? colors.primary : colors.card,
                    borderColor: type === t ? colors.primary : colors.border,
                  },
                ]}
                onPress={() => {
                  setType(t);
                  Haptics.selectionAsync();
                }}
              >
                <Feather
                  name={TYPE_ICONS[t]}
                  size={16}
                  color={type === t ? colors.primaryForeground : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.typeBtnText,
                    { color: type === t ? colors.primaryForeground : colors.foreground },
                  ]}
                >
                  {TYPE_LABELS[t]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ height: insets.bottom + 32 }} />
        </ScrollView>

        <PickLocationOnMapModal
          visible={showPickOnMap}
          onClose={() => setShowPickOnMap(false)}
          initialLatitude={location?.lat ?? null}
          initialLongitude={location?.lng ?? null}
          title={location ? "Adjust pin" : "Pick on map"}
          onSave={(lat, lng) => {
            setLocation({ lat, lng });
            setLatitude(lat);
            setLongitude(lng);
            setPlaceId(null);
          }}
        />
      </KeyboardAvoidingView>
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
  scroll: { flex: 1 },
  scrollContent: { padding: 20, gap: 8 },
  label: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  photoBox: {
    height: 180,
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  photoImage: { width: "100%", height: "100%" },
  photoPlaceholder: { alignItems: "center", gap: 8 },
  photoBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  changePhotoBtn: { alignSelf: "center", paddingVertical: 8 },
  changePhotoText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  typeRow: { flexDirection: "row", gap: 10 },
  typeBtn: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  typeBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  pickOnMapRow: {
    flexDirection: "row",
    gap: 16,
    paddingTop: 8,
  },
  pickOnMapBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
  },
  pickOnMapText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  pickOnMapCta: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: "center",
    gap: 4,
  },
  pickOnMapCtaText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  pickOnMapCtaSub: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
});
