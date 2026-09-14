import AsyncStorage from "@react-native-async-storage/async-storage";
import { customFetch } from "@workspace/api-client-react";

export type EntryProfile = {
  firstName: string;
  nickname: string;
  lastName: string;
  phone: string;
  photoUri: string;
};

const emptyProfile: EntryProfile = { firstName: "", nickname: "", lastName: "", phone: "", photoUri: "" };
const key = (uid: string) => `roundhouse:entry:profile:${uid}`;

export function displayName(profile: EntryProfile): string {
  return [profile.nickname.trim() || profile.firstName.trim(), profile.lastName.trim()].filter(Boolean).join(" ");
}

export function profileReady(profile: EntryProfile): boolean {
  return Boolean(profile.firstName.trim() && profile.lastName.trim() && profile.photoUri.trim());
}

export async function loadEntryProfile(uid: string): Promise<EntryProfile> {
  try {
    const raw = await AsyncStorage.getItem(key(uid));
    return raw ? { ...emptyProfile, ...JSON.parse(raw) } : { ...emptyProfile };
  } catch { return { ...emptyProfile }; }
}

export async function saveEntryProfile(uid: string, profile: EntryProfile): Promise<void> {
  const saved = {
    firstName: profile.firstName.trim(), nickname: profile.nickname.trim(), lastName: profile.lastName.trim(),
    phone: profile.phone.trim(), photoUri: profile.photoUri,
  };
  await customFetch("/api/users/me/entry-profile", {
    method: "PUT",
    body: JSON.stringify({ ...saved, avatarUrl: saved.photoUri, photoUri: undefined }),
  });
  // The server is authoritative; unavailable device storage cannot undo a save.
  await AsyncStorage.setItem(key(uid), JSON.stringify(saved)).catch(() => {});
}
