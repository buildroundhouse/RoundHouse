import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Pressable,
  Share,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useAuth, useUser } from "@/lib/auth";
import {
  useGetProperty,
  useListPropertySpecs,
  useCreatePropertySpec,
  useUpdatePropertySpec,
  useDeletePropertySpec,
  useListPropertyNotes,
  useCreatePropertyNote,
  useUpdatePropertyNote,
  useDeletePropertyNote,
  useGetPropertyOnboarding,
  useGetPropertyHandoff,
  useGetMyPropertyMembership,
  useDismissPropertyWelcome,
  useResetPropertyWelcome,
  useListPropertyLogs,
  useAddPropertyMember,
  useTransferPropertyOwnership,
  useAssignWorkLog,
  useUpdateWorkLogDueDate,
  useRespondWorkLogDueDateRequest,
  useUpdateWorkLogStatus,
  useDeleteWorkLog,
  useDeleteWorkLogAttachment,
  getListPropertyLogsQueryKey,
  useRateWorkLog,
  useListWorkOrders,
  useListPropertyWorkOrderPhotos,
  useCreateWorkOrder,
  useListPropertyAssets,
  useGetUnreadWorkOrderCommentCounts,
  useListPropertyStandards,
  useCreatePropertyStandard,
  useUpdatePropertyStandard,
  useDeletePropertyStandard,
  useGetStandardsStatus,
  useCreateStandardEvidence,
  useListStandardEvidence,
  useDeleteStandardEvidencePhoto,
  getListStandardEvidenceQueryKey,
  useUpdateProperty,
  useUpdatePropertyMember,
  useGetMe,
  getGetAssignedToMeQueryKey,
} from "@workspace/api-client-react";
import type {
  HandoffEntry,
  ListWorkLogsResponse,
  NoteAttachment,
  PropertyMember,
  PropertyNote,
  PropertyOnboarding,
  PropertySpec,
  PropertyStandard,
  PropertyWithMembers,
  PropertyWorkOrderPhoto,
  StandardEvidence,
  StandardStatusItem,
  WorkLog,
  WorkOrder,
} from "@workspace/api-client-react";
import { AttachmentList, PhotoPreview, type AttachmentItem } from "@/components/AttachmentList";
import { useQueryClient } from "@tanstack/react-query";
import { PropertyOnboardingCard } from "@/components/PropertyOnboardingCard";
import { MapBackfillBanner } from "@/components/MapBackfillBanner";
import { StaticMapPreview } from "@/components/StaticMapPreview";
import { SpecEditorModal } from "@/components/SpecEditorModal";
import { NoteEditorModal } from "@/components/NoteEditorModal";
import { StandardEditorModal } from "@/components/StandardEditorModal";
import { ProviderProfileSheet } from "@/components/ProviderProfileSheet";
import { AddProviderModal } from "@/components/AddProviderModal";
import { PropertySettingsModal } from "@/components/PropertySettingsModal";
import { PropertyMessagesTab } from "@/components/PropertyMessagesTab";
import { PropertyProfileModal } from "@/components/PropertyProfileModal";
import { EditPropertyModal } from "@/components/EditPropertyModal";
import { TransferOwnershipModal } from "@/components/TransferOwnershipModal";
import { RatingPromptModal } from "@/components/RatingPromptModal";
import { RatingStars } from "@/components/RatingStars";
import { WorkOrderEditorModal, type WorkOrderValues } from "@/components/WorkOrderEditorModal";
import { AssetsCard } from "@/components/AssetsCard";
import { DemoBadge } from "@/components/DemoBadge";
import { RecurringTasksManagerModal } from "@/components/RecurringTasksManagerModal";
import { StandardEvidenceHistoryModal } from "@/components/StandardEvidenceHistoryModal";
import { StandardNotePromptModal } from "@/components/StandardNotePromptModal";
import { PhotoViewer, type PhotoViewerItem } from "@/components/PhotoViewer";
import { PerClientTagLine, type ConnectionTag } from "@/components/PerClientTagLine";
import { DueDatePickerModal } from "@/components/DueDatePickerModal";
import { UndoSnackbar } from "@/components/UndoSnackbar";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { uploadAsset, resolveStorageUrl } from "@/lib/uploads";
import { buildPropertyShareMessage, hasMapPin } from "@/lib/propertyShare";
import {
  makeSpecDeleteHandler,
  makeStandardDeleteHandler,
  makeNoteDeleteHandler,
} from "@/lib/propertyDeleteConfirm";

type Tab = "overview" | "work" | "team" | "roster" | "knowledge" | "standards" | "notes" | "logs" | "handoff" | "messages";
type Colors = ReturnType<typeof useColors>;

function formatDate(d: string | Date): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const FOREVER_ISO = "9999-12-31T00:00:00.000Z";

function presentSnoozeChooser({
  title,
  muted,
  onPick,
}: {
  title: string;
  muted: boolean;
  onPick: (snoozeUntil: string | null) => void | Promise<void>;
}) {
  const day = 24 * 60 * 60 * 1000;
  const inDays = (n: number) => new Date(Date.now() + n * day).toISOString();
  const options: { label: string; value: string | null; destructive?: boolean }[] = [
    { label: "Snooze 1 day", value: inDays(1) },
    { label: "Snooze 1 week", value: inDays(7) },
    { label: "Snooze 1 month", value: inDays(30) },
    { label: "Mute indefinitely", value: FOREVER_ISO },
  ];
  if (muted) options.push({ label: "Unmute / clear snooze", value: null, destructive: true });

  if (Platform.OS === "web") {
    const lines = options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
    const choice = prompt(`Snooze alerts for "${title}"\n${lines}\n\nEnter a number (or cancel):`);
    const idx = choice ? parseInt(choice, 10) - 1 : -1;
    if (idx >= 0 && idx < options.length) {
      void onPick(options[idx].value);
    }
    return;
  }
  Alert.alert(
    `Snooze alerts for "${title}"`,
    "Owners won't get push notifications during this period.",
    [
      ...options.map((o) => ({
        text: o.label,
        style: o.destructive ? ("destructive" as const) : ("default" as const),
        onPress: () => void onPick(o.value),
      })),
      { text: "Cancel", style: "cancel" as const },
    ],
  );
}

function snoozeBadgeText(snoozeUntil: string | null | undefined): string | null {
  if (!snoozeUntil) return null;
  const ms = new Date(snoozeUntil).getTime();
  if (!Number.isFinite(ms) || ms <= Date.now()) return null;
  const forever = new Date(FOREVER_ISO).getTime();
  if (ms >= forever - 24 * 60 * 60 * 1000) return "MUTED";
  const days = Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 1) return "SNOOZED 1d";
  return `SNOOZED ${days}d`;
}

