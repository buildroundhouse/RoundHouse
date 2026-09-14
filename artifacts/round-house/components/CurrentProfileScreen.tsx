import React, { useState } from "react";
import { ActivityIndicator, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { customFetch, useCompleteModeIntake, useUpdateMe } from "@workspace/api-client-react";
import { useProfile } from "@/lib/profile";
import { useColors } from "@/hooks/useColors";
import { resolveStorageUrl, uploadAsset } from "@/lib/uploads";
import { ProfileNavigation } from "./ProfileNavigation";
import { ProfilePreview } from "./ProfilePreview";
import { PERSONAL_FIELDS, personalDetailsFromIntake, profileContext, modeForAccount, type ProfileEntity, type PersonalDetails } from "@/lib/personal-profile";

export type { ProfileEntity } from "@/lib/personal-profile";

export function ProfileRow({ title, subtitle, onPress, icon = "chevron-right" }: { title: string; subtitle?: string; onPress: () => void; icon?: keyof typeof Feather.glyphMap }) {
  const c = useColors();
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}
    style={({ pressed }) => [s.row, { backgroundColor: c.card, borderColor: c.border, opacity: pressed ? 0.7 : 1 }]}>
    <View style={{ flex: 1 }}><Text style={[s.label, { color: c.foreground }]}>{title}</Text>
      {subtitle ? <Text style={[s.secondary, { color: c.mutedForeground }]}>{subtitle}</Text> : null}</View>
    <Feather name={icon} size={20} color={c.primary} />
  </Pressable>;
}

