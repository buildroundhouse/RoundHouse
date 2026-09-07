import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  ApiError,
  useListMyBusinessInvites,
  useSendBusinessInvite,
  useListMyTeamUpRequests,
  useRespondToTeamUpRequest,
  useListMyTeamSeatInvites,
  useAcceptMyTeamSeatInvite,
  useDeclineMyTeamSeatInvite,
  getListMyTeamQueryKey,
  type MyBusinessInvite,
  type BusinessInviteStatus,
  type TeamUpRequest,
  type MyTeamSeatInvite,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  TRADE_PRO_TEAMMATE_OPTIONS,
  FACILITY_TEAMMATE_OPTIONS,
} from "@/lib/connectionTags";

export default function InvitesScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { data, isLoading, refetch, isRefetching } = useListMyBusinessInvites();
  const teamUpKey = ["/api/users/me/team-up-requests"] as const;
  const teamUp = useListMyTeamUpRequests({
    query: { queryKey: teamUpKey },
  });
  const respond = useRespondToTeamUpRequest();
  const [respondingId, setRespondingId] = useState<number | null>(null);
  // #522 — pending team-seat invites with chip picker.
  const seatInvitesKey = ["/api/users/me/team-seat-invites"] as const;
  const seatInvites = useListMyTeamSeatInvites({
    query: { queryKey: seatInvitesKey },
  });
  const acceptSeat = useAcceptMyTeamSeatInvite();
  const declineSeat = useDeclineMyTeamSeatInvite();
  const [seatBusyId, setSeatBusyId] = useState<number | null>(null);
  const sendInvite = useSendBusinessInvite();
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [banner, setBanner] = useState<
    {
      kind: "success" | "error";
      text: string;
      // Task #721 — When true, surface a one-tap shortcut into the
      // inbox after accepting a team-up request. Avatar-to-avatar DMs
      // were removed in the entity-membership-and-messaging cutover,
      // so we no longer have a deterministic per-skin chat target —
      // the shortcut now just opens the entity-thread index.
      showOpenInbox?: boolean;
    } | null
  >(null);

  async function handleRespond(req: TeamUpRequest, action: "accept" | "decline") {
    if (respondingId !== null || !req.otherClerkId) return;
    setRespondingId(req.id);
    try {
      await respond.mutateAsync({
        userId: req.otherClerkId,
        data: {
          action,
          // #501: disambiguate when the same user has multiple skins
          // sending pending requests to ours.
          requesterOutwardAccountId: req.otherOutwardAccountId,
        },
      });
      // Task #721 — Avatar-to-avatar DMs were removed in the
      // entity-membership-and-messaging cutover, so accepting no
      // longer unlocks a `/conversations` thread to invalidate. The
      // team-up list itself is the only cache that needs refreshing.
      await queryClient.invalidateQueries({ queryKey: teamUpKey });
      setBanner({
        kind: "success",
        text:
          action === "accept"
            ? `You're now connected with ${req.otherName}.`
            : `Declined the request from ${req.otherName}.`,
        // Task #721 — Offer a shortcut into the inbox so people can
        // jump to the threads of the entities they share with the
        // newly-accepted teammate. The legacy DM deep-link (which
        // used the other skin's outward-account id) no longer maps
        // to a real surface post-cutover.
        showOpenInbox: action === "accept",
      });
    } catch (e) {
      setBanner({
        kind: "error",
        text:
          e instanceof Error && e.message
            ? e.message
            : "Could not record your response. Please try again.",
      });
    } finally {
      setRespondingId(null);
    }
  }

  async function handleAcceptSeat(
    invite: MyTeamSeatInvite,
    chip: string | null,
    chipOther: string | null,
  ) {
    if (seatBusyId !== null) return;
    setSeatBusyId(invite.id);
    setBanner(null);
    try {
      const body: { chip?: string | null; chipOther?: string | null } = {};
      if (chip !== null) {
        body.chip = chip;
        if (chip === "other") body.chipOther = chipOther ?? null;
      }
      await acceptSeat.mutateAsync({ seatId: invite.id, data: body });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: seatInvitesKey }),
        // So the chip immediately renders next to my name in TeamSection.
        queryClient.invalidateQueries({ queryKey: getListMyTeamQueryKey() }),
      ]);
      // Surfaced chip will render in TeamSection on next visit.
      setBanner({
        kind: "success",
        text: `You've joined ${seatLabel(invite)}.`,
      });
    } catch (e) {
      const fallback = "Could not accept the invite. Please try again.";
      let message = fallback;
      if (e instanceof ApiError) {
        const detail =
          e.data && typeof e.data === "object" && "error" in e.data
            ? String((e.data as { error?: unknown }).error ?? "")
            : "";
        message = detail.trim() || fallback;
      } else if (e instanceof Error) {
        message = e.message || fallback;
      }
      setBanner({ kind: "error", text: message });
    } finally {
      setSeatBusyId(null);
    }
  }

  async function handleDeclineSeat(invite: MyTeamSeatInvite) {
    if (seatBusyId !== null) return;
    setSeatBusyId(invite.id);
    setBanner(null);
    try {
      await declineSeat.mutateAsync({ seatId: invite.id });
      await queryClient.invalidateQueries({ queryKey: seatInvitesKey });
      setBanner({
        kind: "success",
        text: `Declined the invite from ${seatLabel(invite)}.`,
      });
    } catch (e) {
      setBanner({
        kind: "error",
        text:
          e instanceof Error && e.message
            ? e.message
            : "Could not decline the invite. Please try again.",
      });
    } finally {
      setSeatBusyId(null);
    }
  }

  useEffect(() => {
    if (!banner) return;
    // #597 / #721 — give people more time to notice and tap the
    // Open inbox shortcut after accepting a team-up request.
    const ttl = banner.showOpenInbox ? 8000 : 4000;
    const t = setTimeout(() => setBanner(null), ttl);
    return () => clearTimeout(t);
  }, [banner]);

  const invites = data?.invites ?? [];
  const topPad = Platform.OS === "web" ? 16 : insets.top + 8;
  const bottomPad = Platform.OS === "web" ? 60 : insets.bottom + 24;

  async function handleResend(invite: MyBusinessInvite) {
    if (resendingId !== null) return;
    setResendingId(invite.id);
    setBanner(null);
    try {
      await sendInvite.mutateAsync({
        data: {
          email: invite.email,
          businessName: invite.businessName ?? null,
        },
      });
      setBanner({
        kind: "success",
        text: `Invite resent to ${invite.businessName || invite.email}.`,
      });
      await refetch();
    } catch (e) {
      const fallback = "Could not resend the invite. Please try again.";
      let message = fallback;
      if (e instanceof ApiError) {
        const detail =
          e.data && typeof e.data === "object" && "error" in e.data
            ? String((e.data as { error?: unknown }).error ?? "")
            : "";
        message = detail.trim() || fallback;
      } else if (e instanceof Error) {
        message = e.message || fallback;
      }
      setBanner({ kind: "error", text: message });
    } finally {
      setResendingId(null);
    }
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View
        style={[
          styles.header,
          { paddingTop: topPad, borderBottomColor: colors.border },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Back"
          hitSlop={12}
          style={styles.iconBtn}
        >
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>
          My invites
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {banner ? (
        <View
          style={[
            styles.banner,
            {
              backgroundColor:
                banner.kind === "success"
                  ? colors.scoreBackground
                  : colors.destructive + "1A",
              borderColor: colors.border,
            },
          ]}
        >
          <Feather
            name={banner.kind === "success" ? "check-circle" : "alert-circle"}
            size={16}
            color={
              banner.kind === "success" ? colors.primary : colors.destructive
            }
          />
          <Text
            style={[styles.bannerText, { color: colors.foreground }]}
            numberOfLines={2}
          >
            {banner.text}
          </Text>
          {banner.kind === "success" && banner.showOpenInbox ? (
            <Pressable
              onPress={() => {
                setBanner(null);
                // Task #721 — DM threads keyed on the other skin's
                // outward-account id are gone post-cutover. Jump to
                // the entity-thread index instead so people can pick
                // the shared property/business they want to message in.
                router.push("/inbox" as never);
              }}
              accessibilityLabel="Open inbox"
              hitSlop={8}
              style={({ pressed }) => [
                styles.bannerAction,
                {
                  borderColor: colors.primary,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Feather
                name="message-circle"
                size={12}
                color={colors.primary}
              />
              <Text
                style={[styles.bannerActionText, { color: colors.primary }]}
              >
                Open inbox
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => setBanner(null)} hitSlop={8}>
            <Feather name="x" size={14} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ) : null}

      {(seatInvites.data?.invites?.length ?? 0) > 0 ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 12, gap: 10 }}>
          <Text
            style={[styles.sectionTitle, { color: colors.foreground }]}
          >
            Workplace invites
          </Text>
          {(seatInvites.data?.invites ?? []).map((inv) => (
            <SeatInviteRow
              key={inv.id}
              invite={inv}
              busy={seatBusyId === inv.id}
              onAccept={(chip, chipOther) =>
                handleAcceptSeat(inv, chip, chipOther)
              }
              onDecline={() => handleDeclineSeat(inv)}
            />
          ))}
        </View>
      ) : null}

      {/*
        Task #663 — Avatar-to-avatar "Team-up requests" section retired.
        The endpoint now always returns `{incoming:[],outgoing:[]}` so
        this block was already invisible, but we drop the JSX and the
        TeamUpRow surface entirely so future contributors don't try to
        revive it. All accept/decline now flows through the
        entity-membership notifications in the Notifications tab.
      */}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : invites.length === 0 ? (
        <View style={styles.empty}>
          <Feather name="mail" size={28} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            No invites yet
          </Text>
          <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
            Invite a business from the Find tab and it will show up here so you
            can track whether the email went out.
          </Text>
        </View>
      ) : (
        <FlatList
          data={invites}
          keyExtractor={(it) => String(it.id)}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: bottomPad,
            gap: 10,
          }}
          refreshing={isRefetching}
          onRefresh={refetch}
          renderItem={({ item }) => (
            <InviteRow
              invite={item}
              resending={resendingId === item.id}
              onResend={() => handleResend(item)}
            />
          )}
        />
      )}
    </View>
  );
}

