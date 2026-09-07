import React, { useState } from "react";
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
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import {
  useActivateMode,
  useSwitchActiveMode,
  type UserModeKind,
  type UserModeProfile,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useProfile } from "@/lib/profile";
import { MODE_LABELS } from "@/lib/intake-schemas";
import { compareUserModeKind } from "@workspace/api-zod";
import { resolveStorageUrl } from "@/lib/uploads";

function profileTitle(mode: UserModeProfile, fallback: string): string {
  const data = (mode.intakeData ?? {}) as Record<string, unknown>;
  const candidates: Array<unknown> = [];
  switch (mode.kind) {
    case "trade_pro":
      candidates.push(data.companyName);
      break;
    case "home":
      candidates.push(data.placeName, data.neighborhood);
      break;
    case "facilities":
      candidates.push(data.placeName, data.operationKind);
      break;
    case "trade_pro_teammate":
    case "facilities_teammate":
    case "home_teammate":
      candidates.push(data.displayName, data.belongsTo);
      break;
    default:
      break;
  }
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return fallback;
}

type AddType = {
  key: string;
  label: string;
  kind: UserModeKind;
};

// Order is derived from the shared USER_MODE_KIND_ORDER (see
// @workspace/api-zod) so the "Add account" picker can never drift
// from the order the server returns to the switcher.
const ADD_TYPES: AddType[] = (
  [
    { key: "home", label: "Home", kind: "home" },
    { key: "home_teammate", label: "Home Teammate", kind: "home_teammate" },
    { key: "trade_pro", label: "Trade Pro", kind: "trade_pro" },
    { key: "trade_pro_teammate", label: "Trade Teammate", kind: "trade_pro_teammate" },
    { key: "facilities", label: "Facility Management", kind: "facilities" },
    { key: "facilities_teammate", label: "Facility Teammate", kind: "facilities_teammate" },
    { key: "collab", label: "Collaborator", kind: "trade_pro_collab" },
  ] as AddType[]
).slice().sort((a, b) => compareUserModeKind(a.kind, b.kind));

// #614 — Teammate kinds are scoped to a parent account family. Only
// offer them when the user already holds the matching parent mode.
const TEAMMATE_PARENT_KIND: Partial<Record<UserModeKind, UserModeKind>> = {
  home_teammate: "home",
  trade_pro_teammate: "trade_pro",
  facilities_teammate: "facilities",
};

