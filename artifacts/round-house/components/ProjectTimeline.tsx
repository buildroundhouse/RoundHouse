import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Dimensions,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  FadeIn,
  FadeInDown,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  Easing,
  type SharedValue,
} from "react-native-reanimated";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { useColors } from "@/hooks/useColors";
import { resolveStorageUrl } from "@/lib/uploads";
import { PhotoHintBadge } from "@/components/PhotoHintBadge";
import {
  useTimelineMotionConfig,
  useTimelineMotionConfigRef,
} from "@/lib/timelineMotionDebug";
import type { WorkLog, WorkLogAttachment } from "@workspace/api-client-react";

type Colors = ReturnType<typeof useColors>;

export type TimelineFileAttachment = {
  url: string | null;
  name: string;
};

export type TimelineEvent = {
  id: string;
  kind:
    | "work_logged"
    | "client_note"
    | "photo"
    | "receipt"
    | "material_run"
    | "estimate"
    | "invoice"
    | "resolution";
  title: string;
  note: string | null;
  photoUrl: string | null;
  thumbnailUrl: string | null;
  photoCount: number;
  // Resolved URLs for additional photos beyond the hero. Used by the Phase 5
  // detail body to render the photo gallery section. Empty when the event
  // only has the hero image (or no images at all).
  extraPhotos: string[];
  // Non-image attachments (receipts, invoices, materials lists, etc.). Used
  // by the Phase 5 detail body to render the files/receipts section.
  fileAttachments: TimelineFileAttachment[];
  propertyName: string | null;
  propertyId: number | null;
  authorName: string | null;
  authorAvatarUrl: string | null;
  createdAt: string;
};

export function workLogToEvent(log: WorkLog): TimelineEvent {
  const title = deriveTitleFromLog(log);
  const allAttachments = (log.attachments ?? []) as WorkLogAttachment[];
  const imageAttachments = allAttachments.filter((a) => a.kind === "image");
  const fileAttachments = allAttachments.filter((a) => a.kind !== "image");
  const photoCount = (log.photoUrl ? 1 : 0) + imageAttachments.length;
  const thumbnailUrl = log.photoUrl
    ? resolveStorageUrl(log.photoUrl) ?? log.photoUrl
    : imageAttachments.length > 0
      ? resolveStorageUrl(imageAttachments[0].path)
      : null;
  // Build extra photos: every image beyond the hero, with resolved URLs.
  // The hero is `photoUrl` if present, otherwise the first image attachment.
  const heroIndex = log.photoUrl ? -1 : 0;
  const extraPhotos: string[] = [];
  for (let i = 0; i < imageAttachments.length; i++) {
    if (i === heroIndex) continue;
    const url = resolveStorageUrl(imageAttachments[i].path);
    if (url) extraPhotos.push(url);
  }
  const fileTimelineAttachments: TimelineFileAttachment[] = fileAttachments.map((a) => ({
    url: resolveStorageUrl(a.path),
    name: a.name?.trim() || a.path.split("/").pop() || "Attachment",
  }));
  return {
    id: `log-${log.id}`,
    kind: "work_logged",
    title,
    note: log.note ?? null,
    photoUrl: log.photoUrl ?? null,
    thumbnailUrl,
    photoCount,
    extraPhotos,
    fileAttachments: fileTimelineAttachments,
    propertyName: log.property?.name ?? null,
    propertyId: log.property?.id ?? null,
    authorName: log.author?.name ?? null,
    authorAvatarUrl: log.author?.avatarUrl ?? null,
    createdAt: log.createdAt,
  };
}

