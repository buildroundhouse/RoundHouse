import React, { useMemo, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { useColors } from "@/hooks/useColors";
import { auth, isFirebaseConfigured } from "@/lib/firebase";
import { firebaseErrorMessage } from "@/lib/firebaseErrors";
import { readPendingBusinessInviteToken } from "@/lib/pendingBusinessInvite";

const logoImage = require("@/assets/images/logo-lockup.png");

export default function SignUpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; confirm?: string }>({});

  const passwordChecks = useMemo(() => ({
    length: password.length >= 6,
    matches: confirmPassword.length > 0 && password === confirmPassword,
  }), [password, confirmPassword]);

  const handleSubmit = async () => {
    if (!isFirebaseConfigured || !auth) {
      setError("Firebase isn't configured yet. Add the EXPO_PUBLIC_FIREBASE_* secrets and reload.");
      return;
    }

    const emailTrimmed = email.trim();
    const errs: typeof fieldErrors = {};
    if (!emailTrimmed.includes("@")) errs.email = "Enter a valid email address.";
    if (password.length < 6) errs.password = "Password must be at least 6 characters.";
    if (password !== confirmPassword) errs.confirm = "Passwords don't match.";
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setError("");
    setLoading(true);

    try {
      // Auth-only. No Firestore/profile write here — anything that could fail
      // is deferred so a successful signup can never look like a failure.
      await createUserWithEmailAndPassword(auth, emailTrimmed, password);
      const inviteToken = await readPendingBusinessInviteToken();
      const dest = inviteToken ? (`/invite/business/${inviteToken}` as never) : "/(tabs)";
      router.replace(dest);
    } catch (err: unknown) {
      setError(firebaseErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    if (!isFirebaseConfigured || !auth) {
      setError("Firebase isn't configured yet.");
      return;
    }
    if (Platform.OS !== "web") {
      setError("Google sign-in on mobile native isn't wired yet — use email/password for now.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      const inviteToken = await readPendingBusinessInviteToken();
      const dest = inviteToken ? (`/invite/business/${inviteToken}` as never) : "/(tabs)";
      router.replace(dest);
    } catch (err: unknown) {
      const msg = firebaseErrorMessage(err);
      if (msg) setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          <Image
            source={logoImage}
            resizeMode="contain"
            style={[styles.logo, { tintColor: isDark ? "#F2EDE8" : "#2A1F1A" }]}
          />

          <Text style={[styles.title, { color: colors.foreground }]}>Create account</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Join Roundhouse to track and share property work.
          </Text>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: fieldErrors.email ? "#E55" : colors.border, color: colors.foreground }]}
            value={email}
            placeholder="you@example.com"
            placeholderTextColor={colors.mutedForeground}
            onChangeText={(v) => { setEmail(v); setFieldErrors((f) => ({ ...f, email: undefined })); setError(""); }}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            inputMode="email"
            autoComplete="email"
            textContentType="emailAddress"
          />
          {fieldErrors.email ? <Text style={[styles.error, { color: "#E55" }]}>{fieldErrors.email}</Text> : null}

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
          <View style={[styles.passwordWrap, { backgroundColor: colors.card, borderColor: fieldErrors.password ? "#E55" : colors.border }]}>
            <TextInput
              style={[styles.passwordInput, { color: colors.foreground }]}
              value={password}
              placeholder="At least 6 characters"
              placeholderTextColor={colors.mutedForeground}
              onChangeText={(v) => { setPassword(v); setFieldErrors((f) => ({ ...f, password: undefined, confirm: undefined })); setError(""); }}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              passwordRules="minlength: 6;"
            />
            <Pressable onPress={() => setShowPassword((s) => !s)} hitSlop={10} style={styles.eyeBtn}>
              <Ionicons name={showPassword ? "eye-off" : "eye"} size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          {fieldErrors.password ? <Text style={[styles.error, { color: "#E55" }]}>{fieldErrors.password}</Text> : null}

          <View style={styles.rules}>
            <View style={styles.ruleRow}>
              <Ionicons
                name={passwordChecks.length ? "checkmark-circle" : "ellipse-outline"}
                size={14}
                color={passwordChecks.length ? "#4A8" : colors.mutedForeground}
              />
              <Text style={[styles.ruleText, { color: passwordChecks.length ? "#4A8" : colors.mutedForeground }]}>
                At least 6 characters
              </Text>
            </View>
            <View style={styles.ruleRow}>
              <Ionicons
                name={passwordChecks.matches ? "checkmark-circle" : "ellipse-outline"}
                size={14}
                color={passwordChecks.matches ? "#4A8" : colors.mutedForeground}
              />
              <Text style={[styles.ruleText, { color: passwordChecks.matches ? "#4A8" : colors.mutedForeground }]}>
                Passwords match
              </Text>
            </View>
          </View>

          <Text style={[styles.label, { color: colors.mutedForeground }]}>Confirm password</Text>
          <View style={[styles.passwordWrap, { backgroundColor: colors.card, borderColor: fieldErrors.confirm ? "#E55" : colors.border }]}>
            <TextInput
              style={[styles.passwordInput, { color: colors.foreground }]}
              value={confirmPassword}
              placeholder="Re-enter password"
              placeholderTextColor={colors.mutedForeground}
              onChangeText={(v) => { setConfirmPassword(v); setFieldErrors((f) => ({ ...f, confirm: undefined })); setError(""); }}
              secureTextEntry={!showConfirm}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
            />
            <Pressable onPress={() => setShowConfirm((s) => !s)} hitSlop={10} style={styles.eyeBtn}>
              <Ionicons name={showConfirm ? "eye-off" : "eye"} size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          {fieldErrors.confirm ? <Text style={[styles.error, { color: "#E55" }]}>{fieldErrors.confirm}</Text> : null}

          {error ? <Text style={[styles.error, styles.errorTop, { color: "#E55" }]}>{error}</Text> : null}

          <Pressable
            style={[styles.btn, { backgroundColor: colors.primary }, loading && styles.btnDisabled]}
            onPress={handleSubmit}
            disabled={loading}
            accessibilityRole="button"
          >
            <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
              {loading ? "Creating account..." : "Create account"}
            </Text>
          </Pressable>

          {Platform.OS === "web" ? (
            <>
              <View style={styles.divider}>
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>or</Text>
                <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              </View>

              <Pressable
                style={[styles.googleBtn, { borderColor: colors.border, backgroundColor: colors.card }, loading && styles.btnDisabled]}
                onPress={handleGoogle}
                disabled={loading}
              >
                <Ionicons name="logo-google" size={18} color={colors.foreground} />
                <Text style={[styles.googleText, { color: colors.foreground }]}>Continue with Google</Text>
              </Pressable>
            </>
          ) : null}

          <View style={styles.linkRow}>
            <Text style={[styles.linkText, { color: colors.mutedForeground }]}>Already have an account? </Text>
            <Link href="/(auth)/sign-in" asChild>
              <Pressable>
                <Text style={[styles.linkText, { color: colors.primary }]}>Sign in</Text>
              </Pressable>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { justifyContent: "center", paddingHorizontal: 28, paddingTop: 80, gap: 8 },
  logo: { width: 160, height: 160, marginBottom: 4, alignSelf: "center" },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", marginBottom: 4 },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 12, lineHeight: 20 },
  label: { fontSize: 13, fontFamily: "Inter_500Medium", marginBottom: 4 },
  input: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
    marginBottom: 4,
  },
  passwordWrap: {
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    marginBottom: 4,
  },
  passwordInput: { flex: 1, height: "100%", fontSize: 15, fontFamily: "Inter_400Regular" },
  eyeBtn: { padding: 6, marginRight: -6 },
  rules: { gap: 4, marginVertical: 6, marginLeft: 2 },
  ruleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  ruleText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  error: { fontSize: 12, fontFamily: "Inter_400Regular", marginBottom: 4 },
  errorTop: { marginTop: 6, fontSize: 13, lineHeight: 18 },
  btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 8 },
  btnDisabled: { opacity: 0.5 },
  btnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  divider: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 14 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  googleBtn: {
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  googleText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  linkRow: { flexDirection: "row", justifyContent: "center", marginTop: 16 },
  linkText: { fontSize: 14, fontFamily: "Inter_400Regular" },
});
