import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "rh.pendingAppInviteToken";

let memoryToken: string | null = null;

export async function setPendingAppInviteToken(token: string): Promise<void> {
  memoryToken = token;
  try {
    await AsyncStorage.setItem(KEY, token);
  } catch {
    // Memory fallback is enough for the post-signup accept flow.
  }
}

export async function readPendingAppInviteToken(): Promise<string | null> {
  if (memoryToken) return memoryToken;
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored) memoryToken = stored;
    return stored;
  } catch {
    return null;
  }
}

export async function clearPendingAppInviteToken(): Promise<void> {
  memoryToken = null;
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
