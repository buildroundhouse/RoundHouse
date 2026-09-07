import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

interface AdminChip {
  id: number;
  chipId: string;
  label: string;
  sublabel: string | null;
  groupKey: string | null;
  sortOrder: number;
  archivedAt: string | null;
  updatedAt: string;
}
interface AdminGroup {
  id?: number;
  groupKey: string;
  label: string;
  sortOrder: number;
}
interface AdminSet {
  setKey: string;
  label: string;
  chips: AdminChip[];
  groups: AdminGroup[];
}
interface AdminResponse {
  sets: AdminSet[];
}

/**
 * Admin Preset Chips Center.
 *
 * - Renames flow through to existing assignments via the stable
 *   `chipId` (we never rewrite history, only relabel).
 * - Reorder writes `sortOrder` server-side.
 * - Archive hides a chip from new selections but consumers still
 *   resolve its current label and tag it as "retired".
 * - Service categories support groups: rename inline, move chips
 *   between groups via the per-row group selector.
 */
export default function PresetChipsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { profile } = useProfile();
  const isAdmin = (profile as { isAdmin?: boolean } | null)?.isAdmin === true;

  const [sets, setSets] = useState<AdminSet[]>([]);
  const [openSets, setOpenSets] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ chip: AdminChip; setKey: string } | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [creating, setCreating] = useState<string | null>(null); // setKey
  const [newLabel, setNewLabel] = useState("");
  const [newGroupKey, setNewGroupKey] = useState<string | null>(null);
  const [movingChip, setMovingChip] = useState<{ chip: AdminChip; setKey: string } | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<
    { setKey: string; group: AdminGroup } | null
  >(null);
  const [groupLabelDraft, setGroupLabelDraft] = useState("");
  const [busy, setBusy] = useState(false);

  // --- Toast ---------------------------------------------------------
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
      const res = await customFetch<AdminResponse>("/api/admin/preset-chips");
      setSets(res.sets);
      setOpenSets((cur) => {
        // Default: open the first set, keep prior toggles.
        if (Object.keys(cur).length > 0) return cur;
        const next: Record<string, boolean> = {};
        res.sets.forEach((s: AdminSet, i: number) => {
          next[s.setKey] = i === 0;
        });
        return next;
      });
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

  function updateChipInState(setKey: string, next: AdminChip) {
    setSets((cur) =>
      cur.map((s) =>
        s.setKey === setKey
          ? { ...s, chips: s.chips.map((c) => (c.id === next.id ? next : c)) }
          : s,
      ),
    );
  }

  async function patchChip(
    setKey: string,
    id: number,
    patch: Record<string, unknown>,
    successMsg: string,
  ): Promise<void> {
    setBusy(true);
    try {
      const res = await customFetch<{ chip: AdminChip }>(
        `/api/admin/preset-chips/${id}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      updateChipInState(setKey, res.chip);
      showToast(successMsg);
    } catch (err: unknown) {
      Alert.alert("Edit failed", err instanceof Error ? err.message : "Try again");
      // Rethrow so callers can decide whether to keep their unsaved
      // editing state open after a server-side validation failure.
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function moveChip(setKey: string, id: number, direction: -1 | 1): Promise<void> {
    const set = sets.find((s) => s.setKey === setKey);
    if (!set) return;
    const visible = visibleChipsFor(set, !!showArchived[setKey]);
    const idx = visible.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= visible.length) return;
    const nextOrder = visible.slice();
    const [moved] = nextOrder.splice(idx, 1);
    nextOrder.splice(swapIdx, 0, moved!);
    // Build full ids list (visible reorder + remaining hidden chips at end).
    const visibleIds = new Set(visible.map((c) => c.id));
    const tail = set.chips.filter((c) => !visibleIds.has(c.id));
    const ids = [...nextOrder.map((c) => c.id), ...tail.map((c) => c.id)];
    setBusy(true);
    try {
      await customFetch(
        `/api/admin/preset-chips/${encodeURIComponent(setKey)}/reorder`,
        { method: "POST", body: JSON.stringify({ ids }) },
      );
      setSets((cur) =>
        cur.map((s) =>
          s.setKey === setKey
            ? {
                ...s,
                chips: s.chips
                  .map((c) => {
                    const newIdx = ids.indexOf(c.id);
                    return newIdx >= 0 ? { ...c, sortOrder: newIdx } : c;
                  })
                  .sort((a, b) => a.sortOrder - b.sortOrder),
              }
            : s,
        ),
      );
      showToast("Reordered");
    } catch (err: unknown) {
      Alert.alert("Reorder failed", err instanceof Error ? err.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  async function createChip(setKey: string): Promise<void> {
    const label = newLabel.trim();
    if (label.length === 0) return;
    setBusy(true);
    try {
      const res = await customFetch<{ chip: AdminChip }>(
        "/api/admin/preset-chips",
        {
          method: "POST",
          body: JSON.stringify({ setKey, label, groupKey: newGroupKey }),
        },
      );
      setSets((cur) =>
        cur.map((s) =>
          s.setKey === setKey ? { ...s, chips: [...s.chips, res.chip] } : s,
        ),
      );
      setCreating(null);
      setNewLabel("");
      setNewGroupKey(null);
      showToast("Chip added");
    } catch (err: unknown) {
      Alert.alert("Create failed", err instanceof Error ? err.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(): Promise<void> {
    if (!editing) return;
    const label = editLabel.trim();
    if (label.length === 0) return;
    try {
      await patchChip(editing.setKey, editing.chip.id, { label }, "Renamed");
      setEditing(null);
    } catch {
      // Keep modal + draft so the admin can adjust and retry.
    }
  }

  async function moveChipToGroup(
    setKey: string,
    id: number,
    groupKey: string | null,
  ): Promise<void> {
    try {
      await patchChip(setKey, id, { groupKey }, "Moved");
      setMovingChip(null);
    } catch {
      // Stay open on failure.
    }
  }

  async function renameGroup(): Promise<void> {
    if (!renamingGroup?.group?.id) return;
    const label = groupLabelDraft.trim();
    if (label.length === 0) return;
    setBusy(true);
    try {
      const res = await customFetch<{ group: AdminGroup }>(
        `/api/admin/preset-groups/${renamingGroup.group.id}`,
        { method: "PATCH", body: JSON.stringify({ label }) },
      );
      setSets((cur) =>
        cur.map((s) =>
          s.setKey === renamingGroup.setKey
            ? {
                ...s,
                groups: s.groups.map((g) =>
                  g.groupKey === renamingGroup.group.groupKey
                    ? { ...g, label: res.group.label }
                    : g,
                ),
              }
            : s,
        ),
      );
      showToast("Group renamed");
      setRenamingGroup(null);
    } catch (err: unknown) {
      Alert.alert("Rename failed", err instanceof Error ? err.message : "Try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false, title: "Preset Chips" }} />

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
          contentContainerStyle={{ padding: 16, paddingBottom: 64, gap: 12 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
        >
          <Text style={[s.intro, { color: colors.mutedForeground }]}>
            Edit the chip and token sets used across the app. Renames keep
            existing assignments intact via stable internal ids.
          </Text>

          {sets.map((set) => {
            const open = !!openSets[set.setKey];
            const visible = visibleChipsFor(set, !!showArchived[set.setKey]);
            return (
              <View
                key={set.setKey}
                style={[
                  s.section,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Pressable
                  onPress={() =>
                    setOpenSets((cur) => ({ ...cur, [set.setKey]: !cur[set.setKey] }))
                  }
                  style={s.sectionHeader}
                >
                  <Feather
                    name={open ? "chevron-down" : "chevron-right"}
                    size={18}
                    color={colors.foreground}
                  />
                  <Text style={[s.sectionTitle, { color: colors.foreground }]}>
                    {set.label}
                  </Text>
                  <Text style={[s.sectionCount, { color: colors.mutedForeground }]}>
                    {set.chips.filter((c) => !c.archivedAt).length} active
                  </Text>
                </Pressable>

                {open ? (
                  <View style={{ padding: 12, gap: 10 }}>
                    <View style={s.toolbar}>
                      <Pressable
                        onPress={() => {
                          setCreating(set.setKey);
                          setNewLabel("");
                          setNewGroupKey(null);
                        }}
                        style={[s.toolBtn, { backgroundColor: colors.primary }]}
                      >
                        <Feather name="plus" size={14} color={colors.primaryForeground ?? "#fff"} />
                        <Text style={[s.toolBtnText, { color: colors.primaryForeground ?? "#fff" }]}>
                          Add chip
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          setShowArchived((cur) => ({
                            ...cur,
                            [set.setKey]: !cur[set.setKey],
                          }))
                        }
                        style={[
                          s.toolBtn,
                          {
                            backgroundColor: colors.background,
                            borderColor: colors.border,
                            borderWidth: 1,
                          },
                        ]}
                      >
                        <Feather
                          name={showArchived[set.setKey] ? "eye-off" : "eye"}
                          size={14}
                          color={colors.foreground}
                        />
                        <Text style={[s.toolBtnText, { color: colors.foreground }]}>
                          {showArchived[set.setKey] ? "Hide archived" : "Show archived"}
                        </Text>
                      </Pressable>
                    </View>

                    {set.groups.length > 0 ? (
                      <View style={{ gap: 4 }}>
                        <Text style={[s.subLabel, { color: colors.mutedForeground }]}>
                          GROUPS
                        </Text>
                        <View style={s.groupRow}>
                          {set.groups.map((g) => (
                            <Pressable
                              key={g.groupKey}
                              onPress={() => {
                                setRenamingGroup({ setKey: set.setKey, group: g });
                                setGroupLabelDraft(g.label);
                              }}
                              style={[
                                s.groupTag,
                                {
                                  backgroundColor: colors.background,
                                  borderColor: colors.border,
                                },
                              ]}
                            >
                              <Text style={{ color: colors.foreground, fontSize: 12 }}>
                                {g.label}
                              </Text>
                              <Feather name="edit-2" size={11} color={colors.mutedForeground} />
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ) : null}

                    {visible.length === 0 ? (
                      <Text
                        style={{
                          color: colors.mutedForeground,
                          textAlign: "center",
                          paddingVertical: 16,
                        }}
                      >
                        No chips here yet.
                      </Text>
                    ) : (
                      visible.map((c, i) => {
                        const archived = !!c.archivedAt;
                        const groupLabel = c.groupKey
                          ? set.groups.find((g) => g.groupKey === c.groupKey)?.label ?? c.groupKey
                          : null;
                        return (
                          <View
                            key={c.id}
                            style={[
                              s.row,
                              {
                                backgroundColor: colors.background,
                                borderColor: colors.border,
                                opacity: archived ? 0.55 : 1,
                              },
                            ]}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={[s.rowLabel, { color: colors.foreground }]}>
                                {c.label}
                                {archived ? (
                                  <Text style={{ color: colors.mutedForeground }}> · retired</Text>
                                ) : null}
                              </Text>
                              <Text style={[s.rowMeta, { color: colors.mutedForeground }]}>
                                id: {c.chipId}
                                {groupLabel ? ` · ${groupLabel}` : ""}
                              </Text>
                            </View>
                            <Pressable
                              onPress={() => moveChip(set.setKey, c.id, -1)}
                              disabled={busy || i === 0}
                              hitSlop={10}
                              style={s.iconBtn}
                            >
                              <Feather
                                name="chevron-up"
                                size={18}
                                color={i === 0 ? colors.mutedForeground : colors.foreground}
                              />
                            </Pressable>
                            <Pressable
                              onPress={() => moveChip(set.setKey, c.id, 1)}
                              disabled={busy || i === visible.length - 1}
                              hitSlop={10}
                              style={s.iconBtn}
                            >
                              <Feather
                                name="chevron-down"
                                size={18}
                                color={
                                  i === visible.length - 1
                                    ? colors.mutedForeground
                                    : colors.foreground
                                }
                              />
                            </Pressable>
                            {set.groups.length > 0 ? (
                              <Pressable
                                onPress={() => setMovingChip({ chip: c, setKey: set.setKey })}
                                disabled={busy}
                                hitSlop={10}
                                style={s.iconBtn}
                              >
                                <Feather name="folder" size={16} color={colors.foreground} />
                              </Pressable>
                            ) : null}
                            <Pressable
                              onPress={() => {
                                setEditing({ chip: c, setKey: set.setKey });
                                setEditLabel(c.label);
                              }}
                              disabled={busy}
                              hitSlop={10}
                              style={s.iconBtn}
                            >
                              <Feather name="edit-2" size={16} color={colors.foreground} />
                            </Pressable>
                            <Pressable
                              onPress={() =>
                                patchChip(
                                  set.setKey,
                                  c.id,
                                  { archived: !archived },
                                  archived ? "Restored" : "Archived",
                                )
                              }
                              disabled={busy}
                              hitSlop={10}
                              style={s.iconBtn}
                            >
                              <Feather
                                name={archived ? "rotate-ccw" : "archive"}
                                size={16}
                                color={colors.foreground}
                              />
                            </Pressable>
                          </View>
                        );
                      })
                    )}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Toast */}
      {toast ? (
        <Animated.View
          pointerEvents="none"
          style={[
            s.toast,
            { backgroundColor: colors.foreground, opacity: toastOpacity },
          ]}
        >
          <Feather name="check" size={14} color={colors.background} />
          <Text style={{ color: colors.background, fontWeight: "600" }}>{toast}</Text>
        </Animated.View>
      ) : null}

      {/* Rename chip modal */}
      <Modal
        visible={!!editing}
        animationType="fade"
        transparent
        onRequestClose={() => setEditing(null)}
      >
        <View style={s.modalScrim}>
          <View style={[s.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[s.modalTitle, { color: colors.foreground }]}>Rename chip</Text>
            <Text style={[s.modalHelp, { color: colors.mutedForeground }]}>
              Only the label changes. The internal id stays the same so existing
              assignments keep referencing this chip.
            </Text>
            <TextInput
              value={editLabel}
              onChangeText={setEditLabel}
              autoFocus
              style={[s.input, { color: colors.foreground, borderColor: colors.border }]}
              placeholderTextColor={colors.mutedForeground}
            />
            <View style={s.modalActions}>
              <Pressable onPress={() => setEditing(null)} style={s.modalBtn}>
                <Text style={{ color: colors.mutedForeground }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveEdit} disabled={busy} style={s.modalBtn}>
                <Text style={{ color: colors.primary, fontWeight: "700" }}>
                  {busy ? "…" : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Create chip modal */}
      <Modal
        visible={!!creating}
        animationType="fade"
        transparent
        onRequestClose={() => setCreating(null)}
      >
        <View style={s.modalScrim}>
          <View style={[s.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[s.modalTitle, { color: colors.foreground }]}>
              Add chip to {sets.find((x) => x.setKey === creating)?.label ?? ""}
            </Text>
            <TextInput
              value={newLabel}
              onChangeText={setNewLabel}
              autoFocus
              placeholder="Chip label"
              placeholderTextColor={colors.mutedForeground}
              style={[s.input, { color: colors.foreground, borderColor: colors.border }]}
            />
            {creating
              ? (() => {
                  const set = sets.find((x) => x.setKey === creating);
                  if (!set || set.groups.length === 0) return null;
                  return (
                    <View style={{ gap: 6, marginTop: 8 }}>
                      <Text style={[s.modalHelp, { color: colors.mutedForeground }]}>
                        Group (optional)
                      </Text>
                      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                        <Pressable
                          onPress={() => setNewGroupKey(null)}
                          style={[
                            s.groupChip,
                            {
                              backgroundColor:
                                newGroupKey == null ? colors.primary : colors.background,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <Text
                            style={{
                              color:
                                newGroupKey == null
                                  ? colors.primaryForeground ?? "#fff"
                                  : colors.foreground,
                              fontSize: 12,
                            }}
                          >
                            None
                          </Text>
                        </Pressable>
                        {set.groups.map((g) => {
                          const active = newGroupKey === g.groupKey;
                          return (
                            <Pressable
                              key={g.groupKey}
                              onPress={() => setNewGroupKey(g.groupKey)}
                              style={[
                                s.groupChip,
                                {
                                  backgroundColor: active ? colors.primary : colors.background,
                                  borderColor: colors.border,
                                },
                              ]}
                            >
                              <Text
                                style={{
                                  color: active
                                    ? colors.primaryForeground ?? "#fff"
                                    : colors.foreground,
                                  fontSize: 12,
                                }}
                              >
                                {g.label}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  );
                })()
              : null}
            <View style={s.modalActions}>
              <Pressable
                onPress={() => {
                  setCreating(null);
                  setNewLabel("");
                  setNewGroupKey(null);
                }}
                style={s.modalBtn}
              >
                <Text style={{ color: colors.mutedForeground }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => creating && createChip(creating)}
                disabled={busy || newLabel.trim().length === 0}
                style={s.modalBtn}
              >
                <Text
                  style={{
                    color:
                      newLabel.trim().length === 0 ? colors.mutedForeground : colors.primary,
                    fontWeight: "700",
                  }}
                >
                  {busy ? "…" : "Add"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Move-to-group modal */}
      <Modal
        visible={!!movingChip}
        animationType="fade"
        transparent
        onRequestClose={() => setMovingChip(null)}
      >
        <View style={s.modalScrim}>
          <View style={[s.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[s.modalTitle, { color: colors.foreground }]}>
              Move "{movingChip?.chip.label}" to group
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
              <Pressable
                onPress={() => movingChip && moveChipToGroup(movingChip.setKey, movingChip.chip.id, null)}
                style={[
                  s.groupChip,
                  { backgroundColor: colors.background, borderColor: colors.border },
                ]}
              >
                <Text style={{ color: colors.foreground, fontSize: 12 }}>None</Text>
              </Pressable>
              {(sets.find((x) => x.setKey === movingChip?.setKey)?.groups ?? []).map((g) => (
                <Pressable
                  key={g.groupKey}
                  onPress={() => movingChip && moveChipToGroup(movingChip.setKey, movingChip.chip.id, g.groupKey)}
                  style={[
                    s.groupChip,
                    {
                      backgroundColor:
                        movingChip?.chip.groupKey === g.groupKey
                          ? colors.primary
                          : colors.background,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color:
                        movingChip?.chip.groupKey === g.groupKey
                          ? colors.primaryForeground ?? "#fff"
                          : colors.foreground,
                      fontSize: 12,
                    }}
                  >
                    {g.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={s.modalActions}>
              <Pressable onPress={() => setMovingChip(null)} style={s.modalBtn}>
                <Text style={{ color: colors.mutedForeground }}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Rename group modal */}
      <Modal
        visible={!!renamingGroup}
        animationType="fade"
        transparent
        onRequestClose={() => setRenamingGroup(null)}
      >
        <View style={s.modalScrim}>
          <View style={[s.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[s.modalTitle, { color: colors.foreground }]}>Rename group</Text>
            <TextInput
              value={groupLabelDraft}
              onChangeText={setGroupLabelDraft}
              autoFocus
              style={[s.input, { color: colors.foreground, borderColor: colors.border }]}
              placeholderTextColor={colors.mutedForeground}
            />
            <View style={s.modalActions}>
              <Pressable onPress={() => setRenamingGroup(null)} style={s.modalBtn}>
                <Text style={{ color: colors.mutedForeground }}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={renameGroup}
                disabled={busy || groupLabelDraft.trim().length === 0}
                style={s.modalBtn}
              >
                <Text
                  style={{
                    color:
                      groupLabelDraft.trim().length === 0
                        ? colors.mutedForeground
                        : colors.primary,
                    fontWeight: "700",
                  }}
                >
                  {busy ? "…" : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function visibleChipsFor(set: AdminSet, includeArchived: boolean): AdminChip[] {
  const sorted = [...set.chips].sort((a, b) => a.sortOrder - b.sortOrder);
  return includeArchived ? sorted : sorted.filter((c) => !c.archivedAt);
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  intro: { fontSize: 13, marginBottom: 4 },
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
  subLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  toolbar: { flexDirection: "row", gap: 8 },
  toolBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  toolBtnText: { fontSize: 13, fontWeight: "600" },
  groupRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  groupTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  rowLabel: { fontSize: 14, fontWeight: "600" },
  rowMeta: { fontSize: 11, marginTop: 2 },
  iconBtn: { paddingHorizontal: 6, paddingVertical: 6 },
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
    gap: 16,
    marginTop: 16,
  },
  modalBtn: { paddingHorizontal: 8, paddingVertical: 8 },
  groupChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  toast: {
    position: "absolute",
    top: 16,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
  },
});
