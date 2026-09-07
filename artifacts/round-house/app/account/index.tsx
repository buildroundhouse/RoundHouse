import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { confirm } from "@/lib/confirm";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/lib/profile";
import { resolveStorageUrl } from "@/lib/uploads";
import {
  useArchiveOutwardAccount,
  useListMyArchivedOutwardAccounts,
  useListRecentlyDeletedOutwardAccounts,
  usePurgeOutwardAccount,
  useRestoreOutwardAccount,
  useSwitchActiveOutwardAccount,
  useUnarchiveOutwardAccount,
  type OutwardAccount,
} from "@workspace/api-client-react";

const KIND_LABEL: Partial<Record<OutwardAccount["kind"], string>> = {
  trade_pro: "Trade Pro",
  home: "Home",
  facilities: "Facility Management",
};

// Mirror of PER_KIND_CREATE_CAPS in app/account/create.tsx (and the
// server). Surfaced here so the list screen can show the same compact
// "X / N used" counter the create screen shows on every option, giving
// users a heads-up about remaining headroom before they tap "New".
const PER_KIND_CREATE_CAPS: Partial<Record<OutwardAccount["kind"], number>> = {
  trade_pro: 5,
  facilities: 5,
};

/**
 * Settings entry point that splits the user's identity into two clear
 * sections: their **personal profile** (private — login, real name,
 * avatar, email) and their **outward-facing accounts** (public skins).
 *
 * The list shows every active outward account, lets the user switch /
 * edit / archive, and exposes the create flow.
 */
