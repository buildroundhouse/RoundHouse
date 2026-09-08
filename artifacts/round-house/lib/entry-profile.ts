import AsyncStorage from "@react-native-async-storage/async-storage";

export type EntryPersonalProfile = {
  firstName: string;
  nickname: string;
  lastName: string;
  phone: string;
  photoUri: string;
  completedAt: string | null;
};

const EMPTY_PROFILE: EntryPersonalProfile = {
  firstName: "",
  nickname: "",
  lastName: "",
  phone: "",
  photoUri: "",
  completedAt: null,
};

function storageKey(userId: string): string {
  return `roundhouse:entry:personal-profile:${userId}`;
}

export function displayNameForEntryProfile(profile: Pick<EntryPersonalProfile, "firstName" | "nickname" | "lastName">): string {
  const given = profile.nickname.trim() || profile.firstName.trim();
  return [given, profile.lastName.trim()].filter(Boolean).join(" ");
}

export function isEntryPersonalProfileComplete(profile: EntryPersonalProfile): boolean {
  return Boolean(
    profile.firstName.trim() &&
      profile.lastName.trim() &&
      profile.photoUri.trim(),
  );
}

export async function readEntryPersonalProfile(userId: string): Promise<EntryPersonalProfile> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return { ...EMPTY_PROFILE };
    const parsed = JSON.parse(raw) as Partial<EntryPersonalProfile>;
    return {
      firstName: typeof parsed.firstName === "string" ? parsed.firstName : "",
      nickname: typeof parsed.nickname === "string" ? parsed.nickname : "",
      lastName: typeof parsed.lastName === "string" ? parsed.lastName : "",
      phone: typeof parsed.phone === "string" ? parsed.phone : "",
      photoUri: typeof parsed.photoUri === "string" ? parsed.photoUri : "",
      completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : null,
    };
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

export async function saveEntryPersonalProfile(
  userId: string,
  profile: Omit<EntryPersonalProfile, "completedAt">,
): Promise<EntryPersonalProfile> {
  const next: EntryPersonalProfile = {
    ...profile,
    firstName: profile.firstName.trim(),
    nickname: profile.nickname.trim(),
    lastName: profile.lastName.trim(),
    phone: profile.phone.trim(),
    photoUri: profile.photoUri.trim(),
    completedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
  return next;
}
