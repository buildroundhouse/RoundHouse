import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
import * as ImagePicker from "expo-image-picker";
import { useColors } from "@/hooks/useColors";
import { uploadAsset, resolveStorageUrl } from "@/lib/uploads";

export interface AssetValues {
  name: string;
  assetTag: string | null;
  category: string | null;
  location: string | null;
  photoUrl: string | null;
  notes: string;
}

interface Props {
  visible: boolean;
  title: string;
  initial?: Partial<AssetValues>;
  onClose: () => void;
  onSubmit: (values: AssetValues) => void;
}

const CATEGORIES = ["HVAC", "Plumbing", "Electrical", "Appliance", "Roof", "Safety", "Other"];

export function AssetEditorModal({ visible, title, initial, onClose, onSubmit }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState("");
  const [assetTag, setAssetTag] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [pickedPreview, setPickedPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (visible) {
      setName(initial?.name ?? "");
      setAssetTag(initial?.assetTag ?? "");
      setCategory(initial?.category ?? null);
      setLocation(initial?.location ?? "");
      setNotes(initial?.notes ?? "");
      setPhotoUrl(initial?.photoUrl ?? null);
      setPickedPreview(null);
      setUploading(false);
    }
  }, [visible, initial]);

  const canSave = name.trim().length > 0 && !uploading;

  const handleSave = () => {
    if (!canSave) return;
    onSubmit({
      name: name.trim(),
      assetTag: assetTag.trim() || null,
      category,
      location: location.trim() || null,
      photoUrl,
      notes: notes.trim(),
    });
    onClose();
  };

  const pickPhoto = async () => {
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow photo access to add an asset photo.");
        return;
      }
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setPickedPreview(a.uri);
    setUploading(true);
    try {
      const uploaded = await uploadAsset({
        uri: a.uri,
        name: a.fileName ?? "asset.jpg",
        contentType: a.mimeType ?? "image/jpeg",
        size: a.fileSize ?? null,
      });
      setPhotoUrl(uploaded.path);
    } catch (e) {
      Alert.alert("Upload failed", e instanceof Error ? e.message : "Try again.");
      setPickedPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const previewSrc = pickedPreview ?? (photoUrl ? resolveStorageUrl(photoUrl) : null);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          <TouchableOpacity
            onPress={handleSave}
            style={[styles.saveBtn, { backgroundColor: canSave ? colors.primary : colors.muted }]}
          >
            <Text style={[styles.saveText, { color: canSave ? colors.primaryForeground : colors.mutedForeground }]}>
              Save
            </Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={[styles.label, { color: colors.mutedForeground }]}>NAME</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Rooftop AC Unit"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            autoFocus
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>ASSET TAG</Text>
          <TextInput
            value={assetTag}
            onChangeText={setAssetTag}
            placeholder="e.g. HVAC-01"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="characters"
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>CATEGORY</Text>
          <View style={styles.chipRow}>
            {CATEGORIES.map((c) => {
              const active = category === c;
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => setCategory(active ? null : c)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? colors.primary : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.foreground }]}>
                    {c}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>LOCATION</Text>
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Roof, North side"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>NOTES</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Model, serial #, warranty info..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[styles.input, styles.multiline, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>PHOTO</Text>
          {previewSrc ? (
            <View style={{ marginTop: 6 }}>
              <Image source={{ uri: previewSrc }} style={styles.photo} />
              <TouchableOpacity onPress={() => setPhotoUrl(null)} style={[styles.removePhoto, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="x" size={14} color={colors.foreground} />
              </TouchableOpacity>
            </View>
          ) : null}
          <TouchableOpacity
            onPress={pickPhoto}
            disabled={uploading}
            style={[styles.attachBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Feather name="image" size={14} color={colors.foreground} />
            <Text style={[styles.attachText, { color: colors.foreground }]}>{photoUrl ? "Change photo" : "Add photo"}</Text>
            {uploading && <ActivityIndicator size="small" color={colors.primary} />}
          </TouchableOpacity>

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
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  cancelText: { fontSize: 16, fontFamily: "Inter_400Regular" },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20 },
  saveText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  content: { padding: 20, gap: 8 },
  label: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8, marginTop: 16, marginBottom: 6 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1 },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    minHeight: 44,
  },
  multiline: { minHeight: 80, textAlignVertical: "top" },
  photo: { width: "100%", aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: "#0002" },
  removePhoto: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  attachBtn: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  attachText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
