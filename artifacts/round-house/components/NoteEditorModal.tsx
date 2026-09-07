import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useColors } from "@/hooks/useColors";
import { uploadAsset } from "@/lib/uploads";
import { AttachmentList, type AttachmentItem } from "@/components/AttachmentList";

interface NoteValues {
  title: string;
  body: string;
  isPinned: boolean;
  attachments: AttachmentItem[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (values: NoteValues) => void;
  initial?: Partial<NoteValues>;
  title: string;
}

export function NoteEditorModal({ visible, onClose, onSubmit, initial, title }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [noteTitle, setNoteTitle] = useState("");
  const [body, setBody] = useState("");
  const [isPinned, setIsPinned] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (visible) {
      setNoteTitle(initial?.title ?? "");
      setBody(initial?.body ?? "");
      setIsPinned(initial?.isPinned ?? false);
      setAttachments(initial?.attachments ?? []);
      setUploading(false);
    }
  }, [visible, initial]);

  const canSave = body.trim().length > 0 && !uploading;

  const handleSave = () => {
    if (!canSave) return;
    onSubmit({ title: noteTitle.trim(), body: body.trim(), isPinned, attachments });
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
      allowsMultipleSelection: false,
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
      setAttachments((prev) => [...prev, { ...uploaded, kind: "image" }]);
    } catch (err) {
      Alert.alert("Upload failed", err instanceof Error ? err.message : "Could not upload photo.");
    } finally {
      setUploading(false);
    }
  };

  const handlePickFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    try {
      setUploading(true);
      const uploaded = await uploadAsset({
        uri: asset.uri,
        name: asset.name,
        contentType: asset.mimeType ?? undefined,
        size: asset.size ?? undefined,
      });
      setAttachments((prev) => [...prev, { ...uploaded, kind: "file" }]);
    } catch (err) {
      Alert.alert("Upload failed", err instanceof Error ? err.message : "Could not upload file.");
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
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
          <Text style={[styles.label, { color: colors.mutedForeground }]}>TITLE (OPTIONAL)</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            placeholder="e.g. Front gate code"
            placeholderTextColor={colors.mutedForeground}
            value={noteTitle}
            onChangeText={setNoteTitle}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>NOTE</Text>
          <TextInput
            style={[
              styles.input,
              styles.bodyInput,
              { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
            ]}
            placeholder="Site rules, access instructions, known issues…"
            placeholderTextColor={colors.mutedForeground}
            value={body}
            onChangeText={setBody}
            multiline
            textAlignVertical="top"
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>ATTACHMENTS</Text>
          <AttachmentList attachments={attachments} onRemove={removeAttachment} />
          <View style={styles.attachRow}>
            <TouchableOpacity
              onPress={handlePickPhoto}
              disabled={uploading}
              style={[styles.attachBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            >
              <Feather name="image" size={14} color={colors.foreground} />
              <Text style={[styles.attachText, { color: colors.foreground }]}>Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handlePickFile}
              disabled={uploading}
              style={[styles.attachBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            >
              <Feather name="paperclip" size={14} color={colors.foreground} />
              <Text style={[styles.attachText, { color: colors.foreground }]}>File</Text>
            </TouchableOpacity>
            {uploading && <ActivityIndicator size="small" color={colors.primary} />}
          </View>

          <View style={[styles.pinRow, { borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.pinLabel, { color: colors.foreground }]}>Pin to top</Text>
              <Text style={[styles.pinSub, { color: colors.mutedForeground }]}>
                Pinned notes appear first and in onboarding.
              </Text>
            </View>
            <Switch value={isPinned} onValueChange={setIsPinned} />
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
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  bodyInput: { minHeight: 140 },
  attachRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 },
  attachBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  attachText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  pinRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 4,
    marginTop: 8,
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  pinLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  pinSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
