import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import {
  useListProperties,
  useCreateWorkLog,
  useCreateProperty,
  getGetAssignedToMeQueryKey,
} from "@workspace/api-client-react";
import { uploadAsset } from "@/lib/uploads";
import { AttachmentList, type AttachmentItem } from "@/components/AttachmentList";
import { DueDatePickerModal } from "@/components/DueDatePickerModal";

let externalOpenLog: (() => void) | null = null;
export function openCaptureLog() {
  externalOpenLog?.();
}

let externalOpenPhoto: (() => void) | null = null;
export function openCapturePhoto() {
  if (externalOpenPhoto) {
    externalOpenPhoto();
    return;
  }
  // The capture FAB hasn't mounted yet — extremely rare since it lives in the
  // (tabs) layout, but fall back to a friendly hint instead of silently
  // no-oping so the tap never feels broken.
  Alert.alert("Photo capture", "Capture isn't ready yet. Try again in a moment.");
}

// Logs-tab quick-entry hooks (#456). The Logs tab runs its own
// destination picker (PhotoLogPickerSheet) BEFORE handing off to the
// composer, so these openers skip the FAB's own picker and pre-assign
// the chosen log so the composer mounts with "WHERE IS THIS FOR?"
// already filled in.
let externalOpenPhotoForLog: ((propertyId: number) => void) | null = null;
export function openCapturePhotoForLog(propertyId: number) {
  if (externalOpenPhotoForLog) {
    externalOpenPhotoForLog(propertyId);
    return;
  }
  Alert.alert("Photo capture", "Capture isn't ready yet. Try again in a moment.");
}

let externalOpenNote: (() => void) | null = null;
export function openCaptureNote() {
  if (externalOpenNote) {
    externalOpenNote();
    return;
  }
  Alert.alert("Note", "Capture isn't ready yet. Try again in a moment.");
}

type Mode = "photo" | "note" | "log";

const MODE_TITLE: Record<Mode, string> = {
  photo: "Add a photo",
  note: "Add a note",
  log: "Log work",
};

const DUE_PRESETS: { label: string; days: number | null }[] = [
  { label: "No due date", days: null },
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "In a week", days: 7 },
  { label: "In 2 weeks", days: 14 },
];

