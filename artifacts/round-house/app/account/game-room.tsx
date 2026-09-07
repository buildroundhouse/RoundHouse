import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/lib/profile";
import { LobbyChip } from "@/components/admin/RoomShell";
import { ADMIN_THEME } from "@/lib/adminTheme";

type Tab = "score" | "scoreboard" | "drill" | "stats" | "prizes";

interface ScoreEvent {
  eventType: string;
  label: string;
  description: string;
  defaultPoints: number;
  points: number;
}
interface ScoreboardEntry {
  rank: number;
  userClerkId: string;
  name: string;
  username: string | null;
  email: string | null;
  points: number;
  events: number;
  tier: { key: string; label: string; threshold: number };
}
interface StatHeadline { count: number; points: number }
interface StatsResponse {
  totals: { totalPoints: number; totalEvents: number; totalUsers: number };
  headline: Record<string, StatHeadline>;
  breakdown: Array<{ eventType: string; label: string; count: number; points: number }>;
}
interface DrillResponse {
  user: {
    clerkId: string;
    name: string | null;
    email: string | null;
    addressStreet: string | null;
    addressCity: string | null;
    addressState: string | null;
    addressZip: string | null;
  };
  points: number;
  tier: { key: string; label: string };
  history: Array<{
    id: number;
    eventType: string;
    label: string;
    points: number;
    sourceRef: string | null;
    createdAt: string;
  }>;
}
interface PrizeEntry {
  userClerkId: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: { street: string | null; city: string | null; state: string | null; zip: string | null; legacy: string | null };
  points: number;
  prize: { id?: number; status: string; notes?: string | null };
}

const TABS: Array<{ key: Tab; label: string; icon: keyof typeof Feather.glyphMap }> = [
  { key: "stats", label: "Stats", icon: "bar-chart-2" },
  { key: "score", label: "Scores", icon: "sliders" },
  { key: "scoreboard", label: "Board", icon: "list" },
  { key: "drill", label: "User", icon: "user" },
  { key: "prizes", label: "Prizes", icon: "gift" },
];

export default function GameRoomScreen() {
  const colors = useColors();
  const router = useRouter();
  const { profile } = useProfile();
  const [tab, setTab] = useState<Tab>("stats");

  // Soft-gate: if the user somehow lands here without isAdmin, send them
  // back to /account. The server-side endpoints are the real gate.
  const isAdmin = (profile as { isAdmin?: boolean } | null)?.isAdmin === true;
  useEffect(() => {
    if (profile && !isAdmin) {
      router.back();
    }
  }, [profile, isAdmin, router]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false, title: "Game Room" }} />
      {/* Header is hidden, so render the brass Lobby chip ourselves —
          replace (not push) so this deep tools screen isn't left in
          the stack under the Admin lobby. */}
      <View style={styles.lobbyBar}>
        <LobbyChip
          accent={ADMIN_THEME.brassBright}
          onPress={() => router.replace("/account/admin")}
        />
      </View>
      <View style={[styles.tabBar, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tabBtn, active && { borderBottomColor: colors.primary }]}
            >
              <Feather name={t.icon} size={16} color={active ? colors.primary : colors.mutedForeground} />
              <Text style={{ color: active ? colors.primary : colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {tab === "stats" ? <StatsPanel /> : null}
      {tab === "score" ? <ScorePanel /> : null}
      {tab === "scoreboard" ? <ScoreboardPanel onPickUser={(id) => { setTab("drill"); setTimeout(() => triggerDrill(id), 0); }} /> : null}
      {tab === "drill" ? <DrillPanel /> : null}
      {tab === "prizes" ? <PrizesPanel /> : null}
    </View>
  );
}

// Allow scoreboard rows to populate the drill-down screen.
let _drillTrigger: ((id: string) => void) | null = null;
function triggerDrill(id: string) {
  if (_drillTrigger) _drillTrigger(id);
}

