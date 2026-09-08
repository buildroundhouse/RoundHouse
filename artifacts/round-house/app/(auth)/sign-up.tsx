import React, { useMemo, useState } from "react";
import {
  Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet,
  Text, TextInput, useColorScheme, View,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { useColors } from "@/hooks/useColors";
import { auth, isFirebaseConfigured } from "@/lib/firebase";
import { firebaseErrorMessage } from "@/lib/firebaseErrors";

const logoImage = require("@/assets/images/logo-lockup.png");

export default function SignUpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() === "dark";
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; confirm?: string }>({});

  const passwordChecks = useMemo(() => ({ length: password.length >= 6, matches: confirmPassword.length > 0 && password === confirmPassword }), [password, confirmPassword]);

  const handleSubmit = async () => {
    if (!isFirebaseConfigured || !auth) { setError("Firebase isn't configured yet."); return; }
    const emailTrimmed = email.trim();
    const errs: typeof fieldErrors = {};
    if (!emailTrimmed.includes("@")) errs.email = "Enter a valid email address.";
    if (password.length < 6) errs.password = "Password must be at least 6 characters.";
    if (password !== confirmPassword) errs.confirm = "Passwords don't match.";
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    setFieldErrors({}); setError(""); setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, emailTrimmed, password);
      router.replace("/(onboarding)/identity");
    } catch (err: unknown) { setError(firebaseErrorMessage(err)); }
    finally { setLoading(false); }
  };

  return <View style={[styles.container, { backgroundColor: colors.background }]}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}><ScrollView contentContainerStyle={[styles.inner, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
    <Image source={logoImage} resizeMode="contain" style={[styles.logo, { tintColor: isDark ? "#F2EDE8" : "#2A1F1A" }]} />
    <Text style={[styles.title, { color: colors.foreground }]}>Create account</Text>
    <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Your email and password give you access to Roundhouse.</Text>
    <Text style={[styles.label, { color: colors.mutedForeground }]}>Email</Text>
    <TextInput style={[styles.input, { backgroundColor: colors.card, borderColor: fieldErrors.email ? "#E55" : colors.border, color: colors.foreground }]} value={email} placeholder="you@example.com" placeholderTextColor={colors.mutedForeground} onChangeText={(v) => { setEmail(v); setFieldErrors((f) => ({ ...f, email: undefined })); }} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" />
    {fieldErrors.email ? <Text style={styles.error}>{fieldErrors.email}</Text> : null}
    <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
    <View style={[styles.passwordWrap, { backgroundColor: colors.card, borderColor: fieldErrors.password ? "#E55" : colors.border }]}><TextInput style={[styles.passwordInput, { color: colors.foreground }]} value={password} placeholder="At least 6 characters" placeholderTextColor={colors.mutedForeground} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" /><Pressable onPress={() => setShowPassword((v) => !v)}><Ionicons name={showPassword ? "eye-off" : "eye"} size={20} color={colors.mutedForeground} /></Pressable></View>
    <View style={styles.rules}><Text style={[styles.ruleText, { color: passwordChecks.length ? colors.success : colors.mutedForeground }]}>✓ At least 6 characters</Text><Text style={[styles.ruleText, { color: passwordChecks.matches ? colors.success : colors.mutedForeground }]}>✓ Passwords match</Text></View>
    <Text style={[styles.label, { color: colors.mutedForeground }]}>Confirm password</Text>
    <View style={[styles.passwordWrap, { backgroundColor: colors.card, borderColor: fieldErrors.confirm ? "#E55" : colors.border }]}><TextInput style={[styles.passwordInput, { color: colors.foreground }]} value={confirmPassword} placeholder="Re-enter password" placeholderTextColor={colors.mutedForeground} onChangeText={setConfirmPassword} secureTextEntry={!showConfirm} autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" onSubmitEditing={handleSubmit} /><Pressable onPress={() => setShowConfirm((v) => !v)}><Ionicons name={showConfirm ? "eye-off" : "eye"} size={20} color={colors.mutedForeground} /></Pressable></View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Pressable style={[styles.btn, { backgroundColor: colors.primary }, loading && { opacity: 0.5 }]} onPress={handleSubmit} disabled={loading}><Text style={[styles.btnText, { color: colors.primaryForeground }]}>{loading ? "Creating account..." : "Create account"}</Text></Pressable>
    <View style={styles.linkRow}><Text style={[styles.linkText, { color: colors.mutedForeground }]}>Already have an account? </Text><Link href="/(auth)/sign-in" asChild><Pressable><Text style={[styles.linkText, { color: colors.primary }]}>Sign in</Text></Pressable></Link></View>
  </ScrollView></KeyboardAvoidingView></View>;
}

const styles = StyleSheet.create({ container: { flex: 1 }, inner: { justifyContent: "center", paddingHorizontal: 28, paddingTop: 80, gap: 8 }, logo: { width: 160, height: 160, marginBottom: 4, alignSelf: "center" }, title: { fontSize: 26, fontFamily: "Inter_700Bold" }, subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", marginBottom: 12 }, label: { fontSize: 13, fontFamily: "Inter_500Medium" }, input: { height: 50, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, fontSize: 15 }, passwordWrap: { height: 50, borderRadius: 12, borderWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 }, passwordInput: { flex: 1, height: "100%", fontSize: 15 }, rules: { gap: 4, marginVertical: 6 }, ruleText: { fontSize: 12 }, error: { fontSize: 12, color: "#E55", marginVertical: 4 }, btn: { height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 8 }, btnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" }, linkRow: { flexDirection: "row", justifyContent: "center", marginTop: 16 }, linkText: { fontSize: 14 } });
