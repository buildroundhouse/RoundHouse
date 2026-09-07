import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
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
import * as Haptics from "expo-haptics";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  useGetConciergeHistory,
  useGetConciergeSuggestions,
  useClearConciergeHistory,
  useCreateReminder,
  useCreateWorkLog,
  useListProperties,
  useGetConciergeRecipients,
  usePostConciergeSendDraft,
  type ConciergeRecipient,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/lib/profile";
import {
  streamConciergeReply,
  transcribeConciergeAudio,
  type ConciergeMessageDTO,
  type ProposedAction,
  type StreamEvent,
} from "@/lib/conciergeStream";
import { useConciergeVoiceRecorder } from "@/lib/conciergeVoice";
import {
  performSendDraftAction,
  CHANNEL_LABEL,
  type DraftChannel,
  type DraftClientNotePayload,
  type DraftPick,
} from "@/lib/conciergeSendDraft";

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  proposedActions: ProposedAction[];
  pending?: boolean;
}

function dtoToUi(m: ConciergeMessageDTO): UiMessage {
  return {
    id: `s-${m.id}`,
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content,
    proposedActions: m.proposedActions ?? [],
  };
}

export function ConciergeSheet({ visible, onClose }: Props) {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeOutwardAccountId } = useProfile();

  const historyQuery = useGetConciergeHistory({
    query: { enabled: visible, queryKey: ["/api/concierge/history"] },
  });
  const suggestionsQuery = useGetConciergeSuggestions({
    query: { enabled: visible, queryKey: ["/api/concierge/suggestions"] },
  });
  const clearMutation = useClearConciergeHistory();
  const createReminder = useCreateReminder();
  const createWorkLog = useCreateWorkLog();
  const propertiesQuery = useListProperties({
    query: { enabled: visible, queryKey: ["/api/properties"] },
  });
  const properties = propertiesQuery.data?.properties ?? [];
  const sendDraft = usePostConciergeSendDraft();
  const recipientsQuery = useGetConciergeRecipients({
    query: { enabled: visible, queryKey: ["/api/concierge/recipients"] },
  });

  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When the user taps Confirm on a draft_client_note, we capture the
  // pending draft + a resolver here and surface a recipient picker.
  // Resolving with a pick triggers the actual send; resolving with
  // null cancels (the action card stays in its un-sent state).
  const [pendingDraft, setPendingDraft] = useState<{
    draft: string;
    subject?: string;
    resolve: (pick: DraftPick | null) => void;
  } | null>(null);
  const voice = useConciergeVoiceRecorder();
  const recording = voice.isRecording;
  const scrollRef = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Hydrate UI messages from server history when the sheet opens or
  // when history finishes loading.
  useEffect(() => {
    if (!visible) return;
    if (historyQuery.data?.messages) {
      setMessages(historyQuery.data.messages.map(dtoToUi));
    }
  }, [visible, historyQuery.data]);

  // Auto-scroll to the bottom whenever messages change.
  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages, visible]);

  // Keep the suggestions feed reactive to anything the user actually does
  // on the timeline. We subscribe to the global mutation cache and
  // invalidate /api/concierge/suggestions whenever a mutation that
  // reshapes the timeline (reminders, work logs, work orders) settles.
  // This is intentionally broader than necessary — false-positive
  // refetches are cheap and are debounced naturally by React Query.
  useEffect(() => {
    if (!visible) return undefined;
    const TIMELINE_MUTATIONS = new Set([
      "createReminder",
      "updateReminder",
      "deleteReminder",
      "completeReminder",
      "createWorkLog",
      "createWorkOrder",
      "updateWorkOrder",
      "patchWorkOrder",
      "switchActiveMode",
      "switchActiveOutwardAccount",
    ]);
    const unsub = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== "updated") return;
      if (event.mutation?.state.status !== "success") return;
      const key = event.mutation.options.mutationKey?.[0];
      if (typeof key === "string" && TIMELINE_MUTATIONS.has(key)) {
        queryClient.invalidateQueries({ queryKey: ["/api/concierge/suggestions"] });
      }
    });
    return () => unsub();
  }, [queryClient, visible]);

  // Tear down any in-flight stream / recorder when the sheet closes so we
  // don't leak resources in the background.
  useEffect(() => {
    if (visible) return;
    abortRef.current?.abort();
    abortRef.current = null;
    voice.cancel().catch(() => {});
  }, [visible, voice]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      setError(null);
      setInput("");
      const userId = `u-${Date.now()}`;
      const assistantId = `a-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: userId, role: "user", content: trimmed, proposedActions: [] },
        { id: assistantId, role: "assistant", content: "", proposedActions: [], pending: true },
      ]);
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      const onEvent = (e: StreamEvent) => {
        if (e.type === "content" && typeof e.data === "string") {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: m.content + e.data } : m,
            ),
          );
        } else if (e.type === "proposed_actions" && Array.isArray(e.data)) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, proposedActions: e.data as ProposedAction[] }
                : m,
            ),
          );
        } else if (e.type === "done") {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, pending: false } : m)),
          );
        } else if (e.type === "error") {
          const msg =
            (e.data as { message?: string } | null)?.message ??
            "Concierge ran into a problem.";
          setError(msg);
        }
      };

      try {
        await streamConciergeReply(trimmed, {
          outwardAccountId: activeOutwardAccountId,
          signal: controller.signal,
          onEvent,
        });
      } catch (err) {
        if ((err as { name?: string }).name !== "AbortError") {
          setError(err instanceof Error ? err.message : "Concierge failed");
        }
        setMessages((prev) => prev.filter((m) => m.id !== assistantId || m.content));
      } finally {
        setStreaming(false);
        abortRef.current = null;
        // Refresh server-side suggestions; pep talk may flip after a turn.
        queryClient.invalidateQueries({ queryKey: ["/api/concierge/suggestions"] });
      }
    },
    [activeOutwardAccountId, queryClient, streaming],
  );

  const handleConfirmAction = useCallback(
    async (action: ProposedAction): Promise<boolean> => {
      try {
        if (action.type === "create_reminder") {
          const payload = action.payload as { title?: string; note?: string; dueAt?: string };
          if (!payload.title || !payload.dueAt) {
            throw new Error("Reminder is missing a title or due time.");
          }
          await createReminder.mutateAsync({
            data: {
              title: payload.title,
              dueAt: payload.dueAt,
              note: payload.note ?? null,
            },
          });
          queryClient.invalidateQueries({ queryKey: ["/api/reminders"] });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          return true;
        } else if (action.type === "open_job") {
          const id = (action.payload as { workOrderId?: number }).workOrderId;
          if (id) {
            onClose();
            router.push(`/work-order/${id}` as never);
          }
          return true;
        } else if (action.type === "draft_client_note") {
          // Tapping Confirm on a draft opens a recipient picker. We
          // promisify the picker (via setPendingDraft) so the action
          // card can stay in its pending state until the user either
          // sends or cancels. The orchestration (multi-channel send +
          // composeUri handling) lives in `lib/conciergeSendDraft.ts`
          // so it can be unit-tested.
          const sent = await performSendDraftAction(action, {
            openRecipientPicker: (payload: DraftClientNotePayload) =>
              new Promise<DraftPick | null>((resolve) => {
                setPendingDraft({
                  draft: payload.draft,
                  subject: payload.subject,
                  resolve,
                });
              }).finally(() => setPendingDraft(null)),
            sendDraft: (body) => sendDraft.mutateAsync({ data: body }),
            // For SMS (and email when no server provider is configured)
            // the server returns a compose URI we open in the device's
            // native messages / mail app.
            openComposeUri: (uri) => {
              Linking.openURL(uri).catch(() => {});
            },
            invalidateConciergeHistory: () =>
              queryClient.invalidateQueries({
                queryKey: ["/api/concierge/history"],
              }),
            invalidateMessages: () =>
              queryClient.invalidateQueries({ queryKey: ["/api/messages"] }),
            appendSystemNote: (note) =>
              setMessages((prev) => [
                ...prev,
                {
                  id: `sys-${Date.now()}`,
                  role: "assistant",
                  content: note,
                  proposedActions: [],
                },
              ]),
          });
          if (!sent) return false;
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          return true;
        } else if (action.type === "log_work_item") {
          const payload = action.payload as { propertyId?: number; note?: string };
          const note = (payload.note ?? "").trim();
          if (!payload.propertyId) {
            throw new Error("Pick a property to log this against.");
          }
          if (!note) {
            throw new Error("Add a note before logging.");
          }
          await createWorkLog.mutateAsync({
            propertyId: payload.propertyId,
            data: { note, isRealTime: true, score: 10 },
          });
          queryClient.invalidateQueries({ queryKey: ["/api/logs/feed"] });
          queryClient.invalidateQueries({
            queryKey: [`/api/properties/${payload.propertyId}`],
          });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          return true;
        } else if (action.type === "pep_talk") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          return true;
        }
        return true;
      } catch (err) {
        // Re-throw so the proposal card can render the error inline
        // instead of bubbling it up to the global banner. This keeps
        // the failure attached to the specific action the user tapped.
        throw err instanceof Error ? err : new Error("Couldn't apply that action.");
      }
    },
    [createReminder, createWorkLog, onClose, queryClient, router, sendDraft],
  );

  const startVoice = useCallback(async () => {
    if (recording || streaming) return;
    setError(null);
    try {
      await voice.start();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't access microphone.");
    }
  }, [recording, streaming, voice]);

  const stopVoice = useCallback(async () => {
    try {
      const audio = await voice.stop();
      if (!audio || audio.byteLength === 0) return;
      const text = await transcribeConciergeAudio(audio);
      if (text.trim()) {
        await send(text);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice capture failed.");
    }
  }, [send, voice]);

  const cancelVoice = useCallback(async () => {
    await voice.cancel().catch(() => {});
  }, [voice]);

  const handleClear = useCallback(async () => {
    await clearMutation.mutateAsync();
    setMessages([]);
    queryClient.invalidateQueries({ queryKey: ["/api/concierge/history"] });
  }, [clearMutation, queryClient]);

  const suggestions = suggestionsQuery.data?.suggestions ?? [];
  const pepTalk = suggestionsQuery.data?.pepTalk ?? null;

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityLabel="Dismiss concierge"
          style={StyleSheet.absoluteFill}
          onPress={onClose}
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={[styles.headerIcon, { backgroundColor: colors.primary + "20" }]}>
              <Feather name="message-circle" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: colors.foreground }]}>
                Concierge
              </Text>
              <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
                Drafts, reminders, and momentum — on tap.
              </Text>
            </View>
            <Pressable
              onPress={handleClear}
              accessibilityLabel="Clear conversation"
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 6 })}
            >
              <Feather name="trash-2" size={16} color={colors.mutedForeground} />
            </Pressable>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close"
              hitSlop={10}
              style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 6 })}
            >
              <Feather name="x" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 14, gap: 10 }}
            keyboardShouldPersistTaps="handled"
          >
            {messages.length === 0 ? (
              <View style={{ gap: 10 }}>
                {pepTalk ? (
                  <View style={[styles.pepTalk, { backgroundColor: colors.primary + "12", borderColor: colors.primary + "30" }]}>
                    <Feather name="sun" size={14} color={colors.primary} />
                    <Text style={[styles.pepTalkText, { color: colors.foreground }]}>
                      {pepTalk}
                    </Text>
                  </View>
                ) : null}
                <Text style={[styles.emptyHeading, { color: colors.foreground }]}>
                  How can I help today?
                </Text>
                <View style={{ gap: 6 }}>
                  {suggestions.map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => send(s)}
                      style={({ pressed }) => [
                        styles.suggestion,
                        {
                          borderColor: colors.border,
                          backgroundColor: pressed ? colors.muted : colors.card,
                        },
                      ]}
                    >
                      <Feather name="zap" size={13} color={colors.primary} />
                      <Text style={[styles.suggestionText, { color: colors.foreground }]}>
                        {s}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onConfirm={handleConfirmAction}
                properties={properties}
              />
            ))}
            {error ? (
              <View style={[styles.errorRow, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
                <Feather name="alert-circle" size={14} color="#B91C1C" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={[styles.composer, { borderTopColor: colors.border, backgroundColor: colors.card }]}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={recording ? "Listening…" : "Ask the concierge…"}
              placeholderTextColor={colors.mutedForeground}
              editable={!recording}
              multiline
              style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
              onSubmitEditing={() => send(input)}
              blurOnSubmit
            />
            {Platform.OS !== "web" ? (
              <Pressable
                onLongPress={startVoice}
                onPressOut={recording ? stopVoice : undefined}
                onPress={recording ? cancelVoice : undefined}
                accessibilityLabel={recording ? "Release to send voice" : "Hold to talk"}
                style={({ pressed }) => [
                  styles.iconBtn,
                  {
                    backgroundColor: recording ? "#FEE2E2" : pressed ? colors.muted : colors.background,
                    borderColor: recording ? "#FCA5A5" : colors.border,
                  },
                ]}
              >
                <Feather
                  name={recording ? "mic-off" : "mic"}
                  size={18}
                  color={recording ? "#B91C1C" : colors.foreground}
                />
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => send(input)}
              disabled={!input.trim() || streaming}
              accessibilityLabel="Send"
              style={({ pressed }) => [
                styles.sendBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: !input.trim() || streaming ? 0.45 : pressed ? 0.85 : 1,
                },
              ]}
            >
              {streaming ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Feather name="send" size={16} color="#fff" />
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
      <RecipientPicker
        visible={pendingDraft != null}
        draft={pendingDraft?.draft ?? ""}
        recipients={recipientsQuery.data?.recipients ?? []}
        loading={recipientsQuery.isLoading}
        sending={sendDraft.isPending}
        onCancel={() => pendingDraft?.resolve(null)}
        onPick={(p) => pendingDraft?.resolve(p)}
      />
    </Modal>
  );
}

interface PropertyOption {
  id: number;
  name: string;
}

function RecipientPicker({
  visible,
  draft,
  recipients,
  loading,
  sending,
  onCancel,
  onPick,
}: {
  visible: boolean;
  draft: string;
  recipients: ConciergeRecipient[];
  loading: boolean;
  sending: boolean;
  onCancel: () => void;
  onPick: (pick: DraftPick) => void;
}) {
  const colors = useColors();
  const [channel, setChannel] = useState<DraftChannel>("in_app");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [contactInput, setContactInput] = useState("");
  // Task #587: when the user picks "Add new contact" we collect a free-form
  // name + phone/email instead of selecting an outward-account counterpart.
  // In this mode the in-app channel is unavailable (it requires a real
  // recipient account) so we force-switch to SMS.
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [newName, setNewName] = useState("");

  // Reset internal state every time the picker is reopened so a stale
  // selection from a previous draft doesn't bleed through.
  useEffect(() => {
    if (!visible) return;
    setChannel("in_app");
    setSelectedId(null);
    setContactInput("");
    setMode("existing");
    setNewName("");
  }, [visible]);

  // Brand-new contacts can't receive in-app messages — they have no
  // account yet — so flip to SMS the moment the user enters new mode.
  useEffect(() => {
    if (mode === "new" && channel === "in_app") {
      setChannel("sms");
      setContactInput("");
    }
  }, [mode, channel]);

  const selected = useMemo(
    () => recipients.find((r) => r.outwardAccountId === selectedId) ?? null,
    [recipients, selectedId],
  );

  // Refill the contact input whenever the channel or selection changes
  // so the user sees what we'll send to. They can still edit it.
  // Skipped in "new contact" mode — that input is owned by the user.
  useEffect(() => {
    if (mode === "new") return;
    if (!selected) {
      setContactInput("");
      return;
    }
    if (channel === "sms") setContactInput(selected.phone ?? "");
    else if (channel === "email") setContactInput(selected.email ?? "");
    else setContactInput("");
  }, [channel, selected, mode]);

  if (!visible) return null;

  const channels: { key: DraftChannel; label: string; icon: keyof typeof Feather.glyphMap }[] = [
    { key: "in_app", label: "In-app", icon: "message-square" },
    { key: "sms", label: "SMS", icon: "smartphone" },
    { key: "email", label: "Email", icon: "mail" },
  ];

  const needsContactInput = channel === "sms" || channel === "email";
  const contactPlaceholder =
    channel === "sms" ? "Phone number" : channel === "email" ? "Email address" : "";
  const contactKeyboard: "phone-pad" | "email-address" | "default" =
    channel === "sms" ? "phone-pad" : channel === "email" ? "email-address" : "default";
  const validContact =
    channel === "in_app" ||
    (channel === "sms" && contactInput.replace(/[^\d]/g, "").length >= 7) ||
    (channel === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactInput.trim()));

  const trimmedNewName = newName.trim();
  const newContactReady =
    mode === "new" &&
    trimmedNewName.length > 0 &&
    channel !== "in_app" &&
    validContact;
  const existingReady = mode === "existing" && !!selected && validContact;
  const canSend = (existingReady || newContactReady) && !sending;

  const handleSend = () => {
    if (!canSend) return;
    if (mode === "new") {
      // Synthesize a ConciergeRecipient so the rest of the orchestration
      // (system note copy, etc.) treats this like any other pick. The
      // synthetic outwardAccountId of 0 is never sent to the server —
      // buildSendDraftRequest swaps in `recipientName` when isNewContact
      // is set.
      const syntheticRecipient: ConciergeRecipient = {
        outwardAccountId: 0,
        name: trimmedNewName,
        kind: null,
        avatarUrl: null,
        companyName: null,
        email: channel === "email" ? contactInput.trim() : null,
        phone: channel === "sms" ? contactInput.trim() : null,
      };
      onPick({
        recipient: syntheticRecipient,
        channel,
        isNewContact: true,
        ...(channel === "sms" ? { phoneOverride: contactInput.trim() } : {}),
        ...(channel === "email" ? { emailOverride: contactInput.trim() } : {}),
      });
      return;
    }
    if (!selected) return;
    onPick({
      recipient: selected,
      channel,
      ...(channel === "sms" ? { phoneOverride: contactInput.trim() } : {}),
      ...(channel === "email" ? { emailOverride: contactInput.trim() } : {}),
    });
  };

  return (
    <View style={styles.pickerBackdrop} pointerEvents="auto">
      <Pressable
        accessibilityLabel="Dismiss recipient picker"
        style={StyleSheet.absoluteFill}
        onPress={sending ? undefined : onCancel}
      />
      <View
        style={[
          styles.pickerCard,
          { backgroundColor: colors.background, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.pickerTitle, { color: colors.foreground }]}>
          Send draft to…
        </Text>
        <Text
          style={[styles.pickerPreview, { color: colors.mutedForeground }]}
          numberOfLines={3}
        >
          {draft}
        </Text>

        <View style={styles.channelRow}>
          {channels.map((c) => {
            const active = c.key === channel;
            // The in-app channel needs a real recipient account, so it's
            // not a valid choice when sending to a brand-new contact.
            const disabledForMode = mode === "new" && c.key === "in_app";
            return (
              <Pressable
                key={c.key}
                onPress={() => {
                  if (disabledForMode) return;
                  setChannel(c.key);
                }}
                disabled={sending || disabledForMode}
                accessibilityLabel={`Send via ${c.label}`}
                style={({ pressed }) => [
                  styles.channelChip,
                  {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active
                      ? colors.primary + "22"
                      : pressed
                        ? colors.muted
                        : colors.background,
                    opacity: disabledForMode ? 0.4 : 1,
                  },
                ]}
              >
                <Feather
                  name={c.icon}
                  size={12}
                  color={active ? colors.primary : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.channelChipText,
                    { color: active ? colors.primary : colors.foreground },
                  ]}
                >
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <ScrollView style={{ maxHeight: 240 }} keyboardShouldPersistTaps="handled">
          {/* Brand-new contact entry. Sits at the top of the list so it's
              discoverable even when the user has plenty of saved
              recipients, and is the only option when the list is empty. */}
          <Pressable
            disabled={sending}
            onPress={() => {
              setMode("new");
              setSelectedId(null);
              setContactInput("");
            }}
            accessibilityLabel="Add a new contact"
            style={({ pressed }) => [
              styles.pickerRow,
              {
                borderColor: mode === "new" ? colors.primary : colors.border,
                backgroundColor:
                  mode === "new"
                    ? colors.primary + "12"
                    : pressed
                      ? colors.muted
                      : colors.card,
                borderStyle: "dashed",
                opacity: sending ? 0.6 : 1,
              },
            ]}
          >
            <View
              style={[
                styles.pickerAvatar,
                { backgroundColor: colors.primary + "22" },
              ]}
            >
              <Feather name="user-plus" size={14} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.pickerName, { color: colors.foreground }]}>
                Add new contact
              </Text>
              <Text
                style={[styles.pickerSub, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                Send by SMS or email — no team-up needed
              </Text>
            </View>
            {mode === "new" ? (
              <Feather name="check-circle" size={16} color={colors.primary} />
            ) : null}
          </Pressable>
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
          ) : recipients.length === 0 ? (
            mode === "new" ? null : (
              <Text style={[styles.pickerEmpty, { color: colors.mutedForeground }]}>
                {channel === "in_app"
                  ? "No accepted team-up connections yet — pick \"Add new contact\" above to reach someone via SMS or email."
                  : "No saved contacts yet — pick \"Add new contact\" above to reach someone."}
              </Text>
            )
          ) : (
            recipients.map((r) => {
              const isSelected = selectedId === r.outwardAccountId;
              const channelMissing =
                (channel === "sms" && !r.phone) ||
                (channel === "email" && !r.email);
              return (
                <Pressable
                  key={r.outwardAccountId}
                  disabled={sending}
                  onPress={() => {
                    setMode("existing");
                    setNewName("");
                    setSelectedId(r.outwardAccountId);
                  }}
                  accessibilityLabel={`Pick ${r.name}`}
                  style={({ pressed }) => [
                    styles.pickerRow,
                    {
                      borderColor: isSelected ? colors.primary : colors.border,
                      backgroundColor: isSelected
                        ? colors.primary + "12"
                        : pressed
                          ? colors.muted
                          : colors.card,
                      opacity: sending ? 0.6 : 1,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.pickerAvatar,
                      { backgroundColor: colors.primary + "22" },
                    ]}
                  >
                    <Feather name="user" size={14} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.pickerName, { color: colors.foreground }]}>
                      {r.name}
                    </Text>
                    {channel !== "in_app" && !channelMissing ? (
                      <Text
                        style={[styles.pickerSub, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {channel === "sms" ? r.phone : r.email}
                      </Text>
                    ) : channelMissing && isSelected ? (
                      <Text
                        style={[styles.pickerSub, { color: colors.primary }]}
                        numberOfLines={1}
                      >
                        Add a {channel === "sms" ? "phone" : "email"} below
                      </Text>
                    ) : r.companyName && r.companyName !== r.name ? (
                      <Text
                        style={[styles.pickerSub, { color: colors.mutedForeground }]}
                        numberOfLines={1}
                      >
                        {r.companyName}
                      </Text>
                    ) : null}
                  </View>
                  {isSelected ? (
                    <Feather name="check-circle" size={16} color={colors.primary} />
                  ) : null}
                </Pressable>
              );
            })
          )}
        </ScrollView>

        {mode === "new" ? (
          <View style={{ marginTop: 6 }}>
            <Text style={[styles.pickerChannel, { color: colors.mutedForeground }]}>
              Contact name
            </Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="e.g. Jamie Smith"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="words"
              autoCorrect={false}
              editable={!sending}
              style={[
                styles.pickerInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            />
          </View>
        ) : null}

        {needsContactInput && (selected || mode === "new") ? (
          <View style={{ marginTop: 6 }}>
            <Text style={[styles.pickerChannel, { color: colors.mutedForeground }]}>
              {channel === "sms" ? "Phone" : "Email"}
            </Text>
            <TextInput
              value={contactInput}
              onChangeText={setContactInput}
              placeholder={contactPlaceholder}
              placeholderTextColor={colors.mutedForeground}
              keyboardType={contactKeyboard}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!sending}
              style={[
                styles.pickerInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            />
          </View>
        ) : null}

        <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
          <Pressable
            onPress={onCancel}
            disabled={sending}
            style={({ pressed }) => [
              styles.pickerCancel,
              {
                flex: 1,
                marginTop: 0,
                borderColor: colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 13 }}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            onPress={handleSend}
            disabled={!canSend}
            accessibilityLabel="Send draft"
            style={({ pressed }) => [
              styles.pickerSend,
              {
                backgroundColor: colors.primary,
                opacity: !canSend ? 0.45 : pressed ? 0.85 : 1,
              },
            ]}
          >
            {sending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 13 }}>
                Send via {CHANNEL_LABEL[channel]}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function MessageBubble({
  message,
  onConfirm,
  properties,
}: {
  message: UiMessage;
  onConfirm: (a: ProposedAction) => Promise<boolean>;
  properties: PropertyOption[];
}) {
  const colors = useColors();
  const isUser = message.role === "user";
  return (
    <View style={{ gap: 8 }}>
      <View
        style={[
          styles.bubble,
          isUser
            ? {
                alignSelf: "flex-end",
                backgroundColor: colors.primary,
                borderColor: colors.primary,
              }
            : {
                alignSelf: "flex-start",
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
        ]}
      >
        {message.content ? (
          <Text style={[styles.bubbleText, { color: isUser ? "#fff" : colors.foreground }]}>
            {message.content}
          </Text>
        ) : message.pending ? (
          <ActivityIndicator size="small" color={colors.mutedForeground} />
        ) : null}
      </View>
      {!isUser && message.proposedActions.length > 0 ? (
        <View style={{ gap: 6, alignSelf: "flex-start", maxWidth: "92%" }}>
          {message.proposedActions.map((a, i) => (
            <ProposedActionCard
              key={`${message.id}-a-${i}`}
              action={a}
              onConfirm={onConfirm}
              properties={properties}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Returns the name of the payload field that the user is allowed to edit
 * inline for a given action type (or null when the action has nothing
 * worth editing — e.g. a pep talk or an "open job" deep link).
 */
function editableField(action: ProposedAction): string | null {
  switch (action.type) {
    case "draft_client_note":
      return "draft";
    case "create_reminder":
      return "title";
    case "log_work_item":
      return "note";
    default:
      return null;
  }
}

function ProposedActionCard({
  action,
  onConfirm,
  properties,
}: {
  action: ProposedAction;
  onConfirm: (a: ProposedAction) => Promise<boolean>;
  properties: PropertyOption[];
}) {
  const colors = useColors();
  const [dismissed, setDismissed] = useState(false);
  const [done, setDone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  // Local working copy of the payload so the user can tweak the assistant's
  // proposal before tapping Confirm. Keyed by the editable field above.
  // For `log_work_item` we also seed `propertyId` from the most recent
  // property when the assistant didn't already propose one — that keeps
  // the picker pre-populated and Confirm one-tap.
  const [draftPayload, setDraftPayload] = useState<Record<string, unknown>>(() => {
    const seed: Record<string, unknown> = { ...action.payload };
    if (action.type === "log_work_item" && seed.propertyId == null && properties[0]) {
      seed.propertyId = properties[0].id;
    }
    return seed;
  });
  // If the property list arrives after the card mounts, fill in the
  // default once it becomes available.
  useEffect(() => {
    if (action.type !== "log_work_item") return;
    if (draftPayload.propertyId != null) return;
    if (!properties[0]) return;
    setDraftPayload((prev) => ({ ...prev, propertyId: properties[0].id }));
  }, [action.type, draftPayload.propertyId, properties]);
  const editField = editableField(action);
  if (dismissed) return null;
  const effectiveAction: ProposedAction = { ...action, payload: draftPayload };
  const showPropertyPicker = action.type === "log_work_item";
  const selectedPropertyId = draftPayload.propertyId as number | undefined;
  return (
    <View
      style={[
        styles.actionCard,
        { borderColor: colors.primary + "55", backgroundColor: colors.primary + "0F" },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Feather name="check-square" size={14} color={colors.primary} />
        <Text style={[styles.actionLabel, { color: colors.foreground }]}>
          {action.label}
        </Text>
      </View>
      {editing && editField ? (
        <TextInput
          value={String(draftPayload[editField] ?? "")}
          onChangeText={(t) =>
            setDraftPayload((prev) => ({ ...prev, [editField]: t }))
          }
          multiline
          autoFocus
          style={[
            styles.actionEdit,
            { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background },
          ]}
        />
      ) : previewText(effectiveAction) ? (
        <Text style={[styles.actionDetail, { color: colors.mutedForeground }]} numberOfLines={4}>
          {previewText(effectiveAction)}
        </Text>
      ) : null}
      {showPropertyPicker && !done ? (
        properties.length === 0 ? (
          <Text style={[styles.actionDetail, { color: colors.mutedForeground }]}>
            Add a property first to log work here.
          </Text>
        ) : (
          <View style={styles.propertyPicker}>
            <Text style={[styles.actionDetail, { color: colors.mutedForeground, marginBottom: 4 }]}>
              Log to:
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 6 }}
            >
              {properties.slice(0, 8).map((p) => {
                const selected = p.id === selectedPropertyId;
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => {
                      setCardError(null);
                      setDraftPayload((prev) => ({ ...prev, propertyId: p.id }));
                    }}
                    style={({ pressed }) => [
                      styles.propertyChip,
                      {
                        borderColor: selected ? colors.primary : colors.border,
                        backgroundColor: selected
                          ? colors.primary + "22"
                          : pressed
                            ? colors.muted
                            : colors.background,
                      },
                    ]}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.propertyChipText,
                        { color: selected ? colors.primary : colors.foreground },
                      ]}
                    >
                      {p.name || `Property #${p.id}`}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )
      ) : null}
      {cardError ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
          <Feather name="alert-circle" size={12} color="#B91C1C" />
          <Text style={[styles.actionDetail, { color: "#B91C1C", flex: 1 }]}>
            {cardError}
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 4 }}>
        <Pressable
          disabled={done || submitting}
          onPress={async () => {
            setEditing(false);
            setCardError(null);
            setSubmitting(true);
            try {
              const ok = await onConfirm(effectiveAction);
              if (ok) setDone(true);
            } catch (err) {
              setCardError(err instanceof Error ? err.message : "Couldn't apply that action.");
            } finally {
              setSubmitting(false);
            }
          }}
          style={({ pressed }) => [
            styles.actionBtn,
            {
              backgroundColor: done ? colors.muted : colors.primary,
              opacity: submitting ? 0.6 : pressed ? 0.85 : 1,
            },
          ]}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={[styles.actionBtnText, { color: done ? colors.mutedForeground : "#fff" }]}>
              {done ? "Done" : "Confirm"}
            </Text>
          )}
        </Pressable>
        {editField && !done ? (
          <Pressable
            onPress={() => setEditing((v) => !v)}
            style={({ pressed }) => [
              styles.actionBtn,
              {
                backgroundColor: editing ? colors.muted : colors.background,
                borderWidth: 1,
                borderColor: colors.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[styles.actionBtnText, { color: colors.foreground }]}>
              {editing ? "Done editing" : "Edit"}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setDismissed(true)}
          style={({ pressed }) => [
            styles.actionBtn,
            { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={[styles.actionBtnText, { color: colors.mutedForeground }]}>
            Dismiss
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function previewText(a: ProposedAction): string | null {
  const p = a.payload as Record<string, unknown>;
  if (a.type === "draft_client_note" && typeof p.draft === "string") return p.draft;
  if (a.type === "create_reminder") {
    const due = typeof p.dueAt === "string" ? p.dueAt : "";
    const title = typeof p.title === "string" ? p.title : "";
    const note = typeof p.note === "string" ? p.note : "";
    return [title, due ? `Due ${due}` : null, note].filter(Boolean).join(" — ");
  }
  if (a.type === "log_work_item" && typeof p.note === "string") return p.note;
  if (a.type === "pep_talk" && typeof p.message === "string") return p.message;
  return null;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    height: "85%",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 12, marginTop: 1 },
  emptyHeading: { fontSize: 14, fontFamily: "Inter_700Bold", marginTop: 4 },
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  suggestionText: { fontSize: 13, flex: 1 },
  pepTalk: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
  },
  pepTalkText: { fontSize: 13, flex: 1, lineHeight: 18 },
  bubble: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    maxWidth: "88%",
  },
  bubbleText: { fontSize: 14, lineHeight: 19 },
  actionCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 4,
    minWidth: 220,
  },
  actionLabel: { fontSize: 13, fontFamily: "Inter_700Bold", flex: 1 },
  actionDetail: { fontSize: 12, lineHeight: 16 },
  actionEdit: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 56,
    fontSize: 13,
    lineHeight: 18,
  },
  actionBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  actionBtnText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  propertyPicker: { marginTop: 4 },
  propertyChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
    maxWidth: 160,
  },
  propertyChipText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    padding: 8,
  },
  errorText: { color: "#B91C1C", fontSize: 12, flex: 1 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 18,
  },
  pickerCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 8,
  },
  pickerTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  pickerPreview: { fontSize: 12, lineHeight: 16 },
  pickerChannel: { fontSize: 11, marginBottom: 4 },
  pickerEmpty: { fontSize: 13, padding: 10, lineHeight: 18 },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
  },
  pickerAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerName: { fontSize: 13, fontFamily: "Inter_700Bold" },
  pickerSub: { fontSize: 11, marginTop: 1 },
  pickerCancel: {
    alignSelf: "stretch",
    alignItems: "center",
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  pickerSend: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
  },
  pickerInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    marginTop: 4,
  },
  channelRow: {
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
    marginBottom: 4,
  },
  channelChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  channelChipText: { fontSize: 12, fontFamily: "Inter_700Bold" },
});

export default ConciergeSheet;
