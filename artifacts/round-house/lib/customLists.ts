import AsyncStorage from "@react-native-async-storage/async-storage";

// Lightweight on-device store for the Reminders page's Shopping List
// and user-created "New Lists" sections. These are personal scratch
// lists — no need to round-trip to the server for now.
//
// Schema versioning: bump SCHEMA_VERSION in the storage payload if
// the shape ever changes incompatibly so a stale cached blob is
// discarded gracefully rather than crashing the screen.

const SCHEMA_VERSION = 1;
const STORAGE_KEY = "reminders.customLists.v1";

export interface CustomListItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
}

export interface CustomList {
  id: string;
  name: string;
  /**
   * Shopping List is a built-in, always-present list. User-created
   * lists are also stored here as plain CustomList entries with
   * `kind: "user"`. The shopping list cannot be deleted.
   */
  kind: "shopping" | "user";
  items: CustomListItem[];
  createdAt: number;
}

interface StoredPayload {
  version: number;
  lists: CustomList[];
}

const SHOPPING_ID = "__shopping__";

function makeShoppingList(): CustomList {
  return {
    id: SHOPPING_ID,
    name: "Shopping List",
    kind: "shopping",
    items: [],
    createdAt: Date.now(),
  };
}

function ensureShopping(lists: CustomList[]): CustomList[] {
  if (lists.some((l) => l.kind === "shopping")) return lists;
  return [makeShoppingList(), ...lists];
}

export async function loadCustomLists(): Promise<CustomList[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [makeShoppingList()];
    const parsed = JSON.parse(raw) as StoredPayload;
    if (!parsed || parsed.version !== SCHEMA_VERSION || !Array.isArray(parsed.lists)) {
      return [makeShoppingList()];
    }
    return ensureShopping(parsed.lists);
  } catch {
    return [makeShoppingList()];
  }
}

export async function saveCustomLists(lists: CustomList[]): Promise<void> {
  const payload: StoredPayload = {
    version: SCHEMA_VERSION,
    lists: ensureShopping(lists),
  };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // best-effort persistence; transient storage errors are non-fatal
  }
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const SHOPPING_LIST_ID = SHOPPING_ID;
