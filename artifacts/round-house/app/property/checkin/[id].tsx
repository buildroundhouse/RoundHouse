import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import {
  useGetCheckinAgenda,
  useGetProperty,
} from "@workspace/api-client-react";
import type { CheckinAgenda, PropertyMember } from "@workspace/api-client-react";
import { buildPropertyMapUrl } from "@/lib/propertyShare";

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatAgendaText(agenda: CheckinAgenda): string {
  const lines: string[] = [];
  lines.push(`Check-in: ${agenda.property.name}`);
  const address = agenda.property.address?.trim();
  if (address) lines.push(`Address: ${address}`);
  const mapUrl = buildPropertyMapUrl(agenda.property);
  if (mapUrl) {
    lines.push(`📍 Mapped pin: ${mapUrl}`);
  } else if (address) {
    lines.push("📍 Address only (no map pin dropped)");
  }
  if (agenda.provider?.name) lines.push(`With: ${agenda.provider.name}`);
  lines.push(`Generated: ${new Date(agenda.generatedAt).toLocaleString()}`);
  lines.push("");

  if (agenda.driftAlerts.length) {
    lines.push("DRIFT ALERTS");
    agenda.driftAlerts.forEach((a) => {
      lines.push(
        `• ${a.standard.title} — ${a.lastMetAt ? `${a.daysSinceLastMet}d since last met` : "never met"}`,
      );
    });
    lines.push("");
  }
  if (agenda.openWorkOrders.length) {
    lines.push("OPEN WORK ORDERS");
    agenda.openWorkOrders.forEach((l) => {
      lines.push(`• ${l.note}`);
    });
    lines.push("");
  }
  if (agenda.pendingRatings.length) {
    lines.push("AWAITING RATING");
    agenda.pendingRatings.forEach((l) => {
      lines.push(`• ${l.note}`);
    });
    lines.push("");
  }
  if (agenda.recentActivity.length) {
    lines.push("RECENT ACTIVITY");
    agenda.recentActivity.slice(0, 8).forEach((l) => {
      lines.push(`• ${l.note} (${timeAgo(l.createdAt)})`);
    });
  }
  return lines.join("\n");
}

