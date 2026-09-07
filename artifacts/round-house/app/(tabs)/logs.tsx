import React, { useMemo, useState } from "react";
import {
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { resolveStorageUrl } from "@/lib/uploads";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import {
  useGetFeed,
  useListProperties,
  useCreateProperty,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  openCaptureNote,
  openCapturePhotoForLog,
} from "@/components/CaptureFAB";
import { AddPropertyModal } from "@/components/AddPropertyModal";

// "Logs" tab: a dedicated home for the user's project logs (in this app a
// "log" maps to a property — the durable container that work-log entries
// belong to). Replaces the old center capture FAB; gives logs a real
// surface with search, an active list, and direct entry points for the
// Photo and Note quick composers.

type LogRow = {
  id: number;
  name: string;
  coverColor: string | null;
  lastActivity: number; // ms epoch — Infinity if no activity yet so brand-new logs surface
  entryCount: number;
  // Preview of the most recent entry for this log. Sourced from the same
  // feed roll-up that gives us lastActivity / entryCount — no extra calls.
  previewPhotoUrl: string | null;
  previewNote: string | null;
};

function snippet(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + "…";
}

function formatRelative(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "no activity yet";
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return "just now";
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function LogsScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  // Picker shown when the user taps the "Photo" quick-action — lets them
  // choose which log the new photo belongs to before the camera opens.
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [photoPickerQuery, setPhotoPickerQuery] = useState("");

  const propertiesQuery = useListProperties();
  const feedQuery = useGetFeed();
  const createProperty = useCreateProperty();

  const properties = propertiesQuery.data?.properties ?? [];
  const logs = feedQuery.data?.logs ?? [];

  // Build the active-logs list: roll up the feed by property to get last
  // activity + entry count, then merge with every property the user can see
  // so freshly-created logs (zero entries) still appear.
  const rows = useMemo<LogRow[]>(() => {
    const stats = new Map<
      number,
      { last: number; count: number; photoUrl: string | null; note: string | null }
    >();
    for (const l of logs) {
      const t = new Date(l.createdAt).getTime();
      const photoUrl = l.photoUrl ?? null;
      const note = l.note ?? null;
      const cur = stats.get(l.propertyId);
      if (!cur) {
        stats.set(l.propertyId, { last: t, count: 1, photoUrl, note });
      } else {
        cur.count += 1;
        // Track preview from whichever entry is the most recent.
        if (t > cur.last) {
          cur.last = t;
          cur.photoUrl = photoUrl;
          cur.note = note;
        }
      }
    }
    const out: LogRow[] = properties.map((p) => {
      const s = stats.get(p.id);
      return {
        id: p.id,
        name: p.name,
        coverColor: p.coverColor ?? null,
        lastActivity: s?.last ?? 0,
        entryCount: s?.count ?? 0,
        previewPhotoUrl: s?.photoUrl ?? null,
        previewNote: s?.note && s.note.trim().length > 0 ? snippet(s.note) : null,
      };
    });
    // Most-recently-active first; logs with no activity yet fall to the
    // bottom (lastActivity = 0).
    out.sort((a, b) => b.lastActivity - a.lastActivity);
    return out;
  }, [logs, properties]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  const refreshing = propertiesQuery.isRefetching || feedQuery.isRefetching;
  const onRefresh = () => {
    propertiesQuery.refetch();
    feedQuery.refetch();
  };

  const topPad = embedded ? 4 : Platform.OS === "web" ? 24 : insets.top + 12;
  const bottomPad = embedded
    ? 24
    : Platform.OS === "web"
      ? 34 + 100
      : insets.bottom + 100;

  const handleNewLog = () => {
    Haptics.selectionAsync();
    setAddOpen(true);
  };

  const handlePickPhotoLog = (id: number) => {
    setPhotoPickerOpen(false);
    setPhotoPickerQuery("");
    openCapturePhotoForLog(id);
  };

  const handlePhoto = () => {
    Haptics.selectionAsync();
    if (properties.length === 0) {
      // Nudge them to create a log first — photos can't exist without one.
      setAddOpen(true);
      return;
    }
    setPhotoPickerOpen(true);
  };

  const handleNote = () => {
    Haptics.selectionAsync();
    openCaptureNote();
  };

  const openLog = (id: number) => {
    Haptics.selectionAsync();
    router.push(`/property/${id}` as never);
  };

  const photoPickerFiltered = useMemo(() => {
    const q = photoPickerQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, photoPickerQuery]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: topPad, paddingBottom: bottomPad }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {embedded ? null : (
          <Text style={[styles.header, { color: colors.foreground }]}>Logs</Text>
        )}

        {/* Primary "New Log" button — pill styling matches the primary
            buttons used on the timeline / profile screens. */}
        <Pressable
          onPress={handleNewLog}
          accessibilityRole="button"
          accessibilityLabel="Create a new log"
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Feather name="plus" size={16} color={colors.primaryForeground ?? "#fff"} />
          <Text style={[styles.primaryBtnText, { color: colors.primaryForeground ?? "#fff" }]}>
            New Log
          </Text>
        </Pressable>

        {/* Quick-add entry points: Photo (with destination picker) and Note. */}
        <View style={styles.quickRow}>
          <QuickEntryBtn
            icon="camera"
            label="Photo"
            onPress={handlePhoto}
            colors={colors}
          />
          <QuickEntryBtn
            icon="edit-3"
            label="Note"
            onPress={handleNote}
            colors={colors}
          />
        </View>

        {/* Search */}
        <View
          style={[
            styles.searchBar,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={15} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search logs"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query.length > 0 ? (
            <Pressable onPress={() => setQuery("")} hitSlop={8} accessibilityLabel="Clear search">
              <Feather name="x" size={15} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
        </View>

        {/* Active logs list */}
        {filteredRows.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Feather name="inbox" size={28} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              {properties.length === 0 ? "No logs yet" : "No logs match your search"}
            </Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              {properties.length === 0
                ? "Create your first log to start capturing photos and notes."
                : "Try a different name or clear your search."}
            </Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {filteredRows.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => openLog(r.id)}
                accessibilityRole="button"
                accessibilityLabel={`Open log ${r.name}`}
                style={({ pressed }) => [
                  styles.logRow,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <LogPreviewLeading row={r} colors={colors} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={[styles.logName, { color: colors.foreground }]}
                    numberOfLines={1}
                  >
                    {r.name}
                  </Text>
                  <Text
                    style={[styles.logMeta, { color: colors.mutedForeground }]}
                    numberOfLines={1}
                  >
                    {formatRelative(r.lastActivity)} · {r.entryCount}{" "}
                    {r.entryCount === 1 ? "entry" : "entries"}
                  </Text>
                  {/* Show the latest note snippet only when there's no photo
                      to display as the visual preview — otherwise the
                      thumbnail is doing the scannability work. */}
                  {!r.previewPhotoUrl && r.previewNote ? (
                    <Text
                      style={[styles.logSnippet, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {r.previewNote}
                    </Text>
                  ) : null}
                </View>
                <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <AddPropertyModal
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={async (values) => {
          await createProperty.mutateAsync({ data: values });
          await queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
          setAddOpen(false);
        }}
      />

      {/* Photo destination picker — same shape as the main list (search +
          most-active-first). On select we hand off to the existing photo
          composer with the chosen log preassigned. */}
      <PhotoLogPickerSheet
        visible={photoPickerOpen}
        rows={photoPickerFiltered}
        query={photoPickerQuery}
        setQuery={setPhotoPickerQuery}
        onCancel={() => {
          setPhotoPickerOpen(false);
          setPhotoPickerQuery("");
        }}
        onPick={handlePickPhotoLog}
        colors={colors}
        insets={insets}
      />
    </View>
  );
}

function LogPreviewLeading({
  row,
  colors,
}: {
  row: LogRow;
  colors: ReturnType<typeof useColors>;
}) {
  // Prefer the most recent entry's photo as the row's visual. Fall back to
  // the property's colored swatch when there's no photo (note-only entries
  // or no entries at all).
  const thumb = row.previewPhotoUrl ? resolveStorageUrl(row.previewPhotoUrl) : null;
  if (thumb) {
    return (
      <Image
        source={{ uri: thumb }}
        style={[styles.logThumb, { backgroundColor: colors.muted }]}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View
      style={[
        styles.logSwatch,
        { backgroundColor: row.coverColor || colors.primary },
      ]}
    />
  );
}

function QuickEntryBtn({
  icon,
  label,
  onPress,
  colors,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.quickBtn,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Feather name={icon} size={18} color={colors.primary} />
      <Text style={[styles.quickBtnText, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  );
}

function PhotoLogPickerSheet({
  visible,
  rows,
  query,
  setQuery,
  onCancel,
  onPick,
  colors,
  insets,
}: {
  visible: boolean;
  rows: LogRow[];
  query: string;
  setQuery: (s: string) => void;
  onCancel: () => void;
  onPick: (id: number) => void;
  colors: ReturnType<typeof useColors>;
  insets: { bottom: number };
}) {
  if (!visible) return null;
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable onPress={onCancel} style={styles.backdrop}>
        <Pressable
          onPress={() => {}}
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <View style={styles.sheetHandle} />
          <Text style={[styles.sheetTitle, { color: colors.foreground }]}>
            What log does this go to?
          </Text>
          <View
            style={[
              styles.searchBar,
              { backgroundColor: colors.background, borderColor: colors.border, marginBottom: 8 },
            ]}
          >
            <Feather name="search" size={14} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search logs"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.searchInput, { color: colors.foreground }]}
              autoCorrect={false}
              autoCapitalize="none"
            />
          </View>
          <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
            {rows.length === 0 ? (
              <Text
                style={{
                  color: colors.mutedForeground,
                  textAlign: "center",
                  paddingVertical: 16,
                  fontFamily: "Inter_500Medium",
                  fontSize: 13,
                }}
              >
                No logs match your search.
              </Text>
            ) : (
              rows.map((r, idx) => (
                <Pressable
                  key={r.id}
                  onPress={() => onPick(r.id)}
                  style={[
                    styles.pickerRow,
                    {
                      borderTopColor: colors.border,
                      borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <View
                    style={[styles.logSwatch, { backgroundColor: r.coverColor || colors.primary, width: 10, height: 10, borderRadius: 5 }]}
                  />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.logName, { color: colors.foreground }]} numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text style={[styles.logMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
                      {formatRelative(r.lastActivity)}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                </Pressable>
              ))
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 16, gap: 12 },
  header: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    marginBottom: 4,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
  },
  primaryBtnText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  quickRow: { flexDirection: "row", gap: 10 },
  quickBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  quickBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    padding: 0,
  },
  emptyWrap: {
    alignItems: "center",
    gap: 6,
    paddingVertical: 32,
  },
  emptyTitle: { fontSize: 15, fontFamily: "Inter_700Bold" },
  emptyBody: { fontSize: 13, fontFamily: "Inter_400Regular", textAlign: "center", paddingHorizontal: 24 },
  logRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  logSwatch: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  logThumb: {
    width: 36,
    height: 36,
    borderRadius: 8,
  },
  logName: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  logMeta: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 2 },
  logSnippet: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(127,127,127,0.4)",
    marginBottom: 10,
  },
  sheetTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 8 },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
});
