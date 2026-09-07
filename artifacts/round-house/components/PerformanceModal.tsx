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

export function PerformanceModal({ visible, onClose }: Props) {
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
  const tier = tierForScore(totalScore);
  const next = nextTier(totalScore);

  const compliance = analytics?.complianceRate;
  const compliancePct =
    compliance && compliance.total > 0
      ? Math.round((compliance.compliant / compliance.total) * 100)
      : null;

  // Logging consistency: ratio of months with at least one log over the window covered.
  const monthlyTotals: Record<string, number> = {};
  (analytics?.logsByPropertyByMonth ?? []).forEach((m) => {
    monthlyTotals[m.month] = (monthlyTotals[m.month] ?? 0) + m.count;
  });
  const monthsWithLogs = Object.values(monthlyTotals).filter((v) => v > 0).length;
  const monthsTracked = Math.max(1, Object.keys(monthlyTotals).length || 1);
  const consistencyPct = Math.round((monthsWithLogs / monthsTracked) * 100);

  // Average rating across the trend.
  const ratingTrend = analytics?.ratingTrend ?? [];
  const avgRating =
    ratingTrend.length > 0
      ? ratingTrend.reduce((acc, r) => acc + r.avg, 0) / ratingTrend.length
      : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            { borderBottomColor: colors.border, paddingTop: Platform.OS === "web" ? 24 : insets.top + 8 },
          ]}
        >
          <Pressable onPress={onClose} hitSlop={12} style={{ padding: 4 }}>
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: colors.foreground }]}>Performance</Text>
          <View style={{ width: 22 }} />
        </View>

        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
          <View style={[styles.tierCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ alignItems: "center", gap: 8 }}>
              <BadgeTier score={totalScore} size="md" />
              <Text style={[styles.tierLabel, { color: colors.foreground }]}>{tier.label} tier</Text>
              <Text style={[styles.tierScore, { color: colors.mutedForeground }]}>
                {totalScore} points
              </Text>
              {next ? (
                <Text style={[styles.tierNext, { color: colors.mutedForeground }]}>
                  {next.min - totalScore} to {next.label}
                </Text>
              ) : (
                <Text style={[styles.tierNext, { color: colors.mutedForeground }]}>Top tier reached</Text>
              )}
            </View>
          </View>

          {compliancePct !== null && (
            <Metric
              label="Completion rate"
              value={`${compliancePct}%`}
              detail={`${compliance!.compliant} of ${compliance!.total} standards on track`}
              colors={colors}
            />
          )}

          {monthsTracked > 0 && (
            <Metric
              label="Logging consistency"
              value={`${consistencyPct}%`}
              detail={`${monthsWithLogs} of ${monthsTracked} months active`}
              colors={colors}
            />
          )}

          {avgRating !== null && (
            <Metric
              label="Average rating"
              value={avgRating.toFixed(1)}
              detail={`Across ${ratingTrend.length} months`}
              colors={colors}
            />
          )}

          <Text style={[styles.note, { color: colors.mutedForeground }]}>
            On-time rate will appear once scheduled work is tracked.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Metric({
  label,
  value,
  detail,
  colors,
}: {
  label: string;
  value: string;
  detail: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.metric, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label.toUpperCase()}</Text>
      <Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.metricDetail, { color: colors.mutedForeground }]}>{detail}</Text>
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
  tierCard: { borderRadius: 16, borderWidth: 1, padding: 24, alignItems: "center" },
  tierLabel: { fontSize: 18, fontFamily: "Inter_700Bold", marginTop: 4 },
  tierScore: { fontSize: 14, fontFamily: "Inter_500Medium" },
  tierNext: { fontSize: 12, fontFamily: "Inter_500Medium", marginTop: 4 },
  metric: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 6 },
  metricLabel: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },
  metricValue: { fontSize: 28, fontFamily: "Inter_700Bold" },
  metricDetail: { fontSize: 12, fontFamily: "Inter_500Medium" },
  note: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", marginTop: 8 },
});
