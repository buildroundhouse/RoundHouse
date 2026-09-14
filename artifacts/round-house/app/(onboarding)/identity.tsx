import React, { useEffect, useRef, useState } from "react";
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColorScheme } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import { useProfile } from "@/lib/profile";
import { resolveStorageUrl } from "@/lib/uploads";
import { displayName, loadEntryProfile, profileReady, saveEntryProfile, type EntryProfile } from "@/lib/entry-profile";

const logoLockup = require("@/assets/images/logo-lockup.png");
const empty: EntryProfile = { firstName: "", nickname: "", lastName: "", phone: "", photoUri: "" };

export default function IdentityScreen() {
  const colors = useColors(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { userId } = useAuth(); const isDark = useColorScheme() === "dark";
  const { profile: savedProfile, activeMode, refetchProfile } = useProfile();
  const initialized = useRef<string | null>(null);
  const [profile, setProfile] = useState<EntryProfile>(empty); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const set = (field: keyof EntryProfile) => (value: string) => setProfile((p) => ({ ...p, [field]: value }));

  useEffect(() => {
    if (!userId || !savedProfile || initialized.current === userId) return;
    let cancelled = false;
    void loadEntryProfile(userId).then((draft) => {
      if (cancelled) return;
      initialized.current = userId;
      const names = savedProfile.name.trim().split(/\s+/);
      setProfile({ ...draft,
        firstName: draft.firstName || names[0] || "",
        lastName: draft.lastName || names.slice(1).join(" "),
        phone: draft.phone || savedProfile.phone || "",
        photoUri: draft.photoUri || savedProfile.avatarUrl || "",
      });
    });
    return () => { cancelled = true; };
  }, [userId, savedProfile]);

  const thumbnail = async (uri: string) => {
    if (uri === savedProfile?.avatarUrl || uri.startsWith("/objects/") || uri.startsWith("data:image/jpeg;base64,") && uri.length <= 65000) return uri;
    const image = await manipulateAsync(uri, [{ resize: { width: 160, height: 160 } }], { compress: 0.65, format: SaveFormat.JPEG, base64: true });
    if (!image.base64 || image.base64.length > 64000) throw new Error("Please choose a smaller profile photo.");
    return `data:image/jpeg;base64,${image.base64}`;
  };

  const pickPhoto = async () => {
    setError("");
    if (Platform.OS !== "web") {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) { setError("Photo permission is required."); return; }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (!result.canceled && result.assets?.[0]?.uri) {
      try { set("photoUri")(await thumbnail(result.assets[0].uri)); }
      catch { setError("Couldn't read that photo. Please choose it again."); }
    }
  };

  const submit = async () => {
    if (!userId) { setError("Your account session is not ready yet."); return; }
    if (!profileReady(profile)) { setError("Add your photo, first name, and last name to continue."); return; }
    setSaving(true); setError("");
    try {
      const photoUri = await thumbnail(profile.photoUri);
      await saveEntryProfile(userId, { ...profile, photoUri });
      await refetchProfile();
      if (activeMode && activeMode.kind !== "collab") {
        if (activeMode.intakeCompletedAt) router.replace("/(tabs)");
        else router.replace({ pathname: "/(onboarding)/intake", params: { modeId: String(activeMode.id), kind: activeMode.kind } });
      } else router.replace("/(onboarding)/entry");
    }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't save your profile. Please try again."); }
    finally { setSaving(false); }
  };

  return <View style={[styles.root, { backgroundColor: colors.background }]}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}><ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
    <Image source={logoLockup} resizeMode="contain" style={[styles.lockup, { tintColor: isDark ? "#F2EDE8" : "#2A1F1A" }]} />
    <Text style={[styles.title, { color: colors.foreground }]}>Your profile</Text><Text style={[styles.intro, { color: colors.mutedForeground }]}>Tell Roundhouse who you are.</Text>
    <View style={styles.photoBlock}><Pressable onPress={pickPhoto} style={[styles.photo, { backgroundColor: colors.card, borderColor: colors.border }]}>{profile.photoUri ? <Image source={{ uri: resolveStorageUrl(profile.photoUri) ?? profile.photoUri }} style={styles.photoImage} /> : <Feather name="camera" size={28} color={colors.mutedForeground} />}</Pressable><Pressable onPress={pickPhoto}><Text style={[styles.photoCta, { color: colors.primary }]}>{profile.photoUri ? "Change photo" : "Add a photo"}</Text></Pressable></View>
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
