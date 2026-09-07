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
import * as DocumentPicker from "expo-document-picker";
import { useColors } from "@/hooks/useColors";
import { uploadAsset } from "@/lib/uploads";
import { AttachmentList, type AttachmentItem } from "@/components/AttachmentList";
import { DueDatePickerModal } from "@/components/DueDatePickerModal";
import { usePresetChips, usePresetChipsAll, chipLabel } from "@/lib/presetChips";

export interface WorkOrderValues {
  title: string;
  description: string;
  priority: string;
  dueDate?: string | null;
  assigneeClerkId?: string | null;
  attachments: AttachmentItem[];
  // Commercial-only (optional everywhere else):
  category?: string | null;
  assetId?: number | null;
  poNumber?: string | null;
  costEstimate?: string | null;
  requestApproval?: boolean;
}

interface MemberOption {
  clerkId: string;
  name: string;
}

interface AssetOption {
  id: number;
  name: string;
  assetTag: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (values: WorkOrderValues) => void;
  members: MemberOption[];
  initial?: Partial<WorkOrderValues>;
  title: string;
  // Commercial mode extras:
  showCommercialFields?: boolean;
  assets?: AssetOption[];
  // If true, hide assignment + show "Submit for approval" save (non-managers).
  approvalRequired?: boolean;
}

// Live preset values are sourced via usePresetChips in the component.
// These constants remain only as cold-start fallbacks if needed.
const PRIORITIES_FALLBACK = ["low", "normal", "high", "urgent"];
const CATEGORIES_FALLBACK = ["preventive", "corrective", "emergency", "inspection"];
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

