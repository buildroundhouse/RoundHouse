import { ResolutionToggleArtwork, resolutionAppearance } from "@/components/ResolutionToggleArtwork";
import { BlurView } from "expo-blur";
import { Tabs, Redirect } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import { useAuth } from "@/lib/auth";
import { useProfile } from "@/lib/profile";
import { SetupRetry } from "@/components/SetupRetry";
import { CaptureFAB } from "@/components/CaptureFAB";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AdminQuickExit } from "@/components/admin/AdminQuickExit";
import { useResolutions } from "@/lib/useResolutions";
import { resolutionSignalForItems } from "@/lib/resolutions";
import {
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
  const status = signal.responsibility === "you" ? "attention" : signal.responsibility === "them" ? "waiting" : "resolved";
  return <ResolutionToggleArtwork width={54} appearance={resolutionAppearance(status, Math.max(0, signal.unansweredPrompts - 1))} />;
}

function CommandCenterTabs() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";
  const { userId } = useAuth();

  const resolutionsQuery = useResolutions();
  const resolutionSignal = useMemo(
    () => resolutionSignalForItems(resolutionsQuery.data?.resolutions ?? []),
    [resolutionsQuery.data?.resolutions],
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
  const { status, activeOutwardAccountId } = useProfile();
  if (!isLoaded) return <LoadingScreen />;
  if (!isSignedIn) return <Redirect href="/(auth)/sign-in" />;
  if (status.kind === "loading") return <LoadingScreen />;
  if (status.kind === "error") return <SetupRetry onRetry={status.retry} />;
  if (status.kind === "needs-identity") return <Redirect href="/(onboarding)/identity" />;
  if (status.kind === "needs-mode-picker") return <Redirect href="/(onboarding)/entry" />;
  if (status.kind === "needs-intake") return <Redirect href="/(onboarding)/entry" />;
  if (status.kind === "admin-empty") return <Redirect href="/account/admin" />;

  return (
    <View style={{ flex: 1 }}>
      <CommandCenterTabs />
      <CaptureFAB key={activeOutwardAccountId} />
      <AdminQuickExit />
    </View>
  );
}
