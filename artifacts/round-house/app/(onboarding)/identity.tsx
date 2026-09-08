import React, { useEffect, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColorScheme } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import { displayName, loadEntryProfile, profileReady, saveEntryProfile, type EntryProfile } from "@/lib/entry-profile";

const logoLockup = require("@/assets/images/logo-lockup.png");
const empty: EntryProfile = { firstName: "", nickname: "", lastName: "", phone: "", photoUri: "" };

export default function IdentityScreen() {
  const colors = useColors(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { userId } = useAuth(); const isDark = useColorScheme() === "dark";
  const [profile, setProfile] = useState<EntryProfile>(empty); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const set = (field: keyof EntryProfile) => (value: string) => setProfile((p) => ({ ...p, [field]: value }));

  useEffect(() => { if (userId) void loadEntryProfile(userId).then(setProfile); }, [userId]);

  const pickPhoto = async () => {
    setError("");
    if (Platform.OS !== "web") {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { setError("Photo permission is required."); return; }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (!result.canceled && result.assets?.[0]?.uri) set("photoUri")(result.assets[0].uri);
  };

  const submit = async () => {
    if (!userId) { setError("Your account session is not ready yet."); return; }
    if (!profileReady(profile)) { setError("Add your photo, first name, and last name to continue."); return; }
    setSaving(true); setError("");
    try { await saveEntryProfile(userId, profile); router.replace("/(onboarding)/entry"); }
    catch { setError("Couldn't save your profile. Please try again."); }
    finally { setSaving(false); }
  };

  return <View style={[styles.root, { backgroundColor: colors.background }]}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}><ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
    <Image source={logoLockup} resizeMode="contain" style={[styles.lockup, { tintColor: isDark ? "#F2EDE8" : "#2A1F1A" }]} />
    <Text style={[styles.title, { color: colors.foreground }]}>Your profile</Text><Text style={[styles.intro, { color: colors.mutedForeground }]}>Tell Roundhouse who you are.</Text>
    <View style={styles.photoBlock}><Pressable onPress={pickPhoto} style={[styles.photo, { backgroundColor: colors.card, borderColor: colors.border }]}>{profile.photoUri ? <Image source={{ uri: profile.photoUri }} style={styles.photoImage} /> : <Feather name="camera" size={28} color={colors.mutedForeground} />}</Pressable><Pressable onPress={pickPhoto}><Text style={[styles.photoCta, { color: colors.primary }]}>{profile.photoUri ? "Change photo" : "Add a photo"}</Text></Pressable></View>
    <Field label="First name" value={profile.firstName} onChange={set("firstName")} placeholder="First name" colors={colors} />
    <Field label="Nickname (optional)" value={profile.nickname} onChange={set("nickname")} placeholder="What people call you" colors={colors} />
    <Text style={[styles.helper, { color: colors.mutedForeground }]}>A nickname replaces your first name when Roundhouse displays your name.</Text>
    <Field label="Last name" value={profile.lastName} onChange={set("lastName")} placeholder="Last name" colors={colors} />
    <Field label="Phone number (optional)" value={profile.phone} onChange={set("phone")} placeholder="Phone number" colors={colors} phone />
    {displayName(profile) ? <Text style={[styles.helper, { color: colors.mutedForeground }]}>People will see you as <Text style={{ color: colors.foreground }}>{displayName(profile)}</Text>.</Text> : null}
    {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
    <Pressable onPress={submit} disabled={saving} style={[styles.btn, { backgroundColor: colors.primary }, saving && { opacity: 0.6 }]}><Text style={[styles.btnText, { color: colors.primaryForeground }]}>{saving ? "Saving..." : "Continue"}</Text></Pressable>
  </ScrollView></KeyboardAvoidingView></View>;
}

function Field({ label, value, onChange, placeholder, colors, phone = false }: any) { return <><Text style={[styles.label, { color: colors.foreground }]}>{label}</Text><TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={colors.mutedForeground} autoCapitalize={phone ? "none" : "words"} keyboardType={phone ? "phone-pad" : "default"} style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} /></>; }

const styles = StyleSheet.create({ root: { flex: 1 }, scroll: { paddingHorizontal: 24, gap: 10 }, lockup: { width: 140, height: 140, alignSelf: "center", marginBottom: 8 }, title: { fontSize: 26, fontFamily: "Inter_700Bold" }, intro: { fontSize: 14, lineHeight: 20, marginBottom: 8 }, photoBlock: { alignItems: "center", gap: 10, marginVertical: 12 }, photo: { width: 120, height: 120, borderRadius: 60, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" }, photoImage: { width: "100%", height: "100%" }, photoCta: { fontSize: 14, fontFamily: "Inter_600SemiBold" }, label: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 8 }, input: { height: 50, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, fontSize: 16 }, helper: { fontSize: 12, lineHeight: 17 }, error: { fontSize: 13 }, btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 16 }, btnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" } });
