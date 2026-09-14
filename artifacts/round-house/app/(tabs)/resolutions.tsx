import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useColors } from "@/hooks/useColors";
import { ResolutionIndicator } from "@/components/ResolutionIndicator";
import { orderedResolutions, resolutionGroups, type Resolution } from "@/lib/resolutions";

const formatDate = (value: string) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export default function ResolutionCenter() {
  const c = useColors(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { userId } = useAuth(); const cache = useQueryClient();
  const params = useLocalSearchParams<{ resolutionId?: string }>();
  const openedLink = useRef<string | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [text, setText] = useState(""); const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [contextId, setContextId] = useState<number | null>(null);
  const [recipientId, setRecipientId] = useState("");
  const [question, setQuestion] = useState("");
  const contexts = useQuery({ queryKey: ["resolution-contexts", userId], enabled: creating && !!userId,
    queryFn: () => customFetch<{ contexts: { id: number; name: string; people: { id: string; name: string }[] }[] }>("/api/resolution-contexts") });
  const create = useMutation({
    mutationFn: () => customFetch<{ id: number }>("/api/resolutions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId: contextId, recipientId, question }) }),
    onSuccess: async (result) => {
      await cache.invalidateQueries({ queryKey: ["resolutions", userId] });
      await cache.invalidateQueries({ queryKey: ["/api/questions"] });
      setCreating(false); setSelectedId(result.id); setText(""); setVerified(false); setError("");
    },
    onError: () => setError("The resolution wasn’t created. Check the selected space and participant, then try again."),
  });
  const query = useQuery({ queryKey: ["resolutions", userId], enabled: !!userId,
    queryFn: () => customFetch<{ resolutions: Resolution[] }>("/api/resolutions"), refetchInterval: 30000 });
  const items = query.data?.resolutions ?? [];
  const selected = items.find(r => r.id === selectedId);
  useEffect(() => {
    if (params.resolutionId && openedLink.current !== params.resolutionId && query.data) {
      openedLink.current = params.resolutionId;
      setSelectedId(Number(params.resolutionId)); setText(""); setVerified(false); setError("");
    }
  }, [params.resolutionId, query.data]);
  const act = useMutation({
    mutationFn: (v: { id: number; action: string; text?: string; verified?: boolean }) => customFetch(`/api/resolutions/${v.id}/actions`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v),
    }),
    onSuccess: async (_data, v) => {
      if (v.action !== "read") { setText(""); setVerified(false); }
      await cache.invalidateQueries({ queryKey: ["resolutions", userId] });
      await cache.invalidateQueries({ queryKey: ["/api/questions"] });
    },
    onError: () => setError("That change wasn’t saved. Refresh this resolution and try again."),
  });
  useEffect(() => {
    if (selected?.unread && !act.isPending && !error) act.mutate({ id: selected.id, action: "read" });
  }, [selected?.id, selected?.unread]);
  const home = () => { setSelectedId(null); router.replace("/(tabs)"); };
  const open = (r: Resolution) => { setText(""); setVerified(false); setError(""); setSelectedId(r.id); };
  const send = (action: string) => {
    if (!selected) return;
    setError(""); act.mutate({ id: selected.id, action, text, verified });
  };
  const button = (label: string, onPress: () => void, disabled = false, filled = false) => <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
    style={[s.button, { borderColor: c.border, backgroundColor: filled ? c.text : c.card, opacity: disabled ? 0.4 : 1 }]}>
    <Text style={[s.buttonText, { color: filled ? c.card : c.text }]}>{label}</Text>
  </Pressable>;
  const back = <Pressable accessibilityRole="button" accessibilityLabel="Back to Control Center" onPress={home} style={s.back}>
    <Feather name="arrow-left" size={22} color={c.text} /><Text style={[s.backText, { color: c.text }]}>Control Center</Text>
  </Pressable>;

  return <View style={[s.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
    <View style={s.content}>
      {back}
      <View style={s.heading}><Text style={[s.title, { color: c.text }]}>Resolution Center</Text>
        <Text style={[s.subtitle, { color: c.mutedForeground }]}>Keep the conversation moving. Verify the outcome.</Text>
        <View style={{ marginTop: 16, alignSelf: "flex-start" }}>{button("New resolution", () => { setError(""); setQuestion(""); setContextId(null); setRecipientId(""); setCreating(true); }, false, true)}</View></View>
    </View>
    <ScrollView contentContainerStyle={[s.content, { paddingBottom: Math.max(insets.bottom, 24) + 90 }]} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={c.text} />}>
      {query.isPending ? <ActivityIndicator style={s.loading} color={c.text} /> : query.isError ? <View style={s.empty}>
        <Text accessibilityRole="alert" style={{ color: c.text }}>Your resolutions couldn’t be loaded.</Text>{button("Try again", () => void query.refetch())}
      </View> : resolutionGroups.map(group => {
        const rows = orderedResolutions(items, group.key);
        return <View key={group.key} style={s.group}>
          <View style={s.groupHeading}><View style={[s.dot, { backgroundColor: group.color }]} /><Text style={[s.groupTitle, { color: c.text }]}>{group.title}</Text><Text style={[s.count, { color: c.mutedForeground }]}>{rows.length}</Text></View>
          <Text style={[s.groupDescription, { color: c.mutedForeground }]}>{group.description}</Text>
          {rows.length === 0 ? <Text style={[s.emptyText, { color: c.mutedForeground }]}>{group.key === "attention" ? "Nothing needs your attention right now." : group.key === "waiting" ? "No resolutions waiting on someone else." : "Closed resolutions will remain here."}</Text> : rows.map(r => <Pressable key={r.id} accessibilityRole="button" accessibilityLabel={`Open resolution: ${r.question}`} onPress={() => open(r)} style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={[s.context, { color: c.mutedForeground }]}>{r.context || "Property / business context not recorded"}</Text>
            <View style={s.cardMain}><ResolutionIndicator status={r.status} followUps={r.followUps} /><View style={s.cardText}>
              {r.unread && <Text style={s.unread}>RESOLVED — NEW</Text>}
              <Text style={[s.question, { color: c.text }]} numberOfLines={3}>{r.question}</Text>
            </View><Feather name="chevron-right" size={18} color={c.mutedForeground} /></View>
            <Text style={[s.author, { color: c.text }]}>Created by {r.creatorName}</Text>
            <Text style={[s.meta, { color: c.mutedForeground }]}>{r.creatorId === userId ? `With ${r.otherName}` : `With ${r.creatorName}`} · {formatDate(r.updatedAt)}</Text>
            {!r.recipientLinked && r.status !== "resolved" && <Text style={[s.notice, { color: c.mutedForeground }]}>The original recipient wasn’t linked to an account. Delivery cannot be confirmed.</Text>}
            {!!r.followUps && r.status !== "resolved" && <Text style={[s.meta, { color: c.mutedForeground }]}>{r.followUps} unanswered follow-up{r.followUps === 1 ? "" : "s"} on this resolution</Text>}
          </Pressable>)}
        </View>;
      })}
    </ScrollView>

    <Modal visible={creating} animationType="slide" onRequestClose={() => setCreating(false)}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[s.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <View style={s.content}><Pressable accessibilityRole="button" onPress={() => setCreating(false)} style={s.back}><Feather name="arrow-left" size={22} color={c.text} /><Text style={[s.backText, { color: c.text }]}>Resolution Center</Text></Pressable></View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 30 }]}>
          <Text style={[s.detailTitle, { color: c.text }]}>New resolution</Text>
          <Text style={[s.sectionTitle, { color: c.text }]}>Which property or business?</Text>
          {contexts.isPending ? <ActivityIndicator color={c.text} /> : contexts.isError ? <>{button("Retry loading spaces", () => void contexts.refetch())}</> : contexts.data?.contexts.length ? contexts.data.contexts.map(context => <View key={context.id} style={{ marginBottom: 8 }}>{button(context.name, () => { setContextId(context.id); setRecipientId(""); }, false, contextId === context.id)}</View>) : <Text style={[s.subtitle, { color: c.mutedForeground }]}>You need a space where you can contribute before creating a resolution.</Text>}
          {contextId !== null && <>
            <Text style={[s.sectionTitle, { color: c.text }]}>Who needs to respond?</Text>
            {contexts.data?.contexts.find(e => e.id === contextId)?.people.map(person => <View key={person.id} style={{ marginBottom: 8 }}>{button(person.name, () => setRecipientId(person.id), false, recipientId === person.id)}</View>)}
            {!contexts.data?.contexts.find(e => e.id === contextId)?.people.length && <Text style={[s.subtitle, { color: c.mutedForeground }]}>There are no other participants in this space yet. Add someone through People first.</Text>}
          </>}
          <Text style={[s.sectionTitle, { color: c.text }]}>What needs to be resolved?</Text>
          <TextInput accessibilityLabel="New resolution question or request" value={question} onChangeText={setQuestion} multiline maxLength={10000} placeholder="Describe the question, request, or outcome you need…" placeholderTextColor={c.mutedForeground} style={[s.input, { color: c.text, backgroundColor: c.card, borderColor: c.border }]} />
          <Text style={[s.subtitle, { color: c.mutedForeground }]}>Visible to you and the selected participant. You’ll review the outcome and close it when it’s resolved.</Text>
          <View style={{ marginTop: 18 }}>{button(create.isPending ? "Creating…" : "Create resolution", () => { setError(""); create.mutate(); }, create.isPending || !contextId || !recipientId || !question.trim(), true)}</View>
          {error ? <Text accessibilityRole="alert" style={[s.error, { color: c.destructive }]}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>

    <Modal visible={selectedId !== null} animationType="slide" onRequestClose={() => setSelectedId(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[s.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <View style={[s.content, s.detailNav]}><Pressable accessibilityRole="button" onPress={() => setSelectedId(null)} style={s.back} accessibilityLabel="Back to Resolution Center"><Feather name="arrow-left" size={22} color={c.text} /><Text style={[s.backText, { color: c.text }]}>Resolutions</Text></Pressable>{button("Control Center", home)}</View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.content, { paddingBottom: Math.max(insets.bottom, 24) + 20 }]}>
          {selected ? <>
            <Text style={[s.context, { color: c.mutedForeground }]}>{selected.context || "Property / business context not recorded"}</Text>
            <ResolutionIndicator status={selected.status} followUps={selected.followUps} />
            <Text style={[s.author, { color: c.text }]}>Created by {selected.creatorName}</Text>
            <Text style={[s.detailTitle, { color: c.text }]}>{selected.question}</Text>
            <Text style={[s.meta, { color: c.mutedForeground }]}>{formatDate(selected.createdAt)} · {resolutionGroups.find(g => g.key === selected.status)?.title}</Text>
            {selected.requestedAction && <Text style={[s.subtitle, { color: c.text }]}>Requested action: {selected.requestedAction}</Text>}
            {selected.nextStep && <Text style={[s.subtitle, { color: c.text }]}>Recorded next step: {selected.nextStep === "appointment" ? "Schedule an appointment" : selected.nextStep === "list" ? "Add to a list" : "Information only"}</Text>}
            <Text style={[s.sectionTitle, { color: c.text }]}>Discussion &amp; outcome</Text>
            {selected.events.length === 0 && <Text style={[s.emptyText, { color: c.mutedForeground }]}>No responses yet.</Text>}
            {selected.events.map((event, i) => <View key={`${event.at}-${i}`} style={[s.event, { backgroundColor: c.card, borderColor: c.border }]}>
              <Text style={[s.author, { color: c.text }]}>{event.actorName} · {event.kind === "resolved" ? "Verified & resolved" : event.kind === "follow_up" ? "Follow-up" : "Response"}</Text>
              <Text style={[s.eventText, { color: c.text }]} selectable>{event.text}</Text>
              <Text style={[s.meta, { color: c.mutedForeground }]}>{event.actorId ? formatDate(event.at) : "Original author and response time weren’t recorded."}</Text>
            </View>)}
            {selected.status === "resolved" ? <View style={[s.closeout, { borderColor: c.border }]}><Text style={[s.author, { color: c.text }]}>Resolved history</Text><Text style={[s.subtitle, { color: c.mutedForeground }]}>{selected.closedAt ? `Closed ${formatDate(selected.closedAt)}. ` : ""}This conversation stays on record.</Text></View> : <>
              <Text style={[s.sectionTitle, { color: c.text }]}>Respond or record the outcome</Text>
              <TextInput accessibilityLabel="Resolution response" value={text} onChangeText={setText} multiline maxLength={10000} placeholder="Write your response, next action, or verified result…" placeholderTextColor={c.mutedForeground} style={[s.input, { color: c.text, backgroundColor: c.card, borderColor: c.border }]} />
              <Text style={[s.subtitle, { color: c.mutedForeground }]}>A response passes responsibility back. It does not close the resolution.</Text>
              <View style={s.actions}>{button("Send response", () => send("reply"), act.isPending || !text.trim(), true)}{selected.status === "waiting" && button("Follow up", () => send("follow_up"), act.isPending || !text.trim())}</View>
              {selected.creatorId === userId ? <View style={[s.closeout, { borderColor: c.border }]}>
                <Text style={[s.author, { color: c.text }]}>Creator’s closeout</Text>
                <Text style={[s.subtitle, { color: c.mutedForeground }]}>Describe the final result above, then confirm that the requested outcome actually happened.</Text>
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: verified }} onPress={() => setVerified(!verified)} style={s.verify}><Feather name={verified ? "check-square" : "square"} size={22} color={c.text} /><Text style={[s.verifyText, { color: c.text }]}>I verified the outcome.</Text></Pressable>
                {button("Mark resolved", () => send("resolve"), !verified || !text.trim() || act.isPending)}
              </View> : <Text style={[s.subtitle, { color: c.mutedForeground }]}>Only {selected.creatorName}, the creator, can mark this resolved.</Text>}
            </>}
            {error ? <Text accessibilityRole="alert" style={[s.error, { color: c.destructive }]}>{error}</Text> : null}
            {act.isPending && <ActivityIndicator color={c.text} style={{ marginTop: 16 }} />}
          </> : <Text style={{ color: c.text }}>This resolution is no longer available. Return to the list and refresh.</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  </View>;
}
const s = StyleSheet.create({
  screen: { flex: 1 }, content: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 20 },
  back: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 10 }, backText: { fontSize: 15, fontWeight: "600" },
  heading: { paddingTop: 12, paddingBottom: 24 }, title: { fontSize: 29, fontWeight: "700", letterSpacing: -0.7 }, subtitle: { fontSize: 14, lineHeight: 21, marginTop: 8 },
  loading: { padding: 45 }, group: { marginBottom: 28 }, groupHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 }, groupTitle: { fontSize: 19, fontWeight: "700", flex: 1 }, count: { fontSize: 16, fontWeight: "600" }, groupDescription: { fontSize: 13, marginTop: 6, marginBottom: 12 },
  empty: { gap: 16, paddingVertical: 25 }, emptyText: { fontSize: 14, paddingVertical: 14, lineHeight: 21 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 10 }, context: { fontSize: 12, fontWeight: "600", lineHeight: 18 },
  cardMain: { flexDirection: "row", alignItems: "center", gap: 6, marginVertical: 8 }, cardText: { flex: 1 }, question: { fontSize: 16, fontWeight: "600", lineHeight: 23 },
  author: { fontSize: 13, fontWeight: "600", lineHeight: 20 }, meta: { fontSize: 12, lineHeight: 19, marginTop: 4 }, notice: { fontSize: 12, lineHeight: 18, marginTop: 8 },
  unread: { color: "#16834A", fontSize: 11, fontWeight: "800", marginBottom: 5 }, detailNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 12, gap: 8 },
  detailTitle: { fontSize: 25, fontWeight: "700", lineHeight: 33, marginTop: 12 }, sectionTitle: { fontSize: 18, fontWeight: "700", marginTop: 28, marginBottom: 14 },
  event: { padding: 16, borderRadius: 12, borderWidth: 1, marginBottom: 12 }, eventText: { fontSize: 16, lineHeight: 24, marginVertical: 9 },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 130, padding: 14, fontSize: 16, lineHeight: 24, textAlignVertical: "top" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 }, button: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderRadius: 10, alignItems: "center", justifyContent: "center" }, buttonText: { fontSize: 14, fontWeight: "600" },
  closeout: { borderTopWidth: 1, marginTop: 26, paddingTop: 22 }, verify: { flexDirection: "row", alignItems: "center", minHeight: 52, gap: 10, marginVertical: 10 }, verifyText: { fontSize: 15, flex: 1 }, error: { fontSize: 14, lineHeight: 21, marginTop: 16 },
});
