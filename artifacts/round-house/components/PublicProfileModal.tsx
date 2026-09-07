import React, { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
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
import { useQueryClient } from "@tanstack/react-query";
import { useColors } from "@/hooks/useColors";
import { displayServiceName } from "@/lib/serviceCategories";
import { resolveStorageUrl } from "@/lib/uploads";
import { MODE_LABELS } from "@/lib/intake-schemas";
import { kindLabelForName } from "@/lib/account-display";
import {
  useGetUserById,
  useGetUserTeam,
  getGetUserTeamQueryKey,
  useConnectToUser,
  useDisconnectFromUser,
  useListSharedEntitiesWithUser,
  type ConnectionKind,
  type UserModeKind,
} from "@workspace/api-client-react";
import { ConnectionTagModal } from "@/components/ConnectionTagModal";
import { ConnectionKindChooser } from "@/components/ConnectionKindChooser";
import { cadenceLabel, composeLabelChipLine } from "@/lib/connectionTags";
import { TeamSection } from "@/components/TeamSection";
import { StackedPhotoTimeline } from "@/components/StackedPhotoTimeline";
import { ShareRoundHousePill } from "@/components/ShareRoundHousePill";
import { ShareRoundHouseModal } from "@/components/ShareRoundHouseModal";
import { useRouter } from "expo-router";
import { useProfile } from "@/lib/profile";
import { getModeAccent } from "@/lib/modeAccent";
import { messageHrefFor } from "@/lib/messageTarget";

interface Props {
  visible: boolean;
  clerkId: string | null;
  onClose: () => void;
  onServicePress?: (service: string) => void;
  /**
   * #643 — When the modal is opened from a relationship row tied to a
   * specific counterpart skin, pass that outward-account id so the
   * Message button targets the same skin pair instead of falling back
   * to the recipient's currently-active outward account.
   */
  counterpartOutwardAccountId?: number | null;
}

const TRADE_LABELS: Record<string, string> = {
  general: "General contractor",
  electrician: "Electrician",
  plumber: "Plumber",
  hvac: "HVAC",
  carpenter: "Carpenter / finish",
  painter: "Painter",
  landscaper: "Landscaper",
  cleaner: "Cleaner",
  handyman: "Handyman",
  other: "Trade pro",
};

const EXPERIENCE_LABELS: Record<string, string> = {
  "<2": "Less than 2 years",
  "2-5": "2–5 years",
  "5-10": "5–10 years",
  "10+": "10+ years",
  "<1": "Less than 1 year",
  "1-3": "1–3 years",
  "3-7": "3–7 years",
  "7+": "7+ years",
};

const KIND_LABEL: Record<ConnectionKind, string> = {
  client: "Client",
  core: "Core",
  collaborator: "Collaborator",
};

export function PublicProfileModal({
  visible,
  clerkId,
  onClose,
  onServicePress,
  counterpartOutwardAccountId,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [storiesService, setStoriesService] = useState<string | null>(null);
  const [storiesOpen, setStoriesOpen] = useState(false);
  // Scroll-restore: remember where the user was when they tapped a chip so
  // closing the stories modal returns them to the same chip in view.
  const profileScrollRef = useRef<ScrollView>(null);
  const lastScrollY = useRef(0);
  const savedScrollY = useRef<number | null>(null);

  // #671 — When the caller opened this modal from a row tied to a
  // specific outward-account skin, ask the API for that skin's public
  // face so we can render a header chip identifying it. We also key
  // the cache by the OA id so two skins of the same person don't share
  // a cache entry — the header chip would otherwise stick to whichever
  // skin loaded first.
  const oaParams =
    counterpartOutwardAccountId != null
      ? { outwardAccountId: counterpartOutwardAccountId }
      : undefined;
  const queryKey = clerkId
    ? [`/api/users/${clerkId}`, counterpartOutwardAccountId ?? "self"]
    : ["/api/users/none"];
  const { data, isFetching } = useGetUserById(clerkId ?? "", oaParams, {
    query: { enabled: visible && !!clerkId, queryKey },
  });

  const teamQueryKey = clerkId ? getGetUserTeamQueryKey(clerkId) : ["userTeam", "none"];
  const { data: teamData } = useGetUserTeam(clerkId ?? "", {
    query: { enabled: visible && !!clerkId, queryKey: teamQueryKey },
  });

  // "Shared: …" — entities both viewer and target are approved members of.
  // Closes the loop on the entity-only paradigm: when the visitor accepted
  // an invite into a property the host owns, the host's view of the
  // visitor's profile names that property right here, instead of
  // silently treating the connection as if it didn't exist.
  const { data: sharedData } = useListSharedEntitiesWithUser(clerkId ?? "", {
    query: {
      enabled: visible && !!clerkId,
      queryKey: [`/api/users/${clerkId ?? ""}/shared-entities`],
    },
  });
  const sharedEntities = sharedData?.entities ?? [];

  const connect = useConnectToUser();
  const disconnect = useDisconnectFromUser();
  // #501 follow-up: surface team-up-request errors (esp. 409
  // `team_up_pending`) inline so the user gets actionable feedback
  // instead of a silent no-op when they re-tap Connect.
  const [connectError, setConnectError] = useState<string | null>(null);

  const profile = data;
  const user = profile?.user;
  const intake = (profile?.intakeSnapshot ?? {}) as Record<string, unknown>;
  const connection = profile?.connection ?? null;
  const myReverseConnection = profile?.myReverseConnection ?? null;
  const isSelf = profile?.isSelf ?? false;

  const router = useRouter();
  const { activeMode } = useProfile();
  const [tagModalOpen, setTagModalOpen] = useState(false);
  // #521 — Separate modal state for the collaborator-self-tag affordance,
  // since it patches the *reciprocal* row (target → viewer), not the
  // viewer-owned row that drives the existing classify-pro modal.
  const [chipModalOpen, setChipModalOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const trade = useMemo(() => {
    const t = typeof intake.trade === "string" ? intake.trade : null;
    return t ? TRADE_LABELS[t] ?? t.charAt(0).toUpperCase() + t.slice(1) : null;
  }, [intake.trade]);
  const company = typeof intake.companyName === "string" ? (intake.companyName as string) : "";
  const region = typeof intake.region === "string" ? (intake.region as string) : "";
  const primaryZip = typeof intake.primaryZip === "string" ? (intake.primaryZip as string) : "";
  const additionalZips = useMemo(() => {
    const raw = intake.additionalZips;
    if (Array.isArray(raw)) {
      return raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    }
    if (typeof raw === "string") {
      return raw
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return [];
  }, [intake.additionalZips]);
  const zipsLine = [primaryZip, ...additionalZips].filter(Boolean).join(", ");
  const experience = useMemo(() => {
    const e = typeof intake.experience === "string" ? intake.experience : null;
    return e ? EXPERIENCE_LABELS[e] ?? e : null;
  }, [intake.experience]);

  // #620: when the user's name already contains every word of the kind
  // label (e.g. a "My Home" profile whose mode label is also "My Home"),
  // suppress the redundant pill so we don't render the same words twice.
  // Partial overlaps still render the label. Trade pros keep their
  // specific trade label since it carries info beyond the name.
  const modeLabel = profile?.activeModeKind
    ? kindLabelForName(user?.name, MODE_LABELS[profile.activeModeKind as UserModeKind])
    : null;
  const role = trade ?? modeLabel ?? null;
  // #678 — Prefer the picked skin's brand avatar over the underlying
  // owner's personal avatar. For an operator skin (e.g. a Game Room
  // Admin) the visitor expects to see the company logo as the hero,
  // not the owner's headshot. Falls back to the owner's avatar when
  // no skin was picked or the skin hasn't uploaded its own image. We
  // pass `updatedAt: null` for the OA path because the OA's signed
  // URL carries its own cache-busting; the user-level updatedAt is
  // only relevant for the user-level avatar.
  const counterpartOA = profile?.counterpartOutwardAccount ?? null;
  const avatarUri = counterpartOA?.avatarUrl
    ? resolveStorageUrl(counterpartOA.avatarUrl, null)
    : resolveStorageUrl(user?.avatarUrl ?? null, user?.updatedAt ?? null);

  // #685 — Mirror the avatar swap (#678) for the hero banner: prefer
  // the picked skin's `bannerUrl` so an operator skin shows its own
  // company brand banner rather than the owner's personal one. Fall
  // back to the owner's active-mode banner / header image (mirrors the
  // precedence in the user's own /profile IdentityHero). Cache-busting
  // for the OA path uses null because the OA's signed URL already
  // carries its own version; the user-level fallback uses
  // `user.updatedAt` only — the OA does NOT use it.
  const ownerBannerPath =
    (typeof intake.headerImageUrl === "string" && intake.headerImageUrl) ||
    (typeof intake.bannerUrl === "string" && intake.bannerUrl) ||
    (typeof intake.coverPhotoUrl === "string" && intake.coverPhotoUrl) ||
    null;
  const bannerUri = counterpartOA?.bannerUrl
    ? resolveStorageUrl(counterpartOA.bannerUrl, null)
    : resolveStorageUrl(ownerBannerPath, user?.updatedAt ?? null);

  // #671 — When the modal was opened from a row tied to a specific
  // operator skin (Game Room Admin, Facility Admin, …), surface the
  // skin's public face (companyName ?? title ?? displayName) and its
  // role label as a header chip so the visitor knows which company
  // they're connecting to instead of seeing the owner's collab
  // persona by default. Falls back gracefully when no skin was passed
  // (legacy callers / collab baseline) or when the picked skin's
  // public name is identical to the avatar name we already render.
  const counterpartSkinName = counterpartOA
    ? (counterpartOA.companyName?.trim() ||
        counterpartOA.title?.trim() ||
        counterpartOA.displayName?.trim() ||
        null)
    : null;
  const counterpartSkinRole = counterpartOA
    ? MODE_LABELS[counterpartOA.kind as UserModeKind] ?? null
    : null;
  const counterpartSkinHeader = useMemo(() => {
    if (!counterpartOA) return null;
    if (!counterpartSkinName && !counterpartSkinRole) return null;
    // Suppress the chip when its only signal duplicates the avatar
    // name (e.g. an OA whose title matches the user's name and has no
    // role label worth surfacing). Avoids rendering the same words
    // twice in the hero.
    if (
      counterpartSkinName &&
      !counterpartSkinRole &&
      user?.name &&
      counterpartSkinName.trim().toLowerCase() === user.name.trim().toLowerCase()
    ) {
      return null;
    }
    return { name: counterpartSkinName, role: counterpartSkinRole };
  }, [counterpartOA, counterpartSkinName, counterpartSkinRole, user?.name]);

  // #523 — When the viewer is connected, surface the pro's per-client
  // tag (Service · Identity) directly under their name. The
  // viewer→target row is the to-side connection from the pro's POV, so
  // serviceTitle / onSiteIdentity / chip there are owned & set by the
  // pro (see PATCH /users/me/connections/:id authz). Fall back to the
  // generic role pill when no per-client tag has been set yet.
  const perClientTag = useMemo(() => {
    if (!connection) return { label: null as string | null, chip: null as string | null, chipHeart: false };
    return composeLabelChipLine({
      roleContext: null,
      serviceTitle: connection.serviceTitle ?? null,
      onSiteIdentity: connection.onSiteIdentity ?? null,
      onSiteIdentityOther: connection.onSiteIdentityOther ?? null,
      chip: connection.chip ?? null,
      chipOther: connection.chipOther ?? null,
    });
  }, [connection]);
  const hasPerClientTag = !!(perClientTag.label || perClientTag.chip);

  async function handlePick(kind: ConnectionKind, personalNote?: string) {
    if (!clerkId) return;
    setChooserOpen(false);
    setConnectError(null);
    // #656 — forward the optional in-sheet note so the recipient sees
    // it on /invites and in the system-style team-up-request inbox row.
    // Already-accepted "change kind" picks won't carry a note (the
    // sheet only renders the composer when `showPersonalNote` is on).
    try {
      await connect.mutateAsync({
        userId: clerkId,
        data: personalNote ? { kind, personalNote } : { kind },
      });
    } catch (e) {
      // #501 follow-up: 409 with code `team_up_pending` means a request
      // is already outstanding between these two skins. Show an
      // actionable inline message and refresh the profile so the UI
      // can flip from "Connect" → "Sent · awaiting reply".
      const data =
        e && typeof e === "object" && "data" in e
          ? (e as { data?: { code?: string; error?: string } }).data
          : undefined;
      if (data?.code === "team_up_pending") {
        setConnectError("A team-up request is already pending — check Invites.");
      } else if (typeof data?.error === "string" && data.error.length > 0) {
        setConnectError(data.error);
      } else {
        setConnectError("Couldn't send team-up request. Try again.");
      }
    } finally {
      await queryClient.invalidateQueries({ queryKey });
      await queryClient.invalidateQueries({ queryKey: ["/api/users/me/relationships"] });
    }
  }

  async function handleDisconnect() {
    if (!clerkId) return;
    await disconnect.mutateAsync({ userId: clerkId });
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.invalidateQueries({ queryKey: ["/api/users/me/relationships"] });
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : insets.top + 8 },
          ]}
        >
          <Pressable
            onPress={onClose}
            hitSlop={20}
            style={{ padding: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Close profile"
          >
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>Profile</Text>
          {/* PARADIGM (entity-model): the avatar profile header used to
              carry a one-tap Message button. Removed because messages
              must be scoped to an ENTITY (a property, a facility, or a
              business workspace), not opened against an avatar. The
              user reaches a thread by entering an entity they share
              with this person and messaging from there. See the
              "Connection paradigm — entity-only" section in replit.md
              and `docs/architecture/entity-model-proposal.md`.
              The empty spacer keeps the header layout balanced where
              the button used to sit. */}
          <View style={{ width: 38 }} />
        </View>

        {isFetching && !profile ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.foreground} />
          </View>
        ) : !user ? (
          <Text style={[styles.empty, { color: colors.mutedForeground }]}>Profile not available.</Text>
        ) : (
          <ScrollView
            ref={profileScrollRef}
            onScroll={(e) => {
              lastScrollY.current = e.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={64}
            contentContainerStyle={[
              styles.scroll,
              {
                paddingBottom: insets.bottom + 32,
                // #685 — When a hero banner is present, drop the top
                // padding so the banner sits flush at the top of the
                // scroll instead of floating below an empty 24px gap.
                paddingTop: bannerUri ? 0 : 24,
              },
            ]}
          >
            {/* #698 — When a banner is present, mirror the IdentityHero
                composition used on the user's own /profile screen: wrap
                banner + avatar in a positioning root so the avatar
                bottom-overlaps the banner instead of sitting in a
                separate row below it. Falls back to the original
                centered-avatar layout (rendered inside heroBlock) when
                no banner image is available, preserving the picked-skin
                / owner banner precedence from #685. */}
            {bannerUri ? (
              <View style={styles.bannerStack}>
                {/* testID hook (#699 e2e): mirrors
                    `public-profile-hero-avatar` so the e2e suite can
                    assert the rendered hero banner reflects the picked
                    operator skin's bannerUrl (when set) vs the owner's
                    intake banner (fallback). Visual-only — no behavior
                    change.

                    The resolved URI is also exposed via
                    `dataSet={{ uri }}` so the e2e suite can read it from
                    the DOM (`data-uri`) without depending on RN Web's
                    Image preload behavior: when the underlying URL
                    404s/401s (the e2e seed uses synthetic storage
                    tokens that don't actually resolve), RN Web leaves
                    the `<img src>` attribute null, but the `data-uri`
                    we set here always reflects what the modal chose.
                    Native runners ignore `dataSet` — they read
                    `props.source.uri` from the React tree instead. */}
                <Image
                  source={{ uri: bannerUri }}
                  style={[styles.heroBanner, { backgroundColor: colors.muted }]}
                  resizeMode="cover"
                  accessibilityIgnoresInvertColors
                  testID="public-profile-hero-banner"
                  accessibilityLabel={
                    counterpartOA?.bannerUrl
                      ? `${counterpartSkinName ?? user?.name ?? "Profile"} banner`
                      : `${user?.name ?? "Profile"} banner`
                  }
                  // RN Web translates `dataSet` into `data-*` DOM attrs
                  // (here: `data-uri="…"`). React Native's @types do
                  // not declare `dataSet` on `ImageProps`, so cast
                  // through unknown to satisfy TS without losing the
                  // runtime attribute. Native runners ignore the prop.
                  {...({ dataSet: { uri: bannerUri } } as unknown as Record<string, unknown>)}
                />
                <View style={styles.avatarOverlap} pointerEvents="box-none">
                  <View style={[styles.avatar, styles.avatarOverlapInner, { backgroundColor: colors.muted, borderColor: colors.background }]}>
                    {avatarUri ? (
                      // testID hook (#686 e2e): the picked-skin avatar
                      // swap is visual-only, so the e2e suite needs a
                      // stable selector on the hero <img> to assert the
                      // rendered src reflects the OA's avatar (when
                      // picked) vs the owner's avatar (fallback). The
                      // accessibility label doubles as a screen-reader
                      // cue.
                      //
                      // The resolved URI is also exposed via
                      // `dataSet={{ uri }}` so the e2e suite can read it
                      // from the DOM (`data-uri`) without depending on
                      // RN Web's Image preload behavior — when the
                      // underlying URL 401s/404s (the e2e seed uses
                      // synthetic storage tokens that don't actually
                      // resolve), RN Web leaves `<img src>` null but
                      // `data-uri` always reflects the modal's choice.
                      // Mirrors the banner treatment from #699.
                      <Image
                        source={{ uri: avatarUri }}
                        style={styles.avatarImg}
                        testID="public-profile-hero-avatar"
                        accessibilityLabel={
                          counterpartOA?.avatarUrl
                            ? `${counterpartSkinName ?? user.name ?? "Profile"} avatar`
                            : `${user.name ?? "Profile"} avatar`
                        }
                        // RN Web translates `dataSet` into `data-*` DOM
                        // attrs (here: `data-uri="…"`). React Native's
                        // @types do not declare `dataSet` on
                        // `ImageProps`, so cast through unknown to
                        // satisfy TS without losing the runtime
                        // attribute. Native runners ignore the prop.
                        {...({ dataSet: { uri: avatarUri } } as unknown as Record<string, unknown>)}
                      />
                    ) : (
                      <Text style={[styles.avatarInitial, { color: colors.mutedForeground }]}>
                        {(user.name || "?").trim().charAt(0).toUpperCase()}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            ) : null}
            <View style={[styles.heroBlock, bannerUri ? styles.heroBlockWithBanner : null]}>
              {counterpartSkinHeader ? (
                // #671 — Header chip identifying the operator skin the
                // visitor picked in Finder. Renders at the top of the
                // identity block so they immediately see, e.g., "Gameop
                // Game Room · Facility Management" before tapping
                // Connect.
                <View
                  style={[
                    styles.skinHeaderChip,
                    { borderColor: colors.border, backgroundColor: colors.muted },
                  ]}
                  accessibilityRole="header"
                  accessibilityLabel={
                    counterpartSkinHeader.name && counterpartSkinHeader.role
                      ? `Connecting to ${counterpartSkinHeader.name}, ${counterpartSkinHeader.role}`
                      : `Connecting to ${counterpartSkinHeader.name ?? counterpartSkinHeader.role}`
                  }
                >
                  <Feather name="briefcase" size={12} color={colors.mutedForeground} />
                  {counterpartSkinHeader.name ? (
                    <Text
                      style={[styles.skinHeaderChipName, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {counterpartSkinHeader.name}
                    </Text>
                  ) : null}
                  {counterpartSkinHeader.name && counterpartSkinHeader.role ? (
                    <Text style={[styles.skinHeaderChipDot, { color: colors.mutedForeground }]}>
                      ·
                    </Text>
                  ) : null}
                  {counterpartSkinHeader.role ? (
                    <Text
                      style={[styles.skinHeaderChipRole, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {counterpartSkinHeader.role}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {bannerUri ? null : (
                // #698 — No-banner fallback: render the avatar inline at
                // the top of the centered hero block (legacy layout).
                <View style={[styles.avatar, { backgroundColor: colors.muted }]}>
                  {avatarUri ? (
                    // See the with-banner avatar render above for the
                    // rationale behind `dataSet={{ uri }}` — same e2e
                    // contract: the resolved URI is exposed via
                    // `data-uri` so the test can read it from the DOM
                    // even when the synthetic seed URL fails to load.
                    <Image
                      source={{ uri: avatarUri }}
                      style={styles.avatarImg}
                      testID="public-profile-hero-avatar"
                      accessibilityLabel={
                        counterpartOA?.avatarUrl
                          ? `${counterpartSkinName ?? user.name ?? "Profile"} avatar`
                          : `${user.name ?? "Profile"} avatar`
                      }
                      {...({ dataSet: { uri: avatarUri } } as unknown as Record<string, unknown>)}
                    />
                  ) : (
                    <Text style={[styles.avatarInitial, { color: colors.mutedForeground }]}>
                      {(user.name || "?").trim().charAt(0).toUpperCase()}
                    </Text>
                  )}
                </View>
              )}
              <View style={{ marginTop: 14, marginBottom: 4 }}>
                <ShareRoundHousePill
                  onPress={() => setShareOpen(true)}
                  onLongPress={() => {
                    onClose();
                    router.push("/people-i-invited");
                  }}
                  accentColor={getModeAccent(activeMode?.kind ?? null).primary}
                />
              </View>
              <Text style={[styles.name, { color: colors.foreground }]}>{user.name}</Text>
              <Text style={[styles.handle, { color: colors.mutedForeground }]}>@{user.username}</Text>
              {company ? (
                <Text style={[styles.company, { color: colors.foreground }]}>{company}</Text>
              ) : null}
              {hasPerClientTag ? (
                <View style={styles.perClientTagRow}>
                  {perClientTag.label ? (
                    <Text
                      style={[styles.perClientTagLabel, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {perClientTag.label}
                    </Text>
                  ) : null}
                  {perClientTag.label && perClientTag.chip ? (
                    <Text style={[styles.perClientTagDot, { color: colors.mutedForeground }]}>
                      {" · "}
                    </Text>
                  ) : null}
                  {perClientTag.chip ? (
                    <View
                      style={[
                        styles.perClientTagChip,
                        { borderColor: colors.border, backgroundColor: colors.muted },
                      ]}
                    >
                      <Text style={[styles.perClientTagChipText, { color: colors.foreground }]}>
                        {perClientTag.chip}
                        {perClientTag.chipHeart ? " ♥" : ""}
                      </Text>
                    </View>
                  ) : null}
                </View>
              ) : role ? (
                <View style={[styles.rolePill, { backgroundColor: colors.muted }]}>
                  <Text style={[styles.roleText, { color: colors.mutedForeground }]}>{role}</Text>
                </View>
              ) : null}
              {user.sponsorBrandName ? (
                <View style={[styles.rolePill, { backgroundColor: "#FFF3C4", marginTop: 6 }]}>
                  <Feather name="star" size={11} color="#9A7B00" />
                  <Text style={[styles.roleText, { color: "#9A7B00", marginLeft: 4 }]}>
                    Sponsored by {user.sponsorBrandName}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Work snapshot */}
            {(trade || region || experience || zipsLine) && (
              <Section title="Work snapshot" colors={colors}>
                {trade ? <SnapshotRow label="Trade" value={trade} colors={colors} /> : null}
                {region ? <SnapshotRow label="Service Area" value={region} colors={colors} /> : null}
                {zipsLine ? <SnapshotRow label="ZIPs" value={zipsLine} colors={colors} /> : null}
                {experience ? <SnapshotRow label="Experience" value={experience} colors={colors} /> : null}
              </Section>
            )}

            {/* Primary action */}
            {!isSelf ? (
              <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
                {connection && connection.status === "pending" ? (
                  // #501 follow-up: outbound team-up request awaiting reply.
                  // Show a "Sent" pill + Cancel link instead of repeating the
                  // primary "Connect" button (which always 409s).
                  <View style={{ gap: 10 }}>
                    <View style={[styles.connectedPill, { backgroundColor: colors.muted }]}>
                      <Feather name="send" size={16} color={colors.foreground} />
                      <Text
                        style={[styles.connectedText, { color: colors.foreground, flexShrink: 1 }]}
                        numberOfLines={1}
                      >
                        Team-up request sent · awaiting reply
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => {
                        onClose();
                        router.push("/invites" as never);
                      }}
                      style={[styles.secondaryBtn, { borderColor: colors.border }]}
                    >
                      <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
                        View in Invites
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={handleDisconnect}
                      disabled={disconnect.isPending}
                      style={[
                        styles.secondaryBtn,
                        { borderColor: colors.border, opacity: disconnect.isPending ? 0.6 : 1 },
                      ]}
                    >
                      <Text style={[styles.secondaryBtnText, { color: colors.destructive ?? "#c00" }]}>
                        {disconnect.isPending ? "Cancelling…" : "Cancel request"}
                      </Text>
                    </Pressable>
                  </View>
                ) : !connection && myReverseConnection?.status === "pending" ? (
                  // #501 follow-up: inbound team-up request from this skin.
                  // Direct the viewer to /invites where they can Accept /
                  // Decline. Suppress the redundant "Connect" button (which
                  // would 409).
                  <View style={{ gap: 10 }}>
                    <View style={[styles.connectedPill, { backgroundColor: colors.muted }]}>
                      <Feather name="mail" size={16} color={colors.foreground} />
                      <Text
                        style={[styles.connectedText, { color: colors.foreground, flexShrink: 1 }]}
                        numberOfLines={1}
                      >
                        They sent you a team-up request
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => {
                        onClose();
                        router.push("/invites" as never);
                      }}
                      style={[
                        styles.primaryBtn,
                        { backgroundColor: colors.primary ?? "#1877F2" },
                      ]}
                    >
                      <Feather name="inbox" size={16} color={colors.primaryForeground ?? "#fff"} />
                      <Text style={[styles.primaryBtnText, { color: colors.primaryForeground ?? "#fff" }]}>
                        Open Invites to respond
                      </Text>
                    </Pressable>
                  </View>
                ) : connection ? (
                  <View style={{ gap: 10 }}>
                    {(() => {
                      const canEditCadence =
                        profile?.activeModeKind === "trade_pro" ||
                        profile?.activeModeKind === "trade_pro_collab";
                      const pillContent = (
                        <>
                          <Feather name="check-circle" size={16} color={colors.foreground} />
                          <Text
                            style={[styles.connectedText, { color: colors.foreground, flexShrink: 1 }]}
                            numberOfLines={1}
                            ellipsizeMode="tail"
                          >
                            Connected as {KIND_LABEL[connection.kind]}
                            {(() => {
                              const { label, chip, chipHeart } = composeLabelChipLine({
                                roleContext: null,
                                serviceTitle: connection.serviceTitle ?? null,
                                onSiteIdentity: connection.onSiteIdentity ?? null,
                                onSiteIdentityOther: connection.onSiteIdentityOther ?? null,
                                chip: connection.chip ?? null,
                                chipOther: connection.chipOther ?? null,
                              });
                              const cadence = connection.cadence ? cadenceLabel(connection.cadence) : null;
                              const tail = [cadence, label, chip ? `${chip}${chipHeart ? " ♥" : ""}` : null]
                                .filter(Boolean)
                                .join(" · ");
                              return tail ? ` — ${tail}` : "";
                            })()}
                          </Text>
                        </>
                      );
                      return canEditCadence ? (
                        <Pressable
                          onPress={() => setTagModalOpen(true)}
                          accessibilityRole="button"
                          accessibilityLabel={
                            connection.classification || connection.cadence
                              ? "Change classification and cadence"
                              : "Set classification and cadence"
                          }
                          style={({ pressed }) => [
                            styles.connectedPill,
                            { backgroundColor: colors.muted, minHeight: 44, opacity: pressed ? 0.7 : 1 },
                          ]}
                        >
                          {pillContent}
                        </Pressable>
                      ) : (
                        <View
                          style={[styles.connectedPill, { backgroundColor: colors.muted }]}
                        >
                          {pillContent}
                        </View>
                      );
                    })()}
                    <Pressable
                      onPress={() => setChooserOpen(true)}
                      style={[styles.secondaryBtn, { borderColor: colors.border }]}
                    >
                      <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
                        Change relationship
                      </Text>
                    </Pressable>
                    {/* #502 — From-side authz: only `classification` is editable
                          from this row (which is viewer→target). Other tag
                          fields (serviceTitle/onSiteIdentity/chip) describe
                          the *target* and are owned by their reciprocal row. */}
                    {profile?.activeModeKind === "trade_pro" || profile?.activeModeKind === "trade_pro_collab" ? (
                      <Pressable
                        onPress={() => setTagModalOpen(true)}
                        style={[styles.secondaryBtn, { borderColor: colors.border }]}
                      >
                        <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
                          {connection.classification || connection.cadence
                            ? "Change classification & cadence"
                            : "Set classification & cadence"}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={handleDisconnect}
                      disabled={disconnect.isPending}
                      style={[styles.secondaryBtn, { borderColor: colors.border, opacity: disconnect.isPending ? 0.6 : 1 }]}
                    >
                      <Text style={[styles.secondaryBtnText, { color: colors.destructive ?? "#c00" }]}>
                        {disconnect.isPending ? "Removing…" : "Remove connection"}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  // PARADIGM (entity-model): an avatar profile must NOT
                  // carry a Connect or Message action. People do not
                  // connect to people — they invite each other into
                  // entities (residential property, commercial property,
                  // business). The legacy avatar-to-avatar Connect
                  // button that lived here has been removed. The
                  // replacement is the "Add to one of my entities"
                  // flow, which lives on the entity-side surfaces (the
                  // property workspace and the business workspace).
                  // See docs/architecture/entity-model-proposal.md
                  // §3 (people are identity-only) and the "Add-to-entity
                  // flow" section in
                  // .local/tasks/entity-model-architecture-proposal.md
                  // for the full spec.
                  <View
                    style={{
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: colors.muted,
                      gap: 6,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.foreground,
                        fontWeight: "600",
                        fontSize: 14,
                      }}
                    >
                      Want to work with this person?
                    </Text>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontSize: 13,
                        lineHeight: 18,
                      }}
                    >
                      People don't connect to people in Round House. Open one of your homes, facilities, or businesses and add them there.
                    </Text>
                  </View>
                )}
                {/* #521 — When the OTHER party has added me as a
                    collaborator, surface a control to pick the chip
                    (Mom / Spouse / Friend / …) that's rendered next
                    to my own name on their screens. The chip lives
                    on the reciprocal row (target → viewer) and is
                    to-side-owned, so we patch myReverseConnection.
                    Rendered independently of the viewer→target row,
                    which may not exist yet. */}
                {connectError ? (
                  <View
                    style={{
                      marginTop: 10,
                      padding: 10,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: colors.muted,
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: 8,
                    }}
                  >
                    <Feather name="alert-circle" size={14} color={colors.destructive ?? "#c00"} />
                    <Text
                      style={{ color: colors.foreground, flex: 1, fontSize: 13, lineHeight: 18 }}
                    >
                      {connectError}
                    </Text>
                    <Pressable onPress={() => setConnectError(null)} hitSlop={8}>
                      <Feather name="x" size={14} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                ) : null}
                {myReverseConnection?.kind === "collaborator" ? (
                  <Pressable
                    onPress={() => setChipModalOpen(true)}
                    style={[
                      styles.secondaryBtn,
                      { borderColor: colors.border, marginTop: 10 },
                    ]}
                  >
                    <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
                      {(() => {
                        const mine = composeLabelChipLine({
                          roleContext: null,
                          chip: myReverseConnection.chip ?? null,
                          chipOther: myReverseConnection.chipOther ?? null,
                        });
                        return mine.chip
                          ? `Change my chip · ${mine.chip}${mine.chipHeart ? " ♥" : ""}`
                          : "Choose my chip";
                      })()}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            {/* Company card: centered logo at top, contact info stacked left-aligned beneath. */}
            {(() => {
              const companyLogoUrl =
                typeof intake.companyLogoUrl === "string"
                  ? (intake.companyLogoUrl as string)
                  : typeof intake.logoUrl === "string"
                    ? (intake.logoUrl as string)
                    : null;
              const logoUri = resolveStorageUrl(companyLogoUrl, user.updatedAt ?? null);
              const phoneVal = user.phone ?? user.cellPhone ?? user.officePhone ?? null;
              const items: {
                icon: keyof typeof Feather.glyphMap;
                text: string;
                onPress?: () => void;
              }[] = [];
              if (company) items.push({ icon: "briefcase", text: company });
              if (phoneVal) {
                items.push({
                  icon: "phone",
                  text: phoneVal,
                  onPress: () => Linking.openURL(`tel:${phoneVal.replace(/[^0-9+]/g, "")}`),
                });
              }
              if (user.email) {
                items.push({
                  icon: "mail",
                  text: user.email,
                  onPress: () => Linking.openURL(`mailto:${user.email}`),
                });
              }
              if (user.website) {
                const w = user.website.startsWith("http") ? user.website : `https://${user.website}`;
                items.push({
                  icon: "globe",
                  text: user.website,
                  onPress: () => Linking.openURL(w),
                });
              }
              if (user.instagram) {
                const handle = user.instagram.replace(/^@/, "");
                items.push({
                  icon: "instagram",
                  text: `@${handle}`,
                  onPress: () => Linking.openURL(`https://instagram.com/${handle}`),
                });
              }
              if (user.address) items.push({ icon: "map-pin", text: user.address });
              if (items.length === 0 && !logoUri) return null;
              return (
                <View style={{ paddingHorizontal: 16, marginTop: 16, gap: 8 }}>
                  <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>CONTACT</Text>
                  <View
                    style={[
                      styles.companyCard,
                      { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                  >
                    {logoUri ? (
                      <View style={styles.contactLogoWrap}>
                        <Image
                          source={{ uri: logoUri }}
                          style={styles.contactLogo}
                          resizeMode="contain"
                        />
                      </View>
                    ) : null}
                    {items.map((it, idx) => (
                      <Pressable
                        key={idx}
                        onPress={it.onPress}
                        disabled={!it.onPress}
                        style={[
                          styles.companyRow,
                          {
                            borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
                            borderTopColor: colors.border,
                          },
                        ]}
                      >
                        <Feather name={it.icon} size={15} color={colors.mutedForeground} />
                        <Text
                          style={[styles.companyRowText, { color: colors.foreground }]}
                          numberOfLines={1}
                        >
                          {it.text}
                        </Text>
                        {it.onPress ? (
                          <Feather name="external-link" size={12} color={colors.mutedForeground} />
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                </View>
              );
            })()}
            {!user.email && !user.phone && !user.cellPhone && !user.officePhone && !user.address && !user.website && !user.instagram && !company && !isSelf && !connection ? (
              // PARADIGM (entity-model): copy used to read "Contact details
              // unlock once you connect" — paradigm drift, since people
              // do not connect to people. Contact details are shared
              // when both parties participate in the same entity, or
              // when the pro has marked the field public on their
              // avatar. See replit.md "Connection paradigm — entity-only".
              <Text style={[styles.privacyNote, { color: colors.mutedForeground }]}>
                Contact details are shared inside entities you both belong to — or when this pro has chosen to make them public.
              </Text>
            ) : null}

            {user.services && user.services.length > 0 ? (
              <View style={{ paddingHorizontal: 16, marginTop: 16, gap: 8 }}>
                <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>SERVICES</Text>
                <View style={styles.servicesWrap}>
                  {user.services.map((s) => {
                    const count = profile?.serviceStoryCounts?.[s.name] ?? 0;
                    const onChipPress = () => {
                      savedScrollY.current = lastScrollY.current;
                      setStoriesService(s.name);
                      setStoriesOpen(true);
                    };
                    return (
                      <View
                        key={s.name}
                        style={[
                          styles.serviceChip,
                          { backgroundColor: colors.card, borderColor: colors.border },
                        ]}
                      >
                        <Pressable
                          onPress={onChipPress}
                          accessibilityRole="button"
                          accessibilityLabel={
                            count > 0
                              ? `Open ${count} ${s.name} success ${count === 1 ? "story" : "stories"}`
                              : `Open ${s.name} success stories`
                          }
                          style={({ pressed }) => [
                            styles.chipBody,
                            { opacity: pressed ? 0.7 : 1 },
                          ]}
                        >
                          <Text style={[styles.serviceChipText, { color: colors.foreground }]}>
                            {displayServiceName(s.name)}
                          </Text>
                          {count > 0 ? (
                            <View style={[styles.countBadge, { backgroundColor: colors.muted }]}>
                              <Text style={[styles.countBadgeText, { color: colors.foreground }]}>
                                {count}
                              </Text>
                            </View>
                          ) : null}
                        </Pressable>
                        {onServicePress ? (
                          <Pressable
                            onPress={() => onServicePress(s.name)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`Find other pros offering ${s.name}`}
                            style={({ pressed }) => [
                              styles.chipFindBtn,
                              { borderLeftColor: colors.border, opacity: pressed ? 0.6 : 1 },
                            ]}
                          >
                            <Feather name="search" size={12} color={colors.mutedForeground} />
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {user.licenseNumber || user.licenseType || user.licenseState ? (
              <Section title="Business license" colors={colors}>
                {user.licenseState ? (
                  <SnapshotRow label="State" value={user.licenseState} colors={colors} />
                ) : null}
                {user.licenseType ? (
                  <SnapshotRow label="Type" value={user.licenseType} colors={colors} />
                ) : null}
                {user.licenseNumber ? (
                  <SnapshotRow label="Number" value={user.licenseNumber} colors={colors} />
                ) : null}
              </Section>
            ) : null}

            {user.insuranceCarrier || user.insurancePolicyNumber ? (
              <Section title="Insurance" colors={colors}>
                {user.insuranceCarrier ? (
                  <SnapshotRow label="Carrier" value={user.insuranceCarrier} colors={colors} />
                ) : null}
                {user.insurancePolicyNumber ? (
                  <SnapshotRow label="Policy" value={user.insurancePolicyNumber} colors={colors} />
                ) : null}
              </Section>
            ) : null}

            {sharedEntities.length > 0 ? (
              <View style={{ paddingHorizontal: 16, marginTop: 16, gap: 4 }}>
                <Text
                  style={{
                    fontSize: 11,
                    fontFamily: "Inter_700Bold",
                    letterSpacing: 0.8,
                    color: colors.mutedForeground,
                  }}
                >
                  SHARED
                </Text>
                <Text
                  style={{
                    fontSize: 14,
                    fontFamily: "Inter_500Medium",
                    color: colors.foreground,
                  }}
                >
                  {sharedEntities.map((e) => e.name).join(", ")}
                </Text>
              </View>
            ) : null}

            {teamData?.members && teamData.members.length > 0 ? (
              <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
                {/* #557 — render via TeamSection so admin-seeded
                    teammate chips show up next to each name, matching
                    the way the admin sees their own team in
                    ManageTeamModal. */}
                <TeamSection
                  members={teamData.members.map((m) => ({
                    memberClerkId: m.memberClerkId,
                    name: m.name,
                    username: m.username,
                    avatarUrl: m.avatarUrl,
                    role: m.role,
                    chip: m.chip ?? null,
                    chipOther: m.chipOther ?? null,
                  }))}
                  companyKind={
                    profile?.activeModeKind === "trade_pro"
                      ? "trade_pro"
                      : profile?.activeModeKind === "facilities"
                        ? "facilities"
                        : null
                  }
                />
              </View>
            ) : null}
          </ScrollView>
        )}

        <StackedPhotoTimeline
          visible={storiesOpen}
          clerkId={clerkId}
          proName={user?.name ?? null}
          service={storiesService}
          onZoomOut={() => setStoriesService(null)}
          onClose={() => {
            setStoriesOpen(false);
            setStoriesService(null);
            const y = savedScrollY.current;
            if (y != null) {
              // Defer until after the modal has dismissed so the underlying
              // ScrollView has the layout in place to scroll to.
              requestAnimationFrame(() => {
                profileScrollRef.current?.scrollTo({ y, animated: false });
              });
              savedScrollY.current = null;
            }
          }}
        />

        {/* Connect choice sheet (#645 — shared with the inbox blocked banner) */}
        <ConnectionKindChooser
          visible={chooserOpen}
          onClose={() => setChooserOpen(false)}
          onSelect={handlePick}
          pending={connect.isPending}
          selectedKind={connection?.kind ?? null}
          // #656 — only show the personal-note composer when this is a
          // fresh team-up request (no existing connection). Re-picking a
          // kind on an already-accepted connection shouldn't drop a new
          // system message in the chat, so the composer stays hidden
          // for that flow.
          showPersonalNote={!connection}
        />
        <ShareRoundHouseModal
          visible={shareOpen}
          onClose={() => setShareOpen(false)}
          onSent={() => {
            setShareOpen(false);
            onClose();
            router.push("/people-i-invited");
          }}
        />
        <ConnectionTagModal
          visible={tagModalOpen}
          onClose={() => setTagModalOpen(false)}
          connectionId={connection?.id ?? null}
          mode="classify-pro"
          subjectName={user?.name ?? user?.username ?? undefined}
          initial={{
            classification: connection?.classification ?? null,
            cadence: connection?.cadence ?? null,
          }}
          onSaved={() => {
            queryClient.invalidateQueries();
          }}
        />
        <ConnectionTagModal
          visible={chipModalOpen}
          onClose={() => setChipModalOpen(false)}
          connectionId={myReverseConnection?.id ?? null}
          mode="collaborator-self-tag"
          subjectName={user?.name ?? user?.username ?? undefined}
          initial={{
            chip: myReverseConnection?.chip ?? null,
            chipOther: myReverseConnection?.chipOther ?? null,
          }}
          onSaved={() => {
            queryClient.invalidateQueries();
          }}
        />
      </View>
    </Modal>
  );
}

function Section({
  title,
  children,
  colors,
}: {
  title: string;
  children: React.ReactNode;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ paddingHorizontal: 16, marginTop: 16, gap: 8 }}>
      <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{title.toUpperCase()}</Text>
      <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {children}
      </View>
    </View>
  );
}

function SnapshotRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.snapRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.snapLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.snapValue, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

function ContactRow({
  label,
  value,
  onPress,
  colors,
}: {
  label: string;
  value: string;
  onPress?: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[styles.snapRow, { borderBottomColor: colors.border }]}
    >
      <Text style={[styles.snapLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text
        style={[
          styles.snapValue,
          { color: onPress ? (colors.primary ?? "#1877F2") : colors.foreground },
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </Pressable>
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
  headerMessageBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 32,
  },
  headerMessageText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { textAlign: "center", marginTop: 32, fontSize: 14, fontFamily: "Inter_400Regular" },
  scroll: { paddingTop: 24 },
  // #685 — Full-bleed hero banner shown above the avatar when the
  // owner (or picked skin) has uploaded a header image.
  heroBanner: { width: "100%", height: 160 },
  // #698 — Positioning root that lets the avatar bottom-overlap the
  // banner (mirrors the IdentityHero composition on /profile). The
  // avatar is absolutely positioned via `avatarOverlap` below; the
  // stack has no intrinsic height of its own beyond the banner.
  bannerStack: { position: "relative" },
  // #698 — Absolute wrapper that horizontally centers the overlapping
  // avatar (matching the modal's centered hero block) and pushes its
  // lower half below the banner so the avatar visually straddles the
  // banner edge. Half of AVATAR_SIZE (96/2 = 48) hangs below.
  avatarOverlap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -48,
    alignItems: "center",
    zIndex: 2,
  },
  // #698 — When the avatar overlaps the banner, give it a thin border
  // matching the page background so its outline reads cleanly against
  // the banner image (same trick IdentityHero uses).
  avatarOverlapInner: {
    borderWidth: 2,
    marginBottom: 0,
  },
  // #698 — Push the centered identity block down past the overlapping
  // avatar's lower half (48px) plus a small breathing gap, so the
  // chip / name / handle don't collide with the avatar.
  heroBlockWithBanner: { paddingTop: 56 },
  heroBlock: { alignItems: "center", paddingHorizontal: 16, gap: 6 },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 8,
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarInitial: { fontSize: 32, fontFamily: "Inter_700Bold" },
  name: { fontSize: 20, fontFamily: "Inter_700Bold" },
  handle: { fontSize: 13, fontFamily: "Inter_500Medium" },
  company: { fontSize: 14, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  rolePill: {
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  roleText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  // #671 — Header chip identifying the picked operator skin. Sits at
  // the top of the hero block so the visitor sees which company the
  // pending Connect targets before any avatar/name copy.
  skinHeaderChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 12,
    maxWidth: "100%",
  },
  skinHeaderChipName: { fontSize: 12, fontFamily: "Inter_700Bold", flexShrink: 1 },
  skinHeaderChipDot: { fontSize: 12, fontFamily: "Inter_500Medium" },
  skinHeaderChipRole: { fontSize: 12, fontFamily: "Inter_500Medium", flexShrink: 1 },
  perClientTagRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 16,
  },
  perClientTagLabel: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  perClientTagDot: { fontSize: 13, fontFamily: "Inter_500Medium" },
  perClientTagChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  perClientTagChipText: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.2 },
  sectionTitle: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.6, paddingHorizontal: 4 },
  sectionCard: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 4 },
  contactLogoWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 14,
    paddingBottom: 8,
  },
  contactLogo: { width: 80, height: 80 },
  companyCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  companyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  companyRowText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    flex: 1,
    textAlign: "left",
  },
  snapRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  snapLabel: { fontSize: 13, fontFamily: "Inter_500Medium" },
  snapValue: { fontSize: 14, fontFamily: "Inter_600SemiBold", flexShrink: 1, textAlign: "right" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: { fontSize: 15, fontFamily: "Inter_700Bold" },
  secondaryBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  secondaryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  connectedPill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
  },
  connectedText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  privacyNote: {
    textAlign: "center",
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginTop: 16,
    paddingHorizontal: 32,
  },
  servicesWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  serviceChip: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
  },
  chipBody: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipFindBtn: {
    paddingHorizontal: 10,
    justifyContent: "center",
    alignItems: "center",
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  serviceChipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  countBadge: {
    minWidth: 22,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  countBadgeText: { fontSize: 11, fontFamily: "Inter_700Bold" },
});