function deriveTitleFromLog(log: WorkLog): string {
  const note = (log.note ?? "").trim();
  if (!note) return "Work Logged";
  const firstLine = note.split(/\n/)[0].trim();
  const firstSentence = firstLine.split(/(?<=[.!?])\s/)[0].trim();
  const candidate = firstSentence || firstLine;
  if (candidate.length <= 48) return candidate;
  return candidate.slice(0, 45).trimEnd() + "…";
}

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function dayLabel(ts: number): string {
  const today = startOfDay(new Date());
  const diffDays = Math.round((today - ts) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const d = new Date(ts);
  const now = new Date();
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

type Group = { dayStart: number; label: string; events: TimelineEvent[] };

function groupByDay(events: TimelineEvent[]): Group[] {
  const byDay = new Map<number, TimelineEvent[]>();
  for (const e of events) {
    const ts = startOfDay(new Date(e.createdAt));
    const arr = byDay.get(ts);
    if (arr) arr.push(e);
    else byDay.set(ts, [e]);
  }
  const out: Group[] = [];
  const keys = Array.from(byDay.keys()).sort((a, b) => b - a);
  for (const k of keys) {
    const events = byDay.get(k)!.slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    out.push({ dayStart: k, label: dayLabel(k), events });
  }
  return out;
}

const KIND_META: Record<
  TimelineEvent["kind"],
  { label: string; icon: keyof typeof Feather.glyphMap; tint: string }
> = {
  work_logged: { label: "Work Logged", icon: "tool", tint: "#F59E0B" },
  client_note: { label: "Client Note", icon: "message-circle", tint: "#60A5FA" },
  photo: { label: "Photo", icon: "camera", tint: "#A78BFA" },
  receipt: { label: "Receipt", icon: "credit-card", tint: "#34D399" },
  material_run: { label: "Material Run", icon: "truck", tint: "#F472B6" },
  estimate: { label: "Estimate", icon: "file-text", tint: "#FBBF24" },
  invoice: { label: "Invoice", icon: "file" as never, tint: "#818CF8" },
  resolution: { label: "Resolution", icon: "check-circle", tint: "#4ADE80" },
};

const SPINE_WIDTH = 2;
const NODE_DOT = 11;
const DOT_BORDER = 2;
const CONNECTOR_GAP = 16;
const CARD_THUMB = 44;
const EMPTY_SPINE_HEIGHT = 520;

// Time-to-pixels mapping. Spacing between adjacent events should *feel* like
// elapsed time without letting tiny or huge gaps wreck the layout. We use a
// log curve so a 5-minute gap is still visible and a 6-month gap doesn't push
// the rest of the feed off-screen. Tune these constants here — they are the
// single source of truth for the timeline's visual rhythm.
const ROW_GAP_MIN = 16; // floor: two events minutes apart
const ROW_GAP_MAX = 96; // ceiling: events many hours apart in the same day
const GROUP_GAP_MIN = 18; // floor: consecutive days
const GROUP_GAP_MAX = 140; // ceiling: months apart
const QUIET_DAYS_THRESHOLD = 2; // show "quiet" tick only when >= this many empty days
const PILL_TO_FIRST_ROW = 6; // baseline distance from a day pill to its first event row

// Returns the vertical pixel gap that should sit *above* a row, given the time
// distance between the row's event and the previous (more recent) event in
// the same day group. Uses a log scale clamped to [ROW_GAP_MIN, ROW_GAP_MAX].
function sameDayGapPx(prevIso: string, currIso: string): number {
  const deltaMin = Math.max(
    1,
    Math.abs(new Date(prevIso).getTime() - new Date(currIso).getTime()) / 60_000,
  );
  // Normalize over a realistic same-day span (1 min .. ~16h).
  const norm = Math.log10(deltaMin + 1) / Math.log10(60 * 16 + 1);
  const clamped = Math.max(0, Math.min(1, norm));
  return ROW_GAP_MIN + clamped * (ROW_GAP_MAX - ROW_GAP_MIN);
}

// Returns the vertical pixel gap that should sit between two adjacent day
// groups, given the calendar-day delta between them (>=1). Uses a log scale
// clamped to [GROUP_GAP_MIN, GROUP_GAP_MAX] so a 1-day step is compact and a
// 6-month step still lands on the page.
function crossDayGapPx(daysDelta: number): number {
  const d = Math.max(1, daysDelta);
  const norm = Math.log10(d + 1) / Math.log10(180 + 1);
  const clamped = Math.max(0, Math.min(1, norm));
  return GROUP_GAP_MIN + clamped * (GROUP_GAP_MAX - GROUP_GAP_MIN);
}

// Visual-review-only toggle. When true, the timeline ignores incoming events
// and renders a small set of mock events spanning two days so layout decisions
// can be made without backend data. MUST stay false on shipped builds — Phase 1
// only adjusts the visual spine; real-data flow must keep working.
const USE_MOCK_TIMELINE = false;

const MOCK_EVENTS: TimelineEvent[] = [
  mockEvent("m1", "work_logged", "Repaired loose handrail on back deck", "123 Maple St", 0, 9),
  mockEvent("m2", "photo", "Before/after of basement leak repair", "Lakeview Cabin", 0, 11, 3),
  mockEvent("m3", "client_note", "Owner approved tile selection", "123 Maple St", 0, 13),
  mockEvent("m4", "receipt", "Home Depot — fasteners and sealant", null, 0, 15),
  mockEvent("m5", "material_run", "Picked up 12 cedar planks", "Lakeview Cabin", 1, 8, 1),
  mockEvent("m6", "estimate", "Sent painting estimate to owner", "Sunrise Duplex", 1, 10),
  mockEvent("m7", "work_logged", "Pressure washed front siding and walkway before stain prep", "Sunrise Duplex", 1, 14, 2),
  mockEvent("m8", "resolution", "Closed out drainage punch-list items", "Lakeview Cabin", 1, 17),
];

function mockEvent(
  id: string,
  kind: TimelineEvent["kind"],
  title: string,
  propertyName: string | null,
  daysAgo: number,
  hour: number,
  photoCount = 0,
): TimelineEvent {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return {
    id,
    kind,
    title,
    note: null,
    photoUrl: null,
    thumbnailUrl: null,
    photoCount,
    extraPhotos: [],
    fileAttachments: [],
    propertyName,
    propertyId: null,
    authorName: null,
    authorAvatarUrl: null,
    createdAt: d.toISOString(),
  };
}

type Props = {
  events: TimelineEvent[];
  onOpenProperty?: (propertyId: number) => void;
  emptyMessage?: string;
};

export type AnchorRect = { x: number; y: number; width: number; height: number };

// Subscribes to the OS-level "Reduce Motion" accessibility setting and
// returns the latest value. Components that animate large transitions
// (overlay open/close, staggered reveals) check this so users with
// vestibular sensitivities — or anyone who has flipped the system toggle —
// get a quieter version of the same transition.
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    const initial = AccessibilityInfo.isReduceMotionEnabled?.();
    if (initial && typeof initial.then === "function") {
      initial.then((v) => {
        if (mounted) setReduce(!!v);
      });
    }
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (v: boolean) => {
        if (mounted) setReduce(!!v);
      },
    );
    return () => {
      mounted = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
}

export function ProjectTimeline({ events: incomingEvents, onOpenProperty }: Props) {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const [focused, setFocused] = useState<{
    initialIndex: number;
    anchor: AnchorRect;
    photoAnchor: AnchorRect | null;
  } | null>(null);
  // The id of the event currently highlighted *behind* the overlay. While the
  // overlay is open this drives the spine's "you are here" dot so the blurred
  // background reflects which event is in focus as the user scrolls between
  // items. Cleared when the overlay finishes closing.
  const [activeEventId, setActiveEventId] = useState<string | null>(null);

  // Defensive cleanup: if the overlay vanishes through any path other than
  // the normal animated close (e.g. parent unmount, events list emptied
  // externally while open), make sure the spine highlight doesn't get stuck
  // pointing at a no-longer-focused row.
  useEffect(() => {
    if (focused === null && activeEventId !== null) {
      setActiveEventId(null);
    }
  }, [focused, activeEventId]);

  const events = USE_MOCK_TIMELINE ? MOCK_EVENTS : incomingEvents;
  const groups = useMemo(() => groupByDay(events), [events]);
  // Flat chronological list in the same order rows are rendered (newest →
  // oldest). This is what the overlay pages through, so "next" and
  // "previous" inside the overlay match the user's spatial intuition of
  // scrolling further down the timeline.
  const displayEvents = useMemo(() => groups.flatMap((g) => g.events), [groups]);

  // Empty state: just the centered spine, no cards or text
  if (!events.length) {
    return (
      <View style={[styles.root, { minHeight: EMPTY_SPINE_HEIGHT }]}>
        <View
          pointerEvents="none"
          style={[styles.spine, { backgroundColor: colors.border }]}
        />
      </View>
    );
  }

  // Running index across all days so alternation is strictly reliable across
  // day boundaries (not reset per group).
  let globalIndex = 0;

  return (
    <View style={styles.root}>
      {/* Single, continuous, perfectly centered spine for the whole section. */}
      <View pointerEvents="none" style={[styles.spine, { backgroundColor: colors.border }]} />

      {groups.map((group, gi) => {
        const startIndex = globalIndex;
        const rows = group.events.map((ev, i) => {
          const side: "left" | "right" = (startIndex + i) % 2 === 0 ? "left" : "right";
          // marginTop above this row reflects the time gap to the previous
          // (more recent) event in the same day group. The first row in a
          // group sits a small fixed distance below its day pill.
          const topGap =
            i === 0
              ? PILL_TO_FIRST_ROW
              : sameDayGapPx(group.events[i - 1].createdAt, ev.createdAt);
          return { ev, side, topGap };
        });
        globalIndex += group.events.length;

        // Time-proportional spacing between this day pill and the previous
        // group. The pill itself sits inside this gap, so the spine flows
        // continuously through it (the spine is one absolute element at the
        // root). For long quiet stretches we add a soft "quiet days" tick so
        // the empty time feels deliberate rather than accidental.
        const prev = gi > 0 ? groups[gi - 1] : null;
        const daysDelta = prev
          ? Math.max(1, Math.round((prev.dayStart - group.dayStart) / 86_400_000))
          : 0;
        const groupTopGap = prev ? crossDayGapPx(daysDelta) : 0;
        const quietDays = daysDelta - 1; // number of fully empty days between groups
        const showQuietTick = quietDays >= QUIET_DAYS_THRESHOLD;

        return (
          <View key={group.dayStart} style={styles.group}>
            {showQuietTick ? (
              <View style={[styles.quietRow, { marginTop: Math.max(GROUP_GAP_MIN, groupTopGap - 24) }]}>
                <View style={[styles.quietTick, { backgroundColor: colors.border }]} />
                <Text style={[styles.quietText, { color: colors.mutedForeground }]}>
                  {`${quietDays} quiet days`}
                </Text>
                <View style={[styles.quietTick, { backgroundColor: colors.border }]} />
              </View>
            ) : null}

            {/* Day pill straddles the spine */}
            <View style={[styles.dayRow, { marginTop: showQuietTick ? 12 : groupTopGap }]}>
              <View style={[styles.dayPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.dayPillText, { color: colors.foreground }]}>{group.label}</Text>
              </View>
            </View>

            {rows.map(({ ev, side, topGap }) => (
              <TimelineRow
                key={ev.id}
                event={ev}
                side={side}
                colors={colors}
                topGap={topGap}
                isActive={activeEventId === ev.id}
                onPress={(anchor, photoAnchor) => {
                  const idx = displayEvents.findIndex((e) => e.id === ev.id);
                  // Defensive: if the tapped event isn't in displayEvents
                  // (shouldn't happen, but data races could), skip opening
                  // rather than silently focus the wrong event.
                  if (idx < 0) return;
                  setFocused({
                    initialIndex: idx,
                    anchor,
                    photoAnchor,
                  });
                  setActiveEventId(ev.id);
                }}
              />
            ))}
          </View>
        );
      })}

      <FocusedOverlay
        focused={focused}
        events={displayEvents}
        onClose={() => setFocused(null)}
        onActiveChange={setActiveEventId}
        onClosed={() => setActiveEventId(null)}
        onOpenProperty={onOpenProperty}
        reduceMotion={reduceMotion}
      />
    </View>
  );
}

function TimelineRow({
  event,
  side,
  colors,
  topGap,
  isActive,
  onPress,
}: {
  event: TimelineEvent;
  side: "left" | "right";
  colors: Colors;
  topGap: number;
  isActive: boolean;
  onPress: (anchor: AnchorRect, photoAnchor: AnchorRect | null) => void;
}) {
  const meta = KIND_META[event.kind];
  const photoUri =
    event.thumbnailUrl ??
    (event.photoUrl ? resolveStorageUrl(event.photoUrl) ?? event.photoUrl : null);

  const cardRef = useRef<View>(null);
  const thumbRef = useRef<View>(null);

  const captureAndOpen = useCallback(() => {
    const cardNode = cardRef.current;
    const thumbNode = thumbRef.current;
    const fallback: AnchorRect = {
      x: Dimensions.get("window").width / 2 - 80,
      y: Dimensions.get("window").height / 2 - 40,
      width: 160,
      height: 80,
    };
    const measure = (node: View | null): Promise<AnchorRect | null> =>
      new Promise((resolve) => {
        if (!node || typeof node.measureInWindow !== "function") {
          resolve(null);
          return;
        }
        let settled = false;
        const t = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve(null);
          }
        }, 60);
        node.measureInWindow((x, y, width, height) => {
          if (settled) return;
          settled = true;
          clearTimeout(t);
          if (
            !Number.isFinite(x) ||
            !Number.isFinite(y) ||
            !Number.isFinite(width) ||
            !Number.isFinite(height) ||
            width <= 0 ||
            height <= 0
          ) {
            resolve(null);
          } else {
            resolve({ x, y, width, height });
          }
        });
      });
    void Promise.all([measure(cardNode), measure(thumbNode)]).then(([a, p]) => {
      onPress(a ?? fallback, p);
    });
  }, [onPress]);

  const card = (
    <Pressable
      ref={cardRef}
      onPress={captureAndOpen}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: hovered ? meta.tint : colors.border,
          transform: [{ scale: hovered ? 1.03 : pressed ? 0.97 : 1 }],
        },
        side === "left" ? styles.cardAlignRight : styles.cardAlignLeft,
      ]}
      accessibilityLabel={event.title}
    >
      {side === "right" ? (
        <View ref={thumbRef} collapsable={false} style={styles.thumbWrap}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.thumbImage} />
          ) : (
            <View style={[styles.thumbIcon, { backgroundColor: meta.tint + "22" }]}>
              <Feather name={meta.icon} size={18} color={meta.tint} />
            </View>
          )}
        </View>
      ) : null}
      <View style={[styles.cardBody, side === "left" ? { alignItems: "flex-end" } : null]}>
        <Text
          style={[styles.cardTitle, { color: colors.foreground }]}
          numberOfLines={2}
        >
          {event.title}
        </Text>
        {event.propertyName ? (
          <Text
            style={[
              styles.cardProperty,
              { color: colors.mutedForeground },
              side === "left" ? { textAlign: "right" } : null,
            ]}
            numberOfLines={1}
          >
            {event.propertyName}
          </Text>
        ) : null}
        <View style={[styles.cardMetaRow, side === "left" ? { justifyContent: "flex-end" } : null]}>
          <Text style={[styles.cardMeta, { color: meta.tint }]} numberOfLines={1}>
            {meta.label}
          </Text>
          <Text style={[styles.cardDot, { color: colors.mutedForeground }]}>·</Text>
          <Text style={[styles.cardMeta, { color: colors.mutedForeground }]} numberOfLines={1}>
            {timeLabel(event.createdAt)}
          </Text>
          {event.photoCount > 0 ? (
            <PhotoHintBadge
              onPress={captureAndOpen}
              colors={colors}
              count={event.photoCount}
              thumbnailUrl={photoUri}
              accessibilityLabel={
                event.photoCount > 1
                  ? `Preview ${event.photoCount} photos from this update`
                  : "Preview the photo on this update"
              }
            />
          ) : null}
        </View>
      </View>
      {side === "left" ? (
        <View ref={thumbRef} collapsable={false} style={styles.thumbWrap}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.thumbImage} />
          ) : (
            <View style={[styles.thumbIcon, { backgroundColor: meta.tint + "22" }]}>
              <Feather name={meta.icon} size={18} color={meta.tint} />
            </View>
          )}
        </View>
      ) : null}
    </Pressable>
  );

  return (
    <View style={[styles.row, { marginTop: topGap }]}>
      {/* LEFT slot */}
      <View style={styles.sideSlot}>
        {side === "left" ? (
          <View style={styles.sideContent}>{card}</View>
        ) : null}
      </View>

      {/* CENTER: connector + dot. Connector renders on the same side as the card. */}
      <View style={styles.centerSlot}>
        <View
          pointerEvents="none"
          style={[
            styles.connector,
            {
              backgroundColor: colors.border,
              left: side === "left" ? -CONNECTOR_GAP : NODE_DOT,
              width: CONNECTOR_GAP,
            },
          ]}
        />
        {/* Soft halo behind the dot when this row is the one currently focused
            inside the open overlay. The halo lets the user sense their
            position in the timeline through the blur, without changing the
            dot's center position (so layout never jumps). */}
        {isActive ? (
          <View
            pointerEvents="none"
            style={[
              styles.dotHalo,
              { borderColor: meta.tint, backgroundColor: meta.tint + "33" },
            ]}
          />
        ) : null}
        <View
          style={[
            styles.dot,
            { backgroundColor: meta.tint, borderColor: colors.background },
            isActive ? { transform: [{ scale: 1.25 }] } : null,
          ]}
        />
      </View>

      {/* RIGHT slot */}
      <View style={styles.sideSlot}>
        {side === "right" ? (
          <View style={styles.sideContent}>{card}</View>
        ) : null}
      </View>
    </View>
  );
}

