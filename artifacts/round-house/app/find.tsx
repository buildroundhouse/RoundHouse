import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  useSearchUsers,
  useSearchBusinesses,
  useSearchSuccessStories,
  type SearchUserResult,
  type BusinessSearchResult,
  type SuccessStory,
  type UserModeKind,
} from "@workspace/api-client-react";
import { PublicProfileModal } from "@/components/PublicProfileModal";
import { UserSearchModal } from "@/components/UserSearchModal";
import { BusinessInviteModal } from "@/components/BusinessInviteModal";
import { BusinessesMapView } from "@/components/BusinessesMapView";
import { resolveStorageUrl } from "@/lib/uploads";
import { MODE_LABELS } from "@/lib/intake-schemas";
import { kindLabelForName } from "@/lib/account-display";

type InviteState =
  | { open: false }
  | { open: true; kind: "people"; query: string; service?: string }
  | { open: true; kind: "business"; name: string };

// Fixed 14-category taxonomy. Order matters — chips render in this order.
// Server-side (artifacts/api-server/src/routes/discovery.ts) keeps the
// authoritative key→synonyms map; the chip labels here must match the keys.
const STORY_CATEGORIES: string[] = [
  "Designer / Architect",
  "Housekeeper",
  "Contractor",
  "Handyman",
  "Electrician",
  "Plumber",
  "Landscaper",
  "Tree Trimmer",
  "Roofer",
  "Pest Control",
  "Security / IT",
  "Pool",
  "HVAC",
  "Home Staging",
];

// Mirror of the server's STORY_CATEGORY_TERMS used only to display the
// matched canonical category on a story row. Keep in sync with
// artifacts/api-server/src/routes/discovery.ts.
const CATEGORY_TERMS_CLIENT: Record<string, string[]> = {
  "Designer / Architect": ["designer", "architect", "interior design"],
  Housekeeper: ["housekeeper", "house keeping", "house cleaning", "cleaner", "maid"],
  Contractor: ["contractor", "general contractor", "gc", "remodel"],
  Handyman: ["handyman", "handy man", "handyperson"],
  Electrician: ["electrician", "electrical"],
  Plumber: ["plumber", "plumbing"],
  Landscaper: ["landscaper", "landscaping", "lawn", "yard"],
  "Tree Trimmer": ["tree trimmer", "tree", "arborist"],
  Roofer: ["roofer", "roofing", "roof"],
  "Pest Control": ["pest control", "exterminator", "pest"],
  "Security / IT": ["security", "alarm", "cctv", "camera", "it ", "network", "wifi"],
  Pool: ["pool"],
  HVAC: ["hvac", "ac ", "air conditioning", "heating", "furnace", "heat pump"],
  "Home Staging": ["home staging", "staging", "stager"],
};

const ROLE_TAG: Record<UserModeKind, string> = {
  trade_pro: "Trade Pro",
  home: "Home",
  facilities: "Facility Management",
  trade_pro_teammate: "Trade Teammate",
  facilities_teammate: "Facility Teammate",
  home_teammate: "Home Teammate",
  trade_pro_collab: "Collaborator",
  facilities_collab: "Collaborator",
  collab: "Collaborator",
};

