import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/lib/profile";
import { confirm } from "@/lib/confirm";

const ROLE_KINDS = [
  "trade_pro",
  "home",
  "facilities",
  "trade_pro_teammate",
  "facilities_teammate",
  "trade_pro_collab",
  "facilities_collab",
] as const;

type RoleKind = (typeof ROLE_KINDS)[number];

interface AdminDemoProfile {
  id: number;
  roleKind: string;
  displayName: string;
  demoClerkId: string;
  demoUsername: string;
  outwardAccountId: number | null;
  outwardAccountKind: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

interface ListResponse {
  profiles: AdminDemoProfile[];
  availableRoleKinds: string[];
}

function formatRoleKind(kind: string): string {
  switch (kind) {
    case "trade_pro":
      return "Trade Pro";
    case "home":
      return "Home";
    case "facilities":
      return "Facility Management";
    case "trade_pro_teammate":
      return "Trade Teammate";
    case "facilities_teammate":
      return "Facility Teammate";
    case "home_teammate":
      return "Home Teammate";
    case "trade_pro_collab":
      return "Collaborator";
    case "facilities_collab":
      return "Collaborator";
    case "collab":
      return "Collaborator";
    default:
      return kind;
  }
}

export default function AdminHubScreen() {
  const colors = useColors();
  const router = useRouter();
  const { profile } = useProfile();
  const isAdmin = (profile as { isAdmin?: boolean } | null)?.isAdmin === true;

  const [profiles, setProfiles] = useState<AdminDemoProfile[]>([]);
  const [availableRoleKinds, setAvailableRoleKinds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [creating, setCreating] = useState<RoleKind | null>(null);
  const [newDisplayName, setNewDisplayName] = useState("");
  const [busy, setBusy] = useState(false);

  const [toast, setToast] = useState<string | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback(
    (msg: string) => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast(msg);
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }).start();
      toastTimer.current = setTimeout(() => {
        Animated.timing(toastOpacity, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }).start(() => setToast(null));
      }, 1800);
    },
    [toastOpacity],
  );
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (profile && !isAdmin) router.back();
  }, [profile, isAdmin, router]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const res = await customFetch<ListResponse>("/api/admin/demo-profiles");
      setProfiles(res.profiles ?? []);
      setAvailableRoleKinds(res.availableRoleKinds ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load();
  }, [load]);

  async function createProfile(): Promise<void> {
    if (!creating) return;
    const displayName = newDisplayName.trim();
    if (displayName.length === 0) return;
    setBusy(true);
    try {
      await customFetch<AdminDemoProfile>("/api/admin/demo-profiles", {
        method: "POST",
        body: JSON.stringify({ roleKind: creating, displayName }),
      });
      setCreating(null);
      setNewDisplayName("");
      showToast("Demo skin created");
      await load();
    } catch (err: unknown) {
      Alert.alert(
        "Create failed",
        err instanceof Error ? err.message : "Try again",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteProfile(p: AdminDemoProfile): Promise<void> {
    setBusyId(p.id);
    try {
      await customFetch(`/api/admin/demo-profiles/${p.id}`, {
        method: "DELETE",
      });
      showToast("Demo skin deleted");
      await load();
    } catch (err: unknown) {
      Alert.alert(
        "Delete failed",
        err instanceof Error ? err.message : "Try again",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete(p: AdminDemoProfile): Promise<void> {
    // #627: Route the destructive confirm through `lib/confirm.ts` so
    // the dialog actually surfaces on react-native-web (where bare RN
    // `Alert.alert` is a no-op stub). Native still gets a real RN
    // alert because the helper falls back to `Alert.alert` off-web.
    const ok = await confirm({
      title: "Delete demo skin?",
      message: `"${p.displayName}" and any data owned by it will be removed. This can't be undone.`,
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    void deleteProfile(p);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: "Admin Hub" }} />

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Text style={{ color: colors.mutedForeground }}>{error}</Text>
          <Pressable onPress={load} style={{ marginTop: 12 }}>
            <Text style={{ color: colors.primary }}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 64, gap: 16 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
        >
          <View style={{ gap: 4 }}>
            <Text style={[s.h1, { color: colors.foreground }]}>Admin Hub</Text>
            <Text style={[s.intro, { color: colors.mutedForeground }]}>
              Demo skins for testing each role.
            </Text>
          </View>

          <View
            style={[
              s.section,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={s.sectionHeader}>
              <Text style={[s.sectionTitle, { color: colors.foreground }]}>
                Backstage rooms
              </Text>
            </View>
            <View style={{ padding: 12, gap: 10 }}>
              <Pressable
                onPress={() => router.push("/account/game-room")}
                style={[
                  s.row,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    s.avatar,
                    { backgroundColor: colors.muted, borderColor: colors.border },
                  ]}
                >
                  <Feather name="zap" size={18} color={colors.foreground} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowLabel, { color: colors.foreground }]}>
                    Game Room
                  </Text>
                  <Text
                    style={[s.rowMeta, { color: colors.mutedForeground }]}
                    numberOfLines={1}
                  >
                    Score controls, scoreboard, prizes
                  </Text>
                </View>
                <Feather
                  name="chevron-right"
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
              <Pressable
                onPress={() => router.push("/account/preset-chips")}
                style={[
                  s.row,
                  {
                    backgroundColor: colors.background,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    s.avatar,
                    { backgroundColor: colors.muted, borderColor: colors.border },
                  ]}
                >
                  <Feather name="tag" size={18} color={colors.foreground} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.rowLabel, { color: colors.foreground }]}>
                    Preset Chips
                  </Text>
                  <Text
                    style={[s.rowMeta, { color: colors.mutedForeground }]}
                    numberOfLines={1}
                  >
                    Edit chips, tokens, titles (the future Labor Room)
                  </Text>
                </View>
                <Feather
                  name="chevron-right"
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </View>
          </View>

          <View
            style={[
              s.section,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={s.sectionHeader}>
              <Text style={[s.sectionTitle, { color: colors.foreground }]}>
                Your demo skins
              </Text>
              <Text style={[s.sectionCount, { color: colors.mutedForeground }]}>
                {profiles.length}
              </Text>
            </View>
            <View style={{ padding: 12, gap: 10 }}>
              {profiles.length === 0 ? (
                <Text
                  style={{
                    color: colors.mutedForeground,
                    textAlign: "center",
                    paddingVertical: 16,
                  }}
                >
                  No demo skins yet. Create one below.
                </Text>
              ) : (
                profiles.map((p) => {
                  const initial = (p.displayName || "?")
                    .trim()
                    .charAt(0)
                    .toUpperCase();
                  return (
                    <View
                      key={p.id}
                      style={[
                        s.row,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <View
                        style={[
                          s.avatar,
                          {
                            backgroundColor: colors.muted,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        <Text
                          style={{
                            color: colors.foreground,
                            fontWeight: "700",
                          }}
                        >
                          {initial}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[s.rowLabel, { color: colors.foreground }]}
                          numberOfLines={1}
                        >
                          {p.displayName}
                        </Text>
                        <Text
                          style={[
                            s.rowMeta,
                            { color: colors.mutedForeground },
                          ]}
                          numberOfLines={1}
                        >
                          {formatRoleKind(p.roleKind)}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 2 }}>
                        <Pressable
                          disabled
                          hitSlop={10}
                          style={[
                            s.iconBtn,
                            {
                              borderColor: colors.border,
                              borderWidth: 1,
                              borderRadius: 8,
                              opacity: 0.5,
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 6,
                              paddingHorizontal: 10,
                            },
                          ]}
                        >
                          <Feather
                            name="user-check"
                            size={14}
                            color={colors.mutedForeground}
                          />
                          <Text
                            style={{
                              color: colors.mutedForeground,
                              fontSize: 12,
                              fontWeight: "600",
                            }}
                          >
                            Wear
                          </Text>
                        </Pressable>
                        <Text
                          style={{
                            color: colors.mutedForeground,
                            fontSize: 10,
                          }}
                        >
                          Coming next
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => confirmDelete(p)}
                        disabled={busyId === p.id}
                        hitSlop={10}
                        style={s.iconBtn}
                        accessibilityLabel={`Delete ${p.displayName}`}
                      >
                        {busyId === p.id ? (
                          <ActivityIndicator
                            size="small"
                            color={colors.destructive}
                          />
                        ) : (
                          <Feather
                            name="trash-2"
                            size={18}
                            color={colors.destructive}
                          />
                        )}
                      </Pressable>
                    </View>
                  );
                })
              )}
            </View>
          </View>

          <View
            style={[
              s.section,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={s.sectionHeader}>
              <Text style={[s.sectionTitle, { color: colors.foreground }]}>
                Create demo skin
              </Text>
            </View>
            <View style={{ padding: 12, gap: 10 }}>
              {availableRoleKinds.length === 0 ? (
                <Text
                  style={{
                    color: colors.mutedForeground,
                    textAlign: "center",
                    paddingVertical: 16,
                  }}
                >
                  All role kinds provisioned.
                </Text>
              ) : (
                <View style={s.kindGrid}>
                  {availableRoleKinds.map((kind) => (
                    <Pressable
                      key={kind}
                      onPress={() => {
                        setCreating(kind as RoleKind);
                        setNewDisplayName(formatRoleKind(kind));
                      }}
                      style={[
                        s.kindBtn,
                        {
                          backgroundColor: colors.background,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Feather
                        name="plus"
                        size={14}
                        color={colors.foreground}
                      />
                      <Text
                        style={{
                          color: colors.foreground,
                          fontSize: 13,
                          fontWeight: "600",
                        }}
                      >
                        {formatRoleKind(kind)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </View>
        </ScrollView>
      )}

      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={[
            s.toast,
            { backgroundColor: colors.foreground, opacity: toastOpacity },
          ]}
        >
          <Feather name="check" size={14} color={colors.background} />
          <Text style={{ color: colors.background, fontWeight: "600" }}>
            {toast}
          </Text>
        </Animated.View>
      ) : null}

      <Modal
        visible={!!creating}
        animationType="fade"
        transparent
        onRequestClose={() => setCreating(null)}
      >
        <View style={s.modalScrim}>
          <View style={[s.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[s.modalTitle, { color: colors.foreground }]}>
              New {creating ? formatRoleKind(creating) : ""} demo skin
            </Text>
            <Text style={[s.modalHelp, { color: colors.mutedForeground }]}>
              Pick a display name. A Firebase user and outward account (when
              applicable) will be provisioned automatically.
            </Text>
            <TextInput
              value={newDisplayName}
              onChangeText={setNewDisplayName}
              autoFocus
              placeholder="Display name"
              placeholderTextColor={colors.mutedForeground}
              style={[
                s.input,
                { color: colors.foreground, borderColor: colors.border },
              ]}
            />
            <View style={s.modalActions}>
              <Pressable
                onPress={() => {
                  setCreating(null);
                  setNewDisplayName("");
                }}
                style={s.modalBtn}
              >
                <Text style={{ color: colors.mutedForeground }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={createProfile}
                disabled={busy || newDisplayName.trim().length === 0}
                style={s.modalBtn}
              >
                <Text
                  style={{
                    color:
                      newDisplayName.trim().length === 0
                        ? colors.mutedForeground
                        : colors.primary,
                    fontWeight: "700",
                  }}
                >
                  {busy ? "…" : "Create"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  h1: { fontSize: 22, fontWeight: "700" },
  intro: { fontSize: 13 },
  section: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: "700" },
  sectionCount: { fontSize: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  rowLabel: { fontSize: 14, fontWeight: "700" },
  rowMeta: { fontSize: 11, marginTop: 2 },
  iconBtn: { paddingHorizontal: 6, paddingVertical: 6 },
  kindGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  kindBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  toast: {
    position: "absolute",
    bottom: 28,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  modalScrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 460,
    borderRadius: 14,
    padding: 20,
    gap: 8,
  },
  modalTitle: { fontSize: 16, fontWeight: "700" },
  modalHelp: { fontSize: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
    fontSize: 15,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
    marginTop: 12,
  },
  modalBtn: { paddingHorizontal: 12, paddingVertical: 8 },
});
