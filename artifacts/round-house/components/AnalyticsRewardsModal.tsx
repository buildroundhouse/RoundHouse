import React from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { useGetMyAnalytics, useGetFeed } from "@workspace/api-client-react";
import { BadgeTier, tierForScore, nextTier } from "./BadgeTier";

interface Props {
  visible: boolean;
  onClose: () => void;
}

type EarnedBadge = {
  key: string;
  label: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
  earned: boolean;
  progress?: string;
};

type Reward = {
  key: string;
  label: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
  unlockTier: "bronze" | "silver" | "gold" | "platinum";
};

const REWARDS: Reward[] = [
  {
    key: "swag",
    label: "Branded swag",
    description: "Hat, tee, and stickers shipped on us.",
    icon: "gift",
    unlockTier: "bronze",
  },
  {
    key: "free_ads",
    label: "Free ad credits",
    description: "Sponsored placement credits each month.",
    icon: "zap",
    unlockTier: "silver",
  },
  {
    key: "search_boost",
    label: "Search boost",
    description: "Higher placement when clients search your area.",
    icon: "trending-up",
    unlockTier: "gold",
  },
  {
    key: "brand_deals",
    label: "Brand deal invites",
    description: "Early access to paid partner programs.",
    icon: "briefcase",
    unlockTier: "platinum",
  },
];

const TIER_ORDER: Record<Reward["unlockTier"], number> = {
  bronze: 0,
  silver: 1,
  gold: 2,
  platinum: 3,
};

const TIER_LABELS: Record<Reward["unlockTier"], string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
};