function FocusedOverlay({
  focused,
  events,
  onClose,
  onClosed,
  onActiveChange,
  onOpenProperty,
  reduceMotion,
}: {
  focused: { initialIndex: number; anchor: AnchorRect; photoAnchor: AnchorRect | null } | null;
  events: TimelineEvent[];
  onClose: () => void;
  onClosed?: () => void;
  onActiveChange?: (id: string | null) => void;
  onOpenProperty?: (propertyId: number) => void;
  reduceMotion: boolean;
}) {
  // Keep the last known anchor / index while the close animation runs so the
  // overlay can shrink back to the originating bubble even after the parent
  // has cleared the focused state.
  const [shown, setShown] = useState(focused);
  const progress = useSharedValue(0);
  const closing = useRef(false);
  const motionRef = useTimelineMotionConfigRef();

  useEffect(() => {
    if (focused) {
      closing.current = false;
      setShown(focused);
      progress.value = 0;
      if (reduceMotion) {
        // Quieter open: a short fade/scale with no overshoot. Same end
        // state, no bounce — matches the user's accessibility preference.
        progress.value = withTiming(1, {
          duration: 180,
          easing: Easing.out(Easing.quad),
        });
      } else {
        // Spring expansion: a touch of overshoot makes the bubble feel like
        // it's pushing the overlay into place rather than easing into it.
        // Mass / stiffness picked so the overall settle time matches the old
        // 320ms timing budget but the velocity profile is non-linear.
        // Values come from the live debug store so on-device tuning is possible.
        progress.value = withSpring(1, { ...motionRef.current.open });
      }
    }
  }, [focused, progress, reduceMotion, motionRef]);

  const finishClose = useCallback(() => {
    closing.current = false;
    setShown(null);
    onClosed?.();
  }, [onClosed]);

  const requestClose = useCallback(() => {
    if (closing.current || !shown) {
      onClose();
      return;
    }
    closing.current = true;
    onClose();
    if (reduceMotion) {
      // Quieter close: short timing curve, no overshoot, no bounce.
      progress.value = withTiming(
        0,
        { duration: 160, easing: Easing.in(Easing.quad) },
        (finishedAnim) => {
          if (finishedAnim) runOnJS(finishClose)();
        },
      );
    } else {
      // Close is decisive — clamp overshoot so the overlay snaps cleanly back
      // into the bubble instead of bouncing through it. Live-tunable via the
      // debug panel.
      progress.value = withSpring(
        0,
        { ...motionRef.current.close },
        (finishedAnim) => {
          if (finishedAnim) runOnJS(finishClose)();
        },
      );
    }
  }, [shown, onClose, progress, finishClose, reduceMotion, motionRef]);

  if (!shown || !events.length) return null;
  return (
    <FocusedOverlayInner
      events={events}
      initialIndex={Math.max(0, Math.min(shown.initialIndex, events.length - 1))}
      anchor={shown.anchor}
      progress={progress}
      onRequestClose={requestClose}
      onActiveChange={onActiveChange}
      onOpenProperty={onOpenProperty}
      reduceMotion={reduceMotion}
    />
  );
}

