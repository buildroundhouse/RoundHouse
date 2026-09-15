import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSwitchActiveMode } from "@workspace/api-client-react";
import { useProfile } from "@/lib/profile";
import { useColors } from "@/hooks/useColors";

/** Recover existing owner spaces when a legacy personal baseline was active. */
export function SavedSpaces() {
  const profile = useProfile();
  const switchMode = useSwitchActiveMode();
  const router = useRouter();
  const colors = useColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const spaces = profile.modes.filter((mode) => ["home", "facilities", "trade_pro"].includes(mode.kind));
  if (!spaces.length) return null;
  return <View style={{ gap: 12 }}>
    <Text style={{ color: colors.foreground }}>Your saved spaces</Text>
    {spaces.map((mode) => {
      const data = (mode.intakeData ?? {}) as Record<string, unknown>;
      const name = String(data.companyName || data.placeName || (mode.kind === "trade_pro" ? "Business" : "Property"));
      return <Pressable key={mode.id} accessibilityRole="button" disabled={busy} style={{ minHeight: 48, justifyContent: "center" }}
        onPress={async () => {
          setBusy(true); setError("");
          try {
            await switchMode.mutateAsync({ data: { modeId: mode.id } });
            await Promise.all([profile.refetchModes(), profile.refetchProfile(), profile.refetchOutwardAccounts()]);
            router.replace("/");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Couldn't open this space. Please retry.");
          } finally { setBusy(false); }
        }}>
        <Text style={{ color: colors.primary }}>{mode.intakeCompletedAt ? "Open" : "Resume setup"}: {name}</Text>
      </Pressable>;
    })}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
  </View>;
}
