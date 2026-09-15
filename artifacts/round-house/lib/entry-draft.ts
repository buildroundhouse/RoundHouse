import AsyncStorage from "@react-native-async-storage/async-storage";
import { readEntrySelection, type EntrySelection } from "./entry-intake";
const key = (uid: string, modeId: number) =>
  `roundhouse:entry:details:${uid}:${modeId}`;
export type EntryDraft = {
  selection: EntrySelection;
  data: Record<string, unknown>;
};
export async function saveEntryDraft(
  uid: string,
  modeId: number,
  draft: EntryDraft,
) {
  await AsyncStorage.setItem(key(uid, modeId), JSON.stringify(draft));
}
export async function loadEntryDraft(
  uid: string,
  modeId: number,
): Promise<EntryDraft | null> {
  const raw = await AsyncStorage.getItem(key(uid, modeId));
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw);
    const selection = readEntrySelection(draft.selection ?? {});
    return selection &&
      draft.data &&
      typeof draft.data === "object" &&
      !Array.isArray(draft.data)
      ? { selection, data: draft.data }
      : null;
  } catch {
    return null;
  }
}
export async function clearEntryDraft(uid: string, modeId: number) {
  await AsyncStorage.removeItem(key(uid, modeId));
}
