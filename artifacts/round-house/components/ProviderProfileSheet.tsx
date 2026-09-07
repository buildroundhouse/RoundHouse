import React from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useGetProviderStats, useGetUserById, useUpdatePropertyMember } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type { PropertyMember } from "@workspace/api-client-react";
import { RatingStars } from "./RatingStars";

interface Props {
  visible: boolean;
  member: PropertyMember | null;
  propertyId: number;
  canManage: boolean;
  onClose: () => void;
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function ProviderProfileSheet({ visible, member, propertyId, canManage, onClose }: Props) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const memberId = member?.userClerkId || "";
  const { data, isLoading } = useGetProviderStats(propertyId, memberId, {
    query: { enabled: visible && !!memberId } as never,
  });
  const { data: profile } = useGetUserById(memberId, undefined, {
    query: {
      enabled: visible && !!memberId,
      queryKey: [`/api/users/${memberId}`],
    } as never,
  });
  const updateMember = useUpdatePropertyMember();

  const stats = data;
  const archived = !!member?.archivedAt;
  // Property people sheet rule: Name · Label · Chip only — no contact details
  // unless the viewer has an accepted connection with the pro (or is the pro
  // themselves). Mirrors the `isSelf || connected` gating in PublicProfileModal.
  const canSeeContact = !!(profile?.isSelf || profile?.connection);

