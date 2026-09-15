import { Router } from "express";

const router = Router();
const states = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));

// Census supports street + city + state without requiring a ZIP or API key.
// Proxy it here because the provider does not support browser CORS requests.
// https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
router.post("/address-lookup", async (req, res) => {
  const street = typeof req.body?.street === "string" ? req.body.street.trim() : "";
  const city = typeof req.body?.city === "string" ? req.body.city.trim() : "";
  const state = typeof req.body?.state === "string" ? req.body.state.toUpperCase().trim() : "";
  if (!/^\d+[\w-]*\s+\S/.test(street) || street.length > 160 || !city || city.length > 100 || !states.has(state)) {
    res.status(400).json({ error: "Enter a street number, street name, city and state." });
    return;
  }
  const params = new URLSearchParams({ street, city, state, benchmark: "Public_AR_Current", format: "json" });
  try {
    const response = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/address?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("lookup unavailable");
    const body = await response.json() as { result?: { addressMatches?: Array<{
      matchedAddress?: string;
      addressComponents?: { zip?: string; city?: string; state?: string };
      tigerLine?: { tigerLineId?: string; side?: string };
      coordinates?: { x?: number; y?: number };
    }> } };
    const matches = (body.result?.addressMatches ?? []).slice(0, 5).flatMap((match) => {
      const parts = match.addressComponents;
      const matchedStreet = typeof match.matchedAddress === "string" ? match.matchedAddress.split(",")[0].trim() : "";
      if (!parts || !/^\d{5}$/.test(parts.zip ?? "") || parts.state !== state || !parts.city ||
          !matchedStreet || matchedStreet.split(/\s/)[0] !== street.split(/\s/)[0]) return [];
      return [{ street: matchedStreet, unit: "", city: parts.city, state: parts.state, zip: parts.zip,
        placeId: `census:${match.tigerLine?.tigerLineId ?? matchedStreet}:${match.tigerLine?.side ?? ""}`,
        latitude: Number.isFinite(match.coordinates?.y) ? match.coordinates?.y : null,
        longitude: Number.isFinite(match.coordinates?.x) ? match.coordinates?.x : null,
        status: "matched" }];
    });
    res.setHeader("Cache-Control", "no-store");
    res.json({ matches });
  } catch {
    res.status(503).json({ error: "Address lookup is temporarily unavailable. You can enter your ZIP Code and continue." });
  }
});

export default router;
