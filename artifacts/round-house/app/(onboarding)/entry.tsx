import React, { useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { customFetch } from "@workspace/api-client-react";
import { APPROVED_ROLE_TITLES, approvedSteps, reviseApprovedDraft, titleAuthority, titleNeedsPersonalPaid, type ApprovedIntakeDraft, type ApprovedIntakePath, type ApprovedRoleTitle } from "@workspace/api-zod";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/lib/profile";
import { resolveStorageUrl, uploadAsset } from "@/lib/uploads";

type SearchResult = { id: number; name: string; address?: string | null };
type DraftResponse = { modeId: number | null; draft: ApprovedIntakeDraft | null };
const EMPTY: ApprovedIntakeDraft = { currentStep: "choose-path", data: {} };

export default function ApprovedIntakeScreen() {
  const colors = useColors(), insets = useSafeAreaInsets(), router = useRouter(), profile = useProfile();
  const [draft, setDraft] = useState<ApprovedIntakeDraft>(EMPTY);
  const [modeId, setModeId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false), [results, setResults] = useState<SearchResult[]>([]);
  const storageKey = `roundhouse:approved-intake:${profile.profile?.clerkId ?? "loading"}`;
  const cacheQueue = useRef(Promise.resolve());
  function cache(next: ApprovedIntakeDraft, id = modeId) {
    cacheQueue.current = cacheQueue.current.then(() => AsyncStorage.setItem(storageKey, JSON.stringify({ draft: next, modeId: id }))).catch(() => { setError("Could not save this draft on this device. Use Continue to save it to your account."); });
  }

  useEffect(() => {
    let mounted = true;
    Promise.all([customFetch<DraftResponse>("/api/intake/draft"), AsyncStorage.getItem(storageKey)]).then(([remote, local]) => {
      if (!mounted) return;
      let cached: DraftResponse | null = null;
      try { cached = local ? JSON.parse(local) as DraftResponse : null; } catch { /* A damaged device cache must not prevent restoring the account draft. */ }
      const value = cached?.draft && cached.modeId === remote.modeId ? cached : remote;
      setModeId(value.modeId); if (value.draft) setDraft(value.draft);
    }).catch((e) => { if (mounted) setError(messageOf(e)); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [storageKey]);
  const steps = useMemo(() => approvedSteps(draft), [draft]);
  const step = draft.currentStep && steps.includes(draft.currentStep) ? draft.currentStep : steps[0];
  const stepNumber = Math.max(1, steps.indexOf(step) + 1);

  async function persist(next: ApprovedIntakeDraft) {
    setSaving(true); setError("");
    try {
      const v = await customFetch<DraftResponse>("/api/intake/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modeId, draft: next }) });
      setModeId(v.modeId); setDraft(next); cache(next, v.modeId); return true;
    } catch (e) { setError(messageOf(e)); return false; } finally { setSaving(false); }
  }
  async function advance(patch: Partial<ApprovedIntakeDraft> = {}) {
    let next = reviseApprovedDraft(draft, patch), nextSteps = approvedSteps(next);
    const index = Math.max(0, nextSteps.indexOf(step));
    next = { ...next, currentStep: draft.returnToReview ? "review" : nextSteps[Math.min(index + 1, nextSteps.length - 1)], returnToReview: false };
    await persist(next);
  }
  async function back() {
    const index = steps.indexOf(step);
    if (index <= 0) { router.canGoBack() ? router.back() : router.replace("/(onboarding)/entry"); return; }
    await persist({ ...draft, currentStep: steps[index - 1], returnToReview: false });
  }
  async function search() {
    const searchText = draft.path === "property" && draft.propertyType === "residential" ? [draft.data.streetAddress, draft.data.unit, draft.data.city, draft.data.state, draft.data.zip].filter(Boolean).join(" ") : query.trim();
    if (!draft.path || !searchText) return;
    setSaving(true); setError("");
    try { const v = await customFetch<{ results: SearchResult[] }>(`/api/intake/search?path=${draft.path}&q=${encodeURIComponent(searchText)}`); setResults(v.results); setSearched(true); }
    catch (e) { setError(messageOf(e)); } finally { setSaving(false); }
  }
  async function activate() {
    if (!modeId) return;
    setError("");
    const saved = { ...draft, currentStep: "review" };
    if (!(await persist(saved))) return;
    setSaving(true);
    try {
      const result = await customFetch<{ status: "active" | "pending" }>(`/api/intake/activate/${modeId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: saved }) });
      if (result.status === "pending") { setError("Your access request is pending. You’ll stay in intake until an authorized person approves it."); return; }
      setDraft({ ...saved, currentStep: "complete" });
      await cacheQueue.current;
      await AsyncStorage.removeItem(storageKey);
      await Promise.all([profile.refetchProfile(), profile.refetchModes(), profile.refetchOutwardAccounts()]);
    } catch (e) { setError(messageOf(e)); } finally { setSaving(false); }
  }
  async function startCreation() {
    if (!draft.path) return;
    setSaving(true); setError("");
    try {
      const result = await customFetch<{ allowed: boolean; message?: string | null }>(`/api/intake/creation-eligibility?path=${draft.path}`);
      if (!result.allowed) { setError(result.message || "ADD PRO is required to create another record."); return; }
      const address = draft.path === "property" ? [draft.data.streetAddress, draft.data.unit, draft.data.city, draft.data.state, draft.data.zip].filter(Boolean).join(" ") || query : str(draft.data.address);
      await advance({ creating: true, existingEntityId: undefined, data: { address } });
    } catch (e) { setError(messageOf(e)); } finally { setSaving(false); }
  }
  async function addPro() {
    if (!modeId || !(await persist(draft))) return;
    setSaving(true);
    try {
      const result = await customFetch<{ accountId: number }>(`/api/intake/billing/${modeId}`, { method: "POST" });
      router.push({ pathname: "/account/billing", params: { accountId: String(result.accountId), returnToIntake: "1" } });
    } catch (e) { setError(messageOf(e)); } finally { setSaving(false); }
  }
  if (loading) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator /></View>;
  return <View style={[styles.root, { backgroundColor: colors.background }]}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 32 }]}>
    {step !== "complete" ? <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back} style={styles.back}><Text style={{ color: colors.foreground }}>‹ Back</Text></Pressable> : null}
    <Text style={{ color: colors.mutedForeground }}>Screen {stepNumber} of {steps.length}</Text>
    <StepContent draft={draft} step={step} query={query} results={results} searched={searched} setQuery={(v) => { setQuery(v); setSearched(false); }} search={search} startCreation={startCreation} update={(p) => { const next = reviseApprovedDraft(draft, p); setDraft(next); cache(next); }} advance={advance} persist={persist} activate={activate} addPro={addPro} enter={() => router.replace("/(tabs)")} />
    {error ? <View style={[styles.notice, { borderColor: colors.destructive }]}><Text style={{ color: colors.destructive }}>{error}</Text>{/add pro/i.test(error) ? <Action label="ADD PRO" onPress={addPro} /> : null}</View> : null}
    {saving ? <ActivityIndicator /> : null}
  </ScrollView></View>;
}

function StepContent(p: { draft: ApprovedIntakeDraft; step: string; query: string; results: SearchResult[]; searched: boolean; setQuery: (v: string) => void; search: () => void; startCreation: () => void; update: (v: Partial<ApprovedIntakeDraft>) => void; advance: (v?: Partial<ApprovedIntakeDraft>) => void; persist: (v: ApprovedIntakeDraft) => Promise<boolean>; activate: () => void; addPro: () => void; enter: () => void }) {
  const { draft, step, update, advance } = p;
  if (step === "choose-path") return <Panel title="Choose Path" intro="What would you like to add or connect with?">{(["property", "trade", "supplier"] as ApprovedIntakePath[]).map((path) => <Choice key={path} label={path.toUpperCase()} onPress={() => advance({ path, currentStep: "choose-path" })} />)}</Panel>;
  if (step === "property-type") return <Panel title="Property Type" intro="Is this a residential Property or a commercial Facility?"><Choice label="Residential" onPress={() => advance({ propertyType: "residential" })} /><Choice label="Commercial" onPress={() => advance({ propertyType: "commercial" })} /></Panel>;
  if (step === "find") return <Panel title={draft.path === "property" ? "Find Property" : "Find Business"} intro="Search before creating so an existing record is not duplicated.">
    {draft.path === "property" && draft.propertyType === "residential" ? ([['streetAddress', 'Street address'], ['unit', 'Unit / Apt'], ['city', 'City'], ['state', 'State'], ['zip', 'ZIP']] as const).map(([key, label]) => <Field key={key} label={label} value={str(draft.data[key])} onChange={(value) => { update({ data: { [key]: value } }); p.setQuery(""); }} />) : <><Field label={draft.path === "property" ? "Address or Facility name" : "Business name or location"} value={p.query} onChange={p.setQuery} />{draft.path !== "property" ? <Field label="Location" value={str(draft.data.address)} onChange={(address) => update({ data: { address } })} /> : null}</>}
    <Action label="SEARCH" onPress={p.search} />
    {p.results.map((x) => <Choice key={x.id} label={x.name} detail={x.address ?? undefined} onPress={() => advance({ creating: false, existingEntityId: x.id, data: { address: x.address ?? "", businessName: draft.path === "property" ? undefined : x.name, propertyName: draft.path === "property" ? x.name : undefined } })} />)}
    {p.searched ? <Choice label={draft.path === "property" ? "Add a new Property" : "Add a new Business"} detail="No existing record matches" onPress={p.startCreation} /> : null}
  </Panel>;
  if (step === "role") { const roles = draft.path ? APPROVED_ROLE_TITLES[draft.path] : []; return <Panel title="Role" intro="Choose the exact role that describes your authorized relationship.">{roles.map((role) => <Choice key={role} label={role} selected={draft.roleTitle === role} onPress={() => advance({ roleTitle: role as ApprovedRoleTitle })} />)}</Panel>; }
  if (step === "profile") return <Panel title={draft.path === "property" ? "Property Profile" : "Business Profile"} intro="Add the record details. This does not activate it yet.">{draft.path === "property" ? <Field label="Property name (optional)" value={str(draft.data.propertyName)} onChange={(propertyName) => update({ data: { propertyName } })} /> : <Field label="Business name" value={str(draft.data.businessName)} onChange={(businessName) => update({ data: { businessName } })} />}<Field label="Address" value={str(draft.data.address)} onChange={(address) => update({ data: { address } })} /><IntakePhoto value={str(draft.data.photo)} onChange={(photo) => update({ data: { photo } })} />{draft.path === "property" ? <Field multiline label="Basic Property information" value={str(draft.data.basicInfo)} onChange={(basicInfo) => update({ data: { basicInfo } })} /> : <><Field label="Years in business" value={str(draft.data.yearsInBusiness)} onChange={(yearsInBusiness) => update({ data: { yearsInBusiness } })} /><Field label="Employee count (when applicable)" value={str(draft.data.employeeCount)} onChange={(employeeCount) => update({ data: { employeeCount } })} /></>}<Action label="SAVE & CONTINUE" onPress={() => advance()} /></Panel>;
  if (step === "role-details") {
    const authority = titleAuthority(draft.roleTitle ?? "");
    return <Panel title="Role Details" intro={authority.viewer ? "Viewer access follows the scope approved for this Property." : "Confirm the authority and scope that apply to this Property."}>
      {authority.owner ? <Check label="I confirm I am the legitimate owner." checked={draft.data.ownershipAssertion === true} onPress={() => update({ data: { ownershipAssertion: draft.data.ownershipAssertion !== true } })} /> : authority.admin || authority.manager ? <Field label="Authorized scope or relationship details" value={str(draft.data.managementDetails)} onChange={(managementDetails) => update({ data: { managementDetails } })} /> : null}
      <Action label="SAVE & CONTINUE" onPress={() => advance()} />
    </Panel>;
  }
  if (step === "services") return <Panel title={draft.path === "supplier" ? "Products & Services" : "Services"} intro="Describe what this Business provides."><Field multiline label="Products and services" value={str(draft.data.services)} onChange={(services) => update({ data: { services } })} /><Action label="SAVE & CONTINUE" onPress={() => advance()} /></Panel>;
  if (step === "trade-profile") return <Panel title="Trade Profile" intro="Add the Trade or position and an optional descriptive title."><Field label="Trade / position" value={str(draft.data.tradePosition)} onChange={(tradePosition) => update({ data: { tradePosition } })} /><Field label="Descriptive title (optional)" value={str(draft.data.descriptiveTitle)} onChange={(descriptiveTitle) => update({ data: { descriptiveTitle } })} />{titleAuthority(draft.roleTitle ?? "").owner ? <Check label="I confirm I am the legitimate Business owner." checked={draft.data.ownershipAssertion === true} onPress={() => update({ data: { ownershipAssertion: draft.data.ownershipAssertion !== true } })} /> : null}<Action label="SAVE & CONTINUE" onPress={() => advance()} /></Panel>;
  if (step === "experience") return <Panel title="Experience" intro="Add the experience that applies to this role."><Field label="Years of experience" value={str(draft.data.yearsExperience)} onChange={(yearsExperience) => update({ data: { yearsExperience } })} /><Field multiline label="Relevant experience" value={str(draft.data.experience)} onChange={(experience) => update({ data: { experience } })} />{(titleAuthority(draft.roleTitle ?? "").manager || titleAuthority(draft.roleTitle ?? "").admin || titleAuthority(draft.roleTitle ?? "").owner || titleAuthority(draft.roleTitle ?? "").lead) ? <Field multiline label="Management experience (when applicable)" value={str(draft.data.managementExperience)} onChange={(managementExperience) => update({ data: { managementExperience } })} /> : null}<Field multiline label="Skills / strengths" value={str(draft.data.skills)} onChange={(skills) => update({ data: { skills } })} /><Action label="SAVE & CONTINUE" onPress={() => advance()} /></Panel>;
  if (step === "licenses") return <Panel title="Licenses & Certifications" intro="Add applicable credentials, or continue if none apply."><Field multiline label="Licenses and certifications" value={str(draft.data.licenses)} onChange={(licenses) => update({ data: { licenses } })} /><Action label="SAVE & CONTINUE" onPress={() => advance()} /></Panel>;
  if (step === "supplier-profile") return <Panel title="Supplier Profile" intro="Add the person-specific information for this Supplier Role."><Field label="Position / responsibility" value={str(draft.data.supplierPosition)} onChange={(supplierPosition) => update({ data: { supplierPosition } })} /><Field label="Service area" value={str(draft.data.serviceArea)} onChange={(serviceArea) => update({ data: { serviceArea } })} /><Field multiline label="Ordering details" value={str(draft.data.orderingDetails)} onChange={(orderingDetails) => update({ data: { orderingDetails } })} />{titleAuthority(draft.roleTitle ?? "").owner ? <Check label="I confirm I am the legitimate Business owner." checked={draft.data.ownershipAssertion === true} onPress={() => update({ data: { ownershipAssertion: draft.data.ownershipAssertion !== true } })} /> : null}<Action label="SAVE & CONTINUE" onPress={() => advance()} /></Panel>;
  if (step === "review") {
    const labels: Record<string, string> = { "choose-path": "Path", "property-type": "Property Type", find: draft.path === "property" ? "Property" : "Business", role: "Role", profile: draft.path === "property" ? "Property Profile" : "Business Profile", "role-details": "Role Details", services: draft.path === "supplier" ? "Products & Services" : "Services", "trade-profile": "Trade Profile", experience: "Experience", licenses: "Licenses & Certifications", "supplier-profile": "Supplier Profile" };
    return <Panel title="Review" intro="Nothing becomes active until you press ACTIVATE and authorization succeeds.">
      {approvedSteps(draft).filter((s) => s !== "review" && s !== "complete").map((section) => <ReviewRow key={section} label={labels[section]} value={section === "role" ? draft.roleTitle ?? "" : section === "choose-path" ? draft.path ?? "" : section === "property-type" ? draft.propertyType ?? "" : section === "find" || section === "profile" ? [draft.data.propertyName || draft.data.businessName, draft.data.address].filter(Boolean).join(" · ") : summary(draft.data)} edit={() => p.persist({ ...draft, currentStep: section, returnToReview: true })} />)}
      <AccessStatus draft={draft} addPro={p.addPro} />
      <Action label="ACTIVATE" onPress={p.activate} />
    </Panel>;
  }
  return <Panel title="Complete" intro="Your relationship is active and your private History is ready."><Action label="ENTER COMMAND CENTER" onPress={p.enter} /></Panel>;
}

function AccessStatus({ draft, addPro }: { draft: ApprovedIntakeDraft; addPro: () => void }) {
  const [status, setStatus] = useState<{ personalPaid: boolean; sharedAccessEligible: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const colors = useColors();
  useEffect(() => {
    let live = true;
    customFetch<{ personalPaid: boolean; sharedAccessEligible: boolean }>(`/api/intake/access-status?entityId=${draft.existingEntityId ?? ""}`)
      .then((value) => { if (live) setStatus(value); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [draft.existingEntityId]);
  const needsPaid = titleNeedsPersonalPaid(draft.roleTitle ?? "");
  const eligible = status && (!needsPaid || status.personalPaid) && (draft.creating || status.sharedAccessEligible);
  return <View style={styles.notice}><Text style={{ color: colors.foreground }}>Subscription / access status</Text>
    <Text style={{ color: colors.mutedForeground }}>{failed ? "Access status could not be loaded. ACTIVATE will recheck it." : !status ? "Checking access…" : eligible ? "Eligible. Activation still requires the correct authorization." : "Paid access is required before this relationship can activate."}</Text>
    {status && !eligible ? <Action label="ADD PRO" onPress={addPro} /> : null}
  </View>;
}

function IntakePhoto({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const colors = useColors();
  async function pick() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const picker = await import("expo-image-picker");
      if (Platform.OS !== "web" && !(await picker.requestMediaLibraryPermissionsAsync()).granted) throw new Error("Allow photo access to select a photo.");
      const result = await picker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.85 });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const uploaded = await uploadAsset({ uri: asset.uri, name: asset.fileName ?? "intake-photo.jpg", contentType: asset.mimeType ?? "image/jpeg", size: asset.fileSize });
      onChange(uploaded.path);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(false); }
  }
  const uri = resolveStorageUrl(value);
  return <View style={styles.field}>{uri ? <Image source={{ uri }} accessibilityLabel="Property photo or Business logo" style={{ height: 160, borderRadius: 12 }} /> : null}
    <Action label={busy ? "UPLOADING PHOTO…" : value ? "CHANGE PHOTO" : "ADD PHOTO / LOGO"} onPress={pick} />
    {error ? <Text style={{ color: colors.destructive }}>{error}</Text> : null}
  </View>;
}

function Panel({ title, intro, children }: React.PropsWithChildren<{ title: string; intro: string }>) { const c = useColors(); return <View style={styles.panel}><Text accessibilityRole="header" style={[styles.title, { color: c.foreground }]}>{title}</Text><Text style={[styles.intro, { color: c.mutedForeground }]}>{intro}</Text>{children}</View>; }
function Choice({ label, detail, selected, onPress }: { label: string; detail?: string; selected?: boolean; onPress: () => void }) { const c = useColors(); return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.choice, { backgroundColor: c.card, borderColor: selected ? c.primary : c.border }]}><View><Text style={[styles.choiceLabel, { color: c.foreground }]}>{label}</Text>{detail ? <Text style={{ color: c.mutedForeground }}>{detail}</Text> : null}</View><Text style={{ color: c.primary }}>›</Text></Pressable>; }
function Field({ label, value, onChange, multiline }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean }) { const c = useColors(); return <View style={styles.field}><Text style={{ color: c.foreground }}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline} style={[styles.input, multiline && styles.multiline, { color: c.foreground, borderColor: c.border, backgroundColor: c.card }]} /></View>; }
function Check({ label, checked, onPress }: { label: string; checked: boolean; onPress: () => void }) { const c = useColors(); return <Pressable onPress={onPress} style={styles.check}><Text style={{ color: c.primary, fontSize: 20 }}>{checked ? "☑" : "☐"}</Text><Text style={{ color: c.foreground }}>{label}</Text></Pressable>; }
function Action({ label, onPress }: { label: string; onPress: () => void }) { const c = useColors(); return <Pressable accessibilityRole="button" onPress={onPress} style={[styles.action, { backgroundColor: c.primary }]}><Text style={styles.actionText}>{label}</Text></Pressable>; }
function ReviewRow({ label, value, edit }: { label: string; value: string; edit: () => void }) { const c = useColors(); return <View style={[styles.review, { borderColor: c.border }]}><View style={{ flex: 1 }}><Text style={{ color: c.mutedForeground }}>{label}</Text><Text style={{ color: c.foreground }}>{value}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label}`} onPress={edit}><Text style={{ color: c.primary }}>Edit</Text></Pressable></View>; }
function str(value: unknown) { return typeof value === "string" ? value : ""; }
function summary(data: Record<string, unknown>) { return [data.services, data.specialties, data.serviceArea, data.experience, data.licenses, data.orderingDetails].filter(Boolean).join(" · ") || "Saved"; }
function messageOf(cause: unknown) { return cause instanceof Error ? cause.message : "Unable to save intake. Your draft is still on this screen."; }

const styles = StyleSheet.create({ root: { flex: 1 }, center: { flex: 1, alignItems: "center", justifyContent: "center" }, scroll: { paddingHorizontal: 20, gap: 12 }, back: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", paddingRight: 24 }, panel: { gap: 12 }, title: { fontSize: 28, fontFamily: "Inter_700Bold" }, intro: { fontSize: 15, lineHeight: 22, marginBottom: 4 }, choice: { minHeight: 64, padding: 16, borderWidth: 1, borderRadius: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, choiceLabel: { fontSize: 17, fontFamily: "Inter_600SemiBold" }, field: { gap: 6 }, input: { borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 48 }, multiline: { minHeight: 96, textAlignVertical: "top" }, check: { flexDirection: "row", gap: 10, alignItems: "center", paddingVertical: 12 }, action: { minHeight: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 4 }, actionText: { color: "white", fontFamily: "Inter_700Bold" }, review: { borderWidth: 1, borderRadius: 12, padding: 14, flexDirection: "row", gap: 12, alignItems: "center" }, notice: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 } });
