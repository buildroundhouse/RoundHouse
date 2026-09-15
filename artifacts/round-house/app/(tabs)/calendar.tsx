import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
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
  calendarMonthDays,
  dayKey,
  localInput,
  monthTitle,
  parseCalendarTime,
  sameLocalDay,
  timeRange,
  type AvailabilitySlot,
  type CalendarAppointment,
  type CalendarContexts,
} from "@/lib/calendar";
const EMPTY_APPOINTMENTS: CalendarAppointment[] = [];
const EMPTY_SLOTS: AvailabilitySlot[] = [];

export default function CalendarScreen() {
  const { activeOutwardAccountId } = useProfile();
  return <CalendarWorkspace key={activeOutwardAccountId} />;
}
function CalendarWorkspace() {
  const c = useColors(),
    router = useRouter(),
    insets = useSafeAreaInsets(),
    cache = useQueryClient();
  const { width } = useWindowDimensions();
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
  const availability = useQuery({
    queryKey: ["calendar-availability", profile?.clerkId],
    enabled: !!profile?.clerkId,
    queryFn: () =>
      customFetch<{
        slots: AvailabilitySlot[];
      }>("/api/calendar-availability", { headers }),
  });
  const [selected, setSelected] = useState<number | null>(
      Number(params.appointmentId) || null,
    ),
    [form, setForm] = useState<"create" | "reschedule" | "availability" | null>(
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
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [visibleMonth, setVisibleMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
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
        ["calendar", "calendar-daily", "calendar-availability"].map((key) =>
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
    const selectedStart = new Date(selectedDay);
    if (selectedStart.getHours() === 0 && selectedStart.getMinutes() === 0)
      selectedStart.setHours(9, 0, 0, 0);
    setTime(
      localInput(
        kind === "reschedule" && doc ? new Date(doc.startsAt) : selectedStart,
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
          form === "availability"
            ? "/api/calendar-availability"
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
  const appointments = q.data?.appointments ?? EMPTY_APPOINTMENTS;
  const slots = availability.data?.slots ?? EMPTY_SLOTS;
  const monthDays = useMemo(
    () => calendarMonthDays(visibleMonth),
    [visibleMonth],
  );
  const appointmentsByDay = useMemo(() => {
    const result = new Map<string, CalendarAppointment[]>();
    for (const appointment of appointments) {
      if (appointment.status === "cancelled") continue;
      const key = dayKey(appointment.startsAt);
      result.set(key, [...(result.get(key) ?? []), appointment]);
    }
    return result;
  }, [appointments]);
  const slotsByDay = useMemo(() => {
    const result = new Map<string, AvailabilitySlot[]>();
    for (const slot of slots) {
      const key = dayKey(slot.startsAt);
      result.set(key, [...(result.get(key) ?? []), slot]);
    }
    return result;
  }, [slots]);
  const dayAppointments = appointments
    .filter(
      (appointment) =>
        appointment.status !== "cancelled" &&
        sameLocalDay(appointment.startsAt, selectedDay),
    )
    .sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
  const daySlots = slots
    .filter((slot) => sameLocalDay(slot.startsAt, selectedDay))
    .sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
    );
  const calendarName = contexts.data?.businesses.length
    ? "Scheduling Calendar"
    : contexts.data?.properties.some((property) => property.canScheduleOwn)
      ? "Property Calendar"
      : appointments.some((appointment) => appointment.myAssignment)
        ? "My Work Calendar"
        : "My Calendar";
  const text = { color: c.foreground },
    muted = { color: c.mutedForeground };
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={[
        s.page,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 120 },
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
      <Text style={[s.heading, text]}>{calendarName}</Text>
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
                : "Add Open Time"}
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
          {form === "availability" && (
            <Text style={muted}>
              This time will appear as an open slot on your calendar. Your
              private commitments remain private.
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
              <Text style={[s.title, text]}>My Availability</Text>
              <Text style={muted}>
                Add the times you are open. They appear directly on the calendar
                in green.
              </Text>
              {button("Add Open Time", () => begin("availability"), true)}
              {availability.isError
                ? button(
                    "Retry Availability",
                    () => void availability.refetch(),
                  )
                : slots.map((slot) => (
                    <View key={slot.id} style={s.availabilityRow}>
                      <Text style={text}>
                        {new Date(slot.startsAt).toLocaleDateString()} ·{" "}
                        {timeRange(slot.startsAt, slot.endsAt)}
                      </Text>
                      {button("Remove Open Time", () =>
                        mutation.mutate({
                          path: "/api/calendar-availability",
                          body: { removeId: slot.id },
                        }),
                      )}
                    </View>
                  ))}
            </View>
          )}
          <View
            style={[
              s.calendar,
              { borderColor: c.border, backgroundColor: c.card },
            ]}
          >
            <View style={s.monthHeader}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Previous month"
                onPress={() =>
                  setVisibleMonth(
                    new Date(
                      visibleMonth.getFullYear(),
                      visibleMonth.getMonth() - 1,
                      1,
                    ),
                  )
                }
                style={s.monthButton}
              >
                <Feather name="chevron-left" size={24} color={c.foreground} />
              </Pressable>
              <Text style={[s.title, text]}>{monthTitle(visibleMonth)}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Next month"
                onPress={() =>
                  setVisibleMonth(
                    new Date(
                      visibleMonth.getFullYear(),
                      visibleMonth.getMonth() + 1,
                      1,
                    ),
                  )
                }
                style={s.monthButton}
              >
                <Feather name="chevron-right" size={24} color={c.foreground} />
              </Pressable>
            </View>
            <View style={s.weekRow}>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                <Text key={day} style={[s.weekday, muted]}>
                  {width < 430 ? day.slice(0, 1) : day}
                </Text>
              ))}
            </View>
            <View style={s.monthGrid}>
              {monthDays.map((day) => {
                const dateAppointments =
                  appointmentsByDay.get(dayKey(day)) ?? EMPTY_APPOINTMENTS;
                const dateSlots = slotsByDay.get(dayKey(day)) ?? EMPTY_SLOTS;
                const selectedDate = sameLocalDay(day, selectedDay);
                const inMonth = day.getMonth() === visibleMonth.getMonth();
                return (
                  <Pressable
                    key={dayKey(day)}
                    accessibilityRole="button"
                    accessibilityLabel={`${day.toLocaleDateString()}, ${dateSlots.length} open slots, ${dateAppointments.length} appointments`}
                    accessibilityState={{ selected: selectedDate }}
                    onPress={() => setSelectedDay(day)}
                    style={[
                      s.dayCell,
                      {
                        minHeight: width < 430 ? 68 : 92,
                        borderColor: selectedDate ? c.primary : c.border,
                        borderWidth: selectedDate
                          ? 2
                          : StyleSheet.hairlineWidth,
                        opacity: inMonth ? 1 : 0.42,
                      },
                    ]}
                  >
                    <Text style={[s.dayNumber, text]}>{day.getDate()}</Text>
                    {dateSlots.length > 0 ? (
                      <View
                        style={[s.calendarMark, { backgroundColor: "#2E7D32" }]}
                      >
                        <Text numberOfLines={1} style={s.calendarMarkText}>
                          {width < 430 ? "Open" : `${dateSlots.length} open`}
                        </Text>
                      </View>
                    ) : null}
                    {dateAppointments
                      .slice(0, width < 430 ? 2 : 3)
                      .map((appointment) => (
                        <View
                          key={appointment.id}
                          style={[
                            s.calendarMark,
                            {
                              backgroundColor:
                                appointment.status === "confirmed"
                                  ? "#1976D2"
                                  : appointment.status === "pending"
                                    ? "#C47B12"
                                    : "#6B7280",
                            },
                          ]}
                        >
                          <Text numberOfLines={1} style={s.calendarMarkText}>
                            {width < 430
                              ? appointment.status === "confirmed"
                                ? "Set"
                                : appointment.status === "pending"
                                  ? "Wait"
                                  : "Draft"
                              : appointment.title}
                          </Text>
                        </View>
                      ))}
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={s.legend}>
            <Text style={muted}>
              ● <Text style={{ color: "#2E7D32" }}>Open</Text>
            </Text>
            <Text style={muted}>
              ● <Text style={{ color: "#C47B12" }}>Pending</Text>
            </Text>
            <Text style={muted}>
              ● <Text style={{ color: "#1976D2" }}>Confirmed</Text>
            </Text>
            <Text style={muted}>
              ● <Text style={{ color: "#6B7280" }}>Proposed</Text>
            </Text>
          </View>
          <View style={s.dayHeader}>
            <View>
              <Text style={[s.title, text]}>
                {selectedDay.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </Text>
              <Text style={muted}>Open times and scheduled work</Text>
            </View>
            {button("Today", () => {
              const today = new Date();
              setSelectedDay(today);
              setVisibleMonth(
                new Date(today.getFullYear(), today.getMonth(), 1),
              );
            })}
          </View>
          {daySlots.map((slot) => (
            <View
              key={`slot-${slot.id}`}
              style={[
                s.agendaCard,
                { borderColor: "#2E7D32", backgroundColor: c.card },
              ]}
            >
              <View style={[s.statusRail, { backgroundColor: "#2E7D32" }]} />
              <View style={s.agendaContent}>
                <Text style={[s.title, { color: "#2E7D32" }]}>Open</Text>
                <Text style={text}>
                  {timeRange(slot.startsAt, slot.endsAt)}
                </Text>
              </View>
            </View>
          ))}
          {q.isPending || availability.isPending ? (
            <ActivityIndicator />
          ) : q.isError ? (
            button("Retry Calendar", () => void q.refetch())
          ) : dayAppointments.length ? (
            dayAppointments.map((d) => (
              <Pressable
                key={d.id}
                accessibilityRole="button"
                onPress={() => {
                  setSelected(d.id);
                  setTime(localInput(new Date(d.startsAt)));
                }}
                style={[
                  s.agendaCard,
                  {
                    backgroundColor: c.card,
                    borderColor:
                      d.status === "confirmed"
                        ? "#1976D2"
                        : d.status === "pending"
                          ? "#C47B12"
                          : "#6B7280",
                  },
                ]}
              >
                <View
                  style={[
                    s.statusRail,
                    {
                      backgroundColor:
                        d.status === "confirmed"
                          ? "#1976D2"
                          : d.status === "pending"
                            ? "#C47B12"
                            : "#6B7280",
                    },
                  ]}
                />
                <View style={s.agendaContent}>
                  <Text style={[s.title, text]}>{d.title}</Text>
                  <Text style={text}>
                    {timeRange(d.startsAt, undefined, d.duration)} ·{" "}
                    {d.propertyName}
                  </Text>
                  <Text style={muted}>{calendarStatus(d.status)}</Text>
                </View>
              </Pressable>
            ))
          ) : daySlots.length ? null : (
            <Text style={muted}>
              No open times or appointments on this date.
            </Text>
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
    paddingBottom: 130,
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
  calendar: { borderWidth: 1, borderRadius: 18, overflow: "hidden" },
  monthHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
  },
  monthButton: { padding: 12 },
  weekRow: { flexDirection: "row" },
  weekday: {
    width: "14.2857%",
    textAlign: "center",
    paddingVertical: 8,
    fontSize: 12,
    fontWeight: "600",
  },
  monthGrid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: "14.2857%", padding: 4, gap: 3 },
  dayNumber: { fontSize: 13, fontWeight: "600" },
  calendarMark: { borderRadius: 4, paddingHorizontal: 3, paddingVertical: 2 },
  calendarMarkText: { color: "white", fontSize: 9, fontWeight: "700" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  dayHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  agendaCard: {
    minHeight: 72,
    borderWidth: 1,
    borderRadius: 14,
    overflow: "hidden",
    flexDirection: "row",
  },
  statusRail: { width: 7 },
  agendaContent: { flex: 1, padding: 14, gap: 5 },
  availabilityRow: { gap: 8, paddingVertical: 4 },
  button: {
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 10,
  },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16 },
});
