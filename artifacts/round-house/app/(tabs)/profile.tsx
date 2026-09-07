import React, { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  findNodeHandle,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useColorScheme,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import {
  useGetMe,
  getGetMeQueryKey,
  getGetMyAnalyticsQueryKey,
  useListProperties,
  useGetFeed,
  useGetMyAnalytics,
  useGetMyRelationships,
  useUpdateMe,
  useSendTestNotification,
  useListMyNotificationPrefs,
  useUpdateMyNotificationPref,
  useBulkUpdateMyNotificationPrefs,
  getListMyNotificationPrefsQueryKey,
  useListMyPropertyNotificationOverrides,
  useClearMyPropertyNotificationOverride,
  getListMyPropertyNotificationOverridesQueryKey,
  useGetMyRewards,
  getGetMyRewardsQueryKey,
  useAcceptBrandOffer,
  useDeclineBrandOffer,
  useBoostDeal,
  useListMyDeals,
  type BrandDealOffer,
} from "@workspace/api-client-react";
import { syncPushTokenWithServer, getDeviceExpoPushToken } from "@/lib/pushNotifications";
import type { NotificationPrefType } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  AnalyticsResponse,
  ListPropertiesResponse,
  UserModeProfile,
  UserProfile,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useProfile } from "@/lib/profile";
import { MODE_LABELS } from "@/lib/intake-schemas";
import { getModeAccent } from "@/lib/modeAccent";
import { ModeSwitcher } from "@/components/ModeSwitcher";
import { SHARE_PROMPT_SKIP_KEY } from "@/lib/sharePromptPref";
import { resolveStorageUrl } from "@/lib/uploads";
import { BadgeTier } from "@/components/BadgeTier";
import { PerformanceModal } from "@/components/PerformanceModal";
import { BadgesGrid } from "@/components/BadgesGrid";
import { RewardsLadder } from "@/components/RewardsLadder";
import { ClaimSwagModal } from "@/components/ClaimSwagModal";
import { AnalyticsRewardsModal } from "@/components/AnalyticsRewardsModal";
import { UserSearchModal } from "@/components/UserSearchModal";
import { PublicProfileModal } from "@/components/PublicProfileModal";
import { PeopleModal } from "@/components/PeopleModal";
import { messageHrefFor } from "@/lib/messageTarget";
import { EditProfileModal } from "@/components/EditProfileModal";
import { FullProfileModal } from "@/components/FullProfileModal";
import { IdentityHero } from "@/components/IdentityHero";
import { ShareRoundHouseModal } from "@/components/ShareRoundHouseModal";
import { ShareRoundHousePill } from "@/components/ShareRoundHousePill";
import { InviteSignupCelebrationBanner } from "@/components/InviteSignupCelebrationBanner";
import { RisingSunSticker } from "@/components/RisingSunSticker";
import { ServicesSection } from "@/components/ServicesSection";
import { FoundYourBusinessCard } from "@/components/FoundYourBusinessCard";
import { TeamSection } from "@/components/TeamSection";
import { TeamInvitesBanner } from "@/components/TeamInvitesBanner";
import { ManageTeamModal } from "@/components/ManageTeamModal";
import { AboutModal } from "@/components/AboutModal";
import { confirm as crossPlatformConfirm } from "@/lib/confirm";
import { useListMyTeam, getListMyTeamQueryKey } from "@workspace/api-client-react";
import { DateRangePickerModal } from "@/components/DateRangePickerModal";
import { BulkPropertyMutePickerModal } from "@/components/BulkPropertyMutePickerModal";
import {
  ANALYTICS_PRESETS,
  computePresetRange,
  useAnalyticsFilters,
  type AnalyticsPreset,
} from "@/lib/analyticsFilters";

const logoImage = require("@/assets/images/logo-mark.png");

