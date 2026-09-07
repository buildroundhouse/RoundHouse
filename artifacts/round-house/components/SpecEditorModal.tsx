import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { uploadAsset } from "@/lib/uploads";
import { PhotoPreview } from "@/components/AttachmentList";

interface SpecValues {
  key: string;
  value: string;
  category: string;
  photoPath?: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (values: SpecValues) => void;
  initial?: Partial<SpecValues>;
  title: string;
}

const CATEGORIES = ["general", "paint", "materials", "appliances", "access", "other"];

export function SpecEditorModal({ visible, onClose, onSubmit, initial, title }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [category, setCategory] = useState("general");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (visible) {
      setKey(initial?.key ?? "");
      setValue(initial?.value ?? "");
      setCategory(initial?.category ?? "general");
      setPhotoPath(initial?.photoPath ?? null);
      setUploading(false);
    }
  }, [visible, initial]);

  const canSave = key.trim().length > 0 && !uploading;

  const handleSave = () => {
    if (!canSave) return;
    onSubmit({ key: key.trim(), value: value.trim(), category, photoPath });
    onClose();
  };

  const handlePickPhoto = async () => {
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission needed", "Allow photo access to attach an image.");
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    try {
      setUploading(true);
      const uploaded = await uploadAsset({
        uri: asset.uri,
        name: asset.fileName ?? undefined,
        contentType: asset.mimeType ?? undefined,
        size: asset.fileSize ?? undefined,
      });
      setPhotoPath(uploaded.path);
    } catch (err) {
      Alert.alert("Upload failed", err instanceof Error ? err.message : "Could not upload photo.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : 0 }]}>
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
          <Text style={[styles.label, { color: colors.mutedForeground }]}>CATEGORY</Text>
          <View style={styles.catRow}>
            {CATEGORIES.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => setCategory(c)}
                style={[
                  styles.catBtn,
                  {
                    backgroundColor: category === c ? colors.primary : colors.card,
                    borderColor: category === c ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.catText,
                    { color: category === c ? colors.primaryForeground : colors.foreground },
                  ]}
                >
                  {c}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>LABEL</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            placeholder="e.g. Living room paint"
            placeholderTextColor={colors.mutedForeground}
            value={key}
            onChangeText={setKey}
            autoFocus
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>VALUE</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            placeholder="e.g. Sherwin-Williams Alabaster SW7008"
            placeholderTextColor={colors.mutedForeground}
            value={value}
            onChangeText={setValue}
            multiline
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>PHOTO</Text>
          {photoPath ? (
            <PhotoPreview path={photoPath} size={140} onRemove={() => setPhotoPath(null)} />
          ) : null}
          <TouchableOpacity
            onPress={handlePickPhoto}
            disabled={uploading}
            style={[styles.attachBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Feather name="camera" size={16} color={colors.foreground} />
            )}
            <Text style={[styles.attachText, { color: colors.foreground }]}>
              {uploading ? "Uploading…" : photoPath ? "Replace photo" : "Attach photo"}
            </Text>
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
  label: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 6,
  },
  catRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  catBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  catText: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    minHeight: 44,
  },
  attachBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
    alignSelf: "flex-start",
  },
  attachText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
