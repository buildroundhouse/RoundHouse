import React from "react";
import {
  ActivityIndicator,
  Alert,
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
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import {
  useListStandardEvidence,
  useDeleteStandardEvidence,
  useUpdateStandardEvidence,
  type StandardEvidence,
} from "@workspace/api-client-react";
import { resolveStorageUrl } from "@/lib/uploads";

function formatDateTime(d: string): string {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function StandardEvidenceHistoryModal({
  visible,
  propertyId,
  standardId,
  standardTitle,
  nameByClerkId,
  currentUserClerkId,
  canManageAll,
  onClose,
  onPhotoPress,
}: {
  visible: boolean;
  propertyId: number;
  standardId: number | null;
  standardTitle: string;
  nameByClerkId: Record<string, string>;
  currentUserClerkId: string | null;
  canManageAll: boolean;
  onClose: () => void;
  onPhotoPress?: (
    photos: {
      url: string;
      addedAt?: string;
      evidenceId?: number;
      storagePath?: string;
      canDelete?: boolean;
    }[],
    index: number,
  ) => void;
}) {
  const colors = useColors();
  const enabled = visible && standardId != null;
  const evidenceKey = [`/api/properties/${propertyId}/standards/${standardId ?? 0}/evidence`];
  const query = useListStandardEvidence(propertyId, standardId ?? 0, {
    query: {
      enabled,
      queryKey: evidenceKey,
    },
  });
  const queryClient = useQueryClient();
  const deleteMutation = useDeleteStandardEvidence();
  const updateMutation = useUpdateStandardEvidence();
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [editingDraft, setEditingDraft] = React.useState<string>("");
  const [savingId, setSavingId] = React.useState<number | null>(null);
  const [pendingUndo, setPendingUndo] = React.useState<StandardEvidence | null>(null);
  const [undoSecondsLeft, setUndoSecondsLeft] = React.useState<number>(0);
  const undoTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTickRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingUndoRef = React.useRef<StandardEvidence | null>(null);

  const UNDO_WINDOW_MS = 5000;

  const clearUndoTimers = React.useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    if (undoTickRef.current) {
      clearInterval(undoTickRef.current);
      undoTickRef.current = null;
    }
  }, []);

  const performDelete = React.useCallback(
    (ev: StandardEvidence) => {
      if (standardId == null) return;
      deleteMutation.mutate(
        { propertyId, standardId, eventId: ev.id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: evidenceKey });
            queryClient.invalidateQueries({
              queryKey: [`/api/properties/${propertyId}/standards/status`],
            });
            queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
          },
          onError: (err: unknown) => {
            // Roll back the optimistic removal on failure so the row returns.
            queryClient.setQueryData<{ events: StandardEvidence[] } | undefined>(
              evidenceKey,
              (prev) => {
                if (!prev) return prev;
                if (prev.events.some((e) => e.id === ev.id)) return prev;
                const next = [...prev.events, ev].sort(
                  (a, b) => new Date(b.metAt).getTime() - new Date(a.metAt).getTime(),
                );
                return { ...prev, events: next };
              },
            );
            const message =
              err && typeof err === "object" && "message" in err
                ? String((err as { message?: string }).message)
                : "Could not delete that event.";
            Alert.alert("Delete failed", message);
          },
        },
      );
    },
    [deleteMutation, queryClient, propertyId, standardId, evidenceKey],
  );

  const performDeleteRef = React.useRef(performDelete);
  React.useEffect(() => {
    performDeleteRef.current = performDelete;
  }, [performDelete]);

  const flushPendingDelete = React.useCallback(() => {
    const pending = pendingUndoRef.current;
    if (!pending) return;
    clearUndoTimers();
    pendingUndoRef.current = null;
    setPendingUndo(null);
    setUndoSecondsLeft(0);
    performDelete(pending);
  }, [clearUndoTimers, performDelete]);

  const undoDelete = React.useCallback(() => {
    const pending = pendingUndoRef.current;
    if (!pending) return;
    clearUndoTimers();
    pendingUndoRef.current = null;
    setPendingUndo(null);
    setUndoSecondsLeft(0);
    queryClient.setQueryData<{ events: StandardEvidence[] } | undefined>(
      evidenceKey,
      (prev) => {
        if (!prev) return { events: [pending] };
        if (prev.events.some((e) => e.id === pending.id)) return prev;
        const next = [...prev.events, pending].sort(
          (a, b) => new Date(b.metAt).getTime() - new Date(a.metAt).getTime(),
        );
        return { ...prev, events: next };
      },
    );
    queryClient.invalidateQueries({
      queryKey: [`/api/properties/${propertyId}/standards/status`],
    });
    queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
  }, [clearUndoTimers, queryClient, evidenceKey, propertyId]);

  const startEditNote = (ev: StandardEvidence) => {
    setEditingId(ev.id);
    setEditingDraft(ev.note ?? "");
  };

  const cancelEditNote = () => {
    setEditingId(null);
    setEditingDraft("");
  };

  React.useEffect(() => {
    if (!visible) {
      setEditingId(null);
      setEditingDraft("");
      setSavingId(null);
    }
  }, [visible]);

  const saveEditNote = (ev: StandardEvidence) => {
    if (standardId == null) return;
    const trimmed = editingDraft.trim();
    const original = ev.note ?? "";
    if (trimmed === original) {
      cancelEditNote();
      return;
    }
    setSavingId(ev.id);
    updateMutation.mutate(
      {
        propertyId,
        standardId,
        eventId: ev.id,
        data: { note: trimmed.length ? trimmed : null },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: evidenceKey });
          cancelEditNote();
        },
        onError: (err: unknown) => {
          const message =
            err && typeof err === "object" && "message" in err
              ? String((err as { message?: string }).message)
              : "Could not update that note.";
          Alert.alert("Update failed", message);
        },
        onSettled: () => setSavingId(null),
      },
    );
  };

  const events: StandardEvidence[] = query.data?.events ?? [];

  const beginUndoableDelete = (ev: StandardEvidence) => {
    if (standardId == null) return;
    // If a previous undoable delete is still pending, flush it first so we
    // don't lose it. This also ensures only one undo banner is on screen.
    if (pendingUndoRef.current && pendingUndoRef.current.id !== ev.id) {
      flushPendingDelete();
    }
    // Optimistically remove the row from the cached list right away.
    queryClient.setQueryData<{ events: StandardEvidence[] } | undefined>(
      evidenceKey,
      (prev) => {
        if (!prev) return prev;
        return { ...prev, events: prev.events.filter((e) => e.id !== ev.id) };
      },
    );
    pendingUndoRef.current = ev;
    setPendingUndo(ev);
    setUndoSecondsLeft(Math.ceil(UNDO_WINDOW_MS / 1000));
    clearUndoTimers();
    undoTimerRef.current = setTimeout(() => {
      flushPendingDelete();
    }, UNDO_WINDOW_MS);
    undoTickRef.current = setInterval(() => {
      setUndoSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
  };

  const requestDelete = (eventId: number) => {
    if (standardId == null) return;
    const ev = events.find((e) => e.id === eventId);
    if (!ev) return;
    beginUndoableDelete(ev);
  };

  // Flush any pending delete when the modal closes or the active standard
  // changes, so the row doesn't reappear after the undo window has passed.
  React.useEffect(() => {
    if (!visible) flushPendingDelete();
  }, [visible, flushPendingDelete]);

  React.useEffect(() => {
    flushPendingDelete();
  }, [standardId, propertyId, flushPendingDelete]);

  React.useEffect(() => {
    return () => {
      // On unmount, finalize any in-flight delete and stop timers. Use the
      // ref-backed latest performDelete so we always target the current
      // standard/property even if props changed since the delete started.
      if (pendingUndoRef.current) {
        const pending = pendingUndoRef.current;
        pendingUndoRef.current = null;
        if (undoTimerRef.current) {
          clearTimeout(undoTimerRef.current);
          undoTimerRef.current = null;
        }
        if (undoTickRef.current) {
          clearInterval(undoTickRef.current);
          undoTickRef.current = null;
        }
        performDeleteRef.current(pending);
      }
    };
  }, []);

  const photoEvents = events
    .map((e, i) => ({ event: e, originalIndex: i, url: resolveStorageUrl(e.photoPath ?? "") }))
    .filter((p) => !!p.event.photoPath && !!p.url) as {
    event: StandardEvidence;
    originalIndex: number;
    url: string;
  }[];

  const photoIndexByEventIndex: Record<number, number> = {};
  photoEvents.forEach((p, i) => {
    photoIndexByEventIndex[p.originalIndex] = i;
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
                Evidence history
              </Text>
              <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={1}>
                {standardTitle}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Feather name="x" size={20} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {pendingUndo ? (
            <View
              style={[
                styles.undoBar,
                {
                  backgroundColor: colors.foreground,
                  borderColor: colors.border,
                },
              ]}
              accessibilityLiveRegion="polite"
            >
              <Feather name="trash-2" size={16} color={colors.background} />
              <Text style={[styles.undoText, { color: colors.background }]} numberOfLines={1}>
                Evidence deleted{undoSecondsLeft > 0 ? ` · ${undoSecondsLeft}s` : ""}
              </Text>
              <TouchableOpacity
                onPress={undoDelete}
                hitSlop={8}
                style={styles.undoBtn}
                accessibilityLabel="Undo delete"
              >
                <Text style={[styles.undoBtnText, { color: colors.primary }]}>Undo</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {query.isLoading ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 32 }} />
          ) : query.isError ? (
            <Text style={[styles.empty, { color: colors.destructive }]}>
              Could not load evidence. Pull to refresh and try again.
            </Text>
          ) : events.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Feather name="image" size={28} color={colors.mutedForeground} />
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>
                No evidence recorded yet. Mark the standard met to start a history.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingBottom: 8 }}
              showsVerticalScrollIndicator={false}
            >
              {events.map((ev, idx) => {
                const url = resolveStorageUrl(ev.photoPath ?? "");
                const who = nameByClerkId[ev.createdBy] ?? "A team member";
                const isAuthor = !!currentUserClerkId && ev.createdBy === currentUserClerkId;
                const canDelete = canManageAll || isAuthor;
                const canEditNote = isAuthor;
                const isEditing = editingId === ev.id;
                const isSaving = savingId === ev.id;
                return (
                  <View
                    key={ev.id}
                    style={[
                      styles.row,
                      { borderColor: colors.border },
                      idx === events.length - 1 && { borderBottomWidth: 0 },
                    ]}
                  >
                    {url ? (
                      <TouchableOpacity
                        onPress={() => {
                          if (onPhotoPress) {
                            const i = photoIndexByEventIndex[idx];
                            if (i != null) {
                              onPhotoPress(
                                photoEvents.map((p) => {
                                  const isAuthor =
                                    !!currentUserClerkId &&
                                    p.event.createdBy === currentUserClerkId;
                                  return {
                                    url: p.url,
                                    addedAt: p.event.metAt,
                                    evidenceId: p.event.id,
                                    storagePath: p.event.photoPath ?? undefined,
                                    canDelete: canManageAll || isAuthor,
                                  };
                                }),
                                i,
                              );
                            }
                          }
                        }}
                        style={[styles.thumb, { borderColor: colors.border }]}
                      >
                        <Image source={{ uri: url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                      </TouchableOpacity>
                    ) : (
                      <View
                        style={[
                          styles.thumb,
                          {
                            borderColor: colors.border,
                            backgroundColor: colors.background,
                            alignItems: "center",
                            justifyContent: "center",
                          },
                        ]}
                      >
                        <Feather name="check" size={20} color={colors.mutedForeground} />
                      </View>
                    )}
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.who, { color: colors.foreground }]} numberOfLines={1}>
                        {who}
                      </Text>
                      <Text style={[styles.when, { color: colors.mutedForeground }]}>
                        {formatDateTime(ev.metAt)}
                      </Text>
                      {isEditing ? (
                        <View style={styles.editWrap}>
                          <TextInput
                            value={editingDraft}
                            onChangeText={setEditingDraft}
                            placeholder="Add a note (optional)"
                            placeholderTextColor={colors.mutedForeground}
                            multiline
                            editable={!isSaving}
                            style={[
                              styles.editInput,
                              {
                                color: colors.foreground,
                                borderColor: colors.border,
                                backgroundColor: colors.background,
                              },
                            ]}
                            accessibilityLabel="Edit evidence note"
                          />
                          <View style={styles.editActions}>
                            <TouchableOpacity
                              onPress={cancelEditNote}
                              disabled={isSaving}
                              hitSlop={6}
                              style={styles.editBtn}
                            >
                              <Text style={[styles.editBtnText, { color: colors.mutedForeground }]}>
                                Cancel
                              </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              onPress={() => saveEditNote(ev)}
                              disabled={isSaving}
                              hitSlop={6}
                              style={styles.editBtn}
                            >
                              {isSaving ? (
                                <ActivityIndicator size="small" color={colors.primary} />
                              ) : (
                                <Text style={[styles.editBtnText, { color: colors.primary }]}>
                                  Save
                                </Text>
                              )}
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <>
                          {ev.note ? (
                            <Text style={[styles.note, { color: colors.foreground }]}>{ev.note}</Text>
                          ) : null}
                          {canEditNote ? (
                            <TouchableOpacity
                              onPress={() => startEditNote(ev)}
                              hitSlop={6}
                              style={styles.editNoteLink}
                              accessibilityLabel={ev.note ? "Edit note" : "Add note"}
                            >
                              <Feather name="edit-2" size={12} color={colors.primary} />
                              <Text style={[styles.editNoteLinkText, { color: colors.primary }]}>
                                {ev.note ? "Edit note" : "Add note"}
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                        </>
                      )}
                      {!ev.photoPath ? (
                        <Text style={[styles.when, { color: colors.mutedForeground, fontStyle: "italic" }]}>
                          Marked met without a photo
                        </Text>
                      ) : null}
                    </View>
                    {canDelete ? (
                      <TouchableOpacity
                        onPress={() => requestDelete(ev.id)}
                        hitSlop={10}
                        style={styles.deleteBtn}
                        accessibilityLabel="Delete evidence event"
                      >
                        <Feather name="trash-2" size={18} color={colors.destructive} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: Platform.OS === "ios" ? 32 : 20,
    maxHeight: "80%",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-start",
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  deleteBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  who: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  when: { fontSize: 12, fontFamily: "Inter_400Regular" },
  note: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  editNoteLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    paddingVertical: 2,
  },
  editNoteLinkText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  editWrap: { marginTop: 4, gap: 6 },
  editInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    minHeight: 60,
    textAlignVertical: "top",
  },
  editActions: { flexDirection: "row", justifyContent: "flex-end", gap: 16 },
  editBtn: { paddingVertical: 4, paddingHorizontal: 4 },
  editBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  undoBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
  },
  undoText: { flex: 1, fontSize: 13, fontFamily: "Inter_600SemiBold" },
  undoBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  undoBtnText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  emptyWrap: {
    alignItems: "center",
    paddingVertical: 32,
    gap: 10,
  },
  empty: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 16,
  },
});
