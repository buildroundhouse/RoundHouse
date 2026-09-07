import React, { useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { useGetMyRelationships } from "@workspace/api-client-react";
import type { RelationshipPerson } from "@workspace/api-client-react";
import { PublicProfileModal } from "@/components/PublicProfileModal";
import { ConnectionTagModal } from "@/components/ConnectionTagModal";
import { EmptyState } from "@/components/EmptyState";
import { TopBarAccountIdentity } from "@/components/TopBarAvatar";
import { composeLabelChipLine } from "@/lib/connectionTags";
import { useProfile } from "@/lib/profile";

/**
 * Left lower-nav people surface, shaped to the active skin (#504).
 *
 *   - Trade Pro: a flat **Clients** list — Homeowners and Facility
 *     Managers who have hired this pro.
 *   - Facility Manager: **Outside Services** with Occasional /
 *     Recurring sub-buckets (lives here per the spec, NOT under
 *     My Team).
 *   - Homeowner: Friends & Collaborators (their Trade Pros bucket
 *     lives on the My Team tab).
 *
 * Headings normalize to "Friends & Collaborators" and "Outside
 * Services" everywhere they're shown.
 */
type Row =
  | { type: "header"; key: string; title: string }
  | { type: "subheader"; key: string; title: string }
  | { type: "person"; key: string; person: RelationshipPerson };

export default function ClientsScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { activeMode, activeOutwardAccount } = useProfile();
  const { data, isRefetching, refetch, isLoading } = useGetMyRelationships();
  const outwardKind = activeOutwardAccount?.kind ?? null;
  const companyKind: "trade_pro" | "facilities" | null =
    outwardKind === "trade_pro"
      ? "trade_pro"
      : outwardKind === "facilities"
        ? "facilities"
        : null;
  const [q, setQ] = useState("");
  const [openClerkId, setOpenClerkId] = useState<string | null>(null);
  const [taggingClient, setTaggingClient] = useState<RelationshipPerson | null>(null);

  const isProMode =
    activeMode?.kind === "trade_pro" || activeMode?.kind === "trade_pro_collab";

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
  const isOutsideService = (p: RelationshipPerson) =>
    p.classification === "outside_service_provider";

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const core = (data?.core ?? []).filter(matches);
    const clients = (data?.clients ?? []).filter(matches);
    const collabs = (data?.collaborators ?? []).filter(matches);
    const pushPeople = (key: string, people: RelationshipPerson[]) => {
      for (const p of people) out.push({ type: "person", key: `${key}-${p.id}`, person: p });
    };

    if (companyKind === "facilities") {
      // Facility Manager: this tab IS Outside Services. Split by cadence.
      const outside = [
        ...core.filter(isOutsideService),
        ...collabs.filter(isOutsideService),
        ...core.filter((p) => !isOutsideService(p)),
      ];
      const occasional = outside.filter((p) => p.cadence !== "recurring");
      const recurring = outside.filter((p) => p.cadence === "recurring");
      out.push({ type: "header", key: "h-outside", title: "Outside Services" });
      if (occasional.length > 0) {
        out.push({ type: "subheader", key: "sh-occ", title: "Occasional" });
        pushPeople("occ", occasional);
      }
      if (recurring.length > 0) {
        out.push({ type: "subheader", key: "sh-rec", title: "Recurring" });
        pushPeople("rec", recurring);
      }
      return out;
    }

    if (companyKind === "trade_pro") {
      out.push({ type: "header", key: "h-clients", title: "Clients" });
      pushPeople("clients", clients);
      return out;
    }

    // Homeowner — Trade Pros live on My Team, so this tab focuses on
    // Friends & Collaborators (clients are not a homeowner concept).
    out.push({ type: "header", key: "h-friends", title: "Friends & Collaborators" });
    pushPeople("friends", collabs);
    return out;
  }, [data, q, companyKind]);

  const totalPeople = rows.filter((r) => r.type === "person").length;
  const totalUnfiltered =
    (data?.core.length ?? 0) +
    (data?.clients.length ?? 0) +
    (data?.collaborators.length ?? 0);
  const isSearching = q.trim().length > 0;
  const topPad = Platform.OS === "web" ? 24 : insets.top + 12;
  const bottomPad = Platform.OS === "web" ? 34 + 90 : insets.bottom + 100;

  const noMatches = isSearching && totalUnfiltered > 0 && totalPeople === 0;
  const emptyTitle = noMatches
    ? "No matches"
    : companyKind === "facilities"
      ? "No outside services yet"
      : companyKind === "trade_pro"
        ? "No clients yet"
        : "No friends or collaborators yet";
  const emptyDescription = noMatches
    ? "Try a different search."
    : companyKind === "facilities"
      ? "Connect with vendors and trade pros and they'll appear here."
      : companyKind === "trade_pro"
        ? "Home and Facility Management accounts who hire you will appear here."
        : "Connect with friends and collaborators and they'll appear here.";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad }]}>
        <View style={styles.headerTop}>
          <TopBarAccountIdentity />
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

      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={[
          { paddingHorizontal: 16, paddingTop: 8, paddingBottom: bottomPad, gap: 6 },
          totalPeople === 0 ? { flex: 1 } : null,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
        renderItem={({ item }) => {
          if (item.type === "header") {
            return (
              <Text style={[styles.groupHeader, { color: colors.mutedForeground }]}>
                {item.title}
              </Text>
            );
          }
          if (item.type === "subheader") {
            return (
              <Text style={[styles.subGroupHeader, { color: colors.mutedForeground }]}>
                {item.title}
              </Text>
            );
          }
          const p = item.person;
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
          const isClientRow = p.connectionKind === "client";
          // #520 — pros tag themselves per client. Show the composed
          // `Service · OnSiteIdentity` line when set, and expose a small
          // "Tag" affordance on each Client row so the pro can pick how
          // they show up under their name on this client's profile.
          const showSelfTag = isProMode && isClientRow && !isRetired && p.connectionId != null;
          const selfTagComposed = composeLabelChipLine({
            roleContext: null,
            serviceTitle: p.serviceTitle ?? null,
            onSiteIdentity: p.onSiteIdentity ?? null,
            onSiteIdentityOther: p.onSiteIdentityOther ?? null,
          });
          const composedLine = [selfTagComposed.label, selfTagComposed.chip]
            .filter(Boolean)
            .join(" · ");
          const hasSelfTag = showSelfTag && composedLine.length > 0;
          return (
            <Pressable
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
                  <Text
                    style={[styles.name, { color: colors.foreground }]}
                    numberOfLines={1}
                  >
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
                {hasSelfTag ? (
                  <Text
                    style={[styles.selfTagPreview, { color: colors.foreground }]}
                    numberOfLines={1}
                  >
                    You show up as: {composedLine}
                  </Text>
                ) : null}
              </View>
              {showSelfTag ? (
                <Pressable
                  onPress={(e) => {
                    e.stopPropagation();
                    setTaggingClient(p);
                  }}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={
                    hasSelfTag
                      ? `Change how you show up for ${p.name}`
                      : `Tag yourself for ${p.name}`
                  }
                  style={({ pressed }) => [
                    styles.tagBtn,
                    {
                      borderColor: colors.border,
                      backgroundColor: hasSelfTag ? colors.muted : "transparent",
                      opacity: pressed ? 0.6 : 1,
                    },
                  ]}
                >
                  <Feather name="tag" size={12} color={colors.foreground} />
                  <Text style={[styles.tagBtnText, { color: colors.foreground }]}>
                    {hasSelfTag ? "Edit tag" : "Tag"}
                  </Text>
                </Pressable>
              ) : null}
              {isRetired ? null : (
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          !isLoading ? (
            <EmptyState
              icon={noMatches ? "search" : "users"}
              title={emptyTitle}
              description={emptyDescription}
            />
          ) : null
        }
      />

      <PublicProfileModal
        clerkId={openClerkId}
        visible={!!openClerkId}
        onClose={() => setOpenClerkId(null)}
        onServicePress={(service) => {
          setOpenClerkId(null);
          router.push({ pathname: "/find", params: { service } } as never);
        }}
      />

      <ConnectionTagModal
        visible={!!taggingClient}
        onClose={() => setTaggingClient(null)}
        connectionId={taggingClient?.connectionId ?? null}
        mode="pro-self-tag"
        subjectName={taggingClient?.name}
        initial={{
          serviceTitle: taggingClient?.serviceTitle ?? null,
          onSiteIdentity: taggingClient?.onSiteIdentity ?? null,
          onSiteIdentityOther: taggingClient?.onSiteIdentityOther ?? null,
        }}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ["/api/users/me/relationships"] });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingBottom: 8, gap: 10 },
  headerTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  title: { fontSize: 28, fontFamily: "Inter_700Bold" },
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
  groupHeader: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginTop: 14,
    marginBottom: 4,
    marginLeft: 2,
  },
  subGroupHeader: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: 6,
    marginBottom: 2,
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
  selfTagPreview: { fontSize: 11, fontFamily: "Inter_500Medium", marginTop: 3 },
  tagBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  tagBtnText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
});
