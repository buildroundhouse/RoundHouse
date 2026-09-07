import { Redirect, Stack, useSegments } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/lib/auth";
import { useProfile } from "@/lib/profile";

export default function OnboardingLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const { status } = useProfile();
  const segments = useSegments();
  // The mode-picker is also reachable from the profile "Add another mode" entry,
  // so allow ready users to stay on it. All other onboarding screens are bounce-back.
  const onPicker = segments[segments.length - 1] === "mode-picker";

  if (isLoaded && !isSignedIn) {
    return <Redirect href="/(auth)/sign-in" />;
  }
  if (status.kind === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (status.kind === "ready" && !onPicker) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="identity" />
      <Stack.Screen name="mode-picker" />
      <Stack.Screen name="intake" />
    </Stack>
  );
}
