import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "rh.pendingBusinessInviteToken";

let memoryToken: string | null = null;

export async function setPendingBusinessInviteToken(token: string): Promise<void> {
  memoryToken = token;
  try {
    await AsyncStorage.setItem(KEY, token);
  } catch {
    // Memory fallback is enough for the redirect-after-auth flow.
  }
}

export async function readPendingBusinessInviteToken(): Promise<string | null> {
  if (memoryToken) return memoryToken;
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored) memoryToken = stored;
    return stored;
  } catch {
    return null;
  }
}

export async function clearPendingBusinessInviteToken(): Promise<void> {
  memoryToken = null;
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