function InviteRow({
  invite,
  resending,
  onResend,
}: {
  invite: MyBusinessInvite;
  resending: boolean;
  onResend: () => void;
}) {
  const colors = useColors();
  const titleText = invite.businessName?.trim() || invite.email;
  const subText =
    invite.businessName && invite.businessName.trim().length > 0
      ? invite.email
      : null;
  const timestamp =
    invite.sentAt ??
    invite.acceptedAt ??
    invite.createdAt;
  const timestampLabel = formatTimestamp(timestamp);
  const timestampPrefix =
    invite.status === "accepted"
      ? "Accepted"
      : invite.status === "sent"
        ? "Sent"
        : invite.status === "failed"
          ? "Tried"
          : "Created";
  const canResend = invite.status === "failed";

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={[styles.rowName, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {titleText}
        </Text>
        {subText ? (
          <Text
            style={[styles.rowSub, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {subText}
          </Text>
        ) : null}
        <View style={styles.metaRow}>
          <StatusPill status={invite.status} />
          {timestampLabel ? (
            <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
              {`${timestampPrefix} ${timestampLabel}`}
            </Text>
          ) : null}
        </View>
        {invite.status === "failed" && invite.sendError ? (
          <Text
            style={[styles.errorText, { color: colors.destructive }]}
            numberOfLines={2}
          >
            {invite.sendError}
          </Text>
        ) : null}
      </View>
      {canResend ? (
        <Pressable
          onPress={onResend}
          disabled={resending}
          accessibilityRole="button"
          accessibilityLabel={`Resend invite to ${titleText}`}
          style={[
            styles.resendBtn,
            {
              borderColor: colors.border,
              backgroundColor: colors.background,
              opacity: resending ? 0.7 : 1,
            },
          ]}
        >
          {resending ? (
            <ActivityIndicator color={colors.foreground} size="small" />
          ) : (
            <>
              <Feather name="refresh-cw" size={13} color={colors.foreground} />
              <Text style={[styles.resendText, { color: colors.foreground }]}>
                Resend
              </Text>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function TeamUpRow({
  req,
  busy,
  onAccept,
  onDecline,
  onIgnore,
}: {
  req: TeamUpRequest;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onIgnore: () => void;
}) {
  const colors = useColors();
  const title = req.otherName?.trim() || req.otherCompanyName?.trim() || "Someone";
  const sub =
    req.otherCompanyName && req.otherCompanyName !== req.otherName
      ? req.otherCompanyName
      : null;
  const note = req.personalNote?.trim() || req.inviteMessage?.trim() || null;
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          flexDirection: "column",
          alignItems: "stretch",
          gap: 10,
        },
      ]}
    >
      <View>
        <Text
          style={[styles.rowName, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {sub ? (
          <Text
            style={[styles.rowSub, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {sub}
          </Text>
        ) : null}
        {note ? (
          <Text
            style={[
              styles.rowSub,
              { color: colors.foreground, marginTop: 6, lineHeight: 18 },
            ]}
            numberOfLines={4}
          >
            {note}
          </Text>
        ) : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Pressable
          onPress={onDecline}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Decline request from ${title}`}
          style={[
            styles.resendBtn,
            {
              borderColor: colors.border,
              backgroundColor: colors.background,
              opacity: busy ? 0.6 : 1,
              flexGrow: 1,
              flexBasis: 90,
            },
          ]}
        >
          <Text style={[styles.resendText, { color: colors.foreground }]}>
            Decline
          </Text>
        </Pressable>
        <Pressable
          onPress={onIgnore}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Ignore request from ${title}`}
          style={[
            styles.resendBtn,
            {
              borderColor: colors.border,
              backgroundColor: colors.background,
              opacity: busy ? 0.6 : 1,
              flexGrow: 1,
              flexBasis: 90,
            },
          ]}
        >
          <Text style={[styles.resendText, { color: colors.foreground }]}>
            Ignore
          </Text>
        </Pressable>
        <Pressable
          onPress={onAccept}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Accept request from ${title}`}
          style={[
            styles.resendBtn,
            {
              borderColor: colors.primary,
              backgroundColor: colors.primary,
              opacity: busy ? 0.6 : 1,
              flexGrow: 1,
              flexBasis: 90,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryForeground} size="small" />
          ) : (
            <Text
              style={[styles.resendText, { color: colors.primaryForeground }]}
            >
              Accept
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function seatLabel(invite: MyTeamSeatInvite): string {
  return (
    invite.skinDisplayName?.trim() ||
    invite.skinCompanyName?.trim() ||
    invite.skinTitle?.trim() ||
    "this team"
  );
}

function SeatInviteRow({
  invite,
  busy,
  onAccept,
  onDecline,
}: {
  invite: MyTeamSeatInvite;
  busy: boolean;
  onAccept: (chip: string | null, chipOther: string | null) => void;
  onDecline: () => void;
}) {
  const colors = useColors();
  const title = seatLabel(invite);
  const sub =
    invite.isAdmin
      ? "Admin access"
      : invite.role
        ? `${invite.role[0].toUpperCase()}${invite.role.slice(1)}`
        : null;

  // #522 — drive curated chip vocabulary off the inviting company's kind.
  const chipOptions =
    invite.skinKind === "trade_pro"
      ? TRADE_PRO_TEAMMATE_OPTIONS
      : invite.skinKind === "facilities"
        ? FACILITY_TEAMMATE_OPTIONS
        : null;

  const [selectedChip, setSelectedChip] = useState<string | null>(
    invite.chip ?? null,
  );
  const [chipOther, setChipOther] = useState<string>(invite.chipOther ?? "");

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          flexDirection: "column",
          alignItems: "stretch",
          gap: 10,
        },
      ]}
    >
      <View>
        <Text
          style={[styles.rowName, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {sub ? (
          <Text
            style={[styles.rowSub, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {sub}
          </Text>
        ) : null}
      </View>

      {chipOptions ? (
        <View style={{ gap: 8 }}>
          <Text
            style={[styles.chipHint, { color: colors.mutedForeground }]}
          >
            Pick how you'll show up on the team (optional)
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingRight: 4 }}
          >
            {chipOptions.map((opt) => {
              const active = selectedChip === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() =>
                    setSelectedChip(active ? null : opt.value)
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Choose chip ${opt.label}`}
                  style={[
                    styles.chipBtn,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active
                        ? colors.primary + "1A"
                        : colors.background,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipBtnText,
                      {
                        color: active ? colors.primary : colors.foreground,
                      },
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {selectedChip === "other" ? (
            <TextInput
              value={chipOther}
              onChangeText={setChipOther}
              placeholder="Type a label (e.g. Foreman)"
              placeholderTextColor={colors.mutedForeground}
              maxLength={80}
              style={[
                styles.chipInput,
                {
                  borderColor: colors.border,
                  color: colors.foreground,
                  backgroundColor: colors.background,
                },
              ]}
            />
          ) : null}
        </View>
      ) : null}

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Pressable
          onPress={onDecline}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Decline invite to ${title}`}
          style={[
            styles.resendBtn,
            {
              borderColor: colors.border,
              backgroundColor: colors.background,
              opacity: busy ? 0.6 : 1,
              flex: 1,
            },
          ]}
        >
          <Text style={[styles.resendText, { color: colors.foreground }]}>
            Decline
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            const chip = selectedChip;
            const other =
              chip === "other" ? chipOther.trim() || null : null;
            onAccept(chip, other);
          }}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Accept invite to ${title}`}
          style={[
            styles.resendBtn,
            {
              borderColor: colors.primary,
              backgroundColor: colors.primary,
              opacity: busy ? 0.6 : 1,
              flex: 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryForeground} size="small" />
          ) : (
            <Text
              style={[styles.resendText, { color: colors.primaryForeground }]}
            >
              Accept
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

function StatusPill({ status }: { status: BusinessInviteStatus }) {
  const colors = useColors();
  const palette: Record<
    BusinessInviteStatus,
    { bg: string; fg: string; label: string }
  > = {
    pending: {
      bg: colors.muted,
      fg: colors.mutedForeground,
      label: "Pending",
    },
    sent: {
      bg: colors.primary + "26",
      fg: colors.primary,
      label: "Sent",
    },
    failed: {
      bg: colors.destructive + "1F",
      fg: colors.destructive,
      label: "Failed",
    },
    accepted: {
      bg: colors.scoreBackground,
      fg: colors.primary,
      label: "Accepted",
    },
  };
  const tone = palette[status];
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.pillText, { color: tone.fg }]}>{tone.label}</Text>
    </View>
  );
}

function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const now = Date.now();
  const diffMs = now - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  sectionTitle: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  bannerText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    lineHeight: 18,
  },
  bannerAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  bannerActionText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
    marginTop: 4,
  },
  emptyBody: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 19,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  rowName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowSub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  metaText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  errorText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginTop: 6,
    lineHeight: 17,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pillText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  resendBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 9,
    borderWidth: 1,
    minWidth: 88,
    justifyContent: "center",
  },
  resendText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  chipHint: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  chipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipBtnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  chipInput: {
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
});
