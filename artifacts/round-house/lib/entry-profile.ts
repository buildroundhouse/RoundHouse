import AsyncStorage from "@react-native-async-storage/async-storage";

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
  await AsyncStorage.setItem(key(uid), JSON.stringify({
    firstName: profile.firstName.trim(), nickname: profile.nickname.trim(), lastName: profile.lastName.trim(),
    phone: profile.phone.trim(), photoUri: profile.photoUri,
  }));
}
