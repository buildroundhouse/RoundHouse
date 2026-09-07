import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs, Redirect, router, useSegments } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import { useAuth } from "@/lib/auth";
import { useProfile } from "@/lib/profile";
import { CaptureFAB } from "@/components/CaptureFAB";
import { LoadingScreen } from "@/components/LoadingScreen";
import { AdminQuickExit } from "@/components/admin/AdminQuickExit";

import { useColors } from "@/hooks/useColors";

type SfPair = { default: SFSymbol; selected: SFSymbol };
type TabSpec = { label: string; sf: SfPair; feather: keyof typeof Feather.glyphMap };

// Final five-slot toolbar: Timeline · Clients · [Camera] · My Team · Profile.
// The camera lives in the center as a raised circular FAB rendered by
// CaptureFAB outside the tab strip — the toolbar itself only declares the
// four navigable destinations. Invoices and Inbox were intentionally
// removed from the bar; Inbox is reachable from the Timeline header's mail icon.
const TABS: Record<
  "timeline" | "clients" | "myTeam" | "profile",
  TabSpec
> = {
  timeline: { label: "Timeline", sf: { default: "house",    selected: "house.fill" },    feather: "home" },
  clients:  { label: "Clients",  sf: { default: "person.2", selected: "person.2.fill" }, feather: "users" },
  myTeam:   { label: "My Team",  sf: { default: "person.3", selected: "person.3.fill" }, feather: "user-check" },
  profile:  { label: "Profile",  sf: { default: "person",   selected: "person.fill" },   feather: "user" },
};

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={TABS.timeline.sf} />
        <Label>{TABS.timeline.label}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="clients">
        <Icon sf={TABS.clients.sf} />
        <Label>{TABS.clients.label}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="my-team">
        <Icon sf={TABS.myTeam.sf} />
        <Label>{TABS.myTeam.label}</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf={TABS.profile.sf} />
        <Label>{TABS.profile.label}</Label>
      </NativeTabs.Trigger>
      {/* Logs is reachable from the Profile tab's center shortcut. We
          register it as a hidden trigger so the route stays inside the
          tabs navigator and the bottom bar keeps showing while the user
          is on /logs (no separate stack push that would cover it). */}
      <NativeTabs.Trigger name="logs" hidden>
        <Icon sf={TABS.logs.sf} />
        <Label>{TABS.logs.label}</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout({ isProfileActive }: { isProfileActive: boolean }) {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

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
      <Tabs.Screen name="index"   options={{ title: TABS.timeline.label, tabBarIcon: renderIcon(TABS.timeline) }} />
      <Tabs.Screen name="clients" options={{ title: TABS.clients.label, tabBarIcon: renderIcon(TABS.clients) }} />
      {/* Center slot. On the Profile tab this becomes a real "Logs"
          shortcut button (per the Task #456 design). On every other tab
          it stays an empty spacer so the floating Camera/pen FAB
          rendered above the bar can sit there without colliding with
          its neighbours. */}
      <Tabs.Screen
        name="camera"
        options={{
          title: "",
          tabBarButton: () =>
            isProfileActive ? (
              <Pressable
                onPress={() => router.push("/logs")}
                accessibilityRole="button"
                accessibilityLabel="Open Logs"
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "flex-start",
                  paddingTop: isIOS ? 6 : 8,
                  gap: isIOS ? 2 : 4,
                }}
              >
                {isIOS ? (
                  <SymbolView
                    name="doc.text"
                    tintColor={colors.mutedForeground}
                    size={24}
                  />
                ) : (
                  <Feather name="clipboard" size={22} color={colors.mutedForeground} />
                )}
                <Text
                  style={{
                    fontSize: 10,
                    color: colors.mutedForeground,
                    fontFamily: "Inter_500Medium",
                  }}
                >
                  Logs
                </Text>
              </Pressable>
            ) : (
              <View style={{ flex: 1 }} pointerEvents="none" />
            ),
        }}
      />
      <Tabs.Screen name="my-team" options={{ title: TABS.myTeam.label,  tabBarIcon: renderIcon(TABS.myTeam) }} />
      <Tabs.Screen name="profile" options={{ title: TABS.profile.label, tabBarIcon: renderIcon(TABS.profile) }} />
      {/* Hidden routes — still navigable via deep links and side tabs but
          intentionally absent from the bottom bar per the locked layout. */}
      <Tabs.Screen name="properties"    options={{ href: null }} />
      <Tabs.Screen name="invoices"      options={{ href: null }} />
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

  // Detect which tab is currently active so the center slot can swap
  // between a "Logs" shortcut (on Profile) and the floating Camera/pen
  // FAB (everywhere else). The CaptureFAB stays mounted so its modal
  // composers remain available, but its visible button is hidden on
  // Profile to make room for the new center button.
  const segments = useSegments();
  const isProfileActive = (segments as string[]).includes("profile");

  if (isLiquidGlassAvailable()) {
    return (
      <View style={{ flex: 1 }}>
        <NativeTabLayout />
        <CaptureFAB hideTrigger={isProfileActive} />
        <AdminQuickExit />
      </View>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <ClassicTabLayout isProfileActive={isProfileActive} />
      <CaptureFAB hideTrigger={isProfileActive} />
      <AdminQuickExit />
    </View>
  );
}
