import { Stack } from "expo-router";

export default function AccountLayout() {
  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="index" options={{ title: "Accounts" }} />
      <Stack.Screen
        name="admin"
        options={{
          // Admin lobby owns its own theatrical header (the brass
          // "ADMIN" marquee). The default white route bar would
          // crash that visual and surface a tiny inactive label,
          // which the user has flagged as broken — hide it here at
          // the layout level so the in-screen <Stack.Screen> isn't
          // the only thing fighting the default.
          headerShown: false,
        }}
      />
      <Stack.Screen
        name="personal"
        options={{
          // Header bar is hidden — the personal screen renders its
          // own in-page primary "Done — back to home" exit button so
          // the redundant white route header (with the small/broken
          // "Admin Hub" link) is unwanted noise. Setting it here in
          // the layout (instead of via <Stack.Screen> inside the
          // screen body) is the only setting that reliably wins
          // against the layout's title.
          headerShown: false,
          title: "Personal profile",
        }}
      />
      <Stack.Screen
        name="wardrobe"
        options={{
          // Wardrobe owns its own theatrical "Avatar Wardrobe" header
          // marquee; the default white "account" route bar above it is
          // unwanted noise and the user has flagged it as broken. Same
          // pattern as `admin` and `personal` — must be set at the
          // layout level (not just inside the screen) to reliably win
          // against the default title.
          headerShown: false,
        }}
      />
      <Stack.Screen name="create" options={{ title: "New outward account" }} />
      <Stack.Screen name="edit/[id]" options={{ title: "Edit account" }} />
    </Stack>
  );
}
