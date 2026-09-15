import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import {
  customFetch,
  type ListRemindersResponse,
} from "@workspace/api-client-react";
import { useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import { useResolutions } from "@/lib/useResolutions";
import { loadCustomLists } from "@/lib/customLists";
import { dayAt, itemRef, localDay, remindersForDay } from "@/lib/daily-grind";

export function DailyGrind() {
  const colors = useColors();
  const router = useRouter();
  const { userId } = useAuth();
  const [offset, setOffset] = useState(0);
  const [shopping, setShopping] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const day = localDay(dayAt(offset));
  const today = localDay();
  const key = `dailyGrind.plan.v1:${userId}:${day}`;
  const lists = useQuery({
    queryKey: ["daily-grind-lists", userId],
    queryFn: loadCustomLists,
    enabled: !!userId,
    staleTime: 0,
  });
  const appointments = useQuery({
    queryKey: ["calendar-daily", userId], enabled: !!userId,
    queryFn: () => customFetch<{ appointments: { id: number; title: string; propertyName: string; startsAt: string; duration: number }[] }>("/api/calendar/daily"),
  });
  const reminders = useQuery({
    queryKey: ["daily-grind-reminders", userId],
    queryFn: () => customFetch<ListRemindersResponse>("/api/reminders"),
    enabled: !!userId,
  });
  const resolutions = useResolutions();
  useEffect(() => {
    let active = true;
    setReady(false);
    setSelected([]);
    setError("");
    AsyncStorage.getItem(key)
      .then((raw) => {
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        if (active) {
          setSelected(
            Array.isArray(parsed)
              ? parsed.filter((x): x is string => typeof x === "string")
              : [],
          );
          setReady(true);
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Your saved plan could not be loaded. Close and reopen Daily Grind to retry.",
          );
      });
    return () => {
      active = false;
    };
  }, [key]);
  const toggle = async (ref: string) => {
    if (!ready) return;
    const next = selected.includes(ref)
      ? selected.filter((x) => x !== ref)
      : [...selected, ref];
    setReady(false);
    try {
      await AsyncStorage.setItem(key, JSON.stringify(next));
      setSelected(next);
      setError("");
    } catch {
      setError("Your plan could not be saved. Please try again.");
    } finally {
      setReady(true);
    }
  };
  const all = (lists.data ?? []).flatMap((list) =>
    list.items.map((item) => ({ list, item, ref: itemRef(list.id, item.id) })),
  );
  const plan = all.filter(
    (row) => selected.includes(row.ref) && !row.item.done,
  );
  const scheduled = remindersForDay(
    reminders.data?.reminders ?? [],
    day,
    today,
  );
  const shoppingLists = (lists.data ?? []).filter(
    (list) => list.kind === "shopping",
  );
  const attention = (resolutions.data?.resolutions ?? []).filter(
    (r) => r.status === "attention" && r.canAct,
  );
  const text = { color: colors.foreground };
  const muted = { color: colors.mutedForeground };
  const button = (
    label: string,
    action: () => void,
    active = false,
    disabled = false,
  ) => (
    <Pressable
      key={label}
      onPress={action}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      style={[
        styles.button,
        {
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: colors.card,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Text style={[text, { fontWeight: active ? "700" : "500" }]}>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={[styles.greeting, text]}>
        {offset === 0
          ? new Date().getHours() < 12
            ? "Good morning. Let’s plan your day."
            : "What’s next today?"
          : offset < 0
            ? "Yesterday’s plan"
            : "Prepare for tomorrow"}
      </Text>
      <View style={styles.strip}>
        {[-1, 0, 1].map((n) =>
          button(
            ["Yesterday", "Today", "Tomorrow"][n + 1],
            () => {
              setOffset(n);
              setShopping(false);
              setExpanded(null);
            },
            offset === n,
          ),
        )}
      </View>
      <Text style={muted}>
        {dayAt(offset).toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
        })}
      </Text>
      {!!error && (
        <Text accessibilityRole="alert" style={text}>
          {error}
        </Text>
      )}
      <Text style={[styles.heading, text]}>Your plan</Text>
      {!ready && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {plan.length ? (
        plan.map(({ list, item, ref }) =>
          button(
            `${item.text} · ${list.name}  −`,
            () => void toggle(ref),
            true,
            !ready,
          ),
        )
      ) : (
        <Text style={muted}>
          Choose items from your lists below to plan this day.
        </Text>
      )}
      <Text style={[styles.heading, text]}>What do you want to do?</Text>
      {button(
        shopping ? "Shopping list is open" : "Go shopping",
        () => setShopping(!shopping),
        shopping,
      )}
      {shopping && (
        <View style={styles.section}>
          <Text style={muted}>
            Choose what you want to shop for. Items stay in your shopping list.
          </Text>
          {shoppingLists.flatMap((list) =>
            list.items
              .filter((item) => !item.done)
              .map((item) =>
                button(
                  `${selected.includes(itemRef(list.id, item.id)) ? "✓ " : "+ "}${item.text}`,
                  () => void toggle(itemRef(list.id, item.id)),
                  selected.includes(itemRef(list.id, item.id)),
                  !ready,
                ),
              ),
          )}
          {!shoppingLists.some((list) =>
            list.items.some((item) => !item.done),
          ) && (
            <Text style={muted}>
              Your shopping list has no unfinished items.
            </Text>
          )}
        </View>
      )}
      <Text style={[styles.heading, text]}>Choose from your lists</Text>
      {lists.isPending ? (
        <ActivityIndicator />
      ) : lists.isError ? (
        button("Retry lists", () => void lists.refetch())
      ) : (
        (lists.data ?? [])
          .filter((list) => list.kind !== "shopping")
          .map((list) => (
            <View key={list.id}>
              {button(
                `${list.name} · ${list.items.filter((i) => !i.done).length}`,
                () => setExpanded(expanded === list.id ? null : list.id),
                expanded === list.id,
              )}
              {expanded === list.id &&
                list.items
                  .filter((item) => !item.done)
                  .map((item) =>
                    button(
                      `${selected.includes(itemRef(list.id, item.id)) ? "✓ " : "+ "}${item.text}`,
                      () => void toggle(itemRef(list.id, item.id)),
                      selected.includes(itemRef(list.id, item.id)),
                      !ready,
                    ),
                  )}
            </View>
          ))
      )}
      {button("Manage lists & reminders", () =>
        router.push("/reminders" as never),
      )}
      <Text style={[styles.heading, text]}>Confirmed appointments</Text>
      {appointments.isPending ? <ActivityIndicator /> : appointments.isError ? button("Retry appointments", () => void appointments.refetch()) :
        appointments.data?.appointments.filter(a => localDay(new Date(a.startsAt)) === day).length ? appointments.data.appointments.filter(a => localDay(new Date(a.startsAt)) === day).map(a => <View key={a.id} style={styles.section}><Text style={text}>{a.title} · {a.propertyName}</Text><Text style={muted}>{new Date(a.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · {a.duration} minutes</Text></View>) : <Text style={muted}>No confirmed appointments for this day.</Text>}
      {button("Open Calendar", () => router.push("/(tabs)/calendar" as never))}
      <Text style={[styles.heading, text]}>Due & unfinished</Text>
      {reminders.isPending ? (
        <ActivityIndicator />
      ) : reminders.isError ? (
        button("Retry reminders", () => void reminders.refetch())
      ) : scheduled.length ? (
        scheduled.map((r) => (
          <View key={r.id} style={styles.section}>
            <Text style={text}>{r.title}</Text>
            <Text style={muted}>
              {localDay(new Date(r.dueAt)) < day ? "Overdue · " : ""}
              {new Date(r.dueAt).toLocaleString()}
            </Text>
          </View>
        ))
      ) : (
        <Text style={muted}>No reminders due for this day.</Text>
      )}
      {offset === 0 && (
        <>
          <Text style={[styles.heading, text]}>Resolutions needing you</Text>
          {resolutions.isError ? (
            button("Retry Resolutions", () => void resolutions.refetch())
          ) : attention.length ? (
            attention.map((r) =>
              button(r.question, () =>
                router.push("/(tabs)/resolutions" as never),
              ),
            )
          ) : (
            <Text style={muted}>No Resolutions needing your action.</Text>
          )}
        </>
      )}
      {offset === 0 && (
        <>
          <Text style={[styles.heading, text]}>A look at tomorrow</Text>
          <Text style={muted}>
            {
              remindersForDay(
                reminders.data?.reminders ?? [],
                localDay(dayAt(1)),
                today,
              ).length
            }{" "}
            reminders scheduled
          </Text>
          {button("Plan tomorrow", () => setOffset(1))}
        </>
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 28, gap: 10 },
  greeting: { fontSize: 22, fontWeight: "700" },
  heading: { fontSize: 17, fontWeight: "700", marginTop: 12 },
  strip: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  button: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 44,
    marginVertical: 3,
  },
  section: { padding: 10, gap: 6 },
});
