import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { customFetch, type ListRemindersResponse } from "@workspace/api-client-react";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import { useProfile } from "@/lib/profile";
import { useResolutions } from "@/lib/useResolutions";
import { loadCustomLists } from "@/lib/customLists";
import { itemRef, localDay, remindersForDay } from "@/lib/daily-grind";

type Appointment = { id: number; title: string; propertyName: string; startsAt: string; duration: number };
type GrindRow = { ref: string; title: string; time?: string; tone?: "red" | "fire" };

export function DailyGrind() {
  const colors = useColors(), router = useRouter(), { userId } = useAuth(), { profile } = useProfile();
  const today = localDay(), planKey = `dailyGrind.plan.v2:${userId}:${today}`, setKey = `${planKey}:set`, checkedKey = `${planKey}:checked`;
  const [selected, setSelected] = useState<string[]>([]), [checked, setChecked] = useState<string[]>([]);
  const [daySet, setDaySet] = useState(false), [shoppingOpen, setShoppingOpen] = useState(false), [showMore, setShowMore] = useState(false), [ready, setReady] = useState(false), [error, setError] = useState("");
  const lists = useQuery({ queryKey: ["daily-grind-lists", userId], queryFn: loadCustomLists, enabled: !!userId, staleTime: 0 });
  const reminders = useQuery({ queryKey: ["daily-grind-reminders", userId], queryFn: () => customFetch<ListRemindersResponse>("/api/reminders"), enabled: !!userId });
  const appointments = useQuery({ queryKey: ["calendar-daily", userId], queryFn: () => customFetch<{ appointments: Appointment[] }>("/api/calendar/daily"), enabled: !!userId });
  const resolutions = useResolutions();

  useEffect(() => {
    let active = true; setReady(false);
    Promise.all([AsyncStorage.getItem(planKey), AsyncStorage.getItem(setKey), AsyncStorage.getItem(checkedKey)]).then(([plan, set, done]) => {
      if (!active) return;
      const parse = (raw: string | null) => { const value: unknown = raw ? JSON.parse(raw) : []; return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : []; };
      setSelected(parse(plan)); setChecked(parse(done)); setDaySet(set === "true"); setReady(true);
    }).catch(() => { if (active) { setError("Your Daily Grind could not be loaded. Please close and reopen it."); setReady(true); } });
    return () => { active = false; };
  }, [checkedKey, planKey, setKey]);

  const saveSelection = async (ref: string) => { const next = selected.includes(ref) ? selected.filter((x) => x !== ref) : [...selected, ref]; setSelected(next); try { await AsyncStorage.setItem(planKey, JSON.stringify(next)); setError(""); } catch { setError("Your selection could not be saved. Please try again."); } };
  const toggleChecked = async (ref: string) => { const next = checked.includes(ref) ? checked.filter((x) => x !== ref) : [...checked, ref]; setChecked(next); await AsyncStorage.setItem(checkedKey, JSON.stringify(next)); };
  const setMyDay = async () => { setDaySet(true); await AsyncStorage.setItem(setKey, "true"); };
  const now = new Date();
  const todaysAppointments = (appointments.data?.appointments ?? []).filter((a) => localDay(new Date(a.startsAt)) === today).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const todaysReminders = remindersForDay(reminders.data?.reminders ?? [], today, today);
  const overdue = (reminders.data?.reminders ?? []).filter((r) => !r.done && localDay(new Date(r.dueAt)) < today);
  const attention = (resolutions.data?.resolutions ?? []).filter((r) => r.status === "attention" && r.canAct);
  const allListItems = (lists.data ?? []).flatMap((list) => list.items.filter((item) => !item.done).map((item) => ({ list, item, ref: itemRef(list.id, item.id) })));
  const shoppingItems = allListItems.filter((row) => row.list.kind === "shopping"), regularItems = allListItems.filter((row) => row.list.kind !== "shopping");
  const fixedRows: GrindRow[] = [...todaysAppointments.map((a) => ({ ref: `appointment:${a.id}`, title: a.title || a.propertyName, time: new Date(a.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) })), ...todaysReminders.filter((r) => localDay(new Date(r.dueAt)) === today).map((r) => ({ ref: `today-reminder:${r.id}`, title: r.title, time: new Date(r.dueAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) }))];
  const selectableRows: GrindRow[] = [...overdue.map((r) => ({ ref: `reminder:${r.id}`, title: r.title })), ...attention.map((r) => ({ ref: `resolution:${r.id}`, title: r.question, tone: r.followUps >= 3 ? "fire" as const : "red" as const })), ...allListItems.map(({ item, ref }) => ({ ref, title: item.text }))];
  const grindRows = [...fixedRows, ...selectableRows.filter((row) => selected.includes(row.ref))];
  const suggestions: GrindRow[] = regularItems.filter((row) => !selected.includes(row.ref)).map(({ item, ref }) => ({ ref, title: item.text }));
  const visibleSuggestions = showMore ? suggestions : suggestions.slice(0, 4);
  const firstName = profile?.name?.trim().split(/\s+/)[0] || "there";
  const briefing = `Morning, ${firstName}. You’ve got ${todaysAppointments.length || "no"} appointment${todaysAppointments.length === 1 ? "" : "s"} today${attention.length ? ` and ${attention.length} thing${attention.length === 1 ? "" : "s"} needing you` : ""}. ${overdue.length ? "One overdue item is worth clearing first." : "You’re starting the day with a clean slate."}`;

  const row = (item: GrindRow, action?: () => void, actionLabel = "+ Today") => <View key={item.ref} style={[s.row, { borderColor: colors.border, backgroundColor: colors.card }]}>{item.time ? <Text style={[s.time, { color: colors.mutedForeground }]}>{item.time}</Text> : null}{item.tone ? <Text style={s.signal}>{item.tone === "fire" ? "🔥" : "🔴"}</Text> : null}<Text numberOfLines={2} style={[s.rowTitle, { color: colors.foreground }]}>{item.title}</Text>{action ? <Pressable accessibilityRole="button" onPress={action} style={s.rowAction}><Text style={{ color: colors.primary, fontWeight: "700" }}>{actionLabel}</Text></Pressable> : null}</View>;
  if (!ready || lists.isPending || reminders.isPending) return <View style={s.loading}><ActivityIndicator color={colors.primary} /></View>;
  return <View style={s.screen}>
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <Text style={[s.date, { color: colors.mutedForeground }]}>{now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · Weather unavailable</Text>
      <View style={[s.briefing, { borderColor: colors.border, backgroundColor: colors.card }]}><Feather name="sunrise" size={18} color={colors.primary} /><Text style={[s.briefingText, { color: colors.foreground }]}>{briefing}</Text></View>
      {!!error && <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>}
      <View style={[s.todayCard, { borderColor: colors.primary, backgroundColor: colors.card }]}><Text style={[s.label, { color: colors.primary }]}>{daySet ? "TODAY’S GRIND" : "TODAY"}</Text>{grindRows.length ? grindRows.map((item) => daySet ? <Pressable key={item.ref} onPress={() => void toggleChecked(item.ref)} style={s.checkRow}><Feather name={checked.includes(item.ref) ? "check-square" : "square"} size={19} color={checked.includes(item.ref) ? colors.primary : colors.mutedForeground} />{item.time ? <Text style={[s.time, { color: colors.mutedForeground }]}>{item.time}</Text> : null}<Text style={[s.rowTitle, checked.includes(item.ref) && s.done, { color: colors.foreground }]}>{item.title}</Text></Pressable> : row(item)) : <Text style={{ color: colors.mutedForeground }}>Your day is ready to be assembled.</Text>}</View>
      {!daySet ? <>
        {overdue.length ? <View style={s.group}><Text style={[s.label, { color: colors.mutedForeground }]}>FROM YESTERDAY</Text>{overdue.slice(0, 2).map((r) => row({ ref: `reminder:${r.id}`, title: r.title }, () => void saveSelection(`reminder:${r.id}`), selected.includes(`reminder:${r.id}`) ? "Added" : "+ Today"))}</View> : null}
        {attention.length ? <View style={s.group}><Text style={[s.label, { color: colors.mutedForeground }]}>NEEDS YOU</Text>{attention.slice(0, 3).map((r) => row({ ref: `resolution:${r.id}`, title: r.question, tone: r.followUps >= 3 ? "fire" : "red" }, () => void saveSelection(`resolution:${r.id}`), selected.includes(`resolution:${r.id}`) ? "Added" : r.followUps >= 3 ? "+ Call" : "+ Today"))}</View> : null}
        <View style={s.group}><Text style={[s.label, { color: colors.mutedForeground }]}>MAYBE TODAY</Text>{visibleSuggestions.map((item) => row(item, () => void saveSelection(item.ref), "+"))}{row({ ref: "shop", title: "Shop" }, () => setShoppingOpen((open) => !open), shoppingOpen ? "Close" : "+")}{shoppingOpen ? <View style={[s.shopping, { borderColor: colors.border }]}>{shoppingItems.length ? shoppingItems.map(({ item, ref }) => <Pressable key={ref} onPress={() => void saveSelection(ref)} style={s.shopRow}><Feather name={selected.includes(ref) ? "check-square" : "square"} size={18} color={selected.includes(ref) ? colors.primary : colors.mutedForeground} /><Text style={{ color: colors.foreground, flex: 1 }}>{item.text}</Text></Pressable>) : <Text style={{ color: colors.mutedForeground }}>Your Shopping List is empty.</Text>}</View> : null}{!showMore && suggestions.length > 4 ? <Pressable onPress={() => setShowMore(true)}><Text style={[s.showMore, { color: colors.primary }]}>Show more</Text></Pressable> : null}</View>
        <View style={s.links}><Pressable onPress={() => router.push("/reminders" as never)}><Text style={{ color: colors.mutedForeground }}>Tasks & Lists</Text></Pressable><Pressable onPress={() => setShoppingOpen(true)}><Text style={{ color: colors.mutedForeground }}>Shopping</Text></Pressable><Pressable onPress={() => router.push("/(tabs)/calendar" as never)}><Text style={{ color: colors.mutedForeground }}>Calendar</Text></Pressable></View>
      </> : null}
    </ScrollView>
    {!daySet ? <Pressable accessibilityRole="button" onPress={() => void setMyDay()} style={[s.setDay, { backgroundColor: colors.primary }]}><Text style={[s.setDayText, { color: colors.primaryForeground }]}>SET MY DAY</Text></Pressable> : null}
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1 }, loading: { flex: 1, alignItems: "center", justifyContent: "center" }, content: { paddingHorizontal: 14, paddingBottom: 86, gap: 12 }, date: { fontSize: 13, marginTop: 2 },
  briefing: { minHeight: 100, maxHeight: 130, borderWidth: 1, borderRadius: 14, padding: 14, flexDirection: "row", alignItems: "flex-start", gap: 10 }, briefingText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: "600" }, todayCard: { width: "100%", borderWidth: 1.5, borderRadius: 15, padding: 12, gap: 8 }, label: { fontSize: 12, lineHeight: 16, fontWeight: "800", letterSpacing: 1.1 }, group: { gap: 6 },
  row: { minHeight: 50, borderWidth: 1, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 }, time: { width: 55, fontSize: 12, fontWeight: "700" }, signal: { fontSize: 15 }, rowTitle: { flex: 1, fontSize: 14, lineHeight: 18, fontWeight: "600" }, rowAction: { minHeight: 34, justifyContent: "center", paddingLeft: 6 }, checkRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 9 }, done: { textDecorationLine: "line-through", opacity: 0.55 },
  shopping: { borderWidth: 1, borderRadius: 11, padding: 10, gap: 4 }, shopRow: { minHeight: 42, flexDirection: "row", alignItems: "center", gap: 9 }, showMore: { fontSize: 13, fontWeight: "700", paddingVertical: 5 }, links: { flexDirection: "row", justifyContent: "center", flexWrap: "wrap", gap: 18, paddingVertical: 8 }, setDay: { position: "absolute", left: 14, right: 14, bottom: 12, minHeight: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" }, setDayText: { fontSize: 15, fontWeight: "800", letterSpacing: 0.8 },
});
