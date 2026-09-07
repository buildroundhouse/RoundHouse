import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ApiError,
  getAppInviteByToken,
  type AppInviteLookupResponse,
} from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/lib/auth";
import {
  clearPendingAppInviteToken,
  setPendingAppInviteToken,
} from "@/lib/pendingAppInvite";
import { MODE_LABELS } from "@/lib/intake-schemas";

type Phase =
  | { kind: "loading" }
  | { kind: "invalid"; message: string }
  | { kind: "needs-auth"; invite: AppInviteLookupResponse }
  | { kind: "already-signed-up"; invite: AppInviteLookupResponse };

export default function AppInviteLandingScreen() {
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
        const invite = await getAppInviteByToken(token);
        if (cancelled) return;
        if (!isLoaded) return;
        if (invite.status === "signed_up" || invite.status === "cancelled" || invite.status === "expired") {
          await clearPendingAppInviteToken();
          if (cancelled) return;
          setPhase({ kind: "already-signed-up", invite });
          return;
        }
        if (!isSignedIn) {
          await setPendingAppInviteToken(token);
          if (cancelled) return;
          setPhase({ kind: "needs-auth", invite });
          return;
        }
        // Already signed in — keep the token so the next intake completion
        // triggers the accept call, then send them to the app.
        await setPendingAppInviteToken(token);
        router.replace("/(tabs)");
      } catch (e) {
        await clearPendingAppInviteToken();
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
  }, [token, isSignedIn, isLoaded, router]);

  const goSignUp = () => router.push("/(auth)/sign-up");
  const goSignIn = () => router.push("/(auth)/sign-in");
  const goHome = () => router.replace("/(tabs)");

  const inviterName =
    phase.kind === "needs-auth" || phase.kind === "already-signed-up"
      ? phase.invite.inviter?.name ?? null
      : null;
  const invitedKindLabel =
    (phase.kind === "needs-auth" || phase.kind === "already-signed-up") &&
    phase.invite.invitedKind
      ? MODE_LABELS[phase.invite.invitedKind] ?? null
      : null;

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
            <Text style={[styles.muted, { color: colors.mutedForeground }]}>
              Loading your invite…
            </Text>
          </View>
        ) : null}

        {phase.kind === "invalid" ? (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Invite unavailable
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              {phase.message}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={goHome}
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                Go to Round House
              </Text>
            </Pressable>
          </>
        ) : null}

        {phase.kind === "needs-auth" ? (
          <>
            <Text style={[styles.eyebrow, { color: colors.primary }]}>
              You're invited
            </Text>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {inviterName
                ? `${inviterName} invited you to Round House`
                : "You've been invited to Round House"}
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              {invitedKindLabel
                ? `Sign up as ${invitedKindLabel} to get started — or pick another role on the next screen.`
                : "Sign up to get started."}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={goSignUp}
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                Create account
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={goSignIn}
              style={[styles.secondaryBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
                I already have an account
              </Text>
            </Pressable>
          </>
        ) : null}

        {phase.kind === "already-signed-up" ? (
          <>
            <Text style={[styles.title, { color: colors.foreground }]}>
              Invite already used
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              This invite link has already been used or is no longer active.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={goHome}
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            >
              <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
                Go to Round House
              </Text>
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
