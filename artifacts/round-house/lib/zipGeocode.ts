const GOOGLE_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY;

export interface ZipCoords {
  lat: number;
  lng: number;
}

const cache = new Map<string, Promise<ZipCoords | null>>();

/**
 * Geocode a US ZIP code (with optional street address) to lat/lng using
 * the Google Geocoding API. Returns null if the API key is missing, the
 * ZIP is invalid, or geocoding fails. Results are cached in memory.
 *
 * Persisted on the trade pro's intake so the businesses map can pin
 * results without per-request geocoding round-trips.
 */
export async function geocodeZip(
  zip: string,
  streetAddress?: string,
): Promise<ZipCoords | null> {
  const cleanZip = (zip ?? "").trim();
  if (!/^\d{5}$/.test(cleanZip)) return null;
  if (!GOOGLE_KEY) return null;

  const street = (streetAddress ?? "").trim();
  const query = street
    ? `${street}, ${cleanZip}, USA`
    : `${cleanZip}, USA`;
  const cacheKey = query.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const promise = (async (): Promise<ZipCoords | null> => {
    try {
      const url =
        "https://maps.googleapis.com/maps/api/geocode/json" +
        `?address=${encodeURIComponent(query)}` +
        `&components=country:US|postal_code:${cleanZip}` +
        `&key=${GOOGLE_KEY}`;
      const res = await fetch(url);
      const json: unknown = await res.json();
      const loc = (
        json as {
          results?: { geometry?: { location?: { lat?: number; lng?: number } } }[];
        }
      )?.results?.[0]?.geometry?.location;
      if (loc && typeof loc.lat === "number" && typeof loc.lng === "number") {
        return { lat: loc.lat, lng: loc.lng };
      }
      return null;
    } catch {
      return null;
    }
  })();
  cache.set(cacheKey, promise);
  return promise;
}
