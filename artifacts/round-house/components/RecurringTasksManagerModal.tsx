import React, { useState } from "react";
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { confirm as crossPlatformConfirm } from "@/lib/confirm";
import {
  useListRecurringTasks,
  useCreateRecurringTask,
  useUpdateRecurringTask,
  useDeleteRecurringTask,
} from "@workspace/api-client-react";
import type { RecurringTask } from "@workspace/api-client-react";
import { RecurringTaskEditorModal, type RecurringTaskValues } from "./RecurringTaskEditorModal";

interface MemberOption {
  clerkId: string;
  name: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  propertyId: number;
  members: MemberOption[];
}

function cadenceLabel(t: RecurringTask): string {
  switch (t.cadence) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Every week";
    case "biweekly":
      return "Every 2 weeks";
    case "monthly":
      return "Every month";
    case "custom":
      return `Every ${t.cadenceValue} day${t.cadenceValue === 1 ? "" : "s"}`;
    default:
      return t.cadence;
  }
}

function nextRunLabel(d: string): string {
  const date = new Date(d);
  const diff = date.getTime() - Date.now();
  const days = Math.round(diff / (24 * 3600 * 1000));
  if (days < 0) return "Now";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

export function RecurringTasksManagerModal({ visible, onClose, propertyId, members }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const tasksQuery = useListRecurringTasks(propertyId);
  const createTask = useCreateRecurringTask();
  const updateTask = useUpdateRecurringTask();
  const deleteTask = useDeleteRecurringTask();
  const [editor, setEditor] = useState<{ open: boolean; task?: RecurringTask }>({ open: false });

  const tasks = tasksQuery.data?.recurringTasks ?? [];

  const handleSubmit = async (values: RecurringTaskValues) => {
    if (editor.task) {
      await updateTask.mutateAsync({
        taskId: editor.task.id,
        data: { ...values, isActive: editor.task.isActive },
      });
    } else {
      await createTask.mutateAsync({ propertyId, data: values });
    }
    tasksQuery.refetch();
  };

  const toggleActive = async (task: RecurringTask) => {
    await updateTask.mutateAsync({ taskId: task.id, data: { isActive: !task.isActive } });
    tasksQuery.refetch();
  };

  const handleDelete = async (task: RecurringTask) => {
    // #627: Use the cross-platform confirm helper so the dialog actually
    // surfaces on react-native-web (where bare `Alert.alert` is a no-op
    // stub) and native alike.
    const ok = await crossPlatformConfirm({
      title: "Delete recurring task",
      message: `Stop generating "${task.title}"?`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    await deleteTask.mutateAsync({ taskId: task.id });
    tasksQuery.refetch();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : 0 }]}>
          <TouchableOpacity onPress={onClose}>
            <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Done</Text>
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Recurring Tasks</Text>
          <TouchableOpacity
            onPress={() => setEditor({ open: true })}
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
          >
            <Feather name="plus" size={16} color={colors.primaryForeground} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
          {tasks.length === 0 ? (
            <View style={[styles.empty, { borderColor: colors.border }]}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No recurring tasks yet. Add one to auto-generate work orders on a cadence.
              </Text>
            </View>
          ) : (
            tasks.map((t) => (
              <TouchableOpacity
                key={t.id}
                onPress={() => setEditor({ open: true, task: t })}
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <View style={styles.cardHeader}>
                  <Text style={[styles.cardTitle, { color: colors.foreground }]}>{t.title}</Text>
                  <TouchableOpacity onPress={() => handleDelete(t)} style={styles.iconBtn}>
                    <Feather name="trash-2" size={16} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </View>
                {t.description ? (
                  <Text style={[styles.cardDesc, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {t.description}
                  </Text>
                ) : null}
                <View style={styles.metaRow}>
                  <View style={[styles.metaPill, { backgroundColor: colors.scoreBackground }]}>
                    <Feather name="repeat" size={11} color={colors.primary} />
                    <Text style={[styles.metaPillText, { color: colors.primary }]}>{cadenceLabel(t)}</Text>
                  </View>
                  <View style={[styles.metaPill, { backgroundColor: colors.scoreBackground }]}>
                    <Feather name="calendar" size={11} color={colors.primary} />
                    <Text style={[styles.metaPillText, { color: colors.primary }]}>
                      Next: {nextRunLabel(t.nextDueAt)}
                    </Text>
                  </View>
                  {t.assignee && (
                    <View style={[styles.metaPill, { backgroundColor: colors.scoreBackground }]}>
                      <Feather name="user" size={11} color={colors.primary} />
                      <Text style={[styles.metaPillText, { color: colors.primary }]}>{t.assignee.name}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.cardFooter}>
                  <TouchableOpacity onPress={() => toggleActive(t)} style={styles.toggleBtn}>
                    <Feather
                      name={t.isActive ? "toggle-right" : "toggle-left"}
                      size={20}
                      color={t.isActive ? colors.primary : colors.mutedForeground}
                    />
                    <Text style={[styles.toggleText, { color: t.isActive ? colors.primary : colors.mutedForeground }]}>
                      {t.isActive ? "Active" : "Paused"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>

        <RecurringTaskEditorModal
          visible={editor.open}
          onClose={() => setEditor({ open: false })}
          onSubmit={handleSubmit}
          members={members}
          initial={
            editor.task
              ? {
                  title: editor.task.title,
                  description: editor.task.description,
                  cadence: editor.task.cadence,
                  cadenceValue: editor.task.cadenceValue,
                  assigneeClerkId: editor.task.assigneeClerkId,
                  nextDueAt: editor.task.nextDueAt,
                }
              : undefined
          }
          title={editor.task ? "Edit recurring task" : "New recurring task"}
        />
      </View>
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
  addBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  content: { padding: 20, gap: 12 },
  empty: { padding: 18, borderWidth: StyleSheet.hairlineWidth, borderStyle: "dashed", borderRadius: 12 },
  emptyText: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14, gap: 8 },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardTitle: { fontSize: 15, fontFamily: "Inter_700Bold", flex: 1 },
  cardDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  metaPillText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  cardFooter: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  toggleBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  toggleText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  iconBtn: { padding: 6 },
});
