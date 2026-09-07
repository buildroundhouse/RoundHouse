import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { confirm as crossPlatformConfirm } from "@/lib/confirm";
import { Stack, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import {
  cancelAppInvite,
  getGetAppInviteShareContextQueryKey,
  resendAppInvite,
  useGetAppInviteShareContext,
  useListMyAppInvites,
  type AppInvite,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { MODE_LABELS } from "@/lib/intake-schemas";
import { resolveStorageUrl } from "@/lib/uploads";
import { extractApiErrorMessage } from "@/lib/apiErrorMessage";
import {
  buildCancelConfirmCopy,
  canCancelInvite,
  performCancelInvite,
} from "@/lib/cancelInvite";
import { PublicProfileModal } from "@/components/PublicProfileModal";
import { InviteSendOptions } from "@/components/InviteSendOptions";

type SendSheet = {
  smsUri: string;
  smsBody: string;
  recipientName: string;
};

export default function PeopleIveInvitedScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useListMyAppInvites();
  const { data: shareCtx } = useGetAppInviteShareContext({
    query: { queryKey: getGetAppInviteShareContextQueryKey() },
  });
  const [viewClerkId, setViewClerkId] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<{ id: number; msg: string } | null>(null);
  // After Resend, show the send-options sheet so the user can tap "Open
  // Messages" with a fresh user-gesture (iOS Safari blocks `sms:` launches
  // that come from a post-await callback) or copy the message text.
  const [sendSheet, setSendSheet] = useState<SendSheet | null>(null);

  const summary = data?.summary;
  const invites = data?.invites ?? [];

  // The list endpoint lazy-expires past-due invites server-side. Once that
  // happens (or after a cancel/resend), the rolling 24h cap may have freed
  // up a slot — invalidate share-context so the share modal's CTA reflects
  // the bounce-back without forcing the user to reopen it.
  useEffect(() => {
    if (!data) return;
    void queryClient.invalidateQueries({
      queryKey: getGetAppInviteShareContextQueryKey(),
    });
  }, [data, queryClient]);

  const runCancel = async (invite: AppInvite) => {
    setRowError(null);
    setCancellingId(invite.id);
    const result = await performCancelInvite({
      inviteId: invite.id,
      cancelFn: cancelAppInvite,
      refetchList: refetch,
      invalidateShareContext: () =>
        queryClient.invalidateQueries({
          queryKey: getGetAppInviteShareContextQueryKey(),
        }),
    });
    if (!result.ok) {
      setRowError({ id: invite.id, msg: result.errorMessage });
    }
    setCancellingId(null);
  };

  const handleCancel = async (invite: AppInvite) => {
    const copy = buildCancelConfirmCopy(invite);
    // #627: Use the cross-platform confirm helper so the dialog actually
    // surfaces on react-native-web and native alike.
    const ok = await crossPlatformConfirm({
      title: copy.title,
      message: copy.message,
      confirmLabel: copy.confirmLabel,
      cancelLabel: copy.cancelLabel,
      destructive: true,
    });
    if (ok) void runCancel(invite);
  };

  const handleResend = async (invite: AppInvite) => {
    setRowError(null);
    setResendingId(invite.id);
    try {
      const res = await resendAppInvite(invite.id);
      await refetch();
      void queryClient.invalidateQueries({
        queryKey: getGetAppInviteShareContextQueryKey(),
      });
      // Don't auto-launch sms: from a post-await callback — iOS Safari
      // silently blocks it. Show the send-options sheet so the user's
      // next tap carries a fresh user-gesture context.
      setSendSheet({
        smsUri: res.smsUri,
        smsBody: res.smsBody,
        recipientName: invite.recipientName,
      });
    } catch (e) {
      void queryClient.invalidateQueries({
        queryKey: getGetAppInviteShareContextQueryKey(),
      });
      setRowError({
        id: invite.id,
        msg: extractApiErrorMessage(e, "Couldn't resend that invite."),
      });
    } finally {
      setResendingId(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "People I've invited" }} />
      <FlatList
        data={invites}
        keyExtractor={(it) => String(it.id)}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              People I've invited
            </Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              You earn 10 points every time someone you invited finishes signing up.
            </Text>
            <DailyCapBanner
              limit={shareCtx?.dailyLimit ?? null}
              remaining={shareCtx?.dailyRemaining ?? null}
              colors={colors}
            />
            <View style={styles.statsRow}>
              <Stat label="Sent" value={summary?.sent ?? 0} colors={colors} />
              <Stat label="Signed up" value={summary?.signedUp ?? 0} colors={colors} />
              <Stat
                label="Conversion"
                value={`${summary?.conversionPct ?? 0}%`}
                colors={colors}
              />
              <Stat
                label="Points"
                value={summary?.pointsEarned ?? 0}
                colors={colors}
                accent
              />
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <InviteRow
            invite={item}
            colors={colors}
            resending={resendingId === item.id}
            cancelling={cancellingId === item.id}
            errorMsg={rowError?.id === item.id ? rowError.msg : null}
            onResend={() => handleResend(item)}
            onCancel={() => handleCancel(item)}
            onViewProfile={(id) => setViewClerkId(id)}
          />
        )}
        ItemSeparatorComponent={() => (
          <View style={[styles.sep, { backgroundColor: colors.border }]} />
        )}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.empty}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : isError ? (
            <View style={styles.empty}>
              <Text style={[styles.muted, { color: colors.destructive }]}>
                Couldn't load your invites.
              </Text>
              <Pressable onPress={() => refetch()} style={styles.linkBtn}>
                <Text style={[styles.linkText, { color: colors.primary }]}>
                  Try again
                </Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.empty}>
              <Feather name="send" size={28} color={colors.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                No invites yet
              </Text>
              <Text style={[styles.muted, { color: colors.mutedForeground }]}>
                Tap "Share Round House" on your Profile to invite someone.
              </Text>
              <Pressable onPress={() => router.back()} style={styles.linkBtn}>
                <Text style={[styles.linkText, { color: colors.primary }]}>
                  Back to Profile
                </Text>
              </Pressable>
            </View>
          )
        }
      />
      <PublicProfileModal
        visible={!!viewClerkId}
        clerkId={viewClerkId}
        onClose={() => setViewClerkId(null)}
      />
      <Modal
        visible={!!sendSheet}
        animationType="slide"
        transparent
        onRequestClose={() => setSendSheet(null)}
      >
        <View style={styles.sheetBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setSendSheet(null)}
          />
          <View style={[styles.sheet, { backgroundColor: colors.background }]}>
            {sendSheet ? (
              <InviteSendOptions
                smsUri={sendSheet.smsUri}
                smsBody={sendSheet.smsBody}
                recipientName={sendSheet.recipientName}
                onDone={() => setSendSheet(null)}
              />
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DailyCapBanner({
  limit,
  remaining,
  colors,
}: {
  limit: number | null;
  remaining: number | null;
  colors: ReturnType<typeof useColors>;
}) {
  if (limit === null || remaining === null) return null;
  const used = Math.max(0, Math.min(limit, limit - remaining));
  const reached = remaining <= 0;
  const low = !reached && remaining <= 3;
  const borderColor = reached
    ? colors.destructive
    : low
      ? "#E0B400"
      : colors.border;
  const tint = reached
    ? `${colors.destructive}11`
    : low
      ? "rgba(224,180,0,0.12)"
      : colors.card;
  const iconColor = reached
    ? colors.destructive
    : low
      ? "#E0B400"
      : colors.mutedForeground;
  const iconName: React.ComponentProps<typeof Feather>["name"] = reached
    ? "slash"
    : low
      ? "alert-circle"
      : "clock";
  const message = reached
    ? `You've hit your daily invite limit (${limit} per 24 hours). Try again tomorrow.`
    : low
      ? `${used} of ${limit} invites used today — ${remaining} left in the next 24 hours.`
      : `${used} of ${limit} invites used today.`;
  const stateLabel = reached ? "reached" : low ? "low" : "default";
  return (
    <View
      testID={`daily-cap-banner-${stateLabel}`}
      style={[
        styles.capBanner,
        { borderColor, backgroundColor: tint },
      ]}
    >
      <Feather name={iconName} size={16} color={iconColor} />
      <Text style={[styles.capText, { color: colors.foreground }]}>
        {message}
      </Text>
    </View>
  );
}

function Stat({
  label,
  value,
  colors,
  accent,
}: {
  label: string;
  value: number | string;
  colors: ReturnType<typeof useColors>;
  accent?: boolean;
}) {
  return (
    <View
      style={[
        styles.stat,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text
        style={[
          styles.statValue,
          { color: accent ? colors.primary : colors.foreground },
        ]}
      >
        {value}
      </Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
    </View>
  );
}

function InviteRow({
  invite,
  colors,
  resending,
  cancelling,
  errorMsg,
  onResend,
  onCancel,
  onViewProfile,
}: {
  invite: AppInvite;
  colors: ReturnType<typeof useColors>;
  resending: boolean;
  cancelling: boolean;
  errorMsg: string | null;
  onResend: () => void;
  onCancel: () => void;
  onViewProfile: (clerkId: string) => void;
}) {
  const invitedAs = MODE_LABELS[invite.invitedKind] ?? invite.invitedKind;
  const acceptedAs = invite.acceptedKind
    ? MODE_LABELS[invite.acceptedKind] ?? invite.acceptedKind
    : null;
  const signedUp = invite.status === "signed_up";
  const isSent = invite.status === "sent";
  const showCancel = canCancelInvite(invite.status);
  const avatarUri = resolveStorageUrl(invite.acceptedByAvatarUrl ?? null);
  const sentDate = formatSentDate(invite.sentAt ?? invite.createdAt);
  const canViewProfile = signedUp && !!invite.acceptedByClerkId;

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.avatar,
          {
            backgroundColor: colors.muted,
            borderColor: signedUp ? colors.primary : colors.border,
          },
        ]}
      >
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
        ) : (
          <Feather name="user" size={20} color={colors.mutedForeground} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
          {invite.acceptedByName?.trim() || invite.recipientName}
        </Text>
        <Text style={[styles.rowMeta, { color: colors.mutedForeground }]} numberOfLines={2}>
          {invite.recipientPhoneMasked} · invited as {invitedAs}
          {signedUp && acceptedAs ? ` → joined as ${acceptedAs}` : ""}
        </Text>
        <Text style={[styles.rowDate, { color: colors.mutedForeground }]}>
          {sentDate ? `Sent ${sentDate}` : ""}
        </Text>
        {signedUp && invite.acceptedByTierLabel ? (
          <Text
            style={[styles.rowSignal, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            Currently {invite.acceptedByTierLabel} tier
          </Text>
        ) : null}
        {errorMsg ? (
          <Text style={[styles.rowError, { color: colors.destructive }]}>{errorMsg}</Text>
        ) : null}
        <View style={styles.rowActions}>
          {isSent ? (
            <Pressable
              onPress={onResend}
              disabled={resending || cancelling}
              accessibilityRole="button"
              style={[
                styles.actionBtn,
                {
                  borderColor: colors.border,
                  opacity: resending || cancelling ? 0.6 : 1,
                },
              ]}
            >
              {resending ? (
                <ActivityIndicator size="small" color={colors.foreground} />
              ) : (
                <>
                  <Feather name="send" size={12} color={colors.foreground} />
                  <Text style={[styles.actionText, { color: colors.foreground }]}>
                    Resend
                  </Text>
                </>
              )}
            </Pressable>
          ) : null}
          {showCancel ? (
            <Pressable
              onPress={onCancel}
              disabled={resending || cancelling}
              accessibilityRole="button"
              accessibilityLabel={`Cancel invite to ${invite.recipientName}`}
              style={[
                styles.actionBtn,
                {
                  borderColor: colors.destructive,
                  opacity: resending || cancelling ? 0.6 : 1,
                },
              ]}
            >
              {cancelling ? (
                <ActivityIndicator size="small" color={colors.destructive} />
              ) : (
                <>
                  <Feather name="x" size={12} color={colors.destructive} />
                  <Text
                    style={[styles.actionText, { color: colors.destructive }]}
                  >
                    Cancel
                  </Text>
                </>
              )}
            </Pressable>
          ) : null}
          {canViewProfile ? (
            <Pressable
              onPress={() => onViewProfile(invite.acceptedByClerkId!)}
              accessibilityRole="button"
              style={[styles.actionBtn, { borderColor: colors.border }]}
            >
              <Feather name="user" size={12} color={colors.foreground} />
              <Text style={[styles.actionText, { color: colors.foreground }]}>
                View profile
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <View style={styles.rowEnd}>
        <View
          style={[
            styles.statusPill,
            {
              backgroundColor: signedUp
                ? `${colors.primary}1F`
                : colors.muted,
            },
          ]}
        >
          <Text
            style={[
              styles.statusText,
              { color: signedUp ? colors.primary : colors.mutedForeground },
            ]}
          >
            {labelForStatus(invite.status)}
          </Text>
        </View>
        {signedUp ? (
          <Text style={[styles.points, { color: colors.primary }]}>+10 pts</Text>
        ) : null}
      </View>
    </View>
  );
}

function labelForStatus(s: AppInvite["status"]): string {
  switch (s) {
    case "signed_up":
      return "Joined";
    case "sent":
      return "Sent";
    case "expired":
      return "Expired";
    case "cancelled":
      return "Cancelled";
    default:
      return s;
  }
}

function formatSentDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 24,
    maxHeight: "90%",
  },
  listContent: { paddingBottom: 40 },
  header: { padding: 18, gap: 8 },
  title: { fontSize: 22, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18 },
  statsRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  capBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
  },
  capText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 16 },
  stat: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  statValue: { fontSize: 18, fontFamily: "Inter_700Bold" },
  statLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
    textAlign: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImg: { width: "100%", height: "100%" },
  rowName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  rowDate: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  rowSignal: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 2 },
  rowError: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 4 },
  rowActions: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  actionText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  rowEnd: { alignItems: "flex-end", gap: 4 },
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  points: { fontSize: 11, fontFamily: "Inter_700Bold" },
  sep: { height: StyleSheet.hairlineWidth },
  empty: { paddingVertical: 60, paddingHorizontal: 24, alignItems: "center", gap: 8 },
  emptyTitle: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  muted: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center" },
  linkBtn: { padding: 8 },
  linkText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
