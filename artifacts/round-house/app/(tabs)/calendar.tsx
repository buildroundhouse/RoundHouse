import React, { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/lib/profile";
import { confirm } from "@/lib/confirm";
import { messageHrefFor } from "@/lib/messageTarget";
import {
  calendarStatus,
  localInput,
  parseCalendarTime,
  type CalendarAppointment,
  type CalendarContexts,
} from "@/lib/calendar";
export default function CalendarScreen() {
  const { activeOutwardAccountId } = useProfile();
  return <CalendarWorkspace key={activeOutwardAccountId} />;
}
function CalendarWorkspace() {
  const c = useColors(),
    router = useRouter(),
    insets = useSafeAreaInsets(),
    cache = useQueryClient();
  const { activeOutwardAccountId: accountId, profile } = useProfile();
  const params = useLocalSearchParams<{
    propertyEntityId?: string;
    appointmentId?: string;
  }>();
  const headers = {
    "Content-Type": "application/json",
    "x-active-outward-account-id": String(accountId),
  };
  const q = useQuery({
    queryKey: ["calendar", profile?.clerkId, accountId],
    enabled: !!accountId,
    queryFn: () =>
      customFetch<{
        appointments: CalendarAppointment[];
        canSchedule: boolean;
      }>("/api/calendar", { headers }),
  });
  const contexts = useQuery({
    queryKey: ["calendar-contexts", profile?.clerkId, accountId],
    enabled: !!accountId,
    queryFn: () =>
      customFetch<CalendarContexts>("/api/calendar/contexts", { headers }),
  });
  const blocks = useQuery({
    queryKey: ["calendar-unavailable", profile?.clerkId],
    enabled: !!profile?.clerkId,
    queryFn: () =>
      customFetch<{
        blocks: { id: number; startsAt: string; endsAt: string }[];
      }>("/api/calendar-unavailable", { headers }),
  });
  const [filter, setFilter] = useState("upcoming"),
    [selected, setSelected] = useState<number | null>(
      Number(params.appointmentId) || null,
    ),
    [form, setForm] = useState<"create" | "reschedule" | "unavailable" | null>(
      null,
    );
  const [businessId, setBusinessId] = useState<number | null>(null),
    [propertyId, setPropertyId] = useState<number | null>(
      Number(params.propertyEntityId) || null,
    ),
    [people, setPeople] = useState<number[]>([]);
  const [title, setTitle] = useState(""),
    [time, setTime] = useState(localInput()),
    [duration, setDuration] = useState("60"),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [showPrivate, setShowPrivate] = useState(false);
  const doc = q.data?.appointments.find((d) => d.id === selected),
    property = contexts.data?.properties.find((p) => p.id === propertyId);
  const mutation = useMutation({
    mutationFn: (v: { path: string; body: unknown }) =>
      customFetch(v.path, {
        method: "POST",
        headers,
        body: JSON.stringify(v.body),
      }),
    onSuccess: async () => {
      setForm(null);
      setError("");
      setMessage("");
      await Promise.all(
        ["calendar", "calendar-daily", "calendar-unavailable"].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
    onError: (e: Error) => {
      setError(e.message);
      void q.refetch();
    },
  });
  const button = (label: string, onPress: () => void, active = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={mutation.isPending}
      onPress={onPress}
      style={[
        s.button,
        {
          borderColor: active ? c.primary : c.border,
          backgroundColor: active ? c.primary : c.card,
        },
      ]}
    >
      <Text
        style={{
          color: active ? c.primaryForeground : c.foreground,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
  const input = (
    label: string,
    value: string,
    onChangeText: (v: string) => void,
    numeric = false,
  ) => (
    <View style={{ gap: 6 }}>
      <Text style={{ color: c.mutedForeground }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        keyboardType={numeric ? "number-pad" : "default"}
        style={[
          s.input,
          {
            color: c.foreground,
            borderColor: c.border,
            backgroundColor: c.card,
          },
        ]}
      />
    </View>
  );
  const back = async () => {
    if (
      form &&
      !(await confirm({
        title: "Discard unsaved Calendar changes?",
        confirmLabel: "Discard",
      }))
    )
      return;
    router.replace("/(tabs)");
  };
  const begin = (kind: typeof form) => {
    setForm(kind);
    setError("");
    setTime(
      localInput(
        kind === "reschedule" && doc ? new Date(doc.startsAt) : new Date(),
      ),
    );
    setDuration(String(kind === "reschedule" && doc ? doc.duration : 60));
    setTitle("");
    setPeople([]);
  };
  const act = async (action: string) => {
    if (!doc || mutation.isPending) return;
    try {
      if (
        ["publish", "cancel"].includes(action) &&
        !(await confirm({
          title:
            action === "publish"
              ? "Publish this appointment?"
              : "Cancel this appointment?",
          message: "Affected participants will receive an in-app update.",
          confirmLabel: "Confirm",
        }))
      )
        return;
      mutation.mutate({
        path: `/api/calendar/${doc.id}/actions`,
        body: {
          action,
          revision: doc.revision,
          message,
          ...(action === "suggest"
            ? { suggestedAt: parseCalendarTime(time) }
            : {}),
        },
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = async () => {
    try {
      const startsAt = parseCalendarTime(time),
        minutes = Number(duration);
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 1440)
        throw new Error("Duration must be 5–1440 minutes.");
      if (
        form === "reschedule" &&
        !(await confirm({
          title: "Reschedule and request confirmation again?",
          message:
            "The previous time remains in history. Required participants must approve the new time.",
          confirmLabel: "Reschedule",
        }))
      )
        return;
      mutation.mutate({
        path:
          form === "unavailable"
            ? "/api/calendar-unavailable"
            : form === "reschedule"
              ? `/api/calendar/${doc!.id}/actions`
              : "/api/calendar",
        body: {
          title,
          businessId,
          propertyEntityId: propertyId,
          accountIds: people,
          startsAt,
          duration: minutes,
          action: "reschedule",
          revision: doc?.revision,
        },
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const rows = (q.data?.appointments ?? []).filter(
    (d) =>
      filter === "all" ||
      (filter === "pending"
        ? d.status === "pending"
        : d.status !== "cancelled" &&
          new Date(d.startsAt).getTime() + d.duration * 60000 >= Date.now()),
  );
  const text = { color: c.foreground },
    muted = { color: c.mutedForeground };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={[
        s.page,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 36 },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => void back()}
        style={s.row}
      >
        <Feather name="arrow-left" size={22} color={c.foreground} />
        <Text style={[text, { fontWeight: "600" }]}>
          Back to Command Center
        </Text>
      </Pressable>
      <Text style={[s.heading, text]}>Calendar</Text>
      <Text style={muted}>Schedule the work. Run your day in Daily Grind.</Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: c.destructive }}>
          {error}
        </Text>
      ) : null}
      {mutation.isPending && <ActivityIndicator />}
      {form ? (
        <View style={s.section}>
          <Text style={[s.title, text]}>
            {form === "create"
              ? "Propose an appointment"
              : form === "reschedule"
                ? "Reschedule appointment"
                : "Mark yourself Unavailable"}
          </Text>
          {form === "create" && (
            <>
              {input("Appointment", title, setTitle)}
              <Text style={muted}>Scheduling account</Text>
              <View style={s.row}>
                {button(
                  "My Property",
                  () => {
                    setBusinessId(null);
                    setPeople([]);
                  },
                  businessId === null,
                )}
                {contexts.data?.businesses.map((b) => (
                  <View key={b.id}>
                    {button(
                      b.name,
                      () => {
                        setBusinessId(b.id);
                        setPeople([]);
                      },
                      businessId === b.id,
                    )}
                  </View>
                ))}
              </View>
              <Text style={muted}>Property / Client</Text>
              <View style={s.row}>
                {contexts.data?.properties
                  .filter((p) => businessId || p.canScheduleOwn)
                  .map((p) => (
                    <View key={p.id}>
                      {button(
                        p.name,
                        () => {
                          setPropertyId(p.id);
                          setPeople([]);
                        },
                        propertyId === p.id,
                      )}
                    </View>
                  ))}
              </View>
              <Text style={muted}>
                Assigned people and required homeowner approvals
              </Text>
              {property?.people.map((p) => (
                <View key={p.accountId}>
                  {button(
                    `${people.includes(p.accountId) ? "✓ " : ""}${p.name}${p.homeowner ? " · Property owner/manager" : ""}`,
                    () =>
                      setPeople(
                        people.includes(p.accountId)
                          ? people.filter((id) => id !== p.accountId)
                          : [...people, p.accountId],
                      ),
                    people.includes(p.accountId),
                  )}
                </View>
              ))}
              <Text style={muted}>
                Company workers receive confirmed assignments. Independent
                workers and selected homeowners receive a request to approve.
              </Text>
            </>
          )}
          {form === "unavailable" && (
            <Text style={muted}>
              Only Unavailable is shared with scheduling. Your private
              commitment details stay private.
            </Text>
          )}
          {input("Local date and time · YYYY-MM-DD HH:MM", time, setTime)}
          {input("Expected duration · minutes", duration, setDuration, true)}
          {button(
            form === "create" ? "Save Proposed Appointment" : "Save",
            () => void save(),
            true,
          )}
          {button("Discard Changes", () => {
            void confirm({
              title: "Discard unsaved changes?",
              confirmLabel: "Discard",
            }).then((ok) => {
              if (ok) setForm(null);
            });
          })}
        </View>
      ) : doc ? (
        <View style={s.section}>
          {button("All Appointments", () => {
            setSelected(null);
            setMessage("");
            setError("");
          })}
          <Text style={[s.title, text]}>{doc.title}</Text>
          <Text style={text}>{doc.propertyName}</Text>
          <Text style={muted}>{doc.address}</Text>
          <Text style={text}>
            {new Date(doc.startsAt).toLocaleString()} · {doc.duration} minutes
          </Text>
          <Text style={{ color: c.primary, fontWeight: "700" }}>
            {calendarStatus(doc.status)}
          </Text>
          {doc.parties.map((p) => (
            <View key={p.accountId} style={s.section}>
              <Text style={text}>
                {p.name} ·{" "}
                {p.role === "homeowner"
                  ? "Homeowner"
                  : p.role === "independent"
                    ? "Independent worker"
                    : "Assigned worker"}{" "}
                ·{" "}
                {p.required
                  ? p.response === "accepted"
                    ? "Approved"
                    : p.response
                  : "Assigned"}
              </Text>
              {p.message && <Text style={muted}>{p.message}</Text>}
              {p.suggestedAt && (
                <Text style={muted}>
                  Suggested: {new Date(p.suggestedAt).toLocaleString()}
                </Text>
              )}
            </View>
          ))}
          <View style={s.row}>
            {doc.propertyId &&
              button("View Property", () =>
                router.push(`/property/${doc.propertyId}` as never),
              )}
            {doc.address
              ? button("Navigate to Property", () => {
                  void Linking.openURL(
                    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(doc.address)}`,
                  ).catch(() => setError("Maps could not be opened."));
                })
              : null}
            {doc.clientUserId &&
              button("Message Client", () =>
                router.push(
                  messageHrefFor({
                    clerkId: doc.clientUserId!,
                    counterpartOutwardAccountId: doc.clientAccountId,
                  }) as never,
                ),
              )}
          </View>
          {doc.canManage && doc.status !== "cancelled" && (
            <View style={s.row}>
              {doc.status === "proposed" &&
                button("Publish Appointment", () => void act("publish"), true)}
              {button("Reschedule", () => begin("reschedule"))}
              {button("Cancel Appointment", () => void act("cancel"))}
            </View>
          )}
          {doc.canRespond && (
            <View style={s.section}>
              <Text style={[s.title, text]}>Your response</Text>
              <View style={s.row}>
                {button("Accept", () => void act("accept"), true)}
                {button("Decline", () => void act("decline"))}
              </View>
              {input(
                "Alternative local time · YYYY-MM-DD HH:MM",
                time,
                setTime,
              )}
              {button("Suggest Another Time", () => void act("suggest"))}
              {input("Message", message, setMessage)}
              {button("Add Message", () => void act("message"))}
            </View>
          )}
          <Text style={[s.title, text]}>Appointment history</Text>
          {doc.events.map((e, i) => (
            <Text key={i} style={muted}>
              {new Date(e.at).toLocaleString()} · {e.action}
              {e.startsAt ? ` · ${new Date(e.startsAt).toLocaleString()}` : ""}
              {e.message ? ` · ${e.message}` : ""}
            </Text>
          ))}
        </View>
      ) : (
        <>
          <Text style={muted}>
            {q.data?.canSchedule
              ? "Manage appointments for your Properties. Confirmation is tracked for every required participant."
              : "Your visits and appointment requests appear here. Confirmed assignments also appear in your personal Daily Grind."}
          </Text>
          <View style={s.row}>
            {q.data?.canSchedule &&
              button("New Appointment", () => begin("create"), true)}
            {button("My Availability", () => setShowPrivate(!showPrivate))}
          </View>
          {showPrivate && (
            <View style={s.section}>
              <Text style={[s.title, text]}>My Unavailable Times</Text>
              {button("Add Unavailable Time", () => begin("unavailable"))}
              {blocks.isError
                ? button("Retry Availability", () => void blocks.refetch())
                : blocks.data?.blocks.map((b) => (
                    <View key={b.id}>
                      <Text style={text}>
                        {new Date(b.startsAt).toLocaleString()} –{" "}
                        {new Date(b.endsAt).toLocaleString()}
                      </Text>
                      {button("Remove Unavailable Time", () =>
                        mutation.mutate({
                          path: "/api/calendar-unavailable",
                          body: { removeId: b.id },
                        }),
                      )}
                    </View>
                  ))}
            </View>
          )}
          <View style={s.row}>
            {[
              ["upcoming", "Upcoming"],
              ["pending", "Pending Confirmation"],
              ["all", "All Appointments"],
            ].map(([id, label]) => (
              <View key={id}>
                {button(label, () => setFilter(id), filter === id)}
              </View>
            ))}
          </View>
          {q.isPending ? (
            <ActivityIndicator />
          ) : q.isError ? (
            button("Retry Calendar", () => void q.refetch())
          ) : rows.length ? (
            rows.map((d) => (
              <Pressable
                key={d.id}
                accessibilityRole="button"
                onPress={() => {
                  setSelected(d.id);
                  setTime(localInput(new Date(d.startsAt)));
                }}
                style={[
                  s.card,
                  { backgroundColor: c.card, borderColor: c.border },
                ]}
              >
                <View style={s.row}>
                  <Feather name="calendar" size={20} color={c.primary} />
                  <Text style={[s.title, text]}>{d.title}</Text>
                </View>
                <Text style={text}>{d.propertyName}</Text>
                <Text style={muted}>
                  {new Date(d.startsAt).toLocaleString()} · {d.duration} min
                </Text>
                <Text style={{ color: c.primary }}>
                  {calendarStatus(d.status)}
                </Text>
              </Pressable>
            ))
          ) : (
            <Text style={muted}>No appointments in this view.</Text>
          )}
          {contexts.isError &&
            button("Retry Scheduling Options", () => void contexts.refetch())}
        </>
      )}
    </ScrollView>
  );
}
const s = StyleSheet.create({
  page: {
    padding: 20,
    gap: 18,
    width: "100%",
    maxWidth: 900,
    alignSelf: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  heading: { fontSize: 30, fontWeight: "700" },
  title: { fontSize: 18, fontWeight: "600" },
  section: { gap: 14 },
  card: { padding: 20, borderRadius: 16, borderWidth: 1, gap: 10 },
  button: {
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
});