function FocusedOverlayInner({
  events,
  initialIndex,
  anchor,
  progress,
  onRequestClose,
  onActiveChange,
  onOpenProperty,
  reduceMotion,
}: {
  events: TimelineEvent[];
  initialIndex: number;
  anchor: AnchorRect;
  progress: SharedValue<number>;
  onRequestClose: () => void;
  onActiveChange?: (id: string | null) => void;
  onOpenProperty?: (propertyId: number) => void;
  reduceMotion: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const motionConfig = useTimelineMotionConfig();
  const initialEvent = events[initialIndex];
  const meta = KIND_META[initialEvent.kind];
  const initialPhotoUri =
    initialEvent.thumbnailUrl ??
    (initialEvent.photoUrl
      ? resolveStorageUrl(initialEvent.photoUrl) ?? initialEvent.photoUrl
      : null);

  // Resting (expanded) rect for the overlay card.
  const targetWidth = Math.min(win.width - 32, 460);
  const targetHeight = Math.min(
    win.height - (insets.top + insets.bottom + 56),
    Math.max(420, win.height * 0.78),
  );
  const targetX = (win.width - targetWidth) / 2;
  const targetY = insets.top + 28;

  const cardStyle = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      left: interpolate(p, [0, 1], [anchor.x, targetX]),
      top: interpolate(p, [0, 1], [anchor.y, targetY]),
      width: interpolate(p, [0, 1], [anchor.width, targetWidth]),
      height: interpolate(p, [0, 1], [anchor.height, targetHeight]),
      borderRadius: interpolate(p, [0, 1], [12, 18]),
      shadowOpacity: interpolate(p, [0, 1], [0, 0.4], "clamp"),
    };
  });

  // Blur fades in slightly ahead of the card finishing its travel so the
  // background settles before the eye lands on the focused content.
  const blurStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.7], [0, 1], "clamp"),
  }));

  // Real content fades in only after the card has crossed the halfway mark
  // of its expansion. Clamped on both ends so spring overshoot doesn't push
  // opacity above 1 (which RN would clip anyway, but this keeps the curve
  // honest against the ghost layer's fade-out).
  const contentStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0.45, 0.95], [0, 1], "clamp"),
  }));

  const ghostCardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.45], [1, 0], "clamp"),
  }));

  // ---------------------------------------------------------------------------
  // Inter-item scrolling: one ScrollView, boundary-driven transitions
  // ---------------------------------------------------------------------------
  // The overlay renders every event inline inside a single vertical
  // ScrollView. Each event takes at minimum the resting card height so the
  // viewport always frames exactly one event at rest, but events with longer
  // content (notes, photo) take their natural height. Snap offsets sit at
  // each event's top, so:
  //
  //   - While scrolling within an item, the same gesture that moves text
  //     also moves the page. There is no separate "outer transition" gesture
  //     and no inner ScrollView competing for touches.
  //   - Once the user scrolls past the bottom of the current item, the
  //     ScrollView naturally enters the next item — exactly the
  //     "scroll past the end transitions to the next event" behavior the
  //     phase calls for. Variability between short and long events is
  //     handled because each item's own measured height drives the next
  //     snap offset.
  //   - End-of-list resistance is the ScrollView's native bounce; no
  //     infinite loop.
  //   - Rapid swipes, slow scrubs, and reversals are all handled by the
  //     ScrollView's momentum system, which has well-defined deterministic
  //     state at any time.
  //
  // The active event index (drives the spine highlight) is tracked from
  // scroll position by finding the snap offset whose top is nearest the
  // viewport center.
  // ---------------------------------------------------------------------------
  const PAGE_H = targetHeight;
  const scrollRef = useRef<ScrollView>(null);

  // Each event is rendered as TWO direct children of the ScrollView so the
  // summary header can be a sticky header (Phase 5):
  //   children[2i + 0]  → summary card (sticky)
  //   children[2i + 1]  → detail body (full note, photos, author/history,
  //                        and the "up next" handoff strip)
  //
  // We track summary and body heights independently so the snap offset for
  // event i (top of its summary) is the cumulative sum of (summaryH + bodyH)
  // for prior events. The body has a minHeight that fills whatever the
  // summary doesn't, so the viewport still frames exactly one event at
  // rest — but the body's own contents collapse cleanly when sections are
  // missing (no rendered empty section boxes).
  const SUMMARY_FALLBACK = 96;
  const [summaryHeights, setSummaryHeights] = useState<number[]>(() =>
    events.map(() => SUMMARY_FALLBACK),
  );
  const [bodyHeights, setBodyHeights] = useState<number[]>(() =>
    events.map(() => Math.max(0, PAGE_H - SUMMARY_FALLBACK)),
  );
  const summaryHeightsRef = useRef<number[]>(summaryHeights);
  summaryHeightsRef.current = summaryHeights;
  const bodyHeightsRef = useRef<number[]>(bodyHeights);
  bodyHeightsRef.current = bodyHeights;

  const recordSummaryLayout = useCallback(
    (idx: number, e: LayoutChangeEvent) => {
      const h = Math.max(0, Math.round(e.nativeEvent.layout.height));
      const current = summaryHeightsRef.current[idx] ?? SUMMARY_FALLBACK;
      if (Math.abs(current - h) < 1) return;
      const next = summaryHeightsRef.current.slice();
      next[idx] = h;
      summaryHeightsRef.current = next;
      setSummaryHeights(next);
    },
    [],
  );

  const recordBodyLayout = useCallback(
    (idx: number, e: LayoutChangeEvent) => {
      const h = Math.max(0, Math.round(e.nativeEvent.layout.height));
      const current = bodyHeightsRef.current[idx] ?? 0;
      if (Math.abs(current - h) < 1) return;
      const next = bodyHeightsRef.current.slice();
      next[idx] = h;
      bodyHeightsRef.current = next;
      setBodyHeights(next);
    },
    [],
  );

  // Per-event total heights (summary + body), each >= PAGE_H so rest framing
  // remains "one event per viewport" while sections inside the body are free
  // to collapse to nothing.
  const pageHeights = useMemo(() => {
    return events.map((_, i) => {
      const s = summaryHeights[i] ?? SUMMARY_FALLBACK;
      const b = bodyHeights[i] ?? 0;
      return Math.max(PAGE_H, s + b);
    });
  }, [events, summaryHeights, bodyHeights, PAGE_H]);

  const snapOffsets = useMemo(() => {
    const out: number[] = [];
    let acc = 0;
    for (let i = 0; i < pageHeights.length; i++) {
      out.push(acc);
      acc += pageHeights[i];
    }
    return out;
  }, [pageHeights]);

  // Sticky header child indices. With our flat [summary, body, summary,
  // body, ...] structure the summaries live at even positions.
  const stickyHeaderIndices = useMemo(
    () => events.map((_, i) => i * 2),
    [events],
  );

  const [activeIndex, setActiveIndex] = useState(initialIndex);

  // Track the last index we've "committed" to (after a user-driven scroll
  // settles). Used to fire a single selection haptic per commit, and only
  // when the resting event actually changed. Seeded with initialIndex so the
  // overlay's opening scroll-into-position never fires a tap.
  const lastCommittedIndexRef = useRef(initialIndex);

  // Reduce Motion: respect the OS accessibility setting and skip the haptic
  // tap when motion (and by extension, incidental haptics) should be quiet.
  const reduceMotionRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (!cancelled) reduceMotionRef.current = v;
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (v) => {
        reduceMotionRef.current = v;
      },
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // Find the index whose snap offset is nearest the current scroll position.
  const indexFromOffset = useCallback(
    (y: number): number => {
      if (snapOffsets.length === 0) return 0;
      let best = 0;
      let bestD = Math.abs(snapOffsets[0] - y);
      for (let i = 1; i < snapOffsets.length; i++) {
        const d = Math.abs(snapOffsets[i] - y);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      return best;
    },
    [snapOffsets],
  );

  // Live update during scroll: while the user is dragging or momentum is
  // running, keep the spine highlight in sync with whichever event is
  // currently centered. Throttled by the ScrollView's natural frame cadence.
  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      // Use the viewport center for the "currently focused" notion so a
      // half-scroll feels like it's already on the next event by the time
      // it's mostly visible.
      const center = y + PAGE_H / 2;
      // Find the event whose [top, bottom] range contains center.
      let idx = 0;
      for (let i = 0; i < snapOffsets.length; i++) {
        const top = snapOffsets[i];
        const bottom = top + (pageHeights[i] ?? PAGE_H);
        if (center >= top && center < bottom) {
          idx = i;
          break;
        }
        if (i === snapOffsets.length - 1) idx = i;
      }
      if (idx !== activeIndex) {
        setActiveIndex(idx);
        const ev = events[idx];
        if (ev) onActiveChange?.(ev.id);
      }
    },
    [PAGE_H, snapOffsets, pageHeights, activeIndex, events, onActiveChange],
  );

  // After momentum / drag end, also reconcile to the nearest snap point in
  // case the OS deceleration left us a hair off. This is the deterministic
  // commit point — by the time we're here, activeIndex equals the resting
  // event.
  const handleScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const idx = indexFromOffset(y);
      if (idx !== activeIndex) {
        setActiveIndex(idx);
        const ev = events[idx];
        if (ev) onActiveChange?.(ev.id);
      }
      // Fire a light selection haptic exactly once per commit, only when
      // the resting event differs from the last committed one. handleScroll
      // may have already advanced activeIndex during the drag, so we compare
      // against our own committed-index ref rather than activeIndex.
      if (idx !== lastCommittedIndexRef.current) {
        lastCommittedIndexRef.current = idx;
        if (Platform.OS !== "web" && !reduceMotionRef.current) {
          Haptics.selectionAsync().catch(() => {});
        }
      }
    },
    [indexFromOffset, activeIndex, events, onActiveChange],
  );

  // Initial scroll to the originally tapped event. Done after layout so
  // `snapOffsets` reflects measured heights for already-rendered items.
  // Also re-issued when offsets change while we're still on initialIndex,
  // in case the item we're parked on grows after measurement.
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (didInitialScroll.current) return;
    if (snapOffsets.length <= initialIndex) return;
    const offset = snapOffsets[initialIndex];
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: offset, animated: false });
      didInitialScroll.current = true;
    });
  }, [snapOffsets, initialIndex]);

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onRequestClose}
      statusBarTranslucent
    >
      {/* Animated blur layer — fades in so the timeline behind remains
          visible for a beat, then settles into a soft scrim that still
          lets the spine, dots, and neighboring bubbles read as ghosts.
          This layer is never re-mounted as the user scrolls between events,
          so the blurred timeline behind stays oriented through transitions. */}
      <Animated.View style={[StyleSheet.absoluteFill, blurStyle]} pointerEvents="box-none">
        {/* Blur intensity tuned per platform so iOS's native gaussian and
            Android's emulated blur land at the same perceptual weight: the
            timeline is unmistakably present behind, but visibly recedes.
            Scrim sits on top of the blur and gives the focused card a
            consistent contrast floor regardless of what's behind it. */}
        <BlurView
          intensity={Platform.OS === "ios" ? motionConfig.blur.ios : motionConfig.blur.android}
          tint="dark"
          style={StyleSheet.absoluteFill}
        />
        <View
          pointerEvents="none"
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: `rgba(6,10,18,${motionConfig.scrimOpacity})` },
          ]}
        />
        <Pressable style={StyleSheet.absoluteFill} onPress={onRequestClose} />
      </Animated.View>

      {/* Animated overlay card. Anchored to the tapped bubble's window
          coordinates, then animates out to a centered resting position. */}
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.overlayAnchored,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            shadowColor: "#000",
          },
          cardStyle,
        ]}
      >
        {/* Mid-flight ghost: a quick echo of the original bubble's title
            and tint, so the very first frames don't feel like a blank
            rectangle popped out of nowhere. Fades out as the real content
            fades in. */}
        <Animated.View pointerEvents="none" style={[styles.overlayGhost, ghostCardStyle]}>
          <View style={[styles.overlayGhostThumb, { backgroundColor: meta.tint + "22" }]}>
            {initialPhotoUri ? (
              <Image source={{ uri: initialPhotoUri }} style={StyleSheet.absoluteFillObject} />
            ) : (
              <Feather name={meta.icon} size={18} color={meta.tint} />
            )}
          </View>
          <Text
            numberOfLines={2}
            style={[styles.overlayGhostTitle, { color: colors.foreground }]}
          >
            {initialEvent.title}
          </Text>
        </Animated.View>

        {/* Single ScrollView containing every event stacked vertically with
            snap-to-event-top. There is no inner scroller per event — the
            scroll the user feels while reading an item *is* the same scroll
            that delivers them into the next item. */}
        <Animated.View style={[StyleSheet.absoluteFill, contentStyle]}>
          <ScrollView
            ref={scrollRef}
            snapToOffsets={snapOffsets}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            showsVerticalScrollIndicator={false}
            scrollEventThrottle={16}
            onScroll={handleScroll}
            onMomentumScrollEnd={handleScrollEnd}
            onScrollEndDrag={handleScrollEnd}
            stickyHeaderIndices={stickyHeaderIndices}
            // Native end-of-list bounce provides the rubber-banding feel at
            // the first / last event so over-scrolls resist gracefully and
            // settle back without a hard stop. No infinite loop.
            bounces
            alwaysBounceVertical
            overScrollMode="always"
          >
            {events.flatMap((ev, i) => {
              const summaryH = summaryHeights[i] ?? SUMMARY_FALLBACK;
              // Reserve at least the remainder of PAGE_H so each event still
              // frames a single viewport at rest, even when its detail body
              // is short or empty.
              const bodyMin = Math.max(0, PAGE_H - summaryH);
              return [
                <View
                  key={ev.id + ":summary"}
                  onLayout={(e) => recordSummaryLayout(i, e)}
                  // Sticky headers must be opaque so the body doesn't bleed
                  // through as it scrolls beneath them.
                  style={{ backgroundColor: colors.card }}
                >
                  <OverlaySummary
                    event={ev}
                    colors={colors}
                    onRequestClose={onRequestClose}
                    onOpenProperty={onOpenProperty}
                  />
                </View>,
                <View
                  key={ev.id + ":body"}
                  onLayout={(e) => recordBodyLayout(i, e)}
                  style={{ minHeight: bodyMin, backgroundColor: colors.card }}
                >
                  <OverlayDetail
                    event={ev}
                    colors={colors}
                    nextEvent={i < events.length - 1 ? events[i + 1] : null}
                    reduceMotion={reduceMotion}
                  />
                </View>,
              ];
            })}
          </ScrollView>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Phase 5 — progressive detail reveal
