import React, { useMemo } from "react";
import {
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { resolveStorageUrl } from "@/lib/uploads";
import {
  bucketRelationships,
  composeLabelChipLine,
  splitByCadence,
} from "@/lib/connectionTags";
import { useProfile } from "@/lib/profile";
import {
  useListMyTeam,
  getListMyTeamQueryKey,
} from "@workspace/api-client-react";
import { TeamSection } from "@/components/TeamSection";
import type { RelationshipPerson } from "@workspace/api-client-react";

interface Props {
  visible: boolean;
  onClose: () => void;
  core: RelationshipPerson[];
  clients: RelationshipPerson[];
  collaborators: RelationshipPerson[];
  loading?: boolean;
  /** #643 — pair-aware tap: receivers may use the optional
   *  counterpartOutwardAccountId to target the exact skin pair when
   *  opening downstream sheets (e.g. so the public profile's Message
   *  button can pin the same outward account the row points at). */
  onPersonPress?: (clerkId: string, counterpartOutwardAccountId?: number | null) => void;
  /** #643 — open an inbox thread with the given person. */
  onMessagePress?: (person: RelationshipPerson) => void;
  /** #643 — open an inbox thread with a teammate (clerkId only). */
  onTeammateMessagePress?: (clerkId: string) => void;
}

/**
 * People sheet shown from the profile flow.
 *
 * #547 — the bucket layout here mirrors `app/(tabs)/my-team.tsx` so a
 * given person never appears under different headings depending on
 * where you opened them from.  See `bucketRelationships` in
 * `lib/connectionTags.ts` for the per-skin rules.
 */
export function PeopleModal({
  visible,
  onClose,
  core,
  clients,
  collaborators,
  loading,
  onPersonPress,
  onMessagePress,
  onTeammateMessagePress,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const { activeOutwardAccount } = useProfile();
  const outwardKind = activeOutwardAccount?.kind ?? null;
  const companyKind: "trade_pro" | "facilities" | null =
    outwardKind === "trade_pro"
      ? "trade_pro"
      : outwardKind === "facilities"
        ? "facilities"
        : null;

  const { data: team } = useListMyTeam({
    query: { queryKey: getListMyTeamQueryKey() },
  });
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

  const buckets = useMemo(
    () => bucketRelationships({ core, clients, collaborators }, companyKind),
    [core, clients, collaborators, companyKind],
  );

  const isEmpty =
    core.length === 0 &&
    clients.length === 0 &&
    collaborators.length === 0 &&
    teamMembers.length === 0;

  const teammateTitle =
    companyKind === "trade_pro"
      ? "Trade Pro Teammates"
      : companyKind === "facilities"
        ? "Facility Teammates"
        : null;

  const teamSection =
    teammateTitle && teamMembers.length > 0 ? (
      <View style={{ gap: 8 }}>
        <View style={{ paddingHorizontal: 4 }}>
          <Text style={[styles.groupTitle, { color: colors.foreground }]}>
            {teammateTitle}
          </Text>
        </View>
        <TeamSection
          members={teamMembers}
          companyKind={companyKind}
          onMemberPress={onPersonPress}
          onMemberMessage={onTeammateMessagePress}
        />
      </View>
    ) : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : insets.top + 8 },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={20} style={{ padding: 8 }}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>People</Text>
          <View style={{ width: 38 }} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        >
          {isEmpty ? (
            <Text style={[styles.empty, { color: colors.mutedForeground }]}>
              {loading
                ? "Loading…"
                : "No connections yet. People you share properties with will show up here."}
            </Text>
          ) : buckets.kind === "trade_pro" ? (
            <>
              <Group title="Clients" people={buckets.clients} colors={colors} onPress={onPersonPress} onMessage={onMessagePress} />
              {teamSection}
              <CadenceGroup
                title="Outside Services"
                people={buckets.outsideServices}
                colors={colors}
                onPress={onPersonPress}
                onMessage={onMessagePress}
              />
              <Group
                title="Friends & Collaborators"
                people={buckets.friends}
                colors={colors}
                onPress={onPersonPress}
                onMessage={onMessagePress}
              />
            </>
          ) : buckets.kind === "facilities" ? (
            <>
              {teamSection}
              <Group
                title="Friends & Collaborators"
                people={buckets.friends}
                colors={colors}
                onPress={onPersonPress}
                onMessage={onMessagePress}
              />
            </>
          ) : (
            <>
              <CadenceGroup
                title="Trade Pros"
                people={buckets.tradePros}
                colors={colors}
                onPress={onPersonPress}
                onMessage={onMessagePress}
              />
              <Group
                title="Friends & Collaborators"
                people={buckets.friends}
                colors={colors}
                onPress={onPersonPress}
                onMessage={onMessagePress}
              />
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function Group({
  title,
  people,
  colors,
  onPress,
  onMessage,
}: {
  title: string;
  people: RelationshipPerson[];
  colors: ReturnType<typeof useColors>;
  onPress?: (clerkId: string, counterpartOutwardAccountId?: number | null) => void;
  onMessage?: (person: RelationshipPerson) => void;
}) {
  if (people.length === 0) return null;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ paddingHorizontal: 4 }}>
        <Text style={[styles.groupTitle, { color: colors.foreground }]}>{title}</Text>
      </View>
      <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {people.map((p, idx) => (
          <PersonRow
            key={p.clerkId}
            person={p}
            colors={colors}
            isLast={idx === people.length - 1}
            onPress={onPress}
            onMessage={onMessage}
          />
        ))}
      </View>
    </View>
  );
}

function CadenceGroup({
  title,
  people,
  colors,
  onPress,
  onMessage,
}: {
  title: string;
  people: RelationshipPerson[];
  colors: ReturnType<typeof useColors>;
  onPress?: (clerkId: string, counterpartOutwardAccountId?: number | null) => void;
  onMessage?: (person: RelationshipPerson) => void;
}) {
  if (people.length === 0) return null;
  const { occasional, recurring } = splitByCadence(people);
  return (
    <View style={{ gap: 10 }}>
      <View style={{ paddingHorizontal: 4 }}>
        <Text style={[styles.groupTitle, { color: colors.foreground }]}>{title}</Text>
      </View>
      {occasional.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={[styles.subSectionHeader, { color: colors.mutedForeground }]}>
            Occasional
          </Text>
          <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {occasional.map((p, idx) => (
              <PersonRow
                key={p.clerkId}
                person={p}
                colors={colors}
                isLast={idx === occasional.length - 1}
                onPress={onPress}
                onMessage={onMessage}
              />
            ))}
          </View>
        </View>
      ) : null}
      {recurring.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={[styles.subSectionHeader, { color: colors.mutedForeground }]}>
            Recurring
          </Text>
          <View style={[styles.groupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {recurring.map((p, idx) => (
              <PersonRow
                key={p.clerkId}
                person={p}
                colors={colors}
                isLast={idx === recurring.length - 1}
                onPress={onPress}
                onMessage={onMessage}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function PersonRow({
  person,
  colors,
  isLast,
  onPress,
  onMessage,
}: {
  person: RelationshipPerson;
  colors: ReturnType<typeof useColors>;
  isLast: boolean;
  onPress?: (clerkId: string, counterpartOutwardAccountId?: number | null) => void;
  onMessage?: (person: RelationshipPerson) => void;
}) {
  const uri = resolveStorageUrl(person.avatarUrl ?? null);
  // When the counterpart skin has been retired (#340 / #363), keep the row
  // visible so prior threads/jobs stay reachable, but mute it visually and
  // disable the tap-through so the viewer can't try to message, invite, or
  // assign work to a profile that's no longer there.
  const isRetired = !!person.counterpartArchivedAt;
  const rowOpacity = isRetired ? 0.55 : 1;
  return (
    <Pressable
      onPress={
        isRetired
          ? undefined
          : () => onPress?.(person.clerkId, person.counterpartOutwardAccountId ?? null)
      }
      disabled={isRetired}
      accessibilityState={{ disabled: isRetired }}
      accessibilityLabel={
        isRetired
          ? `${person.name} (profile no longer active)`
          : person.name
      }
      style={[
        styles.row,
        {
          borderBottomColor: colors.border,
          borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={[styles.avatar, { backgroundColor: colors.muted, opacity: rowOpacity }]}>
        {uri ? (
          <Image source={{ uri }} style={styles.avatarImg} />
        ) : (
          <Text style={[styles.initial, { color: colors.mutedForeground }]}>
            {(person.name || "?").trim().charAt(0).toUpperCase()}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, opacity: rowOpacity }}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, { color: colors.foreground }]} numberOfLines={1}>
            {person.name}
          </Text>
          {isRetired ? (
            <View style={[styles.retiredTag, { borderColor: colors.border, backgroundColor: colors.muted }]}>
              <Text style={[styles.retiredTagText, { color: colors.mutedForeground }]}>
                No longer active
              </Text>
            </View>
          ) : null}
        </View>
        {/* #502 — Universal label + chip pattern. Render
              `Label · Chip` directly under the name. Falls back to
              roleContext for pre-#502 connections that haven't been
              tagged yet. */}
        <PersonLabelChip person={person} colors={colors} />
        {/* #503 — A connection without any active property assignment
              should read as "Connected — no active work" so the viewer
              understands they're a contact, not currently doing work. */}
        {person.hasActiveAssignment === false && !isRetired ? (
          <Text
            style={[styles.context, { color: colors.mutedForeground, marginTop: 2 }]}
            numberOfLines={1}
          >
            Connected — no active work
          </Text>
        ) : null}
      </View>
      {/* #643 — Message affordance. Separate, clearly-labeled control
          on the row in addition to the row's profile-tap behavior.
          Suppressed for retired counterpart skins so we never try to
          start a thread with a profile that no longer exists. */}
      {!isRetired && onMessage ? (
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            onMessage(person);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Message ${person.name}`}
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
      ) : null}
      <Text style={[styles.handle, { color: colors.mutedForeground, opacity: rowOpacity }]} numberOfLines={1}>
        @{person.username}
      </Text>
    </Pressable>
  );
}

function PersonLabelChip({
  person,
  colors,
}: {
  person: RelationshipPerson;
  colors: ReturnType<typeof useColors>;
}) {
  const { label, chip, chipHeart } = composeLabelChipLine({
    roleContext: person.roleContext,
    serviceTitle: person.serviceTitle ?? null,
    onSiteIdentity: person.onSiteIdentity ?? null,
    onSiteIdentityOther: person.onSiteIdentityOther ?? null,
    chip: person.chip ?? null,
    chipOther: person.chipOther ?? null,
  });
  if (!label && !chip) return null;
  return (
    <View style={styles.labelChipRow}>
      {label ? (
        <Text style={[styles.context, { color: colors.mutedForeground }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
      {label && chip ? (
        <Text style={[styles.context, { color: colors.mutedForeground }]}> · </Text>
      ) : null}
      {chip ? (
        <View style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.muted }]}>
          <Text style={[styles.chipText, { color: colors.foreground }]} numberOfLines={1}>
            {chip}
            {chipHeart ? " ♥" : ""}
          </Text>
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
  scroll: { padding: 16, gap: 20 },
  empty: { textAlign: "center", marginTop: 32, fontSize: 14, fontFamily: "Inter_400Regular" },
  groupTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  subSectionHeader: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginLeft: 4,
  },
  groupCard: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 4 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  initial: { fontSize: 16, fontFamily: "Inter_700Bold" },
  name: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  context: { fontSize: 12, fontFamily: "Inter_500Medium" },
  labelChipRow: { flexDirection: "row", alignItems: "center", marginTop: 2, flexWrap: "wrap", gap: 4 },
  chip: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.2 },
  handle: { fontSize: 12, fontFamily: "Inter_500Medium", maxWidth: 100 },
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
});