export function WorkOrderEditorModal({
  visible,
  onClose,
  onSubmit,
  members,
  initial,
  title,
  showCommercialFields = false,
  assets = [],
  approvalRequired = false,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  // Pickers show only active chips, but label resolution uses the full
  // set so historical work orders referencing an archived priority or
  // category still render the current label tagged "(retired)".
  const priorityChips = usePresetChips("work_order_priorities");
  const categoryChips = usePresetChips("work_order_categories");
  const priorityChipsAll = usePresetChipsAll("work_order_priorities");
  const categoryChipsAll = usePresetChipsAll("work_order_categories");
  const PRIORITIES = priorityChips.length > 0
    ? priorityChips.map((c) => c.chipId)
    : PRIORITIES_FALLBACK;
  const CATEGORIES = categoryChips.length > 0
    ? categoryChips.map((c) => c.chipId)
    : CATEGORIES_FALLBACK;
  const priorityLabel = (id: string) => chipLabel(priorityChipsAll, id);
  const categoryLabel = (id: string) => chipLabel(categoryChipsAll, id);
  const [titleText, setTitleText] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [assigneeClerkId, setAssigneeClerkId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<number | null>(null);
  const [poNumber, setPoNumber] = useState("");
  const [costEstimate, setCostEstimate] = useState("");
  const [dueCalendarOpen, setDueCalendarOpen] = useState(false);

  useEffect(() => {
    if (visible) {
      setTitleText(initial?.title ?? "");
      setDescription(initial?.description ?? "");
      setPriority(initial?.priority ?? "normal");
      setDueDate(initial?.dueDate ?? null);
      setAssigneeClerkId(initial?.assigneeClerkId ?? null);
      setAttachments(initial?.attachments ?? []);
      setCategory(initial?.category ?? null);
      setAssetId(initial?.assetId ?? null);
      setPoNumber(initial?.poNumber ?? "");
      setCostEstimate(initial?.costEstimate ?? "");
      setUploading(false);
      setDueCalendarOpen(false);
    }
  }, [visible, initial]);

  const canSave = titleText.trim().length > 0 && !uploading;

  const handleSave = () => {
    if (!canSave) return;
    onSubmit({
      title: titleText.trim(),
      description: description.trim(),
      priority,
      dueDate,
      assigneeClerkId: approvalRequired ? null : assigneeClerkId,
      attachments,
      ...(showCommercialFields
        ? {
            category,
            assetId,
            poNumber: poNumber.trim() || null,
            costEstimate: costEstimate.trim() || null,
            requestApproval: approvalRequired,
          }
        : {}),
    });
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
          <Text style={[styles.label, { color: colors.mutedForeground }]}>TITLE</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            placeholder="e.g. Replace HVAC filter"
            placeholderTextColor={colors.mutedForeground}
            value={titleText}
            onChangeText={setTitleText}
            autoFocus
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>DESCRIPTION</Text>
          <TextInput
            style={[styles.input, styles.multiline, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            placeholder="Add details, location, instructions..."
            placeholderTextColor={colors.mutedForeground}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>PHOTOS & FILES</Text>
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

          <Text style={[styles.label, { color: colors.mutedForeground }]}>PRIORITY</Text>
          <View style={styles.chipRow}>
            {PRIORITIES.map((p) => (
              <TouchableOpacity
                key={p}
                onPress={() => setPriority(p)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: priority === p ? colors.primary : colors.card,
                    borderColor: priority === p ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: priority === p ? colors.primaryForeground : colors.foreground },
                  ]}
                >
                  {priorityLabel(p)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>DUE</Text>
          <View style={styles.chipRow}>
            {DUE_PRESETS.map((p) => {
              const iso = isoFromDays(p.days);
              const active = (dueDate ?? null) === iso ||
                (p.days == null && dueDate == null);
              return (
                <TouchableOpacity
                  key={p.label}
                  onPress={() => setDueDate(iso)}
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
                      { color: active ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              onPress={() => setDueCalendarOpen(true)}
              style={[
                styles.chip,
                {
                  backgroundColor:
                    dueDate && !DUE_PRESETS.some((p) => isoFromDays(p.days) === dueDate)
                      ? colors.primary
                      : colors.card,
                  borderColor:
                    dueDate && !DUE_PRESETS.some((p) => isoFromDays(p.days) === dueDate)
                      ? colors.primary
                      : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  {
                    color:
                      dueDate && !DUE_PRESETS.some((p) => isoFromDays(p.days) === dueDate)
                        ? colors.primaryForeground
                        : colors.foreground,
                    textTransform: "none",
                  },
                ]}
              >
                {dueDate && !DUE_PRESETS.some((p) => isoFromDays(p.days) === dueDate)
                  ? new Date(dueDate).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                  : "Pick a date…"}
              </Text>
            </TouchableOpacity>
          </View>

          {showCommercialFields && (
            <>
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
                        {categoryLabel(c)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {assets.length > 0 && (
                <>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>ASSET</Text>
                  <View style={styles.chipRow}>
                    <TouchableOpacity
                      onPress={() => setAssetId(null)}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: assetId == null ? colors.primary : colors.card,
                          borderColor: assetId == null ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: assetId == null ? colors.primaryForeground : colors.foreground }]}>
                        None
                      </Text>
                    </TouchableOpacity>
                    {assets.map((a) => {
                      const active = assetId === a.id;
                      const label = a.assetTag ? `${a.name} · ${a.assetTag}` : a.name;
                      return (
                        <TouchableOpacity
                          key={a.id}
                          onPress={() => setAssetId(a.id)}
                          style={[
                            styles.chip,
                            {
                              backgroundColor: active ? colors.primary : colors.card,
                              borderColor: active ? colors.primary : colors.border,
                            },
                          ]}
                        >
                          <Text style={[styles.chipText, { color: active ? colors.primaryForeground : colors.foreground, textTransform: "none" }]}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              <Text style={[styles.label, { color: colors.mutedForeground }]}>PO NUMBER</Text>
              <TextInput
                value={poNumber}
                onChangeText={setPoNumber}
                placeholder="e.g. PO-1042"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="characters"
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              />

              <Text style={[styles.label, { color: colors.mutedForeground }]}>COST ESTIMATE</Text>
              <TextInput
                value={costEstimate}
                onChangeText={setCostEstimate}
                placeholder="0.00"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
              />

              {approvalRequired && (
                <View style={[styles.approvalBanner, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <Feather name="alert-circle" size={14} color={colors.foreground} />
                  <Text style={[styles.approvalText, { color: colors.foreground }]}>
                    This request will be sent to a manager for approval before becoming an active work order.
                  </Text>
                </View>
              )}
            </>
          )}

          {!approvalRequired && (
            <>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>ASSIGN TO</Text>
          <View style={styles.chipRow}>
            <TouchableOpacity
              onPress={() => setAssigneeClerkId(null)}
              style={[
                styles.chip,
                {
                  backgroundColor: assigneeClerkId == null ? colors.primary : colors.card,
                  borderColor: assigneeClerkId == null ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: assigneeClerkId == null ? colors.primaryForeground : colors.foreground },
                ]}
              >
                Unassigned
              </Text>
            </TouchableOpacity>
            {members.map((m) => {
              const active = assigneeClerkId === m.clerkId;
              return (
                <TouchableOpacity
                  key={m.clerkId}
                  onPress={() => setAssigneeClerkId(m.clerkId)}
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
                      { color: active ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {m.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
            </>
          )}

          <View style={{ height: insets.bottom + 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
      <DueDatePickerModal
        visible={dueCalendarOpen}
        onClose={() => setDueCalendarOpen(false)}
        onApply={(iso) => setDueDate(iso)}
        onClear={() => setDueDate(null)}
        initialDate={dueDate}
      />
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
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "capitalize" },
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
  approvalBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 12,
  },
  approvalText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 16 },
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
});