export default function ProfileScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const { signOut } = useAuth();

  const { data: user } = useGetMe();
  const { activeMode, activeOutwardAccount } = useProfile();
  // Demo provenance: when an admin's demo avatar is the one viewing the
  // profile, render a "DEMO" pill in the identity hero so the operator
  // and any onlooker can immediately tell this isn't real production
  // data. The flag rides on the active outward_account from the API.
  const activeAccountIsDemo = !!activeOutwardAccount?.isDemo;
  const {
    state: analyticsFilters,
    update: updateAnalyticsFilters,
    hydrated: analyticsFiltersHydrated,
  } = useAnalyticsFilters();
  const analyticsRangeDays = analyticsFilters.rangeDays;
  const analyticsPropertyId = analyticsFilters.propertyId;
  const analyticsPreset = analyticsFilters.preset;
  const presetRange = React.useMemo(
    () => (analyticsPreset ? computePresetRange(analyticsPreset) : null),
    [analyticsPreset],
  );
  const customRange = React.useMemo(
    () =>
      analyticsFilters.customRange
        ? {
            from: new Date(analyticsFilters.customRange.from),
            to: new Date(analyticsFilters.customRange.to),
          }
        : null,
    [analyticsFilters.customRange],
  );
  const effectiveRange = presetRange ?? customRange;
  const setAnalyticsPropertyId = React.useCallback(
    (id: number | null) => updateAnalyticsFilters({ propertyId: id }),
    [updateAnalyticsFilters],
  );
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const companyName = (() => {
    const data = (activeMode?.intakeData ?? {}) as Record<string, unknown>;
    if (activeMode?.kind === "trade_pro" && typeof data.companyName === "string") {
      const c = data.companyName.trim();
      return c.length > 0 ? c : null;
    }
    return null;
  })();
  const roleLabel = activeMode ? MODE_LABELS[activeMode.kind] : null;
  const { data: propertiesData } = useListProperties();
  const { data: feedData } = useGetFeed();
  const analyticsParams = React.useMemo(() => {
    const params: { from?: string; to?: string; propertyId?: number } = {};
    if (effectiveRange) {
      params.from = effectiveRange.from.toISOString();
      params.to = effectiveRange.to.toISOString();
    } else {
      const from = new Date(Date.now() - analyticsRangeDays * 24 * 60 * 60 * 1000);
      params.from = from.toISOString();
    }
    if (analyticsPropertyId != null) params.propertyId = analyticsPropertyId;
    return params;
  }, [analyticsRangeDays, analyticsPropertyId, effectiveRange]);
  const { data: analytics } = useGetMyAnalytics(analyticsParams, {
    query: {
      queryKey: getGetMyAnalyticsQueryKey(analyticsParams),
      enabled: analyticsFiltersHydrated,
    },
  });

  const properties = propertiesData?.properties ?? [];
  const logs = feedData?.logs ?? [];

  const scrollViewRef = useRef<ScrollView>(null);

  const topPad = Platform.OS === "web" ? 67 + 16 : insets.top + 16;
  const bottomPad = Platform.OS === "web" ? 34 + 90 : insets.bottom + 90;

  const totalScore = logs.reduce((acc, l) => acc + l.score, 0);
  const myLogs = logs.filter((l) => l.authorClerkId === user?.clerkId);

  // Rewards: points, badges, perks, brand offers, swag claim, boosted deal.
  const { data: rewards } = useGetMyRewards({
    query: { queryKey: getGetMyRewardsQueryKey() },
  });
  const { data: myDealsData } = useListMyDeals();
  const myDeals = myDealsData?.deals ?? [];
  const queryClient = useQueryClient();
  const acceptOffer = useAcceptBrandOffer();
  const declineOffer = useDeclineBrandOffer();
  const boostDeal = useBoostDeal();
  const [swagOpen, setSwagOpen] = useState(false);
  const invalidateRewards = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: getGetMyRewardsQueryKey() });
  }, [queryClient]);
  const onAcceptBrandOffer = useCallback(
    async (offer: BrandDealOffer) => {
      try {
        await acceptOffer.mutateAsync({ offerId: offer.id });
        invalidateRewards();
        void queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      } catch (e: unknown) {
        Alert.alert(
          "Could not accept offer",
          e && typeof e === "object" && "message" in e
            ? String((e as { message: unknown }).message)
            : "Please try again.",
        );
      }
    },
    [acceptOffer, invalidateRewards, queryClient],
  );
  const onDeclineBrandOffer = useCallback(
    async (offer: BrandDealOffer) => {
      try {
        await declineOffer.mutateAsync({ offerId: offer.id });
        invalidateRewards();
      } catch (e: unknown) {
        Alert.alert(
          "Could not decline offer",
          e && typeof e === "object" && "message" in e
            ? String((e as { message: unknown }).message)
            : "Please try again.",
        );
      }
    },
    [declineOffer, invalidateRewards],
  );
  const onBoostDeal = useCallback(() => {
    const eligible = myDeals.filter((d) => new Date(d.endDate) > new Date());
    if (eligible.length === 0) {
      Alert.alert("No active deals", "Create a Deal first, then come back to boost it.");
      return;
    }
    Alert.alert(
      "Boost a Deal",
      "Pick the Deal you'd like to boost in the homeowner carousel for the rest of this month.",
      [
        { text: "Cancel", style: "cancel" },
        ...eligible.slice(0, 5).map((d) => ({
          text: d.headline,
          onPress: async () => {
            try {
              await boostDeal.mutateAsync({ dealId: d.id });
              invalidateRewards();
            } catch (e: unknown) {
              Alert.alert(
                "Could not boost deal",
                e && typeof e === "object" && "message" in e
                  ? String((e as { message: unknown }).message)
                  : "Please try again.",
              );
            }
          },
        })),
      ],
    );
  }, [myDeals, boostDeal, invalidateRewards]);

  const [perfOpen, setPerfOpen] = useState(false);
  const [analyticsModalOpen, setAnalyticsModalOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [viewClerkId, setViewClerkId] = useState<string | null>(null);
  // #643 — When the public profile modal is opened from a relationship
  // row, remember which counterpart skin (outward account) the row was
  // tied to so the modal's Message button can pin the same skin pair.
  const [viewCounterpartAcctId, setViewCounterpartAcctId] = useState<number | null>(null);
  const { data: teamData } = useListMyTeam({
    query: { queryKey: getListMyTeamQueryKey() },
  });
  const teamMembers = teamData?.members ?? [];
  const { data: relationships, isLoading: relLoading } = useGetMyRelationships();
  const allPeople = [
    ...(relationships?.core ?? []),
    ...(relationships?.clients ?? []),
    ...(relationships?.collaborators ?? []),
  ];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Identity hero — banner is purely visual; logo + name + handle + rank
            sit in an anchored row below it, slogan as a full-width line beneath. */}
        {(() => {
          const md = (activeMode?.intakeData ?? {}) as Record<string, unknown>;
          const modeCompanyName =
            (typeof md.companyName === "string" && md.companyName) ||
            (typeof md.placeName === "string" && md.placeName) ||
            null;
          const modeBanner =
            (typeof md.headerImageUrl === "string" && md.headerImageUrl) ||
            (typeof md.bannerUrl === "string" && md.bannerUrl) ||
            (typeof md.coverPhotoUrl === "string" && md.coverPhotoUrl) ||
            null;
          const modeLogo =
            (typeof md.companyLogoUrl === "string" && md.companyLogoUrl) ||
            (typeof md.logoUrl === "string" && md.logoUrl) ||
            null;
          const modeSlogan =
            (typeof md.slogan === "string" && md.slogan) || null;
          return (
        <IdentityHero
          companyName={modeCompanyName ?? companyName ?? null}
          slogan={modeSlogan ?? null}
          companyLogoUrl={modeLogo ?? null}
          headerImageUrl={modeBanner ?? null}
          avatarUrl={user?.avatarUrl || null}
          fallbackName={user?.name ?? ""}
          username={user?.username ?? null}
          rankBadge={<BadgeTier score={totalScore} onPress={() => setPerfOpen(true)} />}
          mediaVersion={`${user?.updatedAt ?? ""}-${activeMode?.id ?? ""}`}
          onEdit={() => setEditOpen(true)}
          onHelp={() => setAboutOpen(true)}
          onSettings={() => setSettingsOpen(true)}
          onAvatarPress={() => setPreviewOpen(true)}
          companyNameTrailing={
            <ShareRoundHousePill
              onPress={() => setShareOpen(true)}
              onLongPress={() => router.push("/people-i-invited")}
              accentColor={getModeAccent(activeMode?.kind).primary}
            />
          }
          isDemo={activeAccountIsDemo}
        />
          );
        })()}

        <InviteSignupCelebrationBanner />

        <ModeSwitcher />

        <Pressable
          onPress={() => setSearchOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="People, pros and special offers"
          style={({ pressed }) => [
            styles.profileSearchBar,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <Text style={[styles.profileSearchText, { color: colors.mutedForeground }]}>
            People, pros & special offers
          </Text>
        </Pressable>

        {/* #720 — Producer-side entry point into FullProfileModal. The
            modal is the only surface that shows the active skin's full
            public preview (name, role, contact, mode-specific fields)
            and reflects the per-skin "show last initial only" privacy
            toggle through formatOwnerNameForSkin. The IdentityHero
            avatar already opens this modal, but a tappable row with an
            unambiguous "View full profile" accessibility label is what
            the privacy-toggle end-to-end plan reaches for, and it's a
            far more discoverable affordance than "tap your own avatar". */}
        <Pressable
          onPress={() => setPreviewOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="View full profile preview"
          testID="profile-tab-view-full-profile-row"
          style={({ pressed }) => [
            styles.viewFullProfileRow,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Feather name="user" size={16} color={colors.mutedForeground} />
          <Text
            style={[styles.viewFullProfileText, { color: colors.foreground }]}
            numberOfLines={1}
          >
            View full profile preview
          </Text>
          <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
        </Pressable>

        <ContactCard user={user} activeMode={activeMode} colors={colors} />

        {/* Empty-state on-ramp for Trade Pro / Facilities avatars to
            found their business entity. Hides itself for other avatar
            kinds and once at least one entity exists. Demo avatars use
            the same flow — server auto-stamps is_admin_demo=true. */}
        <FoundYourBusinessCard />

        <ServicesSection
          services={user?.services ?? []}
          editable
          onEdit={() => setEditOpen(true)}
        />

        <AboutCard
          user={user}
          activeMode={activeMode}
          colors={colors}
          onEdit={() => setEditOpen(true)}
        />

        <HomeBaseCard
          activeMode={activeMode}
          colors={colors}
          onEdit={() => setEditOpen(true)}
        />

        <TeamInvitesBanner />

        {/* Team roster lives on the dedicated "My Team" tab in the bottom
            bar — we no longer render it here to avoid two parallel UIs. */}

        {/* Big Analytics window: charts, then badges, then rewards ladder.
            The AnalyticsSection header also exposes a "View all" link that
            opens the dedicated AnalyticsRewardsModal for a focused rich view. */}
        <View style={styles.analyticsWindow}>
          <View style={styles.windowHeader}>
            <Feather name="bar-chart-2" size={18} color={colors.foreground} />
            <Text style={[styles.windowTitle, { color: colors.foreground }]}>Analytics</Text>
          </View>

          {analytics && (
            <AnalyticsSection
              analytics={analytics}
              colors={colors}
              properties={properties}
              rangeDays={analyticsRangeDays}
              onRangeChange={(d) =>
                updateAnalyticsFilters({ rangeDays: d, customRange: null, preset: null })
              }
              selectedPropertyId={analyticsPropertyId}
              onSelectProperty={setAnalyticsPropertyId}
              customRange={customRange}
              onOpenCustom={() => setDatePickerOpen(true)}
              onClearCustom={() => updateAnalyticsFilters({ customRange: null })}
              preset={analyticsPreset}
              presetRange={presetRange}
              onSelectPreset={(p) =>
                updateAnalyticsFilters({ preset: p, customRange: null })
              }
              onOpenRichView={() => setAnalyticsModalOpen(true)}
            />
          )}

          {rewards && (
            <View style={{ paddingHorizontal: 16, gap: 24, marginTop: 8 }}>
              <View style={{ gap: 12 }}>
                <Text style={[styles.subSectionTitle, { color: colors.foreground }]}>Badges</Text>
                <BadgesGrid badges={rewards.badges} />
              </View>

              <View style={{ gap: 12 }}>
                <Text style={[styles.subSectionTitle, { color: colors.foreground }]}>Rewards</Text>
                <RewardsLadder
                  state={rewards}
                  onClaimSwag={() => setSwagOpen(true)}
                  onBoostDeal={onBoostDeal}
                  onAcceptBrandOffer={onAcceptBrandOffer}
                  onDeclineBrandOffer={onDeclineBrandOffer}
                  busy={
                    acceptOffer.isPending || declineOffer.isPending || boostDeal.isPending
                  }
                />
              </View>
            </View>
          )}
        </View>

        <Text style={[styles.footer, { color: colors.mutedForeground }]}>Roundhouse 2026</Text>
      </ScrollView>

      <SettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        user={user}
        colors={colors}
        properties={properties}
        onSignOut={() => {
          setSettingsOpen(false);
          signOut();
        }}
      />

      <AboutModal visible={aboutOpen} onClose={() => setAboutOpen(false)} />

      <PerformanceModal visible={perfOpen} onClose={() => setPerfOpen(false)} />
      <ClaimSwagModal
        visible={swagOpen}
        defaultName={user?.name ?? ""}
        onClose={() => setSwagOpen(false)}
        onSuccess={() => invalidateRewards()}
      />
      <AnalyticsRewardsModal
        visible={analyticsModalOpen}
        onClose={() => setAnalyticsModalOpen(false)}
      />
      <EditProfileModal visible={editOpen} onClose={() => setEditOpen(false)} />
      <FullProfileModal visible={previewOpen} onClose={() => setPreviewOpen(false)} />
      <ShareRoundHouseModal
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        onSent={() => {
          setShareOpen(false);
          router.push("/people-i-invited");
        }}
        onEditProfile={() => {
          setShareOpen(false);
          setEditOpen(true);
        }}
      />
      <UserSearchModal
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onUserPress={(id) => {
          setViewCounterpartAcctId(null);
          setViewClerkId(id);
        }}
      />
      <PublicProfileModal
        visible={!!viewClerkId}
        clerkId={viewClerkId}
        counterpartOutwardAccountId={viewCounterpartAcctId}
        onClose={() => {
          setViewClerkId(null);
          setViewCounterpartAcctId(null);
        }}
        onServicePress={(service) => {
          setViewClerkId(null);
          setViewCounterpartAcctId(null);
          router.push({ pathname: "/find", params: { service } } as never);
        }}
      />
      <PeopleModal
        visible={peopleOpen}
        onClose={() => setPeopleOpen(false)}
        onPersonPress={(id, counterpartAcctId) => {
          setViewCounterpartAcctId(counterpartAcctId ?? null);
          setViewClerkId(id);
        }}
        onMessagePress={(person) => {
          const href = messageHrefFor(person);
          if (!href) return;
          setPeopleOpen(false);
          router.push(href as never);
        }}
        onTeammateMessagePress={(clerkId) => {
          const href = messageHrefFor({ clerkId });
          if (!href) return;
          setPeopleOpen(false);
          router.push(href as never);
        }}
        core={relationships?.core ?? []}
        clients={relationships?.clients ?? []}
        collaborators={relationships?.collaborators ?? []}
        loading={relLoading}
      />
      <DateRangePickerModal
        visible={datePickerOpen}
        onClose={() => setDatePickerOpen(false)}
        initialFrom={customRange?.from ?? null}
        initialTo={customRange?.to ?? null}
        onApply={(from, to) =>
          updateAnalyticsFilters({
            customRange: { from: from.toISOString(), to: to.toISOString() },
            preset: null,
          })
        }
      />
    </View>
  );
}

const RANGE_CHOICES: { label: string; days: number }[] = [
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "1Y", days: 365 },
];

function AnalyticsSection({
  analytics,
  colors,
  properties,
  rangeDays,
  onRangeChange,
  selectedPropertyId,
  onSelectProperty,
  customRange,
  onOpenCustom,
  onClearCustom,
  preset,
  presetRange,
  onSelectPreset,
  onOpenRichView,
}: {
  analytics: AnalyticsResponse;
  colors: ReturnType<typeof useColors>;
  properties: NonNullable<ListPropertiesResponse["properties"]>;
  rangeDays: number;
  onRangeChange: (d: number) => void;
  selectedPropertyId: number | null;
  onSelectProperty: (id: number | null) => void;
  customRange: { from: Date; to: Date } | null;
  onOpenCustom: () => void;
  onClearCustom: () => void;
  preset: AnalyticsPreset | null;
  presetRange: { from: Date; to: Date } | null;
  onSelectPreset: (p: AnalyticsPreset) => void;
  onOpenRichView: () => void;
}) {
  const presetActive = preset != null;
  const customActive = !presetActive && customRange != null;
  const rangeDaysActive = !presetActive && !customActive;
  const formatShort = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const customLabel = customRange
    ? `${formatShort(customRange.from)} – ${formatShort(customRange.to)}`
    : "Custom";
  const compliancePct = analytics.complianceRate.total
    ? Math.round((analytics.complianceRate.compliant / analytics.complianceRate.total) * 100)
    : null;
  const totalsByProperty = analytics.totalsByProperty.slice(0, 5);
  const maxTotal = Math.max(1, ...totalsByProperty.map((t) => t.count));
  const ratingTrend = analytics.ratingTrend.slice(-6);
  const monthlyTotalsByMonth: Record<string, number> = {};
  analytics.logsByPropertyByMonth.forEach((m) => {
    monthlyTotalsByMonth[m.month] = (monthlyTotalsByMonth[m.month] ?? 0) + m.count;
  });
  const monthlySorted = Object.entries(monthlyTotalsByMonth).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  const maxMonthly = Math.max(1, ...monthlySorted.map(([, v]) => v));

  const presetLabel = preset
    ? ANALYTICS_PRESETS.find((p) => p.key === preset)?.label ?? null
    : null;
  const rangeLabel = presetActive && presetRange
    ? `${presetLabel} (${formatShort(presetRange.from)} – ${formatShort(presetRange.to)})`
    : customRange
    ? `${formatShort(customRange.from)} – ${formatShort(customRange.to)}`
    : rangeDays >= 365
    ? `Last ${Math.round(rangeDays / 365)} year${rangeDays >= 730 ? "s" : ""}`
    : `Last ${rangeDays} days`;
  const selectedProperty = selectedPropertyId != null
    ? properties.find((p) => p.id === selectedPropertyId)
    : null;
  const propertyLabel = selectedProperty ? selectedProperty.name : "All properties";
  const filterLabel = `${rangeLabel} · ${propertyLabel}`;
  const emptyCopy = `No data for ${filterLabel}`;

  const subtitleStyle = {
    color: colors.mutedForeground,
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  } as const;
  const emptyStyle = {
    color: colors.mutedForeground,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    paddingVertical: 12,
    textAlign: "center" as const,
  };

  return (
    <View style={{ gap: 16 }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 8,
        }}
      >
        <Text
          style={{
            fontSize: 11,
            fontFamily: "Inter_700Bold",
            letterSpacing: 0.8,
            color: colors.mutedForeground,
          }}
        >
          ANALYTICS
        </Text>
        <Pressable
          onPress={onOpenRichView}
          hitSlop={8}
          style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
          accessibilityRole="button"
          accessibilityLabel="Open analytics, badges, and rewards"
        >
          <Text
            style={{
              fontSize: 12,
              fontFamily: "Inter_600SemiBold",
              color: colors.primary,
            }}
          >
            View all
          </Text>
          <Feather name="chevron-right" size={14} color={colors.primary} />
        </Pressable>
      </View>

      <View style={{ gap: 8 }}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {RANGE_CHOICES.map((c) => {
            const active = rangeDaysActive && rangeDays === c.days;
            return (
              <Pressable
                key={c.days}
                onPress={() => onRangeChange(c.days)}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.primary + "20" : "transparent",
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: "Inter_600SemiBold",
                    color: active ? colors.primary : colors.foreground,
                  }}
                >
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              borderRadius: 999,
              borderWidth: 1,
              borderColor: customActive ? colors.primary : colors.border,
              backgroundColor: customActive ? colors.primary + "20" : "transparent",
              overflow: "hidden",
            }}
          >
            <Pressable
              onPress={onOpenCustom}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingVertical: 6,
                paddingHorizontal: 12,
              }}
            >
              <Feather
                name="calendar"
                size={12}
                color={customActive ? colors.primary : colors.foreground}
              />
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: "Inter_600SemiBold",
                  color: customActive ? colors.primary : colors.foreground,
                }}
              >
                {customLabel}
              </Text>
            </Pressable>
            {customActive && (
              <Pressable
                onPress={onClearCustom}
                hitSlop={8}
                style={{ paddingVertical: 6, paddingRight: 10, paddingLeft: 2 }}
              >
                <Feather name="x" size={12} color={colors.primary} />
              </Pressable>
            )}
          </View>
        </ScrollView>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {ANALYTICS_PRESETS.map((p) => {
            const active = preset === p.key;
            return (
              <Pressable
                key={p.key}
                onPress={() => onSelectPreset(p.key)}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.primary + "20" : "transparent",
                }}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontFamily: "Inter_600SemiBold",
                    color: active ? colors.primary : colors.foreground,
                  }}
                >
                  {p.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {properties.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8 }}
          >
            <Pressable
              onPress={() => onSelectProperty(null)}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: selectedPropertyId == null ? colors.primary : colors.border,
                backgroundColor: selectedPropertyId == null ? colors.primary + "20" : "transparent",
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: "Inter_600SemiBold",
                  color: selectedPropertyId == null ? colors.primary : colors.foreground,
                }}
              >
                All properties
              </Text>
            </Pressable>
            {properties.map((p) => {
              const active = selectedPropertyId === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => onSelectProperty(p.id)}
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 12,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.primary + "20" : "transparent",
                  }}
                >
                  <Text
                    style={{
                      fontSize: 12,
                      fontFamily: "Inter_600SemiBold",
                      color: active ? colors.primary : colors.foreground,
                    }}
                    numberOfLines={1}
                  >
                    {p.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      <View style={[styles.statCard, { width: "100%", backgroundColor: colors.card, borderColor: colors.border, gap: 8 }]}>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>
          STANDARDS COMPLIANCE
        </Text>
        <Text style={subtitleStyle}>{filterLabel}</Text>
        {compliancePct !== null ? (
          <>
            <Text style={{ color: colors.foreground, fontSize: 32, fontFamily: "Inter_700Bold" }}>
              {compliancePct}%
            </Text>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: "hidden" }}>
              <View
                style={{
                  width: `${compliancePct}%`,
                  height: "100%",
                  backgroundColor: compliancePct >= 75 ? colors.success : colors.destructive,
                }}
              />
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular" }}>
              {analytics.complianceRate.compliant}/{analytics.complianceRate.total} standards on track
            </Text>
          </>
        ) : (
          <Text style={emptyStyle}>{emptyCopy}</Text>
        )}
      </View>

      <View style={[styles.statCard, { width: "100%", backgroundColor: colors.card, borderColor: colors.border, gap: 12 }]}>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>
          LOGS PER MONTH
        </Text>
        <Text style={subtitleStyle}>{filterLabel}</Text>
        {monthlySorted.length > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, height: 100 }}>
            {monthlySorted.map(([month, val]) => (
              <View key={month} style={{ flex: 1, alignItems: "center", gap: 4 }}>
                <Text style={{ fontSize: 10, color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
                  {val}
                </Text>
                <View
                  style={{
                    width: "100%",
                    height: `${(val / maxMonthly) * 80}%`,
                    backgroundColor: colors.primary,
                    borderRadius: 4,
                    minHeight: 4,
                  }}
                />
                <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>
                  {month.slice(5)}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={emptyStyle}>{emptyCopy}</Text>
        )}
      </View>

      <View style={[styles.statCard, { width: "100%", backgroundColor: colors.card, borderColor: colors.border, gap: 10 }]}>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>
          TOP PROPERTIES BY ACTIVITY
        </Text>
        <Text style={subtitleStyle}>{filterLabel}</Text>
        {totalsByProperty.length > 0 ? (
          totalsByProperty.map((t) => (
            <View key={t.propertyId} style={{ gap: 4 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text
                  style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 }}
                  numberOfLines={1}
                >
                  {t.propertyName}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>
                  {t.count}
                </Text>
              </View>
              <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.muted, overflow: "hidden" }}>
                <View
                  style={{
                    width: `${(t.count / maxTotal) * 100}%`,
                    height: "100%",
                    backgroundColor: colors.primary,
                  }}
                />
              </View>
            </View>
          ))
        ) : (
          <Text style={emptyStyle}>{emptyCopy}</Text>
        )}
      </View>

      <View style={[styles.statCard, { width: "100%", backgroundColor: colors.card, borderColor: colors.border, gap: 12 }]}>
        <Text style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>
          RATING TREND
        </Text>
        <Text style={subtitleStyle}>{filterLabel}</Text>
        {ratingTrend.length > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, height: 80 }}>
            {ratingTrend.map((r) => (
              <View key={r.month} style={{ flex: 1, alignItems: "center", gap: 4 }}>
                <Text style={{ fontSize: 10, color: colors.foreground, fontFamily: "Inter_600SemiBold" }}>
                  {r.avg.toFixed(1)}
                </Text>
                <View
                  style={{
                    width: "100%",
                    height: `${(r.avg / 5) * 60}%`,
                    backgroundColor: colors.score,
                    borderRadius: 4,
                    minHeight: 4,
                  }}
                />
                <Text style={{ fontSize: 10, color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>
                  {r.month.slice(5)}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={emptyStyle}>{emptyCopy}</Text>
        )}
      </View>
    </View>
  );
}

type NotifPrefMeta = { type: NotificationPrefType; title: string; subtitle: string };

type LegacyNotifKey = "notifyJobStarted" | "notifyJobCompleted";
type LegacyNotifMeta = { key: LegacyNotifKey; title: string; subtitle: string };

type NotifSection = {
  key: string;
  title: string;
  icon: keyof typeof Feather.glyphMap;
  legacy?: LegacyNotifMeta[];
  rows: NotifPrefMeta[];
};

const NOTIF_SECTIONS: NotifSection[] = [
  {
    key: "jobs",
    title: "Jobs",
    icon: "briefcase",
    legacy: [
      { key: "notifyJobStarted", title: "Job started alerts", subtitle: "Get notified when a provider starts a job." },
      { key: "notifyJobCompleted", title: "Job completed alerts", subtitle: "Get notified when a provider finishes a job." },
    ],
    rows: [
      { type: "assignment", title: "Job assignments", subtitle: "When you're assigned to a log/job." },
      { type: "unassignment", title: "Job unassignments", subtitle: "When you're removed from a job." },
      { type: "reassignment", title: "Job reassignments", subtitle: "When a job changes assignee on a property you own." },
      { type: "log", title: "New work logs", subtitle: "When someone logs work on a shared property." },
      { type: "rating", title: "Ratings received", subtitle: "When an owner rates a job you completed." },
    ],
  },
  {
    key: "work_orders",
    title: "Work orders",
    icon: "clipboard",
    rows: [
      { type: "work_order_assigned", title: "Work orders assigned", subtitle: "When a work order is assigned to you." },
      { type: "work_order_requested", title: "Approval requests", subtitle: "When a work order needs your approval." },
      { type: "work_order_complete", title: "Work order completed", subtitle: "When an assignee marks a work order ready for verification." },
      { type: "work_order_verified", title: "Work order verified", subtitle: "When an owner verifies a work order you completed." },
      { type: "work_order_approved", title: "Work order approved", subtitle: "When a work order you requested is approved." },
      { type: "work_order_rejected", title: "Work order rejected", subtitle: "When a work order you requested is rejected." },
      { type: "work_order_comment", title: "Work order comments", subtitle: "New comments on a work order you're involved with." },
    ],
  },
  {
    key: "messages",
    title: "Messages",
    icon: "message-circle",
    rows: [
      { type: "message", title: "Direct messages", subtitle: "When someone sends you a message." },
      { type: "invite", title: "Property invites", subtitle: "When you're added to a property." },
    ],
  },
  {
    key: "scheduling",
    title: "Scheduling",
    icon: "calendar",
    rows: [
      { type: "due_date_changed", title: "Due date changes", subtitle: "When a job's due date is moved, set, or cleared." },
      { type: "due_date_request", title: "Reschedule requests", subtitle: "When an assignee proposes a new due date." },
      { type: "due_date_request_accepted", title: "Reschedule accepted", subtitle: "When your reschedule request is accepted." },
      { type: "due_date_request_declined", title: "Reschedule declined", subtitle: "When your reschedule request is declined." },
    ],
  },
  {
    key: "standards",
    title: "Standards",
    icon: "shield",
    rows: [
      { type: "standard_overdue", title: "Overdue standards", subtitle: "When a property standard lapses past its cadence." },
    ],
  },
  {
    key: "questions",
    title: "Questions & requests",
    icon: "help-circle",
    rows: [
      { type: "question_asked", title: "New questions", subtitle: "When a client asks you a question." },
      { type: "request_received", title: "New requests", subtitle: "When a pro sends you a 'What I Need From You' request." },
      { type: "question_answered", title: "Answers to your questions", subtitle: "When a pro replies to a question you asked." },
    ],
  },
];

const NOTIF_SECTION_COLLAPSED_KEY = "round-house:notif-section-collapsed:v1";
const DEFAULT_NOTIF_COLLAPSED: Record<string, boolean> = {
  jobs: false,
  work_orders: true,
  messages: true,
  scheduling: true,
  standards: true,
  questions: true,
};

function useNotifSectionsCollapsed() {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(DEFAULT_NOTIF_COLLAPSED);
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(NOTIF_SECTION_COLLAPSED_KEY)
      .then((raw) => {
        if (cancelled) return;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
              const merged: Record<string, boolean> = { ...DEFAULT_NOTIF_COLLAPSED };
              for (const s of NOTIF_SECTIONS) {
                const v = (parsed as Record<string, unknown>)[s.key];
                if (typeof v === "boolean") merged[s.key] = v;
              }
              setCollapsed(merged);
            }
          } catch {
            // ignore corrupt value
          }
        }
        hydratedRef.current = true;
      })
      .catch(() => {
        hydratedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    AsyncStorage.setItem(NOTIF_SECTION_COLLAPSED_KEY, JSON.stringify(collapsed)).catch(() => {
      // ignore write failures
    });
  }, [collapsed]);

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  return { collapsed, toggle };
}

