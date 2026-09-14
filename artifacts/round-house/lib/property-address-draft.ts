import AsyncStorage from "@react-native-async-storage/async-storage";
import { readPropertyAddress, type PropertyAddress } from "./property-address";
const key = (uid: string, modeId: number) =>
  `roundhouse:entry:property-address:${uid}:${modeId}`;
export async function savePropertyAddressDraft(
  uid: string,
  modeId: number,
  address: PropertyAddress,
) {
  await AsyncStorage.setItem(key(uid, modeId), JSON.stringify(address));
}
export async function loadPropertyAddressDraft(uid: string, modeId: number) {
  const raw = await AsyncStorage.getItem(key(uid, modeId));
  if (!raw) return null;
  try {
    return readPropertyAddress(JSON.parse(raw));
  } catch {
    return null;
  }
}
export async function clearPropertyAddressDraft(uid: string, modeId: number) {
  await AsyncStorage.removeItem(key(uid, modeId));
}