export default function AccountIndexScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    profile,
    outwardAccounts,
    activeOutwardAccount,
    refetchOutwardAccounts,
    refetchProfile,
  } = useProfile();
  const switchMutation = useSwitchActiveOutwardAccount();
  const archiveMutation = useArchiveOutwardAccount();
  const restoreMutation = useRestoreOutwardAccount();
  const unarchiveMutation = useUnarchiveOutwardAccount();
  const purgeMutation = usePurgeOutwardAccount();
  const recentlyDeletedQuery = useListRecentlyDeletedOutwardAccounts();
  const recentlyDeleted = recentlyDeletedQuery.data?.accounts ?? [];
  const restoreWindowDays = recentlyDeletedQuery.data?.windowDays ?? 30;
  const archivedQuery = useListMyArchivedOutwardAccounts({
    query: { queryKey: ["/api/outward-accounts/archived"] },
  });
  // Dedupe: any account already shown in "Recently deleted" is hidden
  // from the "Archived" section so a single row never renders twice.
  const recentlyDeletedIds = new Set(recentlyDeleted.map((a) => a.id));
  const archivedAccounts = (
    (archivedQuery.data?.accounts ?? []) as OutwardAccount[]
  ).filter((a) => !recentlyDeletedIds.has(a.id));
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  const onRestore = async (acct: OutwardAccount) => {
    setError("");
    setBusyId(acct.id);
    try {
      await restoreMutation.mutateAsync({ id: acct.id });
      await Promise.all([
        refetchOutwardAccounts(),
        recentlyDeletedQuery.refetch(),
      ]);
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't restore account.");
    } finally {
      setBusyId(null);
    }
  };

  const formatDeletedAt = (iso: string | null | undefined): string => {
    if (!iso) return "";
    const ts = new Date(iso).getTime();
    if (!Number.isFinite(ts)) return "";
    const diffMs = Date.now() - ts;
    const dayMs = 24 * 60 * 60 * 1000;
    const days = Math.floor(diffMs / dayMs);
    if (days <= 0) {
      const hours = Math.max(1, Math.floor(diffMs / (60 * 60 * 1000)));
      return `Deleted ${hours}h ago`;
    }
    if (days === 1) return "Deleted 1 day ago";
    return `Deleted ${days} days ago`;
  };

  const onSwitch = async (id: number) => {
    setError("");
    setBusyId(id);
    try {
      await switchMutation.mutateAsync({ id });
      await Promise.all([refetchOutwardAccounts(), refetchProfile()]);
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't switch account.");
    } finally {
      setBusyId(null);
    }
  };

  const onArchive = async (acct: OutwardAccount) => {
    const ok = await confirm({
      title: "Archive account?",
      message: `"${acct.displayName || acct.title}" will no longer appear in your switcher. Existing connections, threads, and jobs stay visible to the other side — they just won't see new activity from this profile.`,
      confirmLabel: "Archive",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    setError("");
    setBusyId(acct.id);
    try {
      await archiveMutation.mutateAsync({ id: acct.id });
      await Promise.all([
        refetchOutwardAccounts(),
        archivedQuery.refetch(),
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't archive account.");
    } finally {
      setBusyId(null);
    }
  };

  const onUnarchive = async (acct: OutwardAccount) => {
    setError("");
    setBusyId(acct.id);
    try {
      await unarchiveMutation.mutateAsync({ id: acct.id });
      await Promise.all([
        refetchOutwardAccounts(),
        archivedQuery.refetch(),
      ]);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't unarchive account.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const onPurge = async (acct: OutwardAccount) => {
    const ok = await confirm({
      title: "Delete forever?",
      message: `"${acct.displayName || acct.title}" and any remaining live connections to it will be permanently removed. This can't be undone.`,
      confirmLabel: "Delete forever",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    setError("");
    setBusyId(acct.id);
    try {
      await purgeMutation.mutateAsync({ id: acct.id });
      await Promise.all([
        refetchOutwardAccounts(),
        archivedQuery.refetch(),
        recentlyDeletedQuery.refetch(),
      ]);
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete account.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 48 }}
    >
      <Text style={[styles.h1, { color: colors.foreground }]}>
        Personal profile
      </Text>
      <Text style={[styles.help, { color: colors.mutedForeground }]}>
        Your private profile details and the answers you gave during intake.
        These stay private and are shared between every account you run.
      </Text>
      <Pressable
        onPress={() => router.push("/account/personal" as never)}
        style={[
          styles.cardRow,
          { backgroundColor: colors.card, borderColor: colors.border },
        ]}
      >
        <View style={[styles.avatarLg, { backgroundColor: colors.muted }]}>
          {profile?.avatarUrl ? (
            <Image
              source={{ uri: resolveStorageUrl(profile.avatarUrl)! }}
              style={styles.avatarImg}
            />
          ) : (
            <Feather name="user" size={20} color={colors.mutedForeground} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>
            @{profile?.username || "username"}
          </Text>
          <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
            {profile?.email || "Personal profile & intake info"}
          </Text>
        </View>
        <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
      </Pressable>

      <Text style={[styles.h1, { color: colors.foreground, marginTop: 12 }]}>
        Outward-facing accounts
      </Text>
      <Text style={[styles.help, { color: colors.mutedForeground }]}>
        Each account is a separate public skin: contacts, properties and
        feeds you see in the app are scoped to whichever one is active.
      </Text>

      {(() => {
        // Compact "used / limit" counters mirroring the create screen so
        // the cap is visible from the list too — not just discovered when
        // the user taps "New". Only shown for kinds that actually have a
        // cap (e.g. Trade Pro, Facilities Pro), and only when the user
        // already has at least one outward account so brand-new users
        // aren't greeted with a wall of zeros.
        if (outwardAccounts.length === 0) return null;
        const counts: Partial<Record<OutwardAccount["kind"], number>> = {};
        for (const acct of outwardAccounts) {
          counts[acct.kind] = (counts[acct.kind] ?? 0) + 1;
        }
        const cappedKinds = (
          Object.keys(PER_KIND_CREATE_CAPS) as OutwardAccount["kind"][]
        ).filter((k) => PER_KIND_CREATE_CAPS[k] !== undefined);
        if (cappedKinds.length === 0) return null;
        return (
          <View style={styles.capRow}>
            {cappedKinds.map((k) => {
              const used = counts[k] ?? 0;
              const limit = PER_KIND_CREATE_CAPS[k]!;
              const full = used >= limit;
              return (
                <View
                  key={k}
                  style={[
                    styles.capChip,
                    {
                      backgroundColor: full
                        ? colors.muted
                        : colors.primary + "12",
                      borderColor: full ? colors.border : colors.primary + "40",
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.capChipText,
                      {
                        color: full
                          ? colors.mutedForeground
                          : colors.foreground,
                      },
                    ]}
                  >
                    {KIND_LABEL[k]} {used}/{limit}
                  </Text>
                </View>
              );
            })}
          </View>
        );
      })()}

      <View style={{ gap: 10 }}>
        {outwardAccounts.length === 0 ? (
          <View
            style={[
              styles.empty,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={{ color: colors.mutedForeground }}>
              No outward accounts yet.
            </Text>
          </View>
        ) : (
          outwardAccounts.map((acct) => {
            const isActive = acct.id === activeOutwardAccount?.id;
            const banner = resolveStorageUrl(acct.bannerUrl);
            // Continuity rule: avatar is shared across every outward account
            // — it always comes from the personal profile, never per-skin.
            const avatar = resolveStorageUrl(profile?.avatarUrl ?? null);
            return (
              <View
                key={acct.id}
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View
                  style={[styles.cardBanner, { backgroundColor: colors.muted }]}
                >
                  {banner ? (
                    <Image
                      source={{ uri: banner }}
                      style={styles.cardBannerImg}
                    />
                  ) : null}
                </View>
                <View style={styles.cardBody}>
                  <View
                    style={[styles.avatarLg, { backgroundColor: colors.muted }]}
                  >
                    {avatar ? (
                      <Image source={{ uri: avatar }} style={styles.avatarImg} />
                    ) : (
                      <Feather
                        name="user"
                        size={20}
                        color={colors.mutedForeground}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.rowTitle, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {acct.displayName || acct.title}
                    </Text>
                    <Text
                      style={[styles.rowSub, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {acct.title} · {KIND_LABEL[acct.kind]}
                      {acct.companyName ? ` · ${acct.companyName}` : ""}
                    </Text>
                    {isActive ? (
                      <Text
                        style={[styles.activeTag, { color: colors.primary }]}
                      >
                        ACTIVE
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View style={styles.cardActions}>
                  <Pressable
                    onPress={() =>
                      router.push(`/account/edit/${acct.id}` as never)
                    }
                    style={({ pressed }) => [
                      styles.actionBtn,
                      {
                        borderColor: colors.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Feather name="edit-2" size={14} color={colors.foreground} />
                    <Text
                      style={[styles.actionTxt, { color: colors.foreground }]}
                    >
                      Edit
                    </Text>
                  </Pressable>
                  {!isActive ? (
                    <Pressable
                      onPress={() => onSwitch(acct.id)}
                      disabled={busyId === acct.id}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        {
                          borderColor: colors.primary,
                          backgroundColor: colors.primary + "15",
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      {busyId === acct.id ? (
                        <ActivityIndicator size="small" color={colors.primary} />
                      ) : (
                        <Feather
                          name="repeat"
                          size={14}
                          color={colors.primary}
                        />
                      )}
                      <Text style={[styles.actionTxt, { color: colors.primary }]}>
                        Switch
                      </Text>
                    </Pressable>
                  ) : null}
                  {!isActive && outwardAccounts.length > 1 ? (
                    <Pressable
                      onPress={() => onArchive(acct)}
                      disabled={busyId === acct.id}
                      style={({ pressed }) => [
                        styles.actionBtn,
                        {
                          borderColor: colors.border,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <Feather
                        name="archive"
                        size={14}
                        color={colors.mutedForeground}
                      />
                      <Text
                        style={[
                          styles.actionTxt,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        Archive
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </View>

      {recentlyDeleted.length > 0 ? (
        <>
          <Text style={[styles.h1, { color: colors.foreground, marginTop: 12 }]}>
            Recently deleted
          </Text>
          <Text style={[styles.help, { color: colors.mutedForeground }]}>
            Accounts you deleted in the last {restoreWindowDays} days. Restore
            one to bring back its switcher entry and the connections that were
            archived with it.
          </Text>
          <View style={{ gap: 10 }}>
            {recentlyDeleted.map((acct) => (
              <View
                key={acct.id}
                style={[
                  styles.deletedRow,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View
                  style={[styles.avatarLg, { backgroundColor: colors.muted }]}
                >
                  <Feather
                    name="trash-2"
                    size={18}
                    color={colors.mutedForeground}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.rowTitle, { color: colors.foreground }]}
                    numberOfLines={1}
                  >
                    {acct.displayName || acct.title || "Untitled account"}
                  </Text>
                  <Text
                    style={[styles.rowSub, { color: colors.mutedForeground }]}
                    numberOfLines={1}
                  >
                    {KIND_LABEL[acct.kind]} · {formatDeletedAt(acct.archivedAt)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => onRestore(acct)}
                  disabled={busyId === acct.id}
                  accessibilityLabel={`Restore ${acct.displayName || acct.title || "account"}`}
                  style={({ pressed }) => [
                    styles.actionBtn,
                    {
                      borderColor: colors.primary,
                      backgroundColor: colors.primary + "15",
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  {busyId === acct.id ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Feather
                      name="rotate-ccw"
                      size={14}
                      color={colors.primary}
                    />
                  )}
                  <Text style={[styles.actionTxt, { color: colors.primary }]}>
                    Restore
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <Pressable
        onPress={() => router.push("/account/create" as never)}
        style={({ pressed }) => [
          styles.cta,
          { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Feather name="plus" size={16} color="#fff" />
        <Text style={styles.ctaText}>New outward account</Text>
      </Pressable>

      {archivedAccounts.length > 0 ? (
        <View style={{ gap: 10, marginTop: 8 }}>
          <Text style={[styles.h1, { color: colors.foreground }]}>
            Archived
          </Text>
          <Text style={[styles.help, { color: colors.mutedForeground }]}>
            Hidden accounts. Unarchive one to bring it back into your
            switcher with its original id and history intact.
          </Text>
          {archivedAccounts.map((acct) => {
            const banner = resolveStorageUrl(acct.bannerUrl);
            const avatar = resolveStorageUrl(profile?.avatarUrl ?? null);
            return (
              <View
                key={acct.id}
                style={[
                  styles.card,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <View
                  style={[styles.cardBanner, { backgroundColor: colors.muted }]}
                >
                  {banner ? (
                    <Image
                      source={{ uri: banner }}
                      style={styles.cardBannerImg}
                    />
                  ) : null}
                </View>
                <View style={styles.cardBody}>
                  <View
                    style={[styles.avatarLg, { backgroundColor: colors.muted }]}
                  >
                    {avatar ? (
                      <Image source={{ uri: avatar }} style={styles.avatarImg} />
                    ) : (
                      <Feather
                        name="user"
                        size={20}
                        color={colors.mutedForeground}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.rowTitle, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {acct.displayName || acct.title}
                    </Text>
                    <Text
                      style={[styles.rowSub, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {acct.title} · {KIND_LABEL[acct.kind]}
                      {acct.companyName ? ` · ${acct.companyName}` : ""}
                    </Text>
                  </View>
                </View>
                <View style={styles.cardActions}>
                  <Pressable
                    onPress={() => onUnarchive(acct)}
                    disabled={busyId === acct.id}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      {
                        borderColor: colors.primary,
                        backgroundColor: colors.primary + "15",
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    {busyId === acct.id ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Feather
                        name="rotate-ccw"
                        size={14}
                        color={colors.primary}
                      />
                    )}
                    <Text style={[styles.actionTxt, { color: colors.primary }]}>
                      Unarchive
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => onPurge(acct)}
                    disabled={busyId === acct.id}
                    accessibilityLabel={`Delete ${acct.displayName || acct.title || "account"} forever`}
                    style={({ pressed }) => [
                      styles.actionBtn,
                      {
                        borderColor: colors.destructive,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Feather
                      name="trash-2"
                      size={14}
                      color={colors.destructive}
                    />
                    <Text
                      style={[styles.actionTxt, { color: colors.destructive }]}
                    >
                      Delete forever
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {(profile as { isAdmin?: boolean } | null)?.isAdmin ? (
        <Pressable
          onPress={() => router.push("/account/game-room" as never)}
          style={({ pressed }) => [
            styles.cardRow,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <View style={[styles.avatarLg, { backgroundColor: colors.muted }]}>
            <Feather
              name="award"
              size={20}
              color={colors.mutedForeground}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>
              Game Room
            </Text>
            <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
              Admin only — points, leaderboard, prizes.
            </Text>
          </View>
          <Feather
            name="chevron-right"
            size={20}
            color={colors.mutedForeground}
          />
        </Pressable>
      ) : null}

      {(profile as { isAdmin?: boolean } | null)?.isAdmin ? (
        <Pressable
          onPress={() => router.push("/account/admin" as never)}
          style={({ pressed }) => [
            styles.cardRow,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <View style={[styles.avatarLg, { backgroundColor: colors.muted }]}>
            <Feather name="shield" size={20} color={colors.mutedForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>
              Admin Hub
            </Text>
            <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
              Admin only — demo skins for testing each role.
            </Text>
          </View>
          <Feather
            name="chevron-right"
            size={20}
            color={colors.mutedForeground}
          />
        </Pressable>
      ) : null}

      {(profile as { isAdmin?: boolean } | null)?.isAdmin ? (
        <Pressable
          onPress={() => router.push("/account/preset-chips" as never)}
          style={({ pressed }) => [
            styles.cardRow,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <View style={[styles.avatarLg, { backgroundColor: colors.muted }]}>
            <Feather name="tag" size={20} color={colors.mutedForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: colors.foreground }]}>
              Preset Chips Center
            </Text>
            <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
              Admin only — rename, reorder, add chips & tokens.
            </Text>
          </View>
          <Feather
            name="chevron-right"
            size={20}
            color={colors.mutedForeground}
          />
        </Pressable>
      ) : null}

      <Pressable
        onPress={() => router.push("/account/billing" as never)}
        style={({ pressed }) => [
          styles.cardRow,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <View style={[styles.avatarLg, { backgroundColor: colors.muted }]}>
          <Feather
            name="credit-card"
            size={20}
            color={colors.mutedForeground}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.foreground }]}>
            Billing
          </Text>
          <Text style={[styles.rowSub, { color: colors.mutedForeground }]}>
            Enable paid capabilities per outward account.
          </Text>
        </View>
        <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
      </Pressable>

      {error ? (
        <Text style={{ color: colors.destructive, fontSize: 13 }}>{error}</Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 20, fontFamily: "Inter_700Bold" },
  help: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19 },
  capRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  capChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  capChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  avatarLg: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImg: { width: "100%", height: "100%" },
  rowTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  empty: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
  },
  card: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  deletedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  cardBanner: { height: 70 },
  cardBannerImg: { width: "100%", height: "100%" },
  cardBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
  },
  activeTag: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
    marginTop: 4,
  },
  cardActions: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
    flexWrap: "wrap",
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  actionTxt: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 4,
  },
  ctaText: { color: "#fff", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