// ---------------------------------------------------------------------------
// A single event in the overlay is now split into two pieces that the outer
// ScrollView renders as separate (and independently sticky-able) children:
//
//   OverlaySummary — the calm "first thing you see" surface. Photo, title,
//                    property + time, a short note preview, and the primary
//                    action. This is the sticky element: as the user scrolls
//                    deeper into the same event, the summary stays anchored
//                    at the top of the viewport so they never lose their
//                    place. When the user crosses into the next event, that
//                    event's summary takes over the sticky slot.
//
//   OverlayDetail  — the substantial content layered in beneath the summary,
//                    in a strict, prioritized order:
//                      1. Full note text (only if the note has more than the
//                         summary already shows).
//                      2. Photos / attachments (only if the event has more
//                         than one photo or extra attachment URLs).
//                      3. Author / history (only if we have an author and/or
//                         a fuller timestamp to show).
//                      4. Up-next handoff strip (only if there is a next
//                         event). This is the deliberate visual handoff that
//                         tells the user the next downward scroll is no
//                         longer "more of this item" but "into the next
//                         item" (the Phase 4 boundary).
//
//                    Sections that have nothing to show simply don't render —
//                    no header rows, no empty boxes. Items with no extra
//                    detail at all collapse the body to whitespace + the
//                    handoff strip and reach the next event sooner.
// ---------------------------------------------------------------------------

