import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { WorkOrder } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { PhotoHintBadge } from "@/components/PhotoHintBadge";
import { PerClientTagLine, type ConnectionTag } from "@/components/PerClientTagLine";
import { resolveStorageUrl } from "@/lib/uploads";

/**
 * One Work Record can be projected into multiple Roundhouse surfaces without
 * creating another copy of the work order. The context changes presentation,
 * not persistence:
 *
 * - personal: the person's Command Center / work history
 * - business: the Business Entity's cross-Property Work view
 * - property: the Property Entity's Work view
 *
 * All three contexts should navigate back to the same WorkOrder id.
 */
export type WorkOrderCardContext = "personal" | "business" | "property";

type Props = {
  workOrder: WorkOrder;
  context: WorkOrderCardContext;
  onPress: () => void;
  unreadComments?: number;
  onPreviewPhotos?: () => void;
  /**
   * Optional Business label when the source query already knows it. This is
   * presentation-only and is not stored on the card itself.
   */
  businessName?: string | null;
};

const STATUS_TINT: Record<string, string> = {
  requested: "#7A8A99",
  open: "#7A8A99",
  assigned: "#5687A8",
  in_progress: "#F59E0B",
  complete: "#5C8C75",
  verified: "#3F7059",
  cancelled: "#9CA3AF",
};

const STATUS_LABEL: Record<string, string> = {
  requested: "Requested",
  open: "Open",
  assigned: "Assigned",
  in_progress: "In progress",
  complete: "Complete",
  verified: "Verified",
  cancelled: "Cancelled",
};

function dueLabel(dueDate: string | Date | null | undefined): string | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function PersonLine({
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

export function WorkOrderCard({
  workOrder: wo,
  context,
  onPress,
  unreadComments = 0,
  onPreviewPhotos,
  businessName,
}: Props) {
  const colors = useColors();
  const finished = ["complete", "verified", "cancelled"].includes(wo.status);
  const due = dueLabel(wo.dueDate);
  const overdue =
    !!wo.dueDate && !finished && new Date(wo.dueDate).getTime() < Date.now();
  const statusTint = STATUS_TINT[wo.status] ?? colors.mutedForeground;
  const showProperty = context !== "property";
  const showBusiness = context === "personal" && !!businessName;
  const photoCount = wo.latestCommentPhotoCount ?? 0;
  const canPreviewLatestPhotos =
    !!onPreviewPhotos && !!wo.latestCommentHasPhoto && photoCount > 0;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${wo.title}, ${STATUS_LABEL[wo.status] ?? wo.status}`}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={styles.headerRow}>
        <View style={styles.contextBlock}>
          {showProperty ? (
            <Text style={[styles.contextPrimary, { color: colors.primary }]} numberOfLines={1}>
              {wo.property?.name ?? "Property"}
            </Text>
          ) : null}
          {showBusiness ? (
            <Text style={[styles.contextSecondary, { color: colors.mutedForeground }]} numberOfLines={1}>
              {businessName}
            </Text>
          ) : null}
        </View>

        <View style={styles.badgeRow}>
          {canPreviewLatestPhotos ? (
            <PhotoHintBadge
              onPress={onPreviewPhotos}
              colors={colors}
              count={photoCount}
              thumbnailUrl={resolveStorageUrl(wo.latestCommentPhotoPath)}
              accessibilityLabel={
                photoCount > 1
                  ? `Preview ${photoCount} photos from the latest work comment`
                  : "Preview the photo from the latest work comment"
              }
            />
          ) : null}
          {unreadComments > 0 ? (
            <View
              style={[styles.unreadBadge, { backgroundColor: colors.primary }]}
              accessibilityLabel={`${unreadComments} unread ${unreadComments === 1 ? "comment" : "comments"}`}
            >
              <Feather name="message-circle" size={10} color={colors.primaryForeground} />
              <Text style={[styles.unreadText, { color: colors.primaryForeground }]}>
                {unreadComments > 99 ? "99+" : unreadComments}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
        {wo.title}
      </Text>

      <View style={styles.metaRow}>
        <View style={[styles.statusPill, { backgroundColor: `${statusTint}22` }]}>
          <Text style={[styles.statusText, { color: statusTint }]}>
            {STATUS_LABEL[wo.status] ?? wo.status.replace("_", " ")}
          </Text>
        </View>
        {due ? (
          <Text style={[styles.meta, { color: overdue ? "#B0413E" : colors.mutedForeground }]}> 
            · {overdue ? "overdue" : "due"} {due}
          </Text>
        ) : null}
      </View>

      {wo.asset?.name ? (
        <View style={styles.assetRow}>
          <Feather name="box" size={11} color={colors.mutedForeground} />
          <Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {wo.asset.name}{wo.asset.assetTag ? ` · ${wo.asset.assetTag}` : ""}
          </Text>
        </View>
      ) : null}

      {wo.assignee?.name || wo.createdBy?.name ? (
        <View style={styles.peopleBlock}>
          {wo.assignee?.name ? (
            <PersonLine
              label={context === "personal" ? "Assigned" : "Assigned to"}
              name={wo.assignee.name}
              tag={wo.assignee.connectionTag ?? null}
              colors={colors}
            />
          ) : null}
          {wo.createdBy?.name && wo.createdBy.clerkId !== wo.assignee?.clerkId ? (
            <PersonLine
              label="Created by"
              name={wo.createdBy.name}
              tag={wo.createdBy.connectionTag ?? null}
              colors={colors}
            />
          ) : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
    marginTop: 8,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  contextBlock: { flex: 1, minHeight: 16 },
  contextPrimary: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  contextSecondary: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },
  badgeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  unreadBadge: {
    minWidth: 22,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  unreadText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  title: { fontSize: 15, lineHeight: 20, fontFamily: "Inter_600SemiBold", marginTop: 5 },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: 7 },
  statusPill: { borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  meta: { fontSize: 11, fontFamily: "Inter_400Regular" },
  assetRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 6 },
  peopleBlock: { marginTop: 6, gap: 3 },
});
