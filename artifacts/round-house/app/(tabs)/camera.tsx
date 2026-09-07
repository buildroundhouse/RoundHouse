import { Redirect } from "expo-router";

// This file exists only to reserve the center slot in the bottom tab bar
// for the floating Camera FAB. The route itself is never navigated to —
// the tab's `tabBarButton` is overridden in `_layout.tsx` to render an
// empty spacer View, which keeps Clients and My Team pushed away from the
// raised FAB so the bar reads as five evenly-spaced positions:
//   Timeline · Clients · [Camera FAB] · My Team · Profile
// In the unlikely event someone deep-links to this path, we bounce them
// back to Timeline so they never see a blank screen.
export default function CameraSlot() {
  return <Redirect href="/(tabs)" />;
}