export function ProfileSubpage({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const c = useColors(); const insets = useSafeAreaInsets();
  return <Modal visible animationType="slide" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View style={[s.navigation, { paddingTop: insets.top + 10, borderColor: c.border }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Profile" onPress={onClose} style={s.back}>
          <Feather name="arrow-left" size={24} color={c.foreground}/><Text style={{ color: c.foreground }}>Profile</Text>
        </Pressable><Text style={[s.label, { color: c.foreground, flexShrink: 1 }]}>{title}</Text>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 18, paddingBottom: insets.bottom + 40 }}>{children}</ScrollView>
    </View>
  </Modal>;
}

export function CurrentProfileScreen({ onSettings }: { onSettings: () => void }) {
  const c = useColors(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { profile, activeMode: selectedMode, modes, activeOutwardAccount, refetchProfile, refetchModes } = useProfile();
  const queryClient = useQueryClient();
  const activeMode = modeForAccount(activeOutwardAccount, modes, selectedMode);
  const accountId = activeOutwardAccount?.id;
  const entities = useQuery({ queryKey: ["/api/entities/mine", accountId], enabled: !!accountId,
    queryFn: () => customFetch<{ entities: ProfileEntity[] }>("/api/entities/mine") });
  const [page, setPage] = useState<"preview" | "permissions" | "account" | "discover" | null>(null);
  const [editing, setEditing] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState("");
  const updateMode = useCompleteModeIntake(); const updateMe = useUpdateMe();
  const md = (activeMode?.intakeData ?? {}) as Record<string, unknown>;
  const details = personalDetailsFromIntake(md);
  const { role, entity, entityName, memberships: matching } = profileContext(activeOutwardAccount?.kind ?? activeMode?.kind, md, entities.data?.entities ?? []);
  const title = typeof md.roleTitle === "string" ? md.roleTitle.trim() : "";
  const avatar = resolveStorageUrl(profile?.avatarUrl);
  const banner = resolveStorageUrl(typeof md.profileBannerUrl === "string" ? md.profileBannerUrl : null);
  const logo = resolveStorageUrl(entity?.logoUrl);
  const refresh = async () => { await Promise.all([refetchModes(), refetchProfile(), queryClient.invalidateQueries({ queryKey: ["/api/users/me"] })]); };
  const invite = () => router.push({ pathname: "/invites", params: { from: "profile", focus: "share" } } as never);
  async function choosePhoto(kind: "avatar" | "banner") {
    setError("");
    try {
      if (Platform.OS !== "web") {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) { setError("Allow photo access to choose an image."); return; }
      }
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: kind === "avatar" ? [1, 1] : [3, 1], quality: 0.8 });
      if (result.canceled || !activeMode) return;
      setPhotoBusy(true);
      const asset = result.assets[0];
      const uploaded = await uploadAsset({ uri: asset.uri, name: asset.fileName ?? "profile.jpg", contentType: asset.mimeType ?? "image/jpeg" });
      if (kind === "avatar") await updateMe.mutateAsync({ data: { avatarUrl: uploaded.path } });
      else await updateMode.mutateAsync({ modeId: activeMode.id, data: { intakeData: { profileBannerUrl: uploaded.path } } });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save photo. Please try again."); }
    finally { setPhotoBusy(false); }
  }
  return <View style={{ flex: 1, backgroundColor: c.background }}>
    <ProfileNavigation/>
    <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 130 }}>
      <Pressable disabled={photoBusy} onPress={() => void choosePhoto("banner")} accessibilityRole="button" accessibilityLabel="Edit personal profile banner"
        style={[s.banner, { backgroundColor: c.muted }]}>
        {banner ? <Image source={{ uri: banner }} style={StyleSheet.absoluteFillObject} resizeMode="cover"/> : <Feather name="image" size={38} color={c.mutedForeground}/>}
        <View style={s.bannerEdit}><Feather name="camera" size={16} color="#fff"/><Text style={{ color: "#fff" }}>Edit banner</Text></View>
      </Pressable>
      <View style={s.identity}>
        <Pressable disabled={photoBusy} onPress={() => void choosePhoto("avatar")} accessibilityRole="button" accessibilityLabel="Edit profile photo"
          style={[s.avatar, { backgroundColor: c.card, borderColor: c.background }]}>
          {avatar ? <Image source={{ uri: avatar }} style={{ width: "100%", height: "100%" }}/> : <Feather name="user" size={40} color={c.mutedForeground}/>}
        </Pressable>
        <View style={[s.logo, { backgroundColor: c.muted }]}>{logo ? <Image source={{ uri: logo }} style={{ width: 32, height: 32 }} resizeMode="contain"/> : <Feather name={entity?.kind === "business" ? "briefcase" : "home"} size={22} color={c.mutedForeground}/>}</View>
        <View style={{ flex: 1, gap: 4, paddingTop: 28 }}><Text style={[s.name, { color: c.foreground }]}>{profile?.name || "Your profile"}</Text>
          <Text style={{ color: c.foreground }}>{role}</Text>{title && title !== role ? <Text style={{ color: c.mutedForeground }}>{title}</Text> : null}<Text style={[s.secondary, { color: c.mutedForeground }]}>{entities.isLoading ? "Loading Entity…" : entityName}</Text>
        </View>
      </View>
      <View style={s.body}>
        {photoBusy ? <ActivityIndicator color={c.primary}/> : null}
        {error ? <Text accessibilityRole="alert" style={{ color: c.destructive }}>{error}</Text> : null}
        <View style={s.actions}><View style={{ flex: 1 }}><ProfileRow title="View Profile" onPress={() => setPage("preview")} icon="eye"/></View>
          <View style={{ flex: 1 }}><ProfileRow title="Share Roundhouse" onPress={invite} icon="share-2"/></View></View>
        <ProfileRow title="Invite / Share Roundhouse" onPress={invite} icon="user-plus"/>
        <Text style={[s.heading, { color: c.foreground }]}>Find</Text>
        {([ ["trade", "Find a Trade Professional"], ["home", "Residential Home Search"], ["facility", "Commercial Facility Search"] ] as const).map(([kind, title]) =>
          <ProfileRow key={kind} title={title} icon="search" onPress={() => router.push({ pathname: "/profile-find", params: { kind } } as never)}/>)}
        <Pressable accessibilityRole="button" accessibilityLabel="Discover" onPress={() => setPage("discover")} style={[s.discover, { backgroundColor: c.primary }]}>
          <Feather name="compass" size={30} color="#fff"/><Text style={[s.name, { color: "#fff" }]}>Discover</Text>
          <Text style={{ color: "#fff", lineHeight: 22 }}>Find pros and success stories in your area.</Text><Text style={{ color: "#fff" }}>Q&A · Message Board</Text>
          <Text style={{ color: "#fff", fontWeight: "700" }}>Coming Soon</Text>
        </Pressable>
        <View style={s.sectionHeading}><Text style={[s.heading, { color: c.foreground }]}>Personal information</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Edit personal information" onPress={() => setEditing(true)} style={s.back}><Text style={{ color: c.primary }}>Edit</Text></Pressable></View>
        {PERSONAL_FIELDS.map(({ key, label }) => <View key={key} style={[s.field, { borderColor: c.border }]}>
          <View style={{ flex: 1, gap: 6 }}><Text style={[s.label, { color: c.foreground }]}>{label}</Text>
            <Text style={{ color: c.mutedForeground, lineHeight: 21 }}>{details[key]?.value || "Add your information"}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${label} and visibility`} onPress={() => setEditing(true)} style={s.visibility}>
            <Feather name={details[key]?.public ? "eye" : "lock"} size={14} color={c.mutedForeground}/><Text style={{ color: c.mutedForeground, fontSize: 12 }}>{details[key]?.public ? "Public" : "Private"}</Text>
          </Pressable></View>)}
        <ProfileRow title="Authority & Permissions" onPress={() => setPage("permissions")} icon="shield"/>
        <ProfileRow title="Subscription & Account" onPress={() => setPage("account")} icon="credit-card"/>
        <ProfileRow title="Other Settings" onPress={onSettings} icon="settings"/>
        <Text style={[s.footer, { color: c.mutedForeground }]}>Roundhouse</Text>
      </View>
    </ScrollView>
    {editing && activeMode ? <PersonalEditor key={activeMode.id} details={details} name={profile?.name ?? ""} onClose={() => setEditing(false)} onSave={async (name, next) => {
      await updateMode.mutateAsync({ modeId: activeMode.id, data: { intakeData: { personalProfile: next } } });
      if (name !== profile?.name) await updateMe.mutateAsync({ data: { name } });
      await refresh(); setEditing(false);
    }}/> : null}
    {page === "preview" ? <ProfilePreview visible onClose={() => setPage(null)}/> : null}
    {page && page !== "preview" ? <ProfileSubpage title={page === "permissions" ? "Authority & Permissions" : page === "account" ? "Subscription & Account" : "Discover"} onClose={() => setPage(null)}>
      {page === "permissions" ? <>
        <Text style={{ color: c.mutedForeground }}>Your role describes your participation. Authority and permissions come from your approved membership in each Entity.</Text>
        {entities.isLoading ? <ActivityIndicator/> : entities.isError ? <ProfileRow title="Could not load permissions. Retry" onPress={() => void entities.refetch()}/> : matching.length === 0 ? <Text style={{ color: c.foreground }}>No approved Entity membership in this context.</Text> : matching.map(e => <View key={e.id} style={[s.row, { borderColor: c.border, flexDirection: "column", alignItems: "stretch" }]}>
          <Text style={[s.label, { color: c.foreground }]}>{e.displayName}</Text>
          <Text style={{ color: c.foreground }}>Membership: {e.myMembership?.role === "collaborator" ? "Viewer" : e.myMembership?.role} · {e.myMembership?.status}</Text>
          {Object.entries(e.myMembership?.permissions ?? {}).filter(([,v]) => typeof v === "boolean").map(([key, value]) => <Text key={key} style={{ color: c.mutedForeground }}>{({ seeContacts: "View contacts", seeBilling: "View billing", createOnProperties: "Create Property records", manageTeam: "Manage participants" } as Record<string,string>)[key] ?? key.replace(/([A-Z])/g, " $1")}: {value ? "Allowed" : "Not granted"}</Text>)}
        </View>)}
        <Text style={{ color: c.mutedForeground }}>Participant permission changes are not yet available on this page.</Text>
      </> : null}
      {page === "account" ? <>
        <ProfileRow title="Subscription & billing" subtitle="View status, payment methods, or cancel paid capabilities" onPress={() => { setPage(null); router.push("/account/billing" as never); }}/>
        <ProfileRow title="Personal account details" subtitle="Name, login and profile photo" onPress={() => { setPage(null); router.push("/account/personal" as never); }}/>
        <Text style={{ color: c.mutedForeground }}>Canceling a subscription and canceling your Roundhouse account are separate actions. Legitimate records you contributed to Properties, Businesses and work history remain preserved.</Text>
        <ProfileRow title="Cancel Account" subtitle="Request cancellation through support" icon="mail" onPress={() => void Linking.openURL("mailto:support@roundhouse.app?subject=Roundhouse%20account%20cancellation%20request").catch(() => setError("Could not open email. Contact support@roundhouse.app."))}/>
      </> : null}
      {page === "discover" ? <>
        <Text style={[s.name, { color: c.foreground }]}>Coming Soon</Text><Text style={{ color: c.foreground }}>Find pros and success stories in your area.</Text>
        {["Public Project & Success Stories", "Ask a Pro · Q&A", "Community Message Board", "Best Answers & Professional Reputation", "Roundhouse Spotlight"].map(t => <Text key={t} style={{ color: c.mutedForeground, fontSize: 18 }}>{t}</Text>)}
      </> : null}
    </ProfileSubpage> : null}
  </View>;
}

function PersonalEditor({ details, name: initialName, onSave, onClose }: { details: PersonalDetails; name: string; onSave: (name: string, details: PersonalDetails) => Promise<void>; onClose: () => void }) {
  const c = useColors(); const [name, setName] = useState(initialName); const [draft, setDraft] = useState(details); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const save = async () => {
    if (!name.trim()) { setError("Please enter your name."); return; }
    if (draft.email?.value && !/^\S+@\S+\.\S+$/.test(draft.email.value.trim())) { setError("Please enter a valid contact email."); return; }
    setBusy(true); setError("");
    try { await onSave(name.trim(), draft); } catch(e) { setError(e instanceof Error ? e.message : "Could not save. Please try again."); } finally { setBusy(false); }
  };
  return <ProfileSubpage title="Personal information" onClose={() => { if (!busy) onClose(); }}>
    <Text style={{ color: c.mutedForeground }}>Describe yourself in this role. Choose Public to include a field on your outward-facing Profile.</Text>
    <Text style={[s.label, { color: c.foreground }]}>Name</Text><TextInput accessibilityLabel="Name" value={name} onChangeText={setName} maxLength={80} style={[s.input, { color: c.foreground, borderColor: c.border }]}/>
    {PERSONAL_FIELDS.map(f => <View key={f.key} style={{ gap: 10 }}>
      <View style={s.sectionHeading}><Text style={[s.label, { color: c.foreground, flex: 1 }]}>{f.label}</Text>
        <Text style={{ color: c.mutedForeground }}>{draft[f.key]?.public ? "Public" : "Private"}</Text>
        <Switch accessibilityLabel={`Make ${f.label} public`} value={draft[f.key]?.public === true} disabled={busy} onValueChange={value => setDraft(d => ({ ...d, [f.key]: { value: d[f.key]?.value ?? "", public: value } }))}/>
      </View>
      <TextInput accessibilityLabel={f.label} editable={!busy} value={draft[f.key]?.value ?? ""} maxLength={2000} multiline={"multiline" in f && f.multiline}
        autoCapitalize={f.key === "email" || f.key === "website" ? "none" : "sentences"}
        onChangeText={value => setDraft(d => ({ ...d, [f.key]: { value, public: d[f.key]?.public === true } }))}
        style={[s.input, { color: c.foreground, borderColor: c.border, minHeight: "multiline" in f ? 85 : 48 }]}/>
    </View>)}
    {error ? <Text accessibilityRole="alert" style={{ color: c.destructive }}>{error}</Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Save personal information" disabled={busy} onPress={() => void save()} style={[s.row, { backgroundColor: c.primary, justifyContent: "center" }]}>
      <Text style={{ color: "#fff", fontWeight: "700" }}>{busy ? "Saving…" : "Save personal information"}</Text>
    </Pressable>
  </ProfileSubpage>;
}
const s = StyleSheet.create({
  navigation: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 8, borderBottomWidth: 1, gap: 8 },
  back: { flexShrink: 1, minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 }, backText: { fontSize: 14, fontWeight: "600", flexShrink: 1 },
  banner: { width: "100%", height: 180, alignItems: "center", justifyContent: "center" }, bannerEdit: { position: "absolute", right: 16, bottom: 16, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#0009", padding: 10, borderRadius: 20 },
  identity: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, paddingBottom: 12, marginTop: -24 },
  avatar: { width: 90, height: 90, borderRadius: 45, borderWidth: 4, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  logo: { width: 36, height: 36, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 20 }, name: { fontSize: 23, fontWeight: "700" },
  body: { paddingHorizontal: 20, gap: 12 }, actions: { flexDirection: "row", gap: 10 }, label: { fontSize: 15, fontWeight: "600" }, secondary: { fontSize: 13, lineHeight: 19, marginTop: 3 },
  row: { borderWidth: 1, borderRadius: 12, padding: 15, minHeight: 54, flexDirection: "row", alignItems: "center", gap: 10 },
  heading: { fontSize: 20, fontWeight: "700", marginTop: 10 }, discover: { padding: 22, borderRadius: 16, gap: 12, marginVertical: 10 },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }, field: { flexDirection: "row", gap: 16, paddingVertical: 16, borderBottomWidth: 1 }, visibility: { flexDirection: "row", gap: 5, alignItems: "center", minHeight: 44 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 16, textAlignVertical: "top" }, footer: { textAlign: "center", paddingVertical: 30 },
});