  const handleArchiveToggle = async () => {
    if (!member) return;
    await updateMember.mutateAsync({
      propertyId,
      memberUserId: member.userClerkId,
      data: { archived: !archived },
    });
    queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}`] });
    queryClient.invalidateQueries({
      queryKey: [`/api/properties/${propertyId}/members/${member.userClerkId}/stats`],
    });
    onClose();
  };

  const callPhone = () => {
    if (member?.phone) Linking.openURL(`tel:${member.phone}`);
  };
  const messagePhone = () => {
    if (member?.phone) Linking.openURL(`sms:${member.phone}`);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : 0 }]}>
          <TouchableOpacity onPress={onClose}>
            <Feather name="x" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Provider</Text>
          <View style={{ width: 22 }} />
        </View>

        {isLoading || !member ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body}>
            <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.avatar, { backgroundColor: colors.primary + "30" }]}>
                <Text style={[styles.avatarText, { color: colors.primary }]}>
                  {(member.user?.name || "?")[0].toUpperCase()}
                </Text>
              </View>
              <Text style={[styles.name, { color: colors.foreground }]}>{member.user?.name}</Text>
              {member.tradeType ? (
                <View style={[styles.tradeBadge, { backgroundColor: colors.scoreBackground }]}>
                  <Text style={[styles.tradeText, { color: colors.primary }]}>{member.tradeType}</Text>
                </View>
              ) : null}
              {member.companyName ? (
                <Text style={[styles.company, { color: colors.mutedForeground }]}>{member.companyName}</Text>
              ) : null}
              {archived ? (
                <View style={[styles.archivedBadge, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.archivedText, { color: colors.mutedForeground }]}>Archived</Text>
                </View>
              ) : null}

              <View style={styles.starsRow}>
                <RatingStars value={stats?.avgRating ?? 0} size={18} />
                <Text style={[styles.ratingText, { color: colors.mutedForeground }]}>
                  {stats?.avgRating ? stats.avgRating.toFixed(1) : "No ratings"}
                  {stats?.ratingCount ? ` · ${stats.ratingCount} review${stats.ratingCount === 1 ? "" : "s"}` : ""}
                </Text>
              </View>

              <View style={styles.statsRow}>
                <View style={styles.statBlock}>
                  <Text style={[styles.statValue, { color: colors.foreground }]}>{stats?.jobCount ?? 0}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Jobs</Text>
                </View>
                <View style={styles.statBlock}>
                  <Text style={[styles.statValue, { color: colors.foreground }]}>{stats?.completedCount ?? 0}</Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Completed</Text>
                </View>
                <View style={styles.statBlock}>
                  <Text style={[styles.statValue, { color: colors.foreground }]}>
                    {stats?.avgResponseMinutes != null
                      ? stats.avgResponseMinutes < 60
                        ? `${Math.round(stats.avgResponseMinutes)}m`
                        : `${Math.round(stats.avgResponseMinutes / 60)}h`
                      : "—"}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Avg response</Text>
                </View>
              </View>

              {member.phone && canSeeContact ? (
                <View style={styles.contactRow}>
                  <TouchableOpacity
                    style={[styles.contactBtn, { borderColor: colors.border }]}
                    onPress={callPhone}
                  >
                    <Feather name="phone" size={14} color={colors.primary} />
                    <Text style={[styles.contactText, { color: colors.foreground }]}>Call</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.contactBtn, { borderColor: colors.border }]}
                    onPress={messagePhone}
                  >
                    <Feather name="message-square" size={14} color={colors.primary} />
                    <Text style={[styles.contactText, { color: colors.foreground }]}>Text</Text>
                  </TouchableOpacity>
                </View>
              ) : null}
              {member.licenseNumber ? (
                <Text style={[styles.licenseText, { color: colors.mutedForeground }]}>
                  License #{member.licenseNumber}
                </Text>
              ) : null}
            </View>

            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>JOB HISTORY</Text>
            {!stats?.logs?.length ? (
              <Text style={[styles.empty, { color: colors.mutedForeground }]}>No jobs yet on this property.</Text>
            ) : (
              stats.logs.map((log) => {
                const rating = stats.ratings?.find((r) => r.workLogId === log.id);
                return (
                  <View
                    key={log.id}
                    style={[styles.jobCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  >
                    <View style={styles.jobHeader}>
                      <Text style={[styles.jobNote, { color: colors.foreground }]} numberOfLines={2}>
                        {log.note || "Work logged"}
                      </Text>
                      <View
                        style={[
                          styles.statusPill,
                          {
                            backgroundColor:
                              log.status === "done"
                                ? colors.scoreBackground
                                : log.status === "in_progress"
                                ? colors.muted
                                : colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusText,
                            {
                              color:
                                log.status === "done"
                                  ? colors.primary
                                  : colors.mutedForeground,
                            },
                          ]}
                        >
                          {log.status.replace("_", " ")}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.jobMeta}>
                      <Text style={[styles.jobMetaText, { color: colors.mutedForeground }]}>
                        {timeAgo(log.createdAt)}
                      </Text>
                      {rating ? (
                        <View style={styles.jobRating}>
                          <RatingStars value={rating.stars} size={12} />
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
              })
            )}

            {canManage ? (
              <TouchableOpacity
                onPress={handleArchiveToggle}
                style={[
                  styles.archiveBtn,
                  { borderColor: archived ? colors.primary : colors.border },
                ]}
                disabled={updateMember.isPending}
              >
                <Feather
                  name={archived ? "rotate-ccw" : "archive"}
                  size={14}
                  color={archived ? colors.primary : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.archiveText,
                    { color: archived ? colors.primary : colors.mutedForeground },
                  ]}
                >
                  {archived ? "Reactivate provider" : "Archive provider"}
                </Text>
              </TouchableOpacity>
            ) : null}
          </ScrollView>
        )}
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
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  body: { padding: 16, gap: 12, paddingBottom: 80 },
  profileCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 18,
    alignItems: "center",
    gap: 8,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 24, fontFamily: "Inter_700Bold" },
  name: { fontSize: 18, fontFamily: "Inter_700Bold" },
  tradeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 18 },
  tradeText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  company: { fontSize: 13, fontFamily: "Inter_400Regular" },
  archivedBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 14, marginTop: 4 },
  archivedText: { fontSize: 11, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" },
  starsRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  ratingText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    width: "100%",
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(127,127,127,0.2)",
  },
  statBlock: { alignItems: "center", gap: 2 },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 11, fontFamily: "Inter_500Medium" },
  contactRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  contactBtn: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 18,
  },
  contactText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  licenseText: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 6 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.7,
    marginTop: 8,
    marginBottom: 4,
  },
  empty: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", padding: 16 },
  jobCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  jobHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  jobNote: { fontSize: 14, fontFamily: "Inter_500Medium", flex: 1 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  statusText: { fontSize: 10, fontFamily: "Inter_600SemiBold", textTransform: "uppercase" },
  jobMeta: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  jobMetaText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  jobRating: { flexDirection: "row" },
  archiveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 12,
    borderWidth: 1,
    borderRadius: 12,
    marginTop: 8,
  },
  archiveText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
});
