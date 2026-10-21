import { describe, expect, it } from "vitest";
import { mapLink, metresBetween, nigerianWaId, zoneForAddress, zoneForPin, type Zone } from "./zones.js";

const zones: Zone[] = [
  { id: "z1", name: "Ikeja", areas: ["ikeja", "allen", "opebi"], circle: { lat: 6.6018, lng: 3.3515, radiusM: 4000 }, feeKobo: 200_000 },
  { id: "z2", name: "Lekki", areas: ["lekki"], circle: { lat: 6.4698, lng: 3.5852, radiusM: 6000 }, feeKobo: 400_000 },
  { id: "z3", name: "Lekki Phase 1", areas: ["lekki phase 1", "admiralty"], circle: { lat: 6.4478, lng: 3.4723, radiusM: 3000 }, feeKobo: 450_000 },
  { id: "z4", name: "Island (no map)", areas: ["ikoyi"], circle: null, feeKobo: 400_000 },
];

describe("delivery zones", () => {
  it("measures straight-line distance", () => {
    // Ikeja to Lekki Phase 1 is roughly 20 km.
    const d = metresBetween({ lat: 6.6018, lng: 3.3515 }, { lat: 6.4478, lng: 3.4723 });
    expect(d).toBeGreaterThan(19_000);
    expect(d).toBeLessThan(23_000);
  });

  it("puts a pin in the zone whose circle it falls in, nearest centre first", () => {
    expect(zoneForPin(zones, { lat: 6.605, lng: 3.355 })?.name).toBe("Ikeja");
    expect(zoneForPin(zones, { lat: 6.448, lng: 3.473 })?.name).toBe("Lekki Phase 1");
    expect(zoneForPin(zones, { lat: 7.3775, lng: 3.947 })).toBeNull(); // Ibadan
  });

  it("matches typed addresses by whole area names, longest first", () => {
    expect(zoneForAddress(zones, "12 Allen Avenue, Ikeja")?.name).toBe("Ikeja");
    expect(zoneForAddress(zones, "Plot 5, Admiralty Way, LEKKI PHASE 1")?.name).toBe("Lekki Phase 1");
    expect(zoneForAddress(zones, "Chevron Drive, Lekki")?.name).toBe("Lekki");
    expect(zoneForAddress(zones, "3 Bourdillon Road, Ikoyi")?.name).toBe("Island (no map)");
    expect(zoneForAddress(zones, "Gallery Road, Mallen Estate")).toBeNull();
  });

  it("reads Nigerian phone numbers in the ways people type them", () => {
    expect(nigerianWaId("0803 123 4567")).toBe("2348031234567");
    expect(nigerianWaId("+234 803 123 4567")).toBe("2348031234567");
    expect(nigerianWaId("8031234567")).toBe("2348031234567");
    expect(nigerianWaId("2348031234567")).toBe("2348031234567");
    expect(nigerianWaId("12345")).toBeNull();
  });

  it("links riders to Google Maps by pin or by address", () => {
    expect(mapLink({ lat: 6.6, lng: 3.35, address: "Ikeja" })).toBe("https://www.google.com/maps/search/?api=1&query=6.6%2C3.35");
    expect(mapLink({ lat: null, lng: null, address: "12 Allen Avenue, Ikeja" })).toBe(
      "https://www.google.com/maps/search/?api=1&query=12%20Allen%20Avenue%2C%20Ikeja",
    );
  });
});
