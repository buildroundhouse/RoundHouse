import { Redirect, Stack, useSegments } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { useAuth } from "@/lib/auth";
import { useProfile } from "@/lib/profile";

export default function OnboardingLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  const { status } = useProfile();
  const segments = useSegments();
  // Existing users can add a space, and identity saves must finish navigation
  // without the layout bouncing them out when the server becomes ready.
  const setupScreen = segments[segments.length - 1];
  const onSetupScreen = [
    "mode-picker",
    "identity",
    "entry",
    "entry-entity",
    "entry-business",
    "entry-property-type",
    "entry-business-type",
    "entry-role",
    "entry-access",
    "intake",
  ].includes(setupScreen ?? "");

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
  if (status.kind === "ready" && !onSetupScreen) {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="identity" />
      <Stack.Screen name="entry" />
      <Stack.Screen name="entry-property-type" />
      <Stack.Screen name="entry-business-type" />
      <Stack.Screen name="entry-role" />
      <Stack.Screen name="entry-access" />
      <Stack.Screen name="entry-entity" />
      <Stack.Screen name="entry-business" />
      <Stack.Screen name="mode-picker" />
      <Stack.Screen name="intake" />
    </Stack>
  );
}
