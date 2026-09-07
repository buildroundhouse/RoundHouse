import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
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
import { Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useAuth } from "@/lib/auth";
import {
  useGetWorkOrder,
  useGetProperty,
  useSetWorkOrderStatus,
  useUpdateWorkOrder,
  useApproveWorkOrder,
  useRejectWorkOrder,
  useListWorkOrderComments,
  useCreateWorkOrderComment,
  useUpdateWorkOrderComment,
  useDeleteWorkOrderComment,
  getListWorkOrderCommentsQueryKey,
  getGetUnreadWorkOrderCommentCountsQueryKey,
  useMarkWorkOrderCommentsRead,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useChipLabel } from "@/lib/presetChips";
import { composeLabelChipLine } from "@/lib/connectionTags";
import { PerClientTagLine, type ConnectionTag } from "@/components/PerClientTagLine";
import * as Haptics from "expo-haptics";
import { uploadAsset, resolveStorageUrl } from "@/lib/uploads";
import { confirm as crossPlatformConfirm } from "@/lib/confirm";
import { AttachmentList, type AttachmentItem } from "@/components/AttachmentList";
import { PhotoViewer, type PhotoViewerItem } from "@/components/PhotoViewer";
import { FileListSheet } from "@/components/FileListSheet";
import { usePhotoBatchActions } from "@/lib/photoBatch";

type WorkOrderAttachment = AttachmentItem & {
  phase?: "created" | "in_progress" | "complete";
  addedAt?: string;
  addedByClerkId?: string;
};

function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  complete: "Complete",
  verified: "Verified",
  cancelled: "Cancelled",
};

const PRIORITY_COLOR: Record<string, string> = {
  low: "#7A8A99",
  normal: "#5C8C75",
  high: "#F59E0B",
  urgent: "#B0413E",
};

