// Works out which delivery zone an address is in, so the fee comes from the
// business's own table (quote_delivery_zones) and never from the AI.

export interface Zone {
  id: string;
  name: string;
  /** Lowercase area names that put a typed address in this zone. */
  areas: string[];
  /** A circle on the map that puts a pin in this zone. */
  circle: { lat: number; lng: number; radiusM: number } | null;
  feeKobo: number;
}

export interface Pin {
  lat: number;
  lng: number;
}

/** The zone a pin falls in. When circles overlap, the one whose centre is closest wins. */
export function zoneForPin(zones: Zone[], pin: Pin): Zone | null {
  let best: { zone: Zone; distance: number } | null = null;
  for (const zone of zones) {
    if (!zone.circle) continue;
    const distance = metresBetween(pin, zone.circle);
    if (distance <= zone.circle.radiusM && (!best || distance < best.distance)) best = { zone, distance };
  }
  return best?.zone ?? null;
}

/**
 * The zone a typed address names. The longest area name that appears wins,
 * so "Lekki Phase 1" beats "Lekki".
 */
export function zoneForAddress(zones: Zone[], address: string): Zone | null {
  const text = ` ${address.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  let best: { zone: Zone; length: number } | null = null;
  for (const zone of zones) {
    for (const area of zone.areas) {
      const name = area.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (name && text.includes(` ${name} `) && (!best || name.length > best.length)) best = { zone, length: name.length };
    }
  }
  return best?.zone ?? null;
}

/** Straight-line distance in metres. */
export function metresBetween(a: Pin, b: Pin): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** "0803 123 4567", "+234 803 123 4567" and "2348031234567" all give 2348031234567. Null if it isn't a phone number. */
export function nigerianWaId(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (/^0[789][01]\d{8}$/.test(digits)) return `234${digits.slice(1)}`;
  if (/^[789][01]\d{8}$/.test(digits)) return `234${digits}`;
  if (/^\d{8,15}$/.test(digits) && !digits.startsWith("0")) return digits;
  return null;
}

/** A Google Maps link riders can open, from a pin or a typed address. */
export function mapLink(place: { lat: number | null; lng: number | null; address: string | null }): string {
  const query = place.lat !== null && place.lng !== null ? `${place.lat},${place.lng}` : (place.address ?? "");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
