export interface PropertyShareInfo {
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export function hasMapPin(p: PropertyShareInfo): boolean {
  return (
    typeof p.latitude === "number" &&
    Number.isFinite(p.latitude) &&
    typeof p.longitude === "number" &&
    Number.isFinite(p.longitude)
  );
}

export function buildPropertyMapUrl(p: PropertyShareInfo): string | null {
  if (!hasMapPin(p)) return null;
  const address = p.address?.trim();
  const q = address && address.length > 0 ? address : `${p.latitude},${p.longitude}`;
  return (
    "https://www.google.com/maps/search/?api=1" +
    `&query=${encodeURIComponent(q)}` +
    `&ll=${p.latitude},${p.longitude}`
  );
}

export interface PropertySharePayload {
  message: string;
  title: string;
  url?: string;
}

export function buildPropertyShareMessage(p: PropertyShareInfo): PropertySharePayload {
  const lines: string[] = [];
  lines.push(p.name);
  const address = p.address?.trim();
  if (address) lines.push(address);
  const mapUrl = buildPropertyMapUrl(p);
  if (mapUrl) {
    lines.push(`📍 Mapped pin: ${mapUrl}`);
  } else if (address) {
    lines.push("📍 Address only (no map pin dropped)");
  }
  return {
    title: p.name,
    message: lines.join("\n"),
    ...(mapUrl ? { url: mapUrl } : {}),
  };
}
