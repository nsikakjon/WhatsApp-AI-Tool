import { describe, expect, it } from "vitest";
import { looksLikePharmacy, prescriptionNames, prescriptionNote } from "./prescription.js";

describe("prescription medicines", () => {
  it("spots pharmacies, chemists and health shops", () => {
    expect(looksLikePharmacy("Grace Pharmacy", null)).toBe(true);
    expect(looksLikePharmacy("Mama Joy", "patent medicine store")).toBe(true);
    expect(looksLikePharmacy("Ade Chemists")).toBe(true);
    expect(looksLikePharmacy("Lekki Health Store")).toBe(true);
    expect(looksLikePharmacy("Mama Cakes", "cakes and pastries")).toBe(false);
    expect(looksLikePharmacy("Healthy Bites", "smoothies")).toBe(false);
  });

  it("flags names that look like prescription-only medicines", () => {
    expect(prescriptionNames(["Amoxil 500mg", "Paracetamol", "Augmentin 625", "Codeine syrup", "Vitamin C", "Amoxil 500mg"])).toEqual([
      "Amoxil 500mg",
      "Augmentin 625",
      "Codeine syrup",
    ]);
    expect(prescriptionNames(["Flyers", "Ceftriaxone injection"])).toEqual(["Ceftriaxone injection"]);
  });

  it("writes a note only when something is found", () => {
    expect(prescriptionNote(["Flyers", "Mugs"])).toBeNull();
    expect(prescriptionNote(["Ciprotab"])).toContain("These look like prescription medicines: Ciprotab.");
  });
});