export default function CheckinScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const propertyId = parseInt(String(id), 10);
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [providerId, setProviderId] = useState<string | undefined>(undefined);

  const propertyQuery = useGetProperty(propertyId);
  const agendaQuery = useGetCheckinAgenda(propertyId, providerId ? { providerId } : undefined);

  const property = propertyQuery.data;
  const agenda = agendaQuery.data;
  const members: PropertyMember[] = useMemo(
    () => (property?.members ?? []).filter((m) => !m.archivedAt),
    [property],
  );

  const topPad = Platform.OS === "web" ? 16 : insets.top + 8;

  const handleShare = async () => {
    if (!agenda) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const text = formatAgendaText(agenda);
    if (Platform.OS === "web") {
      try {
        if (navigator?.clipboard) await navigator.clipboard.writeText(text);
      } catch {
        // Clipboard unavailable — silently fail; user can long-press to copy.
      }
    } else {
      try {
        await Share.share({ message: text, title: `Check-in: ${agenda.property.name}` });
      } catch {
        // Share dismissed/failed — non-fatal.
      }
    }
  };

  if (!property || agendaQuery.isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!agenda) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text style={{ color: colors.mutedForeground }}>Could not generate agenda.</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Feather name="x" size={26} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            Check-in
          </Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={1}>
            {property.name}
          </Text>
        </View>
        <TouchableOpacity onPress={handleShare} style={[styles.shareBtn, { backgroundColor: colors.primary }]}>
          <Feather name="share-2" size={14} color={colors.primaryForeground} />
          <Text style={[styles.shareText, { color: colors.primaryForeground }]}>Share</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 60 }}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>WITH PROVIDER (OPTIONAL)</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
          <TouchableOpacity
            onPress={() => setProviderId(undefined)}
            style={[
              styles.chip,
              {
                borderColor: !providerId ? colors.primary : colors.border,
                backgroundColor: !providerId ? colors.primary + "15" : "transparent",
              },
            ]}
          >
            <Text style={[styles.chipText, { color: !providerId ? colors.primary : colors.mutedForeground }]}>
              Whole property
            </Text>
          </TouchableOpacity>
          {members.map((m) => (
            <TouchableOpacity
              key={m.userClerkId}
              onPress={() => setProviderId(m.userClerkId)}
              style={[
                styles.chip,
                {
                  borderColor: providerId === m.userClerkId ? colors.primary : colors.border,
                  backgroundColor: providerId === m.userClerkId ? colors.primary + "15" : "transparent",
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: providerId === m.userClerkId ? colors.primary : colors.mutedForeground },
                ]}
              >
                {m.user?.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Section title="Drift Alerts" count={agenda.driftAlerts.length} colors={colors} accent={colors.destructive}>
          {agenda.driftAlerts.length === 0 ? (
            <Empty text="No standards overdue. Nice." colors={colors} />
          ) : (
            agenda.driftAlerts.map((a) => (
              <View
                key={a.standard.id}
                style={[styles.card, { backgroundColor: colors.card, borderColor: colors.destructive + "40" }]}
              >
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{a.standard.title}</Text>
                <Text style={[styles.cardMeta, { color: colors.destructive }]}>
                  {a.lastMetAt
                    ? `${a.daysSinceLastMet}d since last met (cadence ${a.standard.cadenceDays}d)`
                    : `Never met · cadence ${a.standard.cadenceDays}d`}
                </Text>
                {a.standard.description ? (
                  <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
                    {a.standard.description}
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </Section>

        <Section title="Open Work Orders" count={agenda.openWorkOrders.length} colors={colors}>
          {agenda.openWorkOrders.length === 0 ? (
            <Empty text="No open work orders." colors={colors} />
          ) : (
            agenda.openWorkOrders.map((l) => (
              <View key={l.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{l.note}</Text>
                <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
                  {l.author?.name} · {timeAgo(l.createdAt)}
                  {l.assignee ? ` · assigned to ${l.assignee.name}` : ""}
                </Text>
              </View>
            ))
          )}
        </Section>

        <Section title="Awaiting Rating" count={agenda.pendingRatings.length} colors={colors}>
          {agenda.pendingRatings.length === 0 ? (
            <Empty text="Nothing waiting on a rating." colors={colors} />
          ) : (
            agenda.pendingRatings.map((l) => (
              <View key={l.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{l.note}</Text>
                <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
                  Done by {l.assignee?.name || "—"} · {timeAgo(l.createdAt)}
                </Text>
              </View>
            ))
          )}
        </Section>

        <Section title="Recent Activity" count={agenda.recentActivity.length} colors={colors}>
          {agenda.recentActivity.length === 0 ? (
            <Empty text="No recent activity." colors={colors} />
          ) : (
            agenda.recentActivity.slice(0, 8).map((l) => (
              <View key={l.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{l.note}</Text>
                <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
                  {l.author?.name} · {timeAgo(l.createdAt)}
                </Text>
              </View>
            ))
          )}
        </Section>
      </ScrollView>
    </View>
  );
}

function Section({
  title,
  count,
  colors,
  accent,
  children,
}: {
  title: string;
  count: number;
  colors: ReturnType<typeof useColors>;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={{ marginTop: 18 }}>
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionTitle, { color: accent || colors.foreground }]}>{title}</Text>
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 10,
            backgroundColor: (accent || colors.muted) + (accent ? "20" : ""),
          }}
        >
          <Text style={{ color: accent || colors.mutedForeground, fontSize: 11, fontFamily: "Inter_700Bold" }}>
            {count}
          </Text>
        </View>
      </View>
      {children}
    </View>
  );
}

function Empty({ text, colors }: { text: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  title: { fontSize: 16, fontFamily: "Inter_700Bold" },
  sub: { fontSize: 12, fontFamily: "Inter_400Regular" },
  shareBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
  },
  shareText: { fontSize: 13, fontFamily: "Inter_700Bold" },
  label: { fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8, marginBottom: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, marginRight: 8 },
  chipText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontFamily: "Inter_700Bold" },
  card: { borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10, gap: 4 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold", lineHeight: 20 },
  cardMeta: { fontSize: 12, fontFamily: "Inter_500Medium" },
  cardBody: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 18, marginTop: 4 },
  empty: { padding: 14, borderRadius: 12, borderWidth: 1 },
});
