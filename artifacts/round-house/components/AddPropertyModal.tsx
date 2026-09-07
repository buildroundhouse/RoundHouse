import React, { useState } from "react";
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
import { uploadAsset } from "@/lib/uploads";
import { AddressAutocompleteInput, type PickedLocation } from "@/components/AddressAutocompleteInput";
import { StaticMapPreview } from "@/components/StaticMapPreview";

type PropertyType = "home" | "commercial" | "rental";

interface AddPropertyData {
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
  onSubmit: (data: AddPropertyData) => void;
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

export function AddPropertyModal({ visible, onClose, onSubmit }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [type, setType] = useState<PropertyType>("home");
  const [coverPhotoUrl, setCoverPhotoUrl] = useState<string | null>(null);
  const [pickedPreview, setPickedPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [location, setLocation] = useState<PickedLocation | null>(null);

  React.useEffect(() => {
    if (!visible) {
      setName("");
      setAddress("");
      setPlaceId(null);
      setLatitude(null);
      setLongitude(null);
      setType("home");
      setCoverPhotoUrl(null);
      setPickedPreview(null);
      setUploading(false);
      setLocation(null);
    }
  }, [visible]);

  async function pickPhoto() {
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow photo access to add a property photo.");
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
      setCoverPhotoUrl(null);
    } finally {
      setUploading(false);
    }
  }

  const canSubmit = name.trim().length > 0 && !!coverPhotoUrl && !uploading;

  const handleSubmit = () => {
    if (!canSubmit || !coverPhotoUrl) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const trimmed = address.trim();
    // Only keep place data if the address text still matches what we picked.
    const keepPlaceData = !!placeId && trimmed === address;
    onSubmit({
      name: name.trim(),
      address: trimmed,
      type,
      coverPhotoUrl,
      placeId: keepPlaceData ? placeId : null,
      latitude: keepPlaceData ? latitude : null,
      longitude: keepPlaceData ? longitude : null,
    });
    onClose();
  };

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
          <Text style={[styles.title, { color: colors.foreground }]}>Add Property</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={[
              styles.addBtn,
              { backgroundColor: canSubmit ? colors.primary : colors.muted },
            ]}
          >
            <Text style={[styles.addText, { color: canSubmit ? colors.primaryForeground : colors.mutedForeground }]}>
              Create
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
            {pickedPreview ? (
              <Image source={{ uri: pickedPreview }} style={styles.photoImage} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Feather name="camera" size={28} color={colors.mutedForeground} />
                <Text style={[styles.photoBtnText, { color: colors.foreground }]}>
                  {uploading ? "Uploading…" : "Upload Photo"}
                </Text>
              </View>
            )}
          </TouchableOpacity>
          {pickedPreview ? (
            <TouchableOpacity onPress={pickPhoto} disabled={uploading} style={styles.changePhotoBtn}>
              <Text style={[styles.changePhotoText, { color: colors.primary }]}>
                {uploading ? "Uploading…" : "Change Photo"}
              </Text>
            </TouchableOpacity>
          ) : null}

          <Text style={[styles.label, { color: colors.mutedForeground }]}>PROPERTY NAME</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            placeholder="e.g. Main House, Office Building"
            placeholderTextColor={colors.mutedForeground}
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
            <StaticMapPreview lat={location.lat} lng={location.lng} />
          ) : null}

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
  addBtn: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    minWidth: 56,
    alignItems: "center",
  },
  addText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
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
});
