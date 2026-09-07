import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { useColors } from "@/hooks/useColors";
import {
  checkUsernameAvailable,
  useUpdateMyIdentity,
} from "@workspace/api-client-react";
import { uploadAsset, resolveStorageUrl } from "@/lib/uploads";
import { useProfile } from "@/lib/profile";
import { useColorScheme } from "react-native";

const logoLockup = require("@/assets/images/logo-lockup.png");

export default function IdentityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, refetchProfile } = useProfile();
  const isDark = useColorScheme() === "dark";

  const [username, setUsername] = useState(profile?.username ?? "");
  const [avatarPath, setAvatarPath] = useState<string | null>(profile?.avatarUrl ?? null);
  const [pickedPreview, setPickedPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<{ ok: boolean; reason: string | null } | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [checking, setChecking] = useState(false);

  const updateIdentity = useUpdateMyIdentity();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setUsernameStatus(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = username.trim().toLowerCase();
    if (!trimmed) return;
    debounceRef.current = setTimeout(async () => {
      try {
        setChecking(true);
        const r = await checkUsernameAvailable({ u: trimmed });
        setUsernameStatus({ ok: r.available, reason: r.reason ?? null });
      } catch {
        setUsernameStatus(null);
      } finally {
        setChecking(false);
      }
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [username]);

  const pickPhoto = async () => {
    setSubmitError("");
    try {
      if (Platform.OS !== "web") {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setSubmitError("Photo permission is required.");
          return;
        }
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      setPickedPreview(asset.uri);
      setUploading(true);
      const uploaded = await uploadAsset({
        uri: asset.uri,
        name: asset.fileName ?? "avatar.jpg",
        contentType: asset.mimeType ?? "image/jpeg",
        size: asset.fileSize ?? null,
      });
      setAvatarPath(uploaded.path);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Couldn't upload photo.");
      setPickedPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const usernameValid = !!username.trim() && (usernameStatus === null || usernameStatus.ok);
  const photoValid = !!avatarPath && !uploading;
  const ready = usernameValid && photoValid && (usernameStatus?.ok ?? false);

  const submit = async () => {
    setSubmitError("");
    if (!ready) return;
    try {
      await updateIdentity.mutateAsync({
        data: { username: username.trim().toLowerCase(), avatarUrl: avatarPath! },
      });
      await refetchProfile();
      // #572: every user now has the permanent Collaborator / Friend
      // baseline mode auto-provisioned server-side, so identity →
      // straight into the app. The profile gate will route to the
      // mode picker only if backfill genuinely failed; otherwise the
      // user lands on collab and can add a working hat at their pace
      // from Profile → Add another hat.
      router.replace("/(tabs)");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Couldn't save your identity.";
      setSubmitError(msg);
    }
  };

  const previewUri = pickedPreview ?? resolveStorageUrl(avatarPath);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Image
            source={logoLockup}
            resizeMode="contain"
            style={[styles.lockup, { tintColor: isDark ? "#F2EDE8" : "#2A1F1A" }]}
          />
          <Text style={[styles.title, { color: colors.foreground }]}>Pick a name and a face</Text>
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>
            Your username and photo show up everywhere people see you. You can change them later.
          </Text>

          <View style={styles.photoBlock}>
            <Pressable
              onPress={pickPhoto}
              style={[styles.avatar, { backgroundColor: colors.card, borderColor: colors.border }]}
              disabled={uploading}
            >
              {previewUri ? (
                <Image source={{ uri: previewUri }} style={styles.avatarImage} />
              ) : uploading ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Feather name="camera" size={28} color={colors.mutedForeground} />
              )}
              {uploading && previewUri ? (
                <View style={styles.uploadingOverlay}>
                  <ActivityIndicator color="#fff" />
                </View>
              ) : null}
            </Pressable>
            <Pressable onPress={pickPhoto} disabled={uploading}>
              <Text style={[styles.photoCta, { color: colors.primary }]}>
                {avatarPath ? "Change photo" : "Add a photo (required)"}
              </Text>
            </Pressable>
          </View>

          <Text style={[styles.label, { color: colors.foreground }]}>Username</Text>
          <View style={[styles.usernameRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.atSign, { color: colors.mutedForeground }]}>@</Text>
            <TextInput
              value={username}
              onChangeText={(v) => setUsername(v.replace(/[^a-zA-Z0-9_]/g, "").toLowerCase())}
              placeholder="yourname"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              style={[styles.usernameInput, { color: colors.foreground }]}
              maxLength={24}
            />
            {checking ? (
              <ActivityIndicator size="small" color={colors.mutedForeground} />
            ) : usernameStatus?.ok ? (
              <Feather name="check-circle" size={18} color={colors.success} />
            ) : usernameStatus && usernameStatus.reason ? (
              <Feather name="x-circle" size={18} color={colors.destructive} />
            ) : null}
          </View>
          <Text style={[styles.helper, { color: usernameStatus?.ok === false ? colors.destructive : colors.mutedForeground }]}>
            {usernameStatus?.reason ??
              "3–24 lowercase letters, numbers, or underscores."}
          </Text>

          {submitError ? <Text style={[styles.error, { color: colors.destructive }]}>{submitError}</Text> : null}

          <Pressable
            onPress={submit}
            disabled={!ready || updateIdentity.isPending}
            style={[
              styles.btn,
              { backgroundColor: ready ? colors.primary : colors.muted },
              (!ready || updateIdentity.isPending) && { opacity: 0.6 },
            ]}
          >
            <Text style={[styles.btnText, { color: ready ? colors.primaryForeground : colors.mutedForeground }]}>
              {updateIdentity.isPending ? "Saving..." : "Continue"}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: 24, gap: 14 },
  lockup: { width: 140, height: 140, alignSelf: "center", marginBottom: 8 },
  title: { fontSize: 26, fontFamily: "Inter_700Bold" },
  intro: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginBottom: 8 },
  photoBlock: { alignItems: "center", gap: 10, marginVertical: 12 },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: "100%", height: "100%" },
  uploadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoCta: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  label: { fontSize: 13, fontFamily: "Inter_600SemiBold", marginTop: 8 },
  usernameRow: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    gap: 8,
  },
  atSign: { fontSize: 16, fontFamily: "Inter_500Medium" },
  usernameInput: { flex: 1, fontSize: 16, fontFamily: "Inter_500Medium" },
  helper: { fontSize: 12, fontFamily: "Inter_400Regular" },
  error: { fontSize: 13, fontFamily: "Inter_400Regular" },
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 16 },
  btnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
});