const DUE_PRESETS: { label: string; days: number | null }[] = [
  { label: "No due date", days: null },
  { label: "Today", days: 0 },
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

function formatDueChip(dueStr: string | null | undefined): {
  label: string;
  tone: "overdue" | "soon" | "normal" | "none";
} {
  if (!dueStr) return { label: "Set due date", tone: "none" };
  const due = new Date(dueStr);
  if (Number.isNaN(due.getTime())) return { label: "Set due date", tone: "none" };
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const dayDiff = Math.round((dueDay - startOfToday) / 86400000);
  if (dayDiff < 0) {
    const n = Math.abs(dayDiff);
    return { label: n === 1 ? "Overdue 1d" : `Overdue ${n}d`, tone: "overdue" };
  }
  if (dayDiff === 0) return { label: "Due today", tone: "soon" };
  if (dayDiff === 1) return { label: "Due tomorrow", tone: "soon" };
  if (dayDiff <= 3) return { label: `Due in ${dayDiff}d`, tone: "soon" };
  return {
    label: `Due ${due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    tone: "normal",
  };
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function PropertyDetailScreen() {
  const { id, tab: tabParam, focusLogId: focusLogIdParam, focusStandardId: focusStandardIdParam } = useLocalSearchParams<{
    id: string;
    tab?: string;
    focusLogId?: string;
    focusStandardId?: string;
  }>();
  const propertyId = parseInt(String(id), 10);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { userId: currentUserId } = useAuth();
  const validTabs: Tab[] = ["overview", "work", "team", "roster", "knowledge", "standards", "notes", "logs", "handoff", "messages"];
  const initialTab: Tab = validTabs.includes(tabParam as Tab) ? (tabParam as Tab) : "overview";
  const [tab, setTab] = useState<Tab>(initialTab);
  useEffect(() => {
    if (tabParam && validTabs.includes(tabParam as Tab)) setTab(tabParam as Tab);
  }, [tabParam]);

  const [selectedMember, setSelectedMember] = useState<PropertyMember | null>(null);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showEditProperty, setShowEditProperty] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTransferOwnership, setShowTransferOwnership] = useState(false);
  // Mirrors the avatar profile modal — opens a full-screen "Property
  // Profile" sheet built from the same code as PublicProfileModal.
  const [showPropertyProfile, setShowPropertyProfile] = useState(false);
  const transferOwnership = useTransferPropertyOwnership();
  const [ratingFor, setRatingFor] = useState<WorkLog | null>(null);

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [dismissedThisSession, setDismissedThisSession] = useState(false);

  const propertyQuery = useGetProperty(propertyId);
  const specsQuery = useListPropertySpecs(propertyId);
  const notesQuery = useListPropertyNotes(propertyId);
  const logsQuery = useListPropertyLogs(propertyId);
  const onboardingQuery = useGetPropertyOnboarding(propertyId);
  const handoffQuery = useGetPropertyHandoff(propertyId);
  const membershipQuery = useGetMyPropertyMembership(propertyId);
  const workOrdersQuery = useListWorkOrders(propertyId);
  const workOrderPhotosQuery = useListPropertyWorkOrderPhotos(propertyId);
  const assetsQuery = useListPropertyAssets(propertyId);
  const unreadCommentsQuery = useGetUnreadWorkOrderCommentCounts({ propertyId });
  const unreadCommentsByOrder = useMemo(() => {
    const map: Record<number, number> = {};
    for (const c of unreadCommentsQuery.data?.counts ?? []) {
      map[c.workOrderId] = c.unreadCount;
    }
    return map;
  }, [unreadCommentsQuery.data]);
  const totalUnreadComments = useMemo(
    () => Object.values(unreadCommentsByOrder).reduce((sum, n) => sum + (n || 0), 0),
    [unreadCommentsByOrder],
  );
  const standardsQuery = useListPropertyStandards(propertyId);
  const standardsStatusQuery = useGetStandardsStatus(propertyId);

  const createSpec = useCreatePropertySpec();
  const updateSpec = useUpdatePropertySpec();
  const deleteSpec = useDeletePropertySpec();
  const createNote = useCreatePropertyNote();
  const updateNote = useUpdatePropertyNote();
  const deleteNote = useDeletePropertyNote();
  const createWorkOrder = useCreateWorkOrder();
  const createStandard = useCreatePropertyStandard();
  const updateStandard = useUpdatePropertyStandard();
  const deleteStandard = useDeletePropertyStandard();
  const createStandardEvidence = useCreateStandardEvidence();
  const updateProperty = useUpdateProperty();
  const updatePropertyMember = useUpdatePropertyMember();
  const meQuery = useGetMe();

  const dismissWelcome = useDismissPropertyWelcome();
  const resetWelcome = useResetPropertyWelcome();
  const addMember = useAddPropertyMember();
  const assignLog = useAssignWorkLog();
  const updateDueDate = useUpdateWorkLogDueDate();
  const respondDueDateRequest = useRespondWorkLogDueDateRequest();
  const updateStatus = useUpdateWorkLogStatus();
  const deleteWorkLog = useDeleteWorkLog();
  const deleteWorkLogAttachment = useDeleteWorkLogAttachment();
  const deleteStandardEvidencePhoto = useDeleteStandardEvidencePhoto();
  const rateLog = useRateWorkLog();

  const UNDO_WINDOW_MS = 5000;
  const logsQueryKey = getListPropertyLogsQueryKey(propertyId);
  const [pendingDeleteLog, setPendingDeleteLog] = useState<WorkLog | null>(null);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingLogRef = useRef<WorkLog | null>(null);

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

  const performDeleteLog = React.useCallback(
    (log: WorkLog) => {
      deleteWorkLog.mutate(
        { logId: log.id },
        {
          onSuccess: () => {
            invalidate();
            queryClient.invalidateQueries({
              queryKey: getGetAssignedToMeQueryKey(),
            });
            queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
          },
          onError: (err: unknown) => {
            queryClient.setQueryData<ListWorkLogsResponse | undefined>(
              logsQueryKey,
              (prev) => {
                if (!prev) return prev;
                if (prev.logs.some((l) => l.id === log.id)) return prev;
                const next = [log, ...prev.logs].sort(
                  (a, b) =>
                    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                );
                return { ...prev, logs: next, total: prev.total + 1 };
              },
            );
            const message =
              err && typeof err === "object" && "message" in err
                ? String((err as { message?: string }).message)
                : "Could not delete that work log.";
            Alert.alert("Delete failed", message);
          },
        },
      );
    },
    [deleteWorkLog, queryClient, logsQueryKey],
  );

  const performDeleteLogRef = useRef(performDeleteLog);
  useEffect(() => {
    performDeleteLogRef.current = performDeleteLog;
  }, [performDeleteLog]);

  const flushPendingLogDelete = React.useCallback(() => {
    const pending = pendingLogRef.current;
    if (!pending) return;
    clearUndoTimers();
    pendingLogRef.current = null;
    setPendingDeleteLog(null);
    setUndoSecondsLeft(0);
    performDeleteLog(pending);
  }, [clearUndoTimers, performDeleteLog]);

  const undoLogDelete = React.useCallback(() => {
    const pending = pendingLogRef.current;
    if (!pending) return;
    clearUndoTimers();
    pendingLogRef.current = null;
    setPendingDeleteLog(null);
    setUndoSecondsLeft(0);
    queryClient.setQueryData<ListWorkLogsResponse | undefined>(
      logsQueryKey,
      (prev) => {
        if (!prev) return { logs: [pending], total: 1 };
        if (prev.logs.some((l) => l.id === pending.id)) return prev;
        const next = [pending, ...prev.logs].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        return { ...prev, logs: next, total: prev.total + 1 };
      },
    );
  }, [clearUndoTimers, queryClient, logsQueryKey]);

  const requestDeleteLog = React.useCallback(
    (log: WorkLog) => {
      if (pendingLogRef.current && pendingLogRef.current.id !== log.id) {
        flushPendingLogDelete();
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      queryClient.setQueryData<ListWorkLogsResponse | undefined>(
        logsQueryKey,
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            logs: prev.logs.filter((l) => l.id !== log.id),
            total: Math.max(0, prev.total - 1),
          };
        },
      );
      pendingLogRef.current = log;
      setPendingDeleteLog(log);
      setUndoSecondsLeft(Math.ceil(UNDO_WINDOW_MS / 1000));
      clearUndoTimers();
      undoTimerRef.current = setTimeout(() => {
        flushPendingLogDelete();
      }, UNDO_WINDOW_MS);
      undoTickRef.current = setInterval(() => {
        setUndoSecondsLeft((s) => (s > 0 ? s - 1 : 0));
      }, 1000);
    },
    [clearUndoTimers, flushPendingLogDelete, queryClient, logsQueryKey],
  );

  useEffect(() => {
    flushPendingLogDelete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  type PendingPhotoDelete = {
    logId: number;
    storagePath: string;
    isPrimary: boolean;
    attachment: NonNullable<WorkLog["attachments"]>[number] | null;
    photoUrl: string | null;
  };
  const [pendingDeletePhoto, setPendingDeletePhoto] =
    useState<PendingPhotoDelete | null>(null);
  const [photoUndoSecondsLeft, setPhotoUndoSecondsLeft] = useState(0);
  const photoUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const photoUndoTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingPhotoRef = useRef<PendingPhotoDelete | null>(null);

  const clearPhotoUndoTimers = React.useCallback(() => {
    if (photoUndoTimerRef.current) {
      clearTimeout(photoUndoTimerRef.current);
      photoUndoTimerRef.current = null;
    }
    if (photoUndoTickRef.current) {
      clearInterval(photoUndoTickRef.current);
      photoUndoTickRef.current = null;
    }
  }, []);

  const performDeletePhoto = React.useCallback(
    (pending: PendingPhotoDelete) => {
      deleteWorkLogAttachment.mutate(
        { logId: pending.logId, params: { path: pending.storagePath } },
        {
          onSuccess: () => {
            invalidate();
            queryClient.invalidateQueries({
              queryKey: getGetAssignedToMeQueryKey(),
            });
            queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
          },
          onError: (err: unknown) => {
            queryClient.setQueryData<ListWorkLogsResponse | undefined>(
              logsQueryKey,
              (prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  logs: prev.logs.map((l) => {
                    if (l.id !== pending.logId) return l;
                    const restoredAttachments =
                      pending.attachment && !pending.isPrimary
                        ? [...(l.attachments ?? []), pending.attachment]
                        : l.attachments;
                    const restoredPhotoUrl = pending.isPrimary
                      ? pending.photoUrl
                      : l.photoUrl;
                    return {
                      ...l,
                      attachments: restoredAttachments,
                      photoUrl: restoredPhotoUrl,
                    };
                  }),
                };
              },
            );
            const message =
              err && typeof err === "object" && "message" in err
                ? String((err as { message?: string }).message)
                : "Could not delete that photo.";
            Alert.alert("Delete failed", message);
          },
        },
      );
    },
    [deleteWorkLogAttachment, queryClient, logsQueryKey],
  );

  const performDeletePhotoRef = useRef(performDeletePhoto);
  useEffect(() => {
    performDeletePhotoRef.current = performDeletePhoto;
  }, [performDeletePhoto]);

  const flushPendingPhotoDelete = React.useCallback(() => {
    const pending = pendingPhotoRef.current;
    if (!pending) return;
    clearPhotoUndoTimers();
    pendingPhotoRef.current = null;
    setPendingDeletePhoto(null);
    setPhotoUndoSecondsLeft(0);
    performDeletePhoto(pending);
  }, [clearPhotoUndoTimers, performDeletePhoto]);

  const undoPhotoDelete = React.useCallback(() => {
    const pending = pendingPhotoRef.current;
    if (!pending) return;
    clearPhotoUndoTimers();
    pendingPhotoRef.current = null;
    setPendingDeletePhoto(null);
    setPhotoUndoSecondsLeft(0);
    queryClient.setQueryData<ListWorkLogsResponse | undefined>(
      logsQueryKey,
      (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          logs: prev.logs.map((l) => {
            if (l.id !== pending.logId) return l;
            const restoredAttachments =
              pending.attachment && !pending.isPrimary
                ? [...(l.attachments ?? []), pending.attachment]
                : l.attachments;
            const restoredPhotoUrl = pending.isPrimary
              ? pending.photoUrl
              : l.photoUrl;
            return {
              ...l,
              attachments: restoredAttachments,
              photoUrl: restoredPhotoUrl,
            };
          }),
        };
      },
    );
  }, [clearPhotoUndoTimers, queryClient, logsQueryKey]);

  const requestDeletePhoto = React.useCallback(
    (item: PhotoViewerItem) => {
      if (!item.storagePath || item.logId == null) return;
      const cached = queryClient.getQueryData<ListWorkLogsResponse | undefined>(
        logsQueryKey,
      );
      const targetLog = cached?.logs.find((l) => l.id === item.logId);
      if (!targetLog) return;
      if (pendingPhotoRef.current && pendingPhotoRef.current.storagePath !== item.storagePath) {
        flushPendingPhotoDelete();
      }
      const isPrimary = targetLog.photoUrl === item.storagePath;
      const attachment =
        (targetLog.attachments ?? []).find((a) => a?.path === item.storagePath) ?? null;
      const pending: PendingPhotoDelete = {
        logId: item.logId,
        storagePath: item.storagePath,
        isPrimary,
        attachment,
        photoUrl: targetLog.photoUrl ?? null,
      };
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      queryClient.setQueryData<ListWorkLogsResponse | undefined>(
        logsQueryKey,
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            logs: prev.logs.map((l) => {
              if (l.id !== item.logId) return l;
              return {
                ...l,
                photoUrl: isPrimary ? null : l.photoUrl,
                attachments: isPrimary
                  ? l.attachments
                  : (l.attachments ?? []).filter((a) => a?.path !== item.storagePath),
              };
            }),
          };
        },
      );
      pendingPhotoRef.current = pending;
      setPendingDeletePhoto(pending);
      setPhotoUndoSecondsLeft(Math.ceil(UNDO_WINDOW_MS / 1000));
      clearPhotoUndoTimers();
      photoUndoTimerRef.current = setTimeout(() => {
        flushPendingPhotoDelete();
      }, UNDO_WINDOW_MS);
      photoUndoTickRef.current = setInterval(() => {
        setPhotoUndoSecondsLeft((s) => (s > 0 ? s - 1 : 0));
      }, 1000);
    },
    [flushPendingPhotoDelete, queryClient, logsQueryKey, clearPhotoUndoTimers],
  );

  useEffect(() => {
    flushPendingPhotoDelete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  useEffect(() => {
    return () => {
      const pending = pendingPhotoRef.current;
      if (pending) {
        pendingPhotoRef.current = null;
        if (photoUndoTimerRef.current) {
          clearTimeout(photoUndoTimerRef.current);
          photoUndoTimerRef.current = null;
        }
        if (photoUndoTickRef.current) {
          clearInterval(photoUndoTickRef.current);
          photoUndoTickRef.current = null;
        }
        performDeletePhotoRef.current(pending);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      const pending = pendingLogRef.current;
      if (pending) {
        pendingLogRef.current = null;
        if (undoTimerRef.current) {
          clearTimeout(undoTimerRef.current);
          undoTimerRef.current = null;
        }
        if (undoTickRef.current) {
          clearInterval(undoTickRef.current);
          undoTickRef.current = null;
        }
        performDeleteLogRef.current(pending);
      }
    };
  }, []);

  type PendingEvidencePhotoDelete = {
    propertyId: number;
    standardId: number;
    eventId: number;
    storagePath: string;
    snapshot: StandardEvidence;
  };
  const [pendingDeleteEvidencePhoto, setPendingDeleteEvidencePhoto] =
    useState<PendingEvidencePhotoDelete | null>(null);
  const [evidencePhotoUndoSecondsLeft, setEvidencePhotoUndoSecondsLeft] = useState(0);
  const evidencePhotoUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const evidencePhotoUndoTickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingEvidencePhotoRef = useRef<PendingEvidencePhotoDelete | null>(null);

  const evidenceQueryKeyFor = React.useCallback(
    (pid: number, standardId: number) => [
      `/api/properties/${pid}/standards/${standardId}/evidence`,
    ],
    [],
  );

  const clearEvidencePhotoUndoTimers = React.useCallback(() => {
    if (evidencePhotoUndoTimerRef.current) {
      clearTimeout(evidencePhotoUndoTimerRef.current);
      evidencePhotoUndoTimerRef.current = null;
    }
    if (evidencePhotoUndoTickRef.current) {
      clearInterval(evidencePhotoUndoTickRef.current);
      evidencePhotoUndoTickRef.current = null;
    }
  }, []);

  const performDeleteEvidencePhoto = React.useCallback(
    (pending: PendingEvidencePhotoDelete) => {
      deleteStandardEvidencePhoto.mutate(
        {
          propertyId: pending.propertyId,
          standardId: pending.standardId,
          eventId: pending.eventId,
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({
              queryKey: evidenceQueryKeyFor(pending.propertyId, pending.standardId),
            });
            queryClient.invalidateQueries({
              queryKey: [`/api/properties/${pending.propertyId}/standards/status`],
            });
            queryClient.invalidateQueries({ queryKey: ["/api/overview"] });
          },
          onError: (err: unknown) => {
            queryClient.setQueryData<{ events: StandardEvidence[] } | undefined>(
              evidenceQueryKeyFor(pending.propertyId, pending.standardId),
              (prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  events: prev.events.map((e) =>
                    e.id === pending.eventId
                      ? { ...e, photoPath: pending.snapshot.photoPath }
                      : e,
                  ),
                };
              },
            );
            const message =
              err && typeof err === "object" && "message" in err
                ? String((err as { message?: string }).message)
                : "Could not delete that photo.";
            Alert.alert("Delete failed", message);
          },
        },
      );
    },
    [deleteStandardEvidencePhoto, queryClient, evidenceQueryKeyFor],
  );

  const performDeleteEvidencePhotoRef = useRef(performDeleteEvidencePhoto);
  useEffect(() => {
    performDeleteEvidencePhotoRef.current = performDeleteEvidencePhoto;
  }, [performDeleteEvidencePhoto]);

  const flushPendingEvidencePhotoDelete = React.useCallback(() => {
    const pending = pendingEvidencePhotoRef.current;
    if (!pending) return;
    clearEvidencePhotoUndoTimers();
    pendingEvidencePhotoRef.current = null;
    setPendingDeleteEvidencePhoto(null);
    setEvidencePhotoUndoSecondsLeft(0);
    performDeleteEvidencePhoto(pending);
  }, [clearEvidencePhotoUndoTimers, performDeleteEvidencePhoto]);

  const undoEvidencePhotoDelete = React.useCallback(() => {
    const pending = pendingEvidencePhotoRef.current;
    if (!pending) return;
    clearEvidencePhotoUndoTimers();
    pendingEvidencePhotoRef.current = null;
    setPendingDeleteEvidencePhoto(null);
    setEvidencePhotoUndoSecondsLeft(0);
    queryClient.setQueryData<{ events: StandardEvidence[] } | undefined>(
      evidenceQueryKeyFor(pending.propertyId, pending.standardId),
      (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          events: prev.events.map((e) =>
            e.id === pending.eventId
              ? { ...e, photoPath: pending.snapshot.photoPath }
              : e,
          ),
        };
      },
    );
  }, [clearEvidencePhotoUndoTimers, queryClient, evidenceQueryKeyFor]);

  const requestDeleteEvidencePhoto = React.useCallback(
    (item: PhotoViewerItem, standardId: number) => {
      if (item.evidenceId == null || !item.storagePath) return;
      const eventId = item.evidenceId;
      const storagePath = item.storagePath;
      const targetPropertyId = propertyId;
      const cached = queryClient.getQueryData<{ events: StandardEvidence[] } | undefined>(
        evidenceQueryKeyFor(targetPropertyId, standardId),
      );
      const event = cached?.events.find((e) => e.id === eventId);
      if (!event) return;
      if (
        pendingEvidencePhotoRef.current &&
        pendingEvidencePhotoRef.current.eventId !== eventId
      ) {
        flushPendingEvidencePhotoDelete();
      }
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      queryClient.setQueryData<{ events: StandardEvidence[] } | undefined>(
        evidenceQueryKeyFor(targetPropertyId, standardId),
        (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            events: prev.events.map((e) =>
              e.id === eventId ? { ...e, photoPath: null } : e,
            ),
          };
        },
      );
      const pending: PendingEvidencePhotoDelete = {
        propertyId: targetPropertyId,
        standardId,
        eventId,
        storagePath,
        snapshot: event,
      };
      pendingEvidencePhotoRef.current = pending;
      setPendingDeleteEvidencePhoto(pending);
      setEvidencePhotoUndoSecondsLeft(Math.ceil(UNDO_WINDOW_MS / 1000));
      clearEvidencePhotoUndoTimers();
      evidencePhotoUndoTimerRef.current = setTimeout(() => {
        flushPendingEvidencePhotoDelete();
      }, UNDO_WINDOW_MS);
      evidencePhotoUndoTickRef.current = setInterval(() => {
        setEvidencePhotoUndoSecondsLeft((s) => (s > 0 ? s - 1 : 0));
      }, 1000);
    },
    [
      clearEvidencePhotoUndoTimers,
      evidenceQueryKeyFor,
      flushPendingEvidencePhotoDelete,
      queryClient,
    ],
  );

  useEffect(() => {
    flushPendingEvidencePhotoDelete();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  useEffect(() => {
    return () => {
      const pending = pendingEvidencePhotoRef.current;
      if (pending) {
        pendingEvidencePhotoRef.current = null;
        if (evidencePhotoUndoTimerRef.current) {
          clearTimeout(evidencePhotoUndoTimerRef.current);
          evidencePhotoUndoTimerRef.current = null;
        }
        if (evidencePhotoUndoTickRef.current) {
          clearInterval(evidencePhotoUndoTickRef.current);
          evidencePhotoUndoTickRef.current = null;
        }
        performDeleteEvidencePhotoRef.current(pending);
      }
    };
  }, []);

  const property = propertyQuery.data;
  const onboarding = onboardingQuery.data;
  const membership = membershipQuery.data;
  const logs = logsQuery.data?.logs ?? [];

  const members = property?.members ?? [];
  const activeMembers = useMemo(() => members.filter((m) => !m.archivedAt), [members]);
  const archivedMembers = useMemo(() => members.filter((m) => m.archivedAt), [members]);

  const canEdit = property?.userRole === "owner" || property?.userRole === "admin";
  const canManage = canEdit;

  useEffect(() => {
    if (!dismissedThisSession && membership?.shouldShowOnboarding) {
      setShowOnboarding(true);
    }
  }, [dismissedThisSession, membership?.shouldShowOnboarding]);

  const [specEditor, setSpecEditor] = useState<{
    open: boolean;
    id?: number;
    key?: string;
    value?: string;
    category?: string;
    photoPath?: string | null;
  }>({ open: false });
  const [noteEditor, setNoteEditor] = useState<{
    open: boolean;
    id?: number;
    title?: string;
    body?: string;
    isPinned?: boolean;
    attachments?: AttachmentItem[];
  }>({ open: false });
  const [workOrderEditor, setWorkOrderEditor] = useState<{ open: boolean }>({ open: false });
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [standardEditor, setStandardEditor] = useState<{
    open: boolean;
    id?: number;
    title?: string;
    description?: string;
    cadenceDays?: number;
    evidenceType?: string;
    keyword?: string;
    quickPhrases?: string[];
  }>({ open: false });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}`] });
    queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/logs`] });
    queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/specs`] });
    queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/notes`] });
    queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/onboarding`] });
    queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/handoff`] });
    queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/standards`] });
    queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}/standards/status`] });
  };

  const refetchAll = () => {
    propertyQuery.refetch();
    specsQuery.refetch();
    notesQuery.refetch();
    logsQuery.refetch();
    onboardingQuery.refetch();
    handoffQuery.refetch();
    membershipQuery.refetch();
    workOrdersQuery.refetch();
    standardsQuery.refetch();
    standardsStatusQuery.refetch();
  };

  const handleAddProvider = async (data: {
    email: string;
    role: string;
    tradeType?: string;
    companyName?: string;
    phone?: string;
    licenseNumber?: string;
  }) => {
    await addMember.mutateAsync({ propertyId, data });
    invalidate();
  };

  const memberOptions = useMemo(
    () =>
      (propertyQuery.data?.members ?? [])
        .filter((m) => m.user?.clerkId)
        .map((m) => ({ clerkId: m.user!.clerkId, name: m.user!.name || m.user!.email || "Member" })),
    [propertyQuery.data?.members],
  );

  if (!propertyId || Number.isNaN(propertyId)) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.foreground }}>Invalid property</Text>
      </View>
    );
  }

  const handleMarkDone = async (log: WorkLog) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const updated = await updateStatus.mutateAsync({
      logId: log.id,
      data: { status: "done" },
    });
    invalidate();
    if (canManage && updated.assigneeClerkId) {
      setRatingFor(updated);
    }
  };

  const handleAssign = async (log: WorkLog, assigneeClerkId: string | null) => {
    Haptics.selectionAsync();
    await assignLog.mutateAsync({
      logId: log.id,
      data: { assigneeClerkId },
    });
    invalidate();
  };

  const handleSetDueDate = async (log: WorkLog, dueDate: string | null) => {
    Haptics.selectionAsync();
    await updateDueDate.mutateAsync({
      logId: log.id,
      data: { dueDate },
    });
    invalidate();
    await queryClient.invalidateQueries({ queryKey: getGetAssignedToMeQueryKey() });
  };

  const handleRespondDueDateRequest = async (
    log: WorkLog,
    decision: "accept" | "decline",
    note?: string,
  ) => {
    Haptics.selectionAsync();
    const trimmed = (note ?? "").trim();
    await respondDueDateRequest.mutateAsync({
      logId: log.id,
      data: trimmed ? { decision, note: trimmed } : { decision },
    });
    invalidate();
    await queryClient.invalidateQueries({ queryKey: getGetAssignedToMeQueryKey() });
  };

  const handleRate = async (stars: number, comment?: string) => {
    if (!ratingFor) return;
    await rateLog.mutateAsync({
      logId: ratingFor.id,
      data: { stars, comment },
    });
    invalidate();
  };

  const handleSpecSubmit = async (values: { key: string; value: string; category: string; photoPath?: string | null }) => {
    if (specEditor.id) {
      await updateSpec.mutateAsync({ propertyId, specId: specEditor.id, data: values });
    } else {
      await createSpec.mutateAsync({ propertyId, data: values });
    }
    invalidate();
  };

  const handleSpecDelete = makeSpecDeleteHandler({
    deleteSpec: (specId) => deleteSpec.mutateAsync({ propertyId, specId }),
    invalidate,
  });

  const handleNoteSubmit = async (values: { title: string; body: string; isPinned: boolean; attachments: AttachmentItem[] }) => {
    if (noteEditor.id) {
      await updateNote.mutateAsync({ propertyId, noteId: noteEditor.id, data: values });
    } else {
      await createNote.mutateAsync({ propertyId, data: values });
    }
    invalidate();
  };

  const handleWorkOrderSubmit = async (values: WorkOrderValues) => {
    await createWorkOrder.mutateAsync({ propertyId, data: values });
    workOrdersQuery.refetch();
  };

  const isCommercial = property?.type === "commercial";
  const assetOptions = useMemo(
    () =>
      (assetsQuery.data?.assets ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        assetTag: a.assetTag ?? null,
      })),
    [assetsQuery.data?.assets],
  );

  const handleStandardSubmit = async (values: {
    title: string;
    description: string;
    cadenceDays: number;
    evidenceType: string;
    keyword: string;
    quickPhrases: string[];
  }) => {
    const data = {
      title: values.title,
      description: values.description,
      cadenceDays: values.cadenceDays,
      evidenceType: values.evidenceType,
      keyword: values.keyword || undefined,
      quickPhrases: values.quickPhrases,
    };
    if (standardEditor.id) {
      await updateStandard.mutateAsync({ propertyId, standardId: standardEditor.id, data });
    } else {
      await createStandard.mutateAsync({ propertyId, data });
    }
    invalidate();
  };

  const standardEditorStandardId = standardEditor.open ? standardEditor.id ?? 0 : 0;
  const standardEditorEvidenceQuery = useListStandardEvidence(
    propertyId,
    standardEditorStandardId,
    {
      query: {
        enabled: standardEditor.open && !!standardEditor.id,
        queryKey: getListStandardEvidenceQueryKey(propertyId, standardEditorStandardId),
      },
    },
  );
  const standardEditorPastNotes = useMemo(() => {
    if (!standardEditor.open || !standardEditor.id) return [];
    const events = standardEditorEvidenceQuery.data?.events ?? [];
    const counts = new Map<string, { count: number; last: number; original: string }>();
    for (const ev of events) {
      const raw = (ev.note ?? "").trim();
      if (!raw) continue;
      if (raw.length > 80) continue;
      const key = raw.toLowerCase();
      const ts = ev.createdAt ? new Date(ev.createdAt).getTime() : 0;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
        if (ts > existing.last) existing.last = ts;
      } else {
        counts.set(key, { count: 1, last: ts, original: raw });
      }
    }
    const entries = Array.from(counts.values());
    const recurring = entries.filter((entry) => entry.count > 1);
    const pool = recurring.length > 0 ? recurring : entries;
    return pool
      .sort((a, b) => (b.count - a.count) || (b.last - a.last))
      .map((entry) => entry.original);
  }, [standardEditor.open, standardEditor.id, standardEditorEvidenceQuery.data]);

  const [markingStandardId, setMarkingStandardId] = useState<number | null>(null);
  const [notePrompt, setNotePrompt] = useState<{
    standardId: number;
    standardTitle: string;
    photoPath: string | null;
    evidenceType: string;
    customPhrases: string[];
  } | null>(null);
  const notePromptStandardId = notePrompt?.standardId ?? 0;
  const notePromptEvidenceQuery = useListStandardEvidence(
    propertyId,
    notePromptStandardId,
    {
      query: {
        enabled: !!notePrompt,
        queryKey: getListStandardEvidenceQueryKey(propertyId, notePromptStandardId),
      },
    },
  );
  const noteSuggestions = useMemo(() => {
    if (!notePrompt) return [];
    const defaultsByType: Record<string, string[]> = {
      log: ["All clear", "Replaced filter", "No issues found", "Tested and working"],
      photo: ["Photo attached", "All clear", "Looks good", "Documented condition"],
      rating: ["Great service", "Satisfactory", "Needs follow-up", "Excellent work"],
    };
    const customPhrases = (notePrompt.customPhrases ?? [])
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    const fallback = customPhrases.length === 0
      ? (defaultsByType[notePrompt.evidenceType] ?? defaultsByType.log)
      : [];
    const events = notePromptEvidenceQuery.data?.events ?? [];
    const counts = new Map<string, { count: number; last: number; original: string }>();
    for (const ev of events) {
      const raw = (ev.note ?? "").trim();
      if (!raw) continue;
      if (raw.length > 60) continue;
      const key = raw.toLowerCase();
      const ts = ev.createdAt ? new Date(ev.createdAt).getTime() : 0;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
        if (ts > existing.last) existing.last = ts;
      } else {
        counts.set(key, { count: 1, last: ts, original: raw });
      }
    }
    const ranked = Array.from(counts.values())
      .sort((a, b) => (b.count - a.count) || (b.last - a.last))
      .map((entry) => entry.original);
    const merged: string[] = [];
    const seen = new Set<string>();
    for (const phrase of [...customPhrases, ...ranked, ...fallback]) {
      const key = phrase.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(phrase);
      if (merged.length >= 4) break;
    }
    return merged;
  }, [notePrompt, notePromptEvidenceQuery.data]);
  const [submittingEvidence, setSubmittingEvidence] = useState(false);
  const [historyStandard, setHistoryStandard] = useState<PropertyStandard | null>(null);
  const [historyPhotos, setHistoryPhotos] = useState<{
    photos: PhotoViewerItem[];
    index: number;
    standardId: number;
  } | null>(null);
  const [logViewer, setLogViewer] = useState<{
    photos: PhotoViewerItem[];
    index: number;
  } | null>(null);
  const openLogPhoto = (photos: PhotoViewerItem[], index: number) => {
    if (!photos.length) return;
    setLogViewer({ photos, index: Math.max(0, Math.min(index, photos.length - 1)) });
  };
  const mainScrollRef = useRef<ScrollView>(null);
  const [jumpToLogId, setJumpToLogId] = useState<number | null>(null);
  const [jumpToStandardId, setJumpToStandardId] = useState<number | null>(null);
  const handleJumpToLog = (logId: number) => {
    setTab("logs");
    setJumpToLogId(logId);
  };

  useEffect(() => {
    if (!focusLogIdParam) return;
    const n = parseInt(String(focusLogIdParam), 10);
    if (!Number.isFinite(n)) return;
    setJumpToLogId(n);
  }, [focusLogIdParam]);

  useEffect(() => {
    if (!focusStandardIdParam) return;
    const n = parseInt(String(focusStandardIdParam), 10);
    if (!Number.isFinite(n)) return;
    setTab("standards");
    setJumpToStandardId(n);
  }, [focusStandardIdParam]);

  const memberNameByClerkId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of property?.members ?? []) {
      const id = m.user?.clerkId;
      if (!id) continue;
      map[id] = m.user?.name || m.user?.email || "Member";
    }
    return map;
  }, [property?.members]);

  const handleMarkStandardMet = async (standardId: number, withPhoto: boolean) => {
    const standard = standardsQuery.data?.standards?.find((s) => s.id === standardId);
    const standardTitle = standard?.title ?? "this standard";
    let promptOpened = false;
    try {
      setMarkingStandardId(standardId);
      let photoPath: string | null = null;
      if (withPhoto) {
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
        const uploaded = await uploadAsset({
          uri: asset.uri,
          name: asset.fileName ?? undefined,
          contentType: asset.mimeType ?? undefined,
          size: asset.fileSize ?? undefined,
        });
        photoPath = uploaded.path;
      }
      setNotePrompt({
        standardId,
        standardTitle,
        photoPath,
        evidenceType: standard?.evidenceType ?? "log",
        customPhrases: standard?.quickPhrases ?? [],
      });
      promptOpened = true;
    } catch (err) {
      Alert.alert("Could not mark met", err instanceof Error ? err.message : "Please try again.");
    } finally {
      if (!promptOpened) setMarkingStandardId(null);
    }
  };

  const submitStandardEvidence = async (note: string | null) => {
    if (!notePrompt || submittingEvidence) return;
    const { standardId, photoPath } = notePrompt;
    setSubmittingEvidence(true);
    try {
      await createStandardEvidence.mutateAsync({
        propertyId,
        standardId,
        data: { photoPath, note },
      });
      invalidate();
      setNotePrompt(null);
      setMarkingStandardId(null);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      Alert.alert("Could not mark met", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSubmittingEvidence(false);
    }
  };

  const cancelStandardEvidence = () => {
    if (submittingEvidence) return;
    setNotePrompt(null);
    setMarkingStandardId(null);
  };

  const handleSnoozeStandard = (standard: PropertyStandard) => {
    const apply = async (snoozeUntil: string | null) => {
      await updateStandard.mutateAsync({
        propertyId,
        standardId: standard.id,
        data: { snoozeUntil },
      });
      invalidate();
    };
    presentSnoozeChooser({
      title: standard.title,
      muted: !!standard.snoozeUntil && new Date(standard.snoozeUntil).getTime() > Date.now(),
      onPick: apply,
    });
  };

  const handleMutePropertyAlerts = () => {
    const apply = async (snoozeUntil: string | null) => {
      await updateProperty.mutateAsync({
        propertyId,
        data: { standardsMutedUntil: snoozeUntil },
      });
      invalidate();
    };
    presentSnoozeChooser({
      title: property?.name ?? "this property",
      muted: !!property?.standardsMutedUntil && new Date(property.standardsMutedUntil).getTime() > Date.now(),
      onPick: apply,
    });
  };

  const handleStandardDelete = makeStandardDeleteHandler({
    deleteStandard: (standardId) =>
      deleteStandard.mutateAsync({ propertyId, standardId }),
    invalidate,
  });

  const handleNoteDelete = makeNoteDeleteHandler({
    deleteNote: (noteId) => deleteNote.mutateAsync({ propertyId, noteId }),
    invalidate,
  });

  const topPad = Platform.OS === "web" ? 16 : insets.top + 8;

  if (propertyQuery.isLoading || !property) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Feather name="chevron-left" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
              {property.name}
            </Text>
            {(property as { isAdminDemo?: boolean }).isAdminDemo ? (
              <DemoBadge size="md" />
            ) : null}
          </View>
          {property.address ? (
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]} numberOfLines={1}>
              {property.address}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={async () => {
            Haptics.selectionAsync();
            const payload = buildPropertyShareMessage({
              name: property.name,
              address: property.address,
              latitude: property.latitude,
              longitude: property.longitude,
            });
            try {
              if (Platform.OS === "web") {
                const navAny = (globalThis as unknown as {
                  navigator?: {
                    share?: (data: ShareData) => Promise<void>;
                    clipboard?: { writeText: (s: string) => Promise<void> };
                  };
                }).navigator;
                if (navAny?.share) {
                  await navAny.share({
                    title: payload.title,
                    text: payload.message,
                    ...(payload.url ? { url: payload.url } : {}),
                  });
                } else if (navAny?.clipboard) {
                  await navAny.clipboard.writeText(payload.message);
                }
              } else {
                await Share.share({
                  message: payload.message,
                  title: payload.title,
                  ...(payload.url && Platform.OS === "ios" ? { url: payload.url } : {}),
                });
              }
            } catch {
              // user cancelled or share unavailable; nothing to do
            }
          }}
          hitSlop={10}
          style={{ marginLeft: 12 }}
          accessibilityLabel={
            hasMapPin({
              latitude: property.latitude,
              longitude: property.longitude,
              name: property.name,
            })
              ? "Share property with map pin"
              : "Share property"
          }
        >
          <Feather name="share-2" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            Haptics.selectionAsync();
            setShowPropertyProfile(true);
          }}
          hitSlop={10}
          style={{ marginLeft: 12 }}
          accessibilityLabel="Open property profile"
        >
          <Feather name="user" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            Haptics.selectionAsync();
            setShowSettings(true);
          }}
          hitSlop={10}
          style={{ marginLeft: 12 }}
          accessibilityLabel="Property settings"
        >
          <Feather name="settings" size={22} color={colors.foreground} />
        </TouchableOpacity>
      </View>

      {/* Slim property banner: gives visitors an immediate visual anchor
          for which property they're on. Uses the property's cover photo
          when present, otherwise falls back to the cover color with a
          home glyph so the banner is never empty. */}
      <View
        style={[
          styles.propertyBanner,
          {
            backgroundColor: property.coverColor || colors.muted,
            borderBottomColor: colors.border,
          },
        ]}
        accessibilityLabel={`Property banner for ${property.name}`}
      >
        {property.coverPhotoUrl ? (
          <Image
            source={{ uri: resolveStorageUrl(property.coverPhotoUrl) ?? undefined }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.propertyBannerEmpty]}>
            <Feather name="home" size={28} color="rgba(255,255,255,0.85)" />
          </View>
        )}
      </View>

      {/* Identity pill row — mirrors the avatar profile's role/identity
          pills (rolePill / perClientTagChip in PublicProfileModal) so the
          property page reads like a profile: type · role · members. */}
      <View
        style={[
          styles.propertyIdentityRow,
          { borderBottomColor: colors.border, backgroundColor: colors.background },
        ]}
      >
        {property.type ? (
          <View style={[styles.propertyIdentityPill, { backgroundColor: colors.muted }]}>
            <Feather name="home" size={11} color={colors.mutedForeground} />
            <Text style={[styles.propertyIdentityPillText, { color: colors.mutedForeground }]}>
              {property.type.charAt(0).toUpperCase() + property.type.slice(1)}
            </Text>
          </View>
        ) : null}
        {property.userRole ? (
          <View style={[styles.propertyIdentityPill, { backgroundColor: colors.muted }]}>
            <Feather
              name={property.userRole === "owner" ? "key" : "user"}
              size={11}
              color={colors.mutedForeground}
            />
            <Text style={[styles.propertyIdentityPillText, { color: colors.mutedForeground }]}>
              {property.userRole.charAt(0).toUpperCase() + property.userRole.slice(1)}
            </Text>
          </View>
        ) : null}
        {Array.isArray(property.members) && property.members.length > 1 ? (
          <View style={[styles.propertyIdentityPill, { backgroundColor: colors.muted }]}>
            <Feather name="users" size={11} color={colors.mutedForeground} />
            <Text style={[styles.propertyIdentityPillText, { color: colors.mutedForeground }]}>
              {property.members.length} members
            </Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.tabsScroll, { borderBottomColor: colors.border }]}
        contentContainerStyle={styles.tabs}
      >
        {(["overview", "work", "team", "roster", "knowledge", "standards", "notes", "logs", "handoff", "messages"] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => {
              Haptics.selectionAsync();
              setTab(t);
            }}
            style={[styles.tabBtn, tab === t && { borderBottomColor: colors.primary }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text
                style={[
                  styles.tabText,
                  { color: tab === t ? colors.primary : colors.mutedForeground },
                ]}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
              {t === "work" && totalUnreadComments > 0 && (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 3,
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                    borderRadius: 999,
                    backgroundColor: colors.primary,
                  }}
                  accessibilityLabel={`${totalUnreadComments} unread ${totalUnreadComments === 1 ? "comment" : "comments"} across work orders`}
                >
                  <Feather name="message-circle" size={10} color={colors.primaryForeground} />
                  <Text
                    style={{
                      fontSize: 11,
                      fontFamily: "Inter_700Bold",
                      color: colors.primaryForeground,
                      minWidth: 8,
                      textAlign: "center",
                    }}
                  >
                    {totalUnreadComments > 99 ? "99+" : totalUnreadComments}
                  </Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {tab === "messages" ? (
        <PropertyMessagesTab
          propertyId={propertyId}
          meClerkId={currentUserId ?? null}
        />
      ) : (
      <ScrollView
        ref={mainScrollRef}
        contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
        refreshControl={
          <RefreshControl refreshing={propertyQuery.isRefetching} onRefresh={refetchAll} tintColor={colors.primary} />
        }
      >
        {tab === "overview" && (
          <OverviewTab
            colors={colors}
            onboarding={onboarding}
            property={property}
            logs={logs}
            canManage={canManage}
            standardsStatus={standardsStatusQuery.data}
            onSeeAllSpecs={() => setTab("knowledge")}
            onSeeAllNotes={() => setTab("notes")}
            onSeeAllLogs={() => setTab("logs")}
            onSeeStandards={() => setTab("standards")}
            onStartCheckin={() => router.push(`/property/checkin/${propertyId}`)}
            onAddSpec={() => setSpecEditor({ open: true })}
            onAddPinnedNote={() => setNoteEditor({ open: true, isPinned: true })}
            onMarkDone={handleMarkDone}
            onAssign={handleAssign}
            onSetDueDate={handleSetDueDate}
            onRespondDueDateRequest={handleRespondDueDateRequest}
            onOpenPhoto={openLogPhoto}
            onDeleteLog={requestDeleteLog}
            currentUserClerkId={currentUserId}
          />
        )}

        {tab === "work" && (
          <>
            {isCommercial && (
              <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
                <AssetsCard propertyId={propertyId} canManage={!!canEdit} />
              </View>
            )}
            <WorkTab
              colors={colors}
              workOrders={workOrdersQuery.data?.workOrders ?? []}
              isLoading={workOrdersQuery.isLoading}
              canManage={!!canEdit}
              canAdd={!!canEdit || isCommercial}
              unreadByOrder={unreadCommentsByOrder}
              onAdd={() => setWorkOrderEditor({ open: true })}
              onOpenRecurring={() => setRecurringOpen(true)}
              onPress={(wo) => router.push(`/work-order/${wo.id}` as never)}
            />
          </>
        )}

        {tab === "standards" && (
          <StandardsTab
            colors={colors}
            standards={standardsQuery.data?.standards ?? []}
            status={standardsStatusQuery.data}
            isLoading={standardsQuery.isLoading}
            canEdit={!!canEdit}
            onAdd={() => setStandardEditor({ open: true })}
            onEdit={(s) =>
              setStandardEditor({
                open: true,
                id: s.id,
                title: s.title,
                description: s.description,
                cadenceDays: s.cadenceDays,
                evidenceType: s.evidenceType,
                keyword: s.keyword || "",
                quickPhrases: s.quickPhrases ?? [],
              })
            }
            onDelete={handleStandardDelete}
            onMarkMet={handleMarkStandardMet}
            markingStandardId={markingStandardId}
            onSnoozeStandard={handleSnoozeStandard}
            onMutePropertyAlerts={handleMutePropertyAlerts}
            propertyMutedUntil={property?.standardsMutedUntil ?? null}
            onViewHistory={(s) => setHistoryStandard(s)}
            scrollViewRef={mainScrollRef}
            jumpToStandardId={jumpToStandardId}
            onJumpHandled={() => setJumpToStandardId(null)}
          />
        )}

        {tab === "team" && (
          <TeamTab
            colors={colors}
            members={activeMembers}
            onSelect={setSelectedMember}
            onAdd={() => setShowAddProvider(true)}
            canManage={canManage}
          />
        )}

        {tab === "roster" && (
          <RosterTab
            colors={colors}
            active={activeMembers}
            archived={archivedMembers}
            onSelect={setSelectedMember}
          />
        )}

        {tab === "knowledge" && (
          <KnowledgeTab
            colors={colors}
            specs={specsQuery.data?.specs ?? []}
            isLoading={specsQuery.isLoading}
            canEdit={!!canEdit}
            onAdd={() => setSpecEditor({ open: true })}
            onEdit={(s: PropertySpec) =>
              setSpecEditor({
                open: true,
                id: s.id,
                key: s.key,
                value: s.value,
                category: s.category,
                photoPath: s.photoPath ?? null,
              })
            }
            onDelete={handleSpecDelete}
          />
        )}

        {tab === "notes" && (
          <NotesTab
            colors={colors}
            notes={notesQuery.data?.notes ?? []}
            isLoading={notesQuery.isLoading}
            canEdit={!!canEdit}
            onAdd={() => setNoteEditor({ open: true })}
            onEdit={(n: PropertyNote) =>
              setNoteEditor({
                open: true,
                id: n.id,
                title: n.title,
                body: n.body,
                isPinned: n.isPinned,
                attachments: (n.attachments ?? []) as AttachmentItem[],
              })
            }
            onDelete={handleNoteDelete}
          />
        )}

        {tab === "logs" && (
          <LogsTab
            colors={colors}
            logs={logsQuery.data?.logs ?? []}
            members={property.members ?? []}
            canManage={canManage}
            currentUserClerkId={currentUserId}
            isLoading={logsQuery.isLoading}
            onOpenPhoto={openLogPhoto}
            scrollViewRef={mainScrollRef}
            jumpToLogId={jumpToLogId}
            onJumpHandled={() => setJumpToLogId(null)}
            onRespondDueDateRequest={handleRespondDueDateRequest}
            onDeleteLog={requestDeleteLog}
            workOrderPhotos={workOrderPhotosQuery.data?.photos ?? []}
            nameByClerkId={memberNameByClerkId}
          />
        )}

        {tab === "handoff" && (
          <HandoffTab
            colors={colors}
            entries={handoffQuery.data?.entries ?? []}
            isLoading={handoffQuery.isLoading}
          />
        )}
      </ScrollView>
      )}

      <ProviderProfileSheet
        visible={!!selectedMember}
        member={selectedMember}
        propertyId={propertyId}
        canManage={canManage}
        onClose={() => setSelectedMember(null)}
      />

      <AddProviderModal
        visible={showAddProvider}
        onClose={() => setShowAddProvider(false)}
        onSubmit={handleAddProvider}
      />

      <PropertySettingsModal
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        isOwner={property.userRole === "owner"}
        canEdit={canEdit}
        canInvite={canManage}
        onEditProperty={() => setShowEditProperty(true)}
        onInvite={() => setShowAddProvider(true)}
        onTransferOwnership={() => setShowTransferOwnership(true)}
        welcomeDismissed={!!membership?.welcomeDismissedAt}
        propertyName={property.name}
        notifyJobStarted={
          property.members?.find((m) => m.user?.clerkId === currentUserId)
            ?.notifyJobStarted ?? null
        }
        notifyJobCompleted={
          property.members?.find((m) => m.user?.clerkId === currentUserId)
            ?.notifyJobCompleted ?? null
        }
        globalNotifyJobStarted={meQuery.data?.notifyJobStarted ?? true}
        globalNotifyJobCompleted={meQuery.data?.notifyJobCompleted ?? true}
        onChangeNotifyJobStarted={async (value) => {
          if (!currentUserId) return;
          await updatePropertyMember.mutateAsync({
            propertyId,
            memberUserId: currentUserId,
            data: { notifyJobStarted: value },
          });
          propertyQuery.refetch();
        }}
        onChangeNotifyJobCompleted={async (value) => {
          if (!currentUserId) return;
          await updatePropertyMember.mutateAsync({
            propertyId,
            memberUserId: currentUserId,
            data: { notifyJobCompleted: value },
          });
          propertyQuery.refetch();
        }}
        onShowWelcomeGuide={() => {
          setDismissedThisSession(false);
          setShowOnboarding(true);
        }}
        onResetWelcomeGuide={() => {
          resetWelcome
            .mutateAsync({ propertyId })
            .then(() => {
              queryClient.invalidateQueries({
                queryKey: [`/api/properties/${propertyId}/members/me`],
              });
              if (Platform.OS !== "web") {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
              Alert.alert(
                "Welcome guide reset",
                "The welcome card will auto-show the next time you open this property.",
              );
            })
            .catch((err) => {
              Alert.alert(
                "Could not reset",
                err instanceof Error ? err.message : "Please try again.",
              );
            });
        }}
      />

      <EditPropertyModal
        visible={showEditProperty}
        onClose={() => setShowEditProperty(false)}
        initial={{
          name: property.name,
          address: property.address ?? "",
          type: property.type ?? "home",
          coverPhotoUrl: property.coverPhotoUrl ?? null,
          placeId: property.placeId ?? null,
          latitude: property.latitude ?? null,
          longitude: property.longitude ?? null,
        }}
        onSubmit={async (values) => {
          await updateProperty.mutateAsync({
            propertyId,
            data: {
              name: values.name,
              address: values.address,
              type: values.type,
              coverPhotoUrl: values.coverPhotoUrl,
              placeId: values.placeId,
              latitude: values.latitude,
              longitude: values.longitude,
            },
          });
          await refetchAll();
        }}
      />

      <PropertyProfileModal
        visible={showPropertyProfile}
        propertyId={propertyId}
        onClose={() => setShowPropertyProfile(false)}
      />

      <TransferOwnershipModal
        visible={showTransferOwnership}
        onClose={() => setShowTransferOwnership(false)}
        members={activeMembers}
        currentOwnerClerkId={property.ownerClerkId}
        onTransfer={async (newOwnerClerkId) => {
          await transferOwnership.mutateAsync({
            propertyId,
            data: { newOwnerClerkId },
          });
          await refetchAll();
        }}
      />

      <RatingPromptModal
        visible={!!ratingFor}
        assigneeName={ratingFor?.assignee?.name}
        onClose={() => setRatingFor(null)}
        onSubmit={handleRate}
      />

      <PropertyOnboardingCard
        visible={showOnboarding}
        onClose={() => {
          setShowOnboarding(false);
          setDismissedThisSession(true);
          if (!membership?.welcomeDismissedAt) {
            dismissWelcome
              .mutateAsync({ propertyId })
              .then(() => {
                queryClient.invalidateQueries({
                  queryKey: [`/api/properties/${propertyId}/members/me`],
                });
              })
              .catch(() => {
                // Non-fatal: the in-session flag still suppresses the modal
                // until next cold start, and the user can still re-open from
                // the Welcome guide pill.
              });
          }
        }}
        propertyName={property.name}
        joinedAt={onboarding?.joinedAt || property.createdAt}
        specs={onboarding?.specs ?? []}
        pinnedNotes={onboarding?.pinnedNotes ?? []}
        recentLogs={onboarding?.recentLogs ?? []}
      />

      <SpecEditorModal
        visible={specEditor.open}
        onClose={() => setSpecEditor({ open: false })}
        onSubmit={handleSpecSubmit}
        initial={{
          key: specEditor.key,
          value: specEditor.value,
          category: specEditor.category,
          photoPath: specEditor.photoPath ?? null,
        }}
        title={specEditor.id ? "Edit spec" : "Add spec"}
      />

      <NoteEditorModal
        visible={noteEditor.open}
        onClose={() => setNoteEditor({ open: false })}
        onSubmit={handleNoteSubmit}
        initial={{
          title: noteEditor.title,
          body: noteEditor.body,
          isPinned: noteEditor.isPinned,
          attachments: noteEditor.attachments ?? [],
        }}
        title={noteEditor.id ? "Edit note" : "Add note"}
      />

      <WorkOrderEditorModal
        visible={workOrderEditor.open}
        onClose={() => setWorkOrderEditor({ open: false })}
        onSubmit={handleWorkOrderSubmit}
        members={memberOptions}
        title={isCommercial && !canEdit ? "Request work" : "New work order"}
        showCommercialFields={isCommercial}
        assets={isCommercial ? assetOptions : []}
        approvalRequired={isCommercial && !canEdit}
      />

      <RecurringTasksManagerModal
        visible={recurringOpen}
        onClose={() => setRecurringOpen(false)}
        propertyId={propertyId}
        members={memberOptions}
      />
      <StandardEditorModal
        visible={standardEditor.open}
        onClose={() => setStandardEditor({ open: false })}
        onSubmit={handleStandardSubmit}
        initial={{
          title: standardEditor.title,
          description: standardEditor.description,
          cadenceDays: standardEditor.cadenceDays,
          evidenceType: standardEditor.evidenceType,
          keyword: standardEditor.keyword,
          quickPhrases: standardEditor.quickPhrases,
        }}
        title={standardEditor.id ? "Edit standard" : "Add standard"}
        pastNotes={standardEditorPastNotes}
      />

      <StandardNotePromptModal
        visible={notePrompt != null}
        standardTitle={notePrompt?.standardTitle}
        hasPhoto={!!notePrompt?.photoPath}
        submitting={submittingEvidence}
        suggestions={noteSuggestions}
        onClose={cancelStandardEvidence}
        onSubmit={submitStandardEvidence}
      />

      <StandardEvidenceHistoryModal
        visible={historyStandard != null}
        propertyId={propertyId}
        standardId={historyStandard?.id ?? null}
        standardTitle={historyStandard?.title ?? ""}
        nameByClerkId={memberNameByClerkId}
        currentUserClerkId={currentUserId}
        canManageAll={canEdit}
        onClose={() => setHistoryStandard(null)}
        onPhotoPress={(photos, index) => {
          if (!historyStandard) return;
          setHistoryPhotos({
            photos: photos.map((p) => ({
              url: p.url,
              addedAt: p.addedAt,
              evidenceId: p.evidenceId,
              storagePath: p.storagePath,
              canDelete: p.canDelete,
            })),
            index,
            standardId: historyStandard.id,
          });
        }}
      />

      {historyPhotos && (
        <PhotoViewer
          visible
          photos={historyPhotos.photos}
          initialIndex={historyPhotos.index}
          onClose={() => setHistoryPhotos(null)}
          shareContext={{ propertyName: property?.name }}
          onDeletePhoto={(item) => {
            if (!historyPhotos) return;
            requestDeleteEvidencePhoto(item, historyPhotos.standardId);
            setHistoryPhotos((prev) => {
              if (!prev) return prev;
              const remaining = prev.photos.filter(
                (p) =>
                  !(
                    p.evidenceId === item.evidenceId &&
                    p.storagePath === item.storagePath
                  ),
              );
              if (remaining.length === 0) return null;
              return {
                ...prev,
                photos: remaining,
                index: Math.min(prev.index, remaining.length - 1),
              };
            });
          }}
        />
      )}

      {logViewer && (
        <PhotoViewer
          visible
          photos={logViewer.photos}
          initialIndex={logViewer.index}
          onClose={() => setLogViewer(null)}
          onJumpToLog={handleJumpToLog}
          onJumpToWorkOrder={(workOrderId) =>
            router.push(`/work-order/${workOrderId}` as never)
          }
          shareContext={{ propertyName: property?.name }}
          onDeletePhoto={(item) => {
            requestDeletePhoto(item);
            setLogViewer((prev) => {
              if (!prev) return prev;
              const remaining = prev.photos.filter(
                (p) => !(p.logId === item.logId && p.storagePath === item.storagePath),
              );
              if (remaining.length === 0) return null;
              return {
                photos: remaining,
                index: Math.min(prev.index, remaining.length - 1),
              };
            });
          }}
        />
      )}

      <UndoSnackbar
        visible={!!pendingDeleteLog}
        message="Work log deleted"
        secondsLeft={undoSecondsLeft}
        onUndo={undoLogDelete}
      />

      <UndoSnackbar
        visible={!pendingDeleteLog && !!pendingDeletePhoto}
        message="Photo deleted"
        secondsLeft={photoUndoSecondsLeft}
        onUndo={undoPhotoDelete}
      />

      <UndoSnackbar
        visible={
          !pendingDeleteLog && !pendingDeletePhoto && !!pendingDeleteEvidencePhoto
        }
        message="Photo deleted"
        secondsLeft={evidencePhotoUndoSecondsLeft}
        onUndo={undoEvidencePhotoDelete}
      />
    </View>
  );
}

function buildLogPhotos(
  log: WorkLog,
  ctx: { currentUserClerkId: string | null; canManage: boolean },
): {
  photos: PhotoViewerItem[];
  primaryIndex: number;
  attachmentIndex: (path: string) => number;
} {
  const photos: PhotoViewerItem[] = [];
  let primaryIndex = -1;
  const addedByName = log.author?.name;
  const workOrderId = log.workOrderId ?? undefined;
  const canDelete =
    ctx.canManage || (!!ctx.currentUserClerkId && log.authorClerkId === ctx.currentUserClerkId);
  if (log.photoUrl) {
    const url = resolveStorageUrl(log.photoUrl) ?? log.photoUrl;
    if (url) {
      primaryIndex = photos.length;
      photos.push({
        url,
        addedAt: log.createdAt,
        addedByName,
        workOrderId,
        logId: log.id,
        storagePath: log.photoUrl,
        canDelete,
      });
    }
  }
  const attMap: Record<string, number> = {};
  for (const a of (log.attachments ?? []) as AttachmentItem[]) {
    if (a.kind !== "image") continue;
    const url = resolveStorageUrl(a.path);
    if (!url) continue;
    attMap[a.path] = photos.length;
    photos.push({
      url,
      addedAt: log.createdAt,
      addedByName,
      workOrderId,
      logId: log.id,
      storagePath: a.path,
      canDelete,
    });
  }
  return {
    photos,
    primaryIndex,
    attachmentIndex: (path: string) => attMap[path] ?? -1,
  };
}

function buildAllLogPhotos(
  logs: WorkLog[],
  ctx: {
    currentUserClerkId: string | null;
    canManage: boolean;
    workOrderPhotos?: PropertyWorkOrderPhoto[];
    nameByClerkId?: Record<string, string>;
  },
): {
  photos: PhotoViewerItem[];
  primaryIndexForLog: (logId: number) => number;
  attachmentIndexForLog: (logId: number, path: string) => number;
} {
  const photos: PhotoViewerItem[] = [];
  const primaryByLog: Record<number, number> = {};
  const attByLog: Record<number, Record<string, number>> = {};
  const seenStorage = new Set<string>();
  for (const log of logs) {
    const addedByName = log.author?.name;
    const logNote = log.note ?? undefined;
    const workOrderId = log.workOrderId ?? undefined;
    const canDelete =
      ctx.canManage || (!!ctx.currentUserClerkId && log.authorClerkId === ctx.currentUserClerkId);
    if (log.photoUrl) {
      const url = resolveStorageUrl(log.photoUrl) ?? log.photoUrl;
      if (url) {
        primaryByLog[log.id] = photos.length;
        seenStorage.add(log.photoUrl);
        photos.push({
          url,
          addedAt: log.createdAt,
          addedByName,
          logId: log.id,
          logNote,
          workOrderId,
          storagePath: log.photoUrl,
          canDelete,
        });
      }
    }
    const attMap: Record<string, number> = {};
    for (const a of (log.attachments ?? []) as AttachmentItem[]) {
      if (a.kind !== "image") continue;
      const url = resolveStorageUrl(a.path);
      if (!url) continue;
      attMap[a.path] = photos.length;
      seenStorage.add(a.path);
      photos.push({
        url,
        addedAt: log.createdAt,
        addedByName,
        logId: log.id,
        logNote,
        workOrderId,
        storagePath: a.path,
        canDelete,
      });
    }
    attByLog[log.id] = attMap;
  }
  for (const wp of ctx.workOrderPhotos ?? []) {
    if (!wp.path || seenStorage.has(wp.path)) continue;
    const url = resolveStorageUrl(wp.path);
    if (!url) continue;
    seenStorage.add(wp.path);
    const addedByName = wp.addedByClerkId
      ? ctx.nameByClerkId?.[wp.addedByClerkId]
      : undefined;
    photos.push({
      url,
      addedAt: wp.addedAt,
      addedByName,
      workOrderId: wp.workOrderId,
      storagePath: wp.path,
    });
  }
  return {
    photos,
    primaryIndexForLog: (logId) => (logId in primaryByLog ? primaryByLog[logId] : -1),
    attachmentIndexForLog: (logId, path) => attByLog[logId]?.[path] ?? -1,
  };
}

function StandardsTab({
  colors,
  standards,
  status,
  isLoading,
  canEdit,
  onAdd,
  onEdit,
  onDelete,
  onMarkMet,
  markingStandardId,
  onSnoozeStandard,
  onMutePropertyAlerts,
  propertyMutedUntil,
  onViewHistory,
  scrollViewRef,
  jumpToStandardId,
  onJumpHandled,
}: {
  colors: Colors;
  standards: PropertyStandard[];
  status: { items: StandardStatusItem[]; overdueCount: number; total: number } | undefined;
  isLoading: boolean;
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (s: PropertyStandard) => void;
  onDelete: (id: number) => void;
  onMarkMet: (standardId: number, withPhoto: boolean) => void;
  markingStandardId: number | null;
  onSnoozeStandard: (s: PropertyStandard) => void;
  onMutePropertyAlerts: () => void;
  propertyMutedUntil: string | Date | null;
  onViewHistory: (s: PropertyStandard) => void;
  scrollViewRef?: React.RefObject<ScrollView | null>;
  jumpToStandardId?: number | null;
  onJumpHandled?: () => void;
}) {
  const propertyMutedBadge = snoozeBadgeText(
    propertyMutedUntil ? new Date(propertyMutedUntil).toISOString() : null,
  );
  const statusByStandardId = useMemo(() => {
    const map: Record<number, StandardStatusItem> = {};
    status?.items.forEach((it) => {
      map[it.standard.id] = it;
    });
    return map;
  }, [status]);

  const containerYRef = useRef(0);
  const standardYRef = useRef<Record<number, number>>({});
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [highlightStandardId, setHighlightStandardId] = useState<number | null>(null);

  useEffect(() => {
    if (jumpToStandardId == null) return;
    if (isLoading) return;
    const exists = standards.some((s) => s.id === jumpToStandardId);
    if (!exists) return;
    const y = standardYRef.current[jumpToStandardId];
    if (y == null) return;
    const target = Math.max(0, containerYRef.current + y - 16);
    scrollViewRef?.current?.scrollTo({ y: target, animated: true });
    setHighlightStandardId(jumpToStandardId);
    onJumpHandled?.();
    const timer = setTimeout(() => setHighlightStandardId(null), 1600);
    return () => clearTimeout(timer);
  }, [jumpToStandardId, isLoading, standards, layoutVersion, scrollViewRef, onJumpHandled]);

  return (
    <View
      style={styles.tabContent}
      onLayout={(e) => {
        containerYRef.current = e.nativeEvent.layout.y;
        setLayoutVersion((v) => v + 1);
      }}
    >
      <View style={styles.tabHeaderRow}>
        <Text style={[styles.tabHeading, { color: colors.foreground }]}>Standards</Text>
        {canEdit && (
          <TouchableOpacity onPress={onAdd} style={[styles.addInlineBtn, { backgroundColor: colors.primary }]}>
            <Feather name="plus" size={14} color={colors.primaryForeground} />
            <Text style={[styles.addInlineText, { color: colors.primaryForeground }]}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      {canEdit && (
        <TouchableOpacity
          onPress={onMutePropertyAlerts}
          style={[
            styles.summaryCard,
            {
              backgroundColor: colors.card,
              borderColor: propertyMutedBadge ? colors.primary : colors.border,
              marginBottom: 12,
              padding: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            },
          ]}
        >
          <Feather
            name={propertyMutedBadge ? "bell-off" : "bell"}
            size={18}
            color={propertyMutedBadge ? colors.primary : colors.mutedForeground}
          />
          <View style={{ flex: 1 }}>
            <Text style={[styles.noteTitle, { color: colors.foreground }]}>
              {propertyMutedBadge ? "Standards alerts paused" : "Pause standards alerts"}
            </Text>
            <Text style={[styles.noteMeta, { color: colors.mutedForeground }]}>
              {propertyMutedBadge
                ? "Owners won't get pushes for any overdue standard. Tap to change."
                : "Mute overdue alerts for every standard on this property (e.g. during renovations)."}
            </Text>
          </View>
          {propertyMutedBadge ? (
            <View
              style={{
                paddingHorizontal: 8,
                paddingVertical: 2,
                borderRadius: 10,
                backgroundColor: colors.primary + "20",
              }}
            >
              <Text style={{ color: colors.primary, fontSize: 11, fontFamily: "Inter_700Bold" }}>
                {propertyMutedBadge}
              </Text>
            </View>
          ) : null}
        </TouchableOpacity>
      )}

      {status && status.total > 0 && (
        <View
          style={[
            styles.summaryCard,
            { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 16, padding: 14, flexDirection: "row", justifyContent: "space-between" },
          ]}
        >
          <View>
            <Text style={[styles.tabHeading, { color: colors.foreground, fontSize: 24 }]}>
              {status.total - status.overdueCount}/{status.total}
            </Text>
            <Text style={[styles.headerSub, { color: colors.mutedForeground, marginTop: 2 }]}>
              standards on track
            </Text>
          </View>
          {status.overdueCount > 0 ? (
            <View
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 14,
                backgroundColor: colors.destructive + "20",
                alignSelf: "center",
              }}
            >
              <Text style={[styles.tabText, { color: colors.destructive }]}>
                {status.overdueCount} overdue
              </Text>
            </View>
          ) : (
            <View
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 14,
                backgroundColor: colors.successBackground,
                alignSelf: "center",
              }}
            >
              <Text style={[styles.tabText, { color: colors.success }]}>All met</Text>
            </View>
          )}
        </View>
      )}

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : standards.length === 0 ? (
        <EmptyHint
          text={
            canEdit
              ? "Define quality standards (e.g. \"Pool checked weekly\") so the team knows what to maintain."
              : "No standards defined yet."
          }
          colors={colors}
        />
      ) : (
        standards.map((s) => {
          const st = statusByStandardId[s.id];
          const overdue = st?.overdue;
          const snoozeBadge = snoozeBadgeText(
            s.snoozeUntil ? new Date(s.snoozeUntil).toISOString() : null,
          );
          const isHighlighted = highlightStandardId === s.id;
          return (
            <TouchableOpacity
              key={s.id}
              onPress={() => onViewHistory(s)}
              onLongPress={() => canEdit && onDelete(s.id)}
              onLayout={(e) => {
                standardYRef.current[s.id] = e.nativeEvent.layout.y;
                setLayoutVersion((v) => v + 1);
              }}
              style={[
                styles.noteCard,
                {
                  backgroundColor: colors.card,
                  borderColor: isHighlighted
                    ? colors.primary
                    : overdue
                    ? colors.destructive
                    : colors.border,
                  borderWidth: isHighlighted ? 2 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <View style={styles.noteCardHeader}>
                <Text style={[styles.noteTitle, { color: colors.foreground, flex: 1 }]}>{s.title}</Text>
                {snoozeBadge ? (
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 10,
                      backgroundColor: colors.primary + "20",
                      marginRight: 6,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Feather name="bell-off" size={11} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontSize: 11, fontFamily: "Inter_700Bold" }}>
                      {snoozeBadge}
                    </Text>
                  </View>
                ) : null}
                {overdue ? (
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 10,
                      backgroundColor: colors.destructive + "20",
                    }}
                  >
                    <Text style={{ color: colors.destructive, fontSize: 11, fontFamily: "Inter_700Bold" }}>
                      OVERDUE
                    </Text>
                  </View>
                ) : st?.lastMetAt ? (
                  <View
                    style={{
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                      borderRadius: 10,
                      backgroundColor: colors.successBackground,
                    }}
                  >
                    <Text style={{ color: colors.success, fontSize: 11, fontFamily: "Inter_700Bold" }}>
                      ON TRACK
                    </Text>
                  </View>
                ) : null}
              </View>
              {s.description ? (
                <Text style={[styles.noteBody, { color: colors.foreground }]}>{s.description}</Text>
              ) : null}
              <Text style={[styles.noteMeta, { color: colors.mutedForeground }]}>
                Every {s.cadenceDays} {s.cadenceDays === 1 ? "day" : "days"} · {s.evidenceType}
                {s.keyword ? ` · keyword "${s.keyword}"` : ""}
              </Text>
              <Text style={[styles.noteMeta, { color: colors.mutedForeground }]}>
                {st?.lastMetAt
                  ? `Last met ${formatDate(st.lastMetAt)} (${st.daysSinceLastMet}d ago)`
                  : "No matching activity yet"}
              </Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation?.();
                    onViewHistory(s);
                  }}
                  style={[
                    styles.addInlineBtn,
                    {
                      backgroundColor: "transparent",
                      borderWidth: 1,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Feather name="clock" size={14} color={colors.foreground} />
                  <Text style={[styles.addInlineText, { color: colors.foreground }]}>
                    History
                  </Text>
                </TouchableOpacity>
                {canEdit && (
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation?.();
                      onEdit(s);
                    }}
                    style={[
                      styles.addInlineBtn,
                      {
                        backgroundColor: "transparent",
                        borderWidth: 1,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Feather name="edit-2" size={14} color={colors.foreground} />
                    <Text style={[styles.addInlineText, { color: colors.foreground }]}>
                      Edit
                    </Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation?.();
                    onMarkMet(s.id, true);
                  }}
                  disabled={markingStandardId === s.id}
                  style={[
                    styles.addInlineBtn,
                    {
                      backgroundColor: colors.primary,
                      opacity: markingStandardId === s.id ? 0.6 : 1,
                    },
                  ]}
                >
                  {markingStandardId === s.id ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Feather name="camera" size={14} color={colors.primaryForeground} />
                  )}
                  <Text style={[styles.addInlineText, { color: colors.primaryForeground }]}>
                    Mark met with photo
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={(e) => {
                    e.stopPropagation?.();
                    onMarkMet(s.id, false);
                  }}
                  disabled={markingStandardId === s.id}
                  style={[
                    styles.addInlineBtn,
                    {
                      backgroundColor: "transparent",
                      borderWidth: 1,
                      borderColor: colors.border,
                      opacity: markingStandardId === s.id ? 0.6 : 1,
                    },
                  ]}
                >
                  <Feather name="check" size={14} color={colors.foreground} />
                  <Text style={[styles.addInlineText, { color: colors.foreground }]}>
                    Mark met
                  </Text>
                </TouchableOpacity>
                {canEdit && (
                  <TouchableOpacity
                    onPress={(e) => {
                      e.stopPropagation?.();
                      onSnoozeStandard(s);
                    }}
                    style={[
                      styles.addInlineBtn,
                      {
                        backgroundColor: "transparent",
                        borderWidth: 1,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Feather
                      name={snoozeBadge ? "bell" : "bell-off"}
                      size={14}
                      color={colors.foreground}
                    />
                    <Text style={[styles.addInlineText, { color: colors.foreground }]}>
                      {snoozeBadge ? "Edit snooze" : "Snooze alerts"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </TouchableOpacity>
          );
        })
      )}
    </View>
  );
}

function SectionHeader({
  title,
  colors,
  action,
  onAction,
}: {
  title: string;
  colors: Colors;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>
        {title.toUpperCase()}
      </Text>
      {action && (
        <TouchableOpacity onPress={onAction}>
          <Text style={[styles.sectionAction, { color: colors.primary }]}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

type WorkTabProps = {
  colors: Colors;
  workOrders: WorkOrder[];
  isLoading: boolean;
  canManage: boolean;
  canAdd: boolean;
  unreadByOrder?: Record<number, number>;
  onAdd: () => void;
  onOpenRecurring: () => void;
  onPress: (wo: WorkOrder) => void;
};

const STATUS_TINT: Record<string, string> = {
  open: "#7A8A99",
  assigned: "#5687A8",
  in_progress: "#F59E0B",
  complete: "#5C8C75",
  verified: "#3F7059",
  cancelled: "#9CA3AF",
};

function WorkTab({ colors, workOrders, isLoading, canManage, canAdd, unreadByOrder, onAdd, onOpenRecurring, onPress }: WorkTabProps) {
  const active = workOrders.filter((w) => !["complete", "verified", "cancelled"].includes(w.status));
  const done = workOrders.filter((w) => ["complete", "verified", "cancelled"].includes(w.status));

  return (
    <View style={styles.tabContent}>
      <View style={styles.tabHeaderRow}>
        <Text style={[styles.tabHeading, { color: colors.foreground }]}>Work orders</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {canManage && (
            <TouchableOpacity onPress={onOpenRecurring} style={[styles.addInlineBtn, { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }]}>
              <Feather name="repeat" size={14} color={colors.foreground} />
              <Text style={[styles.addInlineText, { color: colors.foreground }]}>Recurring</Text>
            </TouchableOpacity>
          )}
          {canAdd && (
            <TouchableOpacity onPress={onAdd} style={[styles.addInlineBtn, { backgroundColor: colors.primary }]}>
              <Feather name="plus" size={14} color={colors.primaryForeground} />
              <Text style={[styles.addInlineText, { color: colors.primaryForeground }]}>
                {canManage ? "New" : "Request"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : workOrders.length === 0 ? (
        <EmptyHint
          text={
            canManage
              ? "No work orders yet — add one or set up a recurring task."
              : "No active work orders."
          }
          colors={colors}
        />
      ) : (
        <>
          {active.length > 0 && (
            <>
              <Text style={[styles.specGroupTitle, { color: colors.mutedForeground, marginTop: 16 }]}>
                ACTIVE
              </Text>
              {active.map((wo) => (
                <WorkOrderRow
                  key={wo.id}
                  wo={wo}
                  colors={colors}
                  unreadComments={unreadByOrder?.[wo.id] ?? 0}
                  onPress={() => onPress(wo)}
                />
              ))}
            </>
          )}
          {done.length > 0 && (
            <>
              <Text style={[styles.specGroupTitle, { color: colors.mutedForeground, marginTop: 18 }]}>
                COMPLETED
              </Text>
              {done.slice(0, 8).map((wo) => (
                <WorkOrderRow
                  key={wo.id}
                  wo={wo}
                  colors={colors}
                  unreadComments={unreadByOrder?.[wo.id] ?? 0}
                  onPress={() => onPress(wo)}
                />
              ))}
            </>
          )}
        </>
      )}
    </View>
  );
}

function SummaryRow({ label, value, colors }: { label: string; value: string; colors: Colors }) {
  return (
    <View style={[styles.summaryRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

function AddSectionCard({
  title,
  description,
  onPress,
  colors,
}: {
  title: string;
  description: string;
  onPress: () => void;
  colors: Colors;
}) {
  return (
    <TouchableOpacity
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      activeOpacity={0.85}
      style={[styles.addSectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={[styles.addSectionIcon, { backgroundColor: colors.primary + "20" }]}>
        <Feather name="plus" size={20} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.addSectionTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.addSectionDesc, { color: colors.mutedForeground }]}>{description}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

function EmptyHint({ text, colors }: { text: string; colors: Colors }) {
  return (
    <View style={[styles.emptyHint, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Feather name="info" size={16} color={colors.mutedForeground} />
      <Text style={[styles.emptyHintText, { color: colors.mutedForeground }]}>{text}</Text>
    </View>
  );
}

function WorkOrderRow({
  wo,
  colors,
  unreadComments = 0,
  onPress,
}: {
  wo: WorkOrder;
  colors: Colors;
  unreadComments?: number;
  onPress: () => void;
}) {
  const overdue =
    wo.dueDate &&
    !["complete", "verified", "cancelled"].includes(wo.status) &&
    new Date(wo.dueDate).getTime() < Date.now();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.workCard, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={[styles.workTitle, { color: colors.foreground, flexShrink: 1 }]} numberOfLines={1}>
            {wo.title}
          </Text>
          {unreadComments > 0 && (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 3,
                paddingHorizontal: 6,
                paddingVertical: 2,
                borderRadius: 999,
                backgroundColor: colors.primary,
              }}
              accessibilityLabel={`${unreadComments} unread ${unreadComments === 1 ? "comment" : "comments"}`}
            >
              <Feather name="message-circle" size={10} color={colors.primaryForeground} />
              <Text
                style={{
                  fontSize: 11,
                  fontFamily: "Inter_700Bold",
                  color: colors.primaryForeground,
                  minWidth: 8,
                  textAlign: "center",
                }}
              >
                {unreadComments > 99 ? "99+" : unreadComments}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.workMetaRow}>
          <View style={[styles.workStatusPill, { backgroundColor: (STATUS_TINT[wo.status] ?? colors.muted) + "22" }]}>
            <Text style={[styles.workStatusText, { color: STATUS_TINT[wo.status] ?? colors.foreground }]}>
              {wo.status.replace("_", " ")}
            </Text>
          </View>
          {wo.dueDate && (
            <Text style={[styles.workMetaText, { color: overdue ? "#B0413E" : colors.mutedForeground }]}>
              · due {formatDate(wo.dueDate)}
            </Text>
          )}
        </View>
        {(wo.assignee?.name || wo.createdBy?.name) && (
          <View style={{ marginTop: 4, gap: 2 }}>
            {wo.assignee?.name ? (
              <PersonLine
                label="Assigned"
                name={wo.assignee.name}
                tag={wo.assignee.connectionTag ?? null}
                colors={colors}
              />
            ) : null}
            {wo.createdBy?.name &&
            wo.createdBy.clerkId !== wo.assignee?.clerkId ? (
              <PersonLine
                label="Created by"
                name={wo.createdBy.name}
                tag={wo.createdBy.connectionTag ?? null}
                colors={colors}
              />
            ) : null}
          </View>
        )}
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </TouchableOpacity>
  );
}

// #545 — Tiny one-line "Label · Name" with the viewer's per-client
// tag (Service · Identity) stacked underneath. Used by the work order
// list cards so the assignee/createdBy carry the same context as the
// detail screen.
function PersonLine({
  label,
  name,
  tag,
  colors,
}: {
  label: string;
  name: string;
  tag: ConnectionTag;
  colors: Colors;
}) {
  return (
    <View>
      <Text style={[styles.workMetaText, { color: colors.mutedForeground }]} numberOfLines={1}>
        {label}: <Text style={{ color: colors.foreground }}>{name}</Text>
      </Text>
      <PerClientTagLine tag={tag} colors={colors} compact />
    </View>
  );
}

type OverviewTabProps = {
  colors: Colors;
  onboarding: PropertyOnboarding | undefined;
  property: PropertyWithMembers;
  logs: WorkLog[];
  canManage: boolean;
  standardsStatus: { items: StandardStatusItem[]; overdueCount: number; total: number } | undefined;
  onSeeAllSpecs: () => void;
  onSeeAllNotes: () => void;
  onSeeAllLogs: () => void;
  onSeeStandards: () => void;
  onStartCheckin: () => void;
  onAddSpec: () => void;
  onAddPinnedNote: () => void;
  onMarkDone: (log: WorkLog) => void;
  onAssign: (log: WorkLog, assigneeClerkId: string | null) => void;
  onSetDueDate: (log: WorkLog, dueDate: string | null) => void;
  onRespondDueDateRequest: (log: WorkLog, decision: "accept" | "decline", note?: string) => void;
  onOpenPhoto: (photos: PhotoViewerItem[], index: number) => void;
  onDeleteLog: (log: WorkLog) => void;
  currentUserClerkId: string | null | undefined;
};

function OverviewTab({
  colors,
  onboarding,
  property,
  logs,
  canManage,
  standardsStatus,
  onSeeAllSpecs,
  onSeeAllNotes,
  onSeeAllLogs,
  onSeeStandards,
  onStartCheckin,
  onAddSpec,
  onAddPinnedNote,
  onMarkDone,
  onAssign,
  onSetDueDate,
  onRespondDueDateRequest,
  onOpenPhoto,
  onDeleteLog,
  currentUserClerkId,
}: OverviewTabProps) {
  const specs = onboarding?.specs ?? [];
  const pinnedNotes = onboarding?.pinnedNotes ?? [];
  const recentLogs = logs.slice(0, 5);
  const overdueItems = (standardsStatus?.items ?? []).filter((it) => it.overdue);
  const hasCoordinates =
    typeof property.latitude === "number" &&
    Number.isFinite(property.latitude) &&
    typeof property.longitude === "number" &&
    Number.isFinite(property.longitude);
  const needsMapBackfill =
    canManage &&
    !!property.address &&
    property.address.trim().length > 0 &&
    !property.placeId &&
    property.latitude == null &&
    property.longitude == null;

  return (
    <View style={styles.tabContent}>
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 8 }}>
        <TouchableOpacity
          onPress={onStartCheckin}
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            paddingVertical: 14,
            borderRadius: 14,
            backgroundColor: colors.primary,
          }}
        >
          <Feather name="clipboard" size={16} color={colors.primaryForeground} />
          <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_700Bold", fontSize: 14 }}>
            Start Check-in
          </Text>
        </TouchableOpacity>
      </View>

      {needsMapBackfill && (
        <MapBackfillBanner propertyId={property.id} address={property.address} />
      )}

      {hasCoordinates && (
        <StaticMapPreview
          lat={property.latitude as number}
          lng={property.longitude as number}
          height={120}
        />
      )}

      {overdueItems.length > 0 && (
        <TouchableOpacity
          onPress={onSeeStandards}
          style={[
            styles.emptyHint,
            {
              backgroundColor: colors.destructive + "12",
              borderColor: colors.destructive + "40",
              marginTop: 8,
            },
          ]}
        >
          <Feather name="alert-triangle" size={18} color={colors.destructive} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.destructive, fontFamily: "Inter_700Bold", fontSize: 13 }}>
              {overdueItems.length} standard{overdueItems.length === 1 ? "" : "s"} overdue
            </Text>
            <Text style={[styles.emptyHintText, { color: colors.foreground }]} numberOfLines={2}>
              {overdueItems
                .slice(0, 2)
                .map((i) => i.standard.title)
                .join(" · ")}
              {overdueItems.length > 2 ? "…" : ""}
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.destructive} />
        </TouchableOpacity>
      )}

      <SectionHeader title="Specs" colors={colors} action={specs.length > 0 ? "See all" : undefined} onAction={onSeeAllSpecs} />
      {specs.length === 0 ? (
        canManage ? (
          <AddSectionCard
            title="Add Specs"
            description="Paint colors, materials, appliances"
            onPress={onAddSpec}
            colors={colors}
          />
        ) : (
          <EmptyHint text="No specs yet." colors={colors} />
        )
      ) : (
        <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {specs.slice(0, 4).map((s) => (
            <SummaryRow key={s.id} label={s.key} value={s.value || "—"} colors={colors} />
          ))}
        </View>
      )}

      <SectionHeader title="Recent Work" colors={colors} />
      {!recentLogs.length ? (
        canManage ? (
          <AddSectionCard
            title="Add Work Log"
            description="Photos, notes, receipts"
            onPress={onStartCheckin}
            colors={colors}
          />
        ) : (
          <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No work logs yet.</Text>
          </View>
        )
      ) : (
        recentLogs.map((log) => (
          <LogItem
            key={log.id}
            log={log}
            colors={colors}
            members={property.members}
            canManage={canManage}
            currentUserClerkId={currentUserClerkId}
            onMarkDone={() => onMarkDone(log)}
            onAssign={(uid) => onAssign(log, uid)}
            onSetDueDate={(d) => onSetDueDate(log, d)}
            onRespondDueDateRequest={(decision, note) => onRespondDueDateRequest(log, decision, note)}
            onOpenPhoto={onOpenPhoto}
            onDelete={() => onDeleteLog(log)}
          />
        ))
      )}

      <SectionHeader title="Pinned Notes" colors={colors} action={pinnedNotes.length > 0 ? "See all" : undefined} onAction={onSeeAllNotes} />
      {pinnedNotes.length === 0 ? (
        canManage ? (
          <AddSectionCard
            title="Add Pinned Note"
            description="Important job instructions"
            onPress={onAddPinnedNote}
            colors={colors}
          />
        ) : (
          <EmptyHint text="No pinned notes yet." colors={colors} />
        )
      ) : (
        pinnedNotes.slice(0, 2).map((n) => (
          <View key={n.id} style={[styles.noteCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {n.title ? <Text style={[styles.noteTitle, { color: colors.foreground }]}>{n.title}</Text> : null}
            <Text style={[styles.noteBody, { color: colors.foreground }]} numberOfLines={4}>
              {n.body}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

function LogItem({
  log,
  colors,
  members,
  canManage,
  currentUserClerkId,
  onMarkDone,
  onAssign,
  onSetDueDate,
  onRespondDueDateRequest,
  onOpenPhoto,
  onDelete,
}: {
  log: WorkLog;
  colors: Colors;
  members: PropertyMember[];
  canManage: boolean;
  currentUserClerkId: string | null | undefined;
  onMarkDone: () => void;
  onAssign: (userId: string | null) => void;
  onSetDueDate: (dueDate: string | null) => void;
  onRespondDueDateRequest: (decision: "accept" | "decline", note?: string) => void;
  onOpenPhoto: (photos: PhotoViewerItem[], index: number) => void;
  onDelete: () => void;
}) {
  const canDelete = canManage || (!!currentUserClerkId && log.authorClerkId === currentUserClerkId);
  const [showAssign, setShowAssign] = useState(false);
  const [showDue, setShowDue] = useState(false);
  const [dueCalendarOpen, setDueCalendarOpen] = useState(false);
  const [responseNote, setResponseNote] = useState("");
  const assignee = members.find((m) => m.userClerkId === log.assigneeClerkId);
  const built = buildLogPhotos(log, {
    currentUserClerkId: currentUserClerkId ?? null,
    canManage,
  });
  const dueLabel = formatDueChip(log.dueDate);
  const hasPendingRequest = !!log.dueDateRequestedDate;
  const requester = hasPendingRequest
    ? members.find((m) => m.userClerkId === log.dueDateRequestedByClerkId)
    : undefined;
  const proposedLabel = log.dueDateRequestedDate
    ? new Date(log.dueDateRequestedDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })
    : "";

  return (
    <View style={[styles.logCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.logHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.logNote, { color: colors.foreground }]}>{log.note}</Text>
          <Text style={[styles.logMeta, { color: colors.mutedForeground }]}>
            {log.author?.name} · {timeAgo(log.createdAt)}
          </Text>
          {log.photoUrl ? (
            <Pressable
              onPress={() => built.primaryIndex >= 0 && onOpenPhoto(built.photos, built.primaryIndex)}
              style={({ pressed }) => [{ marginTop: 8 }, pressed && { opacity: 0.85 }]}
            >
              <PhotoPreview path={log.photoUrl} size={140} note={log.note} />
            </Pressable>
          ) : null}
          {log.attachments && log.attachments.length > 0 ? (
            <AttachmentList
              attachments={log.attachments as AttachmentItem[]}
              size="sm"
              note={log.note}
              onImagePress={(att) => {
                const i = built.attachmentIndex(att.path);
                if (i >= 0) onOpenPhoto(built.photos, i);
              }}
            />
          ) : null}
        </View>
        {log.status !== "done" && (
          <TouchableOpacity
            onPress={onMarkDone}
            style={[styles.doneBtn, { backgroundColor: colors.primary + "15" }]}
          >
            <Text style={[styles.doneBtnText, { color: colors.primary }]}>Done</Text>
          </TouchableOpacity>
        )}
        {log.status === "done" && (
          <View style={[styles.doneBadge, { backgroundColor: colors.scoreBackground }]}>
            <Feather name="check" size={12} color={colors.primary} />
          </View>
        )}
        {canDelete && (
          <TouchableOpacity
            onPress={onDelete}
            hitSlop={10}
            style={styles.deleteLogBtn}
            accessibilityLabel="Delete work log"
          >
            <Feather name="trash-2" size={16} color={colors.destructive} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.logFooter}>
        <TouchableOpacity
          onPress={() => canManage && setShowAssign(!showAssign)}
          style={[
            styles.assigneeChip,
            { backgroundColor: colors.background, borderColor: colors.border },
          ]}
        >
          <Feather
            name="user"
            size={12}
            color={assignee ? colors.primary : colors.mutedForeground}
          />
          <Text
            style={[
              styles.assigneeText,
              { color: assignee ? colors.foreground : colors.mutedForeground },
            ]}
          >
            {assignee?.user?.name || "Unassigned"}
          </Text>
        </TouchableOpacity>

        {(log.assigneeClerkId || log.dueDate) && (
          <TouchableOpacity
            disabled={!canManage}
            onPress={() => canManage && setShowDue(!showDue)}
            style={[
              styles.assigneeChip,
              {
                backgroundColor: colors.background,
                borderColor: dueLabel.tone === "overdue" ? "#B3261E" : colors.border,
              },
            ]}
          >
            <Feather
              name={dueLabel.tone === "overdue" ? "alert-circle" : "clock"}
              size={12}
              color={
                dueLabel.tone === "overdue"
                  ? "#B3261E"
                  : log.dueDate
                  ? colors.primary
                  : colors.mutedForeground
              }
            />
            <Text
              style={[
                styles.assigneeText,
                {
                  color:
                    dueLabel.tone === "overdue"
                      ? "#B3261E"
                      : log.dueDate
                      ? colors.foreground
                      : colors.mutedForeground,
                },
              ]}
            >
              {dueLabel.label}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {showDue && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.assignPicker}>
          {DUE_PRESETS.map((p) => {
            const iso = p.days == null ? null : isoFromDays(p.days);
            return (
              <TouchableOpacity
                key={p.label}
                onPress={() => {
                  onSetDueDate(iso);
                  setShowDue(false);
                }}
                style={[styles.pickerChip, { borderColor: colors.border }]}
              >
                <Text style={[styles.pickerText, { color: colors.foreground }]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            onPress={() => {
              setShowDue(false);
              setDueCalendarOpen(true);
            }}
            style={[styles.pickerChip, { borderColor: colors.primary }]}
          >
            <Text style={[styles.pickerText, { color: colors.primary }]}>
              Pick a date…
            </Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      <DueDatePickerModal
        visible={dueCalendarOpen}
        onClose={() => setDueCalendarOpen(false)}
        onApply={(iso) => onSetDueDate(iso)}
        onClear={() => onSetDueDate(null)}
        initialDate={log.dueDate ?? null}
      />


      {hasPendingRequest && (
        <View
          style={{
            marginTop: 10,
            padding: 10,
            borderWidth: 1,
            borderRadius: 10,
            borderColor: colors.primary + "55",
            backgroundColor: colors.primary + "10",
            gap: 8,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Feather name="clock" size={12} color={colors.primary} />
            <Text style={{ color: colors.primary, fontFamily: "Inter_700Bold", fontSize: 12, flex: 1 }}>
              {requester?.user?.name || "Assignee"} proposed {proposedLabel}
            </Text>
          </View>
          {log.dueDateRequestedReason ? (
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_400Regular",
                fontSize: 12,
                fontStyle: "italic",
              }}
            >
              “{log.dueDateRequestedReason}”
            </Text>
          ) : null}
          {canManage && (
            <>
              <TextInput
                value={responseNote}
                onChangeText={setResponseNote}
                placeholder="Reply with an optional note (e.g. let's do Friday instead)"
                placeholderTextColor={colors.mutedForeground}
                maxLength={280}
                multiline
                style={{
                  borderWidth: 1,
                  borderRadius: 8,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  color: colors.foreground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 12,
                  paddingHorizontal: 10,
                  paddingVertical: 8,
                  minHeight: 36,
                }}
                accessibilityLabel="Optional note for accepting or declining the reschedule"
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <TouchableOpacity
                  onPress={() => {
                    onRespondDueDateRequest("accept", responseNote);
                    setResponseNote("");
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: 8,
                    alignItems: "center",
                    backgroundColor: colors.primary,
                  }}
                >
                  <Text
                    style={{ color: colors.primaryForeground, fontFamily: "Inter_700Bold", fontSize: 12 }}
                  >
                    Accept
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    onRespondDueDateRequest("decline", responseNote);
                    setResponseNote("");
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: 8,
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: colors.border,
                    backgroundColor: colors.background,
                  }}
                >
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 12 }}>
                    Decline
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      )}

      {!hasPendingRequest && log.dueDateResponseNote ? (
        <View
          style={{
            marginTop: 10,
            padding: 10,
            borderWidth: 1,
            borderRadius: 10,
            borderColor: colors.border,
            backgroundColor: colors.muted,
            gap: 6,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Feather name="message-circle" size={12} color={colors.mutedForeground} />
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 12,
              }}
            >
              Owner replied
            </Text>
          </View>
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              fontStyle: "italic",
            }}
          >
            “{log.dueDateResponseNote}”
          </Text>
        </View>
      ) : null}

      {showAssign && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.assignPicker}>
          <TouchableOpacity
            onPress={() => {
              onAssign(null);
              setShowAssign(false);
            }}
            style={[styles.pickerChip, { borderColor: colors.border }]}
          >
            <Text style={[styles.pickerText, { color: colors.mutedForeground }]}>None</Text>
          </TouchableOpacity>
          {members
            .filter((m) => !m.archivedAt)
            .map((m) => (
              <TouchableOpacity
                key={m.userClerkId}
                onPress={() => {
                  onAssign(m.userClerkId);
                  setShowAssign(false);
                }}
                style={[
                  styles.pickerChip,
                  {
                    borderColor: log.assigneeClerkId === m.userClerkId ? colors.primary : colors.border,
                    backgroundColor: log.assigneeClerkId === m.userClerkId ? colors.primary + "10" : "transparent",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.pickerText,
                    { color: log.assigneeClerkId === m.userClerkId ? colors.primary : colors.foreground },
                  ]}
                >
                  {m.user?.name}
                </Text>
              </TouchableOpacity>
            ))}
        </ScrollView>
      )}
    </View>
  );
}

function TeamTab({
  colors,
  members,
  onSelect,
  onAdd,
  canManage,
}: {
  colors: Colors;
  members: PropertyMember[];
  onSelect: (m: PropertyMember) => void;
  onAdd: () => void;
  canManage: boolean;
}) {
  return (
    <View style={styles.tabContent}>
      <View style={styles.tabHeaderRow}>
        <Text style={[styles.tabHeading, { color: colors.foreground }]}>Active Team</Text>
        {canManage && (
          <TouchableOpacity
            onPress={onAdd}
            style={[styles.addInlineBtn, { backgroundColor: colors.primary }]}
          >
            <Feather name="plus" size={14} color={colors.primaryForeground} />
            <Text style={[styles.addInlineText, { color: colors.primaryForeground }]}>Add</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.memberGrid}>
        {members.map((m) => (
          <TouchableOpacity
            key={m.userClerkId}
            onPress={() => onSelect(m)}
            style={[styles.memberCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={[styles.memberAvatar, { backgroundColor: colors.primary + "20" }]}>
              <Text style={[styles.avatarText, { color: colors.primary }]}>
                {(m.user?.name || "?")[0].toUpperCase()}
              </Text>
            </View>
            <Text style={[styles.memberName, { color: colors.foreground }]} numberOfLines={1}>
              {m.user?.name}
            </Text>
            {m.tradeType && (
              <Text style={[styles.memberTrade, { color: colors.mutedForeground }]} numberOfLines={1}>
                {m.tradeType}
              </Text>
            )}
            <View style={styles.memberStats}>
              <RatingStars value={m.avgRating ?? 0} size={10} />
              <Text style={[styles.memberCount, { color: colors.mutedForeground }]}>
                ({m.jobCount ?? 0})
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

type RosterSort = "rating" | "response" | "jobs";
const LOW_RATING_THRESHOLD = 3;

function formatResponseMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  const days = hours / 24;
  return `${days.toFixed(days < 10 ? 1 : 0)}d`;
}

function RosterTab({
  colors,
  active,
  archived,
  onSelect,
}: {
  colors: Colors;
  active: PropertyMember[];
  archived: PropertyMember[];
  onSelect: (m: PropertyMember) => void;
}) {
  const [tradeFilter, setTradeFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<RosterSort>("rating");

  const trades = useMemo(() => {
    const set = new Set<string>();
    for (const m of active) {
      const t = (m.tradeType || "").trim();
      if (t) set.add(t);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [active]);

  const filteredActive = useMemo(() => {
    const base = tradeFilter
      ? active.filter((m) => (m.tradeType || "").trim() === tradeFilter)
      : active;
    const sorted = [...base].sort((a, b) => {
      if (sort === "rating") {
        const av = a.avgRating ?? -1;
        const bv = b.avgRating ?? -1;
        if (av !== bv) return bv - av;
        return (b.ratingCount ?? 0) - (a.ratingCount ?? 0);
      }
      if (sort === "response") {
        const av = a.avgResponseMinutes ?? Number.POSITIVE_INFINITY;
        const bv = b.avgResponseMinutes ?? Number.POSITIVE_INFINITY;
        if (av !== bv) return av - bv;
        return (b.jobCount ?? 0) - (a.jobCount ?? 0);
      }
      return (b.jobCount ?? 0) - (a.jobCount ?? 0);
    });
    return sorted;
  }, [active, tradeFilter, sort]);

  const insights = useMemo(() => {
    const rated = active.filter((m) => (m.ratingCount ?? 0) > 0 && m.avgRating != null);
    const topRated = rated.length
      ? rated.reduce((best, cur) => ((cur.avgRating ?? 0) > (best.avgRating ?? 0) ? cur : best))
      : null;
    const responders = active.filter(
      (m) => m.avgResponseMinutes != null && Number.isFinite(m.avgResponseMinutes),
    );
    const fastest = responders.length
      ? responders.reduce((best, cur) =>
          (cur.avgResponseMinutes ?? Infinity) < (best.avgResponseMinutes ?? Infinity) ? cur : best,
        )
      : null;
    const underperformers = rated.filter((m) => (m.avgRating ?? 0) < LOW_RATING_THRESHOLD);
    return { topRated, fastest, underperformers };
  }, [active]);

  const hasAnyStats =
    active.some((m) => (m.ratingCount ?? 0) > 0 || m.avgResponseMinutes != null);

  return (
    <View style={styles.tabContent}>
      {active.length === 0 ? (
        <EmptyHint text="No providers on this roster yet." colors={colors} />
      ) : (
        <>
          <View style={styles.insightsRow}>
            <InsightCard
              colors={colors}
              icon="star"
              label="Top rated"
              value={
                insights.topRated
                  ? insights.topRated.user?.name || "—"
                  : "No ratings yet"
              }
              detail={
                insights.topRated && insights.topRated.avgRating != null
                  ? `${insights.topRated.avgRating.toFixed(1)} ★ · ${insights.topRated.ratingCount} ratings`
                  : "Rate jobs to surface a leader"
              }
              tint={colors.primary}
            />
            <InsightCard
              colors={colors}
              icon="zap"
              label="Fastest"
              value={insights.fastest ? insights.fastest.user?.name || "—" : "No data"}
              detail={
                insights.fastest && insights.fastest.avgResponseMinutes != null
                  ? `${formatResponseMinutes(insights.fastest.avgResponseMinutes)} avg`
                  : "Mark jobs done to track speed"
              }
              tint={colors.primary}
            />
            <InsightCard
              colors={colors}
              icon="alert-triangle"
              label="Watchlist"
              value={
                insights.underperformers.length > 0
                  ? `${insights.underperformers.length} below ${LOW_RATING_THRESHOLD}★`
                  : "All on track"
              }
              detail={
                insights.underperformers.length > 0
                  ? insights.underperformers
                      .slice(0, 2)
                      .map((m) => m.user?.name || "Member")
                      .join(", ")
                  : "No providers under threshold"
              }
              tint={
                insights.underperformers.length > 0 ? "#F59E0B" : colors.mutedForeground
              }
            />
          </View>

          {!hasAnyStats && (
            <View
              style={[
                styles.rosterEmptyHint,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
            >
              <Feather name="info" size={14} color={colors.mutedForeground} />
              <Text style={[styles.emptyHintTextSmall, { color: colors.mutedForeground }]}>
                Stats appear once jobs are completed and rated.
              </Text>
            </View>
          )}

          {trades.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipScroll}
              style={{ marginTop: 12, flexGrow: 0 }}
            >
              <RosterChip
                colors={colors}
                label="All trades"
                active={tradeFilter === null}
                onPress={() => setTradeFilter(null)}
              />
              {trades.map((t) => (
                <RosterChip
                  key={t}
                  colors={colors}
                  label={t}
                  active={tradeFilter === t}
                  onPress={() => setTradeFilter(t)}
                />
              ))}
            </ScrollView>
          )}

          <View style={styles.sortRow}>
            <Text style={[styles.sortLabel, { color: colors.mutedForeground }]}>Sort by</Text>
            <View style={styles.sortGroup}>
              {(
                [
                  { key: "rating", label: "Rating" },
                  { key: "response", label: "Speed" },
                  { key: "jobs", label: "Jobs" },
                ] as { key: RosterSort; label: string }[]
              ).map((opt) => {
                const isActive = sort === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setSort(opt.key);
                    }}
                    style={[
                      styles.sortBtn,
                      {
                        borderColor: isActive ? colors.primary : colors.border,
                        backgroundColor: isActive ? colors.primary : "transparent",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.sortBtnText,
                        { color: isActive ? colors.primaryForeground : colors.foreground },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 16 }]}>
            ACTIVE PROVIDERS · {filteredActive.length}
          </Text>
          {filteredActive.length === 0 ? (
            <View
              style={[
                styles.rosterEmptyHint,
                { borderColor: colors.border, backgroundColor: colors.card, marginTop: 8 },
              ]}
            >
              <Feather name="filter" size={14} color={colors.mutedForeground} />
              <Text style={[styles.emptyHintTextSmall, { color: colors.mutedForeground }]}>
                No providers match this trade. Clear the filter to see everyone.
              </Text>
            </View>
          ) : (
            <View style={styles.rosterList}>
              {filteredActive.map((m) => {
                const isWatch = insights.underperformers.some(
                  (u) => u.userClerkId === m.userClerkId,
                );
                return (
                  <RosterRow
                    key={m.userClerkId}
                    member={m}
                    colors={colors}
                    onPress={() => onSelect(m)}
                    sort={sort}
                    flagged={isWatch}
                  />
                );
              })}
            </View>
          )}
        </>
      )}

      {archived.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 24 }]}>
            ARCHIVED
          </Text>
          <View style={styles.rosterList}>
            {archived.map((m) => (
              <RosterRow
                key={m.userClerkId}
                member={m}
                colors={colors}
                onPress={() => onSelect(m)}
                archived
                sort="rating"
              />
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function RosterChip({
  colors,
  label,
  active,
  onPress,
}: {
  colors: Colors;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      style={[
        styles.tradeChip,
        {
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? colors.primary + "18" : "transparent",
        },
      ]}
    >
      <Text
        style={[
          styles.tradeChipText,
          { color: active ? colors.primary : colors.foreground },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function InsightCard({
  colors,
  icon,
  label,
  value,
  detail,
  tint,
}: {
  colors: Colors;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  detail: string;
  tint: string;
}) {
  return (
    <View
      style={[
        styles.insightCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.insightHeader}>
        <Feather name={icon} size={12} color={tint} />
        <Text style={[styles.insightLabel, { color: colors.mutedForeground }]}>
          {label.toUpperCase()}
        </Text>
      </View>
      <Text
        style={[styles.insightValue, { color: colors.foreground }]}
        numberOfLines={1}
      >
        {value}
      </Text>
      <Text
        style={[styles.insightDetail, { color: colors.mutedForeground }]}
        numberOfLines={2}
      >
        {detail}
      </Text>
    </View>
  );
}

function RosterRow({
  member,
  colors,
  onPress,
  archived,
  sort = "rating",
  flagged,
}: {
  member: PropertyMember;
  colors: Colors;
  onPress: () => void;
  archived?: boolean;
  sort?: RosterSort;
  flagged?: boolean;
}) {
  const showResponse = sort === "response";
  const showJobs = sort === "jobs";
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.rosterRow, { borderBottomColor: colors.border, opacity: archived ? 0.6 : 1 }]}
    >
      <View style={[styles.rowAvatar, { backgroundColor: colors.muted }]}>
        <Text style={[styles.rowAvatarText, { color: colors.mutedForeground }]}>
          {(member.user?.name || "?")[0].toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
            {member.user?.name}
          </Text>
          {flagged && !archived && (
            <View style={[styles.flagPill, { backgroundColor: "#F59E0B22" }]}>
              <Feather name="alert-triangle" size={10} color="#F59E0B" />
              <Text style={[styles.flagPillText, { color: "#F59E0B" }]}>Watch</Text>
            </View>
          )}
        </View>
        <Text style={[styles.rowMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
          {member.tradeType || "Member"}
          {member.companyName ? ` · ${member.companyName}` : ""}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        {showResponse ? (
          <>
            <Text style={[styles.rowPrimaryStat, { color: colors.foreground }]}>
              {formatResponseMinutes(member.avgResponseMinutes)}
            </Text>
            <Text style={[styles.rowJobs, { color: colors.mutedForeground }]}>avg response</Text>
          </>
        ) : showJobs ? (
          <>
            <Text style={[styles.rowPrimaryStat, { color: colors.foreground }]}>
              {member.jobCount ?? 0}
            </Text>
            <Text style={[styles.rowJobs, { color: colors.mutedForeground }]}>jobs</Text>
          </>
        ) : (
          <>
            <RatingStars value={member.avgRating ?? 0} size={12} />
            <Text style={[styles.rowJobs, { color: colors.mutedForeground }]}>
              {member.ratingCount > 0
                ? `${(member.avgRating ?? 0).toFixed(1)} · ${member.jobCount ?? 0} jobs`
                : `${member.jobCount ?? 0} jobs · no ratings`}
            </Text>
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

type KnowledgeTabProps = {
  colors: Colors;
  specs: PropertySpec[];
  isLoading: boolean;
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (spec: PropertySpec) => void;
  onDelete: (specId: number) => void;
};

function KnowledgeTab({ colors, specs, isLoading, canEdit, onAdd, onEdit, onDelete }: KnowledgeTabProps) {
  const grouped = useMemo(() => {
    return specs.reduce<Record<string, PropertySpec[]>>((acc, s) => {
      const cat = s.category || "general";
      (acc[cat] ||= []).push(s);
      return acc;
    }, {});
  }, [specs]);

  return (
    <View style={styles.tabContent}>
      <View style={styles.tabHeaderRow}>
        <Text style={[styles.tabHeading, { color: colors.foreground }]}>Knowledge base</Text>
        {canEdit && (
          <TouchableOpacity onPress={onAdd} style={[styles.addInlineBtn, { backgroundColor: colors.primary }]}>
            <Feather name="plus" size={14} color={colors.primaryForeground} />
            <Text style={[styles.addInlineText, { color: colors.primaryForeground }]}>Add spec</Text>
          </TouchableOpacity>
        )}
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : specs.length === 0 ? (
        <EmptyHint
          text={
            canEdit
              ? "Tap Add spec to record paint colors, appliance models, materials."
              : "No specs recorded yet."
          }
          colors={colors}
        />
      ) : (
        Object.entries(grouped).map(([cat, items]) => (
          <View key={cat} style={{ marginTop: 16 }}>
            <Text style={[styles.specGroupTitle, { color: colors.mutedForeground }]}>
              {cat.toUpperCase()}
            </Text>
            <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {items.map((s, idx) => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => canEdit && onEdit(s)}
                  onLongPress={() => canEdit && onDelete(s.id)}
                  style={[
                    styles.summaryColumn,
                    idx === items.length - 1 && { borderBottomWidth: 0 },
                    { borderBottomColor: colors.border },
                  ]}
                >
                  <View style={styles.summaryTopRow}>
                    <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{s.key}</Text>
                    <Text style={[styles.summaryValue, { color: colors.foreground }]}>
                      {s.value || "—"}
                    </Text>
                  </View>
                  {s.photoPath ? <PhotoPreview path={s.photoPath} size={88} /> : null}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))
      )}
    </View>
  );
}

type NotesTabProps = {
  colors: Colors;
  notes: PropertyNote[];
  isLoading: boolean;
  canEdit: boolean;
  onAdd: () => void;
  onEdit: (note: PropertyNote) => void;
  onDelete: (noteId: number) => void;
};

function NotesTab({ colors, notes, isLoading, canEdit, onAdd, onEdit, onDelete }: NotesTabProps) {
  return (
    <View style={styles.tabContent}>
      <View style={styles.tabHeaderRow}>
        <Text style={[styles.tabHeading, { color: colors.foreground }]}>Notes</Text>
        {canEdit && (
          <TouchableOpacity onPress={onAdd} style={[styles.addInlineBtn, { backgroundColor: colors.primary }]}>
            <Feather name="plus" size={14} color={colors.primaryForeground} />
            <Text style={[styles.addInlineText, { color: colors.primaryForeground }]}>New note</Text>
          </TouchableOpacity>
        )}
      </View>
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      ) : notes.length === 0 ? (
        <EmptyHint
          text={canEdit ? "Add a note for yourself or the team." : "No notes yet."}
          colors={colors}
        />
      ) : (
        notes.map((n) => (
          <TouchableOpacity
            key={n.id}
            onPress={() => canEdit && onEdit(n)}
            onLongPress={() => canEdit && onDelete(n.id)}
            style={[styles.noteCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={styles.noteCardHeader}>
              {n.title ? (
                <Text style={[styles.noteTitle, { color: colors.foreground }]}>{n.title}</Text>
              ) : null}
              {n.isPinned && <Feather name="map-pin" size={12} color={colors.primary} />}
            </View>
            <Text style={[styles.noteBody, { color: colors.foreground }]}>{n.body}</Text>
            {n.attachments && n.attachments.length > 0 ? (
              <AttachmentList attachments={n.attachments as AttachmentItem[]} />
            ) : null}
            <Text style={[styles.noteMeta, { color: colors.mutedForeground }]}>
              {n.author?.name || "Member"} · {formatDate(n.createdAt)}
            </Text>
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

function LogsTab({
  colors,
  logs,
  members,
  canManage,
  currentUserClerkId,
  isLoading,
  onOpenPhoto,
  scrollViewRef,
  jumpToLogId,
  onJumpHandled,
  onRespondDueDateRequest,
  onDeleteLog,
  workOrderPhotos,
  nameByClerkId,
}: {
  colors: Colors;
  logs: WorkLog[];
  members: PropertyMember[];
  canManage: boolean;
  currentUserClerkId: string | null | undefined;
  isLoading: boolean;
  onOpenPhoto: (photos: PhotoViewerItem[], index: number) => void;
  scrollViewRef?: React.RefObject<ScrollView | null>;
  jumpToLogId?: number | null;
  onJumpHandled?: () => void;
  onRespondDueDateRequest: (log: WorkLog, decision: "accept" | "decline", note?: string) => void;
  onDeleteLog: (log: WorkLog) => void;
  workOrderPhotos?: PropertyWorkOrderPhoto[];
  nameByClerkId?: Record<string, string>;
}) {
  const allPhotos = useMemo(
    () =>
      buildAllLogPhotos(logs, {
        currentUserClerkId: currentUserClerkId ?? null,
        canManage,
        workOrderPhotos,
        nameByClerkId,
      }),
    [logs, currentUserClerkId, canManage, workOrderPhotos, nameByClerkId],
  );
  const containerYRef = useRef(0);
  const logYRef = useRef<Record<number, number>>({});
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [highlightLogId, setHighlightLogId] = useState<number | null>(null);
  const [responseNoteByLogId, setResponseNoteByLogId] = useState<Record<number, string>>({});

  useEffect(() => {
    if (jumpToLogId == null) return;
    if (isLoading) return;
    const exists = logs.some((l) => l.id === jumpToLogId);
    if (!exists) return;
    const y = logYRef.current[jumpToLogId];
    if (y == null) return;
    const target = Math.max(0, containerYRef.current + y - 16);
    scrollViewRef?.current?.scrollTo({ y: target, animated: true });
    setHighlightLogId(jumpToLogId);
    onJumpHandled?.();
    const timer = setTimeout(() => setHighlightLogId(null), 1600);
    return () => clearTimeout(timer);
  }, [jumpToLogId, isLoading, logs, layoutVersion, scrollViewRef, onJumpHandled]);

  if (isLoading) return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;
  return (
    <View
      style={styles.tabContent}
      onLayout={(e) => {
        containerYRef.current = e.nativeEvent.layout.y;
        setLayoutVersion((v) => v + 1);
      }}
    >
      <Text style={[styles.tabHeading, { color: colors.foreground, marginBottom: 16 }]}>Work Logs</Text>
      {logs.length === 0 ? (
        <EmptyHint text="No work logs yet." colors={colors} />
      ) : (
        logs.map((log) => {
          const isHighlighted = highlightLogId === log.id;
          const hasPendingRequest = !!log.dueDateRequestedDate;
          const requester = hasPendingRequest
            ? members.find((m) => m.userClerkId === log.dueDateRequestedByClerkId)
            : undefined;
          const proposedLabel = log.dueDateRequestedDate
            ? new Date(log.dueDateRequestedDate).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })
            : "";
          return (
            <View
              key={log.id}
              onLayout={(e) => {
                logYRef.current[log.id] = e.nativeEvent.layout.y;
                setLayoutVersion((v) => v + 1);
              }}
              style={[
                styles.logCardSmall,
                {
                  backgroundColor: colors.card,
                  borderColor: isHighlighted ? colors.primary : colors.border,
                  borderWidth: isHighlighted ? 2 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <View style={styles.logHeaderRowSmall}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.logNoteSmall, { color: colors.foreground }]}>{log.note}</Text>
                  <Text style={[styles.logMetaSmall, { color: colors.mutedForeground }]}>
                    {log.author?.name || "Member"} · {formatDate(log.createdAt)}
                  </Text>
                </View>
                {(canManage || (!!currentUserClerkId && log.authorClerkId === currentUserClerkId)) && (
                  <TouchableOpacity
                    onPress={() => onDeleteLog(log)}
                    hitSlop={10}
                    style={styles.deleteLogBtn}
                    accessibilityLabel="Delete work log"
                  >
                    <Feather name="trash-2" size={16} color={colors.destructive} />
                  </TouchableOpacity>
                )}
              </View>
              {log.photoUrl ? (
                <Pressable
                  onPress={() => {
                    const i = allPhotos.primaryIndexForLog(log.id);
                    if (i >= 0) onOpenPhoto(allPhotos.photos, i);
                  }}
                  style={({ pressed }) => [{ marginTop: 8 }, pressed && { opacity: 0.85 }]}
                >
                  <PhotoPreview path={log.photoUrl} size={160} note={log.note} />
                </Pressable>
              ) : null}
              {log.attachments && log.attachments.length > 0 ? (
                <AttachmentList
                  attachments={log.attachments as AttachmentItem[]}
                  size="sm"
                  note={log.note}
                  onImagePress={(att) => {
                    const i = allPhotos.attachmentIndexForLog(log.id, att.path);
                    if (i >= 0) onOpenPhoto(allPhotos.photos, i);
                  }}
                />
              ) : null}
              {hasPendingRequest && (
                <View
                  style={{
                    marginTop: 10,
                    padding: 10,
                    borderWidth: 1,
                    borderRadius: 10,
                    borderColor: colors.primary + "55",
                    backgroundColor: colors.primary + "10",
                    gap: 8,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Feather name="clock" size={12} color={colors.primary} />
                    <Text
                      style={{
                        color: colors.primary,
                        fontFamily: "Inter_700Bold",
                        fontSize: 12,
                        flex: 1,
                      }}
                    >
                      {requester?.user?.name || "Assignee"} proposed {proposedLabel}
                    </Text>
                  </View>
                  {log.dueDateRequestedReason ? (
                    <Text
                      style={{
                        color: colors.foreground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 12,
                        fontStyle: "italic",
                      }}
                    >
                      “{log.dueDateRequestedReason}”
                    </Text>
                  ) : null}
                  {canManage && (
                    <>
                      <TextInput
                        value={responseNoteByLogId[log.id] ?? ""}
                        onChangeText={(t) =>
                          setResponseNoteByLogId((m) => ({ ...m, [log.id]: t }))
                        }
                        placeholder="Reply with an optional note (e.g. let's do Friday instead)"
                        placeholderTextColor={colors.mutedForeground}
                        maxLength={280}
                        multiline
                        style={{
                          borderWidth: 1,
                          borderRadius: 8,
                          borderColor: colors.border,
                          backgroundColor: colors.background,
                          color: colors.foreground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 12,
                          paddingHorizontal: 10,
                          paddingVertical: 8,
                          minHeight: 36,
                        }}
                        accessibilityLabel="Optional note for accepting or declining the reschedule"
                      />
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <TouchableOpacity
                          onPress={() => {
                            onRespondDueDateRequest(log, "accept", responseNoteByLogId[log.id]);
                            setResponseNoteByLogId((m) => {
                              const next = { ...m };
                              delete next[log.id];
                              return next;
                            });
                          }}
                          style={{
                            flex: 1,
                            paddingVertical: 8,
                            borderRadius: 8,
                            alignItems: "center",
                            backgroundColor: colors.primary,
                          }}
                        >
                          <Text
                            style={{
                              color: colors.primaryForeground,
                              fontFamily: "Inter_700Bold",
                              fontSize: 12,
                            }}
                          >
                            Accept
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => {
                            onRespondDueDateRequest(log, "decline", responseNoteByLogId[log.id]);
                            setResponseNoteByLogId((m) => {
                              const next = { ...m };
                              delete next[log.id];
                              return next;
                            });
                          }}
                          style={{
                            flex: 1,
                            paddingVertical: 8,
                            borderRadius: 8,
                            alignItems: "center",
                            borderWidth: 1,
                            borderColor: colors.border,
                            backgroundColor: colors.background,
                          }}
                        >
                          <Text
                            style={{
                              color: colors.foreground,
                              fontFamily: "Inter_700Bold",
                              fontSize: 12,
                            }}
                          >
                            Decline
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              )}
              {!hasPendingRequest && log.dueDateResponseNote ? (
                <View
                  style={{
                    marginTop: 10,
                    padding: 10,
                    borderWidth: 1,
                    borderRadius: 10,
                    borderColor: colors.border,
                    backgroundColor: colors.muted,
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Feather name="message-circle" size={12} color={colors.mutedForeground} />
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontFamily: "Inter_600SemiBold",
                        fontSize: 12,
                      }}
                    >
                      Owner replied
                    </Text>
                  </View>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontFamily: "Inter_400Regular",
                      fontSize: 12,
                      fontStyle: "italic",
                    }}
                  >
                    “{log.dueDateResponseNote}”
                  </Text>
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );
}

function HandoffTab({
  colors,
  entries,
  isLoading,
}: {
  colors: Colors;
  entries: HandoffEntry[];
  isLoading: boolean;
}) {
  if (isLoading) return <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />;
  if (entries.length === 0) {
    return (
      <View style={styles.tabContent}>
        <EmptyHint text="No history events yet." colors={colors} />
      </View>
    );
  }

  return (
    <View style={styles.tabContent}>
      <Text style={[styles.tabHeading, { color: colors.foreground, marginBottom: 16 }]}>
        History & Handoff
      </Text>
      {entries.map((entry, idx) => (
        <View key={idx} style={styles.handoffEntry}>
          <View style={styles.handoffTimeline}>
            <View style={[styles.timelineDot, { backgroundColor: colors.primary }]} />
            {idx !== entries.length - 1 && (
              <View style={[styles.timelineLine, { backgroundColor: colors.border }]} />
            )}
          </View>
          <View style={styles.handoffContent}>
            <Text style={[styles.handoffDate, { color: colors.mutedForeground }]}>
              {formatDate(entry.eventAt)}
            </Text>
            <Text style={[styles.handoffTitle, { color: colors.foreground }]}>
              <Text style={{ fontWeight: "600" }}>{entry.user.name}</Text>{" "}
              {entry.eventType === "joined" ? "joined the property" : "left the property"}
            </Text>

            {entry.lastLogs && entry.lastLogs.length > 0 && (
              <View style={styles.handoffSection}>
                <Text style={[styles.handoffSectionTitle, { color: colors.mutedForeground }]}>
                  RECENT ACTIVITY
                </Text>
                {entry.lastLogs.map((log) => (
                  <View key={log.id} style={styles.handoffLog}>
                    <Text style={[styles.handoffLogNote, { color: colors.foreground }]}>
                      {log.note}
                    </Text>
                    <Text style={[styles.handoffLogMeta, { color: colors.mutedForeground }]}>
                      {formatDate(log.createdAt)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {entry.pinnedNotes && entry.pinnedNotes.length > 0 && (
              <View style={styles.handoffSection}>
                <Text style={[styles.handoffSectionTitle, { color: colors.mutedForeground }]}>
                  PINNED NOTES
                </Text>
                {entry.pinnedNotes.map((note) => (
                  <View
                    key={note.id}
                    style={[
                      styles.handoffNote,
                      { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                  >
                    {note.title && (
                      <Text style={[styles.handoffNoteTitle, { color: colors.foreground }]}>
                        {note.title}
                      </Text>
                    )}
                    <Text
                      style={[styles.handoffNoteBody, { color: colors.foreground }]}
                      numberOfLines={2}
                    >
                      {note.body}
                    </Text>
                    {note.attachments && note.attachments.length > 0 ? (
                      <AttachmentList attachments={note.attachments as AttachmentItem[]} size="sm" />
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  headerSub: { fontSize: 13, fontFamily: "Inter_400Regular" },
  propertyBanner: {
    height: 96,
    overflow: "hidden",
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  propertyBannerEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  propertyIdentityRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  propertyIdentityPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  propertyIdentityPillText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.2,
  },
  tabsScroll: { flexGrow: 0, borderBottomWidth: StyleSheet.hairlineWidth },
  tabs: { paddingHorizontal: 16, gap: 24, paddingVertical: 12 },
  tabBtn: { paddingBottom: 8, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  tabContent: { padding: 16 },
  tabHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  tabHeading: { fontSize: 20, fontFamily: "Inter_700Bold" },
  addInlineBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  addInlineText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 24,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  sectionAction: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  summaryCard: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryLabel: { fontSize: 14, fontFamily: "Inter_400Regular" },
  summaryValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", textAlign: "right", flex: 1, marginLeft: 16 },
  summaryColumn: { padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  summaryTopRow: { flexDirection: "row", justifyContent: "space-between" },
  emptyHint: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  emptyHintSmall: { borderWidth: StyleSheet.hairlineWidth, borderStyle: "dashed", borderRadius: 12, padding: 14 },
  emptyHintText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1, lineHeight: 18 },
  emptyHintTextSmall: { fontSize: 12, fontFamily: "Inter_400Regular" },
  emptyCard: { padding: 20, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  addSectionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  addSectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  addSectionTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  addSectionDesc: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 2 },
  emptyText: { fontSize: 14, fontFamily: "Inter_400Regular" },
  logCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  logCardSmall: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, marginBottom: 8 },
  logHeader: { flexDirection: "row", gap: 12 },
  logNote: { fontSize: 15, fontFamily: "Inter_500Medium", flex: 1, lineHeight: 20 },
  logNoteSmall: { fontSize: 13, fontFamily: "Inter_500Medium" },
  logMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 4 },
  logMetaSmall: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 4 },
  logFooter: {
    flexDirection: "row",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(127,127,127,0.1)",
  },
  doneBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14 },
  doneBtnText: { fontSize: 12, fontFamily: "Inter_700Bold" },
  doneBadge: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  deleteLogBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
  },
  logHeaderRowSmall: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  assigneeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  assigneeText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  assignPicker: { marginTop: 12, flexDirection: "row" },
  pickerChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    marginRight: 8,
  },
  pickerText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  memberGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  memberCard: {
    width: "48%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    alignItems: "center",
    gap: 4,
  },
  memberAvatar: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  avatarText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  memberName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  memberTrade: { fontSize: 12, fontFamily: "Inter_400Regular" },
  memberStats: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  memberCount: { fontSize: 10, fontFamily: "Inter_400Regular" },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.7, marginBottom: 8 },
  rosterList: { gap: 1 },
  insightsRow: { flexDirection: "row", gap: 8 },
  insightCard: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 10, gap: 4, minHeight: 84 },
  insightHeader: { flexDirection: "row", alignItems: "center", gap: 4 },
  insightLabel: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  insightValue: { fontSize: 13, fontFamily: "Inter_700Bold" },
  insightDetail: { fontSize: 10, fontFamily: "Inter_400Regular", lineHeight: 13 },
  rosterEmptyHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 12,
  },
  chipScroll: { gap: 8, paddingRight: 8 },
  tradeChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    marginRight: 8,
  },
  tradeChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  sortRow: { flexDirection: "row", alignItems: "center", marginTop: 12, gap: 10 },
  sortLabel: { fontSize: 11, fontFamily: "Inter_600SemiBold", letterSpacing: 0.5 },
  sortGroup: { flexDirection: "row", gap: 6, flex: 1 },
  sortBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  sortBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  rowPrimaryStat: { fontSize: 15, fontFamily: "Inter_700Bold" },
  flagPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  flagPillText: { fontSize: 9, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  rosterRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  rowAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  rowAvatarText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  rowName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 1 },
  rowJobs: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
  specGroupTitle: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1, marginBottom: 8, marginLeft: 4 },
  noteCard: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12, gap: 8 },
  noteCardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  noteTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  noteBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20 },
  noteMeta: { fontSize: 12, fontFamily: "Inter_400Regular" },
  handoffEntry: { flexDirection: "row", gap: 16, marginBottom: 24 },
  handoffTimeline: { alignItems: "center", width: 12 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  timelineLine: { flex: 1, width: 2, marginTop: 4 },
  handoffContent: { flex: 1, gap: 6 },
  handoffDate: { fontSize: 12, fontFamily: "Inter_500Medium" },
  handoffTitle: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 20 },
  handoffSection: { marginTop: 12, gap: 8 },
  handoffSectionTitle: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  handoffLog: { paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: "rgba(127,127,127,0.2)", gap: 2 },
  handoffLogNote: { fontSize: 13, fontFamily: "Inter_500Medium" },
  handoffLogMeta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  handoffNote: { borderRadius: 10, borderWidth: 1, padding: 10, gap: 4 },
  handoffNoteTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  handoffNoteBody: { fontSize: 12, fontFamily: "Inter_400Regular" },
  pinBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  iconBtn: { padding: 6 },
  specEditRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12 },
  specKey: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  specValueBig: { fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 2 },
  logRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  handoffRail: { width: 18, alignItems: "center" },
  handoffDot: { width: 10, height: 10, borderRadius: 999, marginTop: 6 },
  handoffLine: { width: 1, flex: 1, marginTop: 4 },
  handoffCard: { flex: 1, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 14, marginLeft: 6 },
  handoffHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  handoffMeta: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  workCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  workTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  workMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" },
  workStatusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  workStatusText: { fontSize: 10, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
  workMetaText: { fontSize: 11, fontFamily: "Inter_500Medium" },
});
