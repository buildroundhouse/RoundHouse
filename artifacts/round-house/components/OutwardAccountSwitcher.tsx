import React, { useState } from "react";
import {
  OutwardAccountEditorModal,
  type OutwardAccountEditorMode,
} from "./OutwardAccountEditorModal";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { confirm } from "@/lib/confirm";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import {
  useArchiveOutwardAccount,
  useListMyArchivedOutwardAccounts,
  useRestoreOutwardAccount,
  useSwitchActiveOutwardAccount,
  type OutwardAccount,
} from "@workspace/api-client-react";
import { MODE_LABELS } from "@/lib/intake-schemas";
import { resolveStorageUrl } from "@/lib/uploads";
import { useProfile } from "@/lib/profile";
import { kindLabelForName } from "@/lib/account-display";

function accountTitle(a: OutwardAccount): string {
  if (a.title?.trim()) return a.title.trim();
  if (a.displayName?.trim()) return a.displayName.trim();
  if (a.companyName?.trim()) return a.companyName.trim();
  return MODE_LABELS[a.kind] ?? "Account";
}

// #618 / #620: when a profile's title already contains every word of its
// kind label (e.g. a "My Home" account whose label is also "My Home", or
// any title containing "Home" when the label is just "Home"), drop the
// subtitle so the row doesn't visually duplicate the same words and
// truncate to "Home Home". Titles that only partially overlap (e.g.
// "Smith Home" vs. label "My Home" — missing "my") still render the
// label. Implementation lives in lib/account-display.ts so every profile
// surface uses the same rule.
function accountSubtitle(a: { kind: OutwardAccount["kind"] }, title: string): string | null {
  return kindLabelForName(title, MODE_LABELS[a.kind] ?? a.kind);
}

