export const US_STATES = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["DC", "District of Columbia"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawaii"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Louisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Mississippi"],
  ["MO", "Missouri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "New Hampshire"],
  ["NJ", "New Jersey"],
  ["NM", "New Mexico"],
  ["NY", "New York"],
  ["NC", "North Carolina"],
  ["ND", "North Dakota"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregon"],
  ["PA", "Pennsylvania"],
  ["RI", "Rhode Island"],
  ["SC", "South Carolina"],
  ["SD", "South Dakota"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "West Virginia"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
] as const;

export type PropertyAddress = {
  street: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
  placeId: string | null;
  latitude: number | null;
  longitude: number | null;
  status: "unchecked" | "matched" | "manual";
};
export const emptyPropertyAddress = (): PropertyAddress => ({
  street: "",
  unit: "",
  city: "",
  state: "",
  zip: "",
  placeId: null,
  latitude: null,
  longitude: null,
  status: "unchecked",
});
export function readPropertyAddress(value: unknown): PropertyAddress {
  const result = emptyPropertyAddress();
  if (!value || typeof value !== "object") return result;
  const v = value as Record<string, unknown>;
  for (const key of ["street", "unit", "city", "state", "zip"] as const) {
    if (typeof v[key] === "string") result[key] = v[key];
  }
  if (v.status === "manual" || v.status === "matched") result.status = v.status;
  if (typeof v.placeId === "string") result.placeId = v.placeId;
  if (typeof v.latitude === "number" && Number.isFinite(v.latitude))
    result.latitude = v.latitude;
  if (typeof v.longitude === "number" && Number.isFinite(v.longitude))
    result.longitude = v.longitude;
  return result;
}
export function formatPropertyAddress(a: PropertyAddress) {
  return [
    a.street.trim(),
    a.unit.trim(),
    a.city.trim(),
    [a.state, a.zip.trim()].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
}
export function propertyAddressError(a: PropertyAddress): string | null {
  if (!a.street.trim()) return "Enter the street address.";
  if (!a.city.trim()) return "Enter the city.";
  if (!US_STATES.some(([code]) => code === a.state)) return "Choose a state.";
  if (!/^\d{5}(-\d{4})?$/.test(a.zip.trim()))
    return "Choose an address match to fill the ZIP Code, or enter a valid ZIP Code manually.";
  if (a.status === "unchecked")
    return "Confirm an address match, or choose “Use manually entered address”.";
  return null;
}
type Component = { longText?: string; shortText?: string; types?: string[] };
export type PlaceResult = {
  id?: string;
  addressComponents?: Component[];
  location?: { latitude?: number; longitude?: number };
};
// Only accept a complete US street address, never a city/ZIP centroid.
export function addressFromPlace(place: PlaceResult): PropertyAddress | null {
  const part = (type: string, short = false) => {
    const c = place.addressComponents?.find((c) => c.types?.includes(type));
    return (short ? c?.shortText : c?.longText) ?? "";
  };
  const number = part("street_number"),
    route = part("route");
  const city =
    part("locality") || part("postal_town") || part("sublocality_level_1");
  const state = part("administrative_area_level_1", true),
    zip = part("postal_code");
  if (
    !place.id ||
    !number ||
    !route ||
    !city ||
    part("country", true) !== "US" ||
    !/^\d{5}$/.test(zip) ||
    !US_STATES.some(([s]) => s === state)
  )
    return null;
  return {
    street: `${number} ${route}`,
    unit: "",
    city,
    state,
    zip,
    placeId: place.id,
    latitude: place.location?.latitude ?? null,
    longitude: place.location?.longitude ?? null,
    status: "matched",
  };
}
export async function findPropertyAddresses(
  a: PropertyAddress,
  apiKey: string | undefined,
  signal: AbortSignal,
): Promise<PropertyAddress[]> {
  if (!apiKey)
    throw new Error(
      "Address lookup is not configured. You can enter the ZIP Code and continue with an unchecked address.",
    );
  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.addressComponents,places.location",
      },
      body: JSON.stringify({
        textQuery: `${a.street.trim()}, ${a.city.trim()}, ${a.state}, USA`,
        regionCode: "US",
      }),
    },
  );
  if (!response.ok)
    throw new Error(
      "Address lookup is unavailable. Retry, or enter the ZIP Code and use the address manually.",
    );
  const data = (await response.json()) as { places?: PlaceResult[] };
  return (data.places ?? [])
    .map(addressFromPlace)
    .filter((a): a is PropertyAddress => a !== null)
    .slice(0, 5);
}
