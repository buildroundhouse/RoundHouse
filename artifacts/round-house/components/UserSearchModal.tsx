import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  useSearchUsers,
  useSearchPros,
  useSearchSuccessStories,
  useGetActiveDeals,
  useGetAreaFeed,
  useGetConnectionStatus,
  useConnectToUser,
  useGetMe,
  type ProSearchResult,
  type SuccessStory,
  type Deal,
  type AreaFeedItem,
  type SearchUserResult,
  type UserModeKind,
  type ConnectionKind,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { MODE_LABELS } from "@/lib/intake-schemas";
import { kindLabelForName } from "@/lib/account-display";
import { resolveStorageUrl } from "@/lib/uploads";
import { useProfile } from "@/lib/profile";
import { getModeAccent } from "@/lib/modeAccent";
import { PublicProfileModal } from "@/components/PublicProfileModal";
import { ConnectionKindChooser } from "@/components/ConnectionKindChooser";

type SearchKind = "friends" | "pros" | "stories";
type RowState = "invite" | "sent" | "connected" | "pending_account";

interface Props {
  visible: boolean;
  onClose: () => void;
  onUserPress?: (clerkId: string) => void;
  initialQuery?: string;
  initialService?: string;
  onInviteSent?: (name: string) => void;
}

export function UserSearchModal({
  visible,
  onClose,
  onUserPress,
  initialQuery,
  initialService,
  onInviteSent,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { activeMode } = useProfile();
  const accent = useMemo(() => getModeAccent(activeMode?.kind ?? null), [activeMode?.kind]);
  const { data: me } = useGetMe();

  const [friendsQ, setFriendsQ] = useState(initialQuery ?? "");
  const [prosQ, setProsQ] = useState("");
  const [storiesQ, setStoriesQ] = useState("");
  const [zip, setZip] = useState(me?.addressZip ?? "");
  const [serviceFilter, setServiceFilter] = useState<string | null>(initialService ?? null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [viewClerkId, setViewClerkId] = useState<string | null>(null);
  // #645 / #656 — when the user taps Invite we open the same kind
  // chooser sheet the inbox blocked banner uses, so they can classify
  // the relationship (Client / Core / Collaborator) and add an
  // optional personal note before the request goes out. Hold the
  // target row here while the sheet is up.
  const [chooserTarget, setChooserTarget] = useState<
    { clerkId: string; name: string } | null
  >(null);

  useEffect(() => {
    if (!visible) {
      setFriendsQ("");
      setProsQ("");
      setStoriesQ("");
      setServiceFilter(null);
      setPendingId(null);
      return;
    }
    if (initialQuery !== undefined) setFriendsQ(initialQuery);
    if (initialService !== undefined) setServiceFilter(initialService || null);
    setZip(me?.addressZip ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Debounced friend search.
  const [friendsDeb, setFriendsDeb] = useState(friendsQ.trim());
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => setFriendsDeb(friendsQ.trim()), 200);
    return () => clearTimeout(t);
  }, [friendsQ, visible]);

  const friendsQuery = useSearchUsers(
    {
      q: friendsDeb,
      ...(serviceFilter ? { service: serviceFilter } : {}),
    },
    {
      query: {
        enabled: visible && (friendsDeb.length > 0 || !!serviceFilter),
        queryKey: ["/api/users/search", friendsDeb, serviceFilter ?? ""],
      },
    },
  );
  // /api/users/search returns one row per user under the
  // single-profile paradigm — the multi-skin shape is collapsed on
  // the server, so the People list renders these rows directly.
  const friendUsers = friendsQuery.data?.users ?? [];

  const idsParam = useMemo(
    () => friendUsers.map((u) => u.clerkId).filter(Boolean).join(","),
    [friendUsers],
  );
  const statusKey = ["/api/users/me/connection-status", idsParam];
  const { data: statusData } = useGetConnectionStatus(
    { ids: idsParam },
    {
      query: {
        enabled: visible && idsParam.length > 0,
        queryKey: statusKey,
      },
    },
  );
  const statusByClerk = useMemo(() => {
    const map = new Map<string, { kind: string; status: string }>();
    for (const e of statusData?.entries ?? []) {
      map.set(e.clerkId, { kind: e.kind, status: e.status });
    }
    return map;
  }, [statusData]);
  const connect = useConnectToUser();

  function rowStateFor(item: { clerkId: string; username: string }): RowState {
    if (item.username?.startsWith("_pending_")) return "pending_account";
    const conn = statusByClerk.get(item.clerkId);
    if (!conn) return "invite";
    if (conn.status === "accepted") return "connected";
    return "sent";
  }

  function openInviteChooser(clerkId: string, name: string) {
    if (pendingId) return;
    // #645 — Open the kind picker instead of hard-coding
    // "collaborator" + firing immediately. The chooser is the same
    // sheet the inbox blocked banner and public profile modal use,
    // so the search Invite button now matches the rest of the app's
    // connect UX.
    setChooserTarget({ clerkId, name });
  }

  async function handleKindPicked(kind: ConnectionKind, personalNote?: string) {
    const target = chooserTarget;
    setChooserTarget(null);
    if (!target || pendingId) return;
    setPendingId(target.clerkId);
    try {
      await connect.mutateAsync({
        userId: target.clerkId,
        // #656 — forward the optional personal note from the picker
        // sheet so the team-up request lands with the requester's
        // context on the recipient's /invites surface.
        data: personalNote
          ? { kind, status: "pending", personalNote }
          : { kind, status: "pending" },
      });
      await queryClient.invalidateQueries({ queryKey: statusKey });
      onInviteSent?.(target.name);
    } catch (e) {
      // #501: surface the duplicate-pending guardrail. The server
      // returns 409 with { code: "team_up_pending" } when a request
      // to this skin is already outstanding; let the existing "Sent"
      // pill show by refreshing the connection-status cache instead
      // of failing silently.
      const code =
        e && typeof e === "object" && "data" in e
          ? (e as { data?: { code?: string } }).data?.code
          : undefined;
      if (code === "team_up_pending") {
        await queryClient.invalidateQueries({ queryKey: statusKey });
      }
    } finally {
      setPendingId(null);
    }
  }

  const prosQuery = useSearchPros(
    { q: prosQ.trim(), zip: zip.trim() || undefined },
    {
      query: {
        enabled: visible && (prosQ.trim().length > 0 || zip.trim().length === 5),
        queryKey: ["/api/pros/search", prosQ.trim(), zip.trim()],
      },
    },
  );
  const storiesQuery = useSearchSuccessStories(
    { q: storiesQ.trim() },
    {
      query: {
        enabled: visible && storiesQ.trim().length > 0,
        queryKey: ["/api/success-stories/search", storiesQ.trim()],
      },
    },
  );
  const dealsQuery = useGetActiveDeals(
    { zip: zip.trim() || undefined },
    {
      query: {
        enabled: visible,
        queryKey: ["/api/deals/active", zip.trim()],
      },
    },
  );
  const areaQuery = useGetAreaFeed(
    { zip: zip.trim() || undefined },
    {
      query: {
        enabled: visible,
        queryKey: ["/api/area/feed", zip.trim()],
      },
    },
  );

  const proResults = (prosQuery.data?.pros ?? []) as ProSearchResult[];
  const storyResults = (storiesQuery.data?.stories ?? []) as SuccessStory[];
  const deals = (dealsQuery.data?.deals ?? []) as Deal[];
  const areaItems = (areaQuery.data?.items ?? []) as AreaFeedItem[];

  const goUser = (clerkId: string) => {
    if (onUserPress) onUserPress(clerkId);
    else setViewClerkId(clerkId);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingTop: Platform.OS === "web" ? 24 : insets.top + 8,
            },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={20} style={{ padding: 8 }}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>Search</Text>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          keyboardShouldPersistTaps="handled"
        >
          {serviceFilter ? (
            <View style={styles.filterRow}>
              <View
                style={[
                  styles.filterChip,
                  { backgroundColor: colors.scoreBackground, borderColor: colors.border },
                ]}
              >
                <Feather name="tool" size={12} color={colors.primary} />
                <Text style={[styles.filterChipText, { color: colors.primary }]} numberOfLines={1}>
                  Offers: {serviceFilter}
                </Text>
                <Pressable
                  onPress={() => setServiceFilter(null)}
                  hitSlop={8}
                  accessibilityLabel="Clear service filter"
                >
                  <Feather name="x" size={12} color={colors.primary} />
                </Pressable>
              </View>
            </View>
          ) : null}
          <View style={styles.searchStack}>
            <SearchBar
              kind="friends"
              label="Friends"
              placeholder="Find people you know…"
              value={friendsQ}
              onChange={setFriendsQ}
              zip=""
              onZipChange={() => {}}
              showZip={false}
              accent={accent}
              colors={colors}
              loading={friendsQuery.isFetching}
              emptyText="Search by name or username"
              results={
                friendUsers.length === 0 ? (
                  <Text style={[styles.resultsHint, { color: colors.mutedForeground }]}>
                    No matches.
                  </Text>
                ) : (
                  friendUsers.slice(0, 8).map((u, ix) => {
                    const avatarUri = resolveStorageUrl(u.avatarUrl ?? null);
                    // #620: suppress the kind suffix when the user's name
                    // already contains every word of the label (e.g. name
                    // "My Home" + label "My Home", or name "Beach Home" +
                    // label "Home"), so the @handle row doesn't repeat
                    // the same words shown in the name above. Partial
                    // overlaps (e.g. "Smith Home" vs. "My Home") still
                    // render the label.
                    const role =
                      u.activeModeKind != null
                        ? kindLabelForName(
                            u.name,
                            MODE_LABELS[u.activeModeKind as UserModeKind] ?? null,
                          )
                        : null;
                    const state = rowStateFor(u);
                    const isInviting = pendingId === u.clerkId;
                    return (
                      <Pressable
                        key={`${u.clerkId}:${u.outwardAccountId ?? "none"}:${ix}`}
                        onPress={() => goUser(u.clerkId)}
                        style={[styles.resultRow, { borderTopColor: colors.border }]}
                      >
                        <View
                          style={[
                            styles.resultAvatar,
                            { backgroundColor: accent.primary + "1F" },
                          ]}
                        >
                          {avatarUri ? (
                            <Image source={{ uri: avatarUri }} style={styles.resultAvatarImg} />
                          ) : (
                            <Text style={{ color: accent.primary, fontFamily: "Inter_700Bold" }}>
                              {(u.name || "?")[0].toUpperCase()}
                            </Text>
                          )}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text
                            style={[styles.resultTitle, { color: colors.foreground }]}
                            numberOfLines={1}
                          >
                            {u.name}
                          </Text>
                          <Text
                            style={[styles.resultSub, { color: colors.mutedForeground }]}
                            numberOfLines={1}
                          >
                            @{u.username}
                            {role ? `  ·  ${role}` : ""}
                          </Text>
                        </View>
                        {state === "invite" ? (
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation();
                              openInviteChooser(u.clerkId, u.name);
                            }}
                            disabled={isInviting}
                            hitSlop={6}
                            style={[
                              styles.actionBtn,
                              { backgroundColor: accent.primary, opacity: isInviting ? 0.6 : 1 },
                            ]}
                          >
                            {isInviting ? (
                              <ActivityIndicator size="small" color={accent.primaryForeground} />
                            ) : (
                              <Text
                                style={[styles.actionBtnText, { color: accent.primaryForeground }]}
                              >
                                Invite
                              </Text>
                            )}
                          </Pressable>
                        ) : state === "sent" ? (
                          <View
                            style={[
                              styles.actionPill,
                              { borderColor: colors.border, backgroundColor: colors.card },
                            ]}
                          >
                            <Feather name="check" size={12} color={colors.mutedForeground} />
                            <Text
                              style={[styles.actionPillText, { color: colors.mutedForeground }]}
                            >
                              Sent
                            </Text>
                          </View>
                        ) : state === "connected" ? (
                          <View
                            style={[
                              styles.actionPill,
                              { borderColor: colors.border, backgroundColor: colors.scoreBackground },
                            ]}
                          >
                            <Feather name="users" size={12} color={accent.primary} />
                            <Text style={[styles.actionPillText, { color: accent.primary }]}>
                              Connected
                            </Text>
                          </View>
                        ) : (
                          <View
                            style={[
                              styles.actionPill,
                              { borderColor: colors.border, backgroundColor: colors.card },
                            ]}
                          >
                            <Text
                              style={[styles.actionPillText, { color: colors.mutedForeground }]}
                            >
                              Pending
                            </Text>
                          </View>
                        )}
                      </Pressable>
                    );
                  })
                )
              }
            />

            <SearchBar
              kind="pros"
              label={accent.proSearchLabel}
              placeholder={accent.proSearchPlaceholder}
              value={prosQ}
              onChange={setProsQ}
              zip={zip}
              onZipChange={setZip}
              showZip
              accent={accent}
              colors={colors}
              loading={prosQuery.isFetching}
              emptyText={
                accent.copyTone === "trade"
                  ? "Find subs by trade, company, or ZIP."
                  : "Type a trade (e.g. plumber, drywall) and your ZIP."
              }
              results={
                proResults.length === 0 ? (
                  <Text style={[styles.resultsHint, { color: colors.mutedForeground }]}>
                    No pros found in that area yet.
                  </Text>
                ) : (
                  proResults.slice(0, 8).map((p) => (
                    <Pressable
                      key={p.id}
                      onPress={() => goUser(p.clerkId)}
                      style={[styles.resultRow, { borderTopColor: colors.border }]}
                    >
                      <View
                        style={[
                          styles.resultAvatar,
                          { backgroundColor: accent.primary + "1F" },
                        ]}
                      >
                        {p.avatarUrl ? (
                          <Image source={{ uri: p.avatarUrl }} style={styles.resultAvatarImg} />
                        ) : (
                          <Feather name="tool" size={16} color={accent.primary} />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <Text
                            style={[styles.resultTitle, { color: colors.foreground }]}
                            numberOfLines={1}
                          >
                            {p.companyName || p.name}
                          </Text>
                          {p.topPro ? (
                            <View style={styles.topProPill}>
                              <Feather name="award" size={10} color="#3B4856" />
                              <Text style={styles.topProText}>Top Pro</Text>
                            </View>
                          ) : null}
                          {p.sponsorBrandName ? (
                            <View style={styles.sponsorPill}>
                              <Feather name="star" size={10} color="#9A7B00" />
                              <Text style={styles.sponsorText}>{p.sponsorBrandName}</Text>
                            </View>
                          ) : null}
                        </View>
                        <Text
                          style={[styles.resultSub, { color: colors.mutedForeground }]}
                          numberOfLines={1}
                        >
                          {(p.trade ? p.trade + " · " : "") +
                            (p.avgRating ? `★ ${p.avgRating.toFixed(1)} (${p.ratingCount})` : "New")}
                          {p.serviceZips.length > 0 ? ` · ${p.serviceZips.slice(0, 3).join(", ")}` : ""}
                        </Text>
                      </View>
                    </Pressable>
                  ))
                )
              }
            />

            <SearchBar
              kind="stories"
              label="Success Stories"
              placeholder="Search outcomes (kitchen, roof, lawn…)"
              value={storiesQ}
              onChange={setStoriesQ}
              zip=""
              onZipChange={() => {}}
              showZip={false}
              accent={accent}
              colors={colors}
              loading={storiesQuery.isFetching}
              emptyText="Find proof of completed work."
              results={
                storyResults.length === 0 ? (
                  <Text style={[styles.resultsHint, { color: colors.mutedForeground }]}>
                    No stories yet.
                  </Text>
                ) : (
                  storyResults.slice(0, 8).map((s) => (
                    <View
                      key={s.id}
                      style={[styles.resultRow, { borderTopColor: colors.border }]}
                    >
                      <View
                        style={[
                          styles.resultAvatar,
                          { backgroundColor: accent.primary + "1F" },
                        ]}
                      >
                        <Feather name="award" size={16} color={accent.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.resultTitle, { color: colors.foreground }]}
                          numberOfLines={2}
                        >
                          {s.headline}
                        </Text>
                        <Text
                          style={[styles.resultSub, { color: colors.mutedForeground }]}
                          numberOfLines={1}
                        >
                          {s.pro?.companyName || s.pro?.name || "Pro"}
                          {s.serviceTag ? ` · ${s.serviceTag}` : ""}
                        </Text>
                      </View>
                    </View>
                  ))
                )
              }
            />
          </View>

          {deals.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                  Deals & Offers
                </Text>
                <Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>
                  {deals.length} active
                </Text>
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.dealsScroll}
              >
                {deals.map((d) => {
                  const ends = new Date(d.endDate);
                  const days = Math.max(0, Math.ceil((ends.getTime() - Date.now()) / 86400000));
                  return (
                    <Pressable
                      key={d.id}
                      onPress={() => goUser(d.proClerkId)}
                      style={[
                        styles.dealCard,
                        { backgroundColor: colors.card, borderColor: colors.border },
                      ]}
                    >
                      <View style={[styles.dealRibbon, { backgroundColor: accent.primary }]}>
                        <Text
                          style={[styles.dealRibbonText, { color: accent.primaryForeground }]}
                        >
                          {d.serviceTag}
                        </Text>
                      </View>
                      <Text
                        style={[styles.dealHeadline, { color: colors.foreground }]}
                        numberOfLines={2}
                      >
                        {d.headline}
                      </Text>
                      {d.description ? (
                        <Text
                          style={[styles.dealDesc, { color: colors.mutedForeground }]}
                          numberOfLines={2}
                        >
                          {d.description}
                        </Text>
                      ) : null}
                      <View style={styles.dealFooter}>
                        <Text
                          style={[styles.dealPro, { color: colors.foreground }]}
                          numberOfLines={1}
                        >
                          {d.pro?.companyName || d.pro?.name || "Local pro"}
                        </Text>
                        <Text style={[styles.dealEnds, { color: accent.primary }]}>
                          {days === 0 ? "Ends today" : `${days}d left`}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
                In Your Area
              </Text>
              {zip ? (
                <Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>
                  ZIP {zip}
                </Text>
              ) : (
                <Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>
                  Add ZIP above
                </Text>
              )}
            </View>
            {areaItems.length === 0 ? (
              <View
                style={[
                  styles.emptyArea,
                  { borderColor: colors.border, backgroundColor: colors.card },
                ]}
              >
                <Feather name="map-pin" size={16} color={colors.mutedForeground} />
                <Text style={[styles.emptyAreaText, { color: colors.mutedForeground }]}>
                  No nearby activity yet. As pros log work in your ZIP, you'll see it here.
                </Text>
              </View>
            ) : (
              areaItems.slice(0, 8).map((it) => (
                <Pressable
                  key={`${it.kind}-${it.id}`}
                  onPress={() => (it.pro?.clerkId ? goUser(it.pro.clerkId) : undefined)}
                  style={[
                    styles.areaItem,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <View style={[styles.areaTagDot, { backgroundColor: accent.primary }]} />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[styles.areaHeadline, { color: colors.foreground }]}
                      numberOfLines={2}
                    >
                      {it.headline}
                    </Text>
                    <Text
                      style={[styles.areaMeta, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {it.kind === "success_story" ? "Success story" : "Recently completed"}
                      {it.pro?.companyName
                        ? ` · ${it.pro.companyName}`
                        : it.pro?.name
                        ? ` · ${it.pro.name}`
                        : ""}
                      {it.propertyName ? ` · ${it.propertyName}` : ""}
                    </Text>
                  </View>
                </Pressable>
              ))
            )}
          </View>
        </ScrollView>

        {/* Inline profile modal when no external onUserPress was provided. */}
        {!onUserPress ? (
          <PublicProfileModal
            visible={!!viewClerkId}
            clerkId={viewClerkId}
            onClose={() => setViewClerkId(null)}
          />
        ) : null}

        {/* #645 / #656 — Kind chooser sheet for the Invite button. Same
            sheet the inbox blocked banner and public profile modal use,
            with Collaborator pinned as the recommended default and the
            optional personal-note composer enabled. */}
        <ConnectionKindChooser
          visible={!!chooserTarget}
          onClose={() => setChooserTarget(null)}
          onSelect={handleKindPicked}
          pending={connect.isPending}
          recommendedKind="collaborator"
          title="Invite as…"
          subtitle={
            chooserTarget
              ? `Pick how you'd like to classify ${chooserTarget.name}.`
              : "Pick how you'd like to classify this person."
          }
          showPersonalNote
          testID="search-invite-kind-chooser"
        />
      </View>
    </Modal>
  );
}

function SearchBar({
  kind,
  value,
  onChange,
  zip,
  onZipChange,
  showZip,
  accent,
  colors,
  results,
  loading,
  emptyText,
  label,
  placeholder,
}: {
  kind: SearchKind;
  value: string;
  onChange: (v: string) => void;
  zip: string;
  onZipChange: (v: string) => void;
  showZip: boolean;
  accent: ReturnType<typeof getModeAccent>;
  colors: ReturnType<typeof useColors>;
  results: React.ReactNode;
  loading: boolean;
  emptyText: string;
  label: string;
  placeholder: string;
}) {
  const [focused, setFocused] = useState(false);
  const expanded = focused || value.trim().length > 0;
  const icon = kind === "friends" ? "users" : kind === "pros" ? "tool" : "award";
  return (
    <View
      style={[
        styles.searchWrap,
        {
          backgroundColor: colors.card,
          borderColor: expanded ? accent.primary : colors.border,
        },
      ]}
    >
      <View style={styles.searchHeader}>
        <Feather name={icon} size={14} color={accent.primary} />
        <Text style={[styles.searchLabel, { color: colors.foreground }]}>{label}</Text>
      </View>
      <View style={styles.searchInputRow}>
        <Feather name="search" size={14} color={colors.mutedForeground} />
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.mutedForeground}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={[styles.searchInput, { color: colors.foreground }]}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {showZip ? (
          <TextInput
            value={zip}
            onChangeText={onZipChange}
            placeholder="ZIP"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="number-pad"
            maxLength={5}
            style={[
              styles.zipInput,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
          />
        ) : null}
      </View>
      {expanded ? (
        <View style={styles.resultsPanel}>
          {loading ? (
            <Text style={[styles.resultsHint, { color: colors.mutedForeground }]}>
              Searching…
            </Text>
          ) : value.trim().length === 0 ? (
            <Text style={[styles.resultsHint, { color: colors.mutedForeground }]}>
              {emptyText}
            </Text>
          ) : (
            results
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },

  searchStack: { paddingHorizontal: 14, paddingTop: 14, gap: 10 },
  searchWrap: { borderRadius: 14, borderWidth: 1, padding: 10 },
  searchHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  searchLabel: { fontSize: 12, fontFamily: "Inter_700Bold", letterSpacing: 0.4 },
  searchInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    paddingVertical: 4,
    minWidth: 0,
  },
  zipInput: {
    width: 64,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: -4,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold", maxWidth: 220 },
  resultsPanel: { marginTop: 8 },
  resultsHint: { fontSize: 12, fontFamily: "Inter_400Regular", paddingVertical: 6 },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  resultAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  resultAvatarImg: { width: "100%", height: "100%" },
  resultTitle: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  resultSub: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },

  actionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    minWidth: 70,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  actionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  actionPillText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  topProPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#E2E8EE",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  topProText: { fontFamily: "Inter_700Bold", fontSize: 10, color: "#3B4856" },
  sponsorPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "#FFF3C4",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  sponsorText: { fontFamily: "Inter_700Bold", fontSize: 10, color: "#9A7B00" },

  section: { marginTop: 20, paddingHorizontal: 14 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 14, fontFamily: "Inter_700Bold" },
  sectionMeta: { fontSize: 11, fontFamily: "Inter_500Medium" },

  dealsScroll: { gap: 10, paddingRight: 10 },
  dealCard: { width: 220, borderRadius: 14, borderWidth: 1, padding: 12, gap: 6 },
  dealRibbon: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  dealRibbonText: { fontSize: 10, fontFamily: "Inter_700Bold" },
  dealHeadline: { fontSize: 13, fontFamily: "Inter_700Bold" },
  dealDesc: { fontSize: 11, fontFamily: "Inter_400Regular" },
  dealFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  dealPro: { fontSize: 11, fontFamily: "Inter_600SemiBold", flex: 1 },
  dealEnds: { fontSize: 11, fontFamily: "Inter_700Bold", marginLeft: 6 },

  emptyArea: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  emptyAreaText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular" },

  areaItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  areaTagDot: { width: 8, height: 8, borderRadius: 4 },
  areaHeadline: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  areaMeta: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 2 },
});
