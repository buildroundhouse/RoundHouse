import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ApiError,
  acceptBusinessInvite,
  getBusinessInvite,
  type BusinessInviteLookupResponse,
  type AcceptBusinessInviteResponse,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import {
  clearPendingBusinessInviteToken,
  setPendingBusinessInviteToken,
} from "@/lib/pendingBusinessInvite";

type Phase =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "needs-auth"; invite: BusinessInviteLookupResponse }
  | { kind: "accepting"; invite: BusinessInviteLookupResponse }
  | { kind: "accepted"; result: AcceptBusinessInviteResponse }
  | { kind: "error"; invite: BusinessInviteLookupResponse | null; message: string };

export default function BusinessInviteLandingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token: rawToken } = useLocalSearchParams<{ token: string | string[] }>();
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  const { isSignedIn, isLoaded } = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setPhase({ kind: "invalid", message: "This invite link is missing its token." });
      return;
    }
    setPhase({ kind: "loading" });
    void (async () => {
      try {
        const invite = await getBusinessInvite(token);
        if (cancelled) return;
        if (!isLoaded) return;
        if (!isSignedIn) {
          await setPendingBusinessInviteToken(token);
          if (cancelled) return;
          setPhase({ kind: "needs-auth", invite });
          return;
        }
        setPhase({ kind: "accepting", invite });
        try {
          const result = await acceptBusinessInvite({ token });
          if (cancelled) return;
          await clearPendingBusinessInviteToken();
          setPhase({ kind: "accepted", result });
        } catch (e) {
          // Terminal error from accept — drop the pending token so future
          // sign-ins don't keep redirecting back here with a token the
          // server has already rejected.
          await clearPendingBusinessInviteToken();
          if (cancelled) return;
          setPhase({ kind: "error", invite, message: extractError(e) });
        }
      } catch (e) {
        // Lookup failed (invalid/expired link). Clear any stored token so
        // the next sign-in goes straight to the Timeline tab.
        await clearPendingBusinessInviteToken();
        if (cancelled) return;
        const message =
          e instanceof ApiError && e.status === 404
            ? "This invite link is no longer valid."
            : extractError(e);
        setPhase({ kind: "invalid", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, isSignedIn, isLoaded]);

  const goSignUp = () => router.push("/(auth)/sign-up");
  const goSignIn = () => router.push("/(auth)/sign-in");
  const goHome = () => router.replace("/(tabs)");

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 },
      ]}
    >
      <View style={styles.inner}>
        {phase.kind === "loading" ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>Loading your invite…</Text>
          </View>
        ) : null}

        {phase.kind === "invalid" ? (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>Invite unavailable</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>{phase.message}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={goHome}
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Go to Roundhouse</Text>
            </Pressable>
          </>
        ) : null}

        {phase.kind === "needs-auth" ? (
          <>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>You're invited</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {phase.invite.inviter?.name
                ? `${phase.invite.inviter.name} invited you to Roundhouse`
                : "You've been invited to Roundhouse"}
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              {phase.invite.businessName
                ? `Sign up or sign in as ${phase.invite.businessName} to connect.`
                : "Sign up or sign in to accept your invite."}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={goSignUp}
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Create account</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={goSignIn}
              style={[styles.secondaryBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>I already have an account</Text>
            </Pressable>
          </>
        ) : null}

        {phase.kind === "accepting" ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>Accepting your invite…</Text>
          </View>
        ) : null}

        {phase.kind === "accepted" ? (
          <>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>You're connected</Text>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Welcome to Roundhouse
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              {`You're now connected with ${phase.result.inviter.name}. They'll see you in their People list.`}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={goHome}
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Continue</Text>
            </Pressable>
          </>
        ) : null}

        {phase.kind === "error" ? (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>Couldn't accept invite</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>{phase.message}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={goHome}
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>Go to Roundhouse</Text>
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

function extractError(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.data as { error?: unknown } | null | undefined;
    if (body && typeof body.error === "string" && body.error.length > 0) return body.error;
  }
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong. Please try again.";
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 28 },
  inner: { flex: 1, justifyContent: "center", gap: 12 },
  center: { alignItems: "center", gap: 12 },
  eyebrow: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  title: { fontSize: 26, fontFamily: "Inter_700Bold", lineHeight: 32 },
  body: { fontSize: 15, fontFamily: "Inter_400Regular", lineHeight: 22 },
  muted: { fontSize: 14, fontFamily: "Inter_400Regular" },
  primaryBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  primaryBtnText: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  secondaryBtn: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