function NotificationSettings({
  user,
  colors,
  scrollViewRef,
  properties,
}: {
  user: UserProfile | undefined;
  colors: ReturnType<typeof useColors>;
  scrollViewRef: React.RefObject<ScrollView | null>;
  properties: ListPropertiesResponse["properties"];
}) {
  const queryClient = useQueryClient();
  const updateMe = useUpdateMe();
  const sendTest = useSendTestNotification();
  const { data: prefsData } = useListMyNotificationPrefs();
  const updatePref = useUpdateMyNotificationPref();
  const bulkUpdatePrefs = useBulkUpdateMyNotificationPrefs();
  const { collapsed: sectionsCollapsed, toggle: toggleSection } = useNotifSectionsCollapsed();
  const { data: overridesData } = useListMyPropertyNotificationOverrides();
  const clearOverride = useClearMyPropertyNotificationOverride();
  const [clearingPropertyId, setClearingPropertyId] = useState<number | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [optimisticLegacy, setOptimisticLegacy] = useState<{
    notifyJobStarted?: boolean;
    notifyJobCompleted?: boolean;
  }>({});
  const [optimisticPrefs, setOptimisticPrefs] = useState<
    Partial<Record<NotificationPrefType, boolean>>
  >({});
  const [testStatus, setTestStatus] = useState<
    | { kind: "idle" }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkMuteOpen, setBulkMuteOpen] = useState(false);
  type PendingUndo = {
    id: number;
    sectionTitle: string;
    appliedValue: boolean;
    prevPrefs: Partial<Record<NotificationPrefType, boolean>>;
    prevLegacy: Partial<Record<LegacyNotifKey, boolean>>;
  };
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoIdRef = useRef(0);
  const inFlightBulkRef = useRef<Promise<unknown> | null>(null);
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
  const [search, setSearch] = useState("");
  const [registerStatus, setRegisterStatus] = useState<
    | { kind: "idle" }
    | { kind: "pending" }
    | { kind: "success"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });

  if (!user) return null;

  const hasPushToken = user.hasPushToken === true;
  const pushUpdatedAt = user.pushTokenUpdatedAt ? new Date(user.pushTokenUpdatedAt) : null;
  const pushDaysSinceRefresh = pushUpdatedAt
    ? Math.floor((Date.now() - pushUpdatedAt.getTime()) / (24 * 60 * 60 * 1000))
    : null;
  const PUSH_INACTIVITY_DAYS = 60;
  const PUSH_WARNING_DAYS = 45;
  const pushNearingExpiry =
    hasPushToken && pushDaysSinceRefresh != null && pushDaysSinceRefresh >= PUSH_WARNING_DAYS;
  const pushDaysRemaining =
    pushDaysSinceRefresh != null
      ? Math.max(0, PUSH_INACTIVITY_DAYS - pushDaysSinceRefresh)
      : null;
  const formatLastRefreshed = (d: Date) => {
    const diffMs = Date.now() - d.getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? "" : "s"} ago`;
    const diffDay = Math.round(diffHr / 24);
    if (diffDay < 30) return `${diffDay} day${diffDay === 1 ? "" : "s"} ago`;
    const diffMonth = Math.round(diffDay / 30);
    if (diffMonth < 12) return `${diffMonth} month${diffMonth === 1 ? "" : "s"} ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  async function handleRegisterPush() {
    setRegisterStatus({ kind: "pending" });
    try {
      const token = await getDeviceExpoPushToken();
      if (!token) {
        setRegisterStatus({
          kind: "error",
          message:
            Platform.OS === "web"
              ? "Push notifications are only available in the mobile app."
              : "Permission denied. Enable notifications in your device settings, then try again.",
        });
        return;
      }
      const result = await syncPushTokenWithServer();
      await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      if (result === "failed") {
        setRegisterStatus({
          kind: "error",
          message: "Could not reach the server. Check your connection and try again.",
        });
        return;
      }
      setRegisterStatus({
        kind: "success",
        message: "Push enabled on this device.",
      });
    } catch {
      setRegisterStatus({
        kind: "error",
        message: "Could not register for push notifications. Please try again.",
      });
    }
  }

  async function handleSendTest() {
    setTestStatus({ kind: "idle" });
    try {
      await sendTest.mutateAsync();
      setTestStatus({
        kind: "success",
        message: "Test sent. Check your device for the notification.",
      });
    } catch (err) {
      const status = (err as { status?: number } | null)?.status;
      const message =
        status === 400
          ? "No push token registered yet. Open the app on your device and allow notifications."
          : "Could not send a test notification. Please try again.";
      setTestStatus({ kind: "error", message });
    }
  }

  const startedOn = optimisticLegacy.notifyJobStarted ?? user.notifyJobStarted ?? true;
  const completedOn = optimisticLegacy.notifyJobCompleted ?? user.notifyJobCompleted ?? true;

  async function setLegacyPref(
    key: "notifyJobStarted" | "notifyJobCompleted",
    value: boolean,
  ) {
    clearUndo();
    setOptimisticLegacy((prev) => ({ ...prev, [key]: value }));
    try {
      await updateMe.mutateAsync({ data: { [key]: value } });
      await queryClient.invalidateQueries({ queryKey: ["/api/users/me"] });
    } finally {
      setOptimisticLegacy((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  const prefByType = new Map<NotificationPrefType, boolean>(
    (prefsData?.prefs ?? []).map((p) => [p.type, p.enabled]),
  );

  function getPrefValue(type: NotificationPrefType): boolean {
    if (type in optimisticPrefs) return optimisticPrefs[type] ?? true;
    return prefByType.get(type) ?? true;
  }

  async function setOtherPref(type: NotificationPrefType, value: boolean) {
    clearUndo();
    setOptimisticPrefs((prev) => ({ ...prev, [type]: value }));
    try {
      await updatePref.mutateAsync({ data: { type, enabled: value } });
      await queryClient.invalidateQueries({ queryKey: getListMyNotificationPrefsQueryKey() });
    } finally {
      setOptimisticPrefs((prev) => {
        const next = { ...prev };
        delete next[type];
        return next;
      });
    }
  }

  async function setSectionAll(section: NotifSection, value: boolean) {
    const prefTypes = section.rows.map((r) => r.type);
    const legacyKeys = (section.legacy ?? []).map((r) => r.key);
    if (prefTypes.length === 0 && legacyKeys.length === 0) return;

    const prevPrefs: Partial<Record<NotificationPrefType, boolean>> = {};
    for (const t of prefTypes) prevPrefs[t] = getPrefValue(t);
    const prevLegacy: Partial<Record<LegacyNotifKey, boolean>> = {};
    for (const k of legacyKeys) {
      prevLegacy[k] = k === "notifyJobStarted" ? startedOn : completedOn;
    }
    const willChange =
      prefTypes.some((t) => prevPrefs[t] !== value) ||
      legacyKeys.some((k) => prevLegacy[k] !== value);

    clearUndo();

    if (prefTypes.length > 0) {
      setOptimisticPrefs((prev) => {
        const next = { ...prev };
        for (const t of prefTypes) next[t] = value;
        return next;
      });
    }
    if (legacyKeys.length > 0) {
      setOptimisticLegacy((prev) => {
        const next = { ...prev };
        for (const k of legacyKeys) next[k] = value;
        return next;
      });
    }

    if (willChange) {
      undoIdRef.current += 1;
      const myUndoId = undoIdRef.current;
      setPendingUndo({
        id: myUndoId,
        sectionTitle: section.title,
        appliedValue: value,
        prevPrefs,
        prevLegacy,
      });
      undoTimerRef.current = setTimeout(() => {
        setPendingUndo((cur) => (cur && cur.id === myUndoId ? null : cur));
        undoTimerRef.current = null;
      }, 5000);
    }

    setBulkError(null);
    const work = (async () => {
      try {
        const tasks: Promise<unknown>[] = [];
        if (prefTypes.length > 0) {
          tasks.push(
            bulkUpdatePrefs.mutateAsync({ data: { types: prefTypes, enabled: value } }),
          );
        }
        if (legacyKeys.length > 0) {
          const updates: Record<string, boolean> = {};
          for (const k of legacyKeys) updates[k] = value;
          tasks.push(updateMe.mutateAsync({ data: updates }));
        }
        const results = await Promise.allSettled(tasks);
        const anyFailed = results.some((r) => r.status === "rejected");
        if (anyFailed) {
          setBulkError(
            `Could not turn ${value ? "on" : "off"} all ${section.title} notifications. Please try again.`,
          );
        }
      } catch {
        setBulkError(
          `Could not turn ${value ? "on" : "off"} all ${section.title} notifications. Please try again.`,
        );
      } finally {
        if (prefTypes.length > 0) {
          await queryClient.invalidateQueries({ queryKey: getListMyNotificationPrefsQueryKey() });
        }
        if (legacyKeys.length > 0) {
          await queryClient.invalidateQueries({ queryKey: ["/api/users/me"] });
        }
        if (prefTypes.length > 0) {
          setOptimisticPrefs((prev) => {
            const next = { ...prev };
            for (const t of prefTypes) delete next[t];
            return next;
          });
        }
        if (legacyKeys.length > 0) {
          setOptimisticLegacy((prev) => {
            const next = { ...prev };
            for (const k of legacyKeys) delete next[k];
            return next;
          });
        }
      }
    })();
    inFlightBulkRef.current = work;
    try {
      await work;
    } finally {
      if (inFlightBulkRef.current === work) inFlightBulkRef.current = null;
    }
  }

  async function performUndo() {
    const undo = pendingUndo;
    if (!undo) return;
    clearUndo();
    const prefEntries = Object.entries(undo.prevPrefs) as [NotificationPrefType, boolean][];
    const legacyEntries = Object.entries(undo.prevLegacy) as [LegacyNotifKey, boolean][];

    if (prefEntries.length > 0) {
      setOptimisticPrefs((prev) => {
        const next = { ...prev };
        for (const [t, v] of prefEntries) next[t] = v;
        return next;
      });
    }
    if (legacyEntries.length > 0) {
      setOptimisticLegacy((prev) => {
        const next = { ...prev };
        for (const [k, v] of legacyEntries) next[k] = v;
        return next;
      });
    }

    setBulkError(null);
    if (inFlightBulkRef.current) {
      try {
        await inFlightBulkRef.current;
      } catch {
        // ignore — we still want to apply the undo regardless of forward outcome
      }
    }
    try {
      const tasks: Promise<unknown>[] = [];
      const trueTypes = prefEntries.filter(([, v]) => v).map(([t]) => t);
      const falseTypes = prefEntries.filter(([, v]) => !v).map(([t]) => t);
      if (trueTypes.length > 0) {
        tasks.push(bulkUpdatePrefs.mutateAsync({ data: { types: trueTypes, enabled: true } }));
      }
      if (falseTypes.length > 0) {
        tasks.push(bulkUpdatePrefs.mutateAsync({ data: { types: falseTypes, enabled: false } }));
      }
      if (legacyEntries.length > 0) {
        const updates: Record<string, boolean> = {};
        for (const [k, v] of legacyEntries) updates[k] = v;
        tasks.push(updateMe.mutateAsync({ data: updates }));
      }
      const results = await Promise.allSettled(tasks);
      if (results.some((r) => r.status === "rejected")) {
        setBulkError(`Could not undo the ${undo.sectionTitle} change. Please try again.`);
      }
    } catch {
      setBulkError(`Could not undo the ${undo.sectionTitle} change. Please try again.`);
    } finally {
      if (prefEntries.length > 0) {
        await queryClient.invalidateQueries({ queryKey: getListMyNotificationPrefsQueryKey() });
      }
      if (legacyEntries.length > 0) {
        await queryClient.invalidateQueries({ queryKey: ["/api/users/me"] });
      }
      if (prefEntries.length > 0) {
        setOptimisticPrefs((prev) => {
          const next = { ...prev };
          for (const [t] of prefEntries) delete next[t];
          return next;
        });
      }
      if (legacyEntries.length > 0) {
        setOptimisticLegacy((prev) => {
          const next = { ...prev };
          for (const [k] of legacyEntries) delete next[k];
          return next;
        });
      }
    }
  }

  async function handleClearOverride(propertyId: number) {
    setClearingPropertyId(propertyId);
    setOverrideError(null);
    try {
      await clearOverride.mutateAsync({ propertyId });
      await queryClient.invalidateQueries({
        queryKey: getListMyPropertyNotificationOverridesQueryKey(),
      });
    } catch {
      setOverrideError("Could not reset that property. Please try again.");
    } finally {
      setClearingPropertyId(null);
    }
  }

  const overrides = overridesData?.overrides ?? [];
  const overrideByPropertyId = new Map(overrides.map((o) => [o.propertyId, o]));
  const pickerProperties = properties.map((p) => {
    const o = overrideByPropertyId.get(p.id);
    return {
      id: p.id,
      name: p.name,
      notifyJobStarted: o?.notifyJobStarted ?? null,
      notifyJobCompleted: o?.notifyJobCompleted ?? null,
    };
  });
  const startedOverrideCount = overrides.filter((o) => o.notifyJobStarted != null).length;
  const completedOverrideCount = overrides.filter((o) => o.notifyJobCompleted != null).length;
  const overrideCountByLegacyKey: Record<LegacyNotifKey, number> = {
    notifyJobStarted: startedOverrideCount,
    notifyJobCompleted: completedOverrideCount,
  };
  const sectionOverrideCountByKey: Record<string, number> = {
    jobs: overrides.filter(
      (o) => o.notifyJobStarted != null || o.notifyJobCompleted != null,
    ).length,
  };
  const overridesSectionRef = useRef<View>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [overridesHighlighted, setOverridesHighlighted] = useState(false);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const scrollToOverrides = useCallback(() => {
    const scrollNode = scrollViewRef.current;
    const sectionNode = overridesSectionRef.current;
    if (!scrollNode || !sectionNode) return;
    const handle = findNodeHandle(scrollNode);
    if (handle == null) return;
    sectionNode.measureLayout(
      handle,
      (_x, y) => {
        scrollNode.scrollTo({ y: Math.max(0, y - 16), animated: true });
      },
      () => {
        // measure failed; ignore
      },
    );
    setOverridesHighlighted(true);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setOverridesHighlighted(false);
    }, 1600);
  }, [scrollViewRef]);

  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          fontSize: 11,
          fontFamily: "Inter_700Bold",
          letterSpacing: 0.8,
          color: colors.mutedForeground,
          marginTop: 8,
        }}
      >
        NOTIFICATIONS
      </Text>
      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 12,
          overflow: "hidden",
          padding: 14,
          gap: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: hasPushToken
                ? colors.success + "20"
                : colors.mutedForeground + "20",
            }}
          >
            <Feather
              name={hasPushToken ? "check" : "bell-off"}
              size={14}
              color={hasPushToken ? colors.success : colors.mutedForeground}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontSize: 14, fontFamily: "Inter_600SemiBold" }}>
              {hasPushToken ? "Push enabled on this device" : "Push not registered"}
            </Text>
            <Text
              style={{ color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular" }}
            >
              {hasPushToken
                ? pushUpdatedAt
                  ? `Last refreshed ${formatLastRefreshed(pushUpdatedAt)}`
                  : "Ready to receive notifications."
                : "Allow notifications to receive job alerts."}
            </Text>
            {pushNearingExpiry ? (
              <Text
                style={{
                  marginTop: 4,
                  color: "#B45309",
                  fontSize: 12,
                  fontFamily: "Inter_500Medium",
                }}
              >
                {pushDaysRemaining === 0
                  ? "Re-register soon to keep receiving alerts."
                  : `Re-register within ${pushDaysRemaining} day${
                      pushDaysRemaining === 1 ? "" : "s"
                    } to keep receiving alerts.`}
              </Text>
            ) : null}
          </View>
        </View>
        <Pressable
          onPress={handleRegisterPush}
          disabled={registerStatus.kind === "pending"}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: hasPushToken ? colors.border : colors.primary,
            backgroundColor: hasPushToken ? "transparent" : colors.primary + "15",
            opacity: registerStatus.kind === "pending" ? 0.6 : 1,
          }}
        >
          <Feather
            name="refresh-cw"
            size={13}
            color={hasPushToken ? colors.foreground : colors.primary}
          />
          <Text
            style={{
              color: hasPushToken ? colors.foreground : colors.primary,
              fontSize: 13,
              fontFamily: "Inter_600SemiBold",
            }}
          >
            {registerStatus.kind === "pending"
              ? "Registering..."
              : hasPushToken
              ? "Re-register this device"
              : "Register this device"}
          </Text>
        </Pressable>
        {registerStatus.kind === "success" || registerStatus.kind === "error" ? (
          <Text
            style={{
              fontSize: 12,
              fontFamily: "Inter_500Medium",
              color:
                registerStatus.kind === "success" ? colors.success : colors.destructive,
            }}
          >
            {registerStatus.message}
          </Text>
        ) : null}
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 4,
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 12,
        }}
      >
        <Feather name="search" size={14} color={colors.mutedForeground} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search notification settings"
          placeholderTextColor={colors.mutedForeground}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          accessibilityLabel="Search notification settings"
          style={{
            flex: 1,
            color: colors.foreground,
            fontSize: 14,
            fontFamily: "Inter_400Regular",
            paddingVertical: 8,
          }}
        />
        {search.length > 0 ? (
          <Pressable
            onPress={() => setSearch("")}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </View>

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
            name={pendingUndo.appliedValue ? "bell" : "bell-off"}
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
            {pendingUndo.appliedValue
              ? `Turned on all ${pendingUndo.sectionTitle} notifications`
              : `Muted all ${pendingUndo.sectionTitle} notifications`}
          </Text>
          <Pressable
            onPress={performUndo}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Undo ${pendingUndo.sectionTitle} change`}
            style={{
              paddingVertical: 4,
              paddingHorizontal: 10,
              borderRadius: 8,
              backgroundColor: colors.background + "22",
            }}
          >
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
          </Pressable>
        </View>
      ) : null}

      {(() => {
        const q = search.trim().toLowerCase();
        const matches = (title: string, subtitle: string) =>
          q.length === 0 ||
          title.toLowerCase().includes(q) ||
          subtitle.toLowerCase().includes(q);
        const filtered = NOTIF_SECTIONS.map((section) => {
          const legacyRows = (section.legacy ?? []).filter((r) =>
            matches(r.title, r.subtitle),
          );
          const prefRows = section.rows.filter((r) =>
            matches(r.title, r.subtitle),
          );
          return { section, legacyRows, prefRows };
        }).filter(
          ({ legacyRows, prefRows }) =>
            q.length === 0 || legacyRows.length + prefRows.length > 0,
        );

        if (q.length > 0 && filtered.length === 0) {
          return (
            <View
              style={{
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 12,
                padding: 16,
                alignItems: "center",
                gap: 4,
              }}
            >
              <Text
                style={{
                  color: colors.foreground,
                  fontSize: 13,
                  fontFamily: "Inter_600SemiBold",
                }}
              >
                No matching settings
              </Text>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontSize: 12,
                  fontFamily: "Inter_400Regular",
                  textAlign: "center",
                }}
              >
                Try a different word like &ldquo;reschedule&rdquo; or &ldquo;comment&rdquo;.
              </Text>
            </View>
          );
        }

        return filtered.map(({ section, legacyRows: filteredLegacy, prefRows: filteredPrefs }) => {
        const searching = q.length > 0;
        const savedCollapsed = sectionsCollapsed[section.key] ?? false;
        const isCollapsed = searching ? false : savedCollapsed;
        const legacyRows = section.legacy ?? [];
        const totalRows = legacyRows.length + section.rows.length;
        const enabledCount =
          legacyRows.reduce(
            (n, r) => n + ((r.key === "notifyJobStarted" ? startedOn : completedOn) ? 1 : 0),
            0,
          ) + section.rows.reduce((n, r) => n + (getPrefValue(r.type) ? 1 : 0), 0);
        const allOn = totalRows > 0 && enabledCount === totalRows;
        const sectionOverrideCount = sectionOverrideCountByKey[section.key] ?? 0;
        return (
          <View
            key={section.key}
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                paddingVertical: 12,
                paddingHorizontal: 14,
                borderBottomWidth: isCollapsed ? 0 : StyleSheet.hairlineWidth,
                borderBottomColor: colors.border,
              }}
            >
              <Pressable
                onPress={searching ? undefined : () => toggleSection(section.key)}
                disabled={searching}
                accessibilityRole="button"
                accessibilityLabel={`${section.title}, ${enabledCount} of ${totalRows} on.${
                  searching ? "" : ` ${isCollapsed ? "Expand" : "Collapse"}.`
                }`}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.primary + "15",
                  }}
                >
                  <Feather name={section.icon} size={14} color={colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontSize: 14,
                      fontFamily: "Inter_600SemiBold",
                    }}
                  >
                    {section.title}
                  </Text>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontSize: 12,
                      fontFamily: "Inter_400Regular",
                    }}
                  >
                    {enabledCount} of {totalRows} on
                  </Text>
                </View>
                <Feather
                  name={isCollapsed ? "chevron-down" : "chevron-up"}
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
              {sectionOverrideCount > 0 ? (
                <Pressable
                  onPress={scrollToOverrides}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={`${sectionOverrideCount} ${
                    sectionOverrideCount === 1 ? "property overrides" : "properties override"
                  } ${section.title} alerts. Jump to per-property overrides.`}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    paddingVertical: 3,
                    paddingHorizontal: 8,
                    borderRadius: 999,
                    backgroundColor: colors.primary + "18",
                  }}
                >
                  <Feather name="bell-off" size={10} color={colors.primary} />
                  <Text
                    style={{
                      fontSize: 11,
                      fontFamily: "Inter_600SemiBold",
                      color: colors.primary,
                    }}
                  >
                    {sectionOverrideCount}{" "}
                    {sectionOverrideCount === 1 ? "override" : "overrides"}
                  </Text>
                </Pressable>
              ) : null}
              <Switch
                value={allOn}
                onValueChange={(v) => setSectionAll(section, v)}
                disabled={bulkUpdatePrefs.isPending || updateMe.isPending}
                accessibilityLabel={`Turn ${allOn ? "off" : "on"} all ${section.title} notifications`}
              />
            </View>
            {isCollapsed ? null : (
              <View>
                {filteredLegacy.map((row, i) => {
                  const value = row.key === "notifyJobStarted" ? startedOn : completedOn;
                  const isLast = i === filteredLegacy.length - 1 && filteredPrefs.length === 0;
                  const count = overrideCountByLegacyKey[row.key] ?? 0;
                  return (
                    <NotifRow
                      key={row.key}
                      colors={colors}
                      title={row.title}
                      subtitle={row.subtitle}
                      highlight={search}
                      value={value}
                      onValueChange={(v) => setLegacyPref(row.key, v)}
                      showDivider={!isLast}
                      overrideCount={count}
                      onOverrideCountPress={count > 0 ? scrollToOverrides : undefined}
                    />
                  );
                })}
                {filteredPrefs.map((row, i) => (
                  <NotifRow
                    key={row.type}
                    colors={colors}
                    title={row.title}
                    subtitle={row.subtitle}
                    highlight={search}
                    value={getPrefValue(row.type)}
                    onValueChange={(v) => setOtherPref(row.type, v)}
                    showDivider={i < filteredPrefs.length - 1}
                  />
                ))}
              </View>
            )}
          </View>
        );
        });
      })()}

      {bulkError ? (
        <Text
          style={{
            fontSize: 12,
            fontFamily: "Inter_500Medium",
            color: colors.destructive,
          }}
        >
          {bulkError}
        </Text>
      ) : null}

      {properties.length > 0 ? (
        <Pressable
          onPress={() => setBulkMuteOpen(true)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
          accessibilityRole="button"
          accessibilityLabel="Mute job alerts on multiple properties"
        >
          <Feather name="bell-off" size={14} color={colors.foreground} />
          <Text
            style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_600SemiBold" }}
          >
            Mute alerts on multiple properties
          </Text>
        </Pressable>
      ) : null}

      {overrides.length > 0 ? (
        <View ref={overridesSectionRef} collapsable={false} style={{ gap: 8 }}>
          <Text
            style={{
              fontSize: 11,
              fontFamily: "Inter_700Bold",
              letterSpacing: 0.8,
              color: overridesHighlighted ? colors.primary : colors.mutedForeground,
              marginTop: 12,
            }}
          >
            PER-PROPERTY OVERRIDES
          </Text>
          <Text
            style={{
              fontSize: 12,
              fontFamily: "Inter_400Regular",
              color: colors.mutedForeground,
              marginTop: -4,
            }}
          >
            Properties where your job alert preferences differ from the global default above.
          </Text>
          <View
            style={{
              backgroundColor: colors.card,
              borderColor: overridesHighlighted ? colors.primary : colors.border,
              borderWidth: overridesHighlighted ? 2 : 1,
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            {overrides.map((o, i) => {
              const isClearing = clearingPropertyId === o.propertyId;
              const startedLabel =
                o.notifyJobStarted == null
                  ? null
                  : `Started: ${o.notifyJobStarted ? "On" : "Off"}`;
              const completedLabel =
                o.notifyJobCompleted == null
                  ? null
                  : `Completed: ${o.notifyJobCompleted ? "On" : "Off"}`;
              const labels = [startedLabel, completedLabel].filter(
                (s): s is string => s != null,
              );
              return (
                <View
                  key={o.propertyId}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    padding: 14,
                    borderBottomWidth:
                      i < overrides.length - 1 ? StyleSheet.hairlineWidth : 0,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text
                      style={{
                        color: colors.foreground,
                        fontSize: 14,
                        fontFamily: "Inter_600SemiBold",
                      }}
                      numberOfLines={1}
                    >
                      {o.propertyName}
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                      {labels.map((label) => {
                        const off = label.endsWith("Off");
                        return (
                          <View
                            key={label}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              gap: 4,
                              paddingVertical: 3,
                              paddingHorizontal: 8,
                              borderRadius: 999,
                              backgroundColor: off
                                ? colors.destructive + "20"
                                : colors.success + "20",
                            }}
                          >
                            <Feather
                              name={off ? "bell-off" : "bell"}
                              size={10}
                              color={off ? colors.destructive : colors.success}
                            />
                            <Text
                              style={{
                                fontSize: 11,
                                fontFamily: "Inter_600SemiBold",
                                color: off ? colors.destructive : colors.success,
                              }}
                            >
                              {label}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                  <Pressable
                    onPress={() => handleClearOverride(o.propertyId)}
                    disabled={isClearing}
                    hitSlop={8}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: colors.border,
                      backgroundColor: colors.background,
                      opacity: isClearing ? 0.6 : 1,
                    }}
                  >
                    <Feather name="rotate-ccw" size={12} color={colors.foreground} />
                    <Text
                      style={{
                        fontSize: 12,
                        fontFamily: "Inter_600SemiBold",
                        color: colors.foreground,
                      }}
                    >
                      {isClearing ? "Resetting..." : "Reset"}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
          {overrideError ? (
            <Text
              style={{
                fontSize: 12,
                fontFamily: "Inter_500Medium",
                color: colors.destructive,
              }}
            >
              {overrideError}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Pressable
        onPress={handleSendTest}
        disabled={sendTest.isPending}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          opacity: sendTest.isPending ? 0.6 : 1,
        }}
      >
        <Feather name="bell" size={14} color={colors.foreground} />
        <Text style={{ color: colors.foreground, fontSize: 13, fontFamily: "Inter_600SemiBold" }}>
          {sendTest.isPending ? "Sending test..." : "Send test notification"}
        </Text>
      </Pressable>
      {testStatus.kind !== "idle" ? (
        <Text
          style={{
            fontSize: 12,
            fontFamily: "Inter_500Medium",
            color: testStatus.kind === "success" ? colors.success : colors.destructive,
          }}
        >
          {testStatus.message}
        </Text>
      ) : null}

      <BulkPropertyMutePickerModal
        visible={bulkMuteOpen}
        onClose={() => setBulkMuteOpen(false)}
        properties={pickerProperties}
        globalNotifyJobStarted={startedOn}
        globalNotifyJobCompleted={completedOn}
      />
    </View>
  );
}

function highlightText(
  text: string,
  query: string,
  baseStyle: { color: string; fontSize: number; fontFamily: string },
  highlightColor: string,
) {
  const q = query.trim();
  if (!q) return <Text style={baseStyle}>{text}</Text>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: { text: string; match: boolean }[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(needle, i);
    if (idx === -1) {
      parts.push({ text: text.slice(i), match: false });
      break;
    }
    if (idx > i) parts.push({ text: text.slice(i, idx), match: false });
    parts.push({ text: text.slice(idx, idx + needle.length), match: true });
    i = idx + needle.length;
  }
  return (
    <Text style={baseStyle}>
      {parts.map((p, k) =>
        p.match ? (
          <Text
            key={k}
            style={{
              backgroundColor: highlightColor + "55",
              fontFamily: "Inter_700Bold",
            }}
          >
            {p.text}
          </Text>
        ) : (
          <Text key={k}>{p.text}</Text>
        ),
      )}
    </Text>
  );
}

function NotifRow({
  colors,
  title,
  subtitle,
  highlight,
  value,
  onValueChange,
  showDivider,
  overrideCount,
  onOverrideCountPress,
}: {
  colors: ReturnType<typeof useColors>;
  title: string;
  subtitle: string;
  highlight?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  showDivider?: boolean;
  overrideCount?: number;
  onOverrideCountPress?: () => void;
}) {
  const hasOverrideBadge = (overrideCount ?? 0) > 0;
  const q = highlight ?? "";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 14,
        borderBottomWidth: showDivider ? StyleSheet.hairlineWidth : 0,
        borderBottomColor: colors.border,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        {highlightText(
          title,
          q,
          { color: colors.foreground, fontSize: 14, fontFamily: "Inter_600SemiBold" },
          colors.primary,
        )}
        {highlightText(
          subtitle,
          q,
          { color: colors.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular" },
          colors.primary,
        )}
        {hasOverrideBadge ? (
          <Pressable
            onPress={onOverrideCountPress}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`${overrideCount} ${
              overrideCount === 1 ? "property overrides" : "properties override"
            } this alert. Jump to per-property overrides.`}
            style={{
              alignSelf: "flex-start",
              marginTop: 4,
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              paddingVertical: 3,
              paddingHorizontal: 8,
              borderRadius: 999,
              backgroundColor: colors.primary + "18",
            }}
          >
            <Feather name="bell-off" size={10} color={colors.primary} />
            <Text
              style={{
                fontSize: 11,
                fontFamily: "Inter_600SemiBold",
                color: colors.primary,
              }}
            >
              {overrideCount}{" "}
              {overrideCount === 1 ? "property overridden" : "properties overridden"}
            </Text>
          </Pressable>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

function SharePromptSetting({ colors }: { colors: ReturnType<typeof useColors> }) {
  const [askEnabled, setAskEnabled] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(SHARE_PROMPT_SKIP_KEY)
      .then((stored) => {
        if (cancelled) return;
        setAskEnabled(stored !== "1");
        setHydrated(true);
      })
      .catch(() => {
        if (cancelled) return;
        setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onToggle = useCallback(async (next: boolean) => {
    const prev = askEnabled;
    setAskEnabled(next);
    setError(null);
    try {
      if (next) {
        await AsyncStorage.removeItem(SHARE_PROMPT_SKIP_KEY);
      } else {
        await AsyncStorage.setItem(SHARE_PROMPT_SKIP_KEY, "1");
      }
    } catch {
      setAskEnabled(prev);
      setError("Couldn't save that change. Please try again.");
    }
  }, [askEnabled]);

  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          fontSize: 11,
          fontFamily: "Inter_700Bold",
          letterSpacing: 0.8,
          color: colors.mutedForeground,
          marginTop: 8,
        }}
      >
        SHARING
      </Text>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          padding: 14,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={{
              fontSize: 14,
              fontFamily: "Inter_600SemiBold",
              color: colors.foreground,
            }}
          >
            Ask for a note when sharing photos
          </Text>
          <Text
            style={{
              fontSize: 12,
              fontFamily: "Inter_400Regular",
              color: colors.mutedForeground,
            }}
          >
            Turn off to skip the note prompt and share right away.
          </Text>
        </View>
        <Switch
          value={askEnabled}
          onValueChange={onToggle}
          disabled={!hydrated}
          accessibilityLabel="Ask for a note when sharing photos"
        />
      </View>
      {error ? (
        <Text
          style={{
            fontSize: 12,
            fontFamily: "Inter_500Medium",
            color: colors.destructive,
          }}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  profileSearchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
  },
  profileSearchText: { fontSize: 13, fontFamily: "Inter_500Medium", flex: 1 },
  viewFullProfileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  viewFullProfileText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  logoImage: { width: 40, height: 40 },
  identityMeta: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 2,
  },
  identityName: { fontSize: 16, fontFamily: "Inter_700Bold" },
  identityHandle: { fontSize: 13, fontFamily: "Inter_400Regular" },
  searchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  searchBtnText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  content: { padding: 16, gap: 16 },
  analyticsWindow: {
    gap: 12,
  },
  windowHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  windowTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  subSectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  profileCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    flexDirection: "row",
    gap: 16,
    position: "relative",
    alignItems: "center",
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarText: { fontSize: 24, fontFamily: "Inter_700Bold" },
  avatarImage: { width: "100%", height: "100%", borderRadius: 30 },
  editBtn: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  profileInfo: { flex: 1, gap: 4 },
  profileName: { fontSize: 20, fontFamily: "Inter_700Bold", flexShrink: 1 },
  profileCompany: { fontSize: 22, fontFamily: "Inter_700Bold", flexShrink: 1, lineHeight: 26 },
  profileNameSecondary: { fontSize: 14, fontFamily: "Inter_500Medium", marginTop: 2 },
  profileHandle: { fontSize: 12, fontFamily: "Inter_400Regular", marginTop: 2 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: {
    width: "47%",
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    gap: 6,
  },
  statValue: { fontSize: 28, fontFamily: "Inter_700Bold" },
  statLabel: { fontSize: 12, fontFamily: "Inter_400Regular" },
  signOutBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 4,
  },
  signOutText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  footer: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textAlign: "center",
    marginTop: 8,
    opacity: 0.6,
  },
  contactCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  logoSloganRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  contactLogoWrap: {
    alignItems: "flex-start",
    justifyContent: "center",
  },
  contactLogo: {
    width: 104,
    height: 104,
  },
  sloganBlock: {
    flex: 1,
    gap: 4,
  },
  sloganText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    fontStyle: "italic",
    lineHeight: 19,
  },
  sloganAuthor: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
  },
  contactText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    flex: 1,
  },
  modalRoot: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
});

function ContactCard({
  user,
  activeMode,
  colors,
}: {
  user: UserProfile | undefined;
  activeMode: UserModeProfile | null;
  colors: ReturnType<typeof useColors>;
}) {
  if (!user) return null;
  // Per-account contact info lives on the active mode's intakeData. Only the
  // auth-identity email (user.email) is user-level, but we don't show it here
  // unless the account hasn't set its own contact email yet.
  const md = (activeMode?.intakeData ?? {}) as Record<string, unknown>;
  const pick = (k: string): string | null => {
    const v = md[k];
    return typeof v === "string" && v.trim() ? v : null;
  };
  const companyName = pick("companyName") ?? pick("placeName");
  const address = pick("address");
  const phone = pick("phone");
  const contactEmail = pick("contactEmail");
  const website = pick("website");
  const instagram = pick("instagram");
  const logoUrl = pick("companyLogoUrl") ?? pick("logoUrl");
  const logoUri = resolveStorageUrl(logoUrl, activeMode?.id ?? null);
  const slogan = pick("slogan");
  const sloganAuthor = pick("sloganAuthor");
  const showSloganAuthor =
    typeof md.showSloganAuthor === "boolean" ? md.showSloganAuthor : true;
  const items: { icon: keyof typeof Feather.glyphMap; text: string; onPress?: () => void }[] = [];
  if (companyName) items.push({ icon: "briefcase", text: companyName });
  if (phone) {
    items.push({
      icon: "phone",
      text: phone,
      onPress: () => Linking.openURL(`tel:${phone.replace(/[^0-9+]/g, "")}`),
    });
  }
  if (contactEmail) {
    items.push({
      icon: "mail",
      text: contactEmail,
      onPress: () => Linking.openURL(`mailto:${contactEmail}`),
    });
  }
  if (website) {
    const url = website.startsWith("http") ? website : `https://${website}`;
    items.push({ icon: "globe", text: website, onPress: () => Linking.openURL(url) });
  }
  if (instagram) {
    const handle = instagram.replace(/^@/, "");
    items.push({
      icon: "instagram",
      text: `@${handle}`,
      onPress: () => Linking.openURL(`https://instagram.com/${handle}`),
    });
  }
  if (address) items.push({ icon: "map-pin", text: address });
  if (items.length === 0 && !logoUri && !slogan) return null;
  // Logo + slogan share a single horizontal row. Slogan is wrapped in
  // parentheses; the author line below it is gated by the per-account
  // showSloganAuthor toggle in the editor.
  const renderSloganBlock = slogan ? (
    <View style={styles.sloganBlock}>
      <Text
        style={[styles.sloganText, { color: colors.foreground }]}
        numberOfLines={4}
      >
        “{slogan}”
      </Text>
      {showSloganAuthor && sloganAuthor ? (
        <Text
          style={[styles.sloganAuthor, { color: colors.mutedForeground }]}
          numberOfLines={1}
        >
          — {sloganAuthor}
        </Text>
      ) : null}
    </View>
  ) : null;
  return (
    <View style={[styles.contactCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {logoUri || renderSloganBlock ? (
        <View style={styles.logoSloganRow}>
          {logoUri ? (
            <View style={styles.contactLogoWrap}>
              <Image source={{ uri: logoUri }} style={styles.contactLogo} resizeMode="contain" />
            </View>
          ) : null}
          {renderSloganBlock}
        </View>
      ) : null}
      {items.map((it, idx) => (
        <Pressable
          key={idx}
          onPress={it.onPress}
          disabled={!it.onPress}
          style={[
            styles.contactRow,
            {
              borderTopWidth: idx === 0 ? 0 : StyleSheet.hairlineWidth,
              borderTopColor: colors.border,
            },
          ]}
        >
          <Feather name={it.icon} size={15} color={colors.mutedForeground} />
          <Text style={[styles.contactText, { color: colors.foreground }]} numberOfLines={1}>
            {it.text}
          </Text>
          {it.onPress ? (
            <Feather name="external-link" size={12} color={colors.mutedForeground} />
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

function AboutCard({
  user,
  activeMode,
  colors,
  onEdit,
}: {
  user: UserProfile | undefined;
  activeMode: UserModeProfile | null;
  colors: ReturnType<typeof useColors>;
  onEdit: () => void;
}) {
  const md = (activeMode?.intakeData ?? {}) as Record<string, unknown>;
  const fromMode = typeof md.bio === "string" ? md.bio.trim() : "";
  const fromUser =
    typeof user?.bio === "string" ? user.bio.trim() : "";
  const text = fromMode || fromUser;
  if (!text) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          fontSize: 11,
          fontFamily: "Inter_700Bold",
          letterSpacing: 0.8,
          color: colors.mutedForeground,
          paddingHorizontal: 4,
        }}
      >
        ABOUT SERVICES
      </Text>
      <Pressable
        onPress={onEdit}
        style={[styles.contactCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        accessibilityRole="button"
        accessibilityLabel="Edit about services"
      >
        <View style={{ paddingHorizontal: 14, paddingVertical: 14 }}>
          <Text
            style={{
              fontSize: 14,
              fontFamily: "Inter_400Regular",
              lineHeight: 20,
              color: colors.foreground,
            }}
          >
            {text}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

function HomeBaseCard({
  activeMode,
  colors,
  onEdit,
}: {
  activeMode: UserModeProfile | null;
  colors: ReturnType<typeof useColors>;
  onEdit: () => void;
}) {
  if (!activeMode || activeMode.kind !== "home") return null;
  const data = (activeMode.intakeData ?? {}) as Record<string, unknown>;
  const placeName =
    typeof data.placeName === "string" && data.placeName.trim().length > 0
      ? data.placeName.trim()
      : null;
  const neighborhood =
    typeof data.neighborhood === "string" && data.neighborhood.trim().length > 0
      ? data.neighborhood.trim()
      : null;
  const placeAddress =
    typeof data.placeAddress === "string" && data.placeAddress.trim().length > 0
      ? data.placeAddress.trim()
      : null;
  if (!placeName && !neighborhood && !placeAddress) return null;
  const subtitle = [neighborhood, placeAddress].filter(Boolean).join(" • ");
  return (
    <Pressable
      onPress={onEdit}
      style={[styles.contactCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      accessibilityRole="button"
      accessibilityLabel="Edit home base"
    >
      <View style={styles.contactRow}>
        <Feather name="home" size={15} color={colors.mutedForeground} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.contactText, { color: colors.foreground }]} numberOfLines={1}>
            {placeName ?? "Home base"}
          </Text>
          {subtitle ? (
            <Text
              style={[styles.contactText, { color: colors.mutedForeground, fontSize: 12 }]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        <Feather name="edit-2" size={12} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

function SettingsModal({
  visible,
  onClose,
  user,
  colors,
  properties,
  onSignOut,
}: {
  visible: boolean;
  onClose: () => void;
  user: UserProfile | undefined;
  colors: ReturnType<typeof useColors>;
  properties: ListPropertiesResponse["properties"];
  onSignOut: () => void;
}) {
  const insets = useSafeAreaInsets();
  const innerScrollRef = useRef<ScrollView>(null);
  const colorScheme = useColorScheme();
  const router = useRouter();
  const appVersion =
    (Constants.expoConfig?.version as string | undefined) ?? "0.0.0";

  const goAccount = (path: "/account" | "/account/personal" | "/account/create") => {
    onClose();
    // Defer navigation a tick so the modal close animation can start before
    // we push the next screen — avoids a visible "stuck modal" flash on iOS.
    setTimeout(() => router.push(path as never), 50);
  };

  const confirmCancel = async () => {
    // #627: Use the cross-platform confirm helper so the dialog actually
    // surfaces on react-native-web (where bare `Alert.alert` is a no-op
    // stub) and native alike.
    const ok = await crossPlatformConfirm({
      title: "Cancel account",
      message:
        "Cancelling your account will permanently remove your profile and history. This can't be undone. Contact support to confirm.",
      confirmLabel: "Email support",
      cancelLabel: "Keep account",
      destructive: true,
    });
    if (!ok) return;
    Linking.openURL(
      "mailto:support@roundhouse.app?subject=Cancel%20my%20Roundhouse%20account",
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.modalRoot, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.modalHeader,
            { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : insets.top + 8 },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={20} style={{ padding: 8 }}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Settings</Text>
          <View style={{ width: 38 }} />
        </View>
        <ScrollView
          ref={innerScrollRef}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32, gap: 18 }}
        >
          <SettingsGroup title="Personal profile" colors={colors}>
            <SettingsRow
              icon="user"
              title="Your private profile"
              subtitle="Real name, login, avatar — only visible to you"
              onPress={() => goAccount("/account/personal")}
              colors={colors}
            />
          </SettingsGroup>

          <SettingsGroup title="Outward-facing accounts" colors={colors}>
            <SettingsRow
              icon="users"
              title="Manage your accounts"
              subtitle="Switch, edit or archive your public skins"
              onPress={() => goAccount("/account")}
              colors={colors}
            />
            <SettingsRow
              icon="plus-circle"
              title="New outward account"
              subtitle="Add another public-facing skin"
              onPress={() => goAccount("/account/create")}
              colors={colors}
            />
          </SettingsGroup>

          <NotificationSettings
            user={user}
            colors={colors}
            scrollViewRef={innerScrollRef}
            properties={properties}
          />
          <SharePromptSetting colors={colors} />

          <SettingsGroup title="Privacy" colors={colors}>
            <SettingsRow
              icon="eye"
              title="Public profile fields"
              subtitle="Choose what shows on your public profile"
              onPress={onClose}
              colors={colors}
            />
            <SettingsRow
              icon="user-x"
              title="Blocked accounts"
              subtitle="Coming soon"
              colors={colors}
              disabled
            />
          </SettingsGroup>

          <SettingsGroup title="Appearance" colors={colors}>
            <SettingsRow
              icon={colorScheme === "dark" ? "moon" : "sun"}
              title="Theme"
              subtitle={`Follows your system (${colorScheme === "dark" ? "Dark" : "Light"})`}
              colors={colors}
            />
          </SettingsGroup>

          <SettingsGroup title="Payments" colors={colors}>
            <SettingsRow
              icon="credit-card"
              title="Payment methods"
              subtitle="Coming soon"
              colors={colors}
              disabled
            />
            <SettingsRow
              icon="file-text"
              title="Billing history"
              subtitle="Coming soon"
              colors={colors}
              disabled
            />
          </SettingsGroup>

          <SettingsGroup title="Help & Support" colors={colors}>
            <SettingsRow
              icon="life-buoy"
              title="Contact support"
              subtitle="support@roundhouse.app"
              onPress={() => Linking.openURL("mailto:support@roundhouse.app")}
              colors={colors}
            />
            <SettingsRow
              icon="book-open"
              title="Help center"
              onPress={() => Linking.openURL("https://roundhouse.app/help")}
              colors={colors}
            />
            <SettingsRow
              icon="shield"
              title="Privacy policy"
              onPress={() => Linking.openURL("https://roundhouse.app/privacy")}
              colors={colors}
            />
            <SettingsRow
              icon="file"
              title="Terms of service"
              onPress={() => Linking.openURL("https://roundhouse.app/terms")}
              colors={colors}
            />
          </SettingsGroup>

          <SettingsGroup title="Account" colors={colors}>
            <SettingsRow
              icon="log-out"
              title="Sign out"
              onPress={onSignOut}
              colors={colors}
            />
            <SettingsRow
              icon="alert-triangle"
              title="Cancel account"
              subtitle="Permanently remove your account"
              onPress={confirmCancel}
              colors={colors}
              destructive
            />
          </SettingsGroup>

          <Text
            style={{
              color: colors.mutedForeground,
              textAlign: "center",
              marginTop: 8,
              fontSize: 12,
              fontFamily: "Inter_500Medium",
            }}
          >
            Roundhouse · Version {appVersion}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function SettingsGroup({
  title,
  colors,
  children,
}: {
  title: string;
  colors: ReturnType<typeof useColors>;
  children: React.ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          color: colors.mutedForeground,
          fontSize: 11,
          fontFamily: "Inter_700Bold",
          letterSpacing: 0.8,
          paddingHorizontal: 4,
        }}
      >
        {title.toUpperCase()}
      </Text>
      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </View>
  );
}

function SettingsRow({
  icon,
  title,
  subtitle,
  onPress,
  colors,
  destructive,
  disabled,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  subtitle?: string;
  onPress?: () => void;
  colors: ReturnType<typeof useColors>;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const fg = destructive ? "#dc2626" : colors.foreground;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 14,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        borderTopColor: colors.border,
        borderTopWidth: StyleSheet.hairlineWidth,
      })}
    >
      <Feather name={icon} size={18} color={fg} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: fg, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>{title}</Text>
        {subtitle ? (
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_500Medium",
              fontSize: 12,
              marginTop: 2,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onPress && !disabled ? (
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      ) : null}
    </Pressable>
  );
}