function useDebounced<T>(value: T, delay = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export default function FindScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ service?: string; tab?: string }>();
  const initialService = typeof params.service === "string" ? params.service : "";
  const initialTab = typeof params.tab === "string" ? params.tab : "";

  // #636 — People search returns one row per outward-account skin.
  // Track the tapped skin's outwardAccountId alongside the clerkId so
  // PublicProfileModal → Connect → auto-letter targets the operator
  // skin the user actually picked, not whichever skin happens to be
  // the owner's current default.
  const [openTarget, setOpenTarget] = useState<{
    clerkId: string;
    outwardAccountId: number | null;
  } | null>(null);
  const openClerkId = openTarget?.clerkId ?? null;
  const setOpenClerkId = (clerkId: string | null) =>
    setOpenTarget(clerkId ? { clerkId, outwardAccountId: null } : null);
  const [invite, setInvite] = useState<InviteState>(
    initialService
      ? { open: true, kind: "people", query: "", service: initialService }
      : { open: false },
  );
  // When the caller deep-links with ?tab=people (Add Mode → Find
  // Collaborators), focus the Find People bar so the user lands directly
  // on the right entry point.
  const peopleInputRef = useRef<TextInput | null>(null);
  const [highlightPeopleBar, setHighlightPeopleBar] = useState(initialTab === "people");
  useEffect(() => {
    if (initialTab !== "people") return;
    const t = setTimeout(() => peopleInputRef.current?.focus(), 250);
    const off = setTimeout(() => setHighlightPeopleBar(false), 2400);
    return () => {
      clearTimeout(t);
      clearTimeout(off);
    };
  }, [initialTab]);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // Bar 1 — find people
  const [peopleQ, setPeopleQ] = useState("");
  const peopleQDeb = useDebounced(peopleQ.trim());

  // Bar 2 — find a trade pro
  const [bizQ, setBizQ] = useState("");
  const bizQDeb = useDebounced(bizQ.trim());
  const [bizView, setBizView] = useState<"list" | "map">("list");

  // Bar 3 — success stories (free text + category chip)
  const [storyQ, setStoryQ] = useState("");
  const storyQDeb = useDebounced(storyQ.trim());
  const [storyCategory, setStoryCategory] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmation) return;
    const t = setTimeout(() => setConfirmation(null), 4000);
    return () => clearTimeout(t);
  }, [confirmation]);

  const peopleResults = useSearchUsers(
    { q: peopleQDeb },
    {
      query: {
        enabled: peopleQDeb.length > 0,
        queryKey: ["/api/users/search", peopleQDeb],
      },
    },
  );
  const bizResults = useSearchBusinesses(
    { name: bizQDeb },
    {
      query: {
        enabled: bizQDeb.length > 0,
        queryKey: ["/api/businesses/search", "", "", bizQDeb],
      },
    },
  );
  const storyResults = useSearchSuccessStories(
    {
      ...(storyQDeb ? { q: storyQDeb } : {}),
      ...(storyCategory ? { category: storyCategory } : {}),
    },
    {
      query: {
        enabled: storyQDeb.length > 0 || !!storyCategory,
        queryKey: ["/api/success-stories/search", storyQDeb, storyCategory ?? ""],
      },
    },
  );

  const topPad = Platform.OS === "web" ? 16 : insets.top + 8;
  const bottomPad = Platform.OS === "web" ? 60 : insets.bottom + 24;

  const peopleData = (peopleResults.data?.users ?? []) as SearchUserResult[];
  const bizData = (bizResults.data?.businesses ?? []) as BusinessSearchResult[];
  const storyData = (storyResults.data?.stories ?? []) as SuccessStory[];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: topPad, borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Close find"
          hitSlop={12}
          style={styles.iconBtn}
        >
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>Find</Text>
        <Pressable
          onPress={() => router.push("/invites" as never)}
          accessibilityLabel="View my invites"
          hitSlop={12}
          style={styles.iconBtn}
        >
          <Feather name="mail" size={18} color={colors.foreground} />
        </Pressable>
      </View>

      {confirmation ? (
        <View
          style={[
            styles.confirmation,
            { backgroundColor: colors.scoreBackground, borderColor: colors.border },
          ]}
        >
          <Feather name="check-circle" size={16} color={colors.primary} />
          <Text
            style={[styles.confirmationText, { color: colors.foreground }]}
            numberOfLines={2}
          >
            {confirmation}
          </Text>
          <Pressable onPress={() => setConfirmation(null)} hitSlop={8}>
            <Feather name="x" size={14} color={colors.mutedForeground} />
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomPad }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Bar 1 — Find people */}
        <View
          style={
            highlightPeopleBar
              ? { borderColor: colors.primary, borderWidth: 2, borderRadius: 14, marginHorizontal: 8, padding: 4 }
              : undefined
          }
        >
        <Section
          colors={colors}
          label="Find people"
          icon="users"
          input={
            <SearchInput
              value={peopleQ}
              onChange={setPeopleQ}
              placeholder="Name or @username — homeowners, pros, commercial, collaborators"
              colors={colors}
              inputRef={peopleInputRef}
            />
          }
        >
          {peopleQDeb.length === 0 ? null : peopleResults.isFetching && peopleData.length === 0 ? (
            <Loading colors={colors} />
          ) : peopleData.length === 0 ? (
            <NoResults
              colors={colors}
              body="No people match that search yet."
              actionLabel="Invite a person"
              actionIcon="user-plus"
              onAction={() => setInvite({ open: true, kind: "people", query: peopleQDeb })}
            />
          ) : (
            <View style={styles.resultList}>
              {peopleData.map((p) => (
                <PersonRow
                  key={`${p.id}:${p.outwardAccountId ?? "none"}`}
                  user={p}
                  onPress={() =>
                    setOpenTarget({
                      clerkId: p.clerkId,
                      outwardAccountId: p.outwardAccountId ?? null,
                    })
                  }
                  colors={colors}
                />
              ))}
            </View>
          )}
        </Section>
        </View>

        {/* Bar 2 — Find a trade pro */}
        <Section
          colors={colors}
          label="Find a trade pro"
          icon="briefcase"
          input={
            <SearchInput
              value={bizQ}
              onChange={setBizQ}
              placeholder="Business name or owner name"
              autoCapitalize="words"
              colors={colors}
            />
          }
        >
          {bizQDeb.length === 0 ? null : bizResults.isFetching && bizData.length === 0 ? (
            <Loading colors={colors} />
          ) : bizData.length === 0 ? (
            <NoResults
              colors={colors}
              body="No businesses match that search yet."
              actionLabel="Invite a business"
              actionIcon="briefcase"
              onAction={() => setInvite({ open: true, kind: "business", name: bizQDeb })}
            />
          ) : (
            <>
              <View style={styles.viewToggleRow}>
                <ViewToggleBtn
                  label="List"
                  icon="list"
                  active={bizView === "list"}
                  onPress={() => setBizView("list")}
                  colors={colors}
                />
                <ViewToggleBtn
                  label="Map"
                  icon="map"
                  active={bizView === "map"}
                  onPress={() => setBizView("map")}
                  colors={colors}
                />
              </View>
              {bizView === "map" ? (
                <View style={styles.mapWrap}>
                  <BusinessesMapView
                    businesses={bizData}
                    onOpen={(clerkId) => setOpenClerkId(clerkId)}
                    bottomPad={0}
                  />
                </View>
              ) : (
                <View style={styles.resultList}>
                  {bizData.map((b) => (
                    <BusinessRow
                      key={b.id}
                      business={b}
                      onPress={() => setOpenClerkId(b.clerkId)}
                      colors={colors}
                    />
                  ))}
                </View>
              )}
            </>
          )}
        </Section>

        {/* Bar 3 — Success Stories */}
        <Section
          colors={colors}
          label="Success Stories"
          icon="award"
          input={
            <SearchInput
              value={storyQ}
              onChange={setStoryQ}
              placeholder="Search stories — pick a category below or type a keyword"
              colors={colors}
            />
          }
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipStrip}
          >
            {STORY_CATEGORIES.map((cat) => {
              const active = storyCategory === cat;
              return (
                <Pressable
                  key={cat}
                  onPress={() => setStoryCategory(active ? null : cat)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${cat} category${active ? ", selected" : ""}`}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? colors.foreground : colors.card,
                      borderColor: active ? colors.foreground : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: active ? colors.background : colors.foreground },
                    ]}
                  >
                    {cat}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {storyQDeb.length === 0 && !storyCategory ? null : storyResults.isFetching &&
            storyData.length === 0 ? (
            <Loading colors={colors} />
          ) : storyData.length === 0 ? (
            <NoResults
              colors={colors}
              body={
                storyCategory
                  ? `No ${storyCategory} stories yet. Try a different category or keyword.`
                  : "No stories match that keyword. Try broadening it or pick a category."
              }
            />
          ) : (
            <View style={styles.resultList}>
              {storyData.map((s) => (
                <StoryRow
                  key={s.id}
                  story={s}
                  onPress={() => {
                    // #258 stacked story view hasn't shipped — fall back to
                    // the source work log's property page so the searcher
                    // can see the job in context.
                    if (s.propertyId != null) {
                      router.push(`/property/${s.propertyId}`);
                    } else if (s.pro?.clerkId) {
                      setOpenClerkId(s.pro.clerkId);
                    }
                  }}
                  colors={colors}
                />
              ))}
            </View>
          )}
        </Section>
      </ScrollView>

      <PublicProfileModal
        visible={openClerkId !== null}
        clerkId={openClerkId}
        counterpartOutwardAccountId={openTarget?.outwardAccountId ?? null}
        onClose={() => setOpenTarget(null)}
        onServicePress={(service) => {
          setOpenTarget(null);
          setInvite({ open: true, kind: "people", query: "", service });
        }}
      />

      <UserSearchModal
        visible={invite.open && invite.kind === "people"}
        onClose={() => setInvite({ open: false })}
        onUserPress={(id) => {
          setInvite({ open: false });
          setOpenClerkId(id);
        }}
        initialQuery={invite.open && invite.kind === "people" ? invite.query : ""}
        initialService={
          invite.open && invite.kind === "people" ? invite.service ?? "" : ""
        }
        onInviteSent={(name) => {
          setConfirmation(`Invite sent to ${name}.`);
          setInvite({ open: false });
        }}
      />

      <BusinessInviteModal
        visible={invite.open && invite.kind === "business"}
        onClose={() => setInvite({ open: false })}
        initialName={invite.open && invite.kind === "business" ? invite.name : ""}
        onInviteSent={(label) =>
          setConfirmation(`Invite sent to ${label}.`)
        }
      />
    </View>
  );
}

function Section({
  colors,
  label,
  icon,
  input,
  children,
}: {
  colors: ReturnType<typeof useColors>;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  input: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionWrap}>
      <View style={styles.sectionHeader}>
        <Feather name={icon} size={14} color={colors.mutedForeground} />
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
          {label}
        </Text>
      </View>
      {input}
      {children}
    </View>
  );
}

function ViewToggleBtn({
  label,
  icon,
  active,
  onPress,
  colors,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${label} view${active ? ", selected" : ""}`}
      style={[
        styles.viewToggleBtn,
        {
          backgroundColor: active ? colors.foreground : colors.card,
          borderColor: active ? colors.foreground : colors.border,
        },
      ]}
    >
      <Feather
        name={icon}
        size={14}
        color={active ? colors.background : colors.foreground}
      />
      <Text
        style={[
          styles.viewToggleText,
          { color: active ? colors.background : colors.foreground },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SearchInput({
  value,
  onChange,
  placeholder,
  autoCapitalize,
  colors,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoCapitalize?: "none" | "words";
  colors: ReturnType<typeof useColors>;
  inputRef?: React.MutableRefObject<TextInput | null>;
}) {
  return (
    <View
      style={[
        styles.searchRow,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Feather name="search" size={16} color={colors.mutedForeground} />
      <TextInput
        ref={(r) => {
          if (inputRef) inputRef.current = r;
        }}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize={autoCapitalize ?? "none"}
        autoCorrect={false}
        style={[styles.searchInput, { color: colors.foreground }]}
        returnKeyType="search"
      />
      {value.length > 0 ? (
        <Pressable onPress={() => onChange("")} hitSlop={8}>
          <Feather name="x-circle" size={16} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
    </View>
  );
}

function PersonRow({
  user,
  onPress,
  colors,
}: {
  user: SearchUserResult;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const avatarUri = resolveStorageUrl(user.avatarUrl ?? null);
  const tag = user.activeModeKind ? ROLE_TAG[user.activeModeKind] : null;
  // #620: suppress the kind suffix when the displayed name already
  // contains every word of it (e.g. name "My Home" + label "My Home", or
  // name "Beach Home" + label "Home") so the row doesn't repeat the same
  // words. Partial overlaps (e.g. "Smith Home" vs. "My Home") still render.
  const fullLabel = user.activeModeKind
    ? kindLabelForName(user.name, MODE_LABELS[user.activeModeKind] ?? null)
    : null;
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={[styles.avatar, { backgroundColor: colors.primary + "26" }]}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
        ) : (
          <Text style={[styles.avatarText, { color: colors.primary }]}>
            {(user.name || "?")[0].toUpperCase()}
          </Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.rowTitleLine}>
          <Text
            style={[styles.rowName, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {user.name}
          </Text>
          {tag ? (
            <View
              style={[
                styles.roleTag,
                { backgroundColor: colors.muted, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.roleTagText, { color: colors.mutedForeground }]}>
                {tag}
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.rowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
          @{user.username}
          {fullLabel && fullLabel !== tag ? ` · ${fullLabel}` : ""}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

function BusinessRow({
  business,
  onPress,
  colors,
}: {
  business: BusinessSearchResult;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const avatarUri = resolveStorageUrl(business.avatarUrl ?? null);
  const titleText = business.companyName ?? business.name;
  const subBits: string[] = [];
  if (business.tradeLabel) subBits.push(business.tradeLabel);
  if (business.primaryZip) subBits.push(business.primaryZip);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={[styles.avatar, { backgroundColor: colors.muted }]}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatarImg} />
        ) : (
          <Feather name="briefcase" size={16} color={colors.mutedForeground} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowName, { color: colors.foreground }]} numberOfLines={1}>
          {titleText}
        </Text>
        {business.companyName && business.name ? (
          <Text
            style={[styles.rowSub, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {business.name}
            {subBits.length > 0 ? ` · ${subBits.join(" · ")}` : ""}
          </Text>
        ) : subBits.length > 0 ? (
          <Text
            style={[styles.rowSub, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {subBits.join(" · ")}
          </Text>
        ) : (
          <Text
            style={[styles.rowSub, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            @{business.username}
          </Text>
        )}
      </View>
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

// Map a story's raw service tag to one of the 14 canonical category labels
// shown on the chip strip. Falls back to the raw tag when nothing matches.
function canonicalCategoryFor(serviceTag: string | null | undefined): string | null {
  if (!serviceTag) return null;
  const t = serviceTag.toLowerCase();
  for (const cat of STORY_CATEGORIES) {
    for (const term of CATEGORY_TERMS_CLIENT[cat] ?? []) {
      if (t.includes(term)) return cat;
    }
  }
  return serviceTag;
}

function StoryRow({
  story,
  onPress,
  colors,
}: {
  story: SuccessStory;
  onPress?: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const photoUri = resolveStorageUrl(story.photoUrl ?? null);
  const proName = story.pro?.companyName || story.pro?.name || "Pro";
  const categoryLabel = canonicalCategoryFor(story.serviceTag);
  const blurb = story.blurb ?? story.headline;
  const date = new Date(story.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.storyRow, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <View style={[styles.storyThumb, { backgroundColor: colors.muted }]}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.storyThumbImg} />
        ) : (
          <Feather name="award" size={18} color={colors.mutedForeground} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={[styles.rowName, { color: colors.foreground }]}
          numberOfLines={2}
        >
          {blurb}
        </Text>
        <Text style={[styles.rowSub, { color: colors.mutedForeground }]} numberOfLines={1}>
          {proName}
          {categoryLabel ? ` · ${categoryLabel}` : ""}
          {` · ${date}`}
        </Text>
      </View>
    </Pressable>
  );
}

function NoResults({
  colors,
  body,
  actionLabel,
  actionIcon,
  onAction,
}: {
  colors: ReturnType<typeof useColors>;
  body: string;
  actionLabel?: string;
  actionIcon?: keyof typeof Feather.glyphMap;
  onAction?: () => void;
}) {
  return (
    <View style={[styles.noResults, { borderColor: colors.border }]}>
      <Text style={[styles.noResultsText, { color: colors.mutedForeground }]}>
        {body}
      </Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={[styles.inviteBtn, { backgroundColor: colors.primary }]}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          {actionIcon ? (
            <Feather name={actionIcon} size={13} color={colors.primaryForeground} />
          ) : null}
          <Text
            style={[styles.inviteBtnText, { color: colors.primaryForeground }]}
          >
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Loading({ colors }: { colors: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.loadingRow}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  sectionWrap: {
    paddingHorizontal: 16,
    paddingTop: 18,
    gap: 8,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: 2,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: "Inter_400Regular", padding: 0 },
  chipStrip: {
    paddingVertical: 6,
    paddingRight: 4,
    gap: 6,
    flexDirection: "row",
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 6,
  },
  chipText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  resultList: { gap: 8, marginTop: 4 },
  viewToggleRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  viewToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  viewToggleText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  mapWrap: { height: 320, marginTop: 8, borderRadius: 12, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  rowName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  rowSub: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  roleTag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  roleTagText: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.4,
    textTransform: "uppercase",
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
  storyRow: {
    flexDirection: "row",
    gap: 12,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  storyThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  storyThumbImg: { width: "100%", height: "100%" },
  noResults: {
    marginTop: 4,
    padding: 14,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    gap: 10,
  },
  noResultsText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 19,
  },
  inviteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  inviteBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  loadingRow: { paddingVertical: 18, alignItems: "center" },
  confirmation: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  confirmationText: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
});
