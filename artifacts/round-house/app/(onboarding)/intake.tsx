import React, { useCallback } from "react";
import { Alert, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { IntakeForm } from "@/components/IntakeForm";
import { MODE_INTAKES } from "@/lib/intake-schemas";
import { useResolvedIntake } from "@/lib/presetChips";
import { confirm } from "@/lib/confirm";
import {
  acceptAppInvite,
  useCompleteModeIntake,
  useDiscardMode,
  useUpdateMe,
  type UpdateUserBody,
  type UserModeKind,
} from "@workspace/api-client-react";
import { useProfile } from "@/lib/profile";
import { geocodeZip } from "@/lib/zipGeocode";
import {
  clearPendingAppInviteToken,
  readPendingAppInviteToken,
} from "@/lib/pendingAppInvite";

export default function IntakeScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ modeId?: string; kind?: string }>();
  const { profile, activeMode, modes, refetchModes, refetchProfile } = useProfile();
  const completeIntake = useCompleteModeIntake();
  const updateMe = useUpdateMe();
  const discardMode = useDiscardMode();

  const modeId = Number(params.modeId ?? activeMode?.id);
  const kind = (params.kind as UserModeKind | undefined) ?? activeMode?.kind;

  const targetMode = modes.find((m) => m.id === modeId) ?? null;
  // #625: Once an intake is complete, this is no longer the "build a new
  // avatar" flow — completed avatars are managed from Profile, so we
  // do not offer Start Over.
  const canStartOver = !!modeId && !!targetMode && targetMode.intakeCompletedAt == null;

  const exit = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)");
  }, [router]);

  // #625: Discard the in-progress avatar and return the user to the
  // skin picker so they can pick a different one. Only valid while the
  // intake is still incomplete.
  // #626: Route the destructive confirm through `lib/confirm.ts` so the
  // dialog actually surfaces on react-native-web (where the bare RN
  // `Alert.alert` is a no-op stub). Native still gets a real RN alert
  // because the helper falls back to `Alert.alert` off-web.
  const startOver = useCallback(async () => {
    if (!modeId) return;
    const ok = await confirm({
      title: "Start over — pick a different hat?",
      message:
        "Anything you've typed here will be discarded and this avatar will be removed.",
      confirmLabel: "Start over",
      cancelLabel: "Cancel",
      destructive: true,
    });
    if (!ok) return;
    try {
      await discardMode.mutateAsync({ modeId });
    } catch (e) {
      Alert.alert(
        "Couldn't start over",
        e instanceof Error ? e.message : "Please try again.",
      );
      return;
    }
    await Promise.all([refetchModes(), refetchProfile()]);
    router.replace("/(onboarding)/mode-picker");
  }, [modeId, discardMode, refetchModes, refetchProfile, router]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        // #625: Hardware back during a fresh intake should offer the
        // same Start Over confirm instead of silently bouncing the user
        // back through the onboarding gate (which would just send them
        // right back here while leaving the half-built avatar attached
        // to their account).
        if (canStartOver) {
          startOver();
        } else {
          exit();
        }
        return true;
      });
      return () => sub.remove();
    }, [canStartOver, startOver, exit]),
  );

  const fallbackIntake = MODE_INTAKES.home;
  const baseIntake = (kind && MODE_INTAKES[kind]) ?? fallbackIntake;
  const intake = useResolvedIntake(baseIntake);

  if (!modeId || !kind || !MODE_INTAKES[kind]) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  // Pre-populate user-scoped fields from the existing user record so a
  // returning user can edit their contact details inline.
  const initialModeData = (targetMode?.intakeData as Record<string, unknown>) ?? {};
  const initialData: Record<string, unknown> = { ...initialModeData };
  // Inherit personal info from the user account when starting a fresh profile.
  if (kind === "trade_pro" && !initialData.ownerName && profile?.name) {
    initialData.ownerName = profile.name;
  }
  for (const f of intake.fields) {
    if (f.scope === "user" && f.userField) {
      const v = profile?.[f.userField];
      if (v != null && v !== "") initialData[f.key] = v;
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <IntakeForm
        intake={intake}
        initialData={initialData}
        submitLabel="Enter your space"
        onClose={exit}
        onSubmit={async (data) => {
          // Split user-scoped fields from mode-scoped intake data.
          const userUpdates: UpdateUserBody = {};
          const modeData: Record<string, unknown> = {};
          for (const f of intake.fields) {
            if (f.scope === "user" && f.userField) {
              // Only emit a write when the form actually carried this field,
              // so absent keys cannot silently null out existing profile data.
              if (Object.prototype.hasOwnProperty.call(data, f.key)) {
                const v = data[f.key];
                const trimmed = typeof v === "string" ? v.trim() : "";
                userUpdates[f.userField] = trimmed.length > 0 ? trimmed : null;
              }
            } else {
              modeData[f.key] = data[f.key];
            }
          }
          if (kind === "trade_pro") {
            const zip = typeof modeData.primaryZip === "string" ? modeData.primaryZip.trim() : "";
            if (/^\d{5}$/.test(zip)) {
              const street =
                typeof modeData.streetAddress === "string" ? modeData.streetAddress.trim() : "";
              const coords = await geocodeZip(zip, street);
              if (coords) {
                modeData.lat = coords.lat;
                modeData.lng = coords.lng;
              } else {
                // Drop any stale coords if we couldn't resolve the new ZIP.
                delete modeData.lat;
                delete modeData.lng;
              }
            }
          }
          if (Object.keys(userUpdates).length > 0) {
            await updateMe.mutateAsync({ data: userUpdates });
          }
          await completeIntake.mutateAsync({ modeId, data: { intakeData: modeData } });
          await Promise.all([refetchModes(), refetchProfile()]);
          // If this user landed via a "Share Round House" SMS invite, mark
          // it accepted now that they've completed intake. Failures are
          // non-blocking — the user still proceeds to their profile.
          try {
            const inviteToken = await readPendingAppInviteToken();
            if (inviteToken) {
              await acceptAppInvite({ token: inviteToken });
              await clearPendingAppInviteToken();
            }
          } catch {
            // Token may have been used or expired; drop it so future intake
            // completions don't keep retrying forever.
            await clearPendingAppInviteToken();
          }
          router.replace("/(tabs)/profile");
        }}
      />
      {canStartOver ? (
        <View
          style={[
            styles.startOverBar,
            { backgroundColor: colors.background, borderTopColor: colors.border },
          ]}
        >
          <Pressable
            onPress={startOver}
            disabled={discardMode.isPending}
            accessibilityRole="button"
            accessibilityLabel="Start over and pick a different hat"
            style={({ pressed }) => [
              styles.startOverBtn,
              { opacity: pressed || discardMode.isPending ? 0.6 : 1 },
            ]}
            hitSlop={8}
          >
            <Text style={[styles.startOverText, { color: colors.mutedForeground }]}>
              {discardMode.isPending
                ? "Starting over…"
                : "Start over — pick a different hat"}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  startOverBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
    alignItems: "center",
  },
  startOverBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  startOverText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    textDecorationLine: "underline",
  },
});
