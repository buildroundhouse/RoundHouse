import { BlurView } from "expo-blur";
import { Tabs, Redirect } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useAuth } from "@/lib/auth";
import { useProfile } from "@/lib/profile";
import { CaptureFAB } from "@/components/CaptureFAB";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AdminQuickExit } from "@/components/admin/AdminQuickExit";
import { useListQuestions } from "@workspace/api-client-react";

import { useColors } from "@/hooks/useColors";

type SfPair = { default: SFSymbol; selected: SFSymbol };
type TabSpec = { label: string; sf: SfPair; feather: keyof typeof Feather.glyphMap };

// Locked Command Center toolbar: Resolution · People · CAPTURE ·
// Estimates/Invoices · Calendar. CAPTURE is the raised center control and is
// rendered by CaptureFAB; its center route remains a non-interactive spacer.
const TABS: Record<
  "resolutions" | "people" | "invoices" | "calendar",
  TabSpec
> = {
  resolutions: { label: "Resolution", sf: { default: "switch.2", selected: "switch.2" }, feather: "toggle-left" },
  people:      { label: "People", sf: { default: "person.2", selected: "person.2.fill" }, feather: "users" },
  invoices:    { label: "Estimates", sf: { default: "doc.text", selected: "doc.text.fill" }, feather: "file-text" },
  calendar:    { label: "Calendar", sf: { default: "calendar", selected: "calendar" }, feather: "calendar" },
};

function ResolutionToggleIcon({ count, color }: { count: number; color: string }) {
  const rim = count >= 3 ? "#DC2626" : count >= 2 ? "#FACC15" : "transparent";
  const signal = count > 0 ? "#DC2626" : "#16A34A";
  return (
    <View
      accessibilityLabel={count > 0 ? `${count} new Resolution items` : "No new Resolution items"}
      style={[styles.resolutionPlacard, { borderColor: rim }]}
    >
      <View style={[styles.resolutionPivot, { backgroundColor: color }]} />
      <View
        style={[
          styles.resolutionLever,
          { backgroundColor: color, transform: [{ rotate: count > 0 ? "35deg" : "-35deg" }] },
        ]}
      >
        <View style={[styles.resolutionSignal, { backgroundColor: signal }]} />
      </View>
      {count >= 4 ? <Feather name="zap" size={13} color="#F97316" style={styles.urgentMark} /> : null}
    </View>
  );
}

function CommandCenterTabs() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  const questionsQuery = useListQuestions();
  const attentionCount = useMemo(
    () => (questionsQuery.data?.questions ?? []).filter((q) => q.kind === "request" && q.status !== "completed").length,
    [questionsQuery.data?.questions],
  );
  const [acknowledgedCount, setAcknowledgedCount] = useState(0);
  const newResolutionCount = Math.max(0, attentionCount - acknowledgedCount);
  useEffect(() => {
    setAcknowledgedCount((current) => Math.min(current, attentionCount));
  }, [attentionCount]);

  const renderIcon = (spec: TabSpec) => ({ color }: { color: string }) =>
    isIOS ? (
      <SymbolView name={spec.sf.default} tintColor={color} size={24} />
    ) : (
      <Feather name={spec.feather} size={22} color={color} />
    );

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          elevation: 0,
          height: isWeb ? 84 : undefined,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="resolutions"
        listeners={{ tabPress: () => setAcknowledgedCount(attentionCount) }}
        options={{
          title: TABS.resolutions.label,
          tabBarIcon: ({ color }) => <ResolutionToggleIcon count={newResolutionCount} color={color} />,
        }}
      />
      <Tabs.Screen name="clients" options={{ title: TABS.people.label, tabBarIcon: renderIcon(TABS.people) }} />
      <Tabs.Screen
        name="camera"
        options={{
          title: "Capture",
          tabBarButton: () => <View style={{ flex: 1 }} pointerEvents="none" />,
        }}
      />
      <Tabs.Screen name="invoices" options={{ title: TABS.invoices.label, tabBarIcon: renderIcon(TABS.invoices) }} />
      <Tabs.Screen name="calendar" options={{ title: TABS.calendar.label, tabBarIcon: renderIcon(TABS.calendar) }} />
      <Tabs.Screen name="index"         options={{ href: null }} />
      <Tabs.Screen name="my-team"       options={{ href: null }} />
      <Tabs.Screen name="profile"       options={{ href: null }} />
      <Tabs.Screen name="properties"    options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="logs"          options={{ href: null }} />
    </Tabs>
  );
}

export default function TabLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const { status } = useProfile();
  if (!isLoaded) return <LoadingScreen />;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  if (status.kind === "needs-identity") return <Redirect href="/(onboarding)/identity" />;
  if (status.kind === "needs-mode-picker") return <Redirect href="/(onboarding)/mode-picker" />;
  if (status.kind === "needs-intake") return <Redirect href="/(onboarding)/intake" />;
  if (status.kind === "admin-empty") return <Redirect href="/account/admin" />;

  return (
    <View style={{ flex: 1 }}>
      <CommandCenterTabs />
      <CaptureFAB />
      <AdminQuickExit />
    </View>
  );
}

const styles = StyleSheet.create({
  resolutionPlacard: {
    width: 31,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    backgroundColor: "#9CA3AF",
    alignItems: "center",
    justifyContent: "center",
  },
  resolutionPivot: { position: "absolute", width: 5, height: 5, borderRadius: 3 },
  resolutionLever: { width: 18, height: 4, borderRadius: 2, alignItems: "flex-end", justifyContent: "center" },
  resolutionSignal: { width: 9, height: 9, borderRadius: 5 },
  urgentMark: { position: "absolute", top: -9, right: -6 },
});
