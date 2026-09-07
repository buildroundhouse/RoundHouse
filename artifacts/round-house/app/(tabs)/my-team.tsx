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
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  useGetMyRelationships,
  useListMyTeam,
  getListMyTeamQueryKey,
} from "@workspace/api-client-react";
import { useProfile } from "@/lib/profile";
import type { RelationshipPerson } from "@workspace/api-client-react";
import { TeamSection } from "@/components/TeamSection";
import { TeamInvitesBanner } from "@/components/TeamInvitesBanner";
import { ManageTeamModal } from "@/components/ManageTeamModal";
import { PublicProfileModal } from "@/components/PublicProfileModal";
import { EmptyState } from "@/components/EmptyState";
import { bucketRelationships, composeLabelChipLine, splitByCadence } from "@/lib/connectionTags";
import { messageHrefFor } from "@/lib/messageTarget";

/**
 * My Team — per-skin layout (#504).
 *
 * The screen is the single roster surface for whoever's currently
 * acting on this device. The layout is shaped to the active outward
 * account's `companyKind`, so the same screen renders three different
 * stacks of buckets:
 *
 *   - Homeowner (no companyKind):
 *       Trade Pros (Occasional / Recurring) → Friends & Collaborators
 *
 *   - Trade Pro (companyKind === "trade_pro"):
 *       Clients → Trade Pro Teammates → Outside Services
 *       (Occasional / Recurring) → Friends & Collaborators
 *
 *   - Facility Manager (companyKind === "facilities"):
 *       Facility Teammates → Friends & Collaborators
 *       (Outside Services for FM lives on the left lower-nav tab,
 *       not under My Team — see app/(tabs)/clients.tsx.)
 *
 * Heading copy is intentionally kept consistent across skins so the
 * concept stays anchored: "Outside Services" on Trade Pro / Facility,
 * "Trade Pros" on Homeowner, and "Friends & Collaborators" everywhere.
 */
