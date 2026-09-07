import React, { useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { resolveStorageUrl } from "@/lib/uploads";
import { confirm } from "@/lib/confirm";
import {
  useListMyTeamInvites,
  useAcceptTeamInvite,
  useDeclineTeamInvite,
  getListMyTeamInvitesQueryKey,
  getListMyTeamQueryKey,
  type TeamRole,
} from "@workspace/api-client-react";

const ROLE_LABEL: Record<TeamRole, string> = {
  employee: "Employee",
  manager: "Manager",
  partner: "Partner",
};

export function TeamInvitesBanner() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { data, isLoading } = useListMyTeamInvites({
    query: { queryKey: getListMyTeamInvitesQueryKey() },
  });
  const accept = useAcceptTeamInvite();
  const decline = useDeclineTeamInvite();
  const [busyId, setBusyId] = useState<string | null>(null);

  const invites = data?.invites ?? [];
  if (isLoading || invites.length === 0) return null;

  async function handleAccept(leadClerkId: string, name: string) {
    setBusyId(leadClerkId);
    try {
      await accept.mutateAsync({ leadClerkId });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListMyTeamInvitesQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getListMyTeamQueryKey() }),
      ]);
    } catch (e) {
      Alert.alert("Couldn't accept invite", e instanceof Error ? e.message : `Try accepting ${name}'s invite again.`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDecline(leadClerkId: string, name: string) {
    // #627: Use the cross-platform confirm helper so the dialog actually
    // surfaces on react-native-web and native alike.
    const proceed = await confirm({
      title: "Decline invite?",
      message: `Decline the team invite from ${name}?`,
      confirmLabel: "Decline",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!proceed) return;
    setBusyId(leadClerkId);
    try {
      await decline.mutateAsync({ leadClerkId });
      await queryClient.invalidateQueries({ queryKey: getListMyTeamInvitesQueryKey() });
    } catch (e) {
      Alert.alert("Couldn't decline invite", e instanceof Error ? e.message : "Try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={s.headerRow}>
        <Text style={[s.label, { color: colors.mutedForeground }]}>TEAM INVITES</Text>
        <View style={[s.badge, { backgroundColor: colors.primary + "20" }]}>
          <Text style={[s.badgeText, { color: colors.primary }]}>{invites.length}</Text>
        </View>
      </View>
      <View style={[s.list, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {invites.map((inv, idx) => {
          const avatar = resolveStorageUrl(inv.avatarUrl ?? null, null);
          const busy = busyId === inv.leadClerkId;
          return (
            <View
              key={inv.leadClerkId}
              style={[
                s.row,
                {
                  borderTopColor: colors.border,
                  borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                },
              ]}
            >
              <View style={[s.avatar, { backgroundColor: colors.muted }]}>
                {avatar ? (
                  <Image source={{ uri: avatar }} style={s.avatarImg} />
                ) : (
                  <Text style={[s.avatarInitial, { color: colors.mutedForeground }]}>
                    {(inv.name || "?").trim().charAt(0).toUpperCase()}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[s.name, { color: colors.foreground }]} numberOfLines={1}>
                  {inv.name}
                </Text>
                <Text style={[s.subtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
                  @{inv.username} · invited you as {ROLE_LABEL[inv.role]}
                </Text>
              </View>
              <View style={s.actions}>
                {busy ? (
                  <ActivityIndicator color={colors.foreground} />
                ) : (
                  <>
                    <Pressable
                      accessibilityLabel={`Decline invite from ${inv.name}`}
                      onPress={() => handleDecline(inv.leadClerkId, inv.name)}
                      hitSlop={8}
                      style={[s.declineBtn, { borderColor: colors.border }]}
                    >
                      <Feather name="x" size={14} color={colors.mutedForeground} />
                    </Pressable>
                    <Pressable
                      accessibilityLabel={`Accept invite from ${inv.name}`}
                      onPress={() => handleAccept(inv.leadClerkId, inv.name)}
                      style={[s.acceptBtn, { backgroundColor: colors.primary }]}
                    >
                      <Feather name="check" size={14} color={colors.primaryForeground ?? "#fff"} />
                      <Text style={[s.acceptText, { color: colors.primaryForeground ?? "#fff" }]}>
                        Accept
                      </Text>
                    </Pressable>
                  </>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  label: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  badgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
  list: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 12 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarInitial: { fontSize: 16, fontFamily: "Inter_700Bold" },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  subtitle: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  declineBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    height: 32,
    borderRadius: 16,
  },
  acceptText: { fontSize: 13, fontFamily: "Inter_700Bold" },
});