export function AnalyticsRewardsModal({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { data: analytics } = useGetMyAnalytics(undefined, {
    query: { enabled: visible, queryKey: ["/api/users/me/analytics"] },
  });
  const { data: feedData } = useGetFeed(undefined, {
    query: { enabled: visible, queryKey: ["/api/feed"] },
  });

  const logs = feedData?.logs ?? [];
  const totalScore = logs.reduce((acc, l) => acc + l.score, 0);
  const totalLogs = logs.length;
  const tier = tierForScore(totalScore);
  const next = nextTier(totalScore);
  const currentTierIndex = TIER_ORDER[tier.key];

  const compliance = analytics?.complianceRate;
  const compliancePct =
    compliance && compliance.total > 0
      ? Math.round((compliance.compliant / compliance.total) * 100)
      : null;

  const ratingTrend = analytics?.ratingTrend ?? [];
  const avgRating =
    ratingTrend.length > 0
      ? ratingTrend.reduce((acc, r) => acc + r.avg, 0) / ratingTrend.length
      : null;

  const propertiesTracked = (analytics?.totalsByProperty ?? []).length;

  const monthlyTotals: Record<string, number> = {};
  (analytics?.logsByPropertyByMonth ?? []).forEach((m) => {
    monthlyTotals[m.month] = (monthlyTotals[m.month] ?? 0) + m.count;
  });
  const activeMonths = Object.values(monthlyTotals).filter((v) => v > 0).length;

  const badges: EarnedBadge[] = [
    {
      key: "first_log",
      label: "First log",
      description: "Logged your first job.",
      icon: "edit-3",
      earned: totalLogs >= 1,
      progress: totalLogs >= 1 ? undefined : "Log your first job",
    },
    {
      key: "ten_logs",
      label: "Ten logs",
      description: "Logged ten jobs across your portfolio.",
      icon: "list",
      earned: totalLogs >= 10,
      progress: totalLogs < 10 ? `${totalLogs}/10 logs` : undefined,
    },
    {
      key: "consistent",
      label: "Consistent",
      description: "Active in three or more months.",
      icon: "calendar",
      earned: activeMonths >= 3,
      progress: activeMonths < 3 ? `${activeMonths}/3 months` : undefined,
    },
    {
      key: "compliance_pro",
      label: "Compliance pro",
      description: "75% or more standards on track.",
      icon: "shield",
      earned: compliancePct !== null && compliancePct >= 75,
      progress:
        compliancePct === null
          ? "Track standards"
          : compliancePct < 75
            ? `${compliancePct}%/75%`
            : undefined,
    },
    {
      key: "top_rated",
      label: "Top rated",
      description: "Average rating of 4.5 or higher.",
      icon: "star",
      earned: avgRating !== null && avgRating >= 4.5,
      progress:
        avgRating === null
          ? "Earn ratings"
          : avgRating < 4.5
            ? `${avgRating.toFixed(1)}/4.5`
            : undefined,
    },
    {
      key: "portfolio",
      label: "Portfolio builder",
      description: "Active across five properties.",
      icon: "home",
      earned: propertiesTracked >= 5,
      progress:
        propertiesTracked < 5 ? `${propertiesTracked}/5 properties` : undefined,
    },
  ];

  const earnedCount = badges.filter((b) => b.earned).length;

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
          <Pressable onPress={onClose} hitSlop={12} style={{ padding: 4 }}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>Analytics</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        >
          <View
            style={[
              styles.tierCard,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <BadgeTier score={totalScore} size="md" />
            <Text style={[styles.tierLabel, { color: colors.foreground }]}>
              {tier.label} tier
            </Text>
            <Text style={[styles.tierScore, { color: colors.mutedForeground }]}>
              {totalScore} points
            </Text>
            {next ? (
              <View style={{ width: "100%", gap: 6, marginTop: 8 }}>
                <View
                  style={{
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: colors.muted,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      width: `${Math.min(100, Math.round((totalScore / next.min) * 100))}%`,
                      height: "100%",
                      backgroundColor: colors.primary,
                    }}
                  />
                </View>
                <Text style={[styles.tierNext, { color: colors.mutedForeground }]}>
                  {next.min - totalScore} points to {next.label}
                </Text>
              </View>
            ) : (
              <Text style={[styles.tierNext, { color: colors.mutedForeground }]}>
                Top tier reached
              </Text>
            )}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            SUMMARY
          </Text>
          <View style={styles.statRow}>
            <SummaryStat
              label="Total logs"
              value={String(totalLogs)}
              colors={colors}
            />
            <SummaryStat
              label="Compliance"
              value={compliancePct !== null ? `${compliancePct}%` : "—"}
              colors={colors}
            />
          </View>
          <View style={styles.statRow}>
            <SummaryStat
              label="Avg rating"
              value={avgRating !== null ? avgRating.toFixed(1) : "—"}
              colors={colors}
            />
            <SummaryStat
              label="Active months"
              value={String(activeMonths)}
              colors={colors}
            />
          </View>

          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              BADGES
            </Text>
            <Text style={[styles.sectionMeta, { color: colors.mutedForeground }]}>
              {earnedCount} of {badges.length} earned
            </Text>
          </View>
          <View style={styles.badgeGrid}>
            {badges.map((b) => (
              <View
                key={b.key}
                style={[
                  styles.badgeCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: b.earned ? colors.primary : colors.border,
                    opacity: b.earned ? 1 : 0.65,
                  },
                ]}
              >
                <View
                  style={[
                    styles.badgeIcon,
                    {
                      backgroundColor: b.earned
                        ? colors.primary + "22"
                        : colors.muted,
                    },
                  ]}
                >
                  <Feather
                    name={b.earned ? b.icon : "lock"}
                    size={18}
                    color={b.earned ? colors.primary : colors.mutedForeground}
                  />
                </View>
                <Text
                  style={[styles.badgeLabel, { color: colors.foreground }]}
                  numberOfLines={1}
                >
                  {b.label}
                </Text>
                <Text
                  style={[styles.badgeDesc, { color: colors.mutedForeground }]}
                  numberOfLines={2}
                >
                  {b.description}
                </Text>
                {b.progress && (
                  <Text style={[styles.badgeProgress, { color: colors.mutedForeground }]}>
                    {b.progress}
                  </Text>
                )}
              </View>
            ))}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            REWARDS
          </Text>
          {REWARDS.map((r) => {
            const unlocked = currentTierIndex >= TIER_ORDER[r.unlockTier];
            return (
              <View
                key={r.key}
                style={[
                  styles.rewardCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: unlocked ? colors.primary : colors.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.rewardIcon,
                    {
                      backgroundColor: unlocked
                        ? colors.primary + "22"
                        : colors.muted,
                    },
                  ]}
                >
                  <Feather
                    name={unlocked ? r.icon : "lock"}
                    size={20}
                    color={unlocked ? colors.primary : colors.mutedForeground}
                  />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.rewardLabel, { color: colors.foreground }]}>
                    {r.label}
                  </Text>
                  <Text
                    style={[styles.rewardDesc, { color: colors.mutedForeground }]}
                  >
                    {r.description}
                  </Text>
                </View>
                <View
                  style={[
                    styles.rewardPill,
                    {
                      backgroundColor: unlocked
                        ? colors.primary + "22"
                        : colors.muted,
                    },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 10,
                      fontFamily: "Inter_700Bold",
                      letterSpacing: 0.6,
                      color: unlocked ? colors.primary : colors.mutedForeground,
                    }}
                  >
                    {unlocked ? "UNLOCKED" : TIER_LABELS[r.unlockTier].toUpperCase()}
                  </Text>
                </View>
              </View>
            );
          })}

          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            Keep logging great work to climb tiers and unlock more rewards.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function SummaryStat({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={[
        styles.summaryCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
        {label.toUpperCase()}
      </Text>
      <Text style={[styles.summaryValue, { color: colors.foreground }]}>{value}</Text>
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
  scroll: { padding: 16, gap: 12 },
  tierCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 6,
  },
  tierLabel: { fontSize: 18, fontFamily: "Inter_700Bold", marginTop: 4 },
  tierScore: { fontSize: 14, fontFamily: "Inter_500Medium" },
  tierNext: { fontSize: 12, fontFamily: "Inter_500Medium", textAlign: "center" },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
    marginTop: 8,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  sectionMeta: { fontSize: 11, fontFamily: "Inter_600SemiBold" },
  statRow: { flexDirection: "row", gap: 10 },
  summaryCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 4,
  },
  summaryLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.6 },
  summaryValue: { fontSize: 22, fontFamily: "Inter_700Bold" },
  badgeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  badgeCard: {
    width: "47%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 4,
  },
  badgeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  badgeLabel: { fontSize: 13, fontFamily: "Inter_700Bold" },
  badgeDesc: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 14 },
  badgeProgress: {
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
    marginTop: 2,
  },
  rewardCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  rewardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  rewardLabel: { fontSize: 14, fontFamily: "Inter_700Bold" },
  rewardDesc: { fontSize: 12, fontFamily: "Inter_400Regular" },
  rewardPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  note: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 8,
  },
});