function isoFromDays(days: number | null): string | null {
  if (days == null) return null;
  const d = new Date();
  d.setHours(17, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function CaptureFAB({ hideTrigger = false }: { hideTrigger?: boolean } = {}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [chooserOpen, setChooserOpen] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);

  const [note, setNote] = useState("");
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [propertyId, setPropertyId] = useState<number | null>(null);
  const [newPropertyName, setNewPropertyName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assigneeClerkId, setAssigneeClerkId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [dueCalendarOpen, setDueCalendarOpen] = useState(false);

  const { data: propertiesData } = useListProperties();
  const properties = propertiesData?.properties ?? [];
  const createLog = useCreateWorkLog();
  const createProperty = useCreateProperty();

  // Default the property on open.
  useEffect(() => {
    if (mode && propertyId == null && properties.length > 0) {
      setPropertyId(properties[0].id);
    }
  }, [mode, properties, propertyId]);

  // Expose a global "open log mode directly" hook for other screens.
  useEffect(() => {
    externalOpenLog = () => {
      setChooserOpen(false);
      setMode("log");
    };
    externalOpenPhoto = () => {
      setChooserOpen(false);
      openMode("photo");
    };
    externalOpenPhotoForLog = (pid: number) => {
      // Pre-assign the chosen log BEFORE switching modes so the
      // composer mounts with "WHERE IS THIS FOR?" already filled in
      // and the upload tile points at the right property.
      setChooserOpen(false);
      setPropertyId(pid);
      Haptics.selectionAsync();
      setMode("photo");
      // Skip the auto-camera launch on this entrypoint: the user
      // already navigated through the Logs picker, so dropping them
      // straight into the composer with attach controls is the right
      // affordance.
    };
    externalOpenNote = () => {
      setChooserOpen(false);
      openMode("note");
    };
    return () => {
      if (externalOpenLog) externalOpenLog = null;
      if (externalOpenPhoto) externalOpenPhoto = null;
      if (externalOpenPhotoForLog) externalOpenPhotoForLog = null;
      if (externalOpenNote) externalOpenNote = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reset() {
    setNote("");
    setPhotoUri(null);
    setAttachments([]);
    setUploadingFile(false);
    setNewPropertyName("");
    setPickerOpen(false);
    setSubmitting(false);
    setAssigneeClerkId(null);
    setDueDate(null);
    setDueCalendarOpen(false);
  }

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setUploadingFile(true);
      const uploaded = await uploadAsset({
        uri: asset.uri,
        name: asset.name,
        contentType: asset.mimeType ?? undefined,
        size: asset.size ?? undefined,
      });
      setAttachments((prev) => [...prev, { ...uploaded, kind: "file" }]);
    } catch (err) {
      Alert.alert("Upload failed", err instanceof Error ? err.message : "Could not attach file.");
    } finally {
      setUploadingFile(false);
    }
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  function close() {
    setMode(null);
    reset();
  }

  function openMode(next: Mode) {
    setChooserOpen(false);
    Haptics.selectionAsync();
    setMode(next);
    if (next === "photo" && Platform.OS !== "web") {
      // Try opening the camera right away on native. We deliberately
      // skip this on web because Safari/Chrome require the file input
      // to be triggered inside the same user-gesture as the tap, and
      // the setTimeout below loses that context. The "Camera" button
      // rendered on the form itself stays inside the gesture chain.
      setTimeout(() => takePhoto(), 50);
    }
  }

  async function takePhoto() {
    // On web (incl. mobile Safari PWA) expo-image-picker falls back to
    // an <input type="file" accept="image/*" capture> element, which the
    // browser routes to the system camera UI. No permission prompt is
    // needed there — the file picker itself is the consent — so we only
    // request camera permission on native platforms.
    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission required", "Please allow camera access to take photos.");
        return;
      }
    }
    try {
      const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true });
      if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
    } catch (err) {
      Alert.alert("Camera", err instanceof Error ? err.message : "Could not open the camera.");
    }
  }

  async function pickPhoto() {
    // Same web fallback story as takePhoto — the browser file picker is
    // the implicit consent, no permission prompt needed.
    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission required", "Please allow photo access to attach images.");
        return;
      }
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
        allowsEditing: true,
      });
      if (!result.canceled && result.assets[0]) setPhotoUri(result.assets[0].uri);
    } catch (err) {
      Alert.alert("Photos", err instanceof Error ? err.message : "Could not open the photo library.");
    }
  }

  async function handleSubmit() {
    const hasText = note.trim().length > 0;
    if (!hasText && !photoUri && attachments.length === 0) {
      Alert.alert("Empty entry", "Add a note, photo, or file to log.");
      return;
    }
    setSubmitting(true);
    try {
      let pid = propertyId;
      // Inline create property if user has none and entered a name.
      if (pid == null) {
        const name = newPropertyName.trim();
        if (!name) {
          Alert.alert("Where is this for?", "Pick a property or name a new one.");
          setSubmitting(false);
          return;
        }
        const created = await createProperty.mutateAsync({ data: { name } });
        pid = created.id;
        await queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
      }

      let photoUrl: string | undefined;
      if (photoUri) {
        const uploaded = await uploadAsset({ uri: photoUri });
        photoUrl = uploaded.path;
      }

      await createLog.mutateAsync({
        propertyId: pid,
        data: {
          note: hasText ? note.trim() : (mode === "photo" ? "Photo" : "Work logged"),
          isRealTime: true,
          score: 10,
          ...(photoUrl ? { photoUrl } : {}),
          ...(attachments.length > 0 ? { attachments } : {}),
          ...(assigneeClerkId ? { assigneeClerkId } : {}),
          ...(assigneeClerkId && dueDate ? { dueDate } : {}),
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/logs/feed"] });
      await queryClient.invalidateQueries({ queryKey: [`/api/properties/${pid}`] });
      if (assigneeClerkId) {
        await queryClient.invalidateQueries({ queryKey: getGetAssignedToMeQueryKey() });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      close();
    } catch (err) {
      Alert.alert("Could not save", (err as Error).message ?? "Try again.");
      setSubmitting(false);
    }
  }

  const selectedProp = properties.find((p) => p.id === propertyId) ?? null;
  const canAssign =
    mode === "log" &&
    selectedProp != null &&
    (selectedProp.userRole === "owner" || selectedProp.userRole === "admin");
  const assignableMembers = canAssign
    ? (selectedProp?.members ?? [])
        .filter((m) => !m.archivedAt && m.user?.clerkId)
        .map((m) => ({ clerkId: m.user!.clerkId, name: m.user!.name || m.user!.email || "Member" }))
    : [];

  // If property changes and current assignee no longer fits, clear it.
  useEffect(() => {
    if (assigneeClerkId && !assignableMembers.find((m) => m.clerkId === assigneeClerkId)) {
      setAssigneeClerkId(null);
      setDueDate(null);
    }
  }, [assigneeClerkId, assignableMembers]);

  return (
    <>
      {/* Floating action button — hidden on screens that put a different
          control in the center tab slot (e.g. Profile shows a Logs
          shortcut there). The composer modals below remain mounted so
          openCapture* helpers still work from anywhere. */}
      {hideTrigger ? null : (
        <View
          pointerEvents="box-none"
          style={[styles.fabHost, { bottom: insets.bottom + 38 }]}
        >
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setMode("log");
            }}
            onLongPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setChooserOpen(true);
            }}
            delayLongPress={350}
            style={({ pressed }) => [
              styles.fab,
              {
                backgroundColor: colors.primary,
                transform: [{ scale: pressed ? 0.96 : 1 }],
                shadowColor: "#000",
              },
            ]}
          >
            <Feather name="edit-3" size={18} color={colors.primaryForeground ?? "#fff"} />
          </Pressable>
        </View>
      )}

      {/* Quick action chooser */}
      <Modal visible={chooserOpen} transparent animationType="fade" onRequestClose={() => setChooserOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setChooserOpen(false)}>
          <Pressable
            onPress={() => {}}
            style={[
              styles.sheet,
              { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 16 },
            ]}
          >
            <View style={styles.sheetHandle} />
            <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Capture</Text>
            <ActionRow
              icon="camera"
              title="Take photo"
              subtitle="Snap and add it to a property timeline"
              onPress={() => openMode("photo")}
              colors={colors}
            />
            <ActionRow
              icon="edit-3"
              title="Add note"
              subtitle="Quick text entry"
              onPress={() => openMode("note")}
              colors={colors}
            />
            <ActionRow
              icon="check-square"
              title="Log work"
              subtitle="Note plus optional photo"
              onPress={() => openMode("log")}
              colors={colors}
              isLast
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Capture form */}
      <Modal visible={mode != null} animationType="slide" onRequestClose={close}>
        <View style={[styles.root, { backgroundColor: colors.background }]}>
          <View
            style={[
              styles.header,
              { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : insets.top + 8 },
            ]}
          >
            <Pressable onPress={close} hitSlop={20} style={{ padding: 8 }}>
              <Feather name="x" size={22} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {mode ? MODE_TITLE[mode] : ""}
            </Text>
            <Pressable
              onPress={handleSubmit}
              disabled={submitting}
              hitSlop={20}
              style={{ padding: 8 }}
            >
              <Text style={[styles.saveText, { color: submitting ? colors.mutedForeground : colors.primary }]}>
                {submitting ? "…" : "Save"}
              </Text>
            </Pressable>
          </View>

          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ flex: 1 }}
            keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
          >
            <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}>
              {/* Property pill / picker */}
              <Text style={[styles.label, { color: colors.mutedForeground }]}>WHERE IS THIS FOR?</Text>
              {properties.length > 0 ? (
                <Pressable
                  onPress={() => setPickerOpen(true)}
                  style={[styles.propertyPill, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                  <View style={[styles.dot, { backgroundColor: selectedProp?.coverColor || colors.primary }]} />
                  <Text style={[styles.propertyText, { color: colors.foreground }]} numberOfLines={1}>
                    {selectedProp?.name ?? "Pick a property"}
                  </Text>
                  <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
                </Pressable>
              ) : (
                <View style={{ gap: 8 }}>
                  <Text style={[styles.helper, { color: colors.mutedForeground }]}>
                    No property yet. Name one and we'll create it.
                  </Text>
                  <TextInput
                    value={newPropertyName}
                    onChangeText={setNewPropertyName}
                    placeholder="e.g. Maple St. job, The river house"
                    placeholderTextColor={colors.mutedForeground}
                    style={[
                      styles.input,
                      { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                    maxLength={80}
                  />
                </View>
              )}

              {/* Note */}
              <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 20 }]}>
                {mode === "note" ? "NOTE" : "WHAT HAPPENED"}
              </Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={
                  mode === "photo"
                    ? "Optional — describe the photo"
                    : mode === "note"
                    ? "Type a quick note…"
                    : "What did you do?"
                }
                placeholderTextColor={colors.mutedForeground}
                style={[
                  styles.input,
                  styles.textarea,
                  { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
                ]}
                multiline
                autoFocus={mode === "note" || mode === "log"}
              />

              {/* Photo */}
              {mode !== "note" ? (
                <>
                  <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 20 }]}>PHOTO</Text>
                  {photoUri ? (
                    <View style={[styles.photoWrap, { borderColor: colors.border }]}>
                      <Image source={{ uri: photoUri }} style={styles.photo} />
                      <Pressable
                        onPress={() => setPhotoUri(null)}
                        style={[styles.photoX, { backgroundColor: colors.card }]}
                      >
                        <Feather name="x" size={14} color={colors.foreground} />
                      </Pressable>
                    </View>
                  ) : (
                    <View style={{ flexDirection: "row", gap: 10 }}>
                      <PhotoBtn icon="camera" label="Camera" onPress={takePhoto} colors={colors} />
                      <PhotoBtn icon="image" label="Library" onPress={pickPhoto} colors={colors} />
                    </View>
                  )}
                </>
              ) : null}

              {/* Assign + due date (owners/admins only, work-log only) */}
              {canAssign && assignableMembers.length > 0 ? (
                <>
                  <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 20 }]}>
                    ASSIGN TO
                  </Text>
                  <View style={styles.chipRow}>
                    <ChipBtn
                      label="No one"
                      active={assigneeClerkId == null}
                      onPress={() => {
                        setAssigneeClerkId(null);
                        setDueDate(null);
                      }}
                      colors={colors}
                    />
                    {assignableMembers.map((m) => (
                      <ChipBtn
                        key={m.clerkId}
                        label={m.name}
                        active={assigneeClerkId === m.clerkId}
                        onPress={() => setAssigneeClerkId(m.clerkId)}
                        colors={colors}
                      />
                    ))}
                  </View>

                  {assigneeClerkId ? (
                    <>
                      <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 20 }]}>
                        DUE
                      </Text>
                      <View style={styles.chipRow}>
                        {DUE_PRESETS.map((p) => {
                          const iso = isoFromDays(p.days);
                          const active =
                            (p.days == null && dueDate == null) ||
                            (iso != null && dueDate === iso);
                          return (
                            <ChipBtn
                              key={p.label}
                              label={p.label}
                              active={active}
                              onPress={() => setDueDate(iso)}
                              colors={colors}
                            />
                          );
                        })}
                        <ChipBtn
                          label={
                            dueDate && !DUE_PRESETS.some((p) => isoFromDays(p.days) === dueDate)
                              ? new Date(dueDate).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })
                              : "Pick a date…"
                          }
                          active={
                            !!dueDate &&
                            !DUE_PRESETS.some((p) => isoFromDays(p.days) === dueDate)
                          }
                          onPress={() => setDueCalendarOpen(true)}
                          colors={colors}
                        />
                      </View>
                    </>
                  ) : null}
                </>
              ) : null}

              {/* Files (work-log only) */}
              {mode === "log" ? (
                <>
                  <Text style={[styles.label, { color: colors.mutedForeground, marginTop: 20 }]}>FILES</Text>
                  <AttachmentList attachments={attachments} onRemove={removeAttachment} size="sm" />
                  <View style={{ flexDirection: "row", gap: 10, marginTop: attachments.length ? 8 : 0 }}>
                    <PhotoBtn
                      icon="paperclip"
                      label={uploadingFile ? "Uploading…" : "Attach file"}
                      onPress={pickFile}
                      colors={colors}
                    />
                  </View>
                </>
              ) : null}
            </ScrollView>
          </KeyboardAvoidingView>

          {/* Property picker sheet */}
          <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
            <Pressable style={styles.backdrop} onPress={() => setPickerOpen(false)}>
              <Pressable
                onPress={() => {}}
                style={[
                  styles.sheet,
                  { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 16 },
                ]}
              >
                <View style={styles.sheetHandle} />
                <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Pick a property</Text>
                {properties.map((p, idx) => {
                  const selected = p.id === propertyId;
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => {
                        setPropertyId(p.id);
                        setPickerOpen(false);
                      }}
                      style={[
                        styles.pickerRow,
                        {
                          borderTopColor: colors.border,
                          borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                        },
                      ]}
                    >
                      <View style={[styles.dot, { backgroundColor: p.coverColor || colors.primary }]} />
                      <Text style={[styles.pickerText, { color: colors.foreground }]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      {selected ? <Feather name="check" size={18} color={colors.primary} /> : null}
                    </Pressable>
                  );
                })}
              </Pressable>
            </Pressable>
          </Modal>

          <DueDatePickerModal
            visible={dueCalendarOpen}
            onClose={() => setDueCalendarOpen(false)}
            onApply={(iso) => setDueDate(iso)}
            onClear={() => setDueDate(null)}
            initialDate={dueDate}
          />

          {submitting ? (
            <View style={styles.submittingOverlay}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
  colors,
  isLast,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  isLast?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.actionRow,
        {
          borderBottomColor: colors.border,
          borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={[styles.actionIcon, { backgroundColor: colors.muted }]}>
        <Feather name={icon} size={18} color={colors.foreground} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.actionTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.actionSubtitle, { color: colors.mutedForeground }]}>{subtitle}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

function ChipBtn({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: active ? colors.primary : colors.card,
          borderColor: active ? colors.primary : colors.border,
        },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          { color: active ? colors.primaryForeground ?? "#fff" : colors.foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function PhotoBtn({
  icon,
  label,
  onPress,
  colors,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.photoBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Feather name={icon} size={18} color={colors.foreground} />
      <Text style={[styles.photoBtnText, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fabHost: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  fab: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: "#fff",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 12,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(127,127,127,0.4)",
    marginBottom: 10,
  },
  sheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 8 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  actionSubtitle: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },

  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  saveText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  scroll: { padding: 16 },
  label: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginBottom: 8 },
  helper: { fontSize: 12, fontFamily: "Inter_500Medium" },
  propertyPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  propertyText: { flex: 1, fontSize: 14, fontFamily: "Inter_600SemiBold" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  textarea: { minHeight: 110, textAlignVertical: "top", paddingTop: 12 },
  photoWrap: {
    width: "100%",
    aspectRatio: 4 / 3,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    position: "relative",
  },
  photo: { width: "100%", height: "100%" },
  photoX: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  photoBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  photoBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 14,
  },
  pickerText: { flex: 1, fontSize: 15, fontFamily: "Inter_500Medium" },
  submittingOverlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
});
