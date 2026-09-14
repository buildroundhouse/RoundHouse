import React, { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { useProfile } from "@/lib/profile";
import { useColors } from "@/hooks/useColors";
import { confirm } from "@/lib/confirm";
import { isViewerKind } from "@/lib/personal-profile";
import { amountInCents, documentTitle, money, type FinancialContexts, type FinancialDocument } from "@/lib/financial-documents";
const date = (value: string) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export default function InvoicesScreen() {
  const { activeOutwardAccountId } = useProfile();
  const params = useLocalSearchParams<{ clientAccountId?: string; propertyEntityId?: string }>();
  return <InvoiceWorkspace key={`${activeOutwardAccountId}:${params.clientAccountId}:${params.propertyEntityId}`} />;
}
function InvoiceWorkspace() {
  const c = useColors(), insets = useSafeAreaInsets(), router = useRouter(), cache = useQueryClient();
  const { activeOutwardAccountId: accountId, activeOutwardAccount, activeMode, profile } = useProfile();
  const params = useLocalSearchParams<{ clientAccountId?: string; propertyEntityId?: string }>();
  const viewer = isViewerKind(activeOutwardAccount?.kind ?? activeMode?.kind);
  const headers = { "x-active-outward-account-id": String(accountId), "Content-Type": "application/json" };
  const query = useQuery({ queryKey: ["financial-documents", profile?.clerkId, accountId], enabled: !!accountId,
    queryFn: () => customFetch<{ documents: FinancialDocument[] }>("/api/financial-documents", { headers }) });
  const contexts = useQuery({ queryKey: ["financial-document-contexts", profile?.clerkId, accountId], enabled: !!accountId && !viewer,
    queryFn: () => customFetch<FinancialContexts>("/api/financial-document-contexts", { headers }) });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [clientFilter, setClientFilter] = useState<number | null>(Number(params.clientAccountId) || null);
  const [approvedOnly, setApprovedOnly] = useState(false);
  const [form, setForm] = useState<{ kind: "estimate" | "invoice"; id?: number; requestKey: string } | null>(null);
  const [issuerId, setIssuerId] = useState<number | null>(null), [propertyId, setPropertyId] = useState<number | null>(null), [clientId, setClientId] = useState<number | null>(null);
  const [description, setDescription] = useState(""), [amount, setAmount] = useState(""), [error, setError] = useState("");
  const records = query.data?.documents ?? [], selected = records.find(d => d.id === selectedId);
  const property = contexts.data?.properties.find(p => p.id === propertyId);
  const rows = records.filter(d => (!clientFilter || d.clientAccountId === clientFilter) && (!params.propertyEntityId || d.propertyEntityId === Number(params.propertyEntityId)) && (!approvedOnly || d.canConvert));
  const mutation = useMutation({
    mutationFn: (v: { path: string; body: unknown }) => customFetch<{ id: number }>(v.path, { method: "POST", headers, body: JSON.stringify(v.body) }),
    onSuccess: async result => { await cache.invalidateQueries({ queryKey: ["financial-documents"] }); setForm(null); setSelectedId(result.id); setError(""); },
    onError: (e: Error) => setError(e.message || "The document wasn't saved. Refresh and try again."),
  });
  const back = () => { setForm(null); setSelectedId(null); router.replace("/(tabs)"); };
  const leave = async () => { if (form && !(await confirm({ title: "Leave this document?", message: "Unsaved changes will be discarded.", confirmLabel: "Leave" }))) return; back(); };
  const closeForm = async () => { if (await confirm({ title: "Discard unsaved changes?", confirmLabel: "Discard" })) { setForm(null); setError(""); } };
  const button = (label: string, onPress: () => void, disabled = false, primary = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={[s.button, { borderColor: c.border, backgroundColor: primary ? c.primary : c.card, opacity: disabled ? 0.5 : 1 }]}><Text style={{ color: primary ? c.primaryForeground : c.foreground, fontWeight: "600" }}>{label}</Text></Pressable>;
  const navigation = <Pressable accessibilityRole="button" accessibilityLabel="Back to Command Center" onPress={() => void leave()} style={s.back}><Feather name="arrow-left" size={24} color={c.foreground}/><Text style={{ color: c.foreground, fontWeight: "600" }}>Back to Command Center</Text></Pressable>;
  const start = (kind: "estimate" | "invoice", doc?: FinancialDocument) => {
    setError(""); setForm({ kind, id: doc?.id, requestKey: `${Date.now()}-${Math.random().toString(36).slice(2)}` });
    setIssuerId(contexts.data?.issuers.length === 1 ? contexts.data.issuers[0].id : null); setPropertyId(null); setClientId(null);
    setDescription(doc?.description ?? ""); setAmount(doc ? (doc.amountCents / 100).toFixed(2) : "");
  };
  const act = async (action: string) => {
    if (!selected || mutation.isPending) return;
    if (!(await confirm({ title: action === "approve" ? `Approve ${documentTitle(selected)}?` : action === "check_collected" ? "Confirm check received" : "Convert approved estimate?",
      message: action === "check_collected" ? `Confirm you received a check for ${money(selected.amountCents)}. This records the invoice as paid; it does not deposit or clear the check.`
        : action === "approve" ? `${money(selected.amountCents)} · ${selected.propertyName}. Your approval will remain on record.` : "The approved estimate will remain read-only and linked to the new invoice.",
      confirmLabel: action === "check_collected" ? "Check received" : action === "approve" ? "Approve estimate" : "Convert" }))) return;
    setError(""); mutation.mutate({ path: `/api/financial-documents/${selected.id}/actions`, body: { action, confirmed: action === "check_collected" } });
  };
  const canCreate = !viewer && !!contexts.data?.issuers.length && contexts.data.properties.some(p => p.clients.length);
  return <View style={[s.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
    <View style={s.content}>{navigation}<Text style={[s.title, { color: c.foreground }]}>Estimates / Invoices</Text><Text style={[s.muted, { color: c.mutedForeground }]}>Estimate → Approval → Invoice → Payment</Text></View>
    <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 130 }]} refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => { void query.refetch(); void contexts.refetch(); }}/> }>
      {canCreate ? <View style={s.actions}>{button("Create Estimate", () => start("estimate"), false, true)}{button("Create Invoice", () => start("invoice"))}</View> : <Text style={[s.muted, { color: c.mutedForeground }]}>{viewer ? "View-only financial records within your authorized scope." : contexts.isPending ? "Loading financial permissions…" : "Client documents appear here for review. Creating documents requires Business financial permission and an authorized client at the Property."}</Text>}
      {!viewer && (canCreate || records.some(d => d.canConvert)) && button("Convert Estimate to Invoice", () => setApprovedOnly(true), !records.some(d => d.canConvert))}
      {contexts.isError && !viewer ? button("Retry financial permissions", () => void contexts.refetch()) : null}
      <Text style={[s.heading, { color: c.foreground }]}>{clientFilter ? "Client Portfolio" : approvedOnly ? "Approved estimates ready to convert" : "Recent estimates & invoices"}</Text>
      {(clientFilter || approvedOnly) && button("Show all recent documents", () => { setClientFilter(null); setApprovedOnly(false); })}
      {query.isPending ? <ActivityIndicator color={c.primary}/> : query.isError ? <View style={s.card}><Text style={{ color: c.foreground }}>Your financial documents couldn’t be loaded.</Text>{button("Try again", () => void query.refetch())}</View> : !rows.length ? <View style={[s.card, { borderColor: c.border }]}><Text style={{ color: c.foreground, fontWeight: "600" }}>No estimates or invoices here yet.</Text><Text style={{ color: c.mutedForeground }}>Saved documents stay linked to their client and Property.</Text></View> : rows.map(doc => <Pressable key={doc.id} accessibilityRole="button" accessibilityLabel={`Open ${documentTitle(doc)}`} onPress={() => { setSelectedId(doc.id); setError(""); }} style={[s.card, { borderColor: c.border, backgroundColor: c.card }]}>
        <View style={s.row}><Text style={[s.label, { color: c.foreground }]}>{documentTitle(doc)}</Text><Text style={{ color: doc.status === "pending" ? c.mutedForeground : c.primary, fontWeight: "600" }}>{doc.status === "pending" ? "Pending" : doc.status === "approved" ? "Approved" : "Paid"}</Text></View>
        <Text style={{ color: c.foreground }}>{doc.clientName}</Text><Text style={{ color: c.mutedForeground }}>{doc.propertyName}</Text>
        <View style={s.row}><Text style={[s.label, { color: c.foreground }]}>{money(doc.amountCents)}</Text><Text style={{ color: c.mutedForeground }}>{date(doc.updatedAt)}</Text></View>
      </Pressable>)}
      <View style={[s.card, { borderColor: c.border }]}><Text style={{ color: c.mutedForeground }}>QuickBooks Integration — Coming Soon</Text><Text style={{ color: c.mutedForeground }}>Roundhouse works independently.</Text></View>
    </ScrollView>
    <Modal visible={selectedId !== null && !form} animationType="slide" onRequestClose={() => setSelectedId(null)}>
      <View style={[s.screen, { backgroundColor: c.background, paddingTop: insets.top }]}><View style={s.content}>{navigation}{button("Back to Estimates / Invoices", () => { setSelectedId(null); setError(""); })}</View>
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 35 }]}>{selected ? <>
          <Text style={[s.title, { color: c.foreground }]}>{documentTitle(selected)}</Text><Text style={{ color: c.primary, fontWeight: "700" }}>{selected.status === "pending" ? "Pending" : selected.status === "approved" ? "Approved" : "Paid"}</Text>
          <Text style={{ color: c.foreground }}>{selected.issuerName}</Text><Text style={{ color: c.foreground }}>Client: {selected.clientName}</Text><Text style={{ color: c.foreground }}>Property: {selected.propertyName}</Text>
          <Text style={[s.title, { color: c.foreground }]}>{money(selected.amountCents)}</Text><Text selectable style={[s.description, { color: c.foreground }]}>{selected.description}</Text><Text style={{ color: c.mutedForeground }}>Created {date(selected.createdAt)}</Text>
          {selected.approvedAt && <Text style={{ color: c.mutedForeground }}>Approval recorded {date(selected.approvedAt)}</Text>}
          {selected.sourceEstimateId && button(`Created from ${records.find(d => d.id === selected.sourceEstimateId) ? documentTitle(records.find(d => d.id === selected.sourceEstimateId)!) : "approved estimate"}`, () => setSelectedId(selected.sourceEstimateId))}
          {selected.convertedInvoiceId && <><Text style={{ color: c.mutedForeground }}>Converted estimate — read-only. Create a new estimate for changes to the work.</Text>{button("View linked invoice", () => setSelectedId(selected.convertedInvoiceId))}</>}
          {button("View Client Portfolio", () => { setClientFilter(selected.clientAccountId); setApprovedOnly(false); setSelectedId(null); })}
          {!viewer && selected.canEdit && button("Edit pending document", () => start(selected.kind, selected), mutation.isPending)}
          {!viewer && selected.canApprove && button("Approve Estimate", () => void act("approve"), mutation.isPending, true)}
          {!viewer && selected.canConvert && button("Convert Estimate to Invoice", () => void act("convert"), mutation.isPending, true)}
          {selected.kind === "invoice" && selected.status === "pending" && <View style={[s.card, { borderColor: c.border }]}><Text style={[s.label, { color: c.foreground }]}>Payment</Text>
            <View style={s.actions}>{button("Apple Pay", () => {}, true)}{button("Google Pay", () => {}, true)}</View><Text style={{ color: c.mutedForeground }}>Digital payments are not connected yet.</Text>
            {!viewer && selected.canCollectCheck && button("Check Collected", () => void act("check_collected"), mutation.isPending, true)}
          </View>}
          {selected.paidAt && <Text style={{ color: c.foreground }}>Check Collected · {date(selected.paidAt)}</Text>}
          <Text style={[s.heading, { color: c.foreground }]}>Document history</Text>{selected.events.map((event, i) => <Text key={i} style={{ color: c.mutedForeground }}>{({ created: "Created", edited: "Updated before approval", approved: "Client approved", converted: "Converted to invoice", check_collected: "Check Collected" } as Record<string, string>)[event.action]} · {date(event.at)}</Text>)}
          {error ? <Text accessibilityRole="alert" style={{ color: c.destructive }}>{error}</Text> : null}
        </> : <Text style={{ color: c.foreground }}>This document is not available in the current account.</Text>}</ScrollView>
      </View>
    </Modal>
    <Modal visible={!!form} animationType="slide" onRequestClose={() => void closeForm()}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[s.screen, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={s.content}>{navigation}{button("Back to Estimates / Invoices", () => void closeForm(), mutation.isPending)}</View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 35 }]}>
        <Text style={[s.title, { color: c.foreground }]}>{form?.id ? "Edit pending" : "Create"} {form?.kind === "estimate" ? "Estimate" : "Invoice"}</Text>
        {!form?.id && <><Text style={[s.label, { color: c.foreground }]}>Business</Text>{contexts.data?.issuers.map(e => <View key={e.id}>{button(e.name, () => setIssuerId(e.id), false, issuerId === e.id)}</View>)}
          <Text style={[s.label, { color: c.foreground }]}>Property</Text>{contexts.data?.properties.map(e => <View key={e.id}>{button(e.name, () => { setPropertyId(e.id); setClientId(null); }, false, propertyId === e.id)}</View>)}
          {property && <><Text style={[s.label, { color: c.foreground }]}>Client</Text>{property.clients.map(client => <View key={client.accountId}>{button(client.name, () => setClientId(client.accountId), false, clientId === client.accountId)}</View>)}{!property.clients.length && <Text style={{ color: c.mutedForeground }}>This Property needs a client with financial authority before you can issue a document.</Text>}</>}
        </>}
        <Text style={[s.label, { color: c.foreground }]}>Work description</Text><TextInput accessibilityLabel="Work description" value={description} onChangeText={setDescription} multiline maxLength={10000} placeholder="Describe the work covered by this document…" placeholderTextColor={c.mutedForeground} style={[s.input, { minHeight: 130, color: c.foreground, borderColor: c.border }]}/>
        <Text style={[s.label, { color: c.foreground }]}>Total amount (USD)</Text><TextInput accessibilityLabel="Total amount in US dollars" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={c.mutedForeground} style={[s.input, { color: c.foreground, borderColor: c.border }]}/>
        <Text style={{ color: c.mutedForeground }}>Saving makes this document available to the named client and authorized financial participants. Approved documents stay on record.</Text>
        {button(mutation.isPending ? "Saving…" : "Save document", () => { if (!form) return; setError(""); mutation.mutate({ path: form.id ? `/api/financial-documents/${form.id}/actions` : "/api/financial-documents", body: { action: "edit", kind: form.kind, requestKey: form.requestKey, issuerEntityId: issuerId, propertyEntityId: propertyId, clientAccountId: clientId, description, amountCents: amountInCents(amount) } }); }, mutation.isPending || !description.trim() || amountInCents(amount) === null || (!form?.id && (!issuerId || !propertyId || !clientId)), true)}
        {error ? <Text accessibilityRole="alert" style={{ color: c.destructive }}>{error}</Text> : null}
      </ScrollView></KeyboardAvoidingView></Modal>
  </View>;
}
const s = StyleSheet.create({
  screen: { flex: 1 }, content: { width: "100%", maxWidth: 780, alignSelf: "center", paddingHorizontal: 20, gap: 14 },
  back: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 10 }, title: { fontSize: 28, fontWeight: "700", marginTop: 12 },
  muted: { fontSize: 14, lineHeight: 21, marginBottom: 10 }, heading: { fontSize: 19, fontWeight: "700", marginTop: 18 }, label: { fontSize: 16, fontWeight: "600" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }, actions: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16, marginBottom: 8 },
  button: { minHeight: 48, paddingHorizontal: 16, paddingVertical: 13, borderWidth: 1, borderRadius: 12, justifyContent: "center", alignItems: "center" },
  card: { borderWidth: 1, borderRadius: 16, padding: 18, gap: 10, marginVertical: 4 }, input: { borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 48, fontSize: 16, textAlignVertical: "top" }, description: { fontSize: 16, lineHeight: 25 },
});
