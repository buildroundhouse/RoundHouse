import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  type AppStateStatus,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as Notifications from "expo-notifications";
import { Feather } from "@expo/vector-icons";
import { Stack, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useColors } from "@/hooks/useColors";
import { confirm } from "@/lib/confirm";
import { useRouter } from "expo-router";
import {
  useListReminders,
  useCreateReminder,
  useUpdateReminder,
  useDeleteReminder,
  useListQuestions,
  useCreateQuestion,
  useUpdateQuestion,
  useDeleteQuestion,
  useListActiveClients,
  useListCompanyNotices,
  useListPostableCompanyNoticeCompanies,
  useCreateCompanyNotice,
  useAcknowledgeCompanyNotice,
  useDeleteCompanyNotice,
  useNudgeCompanyNoticeMember,
  type ActiveClient,
  type Question,
  type CompanyNotice,
  type CompanyNoticeAck,
  type CompanyNoticePendingMember,
  type PostableCompanyNoticeCompany,
} from "@workspace/api-client-react";
import {
  clearFiredNotificationIds,
  clearMissingReminderIds,
  clearNotificationIdFor,
  describeDue,
  type Reminder,
  reminderDueIso,
  snoozeIso,
} from "@/lib/reminders";
import {
  cancelReminderNotification,
  cancelOsScheduledNotification,
  getScheduledReminderNotificationIds,
  scheduleReminderNotification,
} from "@/lib/reminderNotifications";
import {
  type CustomList,
  type CustomListItem,
  loadCustomLists,
  newId,
  saveCustomLists,
  SHOPPING_LIST_ID,
} from "@/lib/customLists";

// ---------------------------------------------------------------------------
// Notification scheduling helpers (preserved from the previous Reminders
// implementation — see history for full background on the in-memory id
// map and generation counters used to defeat stale-notification bugs).
// ---------------------------------------------------------------------------
const scheduleGenerations = new Map<number, number>();
const scheduledNotificationIds = new Map<number, string>();
function bumpScheduleGeneration(id: number): number {
  const next = (scheduleGenerations.get(id) ?? 0) + 1;
  scheduleGenerations.set(id, next);
  return next;
}
function currentScheduleGeneration(id: number): number {
  return scheduleGenerations.get(id) ?? 0;
}
function cancelTrackedNotification(id: number): void {
  const existing = scheduledNotificationIds.get(id);
  clearNotificationIdFor(scheduledNotificationIds, id);
  void cancelReminderNotification(id, existing);
}

type SnoozeOption = { label: string; hours: number };
const SNOOZE_OPTIONS: SnoozeOption[] = [
  { label: "1 hour", hours: 1 },
  { label: "Tomorrow", hours: 24 },
  { label: "Next week", hours: 24 * 7 },
];

async function confirmDelete(label: string, onConfirm: () => void) {
  // #627: Use the cross-platform confirm helper so the dialog surfaces
  // on react-native-web (where bare `Alert.alert` is a no-op stub) and
  // native alike.
  const ok = await confirm({
    title: "Delete?",
    message: label,
    confirmLabel: "Delete",
    cancelLabel: "Cancel",
    destructive: true,
  });
  if (ok) onConfirm();
}

// ---------------------------------------------------------------------------
// Section structure: the Reminders screen is now a hub with a fixed
// vertical sequence of seven sections. Each is collapsible. Top 5 is
// collapsed by default per the spec; everything else opens by default
// so newly arrived items aren't hidden.
// ---------------------------------------------------------------------------
type SectionKey =
  | "company"
  | "shopping"
  | "active"
  | "top5"
  | "lists"
  | "needFromYou"
  | "askPro";

const SECTIONS: { key: SectionKey; title: string; icon: keyof typeof Feather.glyphMap; defaultOpen: boolean; subtitle?: string }[] = [
  { key: "company", title: "Company Reminders", icon: "briefcase", defaultOpen: true, subtitle: "Important notices from the business" },
  { key: "shopping", title: "Shopping List", icon: "shopping-cart", defaultOpen: true },
  { key: "active", title: "Active Clients", icon: "users", defaultOpen: true, subtitle: "Current jobs in flight" },
  { key: "top5", title: "Top 5", icon: "star", defaultOpen: false, subtitle: "Your priority reminders" },
  { key: "lists", title: "New Lists", icon: "list", defaultOpen: true, subtitle: "Custom lists you create" },
  { key: "needFromYou", title: "What I Need From You", icon: "alert-circle", defaultOpen: true, subtitle: "Provider requests waiting on you" },
  { key: "askPro", title: "Ask a Pro", icon: "help-circle", defaultOpen: true, subtitle: "Questions you've sent to a pro" },
];

