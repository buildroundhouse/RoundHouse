import React, { useEffect, useRef, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { useColors } from "@/hooks/useColors";
import { auth, isFirebaseConfigured } from "@/lib/firebase";
import { firebaseErrorMessage } from "@/lib/firebaseErrors";
import { readPendingBusinessInviteToken } from "@/lib/pendingBusinessInvite";
import { clearWearingState } from "@/lib/wearSkin";

const logoImage = require("@/assets/images/logo-lockup.png");

/**
 * Long-press trigger around the app logo. The "admin door" toggle.
 *
 * Why this is its own component:
 *   On web, the browser fires `contextmenu` and starts an image drag at
 *   roughly 150–500ms into a hold, BOTH of which cancel React Native
 *   `Pressable`'s gesture timer. That left admins unable to flip the
 *   sign-in form into admin mode at all on Chrome/Edge/Firefox.
 *
 *   To dodge it, on web we render a real `<div>` wrapper that:
 *     - calls `preventDefault` on `contextMenu`
 *     - sets `userSelect`/`touchCallout`/`userDrag` to `none`
 *     - calls `preventDefault` on `dragStart`
 *   …all of which keep the browser from intercepting the hold before
 *   our 600ms long-press timer fires.
 *
 *   On native (iOS/Android Expo), `Pressable.onLongPress` just works,
 *   so we render a plain `Pressable`.
 */
function LogoLongPressTrigger({
  onTrigger,
  children,
}: {
  onTrigger: () => void;
  children: React.ReactNode;
}) {
  if (Platform.OS === "web") {
    // Plain DOM event handlers run BEFORE react-native-web's synthetic
    // gesture pipeline, so timing the long-press ourselves with
    // pointerdown/up sidesteps the Pressable-vs-browser-contextmenu
    // race entirely.
    const HOLD_MS = 600;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const start = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onTrigger();
      }, HOLD_MS);
    };
    const cancel = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    // JSX `<div>` works in expo-web; on native this branch is dead code
    // and never bundled because of the Platform.OS check above.
    return (
      <div
        onContextMenu={(e) => e.preventDefault()}
        onDragStart={(e) => e.preventDefault()}
        onPointerDown={start}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        style={{
          alignSelf: "center",
          cursor: "pointer",
          userSelect: "none",
          WebkitUserSelect: "none",
          WebkitTouchCallout: "none",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <Pressable
      onLongPress={onTrigger}
      delayLongPress={600}
      style={styles.logoPress}
    >
      {children}
    </Pressable>
  );
}

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const router = useRouter();
  const params = useLocalSearchParams<{ adminPrefill?: string }>();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  // Hidden admin door: long-press on the logo flips the form into
  // "Admin sign-in" mode. Visually distinct (chip + accent border) so
  // the operator knows they're using the admin door, but the auth call
  // is still ordinary Firebase email+password — admin-vs-user is decided
  // server-side by the `is_admin` flag on the users row.
  const [adminMode, setAdminMode] = useState(false);

  // When the admin "exits" a demo skin via the floating HUB chip we
  // come back to this screen with ?adminPrefill=<email>. Auto-flip into
  // admin mode and prefill the username slug so they only have to type
  // the password.
  //
  // We also accept a plain `?admin=1` (or `?admin`) query param as an
  // unambiguous escape hatch for when the long-press logo gesture
  // doesn't fire (e.g. browsers that hijack image long-press for the
  // "Save image" context menu before Pressable's onLongPress fires).
  // Either trigger ends in the same place: adminMode = true.
  useEffect(() => {
    const prefill = typeof params.adminPrefill === "string" ? params.adminPrefill : "";
    const adminFlag = (() => {
      const v = (params as Record<string, unknown>).admin;
      if (typeof v === "string") return v.length === 0 || v === "1" || v === "true";
      if (Array.isArray(v)) return v.length > 0;
      return false;
    })();

    if (!prefill && !adminFlag) return;

    setAdminMode(true);

    if (prefill) {
      const slug = prefill.includes("@") ? prefill.split("@")[0] : prefill;
      setEmail(slug);
      setError("Re-enter your admin password to return to the hub.");
    }

    // Strip the query params from the URL so a browser refresh doesn't
    // re-flip the screen into admin mode. Without this, the user gets
    // stuck on admin sign-in every refresh and can't reach regular sign-in.
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      router.setParams({ adminPrefill: undefined, admin: undefined });
    }
  }, [params.adminPrefill, (params as Record<string, unknown>).admin, router]);

  // Refs let us read the live DOM value at submit time on web. iOS Safari's
  // autofill / keychain fill doesn't always fire React's onChange, so the
  // controlled `email`/`password` state can be stale ("") while the visible
  // field is filled. Reading from the underlying input element bypasses that.
  const emailRef = useRef<TextInput | null>(null);
  const passwordRef = useRef<TextInput | null>(null);

  const readLiveValue = (
    ref: React.MutableRefObject<TextInput | null>,
    fallback: string,
  ): string => {
    if (Platform.OS !== "web") return fallback;
    const node = ref.current as unknown as { value?: string } | null;
    const live = node?.value;
    return typeof live === "string" && live.length > 0 ? live : fallback;
  };

  const handleSubmit = async () => {
    if (!isFirebaseConfigured || !auth) {
      setError("Firebase isn't configured yet. Add the EXPO_PUBLIC_FIREBASE_* secrets and reload.");
      return;
    }

    // Admin door accepts a username ("savage") instead of an email.
    // We keep all admins on a single internal email domain so the
    // username → email mapping is a pure client-side suffix and no
    // extra round-trip is needed before the Firebase sign-in call.
    const ADMIN_EMAIL_DOMAIN = "roundhouse.app";
    const liveEmail = readLiveValue(emailRef, email);
    const livePassword = readLiveValue(passwordRef, password);
    if (liveEmail !== email) setEmail(liveEmail);
    if (livePassword !== password) setPassword(livePassword);
    const raw = liveEmail.trim();
    const errs: typeof fieldErrors = {};
    if (adminMode) {
      if (raw.length < 1) errs.email = "Enter your admin username.";
    } else if (!raw.includes("@")) {
      errs.email = "Enter a valid email address.";
    }
    if (livePassword.length < 1) errs.password = "Enter your password.";
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setError("");
    setLoading(true);

    const emailToUse = adminMode && !raw.includes("@")
      ? `${raw.toLowerCase()}@${ADMIN_EMAIL_DOMAIN}`
      : raw;

    try {
      await signInWithEmailAndPassword(auth, emailToUse, livePassword);
      // A successful explicit sign-in always supersedes any leftover
      // "wearing a demo skin" markers from a prior session — otherwise
      // the floating EXIT chip can keep nagging a fresh login.
      await clearWearingState();
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
    <View style={[styles.container, { backgroundColor: colors.background, paddingBottom: insets.bottom }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.inner}>
        <LogoLongPressTrigger
          onTrigger={() => {
            setAdminMode((m) => !m);
            setError("");
            setFieldErrors({});
          }}
        >
          <Image
            source={logoImage}
            resizeMode="contain"
            // `draggable={false}` is the cross-browser fix for the
            // long-press being eaten by the browser's image
            // context-menu / drag handler before `onLongPress` fires.
            // Without it, Chrome/Edge/Firefox start a drag at ~150ms
            // which cancels the Pressable's gesture timer.
            {...({ draggable: false } as { draggable?: boolean })}
            style={[
              styles.logo,
              { tintColor: isDark ? "#F2EDE8" : "#2A1F1A" },
              Platform.OS === "web"
                ? ({
                    userSelect: "none",
                    WebkitUserSelect: "none",
                    WebkitTouchCallout: "none",
                    WebkitUserDrag: "none",
                    pointerEvents: "none",
                  } as object)
                : null,
            ]}
          />
        </LogoLongPressTrigger>

        {adminMode ? (
          <View style={[styles.adminChip, { backgroundColor: colors.primary }]}>
            <Ionicons name="shield-checkmark" size={14} color={colors.primaryForeground} />
            <Text style={[styles.adminChipText, { color: colors.primaryForeground }]}>
              Admin sign-in
            </Text>
          </View>
        ) : null}

        <Text style={[styles.title, { color: colors.foreground }]}>
          {adminMode ? "Admin sign in" : "Sign in"}
        </Text>

        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          {adminMode ? "Username" : "Email"}
        </Text>
        <TextInput
          ref={emailRef}
          style={[styles.input, { backgroundColor: colors.card, borderColor: fieldErrors.email ? "#E55" : colors.border, color: colors.foreground }]}
          value={email}
          placeholder={adminMode ? "savage" : "you@example.com"}
          placeholderTextColor={colors.mutedForeground}
          onChangeText={(v) => { setEmail(v); setFieldErrors((f) => ({ ...f, email: undefined })); setError(""); }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={adminMode ? "default" : "email-address"}
          inputMode={adminMode ? "text" : "email"}
          // autoComplete="username" + autoComplete="current-password" on the
          // password field is the combo browsers and password managers
          // recognise as "save these credentials". Switching to "username"
          // in admin mode lets the OS keychain store "savage" + the admin
          // password as a discrete credential, separate from any user emails.
          autoComplete={adminMode ? "username" : "email"}
          textContentType={adminMode ? "username" : "emailAddress"}
        />
        {fieldErrors.email ? <Text style={[styles.error, { color: "#E55" }]}>{fieldErrors.email}</Text> : null}

        <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
        <View style={[styles.passwordWrap, { backgroundColor: colors.card, borderColor: fieldErrors.password ? "#E55" : colors.border }]}>
          <TextInput
            ref={passwordRef}
            style={[styles.passwordInput, { color: colors.foreground }]}
            value={password}
            placeholder="Password"
            placeholderTextColor={colors.mutedForeground}
            onChangeText={(v) => { setPassword(v); setFieldErrors((f) => ({ ...f, password: undefined })); setError(""); }}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={handleSubmit}
          />
          <Pressable onPress={() => setShowPassword((s) => !s)} hitSlop={10} style={styles.eyeBtn}>
            <Ionicons name={showPassword ? "eye-off" : "eye"} size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>
        {fieldErrors.password ? <Text style={[styles.error, { color: "#E55" }]}>{fieldErrors.password}</Text> : null}

        {error ? <Text style={[styles.error, styles.errorTop, { color: "#E55" }]}>{error}</Text> : null}

        <Pressable
          style={[
            styles.btn,
            { backgroundColor: colors.primary },
            loading && styles.btnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={loading}
        >
          <Text style={[styles.btnText, { color: colors.primaryForeground }]}>
            {loading ? "Signing in..." : "Sign in"}
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
          <Text style={[styles.linkText, { color: colors.mutedForeground }]}>No account? </Text>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable>
              <Text style={[styles.linkText, { color: colors.primary }]}>Sign up</Text>
            </Pressable>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, justifyContent: "center", paddingHorizontal: 28, gap: 8 },
  logoPress: { alignSelf: "center" },
  logo: { width: 160, height: 160, marginBottom: 4, alignSelf: "center" },
  adminChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    marginBottom: 6,
  },
  adminChipText: { fontSize: 12, fontFamily: "Inter_600SemiBold", letterSpacing: 0.3 },
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
