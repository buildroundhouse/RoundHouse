import React, { useEffect, useState } from "react";
import { Redirect, Stack } from "expo-router";
import { useAuth } from "@/lib/auth";
import { readPendingBusinessInviteToken } from "@/lib/pendingBusinessInvite";
import { readPendingAppInviteToken } from "@/lib/pendingAppInvite";

type Resolved = {
  business: string | null;
  app: string | null;
};

export default function AuthLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const [resolved, setResolved] = useState<Resolved | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!(isLoaded && isSignedIn)) return;
    void Promise.all([
      readPendingBusinessInviteToken(),
      readPendingAppInviteToken(),
    ]).then(([business, app]) => {
      if (!cancelled) setResolved({ business, app });
    });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

  if (isLoaded && isSignedIn) {
    if (resolved === undefined) return null;
    // Business invite landing handles the auto-accept itself, so it takes
    // priority. App invites are accepted later (after intake completion) so we
    // can drop the user straight into the app and let intake do the work.
    if (resolved.business) {
      return <Redirect href={`/invite/business/${resolved.business}` as never} />;
    }
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
    </Stack>
  );
}
