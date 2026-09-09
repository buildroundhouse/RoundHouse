import AsyncStorage from "@react-native-async-storage/async-storage";

export type EntryBusinessProfile = {
  businessName: string;
  businessType: string;
  phone: string;
  zip: string;
  streetAddress: string;
  website: string;
  instagram: string;
  employees: string;
  yearsInBusiness: string;
  specialties: string;
  logoUri: string;
  photoUri: string;
  photoSource: "uploaded" | "trade-fallback";
  updatedAt: string;
};

export const emptyEntryBusinessProfile = (businessName = ""): EntryBusinessProfile => ({
  businessName, businessType: "", phone: "", zip: "", streetAddress: "", website: "",
  instagram: "", employees: "", yearsInBusiness: "", specialties: "", logoUri: "", photoUri: "",
  photoSource: "trade-fallback", updatedAt: "",
});

const key = (uid: string) => `roundhouse:entry:business:${uid}`;

export async function loadEntryBusinessProfile(uid: string) {
  const raw = await AsyncStorage.getItem(key(uid));
  if (!raw) return null;
  try { return JSON.parse(raw) as EntryBusinessProfile; } catch { return null; }
}

export async function saveEntryBusinessProfile(uid: string, profile: EntryBusinessProfile) {
  const saved = { ...profile, photoSource: profile.photoUri ? "uploaded" as const : "trade-fallback" as const, updatedAt: new Date().toISOString() };
  await AsyncStorage.setItem(key(uid), JSON.stringify(saved));
  return saved;
}

export function businessProfileReady(profile: EntryBusinessProfile) {
  return !!profile.businessName.trim() && !!profile.phone.trim() && /^\d{5}$/.test(profile.zip.trim());
}

export type TradeVisual = { icon: "tool" | "zap" | "droplet" | "home" | "edit-3" | "layers" | "wind" | "sun" | "briefcase"; label: string };

export function tradeVisualFor(type: string): TradeVisual {
  const t = type.toLowerCase();
  if (t.includes("electric")) return { icon: "zap", label: "Electrical" };
  if (t.includes("plumb")) return { icon: "droplet", label: "Plumbing" };
  if (t.includes("land") || t.includes("lawn")) return { icon: "sun", label: "Landscaping" };
  if (t.includes("design") || t.includes("architect") || t.includes("decor")) return { icon: "edit-3", label: "Design" };
  if (t.includes("hvac")) return { icon: "wind", label: "HVAC" };
  if (t.includes("floor") || t.includes("tile")) return { icon: "layers", label: "Flooring & Tile" };
  if (t.includes("roof") || t.includes("window") || t.includes("door")) return { icon: "home", label: "Building Exterior" };
  if (t.includes("contract") || t.includes("remodel") || t.includes("restoration") || t.includes("carpenter") || t.includes("handyman")) return { icon: "tool", label: "Construction & Trades" };
  return { icon: "briefcase", label: type.trim() || "Business" };
}

export const BUSINESS_TYPES = [
  "Architect", "Carpenter", "Cleaning / Housekeeping", "Concrete Contractor", "Decorator",
  "Design-Build Contractor", "Designer", "Drywall Contractor", "Electrician", "Flooring Contractor",
  "General Contractor", "Handyman", "HVAC Contractor", "Interior Designer", "Landscaper", "Lawn Care",
  "Masonry Contractor", "Painter", "Plumber", "Property Maintenance", "Remodeling Contractor",
  "Restoration Contractor", "Roofer", "Tile Contractor", "Window / Door Contractor",
] as const;
