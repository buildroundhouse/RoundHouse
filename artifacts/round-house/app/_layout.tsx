import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { Stack, router } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  setActiveModeIdGetter,
  setActiveOutwardAccountIdGetter,
  setActiveOutwardAccountIdOverride,
  setAuthTokenGetter,
  setBaseUrl,
} from "@workspace/api-client-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { LoadingScreen } from "@/components/LoadingScreen";
import { PaywallSheet } from "@/components/PaywallSheet";
import { PushBanner } from "@/components/PushBanner";
import { maybeShowPaywallFromError } from "@/lib/paywallSheet";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ProfileProvider, useProfile } from "@/lib/profile";
import { PresetChipsProvider } from "@/lib/presetChips";
import { getApiBaseUrl } from "@/lib/apiBaseUrl";
import {
  clearPushTokenOnServer,
  getInitialPushDeepLink,
  startPushTokenAutoSync,
  subscribeToPushDeepLinks,
  subscribeToReminderActions,
  syncPushTokenWithServer,
  type PushDeepLink,
} from "@/lib/pushNotifications";
import { clearAllForegroundReminderBanners } from "@/lib/reminderNotifications";

setBaseUrl(getApiBaseUrl());

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: (err) => maybeShowPaywallFromError(err) }),
  mutationCache: new MutationCache({ onError: (err) => maybeShowPaywallFromError(err) }),
});

const NOTIFICATIONS_BADGE_KEY = ["/api/notifications"] as const;
const UNANSWERED_COUNT_KEY = ["/api/messages/unanswered-count"] as const;

queryClient.setMutationDefaults(["markNotificationRead"], {
  onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_BADGE_KEY }),
});
queryClient.setMutationDefaults(["markAllNotificationsRead"], {
  onSuccess: () => queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_BADGE_KEY }),
});

const invalidateSuccessStoryQueries = () => {
  queryClient.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey;
      if (!Array.isArray(k) || k.length === 0) return false;
      const first = k[0];
      return typeof first === "string" && first.startsWith("/api/users/");
    },
  });
};
queryClient.setMutationDefaults(["shareLogAsSuccessStory"], { onSuccess: invalidateSuccessStoryQueries });
queryClient.setMutationDefaults(["hideMyPropertyFromStory"], { onSuccess: invalidateSuccessStoryQueries });
queryClient.setMutationDefaults(["sendMessage"], {
  onSuccess: () => queryClient.invalidateQueries({ queryKey: UNANSWERED_COUNT_KEY }),
});
queryClient.setMutationDefaults(["switchActiveOutwardAccount"], {
  onSuccess: (_data, variables) => {
    const id = (variables as { id?: number } | undefined)?.id;
    if (typeof id === "number") setActiveOutwardAccountIdOverride(id);
  },
});
queryClient.setMutationDefaults(["switchActiveMode"], {
  onSuccess: () => setActiveOutwardAccountIdOverride(null),
});

function AuthTokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => setAuthTokenGetter(() => getToken()), [getToken]);
  return null;
}

function ActiveModeBridge() {
  const { activeMode } = useProfile();
  const ref = React.useRef<number | null>(activeMode?.id ?? null);
  React.useEffect(() => { ref.current = activeMode?.id ?? null; }, [activeMode?.id]);
  React.useEffect(() => {
    setActiveModeIdGetter(() => ref.current);
    return () => setActiveModeIdGetter(null);
  }, []);
  return null;
}

function ActiveOutwardAccountBridge() {
  const { activeOutwardAccountId } = useProfile();
  const ref = React.useRef<number | null>(activeOutwardAccountId);
  React.useEffect(() => {
    ref.current = activeOutwardAccountId;
    setActiveOutwardAccountIdOverride(null);
  }, [activeOutwardAccountId]);
  React.useEffect(() => {
    setActiveOutwardAccountIdGetter(() => ref.current);
    return () => {
      setActiveOutwardAccountIdGetter(null);
      setActiveOutwardAccountIdOverride(null);
    };
  }, []);
  return null;
}

export function navigateToPushTarget(link: PushDeepLink) {
  if (link.type === "reminder" || link.type === "question" || link.type === "company_notice") {
    router.push("/reminders"); return;
  }
  if (link.type === "team_up_request") { router.push("/invites"); return; }
  if (link.workOrderId) { router.push(`/work-order/${link.workOrderId}`); return; }
  const isReschedule = link.type === "due_date_request" || link.type === "due_date_request_accepted" || link.type === "due_date_request_declined";
  if (link.propertyId) {
    const params = new URLSearchParams();
    if (isReschedule && link.logId) { params.set("tab", "logs"); params.set("focusLogId", String(link.logId)); }
    else if (link.tab) params.set("tab", link.tab);
    if (link.standardId) params.set("focusStandardId", String(link.standardId));
    const qs = params.toString();
    router.push(`/property/${link.propertyId}${qs ? `?${qs}` : ""}`);
  }
}

function RootLayoutNav() {
  const { isSignedIn, isLoaded } = useAuth();
  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      const unsubSync = startPushTokenAutoSync();
      void syncPushTokenWithServer();
      const unsubDeepLink = subscribeToPushDeepLinks(navigateToPushTarget);
      const unsubReminderActions = subscribeToReminderActions();
      let cancelled = false;
      void getInitialPushDeepLink().then((link) => { if (!cancelled && link) navigateToPushTarget(link); });
      return () => {
        cancelled = true; unsubSync(); unsubDeepLink(); unsubReminderActions(); clearAllForegroundReminderBanners();
      };
    }
    void clearPushTokenOnServer();
    clearAllForegroundReminderBanners();
  }, [isLoaded, isSignedIn]);

  return (
    <>
      <Stack screenOptions={{ headerBackTitle: "Back" }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="property/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="my-jobs" options={{ headerShown: true }} />
        <Stack.Screen name="find" options={{ headerShown: false }} />
        <Stack.Screen name="invite/business/[token]" options={{ headerShown: false }} />
        <Stack.Screen name="invite/app/[token]" options={{ headerShown: false }} />
        <Stack.Screen name="people-i-invited" options={{ headerShown: true }} />
        <Stack.Screen name="inbox" options={{ headerShown: true, title: "Inbox" }} />
        <Stack.Screen name="inbox/[otherUserId]" options={{ headerShown: true }} />
        <Stack.Screen name="account" options={{ headerShown: false }} />
      </Stack>
      {isSignedIn ? <PushBanner onPress={navigateToPushTarget} /> : null}
      <PaywallSheet />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  useEffect(() => { if (fontsLoaded || fontError) SplashScreen.hideAsync(); }, [fontsLoaded, fontError]);
  if (!fontsLoaded && !fontError) return <LoadingScreen />;
  return (
    <AuthProvider>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <AuthTokenBridge />
            <ProfileProvider>
              <PresetChipsProvider>
                <ActiveModeBridge />
                <ActiveOutwardAccountBridge />
                <GestureHandlerRootView>
                  <KeyboardProvider><RootLayoutNav /></KeyboardProvider>
                </GestureHandlerRootView>
              </PresetChipsProvider>
            </ProfileProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </AuthProvider>
  );
}
