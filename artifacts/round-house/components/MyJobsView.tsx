import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import {
  getGetAssignedToMeQueryKey,
  getGetFeedQueryKey,
  useCancelWorkLogDueDateRequest,
  useGetAssignedToMe,
  useGetUnreadWorkOrderCommentCounts,
  useListMyWorkOrders,
  useRequestWorkLogDueDate,
  useUpdateWorkLogStatus,
} from "@workspace/api-client-react";
import type {
  WorkLog,
  WorkLogAttachment,
  WorkOrder,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { EmptyState } from "@/components/EmptyState";
import { DueDatePickerModal } from "@/components/DueDatePickerModal";
import { PhotoViewer, type PhotoViewerItem, type PhotoShareContext } from "@/components/PhotoViewer";
import { PhotoHintBadge } from "@/components/PhotoHintBadge";
import { PerClientTagLine, type ConnectionTag } from "@/components/PerClientTagLine";
import { resolveStorageUrl } from "@/lib/uploads";

type Status = "open" | "in_progress" | "done";

const SECTION_ORDER: { key: Status; label: string }[] = [
  { key: "in_progress", label: "In Progress" },
  { key: "open", label: "To Do" },
  { key: "done", label: "Recently Done" },
];

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type DueInfo = {
  label: string;
  tone: "overdue" | "soon" | "normal";
};

function describeDue(dueStr: string | null | undefined): DueInfo | null {
  if (!dueStr) return null;
  const due = new Date(dueStr);
  if (Number.isNaN(due.getTime())) return null;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const dayDiff = Math.round((dueDay - startOfToday) / 86400000);
  if (dayDiff < 0) {
    const n = Math.abs(dayDiff);
    return { label: n === 1 ? "Overdue 1 day" : `Overdue ${n} days`, tone: "overdue" };
  }
  if (dayDiff === 0) return { label: "Due today", tone: "soon" };
  if (dayDiff === 1) return { label: "Due tomorrow", tone: "soon" };
  if (dayDiff <= 3) return { label: `Due in ${dayDiff} days`, tone: "soon" };
  return {
    label: `Due ${due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    tone: "normal",
  };
}

function dueSortKey(log: WorkLog) {
  if (!log.dueDate) return Number.POSITIVE_INFINITY;
  const t = new Date(log.dueDate).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

export function MyJobsView({ embedded = false }: { embedded?: boolean }) {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch } = useGetAssignedToMe();
  const myWorkOrdersQuery = useListMyWorkOrders();
  const unreadCommentsQuery = useGetUnreadWorkOrderCommentCounts();
  const updateStatus = useUpdateWorkLogStatus();
  const requestDueDate = useRequestWorkLogDueDate();
  const cancelDueDateRequest = useCancelWorkLogDueDateRequest();
  const [reschedulingLogId, setReschedulingLogId] = useState<number | null>(null);
  const [pickingDateLogId, setPickingDateLogId] = useState<number | null>(null);
  const [reasonByLogId, setReasonByLogId] = useState<Record<number, string>>({});
  const [showCancelled, setShowCancelled] = useState(false);
  const [viewer, setViewer] = useState<{
    photos: PhotoViewerItem[];
    index: number;
    shareContext?: PhotoShareContext;
  } | null>(null);

  const unreadByWorkOrder = useMemo(() => {
    const map: Record<number, number> = {};
    for (const c of unreadCommentsQuery.data?.counts ?? []) {
      map[c.workOrderId] = c.unreadCount;
    }
    return map;
  }, [unreadCommentsQuery.data]);

  const { activeWorkOrders, doneWorkOrders, cancelledWorkOrders } = useMemo(() => {
    const all = myWorkOrdersQuery.data?.workOrders ?? [];
    const finished = ["complete", "verified", "cancelled"];
    const active = all.filter((w) => !finished.includes(w.status));
    const done = all.filter(
      (w) => finished.includes(w.status) && w.status !== "cancelled",
    );
    const cancelled = all.filter((w) => w.status === "cancelled");
    active.sort((a, b) => {
      const da = a.dueDate ? new Date(a.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const db_ = b.dueDate ? new Date(b.dueDate).getTime() : Number.POSITIVE_INFINITY;
      if (da !== db_) return da - db_;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    done.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    cancelled.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { activeWorkOrders: active, doneWorkOrders: done, cancelledWorkOrders: cancelled };
  }, [myWorkOrdersQuery.data]);

  const grouped = useMemo(() => {
    const out: Record<Status, WorkLog[]> = { open: [], in_progress: [], done: [] };
    for (const l of data?.logs ?? []) {
      const s = (l.status as Status) ?? "open";
      if (out[s]) out[s].push(l);
    }
    for (const k of ["open", "in_progress"] as Status[]) {
      out[k].sort((a, b) => {
        const da = dueSortKey(a);
        const db_ = dueSortKey(b);
        if (da !== db_) return da - db_;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    }
    out.done = out.done.slice(0, 8);
    return out;
  }, [data]);

  const totalActive = grouped.open.length + grouped.in_progress.length;

  const requestReschedule = async (log: WorkLog, isoDate: string, reason?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const trimmed = (reason ?? "").trim();
    try {
      await requestDueDate.mutateAsync({
        logId: log.id,
        data: trimmed
          ? { proposedDate: isoDate, reason: trimmed }
          : { proposedDate: isoDate },
      });
      await queryClient.invalidateQueries({ queryKey: getGetAssignedToMeQueryKey() });
      setReschedulingLogId(null);
      setPickingDateLogId(null);
      setReasonByLogId((m) => {
        const next = { ...m };
        delete next[log.id];
        return next;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not send request";
      if (Platform.OS === "web") {
        // eslint-disable-next-line no-alert
        alert(msg);
      } else {
        Alert.alert("Could not send request", msg);
      }
    }
  };

  const cancelReschedule = async (log: WorkLog) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await cancelDueDateRequest.mutateAsync({ logId: log.id });
      await queryClient.invalidateQueries({ queryKey: getGetAssignedToMeQueryKey() });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not cancel request";
      if (Platform.OS === "web") {
        // eslint-disable-next-line no-alert
        alert(msg);
      } else {
        Alert.alert("Could not cancel", msg);
      }
    }
  };

  const transition = async (log: WorkLog, status: Status) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await updateStatus.mutateAsync({ logId: log.id, data: { status } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetAssignedToMeQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetFeedQueryKey() }),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not update job status";
      if (Platform.OS === "web") {
        // eslint-disable-next-line no-alert
        alert(msg);
      } else {
        Alert.alert("Could not update", msg);
      }
    }
  };

  const totalUnreadComments = useMemo(
    () => Object.values(unreadByWorkOrder).reduce((sum, n) => sum + (n || 0), 0),
    [unreadByWorkOrder],
  );

  const openWorkOrder = (wo: WorkOrder) => {
    Haptics.selectionAsync();
    router.push(`/work-order/${wo.id}`);
  };

  const previewLogPhotos = (log: WorkLog) => {
    const photos = buildLogPhotoItems(log);
    if (photos.length === 0) return;
    Haptics.selectionAsync();
    setViewer({
      photos,
      index: 0,
      shareContext: { propertyName: log.property?.name ?? null },
    });
  };

  const previewWorkOrderPhotos = (wo: WorkOrder) => {
    Haptics.selectionAsync();
    const paths =
      wo.latestCommentPhotoPaths ??
      (wo.latestCommentPhotoPath ? [wo.latestCommentPhotoPath] : []);
    const addedAt = wo.latestCommentCreatedAt ?? undefined;
    const addedByName = wo.latestCommentAuthorName ?? undefined;
    const photos: PhotoViewerItem[] = [];
    for (const path of paths) {
      const url = resolveStorageUrl(path);
      if (!url) continue;
      photos.push({ url, addedAt, addedByName, workOrderId: wo.id });
    }
    if (photos.length === 0) {
      const msg = "No photos found on the latest comment.";
      if (Platform.OS === "web") {
        // eslint-disable-next-line no-alert
        alert(msg);
      } else {
        Alert.alert("No photos", msg);
      }
      return;
    }
    setViewer({
      photos,
      index: 0,
      shareContext: {
        propertyName: wo.property?.name ?? null,
        workOrderTitle: wo.title ?? null,
      },
    });
  };

  const hasWorkOrders =
    activeWorkOrders.length + doneWorkOrders.length + cancelledWorkOrders.length > 0;

  if (isLoading && !data && myWorkOrdersQuery.isLoading && !myWorkOrdersQuery.data) {
    return (
      <View style={[styles.center, embedded ? null : { backgroundColor: colors.background, flex: 1 }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (totalActive === 0 && grouped.done.length === 0 && !hasWorkOrders) {
    return (
      <View style={embedded ? styles.embeddedEmpty : { flex: 1, backgroundColor: colors.background }}>
        <EmptyState
          icon="check-circle"
          title="No jobs assigned"
          description="When someone assigns you a job it will show up here. Pull down to refresh."
        />
      </View>
    );
  }

  return (
    <View style={embedded ? null : { flex: 1, backgroundColor: colors.background }}>
      <View style={styles.summaryRow}>
        <SummaryPill label="Active" value={totalActive} colors={colors} tone="primary" />
        <SummaryPill label="In progress" value={grouped.in_progress.length} colors={colors} tone="warn" />
        <SummaryPill label="Done" value={grouped.done.length} colors={colors} tone="ok" />
      </View>

      {hasWorkOrders && (
        <View style={styles.section}>
          <View style={styles.workHeaderRow}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              ASSIGNED WORK ORDERS ·{" "}
              {activeWorkOrders.length +
                doneWorkOrders.length +
                (showCancelled ? cancelledWorkOrders.length : 0)}
            </Text>
            {totalUnreadComments > 0 && (
              <View
                style={[styles.unreadHeaderBadge, { backgroundColor: colors.primary }]}
                accessibilityLabel={`${totalUnreadComments} unread ${totalUnreadComments === 1 ? "comment" : "comments"}`}
              >
                <Feather name="message-circle" size={10} color={colors.primaryForeground} />
                <Text style={[styles.unreadHeaderText, { color: colors.primaryForeground }]}>
                  {totalUnreadComments > 99 ? "99+" : totalUnreadComments}
                </Text>
              </View>
            )}
          </View>
          {activeWorkOrders.map((wo) => (
            <WorkOrderJobRow
              key={wo.id}
              wo={wo}
              colors={colors}
              unreadComments={unreadByWorkOrder[wo.id] ?? 0}
              onPress={() => openWorkOrder(wo)}
              onPreviewPhotos={() => previewWorkOrderPhotos(wo)}
            />
          ))}
          {doneWorkOrders.length > 0 && (
            <>
              <Text style={[styles.sectionSubLabel, { color: colors.mutedForeground }]}>
                RECENTLY COMPLETED
              </Text>
              {doneWorkOrders.map((wo) => (
                <WorkOrderJobRow
                  key={wo.id}
                  wo={wo}
                  colors={colors}
                  unreadComments={unreadByWorkOrder[wo.id] ?? 0}
                  onPress={() => openWorkOrder(wo)}
                  onPreviewPhotos={() => previewWorkOrderPhotos(wo)}
                />
              ))}
            </>
          )}
          {cancelledWorkOrders.length > 0 && (
            <>
              <TouchableOpacity
                onPress={() => {
                  Haptics.selectionAsync();
                  setShowCancelled((v) => !v);
                }}
                style={styles.cancelledToggle}
                accessibilityLabel={
                  showCancelled
                    ? `Hide ${cancelledWorkOrders.length} cancelled work ${cancelledWorkOrders.length === 1 ? "order" : "orders"}`
                    : `Show ${cancelledWorkOrders.length} cancelled work ${cancelledWorkOrders.length === 1 ? "order" : "orders"}`
                }
              >
                <Feather
                  name={showCancelled ? "chevron-down" : "chevron-right"}
                  size={13}
                  color={colors.mutedForeground}
                />
                <Text style={[styles.cancelledToggleText, { color: colors.mutedForeground }]}>
                  {showCancelled ? "Hide" : "Show"} cancelled · {cancelledWorkOrders.length}
                </Text>
              </TouchableOpacity>
              {showCancelled &&
                cancelledWorkOrders.map((wo) => (
                  <WorkOrderJobRow
                    key={wo.id}
                    wo={wo}
                    colors={colors}
                    unreadComments={unreadByWorkOrder[wo.id] ?? 0}
                    onPress={() => openWorkOrder(wo)}
                    onPreviewPhotos={() => previewWorkOrderPhotos(wo)}
                  />
                ))}
            </>
          )}
        </View>
      )}

      {SECTION_ORDER.map(({ key, label }) => {
        const items = grouped[key];
        if (items.length === 0) return null;
        return (
          <View key={key} style={styles.section}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {label.toUpperCase()} · {items.length}
            </Text>
            {items.map((log) => (
              <JobCard
                key={log.id}
                log={log}
                colors={colors}
                pending={updateStatus.isPending && updateStatus.variables?.logId === log.id}
                rescheduling={reschedulingLogId === log.id}
                requestPending={
                  (requestDueDate.isPending && requestDueDate.variables?.logId === log.id) ||
                  (cancelDueDateRequest.isPending && cancelDueDateRequest.variables?.logId === log.id)
                }
                onStart={() => transition(log, "in_progress")}
                onMarkDone={() => transition(log, "done")}
                onReopen={() => transition(log, "open")}
                onOpen={() => router.push(`/property/${log.propertyId}`)}
                onToggleReschedule={() =>
                  setReschedulingLogId((cur) => (cur === log.id ? null : log.id))
                }
                onProposeDate={(iso) => requestReschedule(log, iso, reasonByLogId[log.id])}
                onPickCustomDate={() => {
                  Haptics.selectionAsync();
                  setReschedulingLogId(null);
                  setPickingDateLogId(log.id);
                }}
                onCancelRequest={() => cancelReschedule(log)}
                reasonDraft={reasonByLogId[log.id] ?? ""}
                onChangeReason={(text) =>
                  setReasonByLogId((m) => ({ ...m, [log.id]: text }))
                }
                onPreviewPhotos={() => previewLogPhotos(log)}
              />
            ))}
          </View>
        );
      })}

      <PhotoViewer
        visible={!!viewer}
        photos={viewer?.photos ?? []}
        initialIndex={viewer?.index ?? 0}
        onClose={() => setViewer(null)}
        shareContext={viewer?.shareContext}
      />

      <DueDatePickerModal
        visible={pickingDateLogId !== null}
        onClose={() => setPickingDateLogId(null)}
        onApply={(iso) => {
          const log = (data?.logs ?? []).find((l) => l.id === pickingDateLogId);
          if (log) requestReschedule(log, iso, reasonByLogId[log.id]);
        }}
        title="Propose a new due date"
        minimumDate={(() => {
          const d = new Date();
          d.setHours(0, 0, 0, 0);
          d.setDate(d.getDate() + 1);
          return d;
        })()}
      />

      {!isLoading && (
        <TouchableOpacity
          onPress={() => {
            refetch();
            myWorkOrdersQuery.refetch();
            unreadCommentsQuery.refetch();
          }}
          style={styles.refreshBtn}
        >
          <Feather name="refresh-ccw" size={13} color={colors.mutedForeground} />
          <Text style={[styles.refreshText, { color: colors.mutedForeground }]}>Refresh</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const RESCHEDULE_PRESETS: { label: string; days: number }[] = [
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "In a week", days: 7 },
  { label: "In 2 weeks", days: 14 },
];

function isoFromDays(days: number): string {
  const d = new Date();
  d.setHours(17, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function JobCard({
  log,
  colors,
  pending,
  rescheduling,
  requestPending,
  onStart,
  onMarkDone,
  onReopen,
  onOpen,
  onToggleReschedule,
  onProposeDate,
  onPickCustomDate,
  onCancelRequest,
  reasonDraft,
  onChangeReason,
  onPreviewPhotos,
}: {
  log: WorkLog;
  colors: ReturnType<typeof useColors>;
  pending: boolean;
  rescheduling: boolean;
  requestPending: boolean;
  onStart: () => void;
  onMarkDone: () => void;
  onReopen: () => void;
  onOpen: () => void;
  onToggleReschedule: () => void;
  onProposeDate: (iso: string) => void;
  onPickCustomDate: () => void;
  onCancelRequest: () => void;
  reasonDraft: string;
  onChangeReason: (text: string) => void;
  onPreviewPhotos: () => void;
}) {
  const status = (log.status as Status) ?? "open";
  const due = describeDue(log.dueDate);
  const hasPendingRequest = !!log.dueDateRequestedDate;
  const photoCount =
    (log.photoUrl ? 1 : 0) +
    (log.attachments ?? []).filter((a) => a.kind === "image").length;
  const firstPhotoUrl = (() => {
    if (log.photoUrl) {
      return resolveStorageUrl(log.photoUrl) ?? log.photoUrl;
    }
    const firstImage = (log.attachments ?? []).find((a) => a.kind === "image");
    return firstImage ? resolveStorageUrl(firstImage.path) : null;
  })();
  const proposedLabel = log.dueDateRequestedDate
    ? new Date(log.dueDateRequestedDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <TouchableOpacity onPress={onOpen} activeOpacity={0.85}>
        <View style={styles.headerRow}>
          <Text style={[styles.propName, { color: colors.primary }]} numberOfLines={1}>
            {log.property?.name ?? "Property"}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {photoCount > 0 && (
              <PhotoHintBadge
                onPress={onPreviewPhotos}
                colors={colors}
                count={photoCount}
                thumbnailUrl={firstPhotoUrl}
                accessibilityLabel={
                  photoCount > 1
                    ? `Preview ${photoCount} photos from this log`
                    : "Preview the photo on this log"
                }
              />
            )}
            {due && status !== "done" && (
              <View
                style={[
                  styles.dueBadge,
                  { backgroundColor: dueBadgeBg(due.tone, colors), borderColor: dueBadgeFg(due.tone, colors) },
                ]}
              >
                <Feather
                  name={due.tone === "overdue" ? "alert-circle" : "clock"}
                  size={11}
                  color={dueBadgeFg(due.tone, colors)}
                />
                <Text style={[styles.dueText, { color: dueBadgeFg(due.tone, colors) }]}>{due.label}</Text>
              </View>
            )}
          </View>
        </View>
        <Text style={[styles.note, { color: colors.foreground }]} numberOfLines={3}>
          {log.note}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          From {log.author?.name ?? "—"} · {timeAgo(log.createdAt)}
        </Text>
      </TouchableOpacity>

      {hasPendingRequest && status !== "done" && (
        <View
          style={[
            styles.requestBanner,
            { backgroundColor: colors.primary + "12", borderColor: colors.primary + "55" },
          ]}
        >
          <View style={styles.requestHeaderRow}>
            <Feather name="clock" size={12} color={colors.primary} />
            <Text style={[styles.requestText, { color: colors.primary }]} numberOfLines={2}>
              Reschedule pending: {proposedLabel}
            </Text>
          </View>
          {log.dueDateRequestedReason ? (
            <Text
              style={[styles.requestReason, { color: colors.foreground }]}
              numberOfLines={3}
            >
              “{log.dueDateRequestedReason}”
            </Text>
          ) : null}
        </View>
      )}

      {!hasPendingRequest && log.dueDateResponseNote ? (
        <View
          style={[
            styles.requestBanner,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          <View style={styles.requestHeaderRow}>
            <Feather name="message-circle" size={12} color={colors.mutedForeground} />
            <Text
              style={[styles.requestText, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              Owner replied
            </Text>
          </View>
          <Text
            style={[styles.requestReason, { color: colors.foreground }]}
            numberOfLines={4}
          >
            “{log.dueDateResponseNote}”
          </Text>
        </View>
      ) : null}

      <View style={styles.actionRow}>
        {status === "open" && (
          <ActionButton label="Start" tone="primary" disabled={pending} onPress={onStart} colors={colors} icon="play" />
        )}
        {status === "in_progress" && (
          <>
            <ActionButton label="Mark done" tone="primary" disabled={pending} onPress={onMarkDone} colors={colors} icon="check" />
            <ActionButton label="Pause" tone="ghost" disabled={pending} onPress={onReopen} colors={colors} icon="pause" />
          </>
        )}
        {status === "done" && (
          <ActionButton label="Reopen" tone="ghost" disabled={pending} onPress={onReopen} colors={colors} icon="rotate-ccw" />
        )}
        {status !== "done" &&
          (hasPendingRequest ? (
            <ActionButton
              label="Cancel request"
              tone="ghost"
              disabled={requestPending}
              onPress={onCancelRequest}
              colors={colors}
              icon="x"
            />
          ) : (
            <ActionButton
              label={rescheduling ? "Cancel" : "Request reschedule"}
              tone="ghost"
              disabled={requestPending}
              onPress={onToggleReschedule}
              colors={colors}
              icon={rescheduling ? "x" : "calendar"}
            />
          ))}
        <View style={[styles.statusBadge, { backgroundColor: badgeBg(status, colors) }]}>
          <Text style={[styles.statusText, { color: badgeFg(status, colors) }]}>{labelFor(status)}</Text>
        </View>
      </View>

      {rescheduling && !hasPendingRequest && status !== "done" && (
        <View style={styles.rescheduleRow}>
          <TextInput
            value={reasonDraft}
            onChangeText={onChangeReason}
            editable={!requestPending}
            placeholder="Reason (optional, e.g. waiting on parts)"
            placeholderTextColor={colors.mutedForeground}
            maxLength={280}
            style={[
              styles.reasonInput,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
                opacity: requestPending ? 0.5 : 1,
              },
            ]}
            accessibilityLabel="Optional reason for the reschedule"
            returnKeyType="done"
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {RESCHEDULE_PRESETS.map((p) => (
            <TouchableOpacity
              key={p.label}
              disabled={requestPending}
              onPress={() => onProposeDate(isoFromDays(p.days))}
              style={[
                styles.presetChip,
                { borderColor: colors.border, opacity: requestPending ? 0.5 : 1 },
              ]}
            >
              <Text style={[styles.presetText, { color: colors.foreground }]}>{p.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            disabled={requestPending}
            onPress={onPickCustomDate}
            accessibilityLabel="Pick a custom reschedule date from a calendar"
            style={[
              styles.presetChip,
              styles.presetChipAccent,
              {
                borderColor: colors.primary,
                backgroundColor: colors.primary + "10",
                opacity: requestPending ? 0.5 : 1,
              },
            ]}
          >
            <Feather name="calendar" size={12} color={colors.primary} />
            <Text style={[styles.presetText, { color: colors.primary }]}>Pick a date…</Text>
          </TouchableOpacity>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const WORK_ORDER_STATUS_TINT: Record<string, string> = {
  open: "#7A8A99",
  requested: "#7A8A99",
  assigned: "#5687A8",
  in_progress: "#F59E0B",
  complete: "#5C8C75",
  verified: "#3F7059",
  cancelled: "#9CA3AF",
};

function WorkOrderJobRow({
  wo,
  colors,
  unreadComments,
  onPress,
  onPreviewPhotos,
}: {
  wo: WorkOrder;
  colors: ReturnType<typeof useColors>;
  unreadComments: number;
  onPress: () => void;
  onPreviewPhotos: () => void;
}) {
  const finished = ["complete", "verified", "cancelled"].includes(wo.status);
  const overdue =
    !!wo.dueDate && !finished && new Date(wo.dueDate).getTime() < Date.now();
  const statusTint = WORK_ORDER_STATUS_TINT[wo.status] ?? colors.mutedForeground;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.propName, { color: colors.primary }]} numberOfLines={1}>
          {wo.property?.name ?? "Property"}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {wo.latestCommentHasPhoto && (
            <PhotoHintBadge
              onPress={onPreviewPhotos}
              colors={colors}
              count={wo.latestCommentPhotoCount ?? 0}
              thumbnailUrl={resolveStorageUrl(wo.latestCommentPhotoPath)}
              accessibilityLabel={
                (wo.latestCommentPhotoCount ?? 0) > 1
                  ? `Preview ${wo.latestCommentPhotoCount} photos from the latest comment`
                  : "Preview the photo on the latest comment"
              }
            />
          )}
          {unreadComments > 0 && (
            <View
              style={[styles.unreadBadge, { backgroundColor: colors.primary }]}
              accessibilityLabel={`${unreadComments} unread ${unreadComments === 1 ? "comment" : "comments"}`}
            >
              <Feather name="message-circle" size={10} color={colors.primaryForeground} />
              <Text style={[styles.unreadBadgeText, { color: colors.primaryForeground }]}>
                {unreadComments > 99 ? "99+" : unreadComments}
              </Text>
            </View>
          )}
        </View>
      </View>
      <Text style={[styles.note, { color: colors.foreground }]} numberOfLines={2}>
        {wo.title}
      </Text>
      <View style={styles.workMetaRow}>
        <View style={[styles.workStatusPill, { backgroundColor: statusTint + "22" }]}>
          <Text style={[styles.workStatusText, { color: statusTint }]}>
            {wo.status.replace("_", " ")}
          </Text>
        </View>
        {wo.dueDate && (
          <Text
            style={[
              styles.meta,
              { color: overdue ? "#B0413E" : colors.mutedForeground },
            ]}
          >
            · due {new Date(wo.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </Text>
        )}
      </View>
      {(wo.assignee?.name || wo.createdBy?.name) && (
        <View style={{ marginTop: 4, gap: 2 }}>
          {wo.assignee?.name ? (
            <JobPersonLine
              label="Assigned"
              name={wo.assignee.name}
              tag={wo.assignee.connectionTag ?? null}
              colors={colors}
            />
          ) : null}
          {wo.createdBy?.name &&
          wo.createdBy.clerkId !== wo.assignee?.clerkId ? (
            <JobPersonLine
              label="Created by"
              name={wo.createdBy.name}
              tag={wo.createdBy.connectionTag ?? null}
              colors={colors}
            />
          ) : null}
        </View>
      )}
    </TouchableOpacity>
  );
}

// #545 — Compact `Label: Name` line with the viewer's per-client tag
// (Service · Identity) stacked underneath. Mirrors the detail
// screen so the Mine tab cards carry the same context.
function JobPersonLine({
  label,
  name,
  tag,
  colors,
}: {
  label: string;
  name: string;
  tag: ConnectionTag;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View>
      <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
        {label}: <Text style={{ color: colors.foreground }}>{name}</Text>
      </Text>
      <PerClientTagLine tag={tag} colors={colors} compact />
    </View>
  );
}

function ActionButton({
  label,
  icon,
  tone,
  disabled,
  onPress,
  colors,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  tone: "primary" | "ghost";
  disabled: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const isPrimary = tone === "primary";
  return (
    <TouchableOpacity
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.actionBtn,
        {
          backgroundColor: isPrimary ? colors.primary : "transparent",
          borderColor: isPrimary ? colors.primary : colors.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Feather name={icon} size={13} color={isPrimary ? colors.primaryForeground : colors.foreground} />
      <Text
        style={[
          styles.actionText,
          { color: isPrimary ? colors.primaryForeground : colors.foreground },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function SummaryPill({
  label,
  value,
  colors,
  tone,
}: {
  label: string;
  value: number;
  colors: ReturnType<typeof useColors>;
  tone: "primary" | "warn" | "ok";
}) {
  const accent =
    tone === "primary" ? colors.primary : tone === "warn" ? "#F59E0B" : colors.success ?? colors.primary;
  return (
    <View style={[styles.summaryPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.summaryValue, { color: accent }]}>{value}</Text>
      <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function labelFor(s: Status) {
  if (s === "in_progress") return "In progress";
  if (s === "done") return "Done";
  return "To do";
}
function badgeBg(s: Status, colors: ReturnType<typeof useColors>) {
  if (s === "done") return (colors.success ?? colors.primary) + "20";
  if (s === "in_progress") return "#F59E0B22";
  return colors.muted;
}
function badgeFg(s: Status, colors: ReturnType<typeof useColors>) {
  if (s === "done") return colors.success ?? colors.primary;
  if (s === "in_progress") return "#F59E0B";
  return colors.mutedForeground;
}
function dueBadgeFg(tone: DueInfo["tone"], colors: ReturnType<typeof useColors>) {
  if (tone === "overdue") return "#B3261E";
  if (tone === "soon") return "#F59E0B";
  return colors.mutedForeground;
}
function dueBadgeBg(tone: DueInfo["tone"], colors: ReturnType<typeof useColors>) {
  if (tone === "overdue") return "#B3261E15";
  if (tone === "soon") return "#F59E0B15";
  return colors.muted;
}

function toIsoString(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

function buildLogPhotoItems(log: WorkLog): PhotoViewerItem[] {
  const photos: PhotoViewerItem[] = [];
  const addedByName = log.author?.name;
  const workOrderId = log.workOrderId ?? undefined;
  const logCreatedAt = toIsoString(log.createdAt);
  if (log.photoUrl) {
    const url = resolveStorageUrl(log.photoUrl) ?? log.photoUrl;
    if (url) {
      photos.push({
        url,
        addedAt: logCreatedAt,
        addedByName,
        logId: log.id,
        logNote: log.note ?? undefined,
        workOrderId,
      });
    }
  }
  for (const a of (log.attachments ?? []) as WorkLogAttachment[]) {
    if (a.kind !== "image") continue;
    const url = resolveStorageUrl(a.path);
    if (!url) continue;
    photos.push({
      url,
      addedAt: toIsoString(a.addedAt) ?? logCreatedAt,
      addedByName,
      logId: log.id,
      logNote: log.note ?? undefined,
      workOrderId,
    });
  }
  return photos;
}


const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", paddingVertical: 40 },
  embeddedEmpty: { paddingVertical: 24 },
  summaryRow: { flexDirection: "row", gap: 10, marginTop: 8, marginBottom: 16 },
  summaryPill: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    gap: 2,
  },
  summaryValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  summaryLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.4 },
  section: { marginBottom: 14 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6, marginBottom: 8 },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    gap: 8,
  },
  propName: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  note: { fontSize: 14, fontFamily: "Inter_500Medium", lineHeight: 20 },
  meta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 4 },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  actionText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  statusBadge: {
    marginLeft: "auto",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  refreshBtn: {
    flexDirection: "row",
    alignSelf: "center",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    marginTop: 4,
  },
  refreshText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  dueBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  dueText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  workHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionSubLabel: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.6,
    marginTop: 6,
    marginBottom: 6,
  },
  unreadBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  unreadBadgeText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    minWidth: 8,
    textAlign: "center",
  },
  unreadHeaderBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  unreadHeaderText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
  },
  workMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  workStatusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  workStatusText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
    textTransform: "capitalize",
  },
  requestBanner: {
    flexDirection: "column",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  requestHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  requestText: { fontSize: 12, fontFamily: "Inter_600SemiBold", flex: 1 },
  requestReason: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    fontStyle: "italic",
  },
  rescheduleRow: { marginTop: 6, gap: 6 },
  reasonInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 999,
    marginRight: 8,
  },
  presetText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  presetChipAccent: { flexDirection: "row", alignItems: "center", gap: 5 },
  cancelledToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
    marginTop: 2,
  },
  cancelledToggleText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
});
