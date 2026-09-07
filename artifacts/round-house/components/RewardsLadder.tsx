import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { confirm } from "@/lib/confirm";
import type {
  RewardsState,
  RewardsTier,
  RewardsPerk,
  BrandDealOffer,
} from "@workspace/api-client-react";

const TIER_COLORS: Record<string, { fg: string; bg: string }> = {
  bronze: { fg: "#8B5A2B", bg: "#F2E6D8" },
  silver: { fg: "#5A6470", bg: "#E5E9EE" },
  gold: { fg: "#9A7B00", bg: "#FFF3C4" },
  platinum: { fg: "#3B4856", bg: "#E2E8EE" },
};

const PERK_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  swag: "gift",
  free_advertising: "trending-up",
  search_boost: "zap",
  brand_deals: "tag",
};

interface Props {
  state: RewardsState;
  onClaimSwag: () => void;
  onBoostDeal: () => void;
  onAcceptBrandOffer: (offer: BrandDealOffer) => void;
  onDeclineBrandOffer: (offer: BrandDealOffer) => void;
  busy?: boolean;
}

export function RewardsLadder({
  state,
  onClaimSwag,
  onBoostDeal,
  onAcceptBrandOffer,
  onDeclineBrandOffer,
  busy,
}: Props) {
  const colors = useColors();
  const tiers = state.catalog?.tiers ?? [];
  const currentIdx = tiers.findIndex((t) => t.key === state.tier.key);
  const points = state.points;
  const next = state.nextTier;
  const progressPct = next
    ? Math.min(
        100,
        Math.max(
          0,
          ((points - state.tier.threshold) / (next.threshold - state.tier.threshold)) * 100,
        ),
      )
    : 100;

  const pendingOffers = state.brandOffers.filter((o) => o.status === "pending");

  return (
    <View style={{ gap: 16 }}>
      {/* Points + progress header */}
      <View style={[styles.headerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.pointsLabel, { color: colors.mutedForeground }]}>Your points</Text>
          <Text style={[styles.pointsValue, { color: colors.foreground }]}>{points}</Text>
          {next ? (
            <Text style={[styles.nextHint, { color: colors.mutedForeground }]}>
              {state.pointsToNext} more to {next.label}
            </Text>
          ) : (
            <Text style={[styles.nextHint, { color: colors.mutedForeground }]}>
              Top tier reached
            </Text>
          )}
        </View>
        <View
          style={[
            styles.tierBadge,
            { backgroundColor: TIER_COLORS[state.tier.key].bg },
          ]}
        >
          <Feather name="award" size={18} color={TIER_COLORS[state.tier.key].fg} />
          <Text style={[styles.tierBadgeText, { color: TIER_COLORS[state.tier.key].fg }]}>
            {state.tier.label}
          </Text>
        </View>
      </View>

      {/* Ladder */}
      <View style={[styles.ladderCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.ladderRow}>
          {tiers.map((t: RewardsTier, idx: number) => {
            const reached = idx <= currentIdx;
            const tone = TIER_COLORS[t.key];
            return (
              <React.Fragment key={t.key}>
                <View style={styles.ladderNode}>
                  <View
                    style={[
                      styles.dot,
                      {
                        backgroundColor: reached ? tone.fg : colors.muted,
                        borderColor: reached ? tone.fg : colors.border,
                      },
                    ]}
                  />
                  <Text
                    style={[
                      styles.tierLabel,
                      {
                        color: reached ? tone.fg : colors.mutedForeground,
                        fontFamily: reached ? "Inter_700Bold" : "Inter_500Medium",
                      },
                    ]}
                  >
                    {t.label}
                  </Text>
                  <Text style={[styles.tierThreshold, { color: colors.mutedForeground }]}>
                    {t.threshold}
                  </Text>
                </View>
                {idx < tiers.length - 1 ? (
                  <View
                    style={[
                      styles.connector,
                      { backgroundColor: idx < currentIdx ? tone.fg : colors.border },
                    ]}
                  />
                ) : null}
              </React.Fragment>
            );
          })}
        </View>
        {/* Progress bar to next tier */}
        <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${progressPct}%`,
                backgroundColor: TIER_COLORS[state.tier.key].fg,
              },
            ]}
          />
        </View>
      </View>

      {/* Perks */}
      <View style={{ gap: 10 }}>
        {state.perks.map((perk: RewardsPerk) => (
          <PerkRow
            key={perk.key}
            perk={perk}
            state={state}
            onClaimSwag={onClaimSwag}
            onBoostDeal={onBoostDeal}
            busy={busy}
          />
        ))}
      </View>

      {/* Pending brand offers (Platinum only) */}
      {pendingOffers.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Brand deal offers
          </Text>
          {pendingOffers.map((offer) => (
            <View
              key={offer.id}
              style={[styles.offerCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <Text style={[styles.offerBrand, { color: colors.mutedForeground }]}>
                {offer.brandName}
              </Text>
              <Text style={[styles.offerHeadline, { color: colors.foreground }]}>
                {offer.headline}
              </Text>
              {offer.description ? (
                <Text style={[styles.offerBody, { color: colors.mutedForeground }]}>
                  {offer.description}
                </Text>
              ) : null}
              {offer.rewardSummary ? (
                <Text style={[styles.offerReward, { color: colors.foreground }]}>
                  Reward: {offer.rewardSummary}
                </Text>
              ) : null}
              <View style={styles.offerActions}>
                <Pressable
                  onPress={async () => {
                    // #627: Use the cross-platform confirm helper so the
                    // dialog actually surfaces on react-native-web and
                    // native alike.
                    const ok = await confirm({
                      title: "Decline brand deal?",
                      message:
                        "You can always accept future offers from any brand.",
                      confirmLabel: "Decline",
                      cancelLabel: "Cancel",
                      destructive: true,
                    });
                    if (ok) onDeclineBrandOffer(offer);
                  }}
                  disabled={busy}
                  style={[styles.offerBtn, { backgroundColor: colors.muted }]}
                >
                  <Text style={[styles.offerBtnText, { color: colors.foreground }]}>
                    Decline
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => onAcceptBrandOffer(offer)}
                  disabled={busy}
                  style={[styles.offerBtn, { backgroundColor: colors.foreground }]}
                >
                  <Text style={[styles.offerBtnText, { color: colors.background }]}>
                    Accept
                  </Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

interface PerkRowProps {
  perk: RewardsPerk;
  state: RewardsState;
  onClaimSwag: () => void;
  onBoostDeal: () => void;
  busy?: boolean;
}

function PerkRow({ perk, state, onClaimSwag, onBoostDeal, busy }: PerkRowProps) {
  const colors = useColors();
  const tone = TIER_COLORS[perk.tier];
  const iconName = PERK_ICONS[perk.key] ?? "gift";

  let actionLabel: string | null = null;
  let action: (() => void) | null = null;
  let actionDisabledReason: string | null = null;

  if (perk.unlocked) {
    if (perk.key === "swag") {
      const claim = state.swagClaim;
      if (!claim) {
        actionLabel = "Claim swag";
        action = onClaimSwag;
      } else if (claim.status === "delivered") {
        actionDisabledReason = "Swag delivered";
      } else {
        actionDisabledReason = `Swag ${claim.status}`;
      }
    } else if (perk.key === "free_advertising") {
      if (state.boostedDealId) {
        actionDisabledReason = "Boost active this month";
      } else {
        actionLabel = "Boost a Deal";
        action = onBoostDeal;
      }
    } else if (perk.key === "search_boost") {
      actionDisabledReason = "Active in Find a Pro";
    } else if (perk.key === "brand_deals") {
      actionDisabledReason = "Curated by Roundhouse";
    }
  }

  return (
    <View style={[styles.perkCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.perkIcon, { backgroundColor: perk.unlocked ? tone.bg : colors.muted }]}>
        <Feather
          name={perk.unlocked ? iconName : "lock"}
          size={18}
          color={perk.unlocked ? tone.fg : colors.mutedForeground}
        />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.perkHeader}>
          <Text style={[styles.perkName, { color: colors.foreground }]}>{perk.name}</Text>
          <View style={[styles.perkTierPill, { backgroundColor: tone.bg }]}>
            <Text style={[styles.perkTierText, { color: tone.fg }]}>
              {perk.tier.charAt(0).toUpperCase() + perk.tier.slice(1)}
            </Text>
          </View>
        </View>
        <Text style={[styles.perkDesc, { color: colors.mutedForeground }]}>
          {perk.description}
        </Text>
        <Text
          style={[
            styles.perkRequirement,
            { color: perk.unlocked ? "#16A34A" : colors.mutedForeground },
          ]}
        >
          {perk.requirement}
        </Text>
      </View>
      {action ? (
        <Pressable
          onPress={action}
          disabled={busy}
          style={[styles.perkAction, { backgroundColor: colors.foreground }]}
        >
          <Text style={[styles.perkActionText, { color: colors.background }]}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : actionDisabledReason ? (
        <View style={[styles.perkAction, { backgroundColor: colors.muted }]}>
          <Text style={[styles.perkActionText, { color: colors.mutedForeground }]}>
            {actionDisabledReason}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  pointsLabel: { fontSize: 12, fontFamily: "Inter_500Medium", textTransform: "uppercase" },
  pointsValue: { fontSize: 32, fontFamily: "Inter_700Bold", marginTop: 2 },
  nextHint: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 4 },
  tierBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  tierBadgeText: { fontFamily: "Inter_700Bold", fontSize: 14 },
  ladderCard: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    gap: 14,
  },
  ladderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  ladderNode: { alignItems: "center", gap: 4, width: 56 },
  dot: { width: 18, height: 18, borderRadius: 999, borderWidth: 2 },
  tierLabel: { fontSize: 12 },
  tierThreshold: { fontSize: 10, fontFamily: "Inter_500Medium" },
  connector: { flex: 1, height: 2, marginHorizontal: 4 },
  progressTrack: { height: 6, borderRadius: 999, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 999 },
  perkCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  perkIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  perkHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  perkName: { fontFamily: "Inter_700Bold", fontSize: 14, flexShrink: 1 },
  perkTierPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  perkTierText: { fontFamily: "Inter_700Bold", fontSize: 10 },
  perkDesc: { fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 },
  perkRequirement: { fontFamily: "Inter_500Medium", fontSize: 11, marginTop: 4 },
  perkAction: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    minWidth: 92,
    alignItems: "center",
  },
  perkActionText: { fontFamily: "Inter_700Bold", fontSize: 12, textAlign: "center" },
  sectionTitle: { fontFamily: "Inter_700Bold", fontSize: 15 },
  offerCard: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 4 },
  offerBrand: { fontSize: 11, fontFamily: "Inter_700Bold", textTransform: "uppercase" },
  offerHeadline: { fontSize: 16, fontFamily: "Inter_700Bold" },
  offerBody: { fontSize: 13, fontFamily: "Inter_400Regular" },
  offerReward: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  offerActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  offerBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  offerBtnText: { fontFamily: "Inter_700Bold", fontSize: 13 },
});