// Heuristic for "is the note long enough that the summary preview is hiding
// real content the user might want to read in full?" Used to decide whether
// to render the Full Note section in the detail body. Keeping this on the
// generous side means short notes don't get awkwardly duplicated between
// summary and detail.
function noteHasMore(note: string | null): boolean {
  if (!note) return false;
  const trimmed = note.trim();
  if (!trimmed) return false;
  // Multi-paragraph notes always have "more" — the preview only shows the
  // first 3 lines and paragraphs almost always wrap past that.
  if (/\n\s*\n/.test(trimmed)) return true;
  // Long single-paragraph notes also benefit from the full-text section.
  return trimmed.length > 160;
}

// Returns a section title that reads naturally for each event kind. A
// receipt's attachments are "Receipt" / "Receipts"; a material run's are
// "Materials"; everything else falls back to a generic "Files / Attachments".
function filesSectionTitle(kind: TimelineEvent["kind"], count: number): string {
  switch (kind) {
    case "receipt":
      return count === 1 ? "Receipt" : "Receipts";
    case "material_run":
      return "Materials";
    case "invoice":
      return count === 1 ? "Invoice" : "Invoices";
    case "estimate":
      return count === 1 ? "Estimate" : "Estimates";
    default:
      return count === 1 ? "Attachment" : "Attachments";
  }
}