export default function RemindersScreen({
  embedded = false,
  onRequestAdd,
}: { embedded?: boolean; onRequestAdd?: (open: () => void) => void } = {}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const remindersQuery = useListReminders();
  const questionsQuery = useListQuestions();
  const activeClientsQuery = useListActiveClients();
  const router = useRouter();
  const createReminder = useCreateReminder();
  const updateReminder = useUpdateReminder();
  const deleteReminder = useDeleteReminder();
  const createQuestion = useCreateQuestion();
  const updateQuestion = useUpdateQuestion();
  const deleteQuestion = useDeleteQuestion();

  const [now, setNow] = useState(() => new Date());
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>(() =>
    SECTIONS.reduce((acc, s) => {
      acc[s.key] = !s.defaultOpen;
      return acc;
    }, {} as Record<SectionKey, boolean>),
  );
  const [addingReminder, setAddingReminder] = useState(false);
  const [snoozeFor, setSnoozeFor] = useState<Reminder | null>(null);
  const [askingPro, setAskingPro] = useState(false);
  const [requestingFromClient, setRequestingFromClient] = useState(false);
  const [answeringQuestion, setAnsweringQuestion] = useState<Question | null>(null);
  const [pickingNextStep, setPickingNextStep] = useState<Question | null>(null);
  const [customLists, setCustomLists] = useState<CustomList[]>([]);
  const [addingList, setAddingList] = useState(false);

  const items = remindersQuery.data?.reminders ?? [];
  const questions = questionsQuery.data?.questions ?? [];
  const activeClients = activeClientsQuery.data?.clients ?? [];
  const loading = remindersQuery.isLoading || questionsQuery.isLoading;

  // Re-tick due labels every minute.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Hydrate custom lists once on mount.
  useEffect(() => {
    void loadCustomLists().then(setCustomLists);
  }, []);

  const persistLists = useCallback((next: CustomList[]) => {
    setCustomLists(next);
    void saveCustomLists(next);
  }, []);

  const refetch = remindersQuery.refetch;

  // --- notification reconciliation (unchanged behavior) ---
  const reconcileFiredNotifications = useCallback(async () => {
    if (Platform.OS === "web") return;
    const stillScheduled = await getScheduledReminderNotificationIds();
    clearFiredNotificationIds(scheduledNotificationIds, stillScheduled);
  }, []);

  useEffect(() => {
    if (loading) return;
    void reconcileFiredNotifications();
    const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
      if (state === "active") void reconcileFiredNotifications();
    });
    return () => sub.remove();
  }, [loading, reconcileFiredNotifications]);

  useFocusEffect(
    useCallback(() => {
      void reconcileFiredNotifications();
    }, [reconcileFiredNotifications]),
  );

  const remindersData = remindersQuery.data;
  useEffect(() => {
    if (!remindersData) return;
    const presentIds = new Set<number>(
      (remindersData.reminders ?? []).map((r) => r.id),
    );
    clearMissingReminderIds(scheduledNotificationIds, presentIds);
  }, [remindersData]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const handle = (raw: unknown) => {
      const reminderId =
        typeof raw === "number"
          ? raw
          : typeof raw === "string" && raw.trim() !== "" && !isNaN(Number(raw))
            ? Number(raw)
            : null;
      if (reminderId == null) return;
      clearNotificationIdFor(scheduledNotificationIds, reminderId);
    };
    const recvSub = Notifications.addNotificationReceivedListener((n) => {
      handle(n?.request?.content?.data?.reminderId);
    });
    const respSub = Notifications.addNotificationResponseReceivedListener((r) => {
      handle(r?.notification?.request?.content?.data?.reminderId);
    });
    return () => {
      recvSub.remove();
      respSub.remove();
    };
  }, []);

  const scheduleAndStore = useCallback((reminder: Reminder) => {
    const gen = bumpScheduleGeneration(reminder.id);
    cancelTrackedNotification(reminder.id);
    void scheduleReminderNotification(reminder).then((notificationId) => {
      if (!notificationId) return;
      if (currentScheduleGeneration(reminder.id) !== gen) {
        void cancelOsScheduledNotification(notificationId);
        return;
      }
      scheduledNotificationIds.set(reminder.id, notificationId);
    });
  }, []);

  // --- reminder mutations ---
  const addReminder = useCallback(
    async (input: { title: string; note?: string; dueAt: string }) => {
      try {
        const created = await createReminder.mutateAsync({
          data: {
            title: input.title,
            note: input.note ?? null,
            dueAt: input.dueAt,
          },
        });
        await refetch();
        if (created) scheduleAndStore(created);
      } catch {
        Alert.alert("Couldn't save reminder", "Please try again.");
      }
    },
    [createReminder, refetch, scheduleAndStore],
  );

  const markDone = useCallback(
    async (id: number) => {
      bumpScheduleGeneration(id);
      cancelTrackedNotification(id);
      try {
        await updateReminder.mutateAsync({ reminderId: id, data: { done: true } });
        await refetch();
      } catch {
        Alert.alert("Couldn't update reminder", "Please try again.");
      }
    },
    [updateReminder, refetch],
  );

  const markUndone = useCallback(
    async (id: number) => {
      const target = items.find((r) => r.id === id);
      try {
        await updateReminder.mutateAsync({ reminderId: id, data: { done: false } });
        await refetch();
        if (target) scheduleAndStore({ ...target, done: false });
      } catch {
        Alert.alert("Couldn't update reminder", "Please try again.");
      }
    },
    [items, updateReminder, refetch, scheduleAndStore],
  );

  const removeReminder = useCallback(
    async (id: number) => {
      bumpScheduleGeneration(id);
      cancelTrackedNotification(id);
      try {
        await deleteReminder.mutateAsync({ reminderId: id });
        await refetch();
      } catch {
        Alert.alert("Couldn't delete reminder", "Please try again.");
      }
    },
    [deleteReminder, refetch],
  );

  const applySnooze = useCallback(
    async (id: number, hours: number) => {
      const target = items.find((r) => r.id === id);
      if (!target) return;
      const nextDue = snoozeIso(reminderDueIso(target), hours);
      setSnoozeFor(null);
      bumpScheduleGeneration(id);
      cancelTrackedNotification(id);
      try {
        await updateReminder.mutateAsync({
          reminderId: id,
          data: { dueAt: nextDue, done: false },
        });
        await refetch();
        scheduleAndStore({ ...target, dueAt: nextDue, done: false });
      } catch {
        Alert.alert("Couldn't snooze reminder", "Please try again.");
      }
    },
    [items, updateReminder, refetch, scheduleAndStore],
  );

  // --- question mutations ---
  const refetchQuestions = questionsQuery.refetch;

  const submitAskPro = useCallback(
    async (text: string, counterpartyName?: string) => {
      try {
        await createQuestion.mutateAsync({
          data: {
            kind: "ask_pro",
            questionText: text,
            counterpartyName: counterpartyName ?? null,
          },
        });
        await refetchQuestions();
      } catch {
        Alert.alert("Couldn't post question", "Please try again.");
      }
    },
    [createQuestion, refetchQuestions],
  );

  const submitRequest = useCallback(
    async (text: string, requestedAction: string, counterpartyName?: string) => {
      try {
        await createQuestion.mutateAsync({
          data: {
            kind: "request",
            questionText: text,
            requestedAction,
            counterpartyName: counterpartyName ?? null,
          },
        });
        await refetchQuestions();
      } catch {
        Alert.alert("Couldn't send request", "Please try again.");
      }
    },
    [createQuestion, refetchQuestions],
  );

  const submitAnswer = useCallback(
    async (questionId: number, answer: string) => {
      try {
        await updateQuestion.mutateAsync({
          questionId,
          data: { responseText: answer },
        });
        await refetchQuestions();
      } catch {
        Alert.alert("Couldn't post answer", "Please try again.");
      }
    },
    [updateQuestion, refetchQuestions],
  );

  const confirmAnswered = useCallback(
    async (q: Question) => {
      try {
        await updateQuestion.mutateAsync({
          questionId: q.id,
          data: { confirm: true },
        });
        await refetchQuestions();
        // Surface the next-step picker so the client can choose
        // appointment / list / curious immediately after confirming.
        setPickingNextStep({ ...q, status: "completed" });
      } catch {
        Alert.alert("Couldn't confirm answer", "Please try again.");
      }
    },
    [updateQuestion, refetchQuestions],
  );

  const pickNextStep = useCallback(
    async (q: Question, step: "appointment" | "list" | "curious") => {
      setPickingNextStep(null);
      try {
        await updateQuestion.mutateAsync({
          questionId: q.id,
          data: { nextStep: step },
        });
        await refetchQuestions();
      } catch {
        Alert.alert("Couldn't save next step", "Please try again.");
      }
    },
    [updateQuestion, refetchQuestions],
  );

  const completeRequest = useCallback(
    async (q: Question) => {
      try {
        await updateQuestion.mutateAsync({
          questionId: q.id,
          data: { complete: true },
        });
        await refetchQuestions();
      } catch {
        Alert.alert("Couldn't update request", "Please try again.");
      }
    },
    [updateQuestion, refetchQuestions],
  );

  const removeQuestion = useCallback(
    async (id: number) => {
      try {
        await deleteQuestion.mutateAsync({ questionId: id });
        await refetchQuestions();
      } catch {
        Alert.alert("Couldn't delete", "Please try again.");
      }
    },
    [deleteQuestion, refetchQuestions],
  );

  // --- partitioning ---
  const upcomingTop5 = useMemo(() => {
    const up = items.filter((r) => !r.done);
    up.sort((a, b) => reminderDueIso(a).localeCompare(reminderDueIso(b)));
    return up;
  }, [items]);
  const completedReminders = useMemo(() => {
    const done = items.filter((r) => r.done);
    done.sort((a, b) => reminderDueIso(b).localeCompare(reminderDueIso(a)));
    return done;
  }, [items]);
  const askProQuestions = useMemo(
    () => questions.filter((q) => q.kind === "ask_pro"),
    [questions],
  );
  const requestQuestions = useMemo(
    () => questions.filter((q) => q.kind === "request"),
    [questions],
  );

  // --- custom list mutations ---
  const updateList = useCallback(
    (listId: string, fn: (l: CustomList) => CustomList) => {
      const next = customLists.map((l) => (l.id === listId ? fn(l) : l));
      persistLists(next);
    },
    [customLists, persistLists],
  );

  const addListItem = useCallback(
    (listId: string, text: string) => {
      updateList(listId, (l) => ({
        ...l,
        items: [
          ...l.items,
          { id: newId(), text, done: false, createdAt: Date.now() },
        ],
      }));
    },
    [updateList],
  );

  const toggleListItem = useCallback(
    (listId: string, itemId: string) => {
      updateList(listId, (l) => ({
        ...l,
        items: l.items.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)),
      }));
    },
    [updateList],
  );

  const removeListItem = useCallback(
    (listId: string, itemId: string) => {
      updateList(listId, (l) => ({
        ...l,
        items: l.items.filter((i) => i.id !== itemId),
      }));
    },
    [updateList],
  );

  const addNewList = useCallback(
    (name: string) => {
      const next: CustomList[] = [
        ...customLists,
        {
          id: newId(),
          name,
          kind: "user",
          items: [],
          createdAt: Date.now(),
        },
      ];
      persistLists(next);
    },
    [customLists, persistLists],
  );

  const removeList = useCallback(
    (listId: string) => {
      persistLists(customLists.filter((l) => l.id !== listId));
    },
    [customLists, persistLists],
  );

  const toggleSection = useCallback((key: SectionKey) => {
    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
  }, []);

  const bottomPad = Platform.OS === "web" ? 34 + 24 : insets.bottom + 24;
  const shoppingList = customLists.find((l) => l.id === SHOPPING_LIST_ID) ?? null;
  const userLists = customLists.filter((l) => l.kind === "user");

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {embedded ? (
        <RemindersAddBridge onReady={onRequestAdd} open={() => setAddingReminder(true)} />
      ) : (
        <Stack.Screen
          options={{
            title: "Reminders",
            headerStyle: { backgroundColor: colors.background },
            headerTintColor: colors.foreground,
            headerShadowVisible: false,
            headerRight: () => (
              <Pressable
                onPress={() => setAddingReminder(true)}
                accessibilityLabel="Add reminder"
                hitSlop={10}
                style={{ paddingHorizontal: 6 }}
              >
                <Feather name="plus" size={22} color={colors.foreground} />
              </Pressable>
            ),
          }}
        />
      )}
      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}>
          {SECTIONS.map((s) => {
            const open = !collapsed[s.key];
            let count = 0;
            if (s.key === "shopping") count = shoppingList?.items.filter((i) => !i.done).length ?? 0;
            else if (s.key === "top5") count = upcomingTop5.length;
            else if (s.key === "lists") count = userLists.length;
            else if (s.key === "active") count = activeClients.length;
            else if (s.key === "needFromYou") count = requestQuestions.filter((q) => q.status !== "completed").length;
            else if (s.key === "askPro") count = askProQuestions.length;
            return (
              <View key={s.key} style={{ marginBottom: 6 }}>
                <SectionHeader
                  label={s.title}
                  icon={s.icon}
                  open={open}
                  count={count}
                  subtitle={s.subtitle}
                  onToggle={() => toggleSection(s.key)}
                />
                {open ? (
                  <View style={{ gap: 8, marginTop: 6 }}>
                    {s.key === "company" ? <CompanyRemindersSection /> : null}
                    {s.key === "shopping" && shoppingList ? (
                      <ListSection
                        list={shoppingList}
                        onAdd={(text) => addListItem(shoppingList.id, text)}
                        onToggle={(id) => toggleListItem(shoppingList.id, id)}
                        onRemove={(id) => removeListItem(shoppingList.id, id)}
                      />
                    ) : null}
                    {s.key === "active" ? (
                      <ActiveClientsSection
                        clients={activeClients}
                        loading={activeClientsQuery.isLoading}
                        onOpen={(c) => router.push(`/work-order/${c.mostRecentWorkOrderId}`)}
                      />
                    ) : null}
                    {s.key === "top5" ? (
                      <Top5Section
                        upcoming={upcomingTop5}
                        completed={completedReminders}
                        now={now}
                        onMarkDone={markDone}
                        onSnooze={(r) => setSnoozeFor(r)}
                        onDelete={(r) => confirmDelete(r.title, () => removeReminder(r.id))}
                        onUndo={markUndone}
                        onAdd={() => setAddingReminder(true)}
                      />
                    ) : null}
                    {s.key === "lists" ? (
                      <NewListsSection
                        lists={userLists}
                        onAddList={() => setAddingList(true)}
                        onAddItem={addListItem}
                        onToggleItem={toggleListItem}
                        onRemoveItem={removeListItem}
                        onRemoveList={(l) =>
                          confirmDelete(`List "${l.name}"`, () => removeList(l.id))
                        }
                      />
                    ) : null}
                    {s.key === "needFromYou" ? (
                      <NeedFromYouSection
                        items={requestQuestions}
                        onAdd={() => setRequestingFromClient(true)}
                        onComplete={completeRequest}
                        onDelete={(q) => confirmDelete(q.questionText, () => removeQuestion(q.id))}
                      />
                    ) : null}
                    {s.key === "askPro" ? (
                      <AskAProSection
                        items={askProQuestions}
                        onAdd={() => setAskingPro(true)}
                        onAnswer={(q) => setAnsweringQuestion(q)}
                        onConfirm={confirmAnswered}
                        onPickNextStep={(q) => setPickingNextStep(q)}
                        onDelete={(q) => confirmDelete(q.questionText, () => removeQuestion(q.id))}
                      />
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
      <AddReminderModal
        visible={addingReminder}
        onClose={() => setAddingReminder(false)}
        onSubmit={(payload) => {
          addReminder(payload);
          setAddingReminder(false);
        }}
      />
      <SnoozeSheet
        reminder={snoozeFor}
        onPick={(hours) => snoozeFor && applySnooze(snoozeFor.id, hours)}
        onClose={() => setSnoozeFor(null)}
      />
      <AskAProModal
        visible={askingPro}
        onClose={() => setAskingPro(false)}
        onSubmit={(text, name) => {
          void submitAskPro(text, name);
          setAskingPro(false);
        }}
      />
      <RequestModal
        visible={requestingFromClient}
        onClose={() => setRequestingFromClient(false)}
        onSubmit={(text, action, name) => {
          void submitRequest(text, action, name);
          setRequestingFromClient(false);
        }}
      />
      <AnswerModal
        question={answeringQuestion}
        onClose={() => setAnsweringQuestion(null)}
        onSubmit={(answer) => {
          if (answeringQuestion) void submitAnswer(answeringQuestion.id, answer);
          setAnsweringQuestion(null);
        }}
      />
      <NextStepSheet
        question={pickingNextStep}
        onPick={(step) => pickingNextStep && pickNextStep(pickingNextStep, step)}
        onClose={() => setPickingNextStep(null)}
      />
      <NewListModal
        visible={addingList}
        onClose={() => setAddingList(false)}
        onSubmit={(name) => {
          addNewList(name);
          setAddingList(false);
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section header — collapsible row with chevron, count, and subtitle.
// ---------------------------------------------------------------------------
function SectionHeader({
  label,
  icon,
  open,
  count,
  subtitle,
  onToggle,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  open: boolean;
  count: number;
  subtitle?: string;
  onToggle: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onToggle}
      accessibilityLabel={`${open ? "Collapse" : "Expand"} ${label}`}
      style={[styles.sectionHeader, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={[styles.sectionIconWrap, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <Feather name={icon} size={14} color={colors.foreground} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.sectionTitleRow}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]} numberOfLines={1}>
            {label}
          </Text>
          {count > 0 ? (
            <View style={[styles.countPill, { backgroundColor: colors.primary + "1A", borderColor: colors.primary + "44" }]}>
              <Text style={[styles.countPillText, { color: colors.primary }]}>{count}</Text>
            </View>
          ) : null}
        </View>
        {subtitle ? (
          <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Feather
        name={open ? "chevron-up" : "chevron-down"}
        size={18}
        color={colors.mutedForeground}
      />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Company Reminders & Active Clients are surface placeholders for now —
// they're wired into the structure so future tasks can drop their data
// in without re-doing the page layout.
// ---------------------------------------------------------------------------
function PlaceholderCard({ icon, message }: { icon: keyof typeof Feather.glyphMap; message: string }) {
  const colors = useColors();
  return (
    <View style={[styles.placeholder, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Feather name={icon} size={18} color={colors.mutedForeground} />
      <Text style={[styles.placeholderText, { color: colors.mutedForeground }]}>{message}</Text>
    </View>
  );
}

function CompanyRemindersSection() {
  const colors = useColors();
  const noticesQuery = useListCompanyNotices();
  const postableQuery = useListPostableCompanyNoticeCompanies();
  const acknowledgeNotice = useAcknowledgeCompanyNotice();
  const createNotice = useCreateCompanyNotice();
  const deleteNotice = useDeleteCompanyNotice();
  const [composing, setComposing] = useState(false);

  const refetchNotices = noticesQuery.refetch;

  const allNotices = noticesQuery.data?.notices ?? [];
  // Hide acknowledged notices from the live feed so the section
  // collapses to "all caught up" once the user dismisses every notice.
  const activeNotices = useMemo(
    () => allNotices.filter((n) => !n.acknowledgedAt),
    [allNotices],
  );

  // The backend computes the set of companies the signed-in user is
  // allowed to post to (owners + accepted team-seat admins / managers).
  // We use that list directly so team admins who don't own the skin
  // can still see the composer.
  const postableCompanies = useMemo<PostableCompanyNoticeCompany[]>(
    () => postableQuery.data?.companies ?? [],
    [postableQuery.data],
  );
  const canPost = postableCompanies.length > 0;

  const onAcknowledge = useCallback(
    async (notice: CompanyNotice) => {
      try {
        await acknowledgeNotice.mutateAsync({ noticeId: notice.id });
        await refetchNotices();
      } catch {
        Alert.alert("Couldn't acknowledge", "Please try again.");
      }
    },
    [acknowledgeNotice, refetchNotices],
  );

  const onDelete = useCallback(
    (notice: CompanyNotice) => {
      confirmDelete(notice.title, async () => {
        try {
          await deleteNotice.mutateAsync({ noticeId: notice.id });
          await refetchNotices();
        } catch {
          Alert.alert("Couldn't delete notice", "Please try again.");
        }
      });
    },
    [deleteNotice, refetchNotices],
  );

  const onCompose = useCallback(
    async (companyId: number, title: string, body: string) => {
      try {
        await createNotice.mutateAsync({
          companyId,
          data: { title, body },
        });
        setComposing(false);
        await refetchNotices();
      } catch {
        Alert.alert("Couldn't post notice", "Please try again.");
      }
    },
    [createNotice, refetchNotices],
  );

  if (noticesQuery.isLoading) {
    return (
      <View style={[styles.placeholder, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ gap: 8 }}>
      {activeNotices.length === 0 ? (
        <PlaceholderCard
          icon="bell"
          message="No company-wide notices right now. New ones from the business will land here."
        />
      ) : (
        activeNotices.map((n) => (
          <CompanyNoticeRow
            key={n.id}
            notice={n}
            onAcknowledge={() => onAcknowledge(n)}
            onDelete={() => onDelete(n)}
          />
        ))
      )}
      {canPost ? (
        <AddRowButton label="Post a company notice" onPress={() => setComposing(true)} />
      ) : null}
      <ComposeCompanyNoticeModal
        visible={composing}
        companies={postableCompanies}
        onClose={() => setComposing(false)}
        onSubmit={onCompose}
        submitting={createNotice.isPending}
      />
    </View>
  );
}

function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffMs = now.getTime() - then;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return "just now";
  if (diffMs < hour) {
    const m = Math.round(diffMs / minute);
    return `${m} min${m === 1 ? "" : "s"} ago`;
  }
  if (diffMs < day) {
    const h = Math.round(diffMs / hour);
    return `${h} hr${h === 1 ? "" : "s"} ago`;
  }
  const d = Math.round(diffMs / day);
  if (d < 7) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function CompanyNoticeRow({
  notice,
  onAcknowledge,
  onDelete,
}: {
  notice: CompanyNotice;
  onAcknowledge: () => void;
  onDelete: () => void;
}) {
  const colors = useColors();
  const senderLabel = notice.isSender
    ? "You"
    : notice.senderName?.trim() ||
      (notice.senderUsername ? `@${notice.senderUsername}` : "Team admin");
  const companyLabel = notice.companyName?.trim();
  const sub = companyLabel
    ? `${senderLabel} · ${companyLabel}`
    : senderLabel;
  return (
    <View
      style={[
        styles.noticeCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.noticeHeaderRow}>
        <Feather name="briefcase" size={14} color={colors.primary} />
        <Text style={[styles.noticeTitle, { color: colors.foreground }]} numberOfLines={2}>
          {notice.title}
        </Text>
      </View>
      <Text style={[styles.noticeBody, { color: colors.foreground }]}>
        {notice.body}
      </Text>
      <Text style={[styles.noticeMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
        {sub} · {relativeTime(notice.createdAt)}
      </Text>
      {notice.acks ? (
        <NoticeReadByRow
          noticeId={notice.id}
          acks={notice.acks}
          ackCount={notice.ackCount}
          recipientCount={notice.recipientCount}
          pendingMembers={notice.pendingMembers}
          noticeTitle={notice.title}
        />
      ) : null}
      <View style={styles.noticeActionsRow}>
        <TouchableOpacity
          onPress={onAcknowledge}
          accessibilityLabel={`Acknowledge ${notice.title}`}
          style={[styles.primaryAction, { backgroundColor: colors.primary }]}
        >
          <Feather name="check" size={14} color={colors.primaryForeground} />
          <Text style={[styles.primaryActionText, { color: colors.primaryForeground }]}>
            Got it
          </Text>
        </TouchableOpacity>
        {notice.canDelete ? (
          <TouchableOpacity
            onPress={onDelete}
            accessibilityLabel={`Delete ${notice.title}`}
            style={[styles.iconBtn, { borderColor: colors.border }]}
          >
            <Feather name="trash-2" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function ackDisplayName(ack: CompanyNoticeAck): string {
  return (
    ack.name?.trim() ||
    (ack.username ? `@${ack.username}` : "Team member")
  );
}

function ackInitial(ack: CompanyNoticeAck): string {
  const label = ackDisplayName(ack);
  const ch = label.replace(/^@/, "").trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

function NoticeReadByRow({
  noticeId,
  acks,
  ackCount,
  recipientCount,
  pendingMembers,
  noticeTitle,
}: {
  noticeId: number;
  acks: CompanyNoticeAck[];
  ackCount: number;
  recipientCount: number;
  pendingMembers?: CompanyNoticePendingMember[] | null;
  noticeTitle: string;
}) {
  const colors = useColors();
  const [sheetOpen, setSheetOpen] = useState(false);
  const total = Math.max(recipientCount, ackCount);
  const summary =
    total > 0
      ? `Acknowledged by ${ackCount} of ${total}`
      : `Acknowledged by ${ackCount}`;
  const visible = acks.slice(0, 3);
  const overflow = acks.length - visible.length;
  const namesLabel = acks.length
    ? acks
        .slice(0, 3)
        .map((a) => ackDisplayName(a))
        .join(", ") + (overflow > 0 ? ` +${overflow}` : "")
    : null;
  const accessibilityLabel = `See everyone who has read ${noticeTitle}. ${summary}.`;
  return (
    <Pressable
      onPress={() => setSheetOpen(true)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={styles.noticeReadByRow}
    >
      <View style={styles.noticeAvatarStack}>
        {visible.length === 0 ? (
          <View
            style={[
              styles.noticeAvatarFallback,
              {
                backgroundColor: colors.muted,
                borderColor: colors.card,
              },
            ]}
          >
            <Feather name="users" size={10} color={colors.mutedForeground} />
          </View>
        ) : (
          visible.map((a, i) =>
            a.avatarUrl ? (
              <Image
                key={a.memberClerkId}
                source={{ uri: a.avatarUrl }}
                style={[
                  styles.noticeAvatar,
                  { borderColor: colors.card, marginLeft: i === 0 ? 0 : -8 },
                ]}
              />
            ) : (
              <View
                key={a.memberClerkId}
                style={[
                  styles.noticeAvatarFallback,
                  {
                    backgroundColor: colors.muted,
                    borderColor: colors.card,
                    marginLeft: i === 0 ? 0 : -8,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.noticeAvatarInitial,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {ackInitial(a)}
                </Text>
              </View>
            ),
          )
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[styles.noticeReadByLabel, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {summary}
        </Text>
        {namesLabel ? (
          <Text
            style={[styles.noticeReadByNames, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {namesLabel}
          </Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
      <NoticeReadReceiptsSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        noticeId={noticeId}
        noticeTitle={noticeTitle}
        acks={acks}
        ackCount={ackCount}
        recipientCount={recipientCount}
        pendingMembers={pendingMembers ?? null}
      />
    </Pressable>
  );
}

function NoticeReadReceiptsSheet({
  visible,
  onClose,
  noticeId,
  noticeTitle,
  acks,
  ackCount,
  recipientCount,
  pendingMembers,
}: {
  visible: boolean;
  onClose: () => void;
  noticeId: number;
  noticeTitle: string;
  acks: CompanyNoticeAck[];
  ackCount: number;
  recipientCount: number;
  pendingMembers: CompanyNoticePendingMember[] | null;
}) {
  const colors = useColors();
  const nudgeMember = useNudgeCompanyNoticeMember();
  // Local map: clerkId -> "sent" once a nudge succeeds (or "pending" while
  // in flight). Drives the per-row button label and disabled state so the
  // admin can tell a nudge actually went out and can't double-tap it.
  const [nudgeState, setNudgeState] = useState<
    Record<string, "pending" | "sent">
  >({});
  // Server-supplied "last reminded at" timestamps survive sheet close/open
  // so an admin returning to the sheet can still see who was reminded
  // recently. We re-derive the "sent" pill from these on open and keep
  // them in sync after a successful local nudge.
  const NUDGE_WINDOW_MS = 24 * 60 * 60 * 1000;
  const [lastNudgedMap, setLastNudgedMap] = useState<Record<string, string>>(
    () => {
      const seed: Record<string, string> = {};
      for (const p of pendingMembers ?? []) {
        if (p.lastNudgedAt) seed[p.memberClerkId] = p.lastNudgedAt;
      }
      return seed;
    },
  );
  // Reset transient state whenever the sheet is reopened so a stale "Sent"
  // pill from a different notice doesn't carry across opens. Re-seed the
  // persistent "last reminded" map from the latest server data so the row
  // metadata reflects what's currently on the server.
  useEffect(() => {
    if (!visible) {
      setNudgeState({});
      return;
    }
    const seed: Record<string, string> = {};
    for (const p of pendingMembers ?? []) {
      if (p.lastNudgedAt) seed[p.memberClerkId] = p.lastNudgedAt;
    }
    setLastNudgedMap(seed);
  }, [visible, pendingMembers]);

  const handleNudge = useCallback(
    async (memberClerkId: string, displayName: string) => {
      if (nudgeState[memberClerkId]) return;
      setNudgeState((s) => ({ ...s, [memberClerkId]: "pending" }));
      try {
        const result = await nudgeMember.mutateAsync({
          noticeId,
          data: { memberClerkId },
        });
        setNudgeState((s) => ({ ...s, [memberClerkId]: "sent" }));
        const nudgedAt = result?.nudgedAt ?? new Date().toISOString();
        setLastNudgedMap((m) => ({ ...m, [memberClerkId]: nudgedAt }));
      } catch (err: unknown) {
        // The server returns 429 when an admin has already nudged this
        // person within the last 24h. Treat that as "already sent" rather
        // than a failure since the recipient was already notified.
        const status =
          err && typeof err === "object" && "status" in err
            ? Number((err as { status: unknown }).status)
            : null;
        if (status === 429) {
          setNudgeState((s) => ({ ...s, [memberClerkId]: "sent" }));
          Alert.alert(
            "Already nudged",
            `${displayName} was reminded recently. Try again tomorrow.`,
          );
          return;
        }
        setNudgeState((s) => {
          const next = { ...s };
          delete next[memberClerkId];
          return next;
        });
        Alert.alert("Couldn't send reminder", "Please try again.");
      }
    },
    [nudgeMember, noticeId, nudgeState],
  );

  const total = Math.max(recipientCount, ackCount);
  const summary =
    total > 0
      ? `${ackCount} of ${total} acknowledged`
      : `${ackCount} acknowledged`;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
          onPress={() => {}}
        >
          <View style={styles.readReceiptsHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.sheetTitle, { color: colors.foreground }]}
                numberOfLines={2}
              >
                Read receipts
              </Text>
              <Text
                style={[styles.sheetSubtitle, { color: colors.mutedForeground }]}
                numberOfLines={2}
              >
                {noticeTitle} · {summary}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              accessibilityLabel="Close read receipts"
              hitSlop={8}
              style={[styles.iconBtn, { borderColor: colors.border }]}
            >
              <Feather name="x" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.readReceiptsScroll}
            contentContainerStyle={{ paddingBottom: 4 }}
            showsVerticalScrollIndicator={false}
          >
            <Text
              style={[styles.readReceiptsSection, { color: colors.mutedForeground }]}
            >
              Read by ({acks.length})
            </Text>
            {acks.length === 0 ? (
              <Text
                style={[styles.readReceiptsEmpty, { color: colors.mutedForeground }]}
              >
                No one has acknowledged this notice yet.
              </Text>
            ) : (
              acks.map((a) => (
                <View key={a.memberClerkId} style={styles.readReceiptRow}>
                  {a.avatarUrl ? (
                    <Image
                      source={{ uri: a.avatarUrl }}
                      style={[styles.noticeAvatar, { borderColor: colors.card }]}
                    />
                  ) : (
                    <View
                      style={[
                        styles.noticeAvatarFallback,
                        {
                          backgroundColor: colors.muted,
                          borderColor: colors.card,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.noticeAvatarInitial,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {ackInitial(a)}
                      </Text>
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.readReceiptName, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {ackDisplayName(a)}
                    </Text>
                    <Text
                      style={[
                        styles.readReceiptMeta,
                        { color: colors.mutedForeground },
                      ]}
                      numberOfLines={1}
                    >
                      Read {relativeTime(a.acknowledgedAt)}
                    </Text>
                  </View>
                </View>
              ))
            )}
            {pendingMembers && pendingMembers.length > 0 ? (
              <>
                <Text
                  style={[
                    styles.readReceiptsSection,
                    { color: colors.mutedForeground, marginTop: 14 },
                  ]}
                >
                  Still waiting on ({pendingMembers.length})
                </Text>
                {pendingMembers.map((p) => {
                  const displayName = pendingDisplayName(p);
                  const state = nudgeState[p.memberClerkId];
                  const isPending = state === "pending";
                  // A nudge counts as "recently sent" when there's either a
                  // successful in-session nudge OR a server-recorded one
                  // inside the 24h rate-limit window. That keeps the "Sent"
                  // pill visible across sheet reopens until the recipient
                  // can actually be nudged again.
                  const lastNudgedIso = lastNudgedMap[p.memberClerkId];
                  const lastNudgedMs = lastNudgedIso
                    ? new Date(lastNudgedIso).getTime()
                    : NaN;
                  const recentlyNudged =
                    Number.isFinite(lastNudgedMs) &&
                    Date.now() - lastNudgedMs < NUDGE_WINDOW_MS;
                  const isSent = state === "sent" || recentlyNudged;
                  const metaLabel = recentlyNudged
                    ? `Reminded ${relativeTime(lastNudgedIso)}`
                    : "Not yet read";
                  return (
                    <View key={p.memberClerkId} style={styles.readReceiptRow}>
                      {p.avatarUrl ? (
                        <Image
                          source={{ uri: p.avatarUrl }}
                          style={[
                            styles.noticeAvatar,
                            { borderColor: colors.card, opacity: 0.65 },
                          ]}
                        />
                      ) : (
                        <View
                          style={[
                            styles.noticeAvatarFallback,
                            {
                              backgroundColor: colors.muted,
                              borderColor: colors.card,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.noticeAvatarInitial,
                              { color: colors.mutedForeground },
                            ]}
                          >
                            {pendingInitial(p)}
                          </Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.readReceiptName, { color: colors.foreground }]}
                          numberOfLines={1}
                        >
                          {displayName}
                        </Text>
                        <Text
                          style={[
                            styles.readReceiptMeta,
                            { color: colors.mutedForeground },
                          ]}
                          numberOfLines={1}
                        >
                          {metaLabel}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => handleNudge(p.memberClerkId, displayName)}
                        disabled={isPending || isSent}
                        accessibilityRole="button"
                        accessibilityLabel={
                          isSent
                            ? `Reminder sent to ${displayName}`
                            : `Send reminder to ${displayName}`
                        }
                        accessibilityState={{ disabled: isPending || isSent }}
                        style={[
                          styles.nudgeBtn,
                          {
                            borderColor: isSent ? colors.border : colors.primary,
                            backgroundColor: isSent
                              ? "transparent"
                              : colors.primary + "1A",
                            opacity: isPending ? 0.6 : 1,
                          },
                        ]}
                      >
                        {isPending ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <>
                            <Feather
                              name={isSent ? "check" : "bell"}
                              size={12}
                              color={
                                isSent ? colors.mutedForeground : colors.primary
                              }
                            />
                            <Text
                              style={[
                                styles.nudgeBtnText,
                                {
                                  color: isSent
                                    ? colors.mutedForeground
                                    : colors.primary,
                                },
                              ]}
                            >
                              {isSent ? "Sent" : "Nudge"}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function pendingDisplayName(p: CompanyNoticePendingMember): string {
  return (
    p.name?.trim() ||
    (p.username ? `@${p.username}` : "Team member")
  );
}

function pendingInitial(p: CompanyNoticePendingMember): string {
  const label = pendingDisplayName(p);
  const ch = label.replace(/^@/, "").trim().charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

function ComposeCompanyNoticeModal({
  visible,
  companies,
  onClose,
  onSubmit,
  submitting,
}: {
  visible: boolean;
  companies: PostableCompanyNoticeCompany[];
  onClose: () => void;
  onSubmit: (companyId: number, title: string, body: string) => void;
  submitting: boolean;
}) {
  const colors = useColors();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [companyId, setCompanyId] = useState<number | null>(null);

  useEffect(() => {
    if (visible) {
      setTitle("");
      setBody("");
      setCompanyId(companies[0]?.id ?? null);
    }
  }, [visible, companies]);

  const submit = () => {
    const t = title.trim();
    const b = body.trim();
    if (!t) {
      Alert.alert("Add a title", "A notice needs a short headline.");
      return;
    }
    if (!b) {
      Alert.alert("Add a body", "Tell your team what's changing.");
      return;
    }
    if (companyId == null) {
      Alert.alert("Pick a company", "Choose which team this notice goes to.");
      return;
    }
    onSubmit(companyId, t, b);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>New company notice</Text>
          <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground }]}>
            Posted to every member of the team.
          </Text>
          {companies.length > 1 ? (
            <>
              <Text style={[styles.formLabel, { color: colors.mutedForeground }]}>Team</Text>
              <View style={styles.choiceRow}>
                {companies.map((c) => {
                  const active = c.id === companyId;
                  const label = c.name;
                  return (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => setCompanyId(c.id)}
                      style={[
                        styles.choice,
                        {
                          borderColor: active ? colors.primary : colors.border,
                          backgroundColor: active ? colors.primary + "1A" : "transparent",
                        },
                      ]}
                    >
                      <Text
                        style={{
                          color: active ? colors.primary : colors.foreground,
                          fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
                          fontSize: 13,
                        }}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : null}
          <TextInput
            placeholder="Title (e.g. Holiday hours)"
            placeholderTextColor={colors.mutedForeground}
            value={title}
            onChangeText={setTitle}
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card },
            ]}
            autoFocus
          />
          <TextInput
            placeholder="What does the team need to know?"
            placeholderTextColor={colors.mutedForeground}
            value={body}
            onChangeText={setBody}
            multiline
            style={[
              styles.input,
              styles.inputMulti,
              { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card },
            ]}
          />
          <View style={styles.formActions}>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.formBtn, { borderWidth: 1, borderColor: colors.border }]}
            >
              <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submit}
              disabled={submitting}
              style={[styles.formBtn, { backgroundColor: colors.primary, opacity: submitting ? 0.6 : 1 }]}
            >
              <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }}>
                {submitting ? "Posting…" : "Post notice"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function formatLastActivity(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ActiveClientsSection({
  clients,
  loading,
  onOpen,
}: {
  clients: ActiveClient[];
  loading: boolean;
  onOpen: (client: ActiveClient) => void;
}) {
  const colors = useColors();
  if (loading && clients.length === 0) {
    return (
      <View style={[styles.placeholder, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (clients.length === 0) {
    return (
      <PlaceholderCard
        icon="users"
        message="No active clients yet. Open work orders assigned to you will surface here for quick access."
      />
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {clients.map((c) => {
        const display = c.clientName?.trim() || c.propertyName;
        const initial = (display || "?").trim().charAt(0).toUpperCase();
        const jobsLabel =
          c.activeWorkOrderCount === 1
            ? "1 active job"
            : `${c.activeWorkOrderCount} active jobs`;
        const subtitle = `${jobsLabel} · ${c.propertyName}`;
        const activity = formatLastActivity(c.lastActivityAt);
        return (
          <TouchableOpacity
            key={c.clientClerkId}
            onPress={() => onOpen(c)}
            accessibilityLabel={`Open ${display}, ${jobsLabel}`}
            style={[styles.activeClientRow, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.activeClientAvatar, { backgroundColor: colors.primary + "1A", borderColor: colors.primary + "44" }]}>
              <Text style={[styles.activeClientAvatarText, { color: colors.primary }]}>{initial}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.activeClientTitle, { color: colors.foreground }]} numberOfLines={1}>
                {display}
              </Text>
              <Text style={[styles.activeClientSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
                {subtitle}
              </Text>
              <Text style={[styles.activeClientMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                Latest: {c.mostRecentWorkOrderTitle}
                {activity ? ` · ${activity}` : ""}
              </Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Top 5 — reuses the existing reminder rows.
// ---------------------------------------------------------------------------
function Top5Section({
  upcoming,
  completed,
  now,
  onMarkDone,
  onSnooze,
  onDelete,
  onUndo,
  onAdd,
}: {
  upcoming: Reminder[];
  completed: Reminder[];
  now: Date;
  onMarkDone: (id: number) => void;
  onSnooze: (r: Reminder) => void;
  onDelete: (r: Reminder) => void;
  onUndo: (id: number) => void;
  onAdd: () => void;
}) {
  const colors = useColors();
  const top = upcoming.slice(0, 5);
  const overflow = upcoming.length > 5 ? upcoming.length - 5 : 0;
  return (
    <View style={{ gap: 8 }}>
      {top.length === 0 ? (
        <PlaceholderCard
          icon="check-circle"
          message="All caught up. Add a reminder to populate your Top 5."
        />
      ) : (
        top.map((r) => (
          <ReminderRow
            key={r.id}
            reminder={r}
            now={now}
            onDone={() => onMarkDone(r.id)}
            onSnooze={() => onSnooze(r)}
            onDelete={() => onDelete(r)}
          />
        ))
      )}
      {overflow > 0 ? (
        <Text style={[styles.overflowHint, { color: colors.mutedForeground }]}>
          + {overflow} more reminder{overflow === 1 ? "" : "s"} below your top five.
        </Text>
      ) : null}
      <AddRowButton label="Add a reminder" onPress={onAdd} />
      {completed.length > 0 ? (
        <View style={{ gap: 6, marginTop: 4 }}>
          <Text style={[styles.subSection, { color: colors.mutedForeground }]}>
            COMPLETED
          </Text>
          {completed.slice(0, 5).map((r) => (
            <CompletedRow
              key={r.id}
              reminder={r}
              onUndo={() => onUndo(r.id)}
              onDelete={() => onDelete(r)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Custom-list rendering used by both Shopping List and New Lists.
// ---------------------------------------------------------------------------
function ListSection({
  list,
  onAdd,
  onToggle,
  onRemove,
  onDeleteList,
}: {
  list: CustomList;
  onAdd: (text: string) => void;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onDeleteList?: () => void;
}) {
  const colors = useColors();
  const [draft, setDraft] = useState("");
  const submit = () => {
    const t = draft.trim();
    if (!t) return;
    onAdd(t);
    setDraft("");
  };
  return (
    <View style={[styles.listCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.listHeader}>
        <Text style={[styles.listTitle, { color: colors.foreground }]} numberOfLines={1}>
          {list.name}
        </Text>
        {onDeleteList ? (
          <TouchableOpacity
            onPress={onDeleteList}
            accessibilityLabel={`Delete list ${list.name}`}
            hitSlop={10}
            style={[styles.iconBtn, { borderColor: colors.border }]}
          >
            <Feather name="trash-2" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        ) : null}
      </View>
      {list.items.length === 0 ? (
        <Text style={[styles.emptyHint, { color: colors.mutedForeground }]}>
          Nothing on this list yet.
        </Text>
      ) : (
        list.items.map((it) => (
          <View key={it.id} style={styles.listItemRow}>
            <Pressable
              onPress={() => onToggle(it.id)}
              accessibilityLabel={`${it.done ? "Mark not done" : "Mark done"}: ${it.text}`}
              hitSlop={6}
              style={[styles.checkbox, { borderColor: colors.border, width: 22, height: 22, borderRadius: 11 }]}
            >
              <Feather
                name={it.done ? "check-circle" : "circle"}
                size={14}
                color={it.done ? colors.primary : colors.mutedForeground}
              />
            </Pressable>
            <Text
              style={[
                styles.listItemText,
                {
                  color: colors.foreground,
                  textDecorationLine: it.done ? "line-through" : "none",
                  opacity: it.done ? 0.6 : 1,
                },
              ]}
              numberOfLines={2}
            >
              {it.text}
            </Text>
            <TouchableOpacity
              onPress={() => onRemove(it.id)}
              accessibilityLabel={`Remove ${it.text}`}
              hitSlop={6}
              style={[styles.iconBtn, { borderColor: colors.border, width: 26, height: 26, borderRadius: 13 }]}
            >
              <Feather name="x" size={12} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
        ))
      )}
      <View style={styles.inlineAddRow}>
        <TextInput
          placeholder="Add an item"
          placeholderTextColor={colors.mutedForeground}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={submit}
          returnKeyType="done"
          style={[
            styles.inlineInput,
            { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.background },
          ]}
        />
        <TouchableOpacity
          onPress={submit}
          disabled={!draft.trim()}
          style={[styles.smallBtn, { backgroundColor: draft.trim() ? colors.primary : colors.border }]}
        >
          <Feather name="plus" size={14} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function NewListsSection({
  lists,
  onAddList,
  onAddItem,
  onToggleItem,
  onRemoveItem,
  onRemoveList,
}: {
  lists: CustomList[];
  onAddList: () => void;
  onAddItem: (listId: string, text: string) => void;
  onToggleItem: (listId: string, itemId: string) => void;
  onRemoveItem: (listId: string, itemId: string) => void;
  onRemoveList: (l: CustomList) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      {lists.length === 0 ? (
        <PlaceholderCard
          icon="list"
          message="Create a custom list to organize your own to-dos."
        />
      ) : (
        lists.map((l) => (
          <ListSection
            key={l.id}
            list={l}
            onAdd={(text) => onAddItem(l.id, text)}
            onToggle={(id) => onToggleItem(l.id, id)}
            onRemove={(id) => onRemoveItem(l.id, id)}
            onDeleteList={() => onRemoveList(l)}
          />
        ))
      )}
      <AddRowButton label="Add a new list" onPress={onAddList} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// What I Need From You — provider→client requests. Two states only:
// waiting → completed. No points awarded.
// ---------------------------------------------------------------------------
function NeedFromYouSection({
  items,
  onAdd,
  onComplete,
  onDelete,
}: {
  items: Question[];
  onAdd: () => void;
  onComplete: (q: Question) => void;
  onDelete: (q: Question) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      {items.length === 0 ? (
        <PlaceholderCard
          icon="alert-circle"
          message="Nothing waiting on you. Provider requests to approve, upload, or confirm will appear here."
        />
      ) : (
        items.map((q) => (
          <RequestRow key={q.id} question={q} onComplete={onComplete} onDelete={onDelete} />
        ))
      )}
      <AddRowButton label="New provider request (demo)" onPress={onAdd} />
    </View>
  );
}

function RequestRow({
  question,
  onComplete,
  onDelete,
}: {
  question: Question;
  onComplete: (q: Question) => void;
  onDelete: (q: Question) => void;
}) {
  const colors = useColors();
  const done = question.status === "completed";
  const action = (question.requestedAction ?? "respond").toString();
  return (
    <View
      style={[
        styles.qaCard,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: done ? 0.65 : 1 },
      ]}
    >
      <View style={styles.qaHeaderRow}>
        <View
          style={[
            styles.qaTag,
            { borderColor: colors.border, backgroundColor: colors.background },
          ]}
        >
          <Text style={[styles.qaTagText, { color: colors.mutedForeground }]}>
            What I Need From You · {action}
          </Text>
        </View>
        <Text style={[styles.qaStatus, { color: done ? colors.primary : "#E11D2E" }]}>
          {done ? "Completed" : "Waiting on you"}
        </Text>
      </View>
      {question.counterpartyName ? (
        <Text style={[styles.qaCounterparty, { color: colors.mutedForeground }]}>
          From {question.counterpartyName}
        </Text>
      ) : null}
      <Text style={[styles.qaText, { color: colors.foreground }]}>
        {question.questionText}
      </Text>
      {question.responseText ? (
        <Text style={[styles.qaResponse, { color: colors.mutedForeground }]}>
          You: {question.responseText}
        </Text>
      ) : null}
      <View style={styles.qaActionsRow}>
        {!done ? (
          <TouchableOpacity
            onPress={() => onComplete(question)}
            style={[styles.primaryAction, { backgroundColor: colors.primary }]}
          >
            <Feather name="check" size={14} color={colors.primaryForeground} />
            <Text style={[styles.primaryActionText, { color: colors.primaryForeground }]}>
              Mark handled
            </Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={() => onDelete(question)}
          accessibilityLabel="Delete request"
          style={[styles.iconBtn, { borderColor: colors.border }]}
        >
          <Feather name="trash-2" size={14} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Ask a Pro — gamified client→provider Q&A.
// Status: open → answered → completed.
//   • on answer  → +5 pts to provider
//   • on confirm → +20 pts to provider, then client picks next step
// ---------------------------------------------------------------------------
function AskAProSection({
  items,
  onAdd,
  onAnswer,
  onConfirm,
  onPickNextStep,
  onDelete,
}: {
  items: Question[];
  onAdd: () => void;
  onAnswer: (q: Question) => void;
  onConfirm: (q: Question) => void;
  onPickNextStep: (q: Question) => void;
  onDelete: (q: Question) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      {items.length === 0 ? (
        <PlaceholderCard
          icon="help-circle"
          message="No questions yet. Tap below to ask a pro something — they earn points when they answer and when you confirm it helped."
        />
      ) : (
        items.map((q) => (
          <AskProRow
            key={q.id}
            question={q}
            onAnswer={onAnswer}
            onConfirm={onConfirm}
            onPickNextStep={onPickNextStep}
            onDelete={onDelete}
          />
        ))
      )}
      <AddRowButton label="Ask a pro a question" onPress={onAdd} />
    </View>
  );
}

function AskProRow({
  question,
  onAnswer,
  onConfirm,
  onPickNextStep,
  onDelete,
}: {
  question: Question;
  onAnswer: (q: Question) => void;
  onConfirm: (q: Question) => void;
  onPickNextStep: (q: Question) => void;
  onDelete: (q: Question) => void;
}) {
  const colors = useColors();
  const status = question.status;
  const statusLabel =
    status === "open"
      ? "Open"
      : status === "answered"
        ? "Answered · waiting on you"
        : status === "completed"
          ? "Completed"
          : status;
  const statusColor =
    status === "completed"
      ? colors.primary
      : status === "answered"
        ? "#0A7F3F"
        : colors.mutedForeground;
  return (
    <View
      style={[
        styles.qaCard,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: status === "completed" ? 0.75 : 1 },
      ]}
    >
      <View style={styles.qaHeaderRow}>
        <View
          style={[
            styles.qaTag,
            { borderColor: colors.border, backgroundColor: colors.background },
          ]}
        >
          <Text style={[styles.qaTagText, { color: colors.mutedForeground }]}>
            Ask a Pro
          </Text>
        </View>
        <Text style={[styles.qaStatus, { color: statusColor }]}>{statusLabel}</Text>
      </View>
      {question.counterpartyName ? (
        <Text style={[styles.qaCounterparty, { color: colors.mutedForeground }]}>
          To {question.counterpartyName}
        </Text>
      ) : null}
      <Text style={[styles.qaText, { color: colors.foreground }]}>
        {question.questionText}
      </Text>
      {question.responseText ? (
        <Text style={[styles.qaResponse, { color: colors.foreground }]}>
          Pro: {question.responseText}
        </Text>
      ) : null}
      {question.nextStep ? (
        <Text style={[styles.qaNextStep, { color: colors.mutedForeground }]}>
          Next step: {nextStepLabel(question.nextStep)}
        </Text>
      ) : null}
      <View style={styles.qaActionsRow}>
        {status === "open" ? (
          <TouchableOpacity
            onPress={() => onAnswer(question)}
            style={[styles.primaryAction, { backgroundColor: colors.foreground }]}
          >
            <Feather name="message-square" size={14} color={colors.background} />
            <Text style={[styles.primaryActionText, { color: colors.background }]}>
              Answer (as pro · +5 pts)
            </Text>
          </TouchableOpacity>
        ) : null}
        {status === "answered" ? (
          <TouchableOpacity
            onPress={() => onConfirm(question)}
            style={[styles.primaryAction, { backgroundColor: colors.primary }]}
          >
            <Feather name="check-circle" size={14} color={colors.primaryForeground} />
            <Text style={[styles.primaryActionText, { color: colors.primaryForeground }]}>
              This answered my question (+20 pts)
            </Text>
          </TouchableOpacity>
        ) : null}
        {status === "completed" && !question.nextStep ? (
          <TouchableOpacity
            onPress={() => onPickNextStep(question)}
            style={[styles.secondaryAction, { borderColor: colors.border }]}
          >
            <Feather name="arrow-right" size={14} color={colors.foreground} />
            <Text style={[styles.secondaryActionText, { color: colors.foreground }]}>
              Pick a next step
            </Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={() => onDelete(question)}
          accessibilityLabel="Delete question"
          style={[styles.iconBtn, { borderColor: colors.border }]}
        >
          <Feather name="trash-2" size={14} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function nextStepLabel(step: string): string {
  if (step === "appointment") return "Set up an appointment";
  if (step === "list") return "Added to a list";
  if (step === "curious") return "Just curious";
  return step;
}

// ---------------------------------------------------------------------------
// Reminder rows (preserved from previous implementation).
// ---------------------------------------------------------------------------
function ReminderRow({
  reminder,
  now,
  onDone,
  onSnooze,
  onDelete,
}: {
  reminder: Reminder;
  now: Date;
  onDone: () => void;
  onSnooze: () => void;
  onDelete: () => void;
}) {
  const colors = useColors();
  const dueIso = reminderDueIso(reminder);
  const overdue = new Date(dueIso).getTime() < now.getTime();
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Pressable
        onPress={onDone}
        accessibilityLabel={`Mark "${reminder.title}" done`}
        hitSlop={8}
        style={[styles.checkbox, { borderColor: overdue ? "#E11D2E" : colors.border }]}
      >
        <Feather name="circle" size={18} color={colors.mutedForeground} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowTitle, { color: colors.foreground }]} numberOfLines={2}>
          {reminder.title}
        </Text>
        {reminder.note ? (
          <Text style={[styles.rowNote, { color: colors.mutedForeground }]} numberOfLines={2}>
            {reminder.note}
          </Text>
        ) : null}
        <View style={styles.rowMeta}>
          <Text
            style={[styles.rowDue, { color: overdue ? "#E11D2E" : colors.mutedForeground }]}
          >
            {describeDue(dueIso, now)}
          </Text>
          {reminder.notifyCount > 1 ? (
            <View
              accessibilityLabel="Reminded again because the first push didn't reach you"
              style={[styles.retryPill, { borderColor: colors.border, backgroundColor: colors.card }]}
            >
              <Feather name="bell" size={10} color={colors.mutedForeground} />
              <Text style={[styles.retryPillText, { color: colors.mutedForeground }]}>
                Reminded again
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.rowActions}>
        <TouchableOpacity
          onPress={onSnooze}
          accessibilityLabel={`Snooze "${reminder.title}"`}
          style={[styles.iconBtn, { borderColor: colors.border }]}
        >
          <Feather name="clock" size={16} color={colors.foreground} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onDelete}
          accessibilityLabel={`Delete "${reminder.title}"`}
          style={[styles.iconBtn, { borderColor: colors.border }]}
        >
          <Feather name="trash-2" size={16} color={colors.foreground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function CompletedRow({
  reminder,
  onUndo,
  onDelete,
}: {
  reminder: Reminder;
  onUndo: () => void;
  onDelete: () => void;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border, opacity: 0.7 },
      ]}
    >
      <Pressable
        onPress={onUndo}
        accessibilityLabel={`Mark "${reminder.title}" not done`}
        hitSlop={8}
        style={[styles.checkbox, { borderColor: colors.border }]}
      >
        <Feather name="check-circle" size={18} color={colors.primary} />
      </Pressable>
      <Text
        style={[
          styles.rowTitle,
          {
            color: colors.foreground,
            flex: 1,
            textDecorationLine: "line-through",
          },
        ]}
        numberOfLines={2}
      >
        {reminder.title}
      </Text>
      <TouchableOpacity
        onPress={onDelete}
        accessibilityLabel={`Delete "${reminder.title}"`}
        style={[styles.iconBtn, { borderColor: colors.border }]}
      >
        <Feather name="trash-2" size={16} color={colors.foreground} />
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Modals & sheets.
// ---------------------------------------------------------------------------
function SnoozeSheet({
  reminder,
  onPick,
  onClose,
}: {
  reminder: Reminder | null;
  onPick: (hours: number) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  return (
    <Modal visible={!!reminder} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}
          onPress={() => {}}
        >
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Snooze</Text>
          {reminder ? (
            <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground }]} numberOfLines={2}>
              {reminder.title}
            </Text>
          ) : null}
          {SNOOZE_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.label}
              onPress={() => onPick(opt.hours)}
              style={[styles.sheetItem, { borderColor: colors.border }]}
            >
              <Feather name="clock" size={16} color={colors.foreground} />
              <Text style={[styles.sheetItemText, { color: colors.foreground }]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={onClose}
            style={[styles.sheetItem, { borderColor: colors.border, justifyContent: "center" }]}
          >
            <Text style={[styles.sheetItemText, { color: colors.mutedForeground }]}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function NextStepSheet({
  question,
  onPick,
  onClose,
}: {
  question: Question | null;
  onPick: (step: "appointment" | "list" | "curious") => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const options: { key: "appointment" | "list" | "curious"; label: string; icon: keyof typeof Feather.glyphMap }[] = [
    { key: "appointment", label: "Set up an appointment", icon: "calendar" },
    { key: "list", label: "Add to a list", icon: "list" },
    { key: "curious", label: "I was just curious", icon: "smile" },
  ];
  return (
    <Modal visible={!!question} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}
          onPress={() => {}}
        >
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>What's next?</Text>
          <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground }]}>
            Pick a follow-up so this question doesn't drop off your radar.
          </Text>
          {options.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              onPress={() => onPick(opt.key)}
              style={[styles.sheetItem, { borderColor: colors.border }]}
            >
              <Feather name={opt.icon} size={16} color={colors.foreground} />
              <Text style={[styles.sheetItemText, { color: colors.foreground }]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={onClose}
            style={[styles.sheetItem, { borderColor: colors.border, justifyContent: "center" }]}
          >
            <Text style={[styles.sheetItemText, { color: colors.mutedForeground }]}>Skip</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function AskAProModal({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (text: string, counterpartyName?: string) => void;
}) {
  const colors = useColors();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  useEffect(() => {
    if (visible) {
      setText("");
      setName("");
    }
  }, [visible]);
  const submit = () => {
    const t = text.trim();
    if (!t) {
      Alert.alert("Add your question", "Type what you want to ask the pro.");
      return;
    }
    onSubmit(t, name.trim() || undefined);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Ask a Pro</Text>
          <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground }]}>
            They earn 5 points for answering and another 20 when you confirm it helped.
          </Text>
          <TextInput
            placeholder="Pro's name (optional)"
            placeholderTextColor={colors.mutedForeground}
            value={name}
            onChangeText={setName}
            style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
          />
          <TextInput
            placeholder="What do you want to know?"
            placeholderTextColor={colors.mutedForeground}
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            style={[
              styles.input,
              styles.inputMulti,
              { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card },
            ]}
          />
          <View style={styles.formActions}>
            <TouchableOpacity onPress={onClose} style={styles.formBtn}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submit}
              style={[styles.formBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }}>Post</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function RequestModal({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (text: string, action: string, counterpartyName?: string) => void;
}) {
  const colors = useColors();
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [action, setAction] = useState("reply");
  useEffect(() => {
    if (visible) {
      setText("");
      setName("");
      setAction("reply");
    }
  }, [visible]);
  const actions = [
    { key: "reply", label: "Reply" },
    { key: "approve", label: "Approve" },
    { key: "upload", label: "Upload" },
    { key: "confirm", label: "Confirm" },
  ];
  const submit = () => {
    const t = text.trim();
    if (!t) {
      Alert.alert("Describe the request", "Tell the client what you need.");
      return;
    }
    onSubmit(t, action, name.trim() || undefined);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>What I Need From You</Text>
          <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground }]}>
            Provider-side request. No points awarded — this is a workflow nudge.
          </Text>
          <TextInput
            placeholder="From (provider name, optional)"
            placeholderTextColor={colors.mutedForeground}
            value={name}
            onChangeText={setName}
            style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
          />
          <TextInput
            placeholder="What do you need from the client?"
            placeholderTextColor={colors.mutedForeground}
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            style={[
              styles.input,
              styles.inputMulti,
              { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card },
            ]}
          />
          <Text style={[styles.formLabel, { color: colors.mutedForeground }]}>Action type</Text>
          <View style={styles.choiceRow}>
            {actions.map((a) => {
              const active = action === a.key;
              return (
                <TouchableOpacity
                  key={a.key}
                  onPress={() => setAction(a.key)}
                  style={[
                    styles.choice,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primary + "1A" : "transparent",
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: active ? colors.primary : colors.foreground,
                      fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
                      fontSize: 13,
                    }}
                  >
                    {a.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={styles.formActions}>
            <TouchableOpacity onPress={onClose} style={styles.formBtn}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submit}
              style={[styles.formBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }}>Send</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AnswerModal({
  question,
  onClose,
  onSubmit,
}: {
  question: Question | null;
  onClose: () => void;
  onSubmit: (answer: string) => void;
}) {
  const colors = useColors();
  const [text, setText] = useState("");
  useEffect(() => {
    if (question) setText(question.responseText ?? "");
  }, [question]);
  const submit = () => {
    const t = text.trim();
    if (!t) {
      Alert.alert("Type your answer", "Add a response so the client knows what to do next.");
      return;
    }
    onSubmit(t);
  };
  return (
    <Modal visible={!!question} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Answer as the pro</Text>
          {question ? (
            <Text style={[styles.sheetSubtitle, { color: colors.mutedForeground }]} numberOfLines={3}>
              Q: {question.questionText}
            </Text>
          ) : null}
          <TextInput
            placeholder="Type your answer"
            placeholderTextColor={colors.mutedForeground}
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            style={[
              styles.input,
              styles.inputMulti,
              { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card },
            ]}
          />
          <Text style={[styles.formHint, { color: colors.mutedForeground }]}>
            +5 points credited to the pro on submit.
          </Text>
          <View style={styles.formActions}>
            <TouchableOpacity onPress={onClose} style={styles.formBtn}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submit}
              style={[styles.formBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }}>Send answer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function NewListModal({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const colors = useColors();
  const [name, setName] = useState("");
  useEffect(() => {
    if (visible) setName("");
  }, [visible]);
  const submit = () => {
    const t = name.trim();
    if (!t) {
      Alert.alert("Name your list", "Give your list a short name.");
      return;
    }
    onSubmit(t);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>New list</Text>
          <TextInput
            placeholder="List name (e.g. Spring projects)"
            placeholderTextColor={colors.mutedForeground}
            value={name}
            onChangeText={setName}
            autoFocus
            style={[styles.input, { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card }]}
          />
          <View style={styles.formActions}>
            <TouchableOpacity onPress={onClose} style={styles.formBtn}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submit}
              style={[styles.formBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }}>Create</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function AddRowButton({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.addRow, { borderColor: colors.border, backgroundColor: colors.background }]}
    >
      <Feather name="plus" size={14} color={colors.primary} />
      <Text style={[styles.addRowText, { color: colors.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// AddReminderModal — preserved from the previous implementation.
// ---------------------------------------------------------------------------
function defaultCustomDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function toDatetimeLocalValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function fromDatetimeLocalValue(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    0,
    0,
  );
  return isNaN(d.getTime()) ? null : d;
}
function formatCustomDate(d: Date): string {
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
function formatCustomTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function AddReminderModal({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (payload: { title: string; note?: string; dueAt: string }) => void;
}) {
  const colors = useColors();
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [dueChoice, setDueChoice] = useState<number | "custom">(24);
  const [customDate, setCustomDate] = useState<Date>(() => defaultCustomDate());
  const [showAndroidDate, setShowAndroidDate] = useState(false);
  const [showAndroidTime, setShowAndroidTime] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setTitle("");
      setNote("");
      setDueChoice(24);
      setCustomDate(defaultCustomDate());
      setShowAndroidDate(false);
      setShowAndroidTime(false);
      setCustomError(null);
    }
  }, [visible]);

  const dueOptions: { label: string; hours: number }[] = [
    { label: "Later today", hours: 4 },
    { label: "Tomorrow", hours: 24 },
    { label: "In 3 days", hours: 24 * 3 },
    { label: "Next week", hours: 24 * 7 },
  ];

  const submit = () => {
    const trimmed = title.trim();
    if (!trimmed) {
      Alert.alert("Add a title", "A reminder needs a short description.");
      return;
    }
    let dueAt: string;
    if (dueChoice === "custom") {
      if (customDate.getTime() <= Date.now()) {
        setCustomError("Pick a date and time in the future.");
        return;
      }
      dueAt = customDate.toISOString();
    } else {
      dueAt = new Date(Date.now() + dueChoice * 60 * 60 * 1000).toISOString();
    }
    onSubmit({ title: trimmed, note: note.trim() || undefined, dueAt });
  };

  const isWeb = Platform.OS === "web";
  const isCustom = dueChoice === "custom";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>New reminder</Text>
          <TextInput
            placeholder="Reminder title"
            placeholderTextColor={colors.mutedForeground}
            value={title}
            onChangeText={setTitle}
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card },
            ]}
            autoFocus
            returnKeyType="next"
          />
          <TextInput
            placeholder="Notes (optional)"
            placeholderTextColor={colors.mutedForeground}
            value={note}
            onChangeText={setNote}
            multiline
            style={[
              styles.input,
              styles.inputMulti,
              { borderColor: colors.border, color: colors.foreground, backgroundColor: colors.card },
            ]}
          />
          <Text style={[styles.formLabel, { color: colors.mutedForeground }]}>Remind me</Text>
          <View style={styles.choiceRow}>
            {dueOptions.map((opt) => {
              const active = dueChoice === opt.hours;
              return (
                <TouchableOpacity
                  key={opt.label}
                  onPress={() => {
                    setDueChoice(opt.hours);
                    setCustomError(null);
                  }}
                  style={[
                    styles.choice,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primary + "1A" : "transparent",
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: active ? colors.primary : colors.foreground,
                      fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
                      fontSize: 13,
                    }}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              onPress={() => setDueChoice("custom")}
              accessibilityLabel="Pick a custom date and time"
              style={[
                styles.choice,
                {
                  borderColor: isCustom ? colors.primary : colors.border,
                  backgroundColor: isCustom ? colors.primary + "1A" : "transparent",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                },
              ]}
            >
              <Feather name="calendar" size={13} color={isCustom ? colors.primary : colors.foreground} />
              <Text
                style={{
                  color: isCustom ? colors.primary : colors.foreground,
                  fontFamily: isCustom ? "Inter_600SemiBold" : "Inter_400Regular",
                  fontSize: 13,
                }}
              >
                Pick date & time
              </Text>
            </TouchableOpacity>
          </View>
          {isCustom ? (
            <View style={{ gap: 8, marginTop: 4 }}>
              {isWeb ? (
                <View
                  style={[
                    styles.customField,
                    { borderColor: colors.border, backgroundColor: colors.card },
                  ]}
                >
                  {React.createElement("input", {
                    type: "datetime-local",
                    value: toDatetimeLocalValue(customDate),
                    min: toDatetimeLocalValue(new Date()),
                    onChange: (e: { target: { value: string } }) => {
                      const d = fromDatetimeLocalValue(e.target.value);
                      if (d) {
                        setCustomDate(d);
                        setCustomError(null);
                      }
                    },
                    "aria-label": "Reminder date and time",
                    style: {
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      color: colors.foreground,
                      fontSize: 15,
                      fontFamily: "Inter_500Medium",
                      width: "100%",
                      padding: 0,
                    },
                  })}
                </View>
              ) : Platform.OS === "ios" ? (
                <View style={{ alignItems: "center" }}>
                  <DateTimePicker
                    value={customDate}
                    mode="datetime"
                    display="inline"
                    minimumDate={new Date()}
                    onChange={(_, d) => {
                      if (d) {
                        setCustomDate(d);
                        setCustomError(null);
                      }
                    }}
                  />
                </View>
              ) : (
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => setShowAndroidDate(true)}
                    accessibilityLabel="Pick reminder date"
                    style={[
                      styles.customField,
                      { flex: 1, borderColor: colors.border, backgroundColor: colors.card },
                    ]}
                  >
                    <Text style={[styles.customFieldText, { color: colors.foreground }]}>
                      {formatCustomDate(customDate)}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setShowAndroidTime(true)}
                    accessibilityLabel="Pick reminder time"
                    style={[
                      styles.customField,
                      { flex: 1, borderColor: colors.border, backgroundColor: colors.card },
                    ]}
                  >
                    <Text style={[styles.customFieldText, { color: colors.foreground }]}>
                      {formatCustomTime(customDate)}
                    </Text>
                  </TouchableOpacity>
                  {showAndroidDate ? (
                    <DateTimePicker
                      value={customDate}
                      mode="date"
                      display="default"
                      minimumDate={new Date()}
                      onChange={(_, d) => {
                        setShowAndroidDate(false);
                        if (d) {
                          const merged = new Date(customDate);
                          merged.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
                          setCustomDate(merged);
                          setCustomError(null);
                        }
                      }}
                    />
                  ) : null}
                  {showAndroidTime ? (
                    <DateTimePicker
                      value={customDate}
                      mode="time"
                      display="default"
                      onChange={(_, d) => {
                        setShowAndroidTime(false);
                        if (d) {
                          const merged = new Date(customDate);
                          merged.setHours(d.getHours(), d.getMinutes(), 0, 0);
                          setCustomDate(merged);
                          setCustomError(null);
                        }
                      }}
                    />
                  ) : null}
                </View>
              )}
              {customError ? (
                <Text style={[styles.customError, { color: "#E11D2E" }]}>{customError}</Text>
              ) : null}
            </View>
          ) : null}
          <View style={styles.formActions}>
            <TouchableOpacity onPress={onClose} style={styles.formBtn}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={submit}
              style={[styles.formBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }}>Add</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 4 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  sectionIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  sectionSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  countPill: {
    paddingHorizontal: 8,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: 1,
  },
  countPillText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  subSection: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.6,
    marginTop: 6,
  },
  placeholder: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
  },
  placeholderText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
  activeClientRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  activeClientAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  activeClientAvatarText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  activeClientTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  activeClientSubtitle: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  activeClientMeta: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  overflowHint: { fontSize: 12, fontFamily: "Inter_500Medium", paddingHorizontal: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowNote: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  rowDue: { fontSize: 12, fontFamily: "Inter_500Medium" },
  rowMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 4 },
  retryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  retryPillText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  rowActions: { flexDirection: "row", gap: 6 },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  sheet: {
    width: "100%",
    maxWidth: 460,
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    gap: 10,
  },
  sheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold" },
  sheetSubtitle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  sheetItemText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  inputMulti: { minHeight: 80, textAlignVertical: "top" },
  customField: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12 },
  customFieldText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  customError: { fontSize: 12, fontFamily: "Inter_500Medium" },
  formLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.4,
    marginTop: 4,
  },
  formHint: { fontSize: 12, fontFamily: "Inter_400Regular" },
  choiceRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  formActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 6,
  },
  formBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addRowText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  listCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  listHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  listTitle: { fontSize: 14, fontFamily: "Inter_700Bold", flex: 1 },
  emptyHint: { fontSize: 12, fontFamily: "Inter_400Regular" },
  listItemRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  listItemText: { flex: 1, fontSize: 14, fontFamily: "Inter_500Medium" },
  inlineAddRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  inlineInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  smallBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  qaCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  qaHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  qaTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  qaTagText: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4 },
  qaStatus: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  qaCounterparty: { fontSize: 12, fontFamily: "Inter_500Medium" },
  qaText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  qaResponse: { fontSize: 13, fontFamily: "Inter_400Regular" },
  qaNextStep: { fontSize: 12, fontFamily: "Inter_500Medium", fontStyle: "italic" },
  qaActionsRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  primaryAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  primaryActionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  secondaryAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  secondaryActionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  noticeCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  noticeHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  noticeTitle: { flex: 1, fontSize: 14, fontFamily: "Inter_700Bold" },
  noticeBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  noticeMeta: { fontSize: 11, fontFamily: "Inter_500Medium" },
  noticeActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  noticeReadByRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  noticeAvatarStack: { flexDirection: "row", alignItems: "center" },
  noticeAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
  },
  noticeAvatarFallback: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  noticeAvatarInitial: { fontSize: 10, fontFamily: "Inter_700Bold" },
  noticeReadByLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  noticeReadByNames: { fontSize: 11, fontFamily: "Inter_400Regular" },
  readReceiptsHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  readReceiptsScroll: {
    maxHeight: 380,
    marginTop: 4,
  },
  readReceiptsSection: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  readReceiptsEmpty: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    paddingVertical: 8,
  },
  readReceiptRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  readReceiptName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  readReceiptMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  nudgeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 64,
    justifyContent: "center",
  },
  nudgeBtnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
});

function RemindersAddBridge({
  onReady,
  open,
}: {
  onReady?: (open: () => void) => void;
  open: () => void;
}) {
  React.useEffect(() => {
    onReady?.(open);
  }, [onReady, open]);
  return null;
}