function StatsPanel() {
  const colors = useColors();
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await customFetch<StatsResponse>("/api/admin/game-room/stats");
      setData(res);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      {err ? <ErrorMsg msg={err} /> : null}
      {data ? (
        <>
          <Text style={[styles.h2, { color: colors.foreground }]}>Totals</Text>
          <View style={styles.statGrid}>
            <StatCard label="Points" value={data.totals.totalPoints} />
            <StatCard label="Events" value={data.totals.totalEvents} />
            <StatCard label="Users" value={data.totals.totalUsers} />
          </View>
          <Text style={[styles.h2, { color: colors.foreground }]}>Headline</Text>
          <View style={styles.statGrid}>
            {Object.entries(data.headline).map(([key, h]) => (
              <StatCard key={key} label={prettyHeadline(key)} value={h.count} sub={`${h.points} pts`} />
            ))}
          </View>
          <Text style={[styles.h2, { color: colors.foreground }]}>By event</Text>
          {data.breakdown.map((b) => (
            <View key={b.eventType} style={[styles.row, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontWeight: "600" }}>{b.label}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{b.eventType}</Text>
              </View>
              <Text style={{ color: colors.foreground, marginRight: 16 }}>{b.count}</Text>
              <Text style={{ color: colors.foreground }}>{b.points} pts</Text>
            </View>
          ))}
        </>
      ) : !loading ? <Text style={{ color: colors.mutedForeground }}>No data.</Text> : null}
    </ScrollView>
  );
}

function ScorePanel() {
  const colors = useColors();
  const [events, setEvents] = useState<ScoreEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await customFetch<{ events: ScoreEvent[] }>("/api/admin/game-room/score-controls");
      setEvents(res.events);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      const res = await customFetch<{ events: ScoreEvent[] }>("/api/admin/game-room/score-controls", {
        method: "PUT",
        body: JSON.stringify({ events: events.map((e) => ({ eventType: e.eventType, points: e.points })) }),
      });
      setEvents(res.events);
      Alert.alert("Saved", "Score changes are live.");
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      {err ? <ErrorMsg msg={err} /> : null}
      {events.map((e, i) => (
        <View key={e.eventType} style={[styles.row, { borderBottomColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontWeight: "600" }}>{e.label}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
              {e.eventType} · default {e.defaultPoints}
            </Text>
          </View>
          <TextInput
            style={[styles.numInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]}
            keyboardType="number-pad"
            value={String(e.points)}
            onChangeText={(t) => {
              const n = Math.max(0, parseInt(t, 10) || 0);
              setEvents((prev) => prev.map((x, j) => (j === i ? { ...x, points: n } : x)));
            }}
          />
        </View>
      ))}
      <Pressable
        onPress={save}
        disabled={saving}
        style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 }]}
      >
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "600" }}>Save changes</Text>}
      </Pressable>
    </ScrollView>
  );
}

function ScoreboardPanel({ onPickUser }: { onPickUser: (clerkId: string) => void }) {
  const colors = useColors();
  const [entries, setEntries] = useState<ScoreboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await customFetch<{ entries: ScoreboardEntry[] }>("/api/admin/game-room/scoreboard?limit=100");
      setEntries(res.entries);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      {err ? <ErrorMsg msg={err} /> : null}
      {entries.map((e) => (
        <Pressable
          key={e.userClerkId}
          onPress={() => onPickUser(e.userClerkId)}
          style={[styles.row, { borderBottomColor: colors.border }]}
        >
          <Text style={{ color: colors.foreground, width: 28, fontWeight: "600" }}>{e.rank}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontWeight: "600" }}>{e.name}</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{e.tier.label} · {e.events} events</Text>
          </View>
          <Text style={{ color: colors.foreground, fontWeight: "600" }}>{e.points}</Text>
          <Feather name="chevron-right" size={18} color={colors.mutedForeground} style={{ marginLeft: 8 }} />
        </Pressable>
      ))}
    </ScrollView>
  );
}

