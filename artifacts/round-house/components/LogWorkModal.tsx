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
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { WorkLog, Property } from "@/context/AppContext";
import * as Haptics from "expo-haptics";

interface Props {
  visible: boolean;
  onClose: () => void;
  properties: Property[];
  defaultPropertyId?: string;
  onSubmit: (data: Omit<WorkLog, "id" | "timestamp" | "viewed" | "score" | "isRealTime">) => void;
}

export function LogWorkModal({ visible, onClose, properties, defaultPropertyId, onSubmit }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [note, setNote] = useState("");
  const [photoUri, setPhotoUri] = useState<string | undefined>();
  const [propertyId, setPropertyId] = useState(defaultPropertyId || properties[0]?.id || "");
  const [submitting, setSubmitting] = useState(false);

  const handlePickPhoto = async () => {
    if (Platform.OS === "web") {
      Alert.alert("Camera", "Photo capture is not available on web.");
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Please allow photo access to attach images.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const handleCamera = async () => {
    if (Platform.OS === "web") {
      Alert.alert("Camera", "Camera capture is not available on web.");
      return;
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Please allow camera access to take photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const handleSubmit = async () => {
    if (!note.trim() && !photoUri) return;
    if (!propertyId) {
      Alert.alert("No property", "Please select a property first.");
      return;
    }
    setSubmitting(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onSubmit({ propertyId, note: note.trim(), photoUri });
    setNote("");
    setPhotoUri(undefined);
    setSubmitting(false);
    onClose();
  };

  const canSubmit = (note.trim().length > 0 || !!photoUri) && !!propertyId;

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
          <Text style={[styles.title, { color: colors.foreground }]}>Log Work</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={!canSubmit || submitting}
            style={[
              styles.logBtn,
              { backgroundColor: canSubmit ? colors.primary : colors.muted },
            ]}
          >
            <Text style={[styles.logBtnText, { color: canSubmit ? colors.primaryForeground : colors.mutedForeground }]}>
              Log
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {properties.length > 1 && (
            <>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PROPERTY</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.propScroll}>
                {properties.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[
                      styles.propChip,
                      {
                        backgroundColor: propertyId === p.id ? p.coverColor : colors.card,
                        borderColor: propertyId === p.id ? p.coverColor : colors.border,
                      },
                    ]}
                    onPress={() => {
                      setPropertyId(p.id);
                      Haptics.selectionAsync();
                    }}
                  >
                    <Text
                      style={[
                        styles.propChipText,
                        { color: propertyId === p.id ? "#FFFFFF" : colors.foreground },
                      ]}
                    >
                      {p.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>WHAT WAS DONE</Text>
          <TextInput
            style={[
              styles.noteInput,
              { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground },
            ]}
            placeholder="Describe the work completed..."
            placeholderTextColor={colors.mutedForeground}
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
            autoFocus={properties.length <= 1}
          />

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PHOTO</Text>
          {photoUri ? (
            <View style={styles.photoPreviewContainer}>
              <Image source={{ uri: photoUri }} style={styles.photoPreview} />
              <TouchableOpacity
                style={[styles.removePhoto, { backgroundColor: colors.destructive }]}
                onPress={() => setPhotoUri(undefined)}
              >
                <Feather name="x" size={14} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.photoRow}>
              <TouchableOpacity
                style={[styles.photoBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={handleCamera}
              >
                <Feather name="camera" size={20} color={colors.primary} />
                <Text style={[styles.photoBtnText, { color: colors.foreground }]}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.photoBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={handlePickPhoto}
              >
                <Feather name="image" size={20} color={colors.primary} />
                <Text style={[styles.photoBtnText, { color: colors.foreground }]}>Library</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={[styles.tipBox, { backgroundColor: colors.scoreBackground }]}>
            <Feather name="zap" size={13} color={colors.primary} />
            <Text style={[styles.tipText, { color: colors.primary }]}>
              Logging in real-time earns bonus points
            </Text>
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
  cancelText: { fontSize: 16, fontFamily: "Inter_400Regular" },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  logBtn: {
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 20,
  },
  logBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, gap: 8 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginTop: 16,
    marginBottom: 8,
  },
  propScroll: { marginBottom: 4 },
  propChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
    marginRight: 8,
  },
  propChipText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  noteInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    minHeight: 100,
  },
  photoRow: { flexDirection: "row", gap: 12 },
  photoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
  },
  photoBtnText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  photoPreviewContainer: { position: "relative" },
  photoPreview: { width: "100%", height: 180, borderRadius: 10 },
  removePhoto: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  tipBox: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
    marginTop: 12,
  },
  tipText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
});