export function ModeSwitcher() {
  const colors = useColors();
  const router = useRouter();
  const { modes, activeMode, refetchProfile, refetchModes } = useProfile();
  const switchMutation = useSwitchActiveMode();
  const activate = useActivateMode();
  const queryClient = useQueryClient();
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [addingKind, setAddingKind] = useState<UserModeKind | null>(null);
  const [error, setError] = useState("");

  // Per-account isolation: each mode shows ONLY its own banner.  We never
  // fall back to a user-level banner here because that would let one
  // account's branding bleed into another.
  const profileBannerUri = (mode: UserModeProfile): string | null => {
    const data = (mode.intakeData ?? {}) as Record<string, unknown>;
    const v =
      (typeof data.headerImageUrl === "string" && data.headerImageUrl) ||
      (typeof data.bannerUrl === "string" && data.bannerUrl) ||
      (typeof data.coverPhotoUrl === "string" && data.coverPhotoUrl) ||
      null;
    return resolveStorageUrl(v);
  };

  const activeName = activeMode
    ? profileTitle(activeMode, MODE_LABELS[activeMode.kind])
    : "No active account";

  const handleSwitch = async (mode: UserModeProfile) => {
    if (mode.id === activeMode?.id) {
      setOverlayOpen(false);
      return;
    }
    setError("");
    setBusyId(mode.id);
    try {
      await switchMutation.mutateAsync({ data: { modeId: mode.id } });
      await Promise.all([refetchProfile(), refetchModes()]);
      await queryClient.invalidateQueries();
      setOverlayOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't switch account.");
    } finally {
      setBusyId(null);
    }
  };

  const handleAdd = async (kind: UserModeKind) => {
    setError("");
    setAddingKind(kind);
    try {
      const created = await activate.mutateAsync({ data: { kind } });
      await refetchModes();
      setOverlayOpen(false);
      router.push({
        pathname: "/(onboarding)/intake",
        params: { modeId: String(created.id), kind },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that account.");
    } finally {
      setAddingKind(null);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
        {modes.length === 1 ? "ACCOUNT" : "ACCOUNTS"}
      </Text>

      <Pressable
        onPress={() => setOverlayOpen(true)}
        style={[styles.pill, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <Text style={[styles.pillName, { color: colors.foreground }]} numberOfLines={1}>
          {activeName}
        </Text>
        <Text style={[styles.pillAction, { color: colors.primary }]} numberOfLines={1}>
          Switch or Add Account
        </Text>
      </Pressable>

      {error ? <Text style={{ color: colors.destructive, fontSize: 12 }}>{error}</Text> : null}

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
                CURRENT ACCOUNTS
              </Text>
              <View
                style={[
                  styles.bubble,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                {modes.length === 0 ? (
                  <View style={styles.emptyRow}>
                    <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
                      No accounts yet — add one below.
                    </Text>
                  </View>
                ) : (
                  modes.map((mode, idx) => {
                    const isActive = mode.id === activeMode?.id;
                    const incomplete = !mode.intakeCompletedAt;
                    const title = profileTitle(mode, MODE_LABELS[mode.kind]);
                    const banner = profileBannerUri(mode);
                    return (
                      <Pressable
                        key={mode.id}
                        onPress={() => {
                          if (incomplete) {
                            setOverlayOpen(false);
                            router.push({
                              pathname: "/(onboarding)/intake",
                              params: { modeId: String(mode.id), kind: mode.kind },
                            });
                          } else {
                            handleSwitch(mode);
                          }
                        }}
                        disabled={busyId === mode.id}
                        style={[
                          styles.row,
                          idx > 0 && {
                            borderTopWidth: StyleSheet.hairlineWidth,
                            borderTopColor: colors.border,
                          },
                        ]}
                      >
                        <View
                          style={[styles.banner, { backgroundColor: colors.muted }]}
                        >
                          {banner ? (
                            <Image source={{ uri: banner }} style={styles.bannerImg} />
                          ) : (
                            <Feather name="image" size={16} color={colors.mutedForeground} />
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[styles.rowTitle, { color: colors.foreground }]}
                            numberOfLines={1}
                          >
                            {title}
                          </Text>
                          <Text
                            style={[styles.rowSubtitle, { color: colors.mutedForeground }]}
                            numberOfLines={1}
                          >
                            {incomplete ? "Tap to finish setup" : MODE_LABELS[mode.kind]}
                          </Text>
                        </View>
                        {busyId === mode.id ? (
                          <ActivityIndicator size="small" color={colors.mutedForeground} />
                        ) : isActive ? (
                          <Feather name="check-circle" size={20} color={colors.primary} />
                        ) : (
                          <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
                        )}
                      </Pressable>
                    );
                  })
                )}
              </View>

              <Text
                style={[
                  styles.bubbleLabel,
                  { color: colors.mutedForeground, marginTop: 18 },
                ]}
              >
                ADD ACCOUNT
              </Text>
              <View
                style={[
                  styles.bubble,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                {ADD_TYPES.map((t, idx) => {
                  const busy = addingKind === t.kind;
                  return (
                    <Pressable
                      key={t.key}
                      onPress={() => handleAdd(t.kind)}
                      disabled={busy || addingKind !== null}
                      style={[
                        styles.row,
                        idx > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: colors.border,
                        },
                      ]}
                    >
                      <View style={[styles.banner, { backgroundColor: colors.muted }]}>
                        <Feather name="plus" size={18} color={colors.mutedForeground} />
                      </View>
                      <Text
                        style={[styles.rowTitle, { color: colors.foreground, flex: 1 }]}
                        numberOfLines={1}
                      >
                        {t.label}
                      </Text>
                      {busy ? (
                        <ActivityIndicator size="small" color={colors.mutedForeground} />
                      ) : (
                        <Feather
                          name="chevron-right"
                          size={20}
                          color={colors.mutedForeground}
                        />
                      )}
                    </Pressable>
                  );
                })}
              </View>

              {error ? (
                <Text
                  style={{ color: colors.destructive, fontSize: 12, marginTop: 12 }}
                >
                  {error}
                </Text>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </Modal>
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
    paddingVertical: 14,
    borderRadius: 999,
    borderWidth: 1,
    gap: 12,
  },
  pillName: { fontSize: 15, fontFamily: "Inter_600SemiBold", flexShrink: 1 },
  pillAction: { fontSize: 14, fontFamily: "Inter_600SemiBold" },

  overlayBg: { flex: 1 },
  overlayScroll: { flexGrow: 1, justifyContent: "center", padding: 16 },
  panel: {
    borderRadius: 18,
    padding: 16,
    gap: 8,
  },
  panelHeader: { flexDirection: "row", justifyContent: "flex-start", marginBottom: 4 },
  closeBtn: { padding: 4 },

  bubbleLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8, marginBottom: 8 },
  bubble: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  emptyRow: { paddingHorizontal: 14, paddingVertical: 16 },
  banner: {
    width: 56,
    height: 36,
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  bannerImg: { width: "100%", height: "100%" },
  rowTitle: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rowSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
});