export function OutwardAccountSwitcher({
  variant = "default",
}: {
  variant?: "default" | "headerButton";
} = {}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const {
    outwardAccounts,
    activeOutwardAccount,
    activeOutwardAccountId,
    refetchOutwardAccounts,
    refetchProfile,
  } = useProfile();
  const switchMutation = useSwitchActiveOutwardAccount();
  const archiveMutation = useArchiveOutwardAccount();
  const restoreMutation = useRestoreOutwardAccount();
  const archivedQuery = useListMyArchivedOutwardAccounts();
  const archivedAccounts = archivedQuery.data?.accounts ?? [];

  const [overlayOpen, setOverlayOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [editorMode, setEditorMode] = useState<OutwardAccountEditorMode | null>(
    null,
  );

  const performRestore = async (a: OutwardAccount) => {
    setError("");
    setBusyId(a.id);
    try {
      await restoreMutation.mutateAsync({ id: a.id });
      await Promise.all([
        refetchOutwardAccounts(),
        archivedQuery.refetch(),
      ]);
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't restore account.");
    } finally {
      setBusyId(null);
    }
  };

  const handleSwitch = async (a: OutwardAccount) => {
    if (a.id === activeOutwardAccountId) {
      setOverlayOpen(false);
      return;
    }
    setError("");
    setBusyId(a.id);
    try {
      // The switch mutation's global onSuccess (registered in
      // _layout.tsx) sets the api-client active-account override
      // synchronously so the refetches kicked off by
      // invalidateQueries() below already carry the new header.
      await switchMutation.mutateAsync({ id: a.id });
      await Promise.all([refetchOutwardAccounts(), refetchProfile()]);
      // Other server reads were partitioned by the previous active id;
      // refresh them so the UI matches the new identity.
      await queryClient.invalidateQueries();
      setOverlayOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't switch account.");
    } finally {
      setBusyId(null);
    }
  };

  const performArchive = async (a: OutwardAccount) => {
    setError("");
    setBusyId(a.id);
    try {
      // The server refuses to archive the user's currently-active
      // account, so if they're archiving it we first hop onto another
      // one. This also updates the x-active-outward-account-id header
      // for every subsequent request.
      if (a.id === activeOutwardAccountId) {
        const fallback = outwardAccounts.find(
          (other) => other.id !== a.id,
        );
        if (!fallback) {
          setError("You need at least one other account to archive this one.");
          return;
        }
        await switchMutation.mutateAsync({ id: fallback.id });
      }
      await archiveMutation.mutateAsync({ id: a.id });
      await Promise.all([refetchOutwardAccounts(), refetchProfile()]);
      // Account-scoped reads need to refresh under the new active id.
      await queryClient.invalidateQueries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't archive account.");
    } finally {
      setBusyId(null);
    }
  };

  const handleArchive = async (a: OutwardAccount) => {
    if (outwardAccounts.length <= 1) {
      setError("You need at least one outward account.");
      return;
    }
    const title = accountTitle(a);
    const ok = await confirm({
      title: "Archive this profile?",
      message: `"${title}" will no longer appear in your switcher. Existing connections, threads, and jobs stay visible to the other side — they just won't see new activity from this profile.`,
      confirmLabel: "Archive",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (ok) await performArchive(a);
  };

  const headline = activeOutwardAccount
    ? accountTitle(activeOutwardAccount)
    : outwardAccounts.length === 0
      ? "No public profiles yet"
      : "Pick a public profile";
  const subline = activeOutwardAccount
    ? accountSubtitle(activeOutwardAccount, headline)
    : null;

  const trigger =
    variant === "headerButton" ? (
      <Pressable
        onPress={() => setOverlayOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Switch or add account"
        hitSlop={8}
        style={styles.headerTriggerBtn}
      >
        <Text
          style={[styles.headerTriggerText, { color: colors.primary }]}
          numberOfLines={1}
        >
          Switch / Add Account
        </Text>
      </Pressable>
    ) : (
      <Pressable
        onPress={() => setOverlayOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Switch or add public profile"
        style={[styles.pill, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.pillName, { color: colors.foreground }]} numberOfLines={1}>
            {headline}
          </Text>
          {subline ? (
            <Text
              style={[styles.pillMeta, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {subline}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.pillAction, { color: colors.primary }]} numberOfLines={1}>
          Switch or add
        </Text>
      </Pressable>
    );

  return (
    <View
      style={
        variant === "headerButton" ? undefined : { gap: 10 }
      }
    >
      {variant === "headerButton" ? null : (
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          PUBLIC PROFILE
        </Text>
      )}

      {trigger}

      {error && variant !== "headerButton" ? (
        <Text style={{ color: colors.destructive, fontSize: 12 }}>{error}</Text>
      ) : null}

      <Modal
        visible={overlayOpen}
        animationType="fade"
        transparent
        onRequestClose={() => setOverlayOpen(false)}
      >
        <View style={[styles.overlayBg, { backgroundColor: "rgba(0,0,0,0.55)" }]}>
          <ScrollView
            contentContainerStyle={styles.overlayScroll}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.panel, { backgroundColor: colors.background }]}>
              <View style={styles.panelHeader}>
                <Pressable
                  onPress={() => setOverlayOpen(false)}
                  hitSlop={12}
                  style={styles.closeBtn}
                  accessibilityLabel="Close"
                >
                  <Feather name="x" size={22} color={colors.foreground} />
                </Pressable>
              </View>

              <Text style={[styles.bubbleLabel, { color: colors.mutedForeground }]}>
                YOUR PUBLIC PROFILES
              </Text>
              <View
                style={[
                  styles.bubble,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                {outwardAccounts.length === 0 ? (
                  <View style={styles.emptyRow}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                      No public profiles yet — create one below.
                    </Text>
                  </View>
                ) : (
                  outwardAccounts.map((a, idx) => {
                    const isActive = a.id === activeOutwardAccountId;
                    const banner = resolveStorageUrl(a.bannerUrl ?? null);
                    const avatar = resolveStorageUrl(a.avatarUrl ?? null);
                    const title = accountTitle(a);
                    const subtitle = accountSubtitle(a, title);
                    // #572: the Collaborator / Friend baseline is
                    // permanent — never offer the archive control on it.
                    // Server enforces the same rule with a 409
                    // protected_baseline error if anyone tries.
                    const canArchive =
                      outwardAccounts.length > 1 && a.kind !== "collab";
                    return (
                      <View
                        key={a.id}
                        style={[
                          styles.row,
                          idx > 0 && {
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: colors.border,
                          },
                        ]}
                      >
                        <Pressable
                          onPress={() => handleSwitch(a)}
                          disabled={busyId === a.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Switch to ${title}`}
                          style={styles.rowLeft}
                        >
                          <View
                            style={[styles.banner, { backgroundColor: colors.muted }]}
                          >
                            {banner ? (
                              <Image source={{ uri: banner }} style={styles.bannerImg} />
                            ) : avatar ? (
                              <Image source={{ uri: avatar }} style={styles.bannerImg} />
                            ) : (
                              <Feather
                                name="user"
                                size={16}
                                color={colors.mutedForeground}
                              />
                            )}
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text
                              style={[styles.rowTitle, { color: colors.foreground }]}
                              numberOfLines={1}
                            >
                              {title}
                            </Text>
                            {subtitle ? (
                              <Text
                                style={[
                                  styles.rowSubtitle,
                                  { color: colors.mutedForeground },
                                ]}
                                numberOfLines={1}
                              >
                                {subtitle}
                              </Text>
                            ) : null}
                          </View>
                          {busyId === a.id ? (
                            <ActivityIndicator
                              size="small"
                              color={colors.mutedForeground}
                            />
                          ) : isActive ? (
                            <Feather
                              name="check-circle"
                              size={20}
                              color={colors.primary}
                            />
                          ) : null}
                        </Pressable>
                        <Pressable
                          onPress={() => {
                            setOverlayOpen(false);
                            setEditorMode({ kind: "edit", account: a });
                          }}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Edit ${title}`}
                          style={styles.iconBtn}
                        >
                          <Feather
                            name="edit-2"
                            size={16}
                            color={colors.mutedForeground}
                          />
                        </Pressable>
                        {canArchive ? (
                          <Pressable
                            onPress={() => handleArchive(a)}
                            disabled={busyId === a.id}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`Archive ${title}`}
                            style={styles.iconBtn}
                          >
                            <Feather
                              name="archive"
                              size={16}
                              color={colors.mutedForeground}
                            />
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })
                )}
              </View>

              {archivedAccounts.length > 0 ? (
                <View style={{ marginTop: 16 }}>
                  <Pressable
                    onPress={() => setShowArchived((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      showArchived
                        ? "Hide archived public profiles"
                        : `Show ${archivedAccounts.length} archived public profiles`
                    }
                    style={styles.archivedToggle}
                  >
                    <Feather
                      name={showArchived ? "chevron-down" : "chevron-right"}
                      size={16}
                      color={colors.mutedForeground}
                    />
                    <Text
                      style={[styles.bubbleLabel, { color: colors.mutedForeground, marginBottom: 0 }]}
                    >
                      ARCHIVED ({archivedAccounts.length})
                    </Text>
                  </Pressable>
                  {showArchived ? (
                    <View
                      style={[
                        styles.bubble,
                        {
                          backgroundColor: colors.card,
                          borderColor: colors.border,
                          marginTop: 8,
                        },
                      ]}
                    >
                      {archivedAccounts.map((entry, idx) => {
                        const a = entry.account;
                        const title = accountTitle(a);
                        const subtitle = accountSubtitle(a, title);
                        return (
                          <View
                            key={a.id}
                            style={[
                              styles.row,
                              idx > 0 && {
                                borderTopWidth: StyleSheet.hairlineWidth,
                                borderTopColor: colors.border,
                              },
                            ]}
                          >
                            <View style={styles.rowLeft}>
                              <View
                                style={[
                                  styles.banner,
                                  { backgroundColor: colors.muted },
                                ]}
                              >
                                <Feather
                                  name="archive"
                                  size={16}
                                  color={colors.mutedForeground}
                                />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text
                                  style={[
                                    styles.rowTitle,
                                    { color: colors.foreground },
                                  ]}
                                  numberOfLines={1}
                                >
                                  {title}
                                </Text>
                                {subtitle || !entry.restorable ? (
                                  <Text
                                    style={[
                                      styles.rowSubtitle,
                                      { color: colors.mutedForeground },
                                    ]}
                                    numberOfLines={1}
                                  >
                                    {subtitle ?? ""}
                                    {!entry.restorable
                                      ? subtitle
                                        ? " · past restore window"
                                        : "Past restore window"
                                      : ""}
                                  </Text>
                                ) : null}
                              </View>
                            </View>
                            {entry.restorable ? (
                              <Pressable
                                onPress={() => performRestore(a)}
                                disabled={busyId === a.id}
                                hitSlop={8}
                                accessibilityRole="button"
                                accessibilityLabel={`Restore ${title}`}
                                style={styles.iconBtn}
                              >
                                {busyId === a.id ? (
                                  <ActivityIndicator
                                    size="small"
                                    color={colors.primary}
                                  />
                                ) : (
                                  <Feather
                                    name="rotate-ccw"
                                    size={16}
                                    color={colors.primary}
                                  />
                                )}
                              </Pressable>
                            ) : null}
                            <Pressable
                              onPress={() => {
                                setOverlayOpen(false);
                                router.push("/account" as never);
                              }}
                              hitSlop={8}
                              accessibilityRole="button"
                              accessibilityLabel={`Manage ${title}`}
                              style={styles.iconBtn}
                            >
                              <Feather
                                name="chevron-right"
                                size={18}
                                color={colors.mutedForeground}
                              />
                            </Pressable>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}
                </View>
              ) : null}

            </View>
          </ScrollView>
        </View>
      </Modal>

      {editorMode ? (
        <OutwardAccountEditorModal
          visible={true}
          mode={editorMode}
          onClose={() => setEditorMode(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
  },
  pillName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  pillMeta: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  pillAction: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  headerTriggerBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  headerTriggerText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },

  overlayBg: { flex: 1 },
  overlayScroll: { flexGrow: 1, justifyContent: "center", padding: 16 },
  panel: { borderRadius: 18, padding: 16, gap: 8 },
  panelHeader: { flexDirection: "row", justifyContent: "flex-start", marginBottom: 4 },
  closeBtn: { padding: 4 },

  bubbleLabel: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  bubble: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  archivedToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 4,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  iconBtn: {
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  emptyRow: { paddingHorizontal: 14, paddingVertical: 16 },
  banner: {
    width: 48,
    height: 36,
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  bannerImg: { width: "100%", height: "100%" },
  rowTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rowSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },

  addRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
});
