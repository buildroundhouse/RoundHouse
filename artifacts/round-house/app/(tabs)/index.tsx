import { commandCenterIdentity } from "@/lib/command-center-identity";
import { OutwardAccountSwitcher } from "@/components/OutwardAccountSwitcher";
import React, { useCallback, useMemo, useRef, useState } from "react";
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
  type LayoutChangeEvent,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  useGetFeed,
  useGetMyRelationships,
  useSwitchActiveMode,
} from "@workspace/api-client-react";
import type {
  RelationshipPerson,
  UserModeProfile,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { MODE_LABELS } from "@/lib/intake-schemas";
import { ProjectTimeline, workLogToEvent } from "@/components/ProjectTimeline";
import { TimelineMotionDebugPanel } from "@/lib/timelineMotionDebug";
import { useProfile } from "@/lib/profile";
import {
  MailboxButton,
  NotificationBellButton,
} from "@/components/TopBarAvatar";
import { resolveStorageUrl } from "@/lib/uploads";
import { tierForScore } from "@/components/BadgeTier";
import { getModeAccent } from "@/lib/modeAccent";
import { ModeSwitcher } from "@/components/ModeSwitcher";
import {
  HomeSidePanelOverlay,
  type HomeSidePanelKey,
} from "@/components/HomeSidePanelOverlay";
import LogsScreen from "@/app/(tabs)/logs";
import InvoicesScreen from "@/app/(tabs)/invoices";
import PropertiesScreen from "@/app/(tabs)/properties";
import MyJobsScreen from "@/app/my-jobs";
import RemindersScreen from "@/app/reminders";

function TimelineHeader({
  avatarUrl,
  onOpenProfile,
  accountName,
  roleLabel,
  points,
}: {
  avatarUrl: string | null;
  onOpenProfile: () => void;
  accountName: string;
  roleLabel: string;
  points: number;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 6 : insets.top + 2;
  return (
    <View
      style={[
        styles.homeHeader,
        { paddingTop: topPad, borderBottomColor: colors.border },
      ]}
    >
      {/* The photo identifies the person; the name identifies the space. */}
      <View style={styles.headerAccountGroup}>
      <Pressable
        onPress={onOpenProfile}
        accessibilityLabel="Open profile"
        hitSlop={8}
        style={[
          styles.headerAvatar,
          { borderColor: colors.border, backgroundColor: colors.muted },
        ]}
      >
        {avatarUrl ? (
          <Image source={{ uri: avatarUrl }} style={styles.headerAvatarImg} />
        ) : null}
      </Pressable>
      <View style={styles.headerIdentity}>
        {accountName ? (
        <Text
          style={[styles.headerCompany, { color: colors.foreground }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {accountName}
        </Text>) : null}
        <Text style={[styles.headerRole, { color: colors.mutedForeground }]} numberOfLines={1}>{roleLabel}</Text>
        <OutwardAccountSwitcher variant="headerButton" />
      </View>
      </View>
      <Pressable
        onPress={onOpenProfile}
        accessibilityRole="button"
        accessibilityLabel={`${tierForScore(points).label} status, ${points} points`}
        style={[
          styles.pointsTicker,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        <Feather name="award" size={13} color={tierForScore(points).fg} />
        <View>
          <Text
            style={[styles.pointsStatus, { color: tierForScore(points).fg }]}
            numberOfLines={1}
          >
            {tierForScore(points).label}
          </Text>
          <Text
            style={[styles.pointsValue, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {points} pts
          </Text>
        </View>
      </Pressable>
      <NotificationBellButton />
      <MailboxButton />
    </View>
  );
}

// Bookmark-style side tabs that protrude from the right edge, matching the
// curved 3D look of the iOS Photos app side tabs. Each tab renders a single
// vertical label and upright icon inside a card with a left-rounded silhouette and a
// soft shadow. Tabs stack vertically and are vertically centered as a group
// so the screen feels balanced regardless of timeline length.
type SideTabSpec = {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  onPress: () => void;
};

// Discrete slate tone with low opacity so the tabs whisper rather than
// shout — they should never compete with the timeline for attention. White
// text at full alpha keeps labels readable on any underlying content.
const SIDE_TAB_BG = "rgba(120, 140, 165, 0.42)";
const SIDE_TAB_FG = "rgba(255, 255, 255, 0.88)";

function SideTab({
  spec,
  active,
  onLayout,
}: {
  spec: SideTabSpec;
  active: boolean;
  onLayout?: (key: string, y: number) => void;
}) {
  return (
    <Pressable
      onPress={spec.onPress}
      onLayout={(e) => onLayout?.(spec.key, e.nativeEvent.layout.y)}
      accessibilityRole="button"
      accessibilityLabel={`${active ? "Close" : "Open"} ${spec.label.toLowerCase()}`}
      accessibilityState={{ expanded: active }}
      style={({ pressed }) => [
        styles.sideTab,
        active ? { backgroundColor: "rgba(80, 100, 130, 0.78)" } : null,
        { transform: [{ translateX: pressed || active ? 4 : 0 }] },
      ]}
    >
      <View style={styles.sideTabInner}>
        <View style={{ transform: [{ rotate: "-90deg" }] }}>
          <Feather name={spec.icon} size={15} color={SIDE_TAB_FG} />
        </View>
        <Text style={styles.sideTabText} numberOfLines={1}>
          {spec.label}
        </Text>
      </View>
    </Pressable>
  );
}

function SideTabStack({
  tabs,
  topOffset,
  activeKey,
  onTabLayout,
}: {
  tabs: SideTabSpec[];
  topOffset: number;
  activeKey: string | null;
  onTabLayout?: (key: string, y: number) => void;
}) {
  return (
    <View
      pointerEvents="box-none"
      style={[styles.sideTabStack, { top: topOffset }]}
    >
      {tabs.map((t) => (
        <SideTab
          key={t.key}
          spec={t}
          active={activeKey === t.key}
          onLayout={onTabLayout}
        />
      ))}
    </View>
  );
}

// Top-LEFT photo-capture button. Per the latest visual direction we
// stripped away the previous "messy" Polaroid-style tile, ghost shadow,
// and shutter-dot sticker — the user wanted a clean, lean camera glyph
// only, drawn in the app's blue. The tappable area stays comfortably
// large via hitSlop so usability isn't sacrificed for the lighter look.
// The icon color is the app's blue (colors.primary, which is the same
// blue used by the bottom-tab active state and "Switch / Add Account"
// link) — explicitly NOT the mode accent, so the icon reads blue even
// when a non-homeowner mode (e.g. trade/amber) is active.
function TimelineSearchButton({
  topOffset,
  color,
  open,
  onPress,
}: {
  topOffset: number;
  color: string;
  open: boolean;
  onPress: () => void;
}) {
  return (
    <View
      pointerEvents="box-none"
      style={[styles.cameraIconHost, { top: topOffset }]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={open ? "Close Timeline search" : "Search Timeline"}
        accessibilityState={{ expanded: open }}
        hitSlop={16}
        style={({ pressed }) => [
          styles.cameraIconBtn,
          { opacity: pressed ? 0.6 : 1 },
        ]}
      >
        <Feather name={open ? "x" : "search"} size={27} color={color} />
      </Pressable>
    </View>
  );
}

function PeopleStrip({
  people,
  onOpen,
  onAdd,
  accent,
}: {
  people: RelationshipPerson[];
  onOpen: () => void;
  onAdd: () => void;
  accent: ReturnType<typeof getModeAccent>;
}) {
  const colors = useColors();
  const visible = people.slice(0, 5);
  return (
    <View style={styles.peopleRow}>
      {visible.map((p, idx) => {
        // Retired counterpart skin (#363): keep the avatar in the cluster
        // so the relationship is still represented, but mute it so it
        // reads as inactive at a glance.
        const retired = !!p.counterpartArchivedAt;
        return (
          <Pressable
            key={p.id}
            onPress={onOpen}
            style={[
              styles.avatar,
              {
                backgroundColor: accent.primary + "26",
                marginLeft: idx === 0 ? 0 : -10,
                borderColor: colors.background,
                borderWidth: 2,
                opacity: retired ? 0.45 : 1,
              },
            ]}
          >
            {p.avatarUrl ? (
              <Image source={{ uri: p.avatarUrl }} style={styles.avatarImg} />
            ) : (
              <Text style={[styles.avatarText, { color: accent.primary }]}>
                {(p.name || "?")[0].toUpperCase()}
              </Text>
            )}
          </Pressable>
        );
      })}
      {people.length > 5 ? (
        <Pressable
          onPress={onOpen}
          style={[
            styles.avatar,
            {
              backgroundColor: colors.muted,
              marginLeft: -10,
              borderColor: colors.background,
              borderWidth: 2,
            },
          ]}
        >
          <Text style={[styles.avatarText, { color: colors.mutedForeground }]}>
            +{people.length - 5}
          </Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={onAdd}
        style={[
          styles.avatar,
          styles.addAvatar,
          {
            borderColor: colors.border,
            marginLeft: visible.length === 0 ? 0 : 6,
          },
        ]}
      >
        <Feather name="plus" size={18} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

export default function TimelineScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // The right-side working tabs anchor just below the account header. The
  // Timeline search control shares that starting line on the left.
  // Header / strip / timeline padding constants used to compute where the
  // timeline thread (spine) begins on screen. The capture button and the
  // right-side bookmark stack are aligned to that exact y so they read as
  // a single horizontal "start line" together with the spine.
  const HEADER_AREA = 78; // TimelineHeader rendered height (paddingTop + content)
  const PEOPLE_STRIP_BLOCK = 12 + 36; // marginTop + avatar row height
  const TIMELINE_PAD_TOP = 6; // ProjectTimeline root paddingTop
  const {
    profile,
    activeMode,
    modes,
    refetchModes,
    refetchProfile,
    activeOutwardAccount,
  } = useProfile();
  const switchMutation = useSwitchActiveMode();
  const queryClient = useQueryClient();
  const handleSwitchMode = async (m: UserModeProfile) => {
    if (m.id === activeMode?.id) return;
    try {
      await switchMutation.mutateAsync({ data: { modeId: m.id } });
      await Promise.all([refetchProfile(), refetchModes()]);
      await queryClient.invalidateQueries();
    } catch {
      // ignore — profile screen surfaces errors when switching there.
    }
  };

  const accent = useMemo(
    () => getModeAccent(activeMode?.kind ?? null),
    [activeMode?.kind],
  );

  const headerAvatarUrl = resolveStorageUrl(profile?.avatarUrl);

  const headerMode = modes.find(m => m.id === activeOutwardAccount?.sourceUserModeId) ?? activeMode;
  const { entityName: activeAccountName, roleLabel: headerRoleLabel } = commandCenterIdentity(activeOutwardAccount, headerMode);

  const feedQuery = useGetFeed();
  const peopleQuery = useGetMyRelationships();
  const logs = feedQuery.data?.logs ?? [];
  const points = useMemo(
    () => logs.reduce((total, log) => total + (log.score ?? 0), 0),
    [logs],
  );
  const peopleData = peopleQuery.data;

  const allPeople = useMemo<RelationshipPerson[]>(() => {
    if (!peopleData) return [];
    const seen = new Set<number>();
    const out: RelationshipPerson[] = [];
    for (const p of [
      ...peopleData.core,
      ...peopleData.clients,
      ...peopleData.collaborators,
    ]) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
    return out;
  }, [peopleData]);

  const refreshing = feedQuery.isRefetching || peopleQuery.isRefetching;
  const onRefresh = () => {
    feedQuery.refetch();
    peopleQuery.refetch();
  };

  const bottomPad = Platform.OS === "web" ? 34 + 100 : insets.bottom + 100;

  // Y-coordinate where the timeline thread (spine) starts on screen.
  // We seed it with the constant-based estimate (so first paint isn't
  // visibly off), then the timelineWrap's own onLayout (a real-height
  // view, so onLayout fires reliably across native + web — unlike the
  // previous zero-height sentinel + measureInWindow combo, which was
  // skipping silently on web and leaving the camera/tabs anchored at
  // the under-estimated top of the screen). Both the camera capture
  // button (left) and the bookmark side-tab stack (right) anchor to
  // this same y so the three read as a unified horizontal "start
  // line" with the spine.
  const estimatedTimelineTop =
    insets.top +
    HEADER_AREA +
    (allPeople.length > 0 ? PEOPLE_STRIP_BLOCK : 0) +
    TIMELINE_PAD_TOP;
  const [measuredTimelineTop, setMeasuredTimelineTop] = useState<number | null>(
    null,
  );
  const handleTimelineWrapLayout = useCallback((e: LayoutChangeEvent) => {
    // layout.y is relative to the ScrollView's content container, which
    // sits at window y = 0 (the screen container is flex:1 with no
    // parent safe-area inset), so at scroll=0 layout.y === window y.
    // The camera + side tabs are absolute siblings of the ScrollView
    // (so they don't scroll), and use this y as their fixed top.
    const y = e?.nativeEvent?.layout?.y;
    if (typeof y === "number" && Number.isFinite(y)) {
      setMeasuredTimelineTop((prev) => (prev === y ? prev : y));
    }
  }, []);
  const timelineStartTop = measuredTimelineTop ?? estimatedTimelineTop;
  const rightStackTop = timelineStartTop + 52;

  const goPeople = () => router.push("/(tabs)/clients" as never);
  const goProperty = (id: number) => router.push(`/property/${id}` as never);
  const goProfile = () => router.push("/(tabs)/profile" as never);

  // Active side panel state — replaces the previous router.push for the
  // five right-edge tabs so they open as a dimmed overlay instead of a
  // new screen. Tapping the same tab again toggles it closed; tapping a
  // different tab swaps content without flicker.
  const [activeSidePanel, setActiveSidePanel] =
    useState<HomeSidePanelKey | null>(null);
  const [timelineSearchOpen, setTimelineSearchOpen] = useState(false);
  const [timelineQuery, setTimelineQuery] = useState("");
  const [tabOriginYs, setTabOriginYs] = useState<Record<string, number>>({});
  const handleTabLayout = useCallback((key: string, y: number) => {
    setTabOriginYs((prev) => (prev[key] === y ? prev : { ...prev, [key]: y }));
  }, []);
  const toggleSidePanel = useCallback((key: HomeSidePanelKey) => {
    setActiveSidePanel((cur) => (cur === key ? null : key));
  }, []);
  const closeSidePanel = useCallback(() => setActiveSidePanel(null), []);

  // Reminders panel exposes its "+" handler to the overlay header via a
  // ref-style setter so the overlay header can render an Add button that
  // opens the same modal the standalone screen would have shown.
  const remindersAddRef = useRef<(() => void) | null>(null);
  const setRemindersAdd = useCallback((open: () => void) => {
    remindersAddRef.current = open;
  }, []);

  const feedLoaded = !feedQuery.isLoading;
  const timelineEvents = useMemo(() => logs.map(workLogToEvent), [logs]);
  const visibleTimelineEvents = useMemo(() => {
    const needle = timelineQuery.trim().toLocaleLowerCase();
    if (!needle) return timelineEvents;
    return timelineEvents.filter((event) =>
      [
        event.title,
        event.note,
        event.propertyName,
        event.authorName,
        event.kind,
      ]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase().includes(needle)),
    );
  }, [timelineEvents, timelineQuery]);

  const SIDE_TABS: SideTabSpec[] = useMemo(
    () => [
      {
        key: "reminders",
        label: "Daily Grind",
        icon: "sunrise",
        onPress: () => toggleSidePanel("reminders"),
      },
      {
        key: "jobs",
        label: "Tasks / Lists",
        icon: "check-square",
        onPress: () => toggleSidePanel("jobs"),
      },
      {
        key: "receipts",
        label: "Receipts",
        icon: "credit-card",
        onPress: () => toggleSidePanel("receipts"),
      },
      {
        key: "properties",
        label: "Properties",
        icon: "home",
        onPress: () => toggleSidePanel("properties"),
      },
    ],
    [toggleSidePanel],
  );

  const PANEL_TITLES: Record<HomeSidePanelKey, string> = {
    logs: "Logs",
    jobs: "Tasks / Lists",
    receipts: "Receipts",
    reminders: "Daily Grind",
    properties: "Properties",
  };

  const tappedTabKey = activeSidePanel;
  // Convert the tab's local Y (within the side-tab stack at top=rightStackTop)
  // to an absolute screen Y so the panel scale animation can originate from it.
  const overlayOriginY =
    tappedTabKey != null
      ? rightStackTop + (tabOriginYs[tappedTabKey] ?? 0) + 40
      : rightStackTop;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={accent.primary}
          />
        }
      >
        <TimelineHeader
          avatarUrl={headerAvatarUrl}
          onOpenProfile={goProfile}
          accountName={activeAccountName}
          roleLabel={headerRoleLabel}
          points={points}
        />

        {/* The standalone OutwardAccountSwitcher card used to live here, but
            switching/adding accounts is now driven entirely from the compact
            "Switch / Add Account" trigger in TimelineHeader. Rendering it again
            below the header was duplicate UI and crowded the timeline. */}

        {/* PeopleStrip only renders when there's at least one person — the
            orphan "+" button reads as stray UI when the list is empty, and
            adding contacts already lives on the Clients tab. */}
        {allPeople.length > 0 ? (
          <View style={{ paddingHorizontal: 14, marginTop: 12 }}>
            <PeopleStrip
              people={allPeople}
              onOpen={goPeople}
              onAdd={goPeople}
              accent={accent}
            />
          </View>
        ) : null}

        {timelineSearchOpen ? (
          <View
            style={[
              styles.timelineSearchWrap,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <Feather name="search" size={18} color={colors.mutedForeground} />
            <TextInput
              value={timelineQuery}
              onChangeText={setTimelineQuery}
              placeholder="Search your Timeline…"
              placeholderTextColor={colors.mutedForeground}
              autoFocus
              returnKeyType="search"
              accessibilityLabel="Search your Timeline"
              style={[styles.timelineSearchInput, { color: colors.foreground }]}
            />
            {timelineQuery ? (
              <Pressable
                onPress={() => setTimelineQuery("")}
                accessibilityRole="button"
                accessibilityLabel="Clear Timeline search"
                hitSlop={10}
              >
                <Feather
                  name="x-circle"
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* The timeline is the centerpiece of the Timeline tab. We always render it so the
            spine runs continuously down the middle even with zero events.
            The timelineWrap's onLayout is what the camera button +
            side-tab stack measure against to share a common "start
            line" with the spine. */}
        <View
          style={styles.timelineWrap}
          onLayout={handleTimelineWrapLayout}
          collapsable={false}
        >
          <ProjectTimeline
            events={visibleTimelineEvents}
            onOpenProperty={goProperty}
          />
        </View>
      </ScrollView>
      <TimelineSearchButton
        topOffset={timelineStartTop}
        color={colors.primary}
        open={timelineSearchOpen}
        onPress={() => {
          setTimelineSearchOpen((current) => {
            if (current) setTimelineQuery("");
            return !current;
          });
        }}
      />
      <SideTabStack
        topOffset={rightStackTop}
        tabs={SIDE_TABS}
        activeKey={activeSidePanel}
        onTabLayout={handleTabLayout}
      />
      <HomeSidePanelOverlay
        panelKey={activeSidePanel}
        originY={overlayOriginY}
        topOffset={rightStackTop}
        title={activeSidePanel ? PANEL_TITLES[activeSidePanel] : ""}
        onClose={closeSidePanel}
        headerRight={
          activeSidePanel === "reminders" ? (
            <Pressable
              onPress={() => remindersAddRef.current?.()}
              accessibilityLabel="Add reminder"
              hitSlop={10}
              style={({ pressed }) => ({
                opacity: pressed ? 0.6 : 1,
                padding: 4,
              })}
            >
              <Feather name="plus" size={22} color={colors.foreground} />
            </Pressable>
          ) : null
        }
      >
        {activeSidePanel === "logs" ? <LogsScreen embedded /> : null}
        {activeSidePanel === "jobs" ? <MyJobsScreen embedded /> : null}
        {activeSidePanel === "receipts" ? <InvoicesScreen embedded /> : null}
        {activeSidePanel === "reminders" ? (
          <RemindersScreen embedded onRequestAdd={setRemindersAdd} />
        ) : null}
        {activeSidePanel === "properties" ? (
          <PropertiesScreen embedded />
        ) : null}
      </HomeSidePanelOverlay>
      <TimelineMotionDebugPanel />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  timelineSearchWrap: {
    minHeight: 48,
    marginHorizontal: 56,
    marginTop: 8,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  timelineSearchInput: {
    flex: 1,
    minHeight: 46,
    fontSize: 16,
    fontFamily: "Inter_400Regular",
  },

  homeHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerAccountGroup: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 7 },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  headerAvatarImg: { width: "100%", height: "100%" },
  headerCompany: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    flexShrink: 1,
  },
  headerIdentity: { flex: 1, minWidth: 0, justifyContent: "center", alignItems: "flex-start", gap: 2 },
  headerRole: { fontSize: 12, lineHeight: 16, fontFamily: "Inter_500Medium" },
  pointsTicker: {
    minWidth: 68,
    height: 40,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  pointsStatus: { fontSize: 9, lineHeight: 11, fontFamily: "Inter_700Bold" },
  pointsValue: { fontSize: 9, lineHeight: 11, fontFamily: "Inter_600SemiBold" },

  peopleRow: { flexDirection: "row", alignItems: "center" },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  addAvatar: {
    borderWidth: 1,
    borderStyle: "solid",
    backgroundColor: "transparent",
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarText: { fontSize: 13, fontFamily: "Inter_700Bold" },

  // Symmetric horizontal padding so the centered spine sits exactly at
  // true screen-center. Asymmetric padding shifts the absolutely-positioned
  // spine off-center, breaking its visual relationship with the camera
  // button (top-left) and the bookmark side-tab stack (top-right). The 56px
  // value clears both the camera button host (left: 14, width: 44 → ends
  // at x=58) and the side-tab stack (right: 0, width: 22) with breathing
  // room on either side.
  timelineWrap: { paddingLeft: 56, paddingRight: 56 },

  // Stack of bookmark-style side tabs glued to the right edge. topOffset is
  // passed in dynamically so we can sit just below the header — well clear
  // of the floating capture FAB at the bottom-right of the screen.
  sideTabStack: {
    position: "absolute",
    right: 0,
    gap: 16,
  },

  // Slim tapered bookmark silhouette — quiet/ambient so the tabs whisper
  // rather than shout. Larger radii on the LEFT (inward / protruding) edge
  // give the pronounced curve of the iOS Photos reference; smaller radii on
  // the RIGHT pull the edges inward toward the screen edge for a soft taper.
  sideTab: {
    width: 22,
    height: 74,
    backgroundColor: SIDE_TAB_BG,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: -2, height: 1 },
    elevation: 2,
  },

  // Rotate the label row along the narrow tab; counter-rotate only the icon.
  sideTabInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    width: 70,
    transform: [{ rotate: "90deg" }],
    justifyContent: "center",
  },
  sideTabText: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.2,
    color: SIDE_TAB_FG,
  },

  // Timeline Search sits at the upper-left edge of the Timeline. The host is
  // intentionally compact, while hitSlop preserves a 44pt+ target.
  cameraIconHost: {
    position: "absolute",
    left: 14,
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraIconBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  // Aperture glyph absolutely positioned over the camera body so it
  // lands inside the body's lens cutout. The Feather "camera" lens sits
  // a hair below the body's vertical center (the body has a flat top
  // edge with a viewfinder bump), so a tiny +1px nudge lines them up.
  cameraIconAperture: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ translateY: 1 }],
  },
});
