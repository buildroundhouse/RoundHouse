import AsyncStorage from "@react-native-async-storage/async-storage";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth } from "./firebase";

const KEY_ADMIN_RETURN = "wearing_admin_return_email";
const KEY_WEARING_NAME = "wearing_demo_display_name";

export async function rememberAdminForReturn(adminEmail: string | null): Promise<void> {
  if (!adminEmail) return;
  await AsyncStorage.setItem(KEY_ADMIN_RETURN, adminEmail);
}

export async function getAdminReturnEmail(): Promise<string | null> {
  return AsyncStorage.getItem(KEY_ADMIN_RETURN);
}

export async function clearWearingState(): Promise<void> {
  await AsyncStorage.multiRemove([KEY_ADMIN_RETURN, KEY_WEARING_NAME]);
}

export async function getWearingDisplayName(): Promise<string | null> {
  return AsyncStorage.getItem(KEY_WEARING_NAME);
}

export async function setWearingDisplayName(name: string): Promise<void> {
  await AsyncStorage.setItem(KEY_WEARING_NAME, name);
}

/**
 * Sign the admin out of their account and into the demo user's account.
 * The admin's email is remembered locally so the sign-in screen can
 * pre-fill it when the admin taps "Back to admin" on the floating chip.
 *
 * Caller is responsible for ensuring the current user is an admin and
 * for routing to the timeline / index after this resolves.
 */
export async function wearSkin(args: {
  adminEmail: string;
  demoEmail: string;
  demoPassword: string;
  demoDisplayName: string;
}): Promise<void> {
  if (!auth) throw new Error("Firebase auth not configured");
  await rememberAdminForReturn(args.adminEmail);
  await setWearingDisplayName(args.demoDisplayName);
  await signOut(auth);
  await signInWithEmailAndPassword(auth, args.demoEmail, args.demoPassword);
}

/**
 * Sign out of whatever demo the admin is currently wearing. Returns the
 * stored admin email so the caller can pass it to the sign-in screen
 * for prefill. Clears the local "wearing" markers either way.
 */
export async function returnToAdmin(): Promise<{ adminEmail: string | null }> {
  const adminEmail = await getAdminReturnEmail();
  if (auth) {
    try {
      await signOut(auth);
    } catch {
      // ignore — sign-out failures shouldn't block the return flow
    }
  }
  await clearWearingState();
  return { adminEmail };
}
