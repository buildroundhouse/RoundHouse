import { Redirect } from "expo-router";
// Old links must enter the entity-first flow instead of reviving the avatar picker.
export default function ModePickerScreen() {
  return <Redirect href="/(onboarding)/entry" />;
}
