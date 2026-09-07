import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { useProfile } from "@/lib/profile";
import { LoadingScreen } from "@/components/LoadingScreen";

export default function Index() {
  const { isSignedIn, isLoaded } = useAuth();
  const { status, profile } = useProfile();

  if (!isLoaded || (isSignedIn && status.kind === "loading")) {
    return <LoadingScreen />;
  }

  if (!isSignedIn) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  if (status.kind === "needs-identity") {
    return <Redirect href="/(onboarding)/identity" />;
  }
  if (status.kind === "needs-mode-picker") {
    return <Redirect href="/(onboarding)/mode-picker" />;
  }
  if (status.kind === "needs-intake") {
    return <Redirect href="/(onboarding)/intake" />;
  }
  if (status.kind === "admin-empty") {
    return <Redirect href="/account/admin" />;
  }

  // Admins always land in the Admin Hub on boot/sign-in, even when they
  // have an active avatar. They can still walk into the avatar
  // explicitly from the Wardrobe; the floating "Hub" chip in the tabs
  // gives them a one-tap exit.
  if (profile?.isAdmin) {
    return <Redirect href="/account/admin" />;
  }

  return <Redirect href="/(tabs)" />;
}
