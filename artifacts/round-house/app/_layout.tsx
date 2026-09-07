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

const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) setBaseUrl(`https://${domain}`);

SplashScreen.preventAutoHideAsync();

// Surface a global paywall sheet whenever any query or mutation fails
// with the API's structured 402 response. Individual call sites can
// still handle the error themselves; this is only for the global UX.
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => {
      maybeShowPaywallFromError(err);
    },
  }),
  mutationCache: new MutationCache({
    onError: (err) => {
      maybeShowPaywallFromError(err);
    },
  }),
});

const NOTIFICATIONS_BADGE_KEY = ["/api/notifications"] as const;
const UNANSWERED_COUNT_KEY = ["/api/messages/unanswered-count"] as const;

queryClient.setMutationDefaults(["markNotificationRead"], {
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_BADGE_KEY });
  },
});
queryClient.setMutationDefaults(["markAllNotificationsRead"], {
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_BADGE_KEY });
  },
});

// Success-story share/hide changes the per-service counts on a pro's
// public profile and the focused stories list. Refresh both so the chip
// badge and the stacked timeline reflect the change without a full reload.
const invalidateSuccessStoryQueries = () => {
  queryClient.invalidateQueries({
    predicate: (q) => {
      const k = q.queryKey;
      if (!Array.isArray(k) || k.length === 0) return false;
      const first = k[0];
      if (typeof first !== "string") return false;
      // Public profile (`/api/users/:clerkId`) and stories
      // (`/api/users/:clerkId/success-stories`) both live under /api/users.
      return first.startsWith("/api/users/");
    },
  });
};
queryClient.setMutationDefaults(["shareLogAsSuccessStory"], {
  onSuccess: invalidateSuccessStoryQueries,
});
queryClient.setMutationDefaults(["hideMyPropertyFromStory"], {
  onSuccess: invalidateSuccessStoryQueries,
});
queryClient.setMutationDefaults(["sendMessage"], {
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: UNANSWERED_COUNT_KEY });
  },
});

// Whenever the user switches their active outward account — either
// explicitly via the switcher or implicitly when archiving the active
// row triggers a fallback hop — push the new id into the api-client
// override synchronously inside `onSuccess`. This guarantees the very
// next request (including the wave of refetches kicked off by
// `queryClient.invalidateQueries()`) already carries the new
// `x-active-outward-account-id` header, instead of waiting for the
// React tree to re-render the bridge with the refreshed profile.
queryClient.setMutationDefaults(["switchActiveOutwardAccount"], {
  onSuccess: (_data, variables) => {
    const id = (variables as { id?: number } | undefined)?.id;
    if (typeof id === "number") {
      setActiveOutwardAccountIdOverride(id);
    }
  },
});

// SECURITY-CRITICAL: a mode switch implicitly re-targets the active
// outward account on the server (the new mode's matching skin). The
// client must immediately drop any stale outward-account override so
// the wave of refetches kicked off by `queryClient.invalidateQueries()`
// no longer sends the OLD `x-active-outward-account-id` header — which
// would otherwise pin every request back onto the previous skin and
// leak the previous skin's properties/notes/contacts into the new one.
// The bridge will then re-set the override from the freshly-loaded
// profile within the same render pass.
queryClient.setMutationDefaults(["switchActiveMode"], {
  onSuccess: () => {
    setActiveOutwardAccountIdOverride(null);
  },
});

function AuthTokenBridge() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
  }, [getToken]);
  return null;
}

/**
 * Bridges the user's currently-active mode (account) into the API client so
 * every request carries an `x-active-mode-id` header.  The server uses this
 * header to partition account-private data so one account never sees rows
 * created under a different account.
 */
function ActiveModeBridge() {
  const { activeMode } = useProfile();
  const ref = React.useRef<number | null>(activeMode?.id ?? null);
  React.useEffect(() => {
    ref.current = activeMode?.id ?? null;
  }, [activeMode?.id]);
  React.useEffect(() => {
    setActiveModeIdGetter(() => ref.current);
    return () => {
      setActiveModeIdGetter(null);
    };
  }, []);
  return null;
}

/**
 * Bridges the user's currently-selected outward account into the API client
 * so every authenticated request carries an `x-active-outward-account-id`
 * header. The server's `withActiveOutwardAccount` middleware uses it to
 * resolve `req.activeOutwardAccountId`.
 */
function ActiveOutwardAccountBridge() {
  const { activeOutwardAccountId } = useProfile();
  const ref = React.useRef<number | null>(activeOutwardAccountId);
  React.useEffect(() => {
    ref.current = activeOutwardAccountId;
    // Once the profile catches up to the post-switch override (or the
    // user signs out and the id resets), drop the override so the
    // header source of truth returns to the React tree.
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
  if (
    link.type === "reminder" ||
    link.type === "question" ||
    link.type === "company_notice"
  ) {
    router.push("/reminders");
    return;
  }
  // Team-up request taps land on the /invites screen, which is the
  // surface that renders TeamUpRow with Accept / Decline / Ignore.
  if (link.type === "team_up_request") {
    router.push("/invites");
    return;
  }
  if (link.workOrderId) {
    router.push(`/work-order/${link.workOrderId}`);
    return;
  }
  const isReschedule =
    link.type === "due_date_request" ||
    link.type === "due_date_request_accepted" ||
    link.type === "due_date_request_declined";
  if (link.propertyId) {
    const params = new URLSearchParams();
    if (isReschedule && link.logId) {
      params.set("tab", "logs");
      params.set("focusLogId", String(link.logId));
    } else if (link.tab) {
      params.set("tab", link.tab);
    }
    if (link.standardId) {
      params.set("focusStandardId", String(link.standardId));
    }
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
      // Action-button taps on reminder pushes (e.g. "Snooze 1h" / "Done")
      // PATCH the reminder server-side without ever opening the app.
      const unsubReminderActions = subscribeToReminderActions();
      let cancelled = false;
      void getInitialPushDeepLink().then((link) => {
        if (!cancelled && link) navigateToPushTarget(link);
      });
      return () => {
        cancelled = true;
        unsubSync();
        unsubDeepLink();
        unsubReminderActions();
        // Drop any pending foreground reminder banner timers tied to the
        // signed-in session so a sign-out doesn't fire a banner for the
        // departed user.
        clearAllForegroundReminderBanners();
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
        {/*
          The /account/* tree owns its own internal Stack (see
          app/account/_layout.tsx) which already manages headers per
          screen. Without registering `account` here, the root stack
          renders its own default header above every account screen
          showing the lowercase route segment "account" — that was the
          persistent white "account" bar above the wardrobe / admin
          lobby that the user kept flagging. Hide it at the parent so
          only the inner stack's per-screen header (or none) shows.
        */}
        <Stack.Screen name="account" options={{ headerShown: false }} />
      </Stack>
      {isSignedIn ? <PushBanner onPress={navigateToPushTarget} /> : null}
      <PaywallSheet />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

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
                  <KeyboardProvider>
                    <RootLayoutNav />
                  </KeyboardProvider>
                </GestureHandlerRootView>
              </PresetChipsProvider>
            </ProfileProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </AuthProvider>
  );
}