function DrillPanel() {
  const colors = useColors();
  const [clerkId, setClerkId] = useState("");
  const [data, setData] = useState<DrillResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (id?: string) => {
    const target = (id ?? clerkId).trim();
    if (!target) return;
    setLoading(true); setErr(null);
    try {
      const res = await customFetch<DrillResponse>(`/api/admin/game-room/users/${encodeURIComponent(target)}`);
      setData(res);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [clerkId]);

  useEffect(() => {
    _drillTrigger = (id: string) => { setClerkId(id); void load(id); };
    return () => { _drillTrigger = null; };
  }, [load]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          style={[styles.textInput, { flex: 1, color: colors.foreground, borderColor: colors.border, backgroundColor: colors.muted }]}
          placeholder="Firebase UID / clerkId"
          placeholderTextColor={colors.mutedForeground}
          value={clerkId}
          onChangeText={setClerkId}
          autoCapitalize="none"
        />
        <Pressable
          onPress={() => load()}
          style={[styles.primaryBtn, { backgroundColor: colors.primary, marginTop: 0, paddingHorizontal: 18 }]}
        >
          <Text style={{ color: "#fff", fontWeight: "600" }}>{loading ? "…" : "Load"}</Text>
        </Pressable>
      </View>
      {err ? <ErrorMsg msg={err} /> : null}
      {data ? (
        <>
          <View style={[styles.row, { marginTop: 12, borderBottomColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 16 }}>{data.user.name}</Text>
              <Text style={{ color: colors.mutedForeground }}>{data.user.email}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>
                {[data.user.addressStreet, data.user.addressCity, data.user.addressState, data.user.addressZip].filter(Boolean).join(", ") || "(no address)"}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={{ color: colors.foreground, fontSize: 22, fontWeight: "700" }}>{data.points}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{data.tier.label}</Text>
            </View>
          </View>
          {data.history.map((h) => (
            <View key={h.id} style={[styles.row, { borderBottomColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground }}>{h.label}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  {new Date(h.createdAt).toLocaleString()}
                  {h.sourceRef ? ` · ${h.sourceRef}` : ""}
                </Text>
              </View>
              <Text style={{ color: colors.foreground, fontWeight: "600" }}>+{h.points}</Text>
            </View>
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

function PrizesPanel() {
  const colors = useColors();
  const [entries, setEntries] = useState<PrizeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await customFetch<{ entries: PrizeEntry[] }>("/api/admin/game-room/prizes?minPoints=100");
      setEntries(res.entries);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const updateStatus = async (clerkId: string, status: "selected" | "shipped" | "eligible") => {
    try {
      await customFetch(`/api/admin/game-room/prizes/${encodeURIComponent(clerkId)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (e) {
      Alert.alert("Failed", e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
    >
      {err ? <ErrorMsg msg={err} /> : null}
      {entries.map((e) => {
        const addr = [e.address.street, e.address.city, e.address.state, e.address.zip].filter(Boolean).join(", ") || e.address.legacy || "(no address)";
        return (
          <View key={e.userClerkId} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flexDirection: "row" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontWeight: "600" }}>{e.name}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{e.email}</Text>
              </View>
              <Text style={{ color: colors.foreground, fontWeight: "700" }}>{e.points}</Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>{addr}</Text>
            {e.phone ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{e.phone}</Text> : null}
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <StatusBtn label="Eligible" active={e.prize.status === "eligible"} onPress={() => updateStatus(e.userClerkId, "eligible")} />
              <StatusBtn label="Selected" active={e.prize.status === "selected"} onPress={() => updateStatus(e.userClerkId, "selected")} />
              <StatusBtn label="Shipped" active={e.prize.status === "shipped"} onPress={() => updateStatus(e.userClerkId, "shipped")} />
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

function StatusBtn({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.statusBtn, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : "transparent" }]}
    >
      <Text style={{ color: active ? "#fff" : colors.foreground, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  const colors = useColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={{ color: colors.mutedForeground, fontSize: 11, textTransform: "uppercase" }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "700", marginTop: 2 }}>{value}</Text>
      {sub ? <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  const colors = useColors();
  return (
    <View style={{ padding: 12, borderRadius: 8, backgroundColor: "#3b0d0d", marginBottom: 12 }}>
      <Text style={{ color: "#ffb4b4" }}>{msg}</Text>
    </View>
  );
}

const HEADLINE_LABELS: Record<string, string> = {
  totalLogins: "Daily logins",
  totalEstimates: "Estimates sent",
  totalInvoices: "Invoices sent",
  totalQuestionsAnswered: "Questions answered",
  totalAnswersAccepted: "Answers accepted",
  totalShares: "Shares",
  totalLogs: "Logs",
};
function prettyHeadline(key: string): string {
  return HEADLINE_LABELS[key] ?? key;
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 64, gap: 0 },
  lobbyBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: ADMIN_THEME.velvetDeep,
  },
  tabBar: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  h2: { fontSize: 14, fontWeight: "600", marginTop: 12, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.04 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  numInput: { width: 80, borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, textAlign: "right" },
  textInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  primaryBtn: { marginTop: 16, paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  statGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  statCard: { flexBasis: "30%", flexGrow: 1, padding: 10, borderRadius: 8, borderWidth: 1 },
  card: { padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 10 },
  statusBtn: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
});
