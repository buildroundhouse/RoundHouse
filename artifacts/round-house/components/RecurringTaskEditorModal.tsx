import React, { useEffect, useState } from "react";
import {
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";

export interface RecurringTaskValues {
  title: string;
  description: string;
  cadence: string;
  cadenceValue: number;
  assigneeClerkId?: string | null;
  nextDueAt?: string;
}

interface MemberOption {
  clerkId: string;
  name: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSubmit: (values: RecurringTaskValues) => void;
  members: MemberOption[];
  initial?: Partial<RecurringTaskValues>;
  title: string;
}

const CADENCES: { value: string; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Bi-weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "custom", label: "Every N days" },
];

const FIRST_RUN_PRESETS: { label: string; days: number }[] = [
  { label: "Today", days: 0 },
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "Next week", days: 7 },
];

function isoFromDays(days: number): string {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function RecurringTaskEditorModal({ visible, onClose, onSubmit, members, initial, title }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [titleText, setTitleText] = useState("");
  const [description, setDescription] = useState("");
  const [cadence, setCadence] = useState("weekly");
  const [cadenceValue, setCadenceValue] = useState("1");
  const [assigneeClerkId, setAssigneeClerkId] = useState<string | null>(null);
  const [nextDueAt, setNextDueAt] = useState<string>(isoFromDays(0));

  useEffect(() => {
    if (visible) {
      setTitleText(initial?.title ?? "");
      setDescription(initial?.description ?? "");
      setCadence(initial?.cadence ?? "weekly");
      setCadenceValue(String(initial?.cadenceValue ?? 1));
      setAssigneeClerkId(initial?.assigneeClerkId ?? null);
      setNextDueAt(initial?.nextDueAt ?? isoFromDays(0));
    }
  }, [visible, initial]);

  const canSave = titleText.trim().length > 0;

  const handleSave = () => {
    if (!canSave) return;
    onSubmit({
      title: titleText.trim(),
      description: description.trim(),
      cadence,
      cadenceValue: Math.max(1, parseInt(cadenceValue, 10) || 1),
      assigneeClerkId,
      nextDueAt,
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
          <Text style={[styles.label, { color: colors.mutedForeground }]}>WHAT</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            placeholder="e.g. Clean fridge"
            placeholderTextColor={colors.mutedForeground}
            value={titleText}
            onChangeText={setTitleText}
            autoFocus
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>NOTES</Text>
          <TextInput
            style={[styles.input, styles.multiline, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            placeholder="Optional details / instructions"
            placeholderTextColor={colors.mutedForeground}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
          />

          <Text style={[styles.label, { color: colors.mutedForeground }]}>HOW OFTEN</Text>
          <View style={styles.chipRow}>
            {CADENCES.map((c) => (
              <TouchableOpacity
                key={c.value}
                onPress={() => setCadence(c.value)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: cadence === c.value ? colors.primary : colors.card,
                    borderColor: cadence === c.value ? colors.primary : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    { color: cadence === c.value ? colors.primaryForeground : colors.foreground },
                  ]}
                >
                  {c.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {cadence === "custom" && (
            <>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>EVERY (DAYS)</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                keyboardType="number-pad"
                value={cadenceValue}
                onChangeText={setCadenceValue}
                placeholder="e.g. 10"
                placeholderTextColor={colors.mutedForeground}
              />
            </>
          )}

          <Text style={[styles.label, { color: colors.mutedForeground }]}>FIRST RUN</Text>
          <View style={styles.chipRow}>
            {FIRST_RUN_PRESETS.map((p) => {
              const iso = isoFromDays(p.days);
              const active = nextDueAt === iso;
              return (
                <TouchableOpacity
                  key={p.label}
                  onPress={() => setNextDueAt(iso)}
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
          </View>

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
});
