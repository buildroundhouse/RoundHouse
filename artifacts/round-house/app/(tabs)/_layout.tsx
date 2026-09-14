import { BlurView } from "expo-blur";
import { Tabs, Redirect } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useAuth } from "@/lib/auth";
import { useProfile } from "@/lib/profile";
import { CaptureFAB } from "@/components/CaptureFAB";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AdminQuickExit } from "@/components/admin/AdminQuickExit";
import { useListQuestions } from "@workspace/api-client-react";
import {
  resolutionSignalForQuestions,
  type ResolutionSignal,
} from "@/lib/resolutionSignal";

import { useColors } from "@/hooks/useColors";

type SfPair = { default: SFSymbol; selected: SFSymbol };
type TabSpec = {
  label: string;
  sf: SfPair;
  feather: keyof typeof Feather.glyphMap;
};

// Locked Command Center toolbar: Resolution · People · CAPTURE ·
// Estimates/Invoices · Calendar. CAPTURE is the raised center control and is
// rendered by CaptureFAB; its center route remains a non-interactive spacer.
const TABS: Record<
  "resolutions" | "people" | "invoices" | "calendar",
  TabSpec
> = {
  resolutions: {
    label: "Resolution",
    sf: { default: "switch.2", selected: "switch.2" },
    feather: "toggle-left",
  },
  people: {
    label: "People",
    sf: { default: "person.2", selected: "person.2.fill" },
    feather: "users",
  },
  invoices: {
    label: "Estimates",
    sf: { default: "doc.text", selected: "doc.text.fill" },
    feather: "file-text",
  },
  calendar: {
    label: "Calendar",
    sf: { default: "calendar", selected: "calendar" },
    feather: "calendar",
  },
};

function ResolutionToggleIcon({ signal }: { signal: ResolutionSignal }) {
  const needsYou = signal.responsibility === "you";
  const isUrgent = needsYou && signal.unansweredPrompts >= 4;
  const rim =
    needsYou && signal.unansweredPrompts === 2
      ? "#FACC15"
      : needsYou && signal.unansweredPrompts >= 3
        ? "#DC2626"
        : "#6B7280";
  const face =
    signal.responsibility === "empty"
      ? "#9CA3AF"
      : needsYou
        ? "#DC2626"
        : "#16A34A";
  const leanRight = needsYou;
  return (
    <View style={styles.resolutionIconFrame}>
      {isUrgent ? (
        <View style={styles.fireRim} pointerEvents="none">
          <View style={[styles.flame, styles.flameOne]} />
          <View style={[styles.flame, styles.flameTwo]} />
          <View style={[styles.flame, styles.flameThree]} />
        </View>
      ) : null}
      <View style={[styles.resolutionPlacard, { borderColor: rim }]}>
        <View style={styles.resolutionPivot} />
        <View
          style={[
            styles.resolutionLever,
            { transform: [{ rotate: leanRight ? "34deg" : "-34deg" }] },
          ]}
        >
          <View style={[styles.resolutionSignal, { backgroundColor: face }]} />
        </View>
      </View>
    </View>
  );
}

function CommandCenterTabs() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const { userId } = useAuth();

  const questionsQuery = useListQuestions();
  const resolutionSignal = useMemo(
    () =>
      resolutionSignalForQuestions(
        questionsQuery.data?.questions ?? [],
        userId,
      ),
    [questionsQuery.data?.questions, userId],
  );

  const renderIcon =
    (spec: TabSpec) =>
    ({ color }: { color: string }) =>
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
            <View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: colors.background },
              ]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="resolutions"
        options={{
          title: TABS.resolutions.label,
          tabBarAccessibilityLabel:
            resolutionSignal.responsibility === "empty"
              ? "Resolution Center, no active resolutions"
              : resolutionSignal.responsibility === "you"
                ? `Resolution Center, action waiting on you, prompt ${resolutionSignal.unansweredPrompts}`
                : "Resolution Center, waiting on someone else",
          tabBarIcon: () => <ResolutionToggleIcon signal={resolutionSignal} />,
        }}
      />
      <Tabs.Screen
        name="clients"
        options={{
          title: TABS.people.label,
          tabBarIcon: renderIcon(TABS.people),
        }}
      />
      <Tabs.Screen
        name="camera"
        options={{
          title: "Capture",
          tabBarButton: () => <View style={{ flex: 1 }} pointerEvents="none" />,
        }}
      />
      <Tabs.Screen
        name="invoices"
        options={{
          title: TABS.invoices.label,
          tabBarIcon: renderIcon(TABS.invoices),
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: TABS.calendar.label,
          tabBarIcon: renderIcon(TABS.calendar),
        }}
      />
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="my-team" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ href: null }} />
      <Tabs.Screen name="properties" options={{ href: null }} />
      <Tabs.Screen name="notifications" options={{ href: null }} />
      <Tabs.Screen name="logs" options={{ href: null }} />
    </Tabs>
  );
}

export default function TabLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const { status } = useProfile();
  if (!isLoaded) return <LoadingScreen />;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  if (status.kind === "needs-identity")
    return <Redirect href="/(onboarding)/identity" />;
  if (status.kind === "needs-mode-picker")
    return <Redirect href="/(onboarding)/mode-picker" />;
  if (status.kind === "needs-intake")
    return <Redirect href="/(onboarding)/intake" />;
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
  resolutionIconFrame: {
    width: 38,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  resolutionPlacard: {
    width: 34,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    backgroundColor: "#D1D5DB",
    alignItems: "center",
    justifyContent: "center",
  },
  resolutionPivot: {
    position: "absolute",
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#4B5563",
    zIndex: 2,
  },
  resolutionLever: {
    width: 23,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#4B5563",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  resolutionSignal: {
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: "#F9FAFB",
  },
  fireRim: { ...StyleSheet.absoluteFillObject },
  flame: {
    position: "absolute",
    width: 7,
    height: 11,
    borderTopLeftRadius: 7,
    borderBottomRightRadius: 7,
    backgroundColor: "#F97316",
    transform: [{ rotate: "45deg" }],
  },
  flameOne: { left: 4, top: -1 },
  flameTwo: { left: 15, top: -4, backgroundColor: "#DC2626" },
  flameThree: { right: 3, top: 0, backgroundColor: "#F59E0B" },
});