function fileIconForKind(kind: TimelineEvent["kind"]): keyof typeof Feather.glyphMap {
  switch (kind) {
    case "receipt":
      return "credit-card";
    case "material_run":
      return "truck";
    case "invoice":
      return "file";
    case "estimate":
      return "file-text";
    default:
      return "paperclip";
  }
}

function fullDateLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function OverlaySummary({
  event,
  colors,
  onRequestClose,
  onOpenProperty,
}: {
  event: TimelineEvent;
  colors: Colors;
  onRequestClose: () => void;
  onOpenProperty?: (propertyId: number) => void;
}) {
  const meta = KIND_META[event.kind];
  const photoUri =
    event.thumbnailUrl ??
    (event.photoUrl ? resolveStorageUrl(event.photoUrl) ?? event.photoUrl : null);
  const when = `${dayLabel(startOfDay(new Date(event.createdAt)))} ${timeLabel(event.createdAt)}`;
  return (
    <View>
      <View style={[styles.overlayHeader, { borderBottomColor: colors.border }]}>
        <View style={[styles.kindPill, { backgroundColor: meta.tint + "22" }]}>
          <View style={[styles.kindDot, { backgroundColor: meta.tint }]} />
          <Text style={[styles.kindText, { color: meta.tint }]}>{meta.label}</Text>
        </View>
        <Pressable
          onPress={onRequestClose}
          hitSlop={12}
          style={{ padding: 6 }}
          accessibilityLabel="Close event details"
        >
          <Feather name="x" size={20} color={colors.foreground} />
        </Pressable>
      </View>
      {photoUri ? <Image source={{ uri: photoUri }} style={styles.overlayPhoto} /> : null}
      <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16 }}>
        <Text style={[styles.overlayTitle, { color: colors.foreground }]}>{event.title}</Text>
        <Text style={[styles.overlayMeta, { color: colors.mutedForeground }]}>
          {event.propertyName ? `${event.propertyName}  ·  ` : ""}
          {when}
        </Text>
        {event.note ? (
          <Text
            // Cap the preview at 3 lines. The full note (when meaningfully
            // longer) is reachable by scrolling into the detail body just
            // beneath this sticky summary.
            numberOfLines={3}
            style={[styles.overlayNote, { color: colors.foreground }]}
          >
            {event.note}
          </Text>
        ) : null}
        <View style={styles.overlayActions}>
          {event.propertyId && onOpenProperty ? (
            <Pressable
              onPress={() => {
                const id = event.propertyId!;
                onRequestClose();
                setTimeout(() => onOpenProperty(id), 0);
              }}
              style={({ pressed }) => [
                styles.overlayPrimary,
                { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Text
                style={[styles.overlayPrimaryText, { color: colors.primaryForeground ?? "#fff" }]}
              >
                Open property
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onRequestClose}
            style={({ pressed }) => [
              styles.overlaySecondary,
              { borderColor: colors.border, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[styles.overlaySecondaryText, { color: colors.foreground }]}>Close</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function OverlayDetail({
  event,
  colors,
  nextEvent,
  reduceMotion,
}: {
  event: TimelineEvent;
  colors: Colors;
  nextEvent: TimelineEvent | null;
  reduceMotion: boolean;
}) {
  const showFullNote = noteHasMore(event.note);
  // Photo gallery is only meaningful when there's more than one image. The
  // single hero photo already lives in the summary. extraPhotos already
  // carries fully resolved URLs (see workLogToEvent), so no extra resolution
  // step is needed here.
  const galleryPhotos = event.extraPhotos;
  const showGallery = event.photoCount > 1;
  // Files / receipts / materials lists — anything attached that isn't an
  // image. Renders as a tappable list of file names.
  const showFiles = event.fileAttachments.length > 0;
  // History is shown when we have an author and/or a fuller timestamp than
  // the summary already shows. createdAt is always present, so this is
  // effectively always on — but rendering it means even author-less events
  // get a visible "when" anchor at the bottom of their detail.
  const showHistory = true;
  const fullWhen = fullDateLabel(event.createdAt);

  // If absolutely nothing extra, don't render the inner padding container at
  // all — the body wrapper's minHeight + the handoff strip are enough.
  const hasAnyDetail = showFullNote || showGallery || showFiles || showHistory;

  return (
    <View>
      {hasAnyDetail ? (
        <View style={styles.detailStack}>
          {showFullNote ? (
            <DetailSection title="Full note" colors={colors} order={0} reduceMotion={reduceMotion}>
              <Text style={[styles.detailNote, { color: colors.foreground }]}>{event.note}</Text>
            </DetailSection>
          ) : null}

          {showGallery ? (
            <DetailSection
              title={`${event.photoCount} ${event.photoCount === 1 ? "photo" : "photos"}`}
              colors={colors}
              order={1}
              reduceMotion={reduceMotion}
            >
              {galleryPhotos.length > 0 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  // The inner gallery only intercepts horizontal swipes; the
                  // outer vertical scroller still owns vertical gestures, so
                  // the boundary into the next event remains predictable.
                  contentContainerStyle={styles.detailGallery}
                >
                  {galleryPhotos.map((uri, idx) => (
                    <Image
                      key={uri + idx}
                      source={{ uri }}
                      style={[styles.detailGalleryThumb, { backgroundColor: colors.border }]}
                    />
                  ))}
                </ScrollView>
              ) : (
                <Text style={[styles.detailMuted, { color: colors.mutedForeground }]}>
                  Open the property timeline to view all photos.
                </Text>
              )}
            </DetailSection>
          ) : null}

          {showFiles ? (
            <DetailSection
              title={filesSectionTitle(event.kind, event.fileAttachments.length)}
              colors={colors}
              order={2}
              reduceMotion={reduceMotion}
            >
              <View style={{ gap: 6 }}>
                {event.fileAttachments.map((f, idx) => (
                  <View
                    key={(f.url ?? f.name) + idx}
                    style={[styles.detailFileRow, { borderColor: colors.border }]}
                  >
                    <Feather
                      name={fileIconForKind(event.kind)}
                      size={16}
                      color={colors.mutedForeground}
                    />
                    <Text
                      numberOfLines={1}
                      style={[styles.detailLine, { color: colors.foreground, flex: 1 }]}
                    >
                      {f.name}
                    </Text>
                  </View>
                ))}
              </View>
            </DetailSection>
          ) : null}

          {showHistory ? (
            <DetailSection title="History" colors={colors} order={3} reduceMotion={reduceMotion}>
              {event.authorName ? (
                <Text style={[styles.detailLine, { color: colors.foreground }]}>
                  Logged by {event.authorName}
                </Text>
              ) : null}
              <Text style={[styles.detailMuted, { color: colors.mutedForeground }]}>
                {fullWhen}
              </Text>
            </DetailSection>
          ) : null}
        </View>
      ) : null}

      {nextEvent ? (
        <View style={[styles.handoffStrip, { borderTopColor: colors.border }]}>
          <Text style={[styles.handoffLabel, { color: colors.mutedForeground }]}>UP NEXT</Text>
          <View style={styles.handoffRow}>
            <Text
              numberOfLines={1}
              style={[styles.handoffTitle, { color: colors.foreground }]}
            >
              {nextEvent.title}
            </Text>
            <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
          </View>
        </View>
      ) : (
        <View style={[styles.handoffStrip, { borderTopColor: colors.border }]}>
          <Text style={[styles.handoffLabel, { color: colors.mutedForeground }]}>
            END OF TIMELINE
          </Text>
        </View>
      )}
    </View>
  );
}

function DetailSection({
  title,
  colors,
  children,
  order = 0,
  reduceMotion = false,
}: {
  title: string;
  colors: Colors;
  children: React.ReactNode;
  // Stagger index so successive sections layer in just behind one another
  // rather than all popping in together. Keeps the progressive-reveal feel
  // confident without being slow.
  order?: number;
  // When the OS Reduce Motion setting is on, the staggered downward springy
  // reveal collapses to a single short fade so vestibular-sensitive users
  // don't see content sliding in.
  reduceMotion?: boolean;
}) {
  const reveal = useTimelineMotionConfig().reveal;
  const entering = reduceMotion
    ? FadeIn.duration(140)
    : FadeInDown.springify()
        .mass(reveal.mass)
        .damping(reveal.damping)
        .stiffness(reveal.stiffness)
        .delay(reveal.baseDelayMs + order * reveal.stepDelayMs);
  return (
    <Animated.View style={styles.detailSection} entering={entering}>
      <Text style={[styles.detailSectionTitle, { color: colors.mutedForeground }]}>{title}</Text>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingTop: 6,
    paddingBottom: 16,
    paddingHorizontal: 14,
    position: "relative",
  },

  // Centered vertical spine. Rendered once at the timeline root so it is
  // truly continuous across day groupings, the empty state, and any future
  // section content that might sit between groups.
  spine: {
    position: "absolute",
    left: "50%",
    top: 0,
    bottom: 0,
    marginLeft: -SPINE_WIDTH / 2,
    width: SPINE_WIDTH,
    borderRadius: SPINE_WIDTH,
  },

  group: {
    position: "relative",
    paddingVertical: 4,
  },

  dayRow: {
    alignItems: "center",
    marginBottom: 4,
  },
  dayPill: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  dayPillText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },

  // "Quiet days" marker rendered between groups when there's a multi-day
  // empty stretch. Sits centered across the spine so the spine reads as
  // continuous through it rather than interrupted.
  quietRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  quietTick: {
    width: 14,
    height: StyleSheet.hairlineWidth,
  },
  quietText: {
    fontSize: 10,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.3,
  },

  // Row layout: [left card slot][center dot+connector][right card slot]
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: CARD_THUMB + 24,
  },
  sideSlot: {
    flex: 1,
    minWidth: 0,
  },
  sideContent: {
    paddingHorizontal: CONNECTOR_GAP + 4,
  },
  centerSlot: {
    width: NODE_DOT,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  dot: {
    width: NODE_DOT,
    height: NODE_DOT,
    borderRadius: NODE_DOT / 2,
    borderWidth: DOT_BORDER,
    zIndex: 1,
  },
  dotHalo: {
    position: "absolute",
    width: NODE_DOT + 14,
    height: NODE_DOT + 14,
    borderRadius: (NODE_DOT + 14) / 2,
    borderWidth: 1,
    opacity: 0.85,
  },
  connector: {
    position: "absolute",
    top: NODE_DOT / 2 - 1,
    height: 2,
    borderRadius: 1,
  },

  // Side card
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  cardAlignLeft: { alignSelf: "flex-start" },
  cardAlignRight: { alignSelf: "flex-end" },
  cardBody: {
    flexShrink: 1,
    minWidth: 0,
    gap: 2,
  },
  cardTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 17,
  },
  cardProperty: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    marginTop: 2,
  },
  cardMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  cardMeta: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  cardDot: { fontSize: 11 },
  thumbWrap: {
    width: CARD_THUMB,
    height: CARD_THUMB,
    borderRadius: 8,
    overflow: "hidden",
  },
  thumbImage: { width: "100%", height: "100%", backgroundColor: "#0003" },
  thumbIcon: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },

  kindPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  kindDot: { width: 6, height: 6, borderRadius: 3 },
  kindText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  // Focused overlay
  overlayCenter: {
    flex: 1,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  overlayCard: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  overlayHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  overlayPhoto: {
    width: "100%",
    height: Math.min(280, Dimensions.get("window").height * 0.36),
    backgroundColor: "#0003",
  },
  overlayTitle: { fontSize: 17, fontFamily: "Inter_700Bold", marginBottom: 6 },
  overlayMeta: { fontSize: 12, fontFamily: "Inter_500Medium", marginBottom: 10 },
  overlayNote: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 12 },
  overlayAuthor: { fontSize: 11, fontFamily: "Inter_500Medium", marginBottom: 14 },
  overlayActions: { flexDirection: "row", gap: 8, marginTop: 4, flexWrap: "wrap" },
  overlayPrimary: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  overlayPrimaryText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  overlaySecondary: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1 },
  overlaySecondaryText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  // Anchored, animated overlay card. `position: "absolute"` so the card can
  // be placed at the tapped bubble's window coordinates and animated into the
  // expanded resting rect computed in FocusedOverlayInner.
  overlayAnchored: {
    position: "absolute",
    borderWidth: 1,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 12,
  },

  // Mid-flight ghost contents shown during the very first frames of the
  // expansion so the overlay never reads as "an empty rectangle popped out
  // of nowhere". Fades out as the real content fades in.
  overlayGhost: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  overlayGhostThumb: {
    width: CARD_THUMB,
    height: CARD_THUMB,
    borderRadius: 8,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  overlayGhostTitle: {
    flexShrink: 1,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 17,
  },

  // Phase 5 — progressive detail reveal styles. Sections that have nothing
  // to render simply don't render at all, so these styles only need to
  // cover the present-content cases.
  detailStack: {
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 18,
  },
  detailSection: {
    gap: 8,
  },
  detailSectionTitle: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  detailNote: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    lineHeight: 21,
  },
  detailLine: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    lineHeight: 20,
  },
  detailMuted: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  detailGallery: {
    gap: 8,
    paddingRight: 4,
  },
  detailGalleryThumb: {
    width: 120,
    height: 120,
    borderRadius: 10,
  },
  detailFileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },

  // The "Up next" handoff strip sits at the very bottom of an event's body.
  // It's the visual signal that the next downward swipe will transition into
  // the next event (Phase 4 boundary), not reveal more of the current one.
  handoffStrip: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  handoffLabel: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.2,
  },
  handoffRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  handoffTitle: {
    flexShrink: 1,
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 18,
  },
});