export default function MyTeamScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { activeOutwardAccount } = useProfile();
  const outwardKind = activeOutwardAccount?.kind ?? null;
  const companyKind: "trade_pro" | "facilities" | null =
    outwardKind === "trade_pro"
      ? "trade_pro"
      : outwardKind === "facilities"
        ? "facilities"
        : null;

  const {
    data: rels,
    isRefetching: relsRefetching,
    refetch: refetchRels,
    isLoading: relsLoading,
  } = useGetMyRelationships();
  const {
    data: team,
    isRefetching: teamRefetching,
    refetch: refetchTeam,
    isLoading: teamLoading,
  } = useListMyTeam({
    query: { queryKey: getListMyTeamQueryKey() },
  });

  const [q, setQ] = useState("");
  const [openClerkId, setOpenClerkId] = useState<string | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const matches = (p: RelationshipPerson) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return (
      p.name.toLowerCase().includes(needle) ||
      p.username.toLowerCase().includes(needle) ||
      (p.roleContext ?? "").toLowerCase().includes(needle) ||
      (p.serviceTitle ?? "").toLowerCase().includes(needle)
    );
  };

  // Per-skin bucketing lives in `lib/connectionTags.ts` so the
  // `PeopleModal` shown from the profile flow stays in lock step with
  // this screen.  See that helper for the classification rules.
  const buckets = useMemo(
    () => bucketRelationships(rels, companyKind, matches),
    [rels, companyKind, q],
  );

  const totalPeople =
    (rels?.core.length ?? 0) +
    (rels?.clients.length ?? 0) +
    (rels?.collaborators.length ?? 0);

  // Count of people that survived the search filter — used to swap the
  // role-based empty state for a "No matches" prompt when the user is
  // actively searching.
  const hasFilteredPeople =
    buckets.kind === "trade_pro"
      ? buckets.clients.length + buckets.outsideServices.length + buckets.friends.length > 0
      : buckets.kind === "facilities"
        ? buckets.friends.length > 0
        : buckets.tradePros.length + buckets.friends.length > 0;

  const topPad = Platform.OS === "web" ? 24 : insets.top + 12;
  const bottomPad = Platform.OS === "web" ? 34 + 90 : insets.bottom + 100;
  const isLoading = relsLoading || teamLoading;
  const isRefetching = relsRefetching || teamRefetching;
  const goInvite = () => router.push("/invite" as never);

  const onRefresh = () => {
    refetchRels();
    refetchTeam();
  };

  const onPersonMessagePress = (p: RelationshipPerson) => {
    const href = messageHrefFor({
      clerkId: p.clerkId,
      counterpartOutwardAccountId: p.counterpartOutwardAccountId ?? null,
      counterpartArchivedAt: p.counterpartArchivedAt ?? null,
    });
    if (!href) return;
    router.push(href as never);
  };

  const onTeammateMessagePress = (clerkId: string) => {
    const href = messageHrefFor({ clerkId });
    if (!href) return;
    router.push(href as never);
  };

  const renderPersonRow = (p: RelationshipPerson, keyPrefix: string) => {
    const isRetired = !!p.counterpartArchivedAt;
    const muted = isRetired ? 0.55 : 1;
    const line = composeLabelChipLine({
      roleContext: p.roleContext ?? null,
      serviceTitle: p.serviceTitle ?? null,
      onSiteIdentity: p.onSiteIdentity ?? null,
      onSiteIdentityOther: p.onSiteIdentityOther ?? null,
      chip: p.chip ?? null,
      chipOther: p.chipOther ?? null,
    });
    const subParts = [`@${p.username}`];
    if (line.label) subParts.push(line.label);
    if (line.chip) subParts.push(line.chip);
    return (
      <Pressable
        key={`${keyPrefix}-${p.id}`}
        onPress={isRetired ? undefined : () => setOpenClerkId(p.clerkId)}
        disabled={isRetired}
        accessibilityState={{ disabled: isRetired }}
        style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View
          style={[
            styles.avatar,
            { backgroundColor: colors.primary + "30", opacity: muted },
          ]}
        >
          {p.avatarUrl ? (
            <Image source={{ uri: p.avatarUrl }} style={styles.avatarImg} />
          ) : (
            <Text style={[styles.avatarText, { color: colors.primary }]}>
              {(p.name || "?")[0].toUpperCase()}
            </Text>
          )}
        </View>
        <View style={{ flex: 1, opacity: muted }}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
              {p.name}
            </Text>
            {isRetired ? (
              <View
                style={[
                  styles.retiredTag,
                  { borderColor: colors.border, backgroundColor: colors.muted },
                ]}
              >
                <Text style={[styles.retiredTagText, { color: colors.mutedForeground }]}>
                  No longer active
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {subParts.join(" · ")}
          </Text>
        </View>
        {/* #646 — Message affordance, mirrors the People sheet so the
            standalone My Team tab gets the same one-tap deep link to
            the inbox composer. Suppressed for retired counterparts via
            `messageHrefFor` returning null. */}
        {isRetired ? null : (
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              onPersonMessagePress(p);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Message ${p.name}`}
            hitSlop={6}
            style={({ pressed }) => [
              styles.messageBtn,
              {
                backgroundColor: colors.muted,
                borderColor: colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="message-circle" size={13} color={colors.foreground} />
            <Text style={[styles.messageBtnText, { color: colors.foreground }]}>
              Message
            </Text>
          </Pressable>
        )}
        {isRetired ? null : (
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        )}
      </Pressable>
    );
  };

  const renderSection = (title: string, rows: RelationshipPerson[], keyPrefix: string) => {
    if (rows.length === 0) return null;
    return (
      <View style={{ gap: 8 }} key={`section-${keyPrefix}`}>
        <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>{title}</Text>
        {rows.map((p) => renderPersonRow(p, keyPrefix))}
      </View>
    );
  };

  const renderCadenceSection = (
    title: string,
    rows: RelationshipPerson[],
    keyPrefix: string,
  ) => {
    if (rows.length === 0) return null;
    const { occasional, recurring } = splitByCadence(rows);
    return (
      <View style={{ gap: 10 }} key={`csection-${keyPrefix}`}>
        <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>{title}</Text>
        {occasional.length > 0 ? (
          <View style={{ gap: 6 }}>
            <Text style={[styles.subSectionHeader, { color: colors.mutedForeground }]}>
              Occasional
            </Text>
            {occasional.map((p) => renderPersonRow(p, `${keyPrefix}-occ`))}
          </View>
        ) : null}
        {recurring.length > 0 ? (
          <View style={{ gap: 6 }}>
            <Text style={[styles.subSectionHeader, { color: colors.mutedForeground }]}>
              Recurring
            </Text>
            {recurring.map((p) => renderPersonRow(p, `${keyPrefix}-rec`))}
          </View>
        ) : null}
      </View>
    );
  };

  const teamMembers = (team?.members ?? []).map((m) => ({
    memberClerkId: m.memberClerkId,
    name: m.name,
    username: m.username,
    avatarUrl: m.avatarUrl,
    role: m.role,
    status: m.status,
    chip: m.chip ?? null,
    chipOther: m.chipOther ?? null,
  }));

  const teamSection =
    companyKind === "trade_pro" || companyKind === "facilities" ? (
      <View style={{ gap: 8 }}>
        <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>
          {companyKind === "trade_pro" ? "Trade Pro Teammates" : "Facility Teammates"}
        </Text>
        {teamMembers.length > 0 ? (
          <TeamSection
            members={teamMembers}
            companyKind={companyKind}
            editable
            onManage={() => setManageOpen(true)}
            onMemberPress={(id) => setOpenClerkId(id)}
            onMemberMessage={onTeammateMessagePress}
          />
        ) : (
          <Pressable
            onPress={() => setManageOpen(true)}
            style={[
              styles.emptyCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Feather name="user-plus" size={16} color={colors.mutedForeground} />
            <Text style={[styles.emptyCardText, { color: colors.mutedForeground }]}>
              No teammates yet — tap to manage your team
            </Text>
          </Pressable>
        )}
      </View>
    ) : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad }]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground }]}>My Team</Text>
          <Pressable
            onPress={goInvite}
            accessibilityLabel="Invite a teammate"
            hitSlop={8}
            style={[
              styles.inviteBtn,
              { borderColor: colors.border, backgroundColor: colors.card },
            ]}
          >
            <Feather name="user-plus" size={14} color={colors.foreground} />
            <Text style={[styles.inviteText, { color: colors.foreground }]}>Invite</Text>
          </Pressable>
        </View>
        <View
          style={[
            styles.searchBox,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search people"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[
          { paddingHorizontal: 16, paddingTop: 8, paddingBottom: bottomPad, gap: 18 },
          totalPeople === 0 && (teamMembers.length === 0) && !isLoading
            ? { flex: 1 }
            : null,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        <TeamInvitesBanner />

        {totalPeople === 0 && teamMembers.length === 0 && !isLoading ? (
          <EmptyState
            icon="users"
            title="No people yet"
            description={
              companyKind === "trade_pro" || companyKind === "facilities"
                ? "Invite teammates and connect with clients to start building your roster."
                : "Connect with trade pros and friends to start building your roster."
            }
            actionLabel="Invite a teammate"
            onAction={goInvite}
          />
        ) : hasFilteredPeople === false && q.trim().length > 0 ? (
          <EmptyState
            icon="search"
            title="No matches"
            description="Try a different search."
          />
        ) : buckets.kind === "trade_pro" ? (
          <>
            {renderSection("Clients", buckets.clients, "clients")}
            {teamSection}
            {renderCadenceSection("Outside Services", buckets.outsideServices, "outside")}
            {renderSection("Friends & Collaborators", buckets.friends, "friends")}
          </>
        ) : buckets.kind === "facilities" ? (
          <>
            {teamSection}
            {renderSection("Friends & Collaborators", buckets.friends, "friends")}
          </>
        ) : (
          <>
            {renderCadenceSection("Trade Pros", buckets.tradePros, "trade")}
            {renderSection("Friends & Collaborators", buckets.friends, "friends")}
          </>
        )}
      </ScrollView>

      <ManageTeamModal visible={manageOpen} onClose={() => setManageOpen(false)} />

      <PublicProfileModal
        clerkId={openClerkId}
        visible={!!openClerkId}
        onClose={() => setOpenClerkId(null)}
        onServicePress={(service) => {
          setOpenClerkId(null);
          router.push({ pathname: "/find", params: { service } } as never);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
  inviteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  inviteText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },
  sectionHeader: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginLeft: 2,
  },
  subSectionHeader: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginLeft: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarText: { fontSize: 14, fontFamily: "Inter_700Bold" },
  name: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  retiredTag: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  retiredTagText: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.3 },
  messageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 30,
  },
  messageBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  emptyCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  emptyCardText: { fontSize: 13, fontFamily: "Inter_400Regular", flex: 1 },
});
