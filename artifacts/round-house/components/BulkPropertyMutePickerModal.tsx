import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useQueryClient } from "@tanstack/react-query";
import {
  useBulkUpdateMyPropertyNotificationOverrides,
  getListMyPropertyNotificationOverridesQueryKey,
  getListPropertiesQueryKey,
} from "@workspace/api-client-react";

type PropertyOption = {
  id: number;
  name: string;
  notifyJobStarted: boolean | null | undefined;
  notifyJobCompleted: boolean | null | undefined;
};

type Action =
  | { kind: "mute_started" }
  | { kind: "mute_completed" }
  | { kind: "enable_started" }
  | { kind: "enable_completed" }
  | { kind: "reset" };

interface Props {
  visible: boolean;
  onClose: () => void;
  properties: PropertyOption[];
  globalNotifyJobStarted: boolean;
  globalNotifyJobCompleted: boolean;
}

export function BulkPropertyMutePickerModal({
  visible,
  onClose,
  properties,
  globalNotifyJobStarted,
  globalNotifyJobCompleted,
}: Props) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const bulkUpdate = useBulkUpdateMyPropertyNotificationOverrides();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<Action["kind"] | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [onlyOverridden, setOnlyOverridden] = useState(false);

  type PrevOverride = {
    notifyJobStarted: boolean | null;
    notifyJobCompleted: boolean | null;
  };
  type PendingUndo = {
    id: number;
    actionKind: Action["kind"];
    summary: string;
    fields: ("notifyJobStarted" | "notifyJobCompleted")[];
    prev: Map<number, PrevOverride>;
  };
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoIdRef = useRef(0);
  const [undoing, setUndoing] = useState(false);

  const clearUndo = useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setPendingUndo(null);
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!visible) {
      setSelected(new Set());
      setError(null);
      setSuccessMessage(null);
      setPendingAction(null);
      setSearch("");
      setOnlyOverridden(false);
      clearUndo();
      setUndoing(false);
    }
  }, [visible, clearUndo]);

  const sorted = useMemo(
    () =>
      [...properties].sort((a, b) => {
        const aOverridden =
          a.notifyJobStarted != null || a.notifyJobCompleted != null;
        const bOverridden =
          b.notifyJobStarted != null || b.notifyJobCompleted != null;
        if (aOverridden !== bOverridden) return aOverridden ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }),
    [properties],
  );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return sorted.filter((p) => {
      if (query && !p.name.toLowerCase().includes(query)) return false;
      if (onlyOverridden && p.notifyJobStarted == null && p.notifyJobCompleted == null) {
        return false;
      }
      return true;
    });
  }, [sorted, search, onlyOverridden]);

  const visibleSelectedCount = filtered.reduce(
    (n, p) => (selected.has(p.id) ? n + 1 : n),
    0,
  );
  const allVisibleSelected =
    filtered.length > 0 && visibleSelectedCount === filtered.length;

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setError(null);
    setSuccessMessage(null);
    clearUndo();
  }

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const p of filtered) next.delete(p.id);
      } else {
        for (const p of filtered) next.add(p.id);
      }
      return next;
    });
    setError(null);
    setSuccessMessage(null);
    clearUndo();
  }

  function handleSearchChange(text: string) {
    setSearch(text);
    setSuccessMessage(null);
    clearUndo();
  }

  function handleToggleOnlyOverridden() {
    setOnlyOverridden((v) => !v);
    setSuccessMessage(null);
    clearUndo();
  }

  async function applyAction(action: Action) {
    if (selected.size === 0) {
      setError("Pick at least one property first.");
      return;
    }
    const propertyIds = Array.from(selected);
    const propertyById = new Map(properties.map((p) => [p.id, p]));
    const prev = new Map<number, PrevOverride>();
    for (const id of propertyIds) {
      const p = propertyById.get(id);
      prev.set(id, {
        notifyJobStarted: p?.notifyJobStarted ?? null,
        notifyJobCompleted: p?.notifyJobCompleted ?? null,
      });
    }
    clearUndo();
    setPendingAction(action.kind);
    setError(null);
    setSuccessMessage(null);
    const body =
      action.kind === "mute_started"
        ? { propertyIds, notifyJobStarted: false }
        : action.kind === "mute_completed"
        ? { propertyIds, notifyJobCompleted: false }
        : action.kind === "enable_started"
        ? { propertyIds, notifyJobStarted: true }
        : action.kind === "enable_completed"
        ? { propertyIds, notifyJobCompleted: true }
        : { propertyIds, notifyJobStarted: null, notifyJobCompleted: null };
    const fields: ("notifyJobStarted" | "notifyJobCompleted")[] =
      action.kind === "reset"
        ? ["notifyJobStarted", "notifyJobCompleted"]
        : action.kind === "mute_started" || action.kind === "enable_started"
        ? ["notifyJobStarted"]
        : ["notifyJobCompleted"];
    try {
      await bulkUpdate.mutateAsync({ data: body });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getListMyPropertyNotificationOverridesQueryKey(),
        }),
        queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() }),
      ]);
      const verb =
        action.kind === "reset"
          ? "Reset"
          : action.kind === "mute_started"
          ? "Muted job-started alerts"
          : action.kind === "mute_completed"
          ? "Muted job-completed alerts"
          : action.kind === "enable_started"
          ? "Turned on job-started alerts"
          : "Turned on job-completed alerts";
      const summary = `${verb} on ${propertyIds.length} ${
        propertyIds.length === 1 ? "property" : "properties"
      }.`;
      setSuccessMessage(summary);
      setSelected(new Set());

      undoIdRef.current += 1;
      const myUndoId = undoIdRef.current;
      setPendingUndo({
        id: myUndoId,
        actionKind: action.kind,
        summary,
        fields,
        prev,
      });
      undoTimerRef.current = setTimeout(() => {
        setPendingUndo((cur) => {
          if (cur && cur.id === myUndoId) {
            setSuccessMessage(null);
            return null;
          }
          return cur;
        });
        undoTimerRef.current = null;
      }, 5000);
    } catch {
      setError("Could not apply that change. Please try again.");
    } finally {
      setPendingAction(null);
    }
  }

  async function performUndo() {
    const undo = pendingUndo;
    if (!undo) return;
    clearUndo();
    setUndoing(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const tasks: Promise<unknown>[] = [];
      for (const field of undo.fields) {
        const groups = new Map<boolean | null, number[]>();
        for (const [propertyId, prev] of undo.prev) {
          const value = prev[field];
          const group = groups.get(value) ?? [];
          group.push(propertyId);
          groups.set(value, group);
        }
        for (const [value, ids] of groups) {
          if (ids.length === 0) continue;
          tasks.push(
            bulkUpdate.mutateAsync({
              data: { propertyIds: ids, [field]: value },
            }),
          );
        }
      }
      const results = await Promise.allSettled(tasks);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getListMyPropertyNotificationOverridesQueryKey(),
        }),
        queryClient.invalidateQueries({ queryKey: getListPropertiesQueryKey() }),
      ]);
      if (results.some((r) => r.status === "rejected")) {
        setError("Could not undo that change. Please try again.");
      } else {
        setSuccessMessage("Change undone.");
      }
    } catch {
      setError("Could not undo that change. Please try again.");
    } finally {
      setUndoing(false);
    }
  }

  function describeOverride(p: PropertyOption): string {
    const parts: string[] = [];
    if (p.notifyJobStarted != null) {
      parts.push(`Started: ${p.notifyJobStarted ? "On" : "Off"}`);
    }
    if (p.notifyJobCompleted != null) {
      parts.push(`Completed: ${p.notifyJobCompleted ? "On" : "Off"}`);
    }
    if (parts.length === 0) {
      return `Following defaults (Started ${
        globalNotifyJobStarted ? "on" : "off"
      }, Completed ${globalNotifyJobCompleted ? "on" : "off"})`;
    }
    return parts.join(" · ");
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={[
            styles.header,
            { borderBottomColor: colors.border, backgroundColor: colors.background },
          ]}
        >
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Text style={{ color: colors.primary, fontSize: 14, fontFamily: "Inter_600SemiBold" }}>
              Done
            </Text>
          </Pressable>
          <Text style={{ color: colors.foreground, fontSize: 16, fontFamily: "Inter_700Bold" }}>
            Bulk job alerts
          </Text>
          <Pressable onPress={toggleAll} hitSlop={10} disabled={filtered.length === 0}>
            <Text
              style={{
                color: filtered.length === 0 ? colors.mutedForeground : colors.primary,
                fontSize: 13,
                fontFamily: "Inter_600SemiBold",
              }}
            >
              {allVisibleSelected ? "Clear" : "Select all"}
            </Text>
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
          <Text
            style={{
              color: colors.mutedForeground,
              fontSize: 12,
              fontFamily: "Inter_400Regular",
            }}
          >
            Pick the properties you want to apply the same change to, then choose an action below.
          </Text>
        </View>

        {sorted.length > 0 ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 8 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: colors.card,
              }}
            >
              <Feather name="search" size={14} color={colors.mutedForeground} />
              <TextInput
                value={search}
                onChangeText={handleSearchChange}
                placeholder="Search properties"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  flex: 1,
                  paddingVertical: 0,
                  color: colors.foreground,
                  fontSize: 14,
                  fontFamily: "Inter_400Regular",
                }}
              />
              {search.length > 0 ? (
                <Pressable onPress={() => handleSearchChange("")} hitSlop={10}>
                  <Feather name="x" size={14} color={colors.mutedForeground} />
                </Pressable>
              ) : null}
            </View>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Pressable
                onPress={handleToggleOnlyOverridden}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Only overridden"
                accessibilityState={{ selected: onlyOverridden }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: onlyOverridden ? colors.primary : colors.border,
                  backgroundColor: onlyOverridden ? colors.primary : colors.card,
                }}
              >
                <Feather
                  name={onlyOverridden ? "check" : "filter"}
                  size={12}
                  color={onlyOverridden ? colors.primaryForeground : colors.foreground}
                />
                <Text
                  style={{
                    color: onlyOverridden ? colors.primaryForeground : colors.foreground,
                    fontSize: 12,
                    fontFamily: "Inter_600SemiBold",
                  }}
                >
                  Only overridden
                </Text>
              </Pressable>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 12,
                  fontFamily: "Inter_500Medium",
                }}
              >
                {filtered.length} of {sorted.length}
              </Text>
            </View>
          </View>
        ) : null}

        {sorted.length === 0 ? (
          <View style={{ padding: 24, alignItems: "center" }}>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 13,
                fontFamily: "Inter_500Medium",
              }}
            >
              You're not a member of any properties yet.
            </Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={{ padding: 24, alignItems: "center" }}>
            <Text
              style={{
                color: colors.mutedForeground,
                fontSize: 13,
                fontFamily: "Inter_500Medium",
                textAlign: "center",
              }}
            >
              No properties match your filters.
            </Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={{ padding: 16, gap: 8, paddingBottom: 200 }}
            renderItem={({ item }) => {
              const isSelected = selected.has(item.id);
              return (
                <Pressable
                  onPress={() => toggle(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Toggle selection of ${item.name}`}
                  accessibilityState={{ selected: isSelected }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    padding: 14,
                    borderRadius: 12,
                    borderWidth: isSelected ? 2 : 1,
                    borderColor: isSelected ? colors.primary : colors.border,
                    backgroundColor: colors.card,
                  }}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      borderWidth: 2,
                      borderColor: isSelected ? colors.primary : colors.border,
                      backgroundColor: isSelected ? colors.primary : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {isSelected ? (
                      <Feather name="check" size={14} color={colors.primaryForeground} />
                    ) : null}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text
                      style={{
                        color: colors.foreground,
                        fontSize: 14,
                        fontFamily: "Inter_600SemiBold",
                      }}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 12,
                        fontFamily: "Inter_400Regular",
                      }}
                      numberOfLines={2}
                    >
                      {describeOverride(item)}
                    </Text>
                  </View>
                </Pressable>
              );
            }}
          />
        )}

        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: 16,
            paddingBottom: 28,
            gap: 8,
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: colors.border,
            backgroundColor: colors.background,
          }}
        >
          <Text
            style={{
              fontSize: 12,
              fontFamily: "Inter_500Medium",
              color: colors.mutedForeground,
            }}
          >
            {selected.size} selected
          </Text>
          {error ? (
            <Text
              style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: colors.destructive }}
            >
              {error}
            </Text>
          ) : null}
          {successMessage && !pendingUndo ? (
            <Text
              style={{ fontSize: 12, fontFamily: "Inter_500Medium", color: colors.success }}
            >
              {successMessage}
            </Text>
          ) : null}
          {pendingUndo ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingVertical: 10,
                paddingHorizontal: 12,
                backgroundColor: colors.foreground,
                borderRadius: 12,
              }}
              accessibilityLiveRegion="polite"
            >
              <Feather
                name={
                  pendingUndo.actionKind === "reset"
                    ? "rotate-ccw"
                    : pendingUndo.actionKind === "enable_started" ||
                      pendingUndo.actionKind === "enable_completed"
                    ? "bell"
                    : "bell-off"
                }
                size={14}
                color={colors.background}
              />
              <Text
                style={{
                  flex: 1,
                  color: colors.background,
                  fontSize: 13,
                  fontFamily: "Inter_500Medium",
                }}
                numberOfLines={2}
              >
                {pendingUndo.summary}
              </Text>
              <Pressable
                onPress={performUndo}
                hitSlop={8}
                disabled={undoing}
                accessibilityRole="button"
                accessibilityLabel="Undo bulk property change"
                style={{
                  paddingVertical: 4,
                  paddingHorizontal: 10,
                  borderRadius: 8,
                  backgroundColor: colors.background + "22",
                  opacity: undoing ? 0.6 : 1,
                }}
              >
                {undoing ? (
                  <ActivityIndicator size="small" color={colors.background} />
                ) : (
                  <Text
                    style={{
                      color: colors.background,
                      fontSize: 13,
                      fontFamily: "Inter_700Bold",
                      letterSpacing: 0.4,
                    }}
                  >
                    UNDO
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}
          <ActionButton
            colors={colors}
            label="Mute job started"
            icon="bell-off"
            disabled={selected.size === 0 || pendingAction !== null || undoing}
            loading={pendingAction === "mute_started"}
            onPress={() => applyAction({ kind: "mute_started" })}
          />
          <ActionButton
            colors={colors}
            label="Mute job completed"
            icon="bell-off"
            disabled={selected.size === 0 || pendingAction !== null || undoing}
            loading={pendingAction === "mute_completed"}
            onPress={() => applyAction({ kind: "mute_completed" })}
          />
          <ActionButton
            colors={colors}
            label="Turn on job started"
            icon="bell"
            disabled={selected.size === 0 || pendingAction !== null || undoing}
            loading={pendingAction === "enable_started"}
            onPress={() => applyAction({ kind: "enable_started" })}
          />
          <ActionButton
            colors={colors}
            label="Turn on job completed"
            icon="bell"
            disabled={selected.size === 0 || pendingAction !== null || undoing}
            loading={pendingAction === "enable_completed"}
            onPress={() => applyAction({ kind: "enable_completed" })}
          />
          <ActionButton
            colors={colors}
            label="Reset to default"
            icon="rotate-ccw"
            variant="secondary"
            disabled={selected.size === 0 || pendingAction !== null || undoing}
            loading={pendingAction === "reset"}
            onPress={() => applyAction({ kind: "reset" })}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function ActionButton({
  colors,
  label,
  icon,
  onPress,
  disabled,
  loading,
  variant = "primary",
}: {
  colors: ReturnType<typeof useColors>;
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary";
}) {
  const isPrimary = variant === "primary";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        paddingVertical: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: isPrimary ? colors.primary : colors.border,
        backgroundColor: isPrimary ? colors.primary : colors.card,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {loading ? (
        <ActivityIndicator
          size="small"
          color={isPrimary ? colors.primaryForeground : colors.foreground}
        />
      ) : (
        <Feather
          name={icon}
          size={14}
          color={isPrimary ? colors.primaryForeground : colors.foreground}
        />
      )}
      <Text
        style={{
          color: isPrimary ? colors.primaryForeground : colors.foreground,
          fontSize: 14,
          fontFamily: "Inter_600SemiBold",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
