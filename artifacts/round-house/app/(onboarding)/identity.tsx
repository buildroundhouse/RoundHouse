import React, { useEffect, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useColorScheme } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import {
  displayNameForEntryProfile,
  isEntryPersonalProfileComplete,
  readEntryPersonalProfile,
  saveEntryPersonalProfile,
} from "@/lib/entry-profile";

const logoLockup = require("@/assets/images/logo-lockup.png");

export default function IdentityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { userId } = useAuth();
  const isDark = useColorScheme() === "dark";

  const [firstName, setFirstName] = useState("");
  const [nickname, setNickname] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [photoUri, setPhotoUri] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void readEntryPersonalProfile(userId).then((profile) => {
      if (cancelled) return;
      setFirstName(profile.firstName);
      setNickname(profile.nickname);
      setLastName(profile.lastName);
      setPhone(profile.phone);
      setPhotoUri(profile.photoUri);
    });
    return () => { cancelled = true; };
  }, [userId]);

  const pickPhoto = async () => {
    setError("");
    if (Platform.OS !== "web") {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError("Photo permission is required.");
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const draft = { firstName, nickname, lastName, phone, photoUri, completedAt: null };
  const ready = isEntryPersonalProfileComplete(draft);
  const displayName = displayNameForEntryProfile(draft);

  const submit = async () => {
    if (!userId) {
      setError("Your account session is not ready yet.");
      return;
    }
    if (!ready) {
      setError("Add your photo, first name, and last name to continue.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveEntryPersonalProfile(userId, { firstName, nickname, lastName, phone, photoUri });
      router.replace("/(onboarding)/entry");
    } catch {
      setError("Couldn't save your profile on this device. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Image source={logoLockup} resizeMode="contain" style={[styles.lockup, { tintColor: isDark ? "#F2EDE8" : "#2A1F1A" }]} />
          <Text style={[styles.title, { color: colors.foreground }]}>Your profile</Text>
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>
            This is you — not a business, property, role, or avatar.
          </Text>

          <View style={styles.photoBlock}>
            <Pressable onPress={pickPhoto} style={[styles.avatar, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {photoUri ? <Image source={{ uri: photoUri }} style={styles.avatarImage} /> : <Feather name="camera" size={28} color={colors.mutedForeground} />}
            </Pressable>
            <Pressable onPress={pickPhoto}>
              <Text style={[styles.photoCta, { color: colors.primary }]}>{photoUri ? "Change photo" : "Add a photo"}</Text>
            </Pressable>
          </View>

          <Text style={[styles.label, { color: colors.foreground }]}>First name</Text>
          <TextInput value={firstName} onChangeText={setFirstName} placeholder="First name" placeholderTextColor={colors.mutedForeground} autoCapitalize="words" autoComplete="given-name" textContentType="givenName" style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} />

          <Text style={[styles.label, { color: colors.foreground }]}>Nickname <Text style={{ color: colors.mutedForeground }}>(optional)</Text></Text>
          <TextInput value={nickname} onChangeText={setNickname} placeholder="What people call you" placeholderTextColor={colors.mutedForeground} autoCapitalize="words" style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} />
          <Text style={[styles.helper, { color: colors.mutedForeground }]}>If you add a nickname, Roundhouse will show it instead of your first name.</Text>

          <Text style={[styles.label, { color: colors.foreground }]}>Last name</Text>
          <TextInput value={lastName} onChangeText={setLastName} placeholder="Last name" placeholderTextColor={colors.mutedForeground} autoCapitalize="words" autoComplete="family-name" textContentType="familyName" style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} />

          <Text style={[styles.label, { color: colors.foreground }]}>Phone number <Text style={{ color: colors.mutedForeground }}>(optional)</Text></Text>
          <TextInput value={phone} onChangeText={setPhone} placeholder="Phone number" placeholderTextColor={colors.mutedForeground} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} />

          {displayName ? <Text style={[styles.preview, { color: colors.mutedForeground }]}>People will see you as <Text style={{ color: colors.foreground }}>{displayName}</Text>.</Text> : null}
          {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}

          <Pressable onPress={submit} disabled={saving} style={[styles.btn, { backgroundColor: colors.primary }, saving && { opacity: 0.6 }]}>
            <Text style={[styles.btnText, { color: colors.primaryForeground }]}>{saving ? "Saving..." : "Continue"}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 24, gap: 10 },
  lockup: { width: 140, height: 140, alignSelf: "center", marginBottom: 8 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  intro: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 8 },
  photoBlock: { alignItems: "center", gap: 10, marginVertical: 12 },
  avatar: { width: 120, height: 120, borderRadius: 60, borderWidth: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImage: { width: "100%", height: "100%" },
  photoCta: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 8 },
  input: { height: 50, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, fontSize: 16, fontFamily: "Inter_400Regular" },
  helper: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  preview: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 8 },
  error: { fontSize: 13, fontFamily: "Inter_400Regular", marginTop: 4 },
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 16 },
  btnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