export default function WorkOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
  const workOrderId = parseInt(String(id), 10);

  const orderQuery = useGetWorkOrder(workOrderId);
  // Resolve admin-managed labels for the order's priority and category.
  // Hooks must run unconditionally; they return "" for empty input.
  const priorityLabel = useChipLabel(
    "work_order_priorities",
    orderQuery.data?.priority,
  );
  const categoryLabel = useChipLabel(
    "work_order_categories",
    orderQuery.data?.category,
  );
  const propertyId = orderQuery.data?.propertyId;
  const propertyQuery = useGetProperty(propertyId ?? 0, {
    query: {
      enabled: typeof propertyId === "number" && propertyId > 0,
      queryKey: ["work-order-property", propertyId ?? 0],
    },
  });
  const userRole = propertyQuery.data?.userRole;
  const isManager = userRole === "owner" || userRole === "admin";
  const setStatus = useSetWorkOrderStatus();
  const updateOrder = useUpdateWorkOrder();
  const approveWO = useApproveWorkOrder();
  const rejectWO = useRejectWorkOrder();
  const queryClient = useQueryClient();
  const commentsQuery = useListWorkOrderComments(workOrderId);
  const createComment = useCreateWorkOrderComment();
  const updateComment = useUpdateWorkOrderComment();
  const deleteComment = useDeleteWorkOrderComment();
  const markRead = useMarkWorkOrderCommentsRead();
  useEffect(() => {
    if (!workOrderId || Number.isNaN(workOrderId)) return;
    markRead.mutate(
      { workOrderId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetUnreadWorkOrderCommentCountsQueryKey(),
          });
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrderId, commentsQuery.data?.comments?.length]);
  const [uploading, setUploading] = useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [commentDraftAttachments, setCommentDraftAttachments] = useState<WorkOrderAttachment[]>([]);
  const [commentUploading, setCommentUploading] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editDraftAttachments, setEditDraftAttachments] = useState<WorkOrderAttachment[]>([]);
  const [editUploading, setEditUploading] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [commentViewer, setCommentViewer] = useState<{
    photos: PhotoViewerItem[];
    index: number;
  } | null>(null);
  const [fileSheet, setFileSheet] = useState<WorkOrderAttachment[] | null>(null);
  const [gallerySelectMode, setGallerySelectMode] = useState(false);
  const [gallerySelected, setGallerySelected] = useState<Set<string>>(new Set());

  const refreshComments = () =>
    queryClient.invalidateQueries({ queryKey: getListWorkOrderCommentsQueryKey(workOrderId) });

  const startEditComment = (
    commentId: number,
    body: string,
    atts: WorkOrderAttachment[],
  ) => {
    setEditingCommentId(commentId);
    setEditDraft(body);
    setEditDraftAttachments(atts);
  };

  const cancelEditComment = () => {
    setEditingCommentId(null);
    setEditDraft("");
    setEditDraftAttachments([]);
  };

  const saveEditComment = async (commentId: number) => {
    const body = editDraft.trim();
    if (!body) return;
    try {
      await updateComment.mutateAsync({
        workOrderId,
        commentId,
        data: { body, attachments: editDraftAttachments },
      });
      cancelEditComment();
      await refreshComments();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not update comment";
      if (Platform.OS === "web") alert(msg);
      else Alert.alert("Could not update", msg);
    }
  };

  const performDeleteComment = async (commentId: number) => {
    try {
      await deleteComment.mutateAsync({ workOrderId, commentId });
      if (editingCommentId === commentId) cancelEditComment();
      await refreshComments();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not delete comment";
      if (Platform.OS === "web") alert(msg);
      else Alert.alert("Could not delete", msg);
    }
  };

  const confirmDeleteComment = async (commentId: number) => {
    // #627: Use the cross-platform confirm helper so the dialog actually
    // surfaces on react-native-web and native alike.
    const ok = await crossPlatformConfirm({
      title: "Delete comment?",
      message: "This cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (ok) void performDeleteComment(commentId);
  };

  const submitComment = async () => {
    const body = commentDraft.trim();
    if (!body) return;
    try {
      await createComment.mutateAsync({
        workOrderId,
        data: { body, attachments: commentDraftAttachments },
      });
      setCommentDraft("");
      setCommentDraftAttachments([]);
      await queryClient.invalidateQueries({
        queryKey: getListWorkOrderCommentsQueryKey(workOrderId),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not post comment";
      if (Platform.OS === "web") alert(msg);
      else Alert.alert("Could not post", msg);
    }
  };

  const pickCommentAttachment = async (
    target: "compose" | "edit",
    kind: "image" | "file",
  ): Promise<void> => {
    let asset: { uri: string; name?: string | null; mimeType?: string | null; size?: number | null } | null = null;
    try {
      if (kind === "image") {
        if (Platform.OS !== "web") {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            Alert.alert("Permission needed", "Allow photo access to attach an image.");
            return;
          }
        }
        const r = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.85,
          allowsMultipleSelection: false,
        });
        if (r.canceled || !r.assets?.[0]) return;
        const a = r.assets[0];
        asset = { uri: a.uri, name: a.fileName, mimeType: a.mimeType, size: a.fileSize };
      } else {
        const r = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
        if (r.canceled || !r.assets?.[0]) return;
        const a = r.assets[0];
        asset = { uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size };
      }
      if (!asset) return;
      if (target === "compose") setCommentUploading(true);
      else setEditUploading(true);
      const uploaded = await uploadAsset({
        uri: asset.uri,
        name: asset.name ?? undefined,
        contentType: asset.mimeType ?? undefined,
        size: asset.size ?? undefined,
      });
      const newAtt: WorkOrderAttachment = {
        ...uploaded,
        kind,
        addedAt: new Date().toISOString(),
        addedByClerkId: userId ?? undefined,
      };
      if (target === "compose") {
        setCommentDraftAttachments((prev) => [...prev, newAtt]);
      } else {
        setEditDraftAttachments((prev) => [...prev, newAtt]);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : `Could not attach ${kind === "image" ? "photo" : "file"}.`;
      if (Platform.OS === "web") alert(msg);
      else Alert.alert("Upload failed", msg);
    } finally {
      setCommentUploading(false);
      setEditUploading(false);
    }
  };

  const removeCommentDraftAttachment = (idx: number, target: "compose" | "edit") => {
    if (target === "compose") {
      setCommentDraftAttachments((prev) => prev.filter((_, i) => i !== idx));
    } else {
      setEditDraftAttachments((prev) => prev.filter((_, i) => i !== idx));
    }
  };

  const openCommentImage = (atts: WorkOrderAttachment[], att: AttachmentItem) => {
    const photos: PhotoViewerItem[] = atts.flatMap((a) => {
      if (a.kind !== "image") return [];
      const url = resolveStorageUrl(a.path);
      return url
        ? [
            {
              url,
              addedAt: a.addedAt,
              addedByName: resolveAuthorName(a.addedByClerkId),
              workOrderId,
            },
          ]
        : [];
    });
    const idx = atts.findIndex((a) => a.path === att.path && a.kind === "image");
    const imageIdx = atts.slice(0, Math.max(idx, 0)).filter((a) => a.kind === "image").length;
    if (photos.length > 0) setCommentViewer({ photos, index: imageIdx });
  };

  // Hooks must run before any early return — wire the gallery batch actions
  // up here so they survive loading/error short-circuits.
  const galleryShareContext = {
    workOrderTitle: orderQuery.data?.title,
    propertyName: orderQuery.data?.property?.name,
  };
  const galleryBatch = usePhotoBatchActions({ shareContext: galleryShareContext });
  const galleryImagePathsKey = (
    (orderQuery.data?.attachments ?? []) as WorkOrderAttachment[]
  )
    .filter((a) => a.kind === "image")
    .map((a) => a.path)
    .join("|");
  useEffect(() => {
    setGallerySelected((prev) => {
      if (prev.size === 0) return prev;
      const validPaths = new Set(galleryImagePathsKey.split("|"));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((p) => {
        if (validPaths.has(p)) next.add(p);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [galleryImagePathsKey]);

  if (!workOrderId || Number.isNaN(workOrderId)) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.foreground }}>Invalid work order</Text>
      </View>
    );
  }
  if (orderQuery.isLoading || !orderQuery.data) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const order = orderQuery.data;
  const attachments: WorkOrderAttachment[] = ((order.attachments ?? []) as WorkOrderAttachment[]) || [];
  const isAssignee = order.assigneeClerkId === userId;
  const isCreator = order.createdByClerkId === userId;
  // Server policy: managers can edit attachments + transition status + verify;
  // assignees can transition in_progress/complete; creators can edit pre-start.
  const canEdit = isAssignee || isCreator || isManager;
  const canVerify = isManager;
  const overdue =
    order.dueDate &&
    !["complete", "verified", "cancelled"].includes(order.status) &&
    new Date(order.dueDate).getTime() < Date.now();

  const transition = async (status: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await setStatus.mutateAsync({ workOrderId, data: { status } });
      orderQuery.refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not update status";
      if (Platform.OS === "web") {
        alert(msg);
      } else {
        Alert.alert("Could not update", msg);
      }
    }
  };

  const showError = (msg: string) => {
    if (Platform.OS === "web") alert(msg);
    else Alert.alert("Upload failed", msg);
  };

  const pickAndAttach = async (kind: "image" | "file") => {
    let asset: { uri: string; name?: string | null; mimeType?: string | null; size?: number | null; fileName?: string | null; fileSize?: number | null } | null = null;
    try {
      if (kind === "image") {
        if (Platform.OS !== "web") {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) {
            Alert.alert("Permission needed", "Allow photo access to attach an image.");
            return;
          }
        }
        const r = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.85,
          allowsMultipleSelection: false,
        });
        if (r.canceled || !r.assets?.[0]) return;
        const a = r.assets[0];
        asset = { uri: a.uri, fileName: a.fileName, mimeType: a.mimeType, fileSize: a.fileSize };
      } else {
        const r = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
        if (r.canceled || !r.assets?.[0]) return;
        const a = r.assets[0];
        asset = { uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size };
      }
      if (!asset) return;
      setUploading(true);
      const uploaded = await uploadAsset({
        uri: asset.uri,
        name: asset.name ?? asset.fileName ?? undefined,
        contentType: asset.mimeType ?? undefined,
        size: asset.size ?? asset.fileSize ?? undefined,
      });
      const newAtt: WorkOrderAttachment = {
        ...uploaded,
        kind,
        phase:
          order.status === "in_progress"
            ? "in_progress"
            : order.status === "complete" || order.status === "verified"
            ? "complete"
            : "created",
        addedAt: new Date().toISOString(),
      };
      await updateOrder.mutateAsync({
        workOrderId,
        data: { attachments: [...attachments, newAtt] },
      });
      orderQuery.refetch();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not attach file.");
    } finally {
      setUploading(false);
    }
  };

  const removeAttachment = async (idx: number) => {
    try {
      const next = attachments.filter((_, i) => i !== idx);
      await updateOrder.mutateAsync({ workOrderId, data: { attachments: next } });
      orderQuery.refetch();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Could not remove attachment.");
    }
  };

  const actions: { label: string; status: string; tint?: string }[] = [];
  if (order.status === "open" || order.status === "assigned") {
    if (isAssignee || isManager) actions.push({ label: "Start", status: "in_progress" });
  }
  if (order.status === "in_progress") {
    if (isAssignee || isManager) actions.push({ label: "Mark complete", status: "complete" });
  }
  if (order.status === "complete" && canVerify) {
    actions.push({ label: "Verify", status: "verified", tint: colors.primary });
  }

  // Group attachments for the timeline
  const byPhase: Record<string, WorkOrderAttachment[]> = {
    created: [],
    in_progress: [],
    complete: [],
    none: [],
  };
  for (const a of attachments) {
    const key = a.phase && byPhase[a.phase] ? a.phase : "none";
    byPhase[key].push(a);
  }

  // Build a clerk-id → display name lookup from people we already know about
  // on this screen (assignee, creator, comment authors). Falls back to undefined
  // for unknown attachers so the viewer can render gracefully.
  const nameByClerkId: Record<string, string> = {};
  if (order.assigneeClerkId && order.assignee?.name) {
    nameByClerkId[order.assigneeClerkId] = order.assignee.name;
  }
  if (order.createdByClerkId && order.createdBy?.name) {
    nameByClerkId[order.createdByClerkId] = order.createdBy.name;
  }
  for (const c of commentsQuery.data?.comments ?? []) {
    if (c.authorClerkId && c.author?.name && !nameByClerkId[c.authorClerkId]) {
      nameByClerkId[c.authorClerkId] = c.author.name;
    }
  }
  const resolveAuthorName = (clerkId?: string): string | undefined => {
    if (!clerkId) return undefined;
    if (clerkId === userId) return "You";
    return nameByClerkId[clerkId];
  };

  // Build a single ordered list of image attachments for the full-screen viewer.
  // Order: created/none → in_progress → complete (matches timeline display).
  // Filter once so the viewer photo array and open-index lookup stay aligned.
  const viewerEntries: { att: WorkOrderAttachment; photo: PhotoViewerItem }[] = [
    ...byPhase.created,
    ...byPhase.none,
    ...byPhase.in_progress,
    ...byPhase.complete,
  ].flatMap((a) => {
    if (a.kind !== "image") return [];
    const url = resolveStorageUrl(a.path);
    return url
      ? [
          {
            att: a,
            photo: {
              url,
              addedAt: a.addedAt,
              phase: a.phase,
              addedByName: resolveAuthorName(a.addedByClerkId),
              workOrderId,
            },
          },
        ]
      : [];
  });
  const viewerPhotos: PhotoViewerItem[] = viewerEntries.map((e) => e.photo);
  const openImage = (att: AttachmentItem) => {
    const i = viewerEntries.findIndex((e) => e.att.path === att.path);
    if (i >= 0) setViewerIndex(i);
  };

  const galleryImageAttachments = attachments.filter(
    (a) => a.kind === "image"
  );
  const galleryHasImages = galleryImageAttachments.some(
    (a) => !!resolveStorageUrl(a.path)
  );
  const exitGallerySelect = () => {
    setGallerySelectMode(false);
    setGallerySelected(new Set());
  };
  const toggleGallerySelected = (att: AttachmentItem) => {
    if (!resolveStorageUrl(att.path)) return;
    setGallerySelected((prev) => {
      const next = new Set(prev);
      if (next.has(att.path)) next.delete(att.path);
      else next.add(att.path);
      return next;
    });
  };
  const collectGallerySelectedUrls = (): string[] => {
    const urls: string[] = [];
    galleryImageAttachments.forEach((a) => {
      if (!gallerySelected.has(a.path)) return;
      const url = resolveStorageUrl(a.path);
      if (url) urls.push(url);
    });
    return urls;
  };
  const gallerySelectedCount = collectGallerySelectedUrls().length;
  const galleryBusy = galleryBatch.batchSaving || galleryBatch.batchSharing;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen
        options={{
          title: "Work Order",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.foreground,
          headerShadowVisible: false,
        }}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}>
        <Text style={[styles.title, { color: colors.foreground }]}>{order.title}</Text>
        <View style={styles.metaRow}>
          <View style={[styles.statusPill, { backgroundColor: colors.scoreBackground }]}>
            <Text style={[styles.statusText, { color: colors.primary }]}>
              {STATUS_LABEL[order.status] ?? order.status}
            </Text>
          </View>
          <View style={[styles.priorityPill, { backgroundColor: (PRIORITY_COLOR[order.priority] ?? colors.muted) + "33" }]}>
            <Text style={[styles.priorityText, { color: PRIORITY_COLOR[order.priority] ?? colors.foreground }]}>
              {priorityLabel || order.priority}
            </Text>
          </View>
          {overdue && (
            <View style={[styles.overduePill, { backgroundColor: "#B0413E22" }]}>
              <Feather name="alert-circle" size={11} color="#B0413E" />
              <Text style={[styles.overdueText, { color: "#B0413E" }]}>Overdue</Text>
            </View>
          )}
        </View>
        {order.property?.name && (
          <Text style={[styles.subtle, { color: colors.mutedForeground }]}>
            {order.property.name}
          </Text>
        )}

        {(order.category || order.asset || order.poNumber) && (
          <View style={[styles.metaRow, { marginTop: 6 }]}>
            {order.category && (
              <View style={[styles.priorityPill, { backgroundColor: colors.muted }]}>
                <Text style={[styles.priorityText, { color: colors.foreground }]}>{categoryLabel || order.category}</Text>
              </View>
            )}
            {order.asset && (
              <View style={[styles.priorityPill, { backgroundColor: colors.muted, flexDirection: "row", alignItems: "center", gap: 4 }]}>
                <Feather name="box" size={11} color={colors.foreground} />
                <Text style={[styles.priorityText, { color: colors.foreground, textTransform: "none" }]}>
                  {order.asset.name}{order.asset.assetTag ? ` · ${order.asset.assetTag}` : ""}
                </Text>
              </View>
            )}
            {order.poNumber && (
              <View style={[styles.priorityPill, { backgroundColor: colors.muted }]}>
                <Text style={[styles.priorityText, { color: colors.foreground, textTransform: "none" }]}>
                  PO {order.poNumber}
                </Text>
              </View>
            )}
          </View>
        )}

        {isManager && order.status === "requested" && order.approvalStatus === "pending" && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Feather name="alert-circle" size={16} color={colors.foreground} />
              <Text style={{ fontSize: 14, fontFamily: "Inter_600SemiBold", color: colors.foreground }}>
                Approval needed
              </Text>
            </View>
            <Text style={{ fontSize: 13, color: colors.mutedForeground, marginBottom: 12, lineHeight: 18 }}>
              A team member requested this work. Approve to make it active or reject to cancel.
            </Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TouchableOpacity
                disabled={approveWO.isPending}
                onPress={async () => {
                  try {
                    await approveWO.mutateAsync({ workOrderId });
                    orderQuery.refetch();
                  } catch (e) {
                    Alert.alert("Could not approve", e instanceof Error ? e.message : "Try again.");
                  }
                }}
                style={{ flex: 1, backgroundColor: colors.primary, paddingVertical: 10, borderRadius: 10, alignItems: "center" }}
              >
                <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={rejectWO.isPending}
                onPress={async () => {
                  // #627: Use the cross-platform confirm helper so the
                  // dialog actually surfaces on react-native-web and
                  // native alike.
                  const ok = await crossPlatformConfirm({
                    title: "Reject request?",
                    message: "This will cancel the work order.",
                    confirmLabel: "Reject",
                    cancelLabel: "Cancel",
                    destructive: true,
                  });
                  if (!ok) return;
                  try {
                    await rejectWO.mutateAsync({ workOrderId });
                    orderQuery.refetch();
                  } catch (e) {
                    Alert.alert("Could not reject", e instanceof Error ? e.message : "Try again.");
                  }
                }}
                style={{ flex: 1, backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" }}
              >
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {!isManager && order.status === "requested" && order.approvalStatus === "pending" && (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 12, flexDirection: "row", alignItems: "center", gap: 8 }]}>
            <Feather name="clock" size={14} color={colors.mutedForeground} />
            <Text style={{ flex: 1, fontSize: 13, color: colors.mutedForeground }}>
              Awaiting manager approval.
            </Text>
          </View>
        )}

        {order.description ? (
          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.body, { color: colors.foreground }]}>{order.description}</Text>
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <PersonRow
            label="Assigned to"
            name={order.assignee?.name ?? "Unassigned"}
            connectionTag={order.assignee?.connectionTag ?? null}
            colors={colors}
          />
          <PersonRow
            label="Created by"
            name={order.createdBy?.name ?? "—"}
            connectionTag={order.createdBy?.connectionTag ?? null}
            colors={colors}
          />
          <Row label="Created" value={formatDateTime(order.createdAt)} colors={colors} />
          <Row label="Due" value={formatDateTime(order.dueDate)} colors={colors} last />
        </View>

        <View style={styles.galleryHeaderRow}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 0 }]}>
            PHOTOS & FILES
          </Text>
          {galleryHasImages && (
            <TouchableOpacity
              onPress={() => {
                if (gallerySelectMode) exitGallerySelect();
                else setGallerySelectMode(true);
              }}
              disabled={galleryBusy}
              hitSlop={8}
              style={[
                styles.gallerySelectBtn,
                {
                  borderColor: gallerySelectMode ? colors.primary : colors.border,
                  backgroundColor: gallerySelectMode
                    ? colors.primary + "1A"
                    : colors.card,
                },
                galleryBusy && { opacity: 0.5 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                gallerySelectMode
                  ? "Exit photo selection"
                  : "Pick photos to share or save"
              }
            >
              <Feather
                name={gallerySelectMode ? "x" : "check-square"}
                size={12}
                color={gallerySelectMode ? colors.primary : colors.foreground}
              />
              <Text
                style={[
                  styles.gallerySelectLabel,
                  { color: gallerySelectMode ? colors.primary : colors.foreground },
                ]}
              >
                {gallerySelectMode ? "Done" : "Select"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        {attachments.length > 0 ? (
          <>
            <AttachmentList
              attachments={attachments}
              onRemove={canEdit && !gallerySelectMode ? removeAttachment : undefined}
              onImagePress={openImage}
              selectMode={gallerySelectMode}
              selectedPaths={gallerySelected}
              onToggleSelect={toggleGallerySelected}
            />
            <ViewAllFilesBadge
              files={attachments.filter((a) => a.kind === "file")}
              onPress={(files) => setFileSheet(files as WorkOrderAttachment[])}
              colors={colors}
            />
          </>
        ) : (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>
            No attachments yet.
          </Text>
        )}
        {gallerySelectMode && (
          <View
            style={[
              styles.galleryActionBar,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <Text style={[styles.galleryActionCount, { color: colors.mutedForeground }]}>
              {gallerySelectedCount === 0
                ? "Tap photos to select"
                : `${gallerySelectedCount} selected`}
            </Text>
            <View style={styles.galleryActionBtns}>
              <TouchableOpacity
                onPress={() => {
                  const urls = collectGallerySelectedUrls();
                  if (urls.length === 0) return;
                  galleryBatch.shareUrls(urls);
                }}
                disabled={gallerySelectedCount === 0 || galleryBusy}
                style={[
                  styles.galleryActionBtn,
                  { backgroundColor: colors.primary },
                  (gallerySelectedCount === 0 || galleryBusy) && { opacity: 0.4 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  gallerySelectedCount === 0
                    ? "Share selected photos"
                    : `Share ${gallerySelectedCount} photo${gallerySelectedCount === 1 ? "" : "s"}`
                }
              >
                {galleryBatch.batchSharing ? (
                  <ActivityIndicator size="small" color={colors.primaryForeground} />
                ) : (
                  <Feather name="share-2" size={13} color={colors.primaryForeground} />
                )}
                <Text style={[styles.galleryActionLabel, { color: colors.primaryForeground }]}>
                  Share ({gallerySelectedCount})
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const urls = collectGallerySelectedUrls();
                  if (urls.length === 0) return;
                  galleryBatch.saveUrls(urls);
                }}
                disabled={gallerySelectedCount === 0 || galleryBusy}
                style={[
                  styles.galleryActionBtn,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                    borderWidth: 1,
                  },
                  (gallerySelectedCount === 0 || galleryBusy) && { opacity: 0.4 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={
                  Platform.OS === "web"
                    ? `Download ${gallerySelectedCount} photo${gallerySelectedCount === 1 ? "" : "s"}`
                    : `Save ${gallerySelectedCount} photo${gallerySelectedCount === 1 ? "" : "s"}`
                }
              >
                {galleryBatch.batchSaving ? (
                  <ActivityIndicator size="small" color={colors.foreground} />
                ) : (
                  <Feather name="download-cloud" size={13} color={colors.foreground} />
                )}
                <Text style={[styles.galleryActionLabel, { color: colors.foreground }]}>
                  {Platform.OS === "web" ? "Download" : "Save"} ({gallerySelectedCount})
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {canEdit && (
          <View style={styles.attachRow}>
            <TouchableOpacity
              onPress={() => pickAndAttach("image")}
              disabled={uploading}
              style={[styles.attachBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            >
              <Feather name="image" size={14} color={colors.foreground} />
              <Text style={[styles.attachText, { color: colors.foreground }]}>Add photo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => pickAndAttach("file")}
              disabled={uploading}
              style={[styles.attachBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
            >
              <Feather name="paperclip" size={14} color={colors.foreground} />
              <Text style={[styles.attachText, { color: colors.foreground }]}>Add file</Text>
            </TouchableOpacity>
            {uploading && <ActivityIndicator size="small" color={colors.primary} />}
          </View>
        )}

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>TIMELINE</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TimelineRow icon="plus-circle" label="Created" at={order.createdAt} colors={colors}>
            {byPhase.created.length > 0 || byPhase.none.length > 0 ? (
              <>
                <AttachmentList
                  attachments={[...byPhase.created, ...byPhase.none]}
                  size="sm"
                  onImagePress={openImage}
                />
                <ViewAllFilesBadge
                  files={[...byPhase.created, ...byPhase.none].filter((a) => a.kind === "file")}
                  onPress={(files) => setFileSheet(files as WorkOrderAttachment[])}
                  colors={colors}
                />
              </>
            ) : null}
          </TimelineRow>
          {order.startedAt && (
            <TimelineRow
              icon="play-circle"
              label="Started"
              at={order.startedAt}
              colors={colors}
            >
              {byPhase.in_progress.length > 0 ? (
                <>
                  <AttachmentList attachments={byPhase.in_progress} size="sm" onImagePress={openImage} />
                  <ViewAllFilesBadge
                    files={byPhase.in_progress.filter((a) => a.kind === "file")}
                    onPress={(files) => setFileSheet(files as WorkOrderAttachment[])}
                    colors={colors}
                  />
                </>
              ) : null}
            </TimelineRow>
          )}
          {order.completedAt && (
            <TimelineRow icon="check-circle" label="Completed" at={order.completedAt} colors={colors}>
              {byPhase.complete.length > 0 ? (
                <>
                  <AttachmentList attachments={byPhase.complete} size="sm" onImagePress={openImage} />
                  <ViewAllFilesBadge
                    files={byPhase.complete.filter((a) => a.kind === "file")}
                    onPress={(files) => setFileSheet(files as WorkOrderAttachment[])}
                    colors={colors}
                  />
                </>
              ) : null}
            </TimelineRow>
          )}
          {order.verifiedAt && (
            <TimelineRow icon="shield" label="Verified" at={order.verifiedAt} colors={colors} last />
          )}
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>DISCUSSION</Text>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, padding: 0 }]}>
          {commentsQuery.isLoading ? (
            <View style={{ padding: 16, alignItems: "center" }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (commentsQuery.data?.comments?.length ?? 0) === 0 ? (
            <Text style={[styles.empty, { color: colors.mutedForeground, padding: 14 }]}>
              No comments yet. Start the conversation.
            </Text>
          ) : (
            commentsQuery.data!.comments.map((c, idx, arr) => {
              const isMine = c.authorClerkId === userId;
              const name = c.author?.name ?? (isMine ? "You" : "Member");
              const canDelete = isMine || isManager;
              const edited =
                !!c.updatedAt &&
                !!c.createdAt &&
                new Date(c.updatedAt).getTime() !== new Date(c.createdAt).getTime();
              const commentAtts: WorkOrderAttachment[] =
                ((c.attachments ?? []) as WorkOrderAttachment[]) || [];
              const isEditing = editingCommentId === c.id;
              const isSavingEdit = isEditing && updateComment.isPending;
              const isDeletingThis =
                deleteComment.isPending && deleteComment.variables?.commentId === c.id;
              return (
                <View
                  key={c.id}
                  style={[
                    styles.commentRow,
                    idx < arr.length - 1 && {
                      borderBottomWidth: StyleSheet.hairlineWidth,
                      borderBottomColor: colors.border,
                    },
                  ]}
                >
                  <View style={styles.commentHeader}>
                    <View style={styles.commentAuthorRow}>
                      <Text style={[styles.commentAuthor, { color: colors.foreground }]}>
                        {isMine ? "You" : name}
                      </Text>
                      {(() => {
                        const photoCount = commentAtts.filter((a) => a.kind === "image").length;
                        if (photoCount === 0) return null;
                        const firstImage = commentAtts.find((a) => a.kind === "image");
                        return (
                          <TouchableOpacity
                            onPress={() => {
                              if (firstImage) openCommentImage(commentAtts, firstImage);
                            }}
                            style={[
                              styles.commentPhotoBadge,
                              { borderColor: colors.border, backgroundColor: colors.muted },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={
                              photoCount === 1
                                ? "View 1 attached photo"
                                : `View ${photoCount} attached photos`
                            }
                          >
                            <Feather name="camera" size={10} color={colors.mutedForeground} />
                            <Text
                              style={[styles.commentPhotoText, { color: colors.mutedForeground }]}
                            >
                              {photoCount}
                            </Text>
                          </TouchableOpacity>
                        );
                      })()}
                      {(() => {
                        const fileCount = commentAtts.filter((a) => a.kind === "file").length;
                        if (fileCount === 0) return null;
                        const fileAtts = commentAtts.filter((a) => a.kind === "file");
                        const openFile = (att: WorkOrderAttachment) => {
                          const url = resolveStorageUrl(att.path);
                          if (!url) return;
                          if (Platform.OS === "web") {
                            window.open(url, "_blank");
                          } else {
                            Linking.openURL(url).catch(() => {});
                          }
                        };
                        const onBadgePress = () => {
                          if (fileAtts.length <= 1) {
                            if (fileAtts[0]) openFile(fileAtts[0]);
                          } else {
                            setFileSheet(fileAtts);
                          }
                        };
                        return (
                          <TouchableOpacity
                            onPress={onBadgePress}
                            style={[
                              styles.commentPhotoBadge,
                              { borderColor: colors.border, backgroundColor: colors.muted },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={
                              fileCount === 1
                                ? "Open 1 attached file"
                                : `Show ${fileCount} attached files`
                            }
                          >
                            <Feather name="paperclip" size={10} color={colors.mutedForeground} />
                            <Text
                              style={[styles.commentPhotoText, { color: colors.mutedForeground }]}
                            >
                              {fileCount}
                            </Text>
                          </TouchableOpacity>
                        );
                      })()}
                    </View>
                    <Text style={[styles.commentAt, { color: colors.mutedForeground }]}>
                      {formatDateTime(c.createdAt)}
                      {edited ? " · edited" : ""}
                    </Text>
                  </View>
                  <PerClientTagLine tag={c.author?.connectionTag ?? null} colors={colors} />
                  {isEditing ? (
                    <View style={{ gap: 8, marginTop: 4 }}>
                      <TextInput
                        value={editDraft}
                        onChangeText={setEditDraft}
                        multiline
                        autoFocus
                        editable={!isSavingEdit}
                        style={[
                          styles.composerInput,
                          {
                            color: colors.foreground,
                            backgroundColor: colors.background,
                            borderColor: colors.border,
                          },
                        ]}
                      />
                      {editDraftAttachments.length > 0 && (
                        <AttachmentList
                          attachments={editDraftAttachments}
                          size="sm"
                          onRemove={(i) => removeCommentDraftAttachment(i, "edit")}
                        />
                      )}
                      <View style={styles.commentActionRow}>
                        <TouchableOpacity
                          onPress={() => pickCommentAttachment("edit", "image")}
                          disabled={isSavingEdit || editUploading}
                          style={styles.commentLinkBtn}
                        >
                          {editUploading ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                          ) : (
                            <>
                              <Feather name="image" size={12} color={colors.primary} />
                              <Text
                                style={[styles.commentLinkText, { color: colors.primary }]}
                              >
                                Add photo
                              </Text>
                            </>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => pickCommentAttachment("edit", "file")}
                          disabled={isSavingEdit || editUploading}
                          style={styles.commentLinkBtn}
                          accessibilityLabel="Add file"
                        >
                          <Feather name="paperclip" size={12} color={colors.primary} />
                          <Text style={[styles.commentLinkText, { color: colors.primary }]}>
                            Add file
                          </Text>
                        </TouchableOpacity>
                        <View style={{ flex: 1 }} />
                        <TouchableOpacity
                          onPress={cancelEditComment}
                          disabled={isSavingEdit}
                          style={[
                            styles.commentActionBtn,
                            { borderColor: colors.border, backgroundColor: colors.card },
                          ]}
                        >
                          <Text
                            style={[styles.commentActionText, { color: colors.foreground }]}
                          >
                            Cancel
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => saveEditComment(c.id)}
                          disabled={
                            isSavingEdit || editUploading || editDraft.trim().length === 0
                          }
                          style={[
                            styles.commentActionBtn,
                            {
                              borderColor: colors.primary,
                              backgroundColor: colors.primary,
                              opacity:
                                isSavingEdit || editUploading || editDraft.trim().length === 0
                                  ? 0.6
                                  : 1,
                            },
                          ]}
                        >
                          {isSavingEdit ? (
                            <ActivityIndicator size="small" color={colors.primaryForeground} />
                          ) : (
                            <Text
                              style={[
                                styles.commentActionText,
                                { color: colors.primaryForeground },
                              ]}
                            >
                              Save
                            </Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <>
                      <Text style={[styles.commentBody, { color: colors.foreground }]}>
                        {c.body}
                      </Text>
                      {commentAtts.length > 0 && (
                        <AttachmentList
                          attachments={commentAtts}
                          size="sm"
                          onImagePress={(att) => openCommentImage(commentAtts, att)}
                        />
                      )}
                      {(isMine || canDelete) && (
                        <View style={styles.commentActionRow}>
                          {isMine && (
                            <TouchableOpacity
                              onPress={() => startEditComment(c.id, c.body, commentAtts)}
                              disabled={isDeletingThis}
                              style={styles.commentLinkBtn}
                            >
                              <Feather
                                name="edit-2"
                                size={12}
                                color={colors.mutedForeground}
                              />
                              <Text
                                style={[
                                  styles.commentLinkText,
                                  { color: colors.mutedForeground },
                                ]}
                              >
                                Edit
                              </Text>
                            </TouchableOpacity>
                          )}
                          {canDelete && (
                            <TouchableOpacity
                              onPress={() => confirmDeleteComment(c.id)}
                              disabled={isDeletingThis}
                              style={styles.commentLinkBtn}
                            >
                              {isDeletingThis ? (
                                <ActivityIndicator size="small" color="#B0413E" />
                              ) : (
                                <>
                                  <Feather name="trash-2" size={12} color="#B0413E" />
                                  <Text
                                    style={[styles.commentLinkText, { color: "#B0413E" }]}
                                  >
                                    Delete
                                  </Text>
                                </>
                              )}
                            </TouchableOpacity>
                          )}
                        </View>
                      )}
                    </>
                  )}
                </View>
              );
            })
          )}
          <View
            style={[
              styles.composerWrap,
              { borderTopColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            {commentDraftAttachments.length > 0 && (
              <View style={{ paddingHorizontal: 10, paddingTop: 8 }}>
                <AttachmentList
                  attachments={commentDraftAttachments}
                  size="sm"
                  onRemove={(i) => removeCommentDraftAttachment(i, "compose")}
                />
              </View>
            )}
            <View style={styles.composerRow}>
              <TouchableOpacity
                onPress={() => pickCommentAttachment("compose", "image")}
                disabled={createComment.isPending || commentUploading}
                style={[
                  styles.composerIconBtn,
                  { borderColor: colors.border, backgroundColor: colors.background },
                ]}
                accessibilityLabel="Add photo"
              >
                {commentUploading ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Feather name="image" size={16} color={colors.foreground} />
                )}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => pickCommentAttachment("compose", "file")}
                disabled={createComment.isPending || commentUploading}
                style={[
                  styles.composerIconBtn,
                  { borderColor: colors.border, backgroundColor: colors.background },
                ]}
                accessibilityLabel="Add file"
              >
                <Feather name="paperclip" size={16} color={colors.foreground} />
              </TouchableOpacity>
              <TextInput
                value={commentDraft}
                onChangeText={setCommentDraft}
                placeholder="Add a comment..."
                placeholderTextColor={colors.mutedForeground}
                multiline
                style={[
                  styles.composerInput,
                  { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border },
                ]}
                editable={!createComment.isPending}
              />
              <TouchableOpacity
                onPress={submitComment}
                disabled={
                  createComment.isPending ||
                  commentUploading ||
                  commentDraft.trim().length === 0
                }
                style={[
                  styles.composerSend,
                  {
                    backgroundColor: colors.primary,
                    opacity:
                      createComment.isPending ||
                      commentUploading ||
                      commentDraft.trim().length === 0
                        ? 0.5
                        : 1,
                  },
              ]}
            >
              {createComment.isPending ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Feather name="send" size={16} color={colors.primaryForeground} />
              )}
            </TouchableOpacity>
            </View>
          </View>
        </View>

        {actions.length > 0 && (
          <View style={styles.actionRow}>
            {actions.map((a) => (
              <TouchableOpacity
                key={a.status}
                disabled={setStatus.isPending}
                onPress={() => transition(a.status)}
                style={[
                  styles.actionBtn,
                  { backgroundColor: a.tint ?? colors.primary, opacity: setStatus.isPending ? 0.6 : 1 },
                ]}
              >
                <Text style={[styles.actionText, { color: colors.primaryForeground }]}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
      <PhotoViewer
        visible={viewerIndex !== null}
        photos={viewerPhotos}
        initialIndex={viewerIndex ?? 0}
        onClose={() => setViewerIndex(null)}
        shareContext={{
          workOrderTitle: order.title,
          propertyName: order.property?.name,
        }}
      />
      <PhotoViewer
        visible={commentViewer !== null}
        photos={commentViewer?.photos ?? []}
        initialIndex={commentViewer?.index ?? 0}
        onClose={() => setCommentViewer(null)}
        shareContext={{
          workOrderTitle: order.title,
          propertyName: order.property?.name,
        }}
      />
      <FileListSheet
        files={fileSheet}
        onClose={() => setFileSheet(null)}
        bottomInset={insets.bottom}
      />
      {galleryBatch.overlay}
    </View>
  );
}


function ViewAllFilesBadge({
  files,
  onPress,
  colors,
}: {
  files: AttachmentItem[];
  onPress: (files: AttachmentItem[]) => void;
  colors: ReturnType<typeof useColors>;
}) {
  if (files.length < 2) return null;
  return (
    <TouchableOpacity
      onPress={() => onPress(files)}
      style={[
        styles.viewAllFiles,
        { borderColor: colors.border, backgroundColor: colors.card },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`View all ${files.length} attached files`}
    >
      <Feather name="list" size={14} color={colors.foreground} />
      <Text style={[styles.viewAllFilesText, { color: colors.foreground }]}>
        View all {files.length} files
      </Text>
    </TouchableOpacity>
  );
}

type RowProps = { label: string; value: string; colors: ReturnType<typeof useColors>; last?: boolean };
function Row({ label, value, colors, last }: RowProps) {
  return (
    <View
      style={[
        styles.kvRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
    >
      <Text style={[styles.kvLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.kvValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

type PersonRowProps = {
  label: string;
  name: string;
  connectionTag: ConnectionTag;
  colors: ReturnType<typeof useColors>;
  last?: boolean;
};
// #537 — Same row as Row, but stacks the viewer's per-client tag
// (composed Service · Identity line via composeLabelChipLine) under
// the person's name. Mirrors the pattern from PublicProfileModal.
function PersonRow({ label, name, connectionTag, colors, last }: PersonRowProps) {
  const tag = composeLabelChipLine({
    roleContext: connectionTag?.roleContext ?? null,
    serviceTitle: connectionTag?.serviceTitle ?? null,
    onSiteIdentity: connectionTag?.onSiteIdentity ?? null,
    onSiteIdentityOther: connectionTag?.onSiteIdentityOther ?? null,
    chip: connectionTag?.chip ?? null,
    chipOther: connectionTag?.chipOther ?? null,
  });
  const hasTag = !!(tag.label || tag.chip);
  return (
    <View
      style={[
        styles.kvRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
    >
      <Text style={[styles.kvLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={{ flexShrink: 1, marginLeft: 12, alignItems: "flex-end" }}>
        <Text style={[styles.kvValue, { color: colors.foreground, marginLeft: 0 }]}>{name}</Text>
        {hasTag ? <PerClientTagLine tag={connectionTag} colors={colors} alignRight /> : null}
      </View>
    </View>
  );
}

type TimelineProps = {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  at: string | Date;
  colors: ReturnType<typeof useColors>;
  last?: boolean;
  children?: React.ReactNode;
};
function TimelineRow({ icon, label, at, colors, last, children }: TimelineProps) {
  return (
    <View
      style={[
        styles.timelineRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
      ]}
    >
      <Feather name={icon} size={16} color={colors.primary} style={{ marginTop: 2 }} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.timelineLabel, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.timelineAt, { color: colors.mutedForeground }]}>{formatDateTime(at)}</Text>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 20, gap: 12 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  subtle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase", letterSpacing: 0.4 },
  priorityPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  priorityText: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "capitalize" },
  overduePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  overdueText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 4, marginTop: 6 },
  body: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, padding: 12 },
  empty: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  sectionLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.5, marginTop: 18 },
  kvRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 10 },
  kvLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  kvValue: { fontSize: 13, fontFamily: "Inter_600SemiBold", flexShrink: 1, textAlign: "right", marginLeft: 12 },
  timelineRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  timelineLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  timelineAt: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 18 },
  actionBtn: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10, flexGrow: 1, alignItems: "center" },
  actionText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  attachRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 8 },
  galleryHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 18,
  },
  gallerySelectBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  gallerySelectLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
  },
  galleryActionBar: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  galleryActionCount: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  galleryActionBtns: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  galleryActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  galleryActionLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
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
  viewAllFiles: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    alignSelf: "flex-start",
    marginTop: 8,
  },
  viewAllFilesText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  commentRow: { paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  commentHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  commentAuthorRow: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  commentPhotoBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  commentPhotoText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  commentAuthor: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  commentAt: { fontSize: 11, fontFamily: "Inter_400Regular" },
  commentBody: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginTop: 2 },
  commentActionRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 6 },
  commentActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 64,
    alignItems: "center",
  },
  commentActionText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  commentLinkBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 2 },
  commentLinkText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  composerWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    padding: 10,
  },
  composerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  composerInput: {
    flex: 1,
    minHeight: 38,
    maxHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  composerSend: {
    width: 40,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
