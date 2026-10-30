// Meta bans selling prescription medicines on WhatsApp, and a number caught
// doing it can be blocked. Pharmacies and chemists are warned when they sign
// up, and price list items whose names look like prescription-only medicines
// are pointed out so the owner can take them off. It goes by names only, so it
// prompts the owner to check; it never blocks a save.

const PHARMACY = /\b(pharmac\w*|chemists?|drug ?stores?|patent medicines?|medicine (store|shop)s?|health ?care|health)\b/i;

// Common prescription-only medicines in Nigeria, by generic and brand name.
const PRESCRIPTION = new RegExp(
  "\\b(" +
    [
      "prescription", "antibiotics?", "injections?", "injectables?", "ampoules?",
      "amoxil", "amoxicillin", "amoxyl", "augmentin", "amoxiclav", "ampiclox", "ampicillin", "cloxacillin", "flucloxacillin",
      "ciprofloxacin", "ciprotab", "cipro", "levofloxacin", "ofloxacin", "metronidazole", "flagyl", "tinidazole",
      "azithromycin", "zithromax", "erythromycin", "clarithromycin", "doxycycline", "tetracycline",
      "cefuroxime", "zinnat", "ceftriaxone", "rocephin", "cefixime", "cephalexin", "gentamicin", "septrin", "co-?trimoxazole", "nitrofurantoin",
      "codeine", "tramadol", "pentazocine", "morphine", "pethidine", "ketamine",
      "diazepam", "valium", "lexotan", "bromazepam", "rohypnol", "clonazepam", "rivotril", "alprazolam", "xanax", "lorazepam", "phenobarbitone",
      "insulin", "metformin", "glibenclamide", "amlodipine", "lisinopril", "losartan", "nifedipine", "atorvastatin", "warfarin",
      "prednisolone", "dexamethasone", "misoprostol", "cytotec", "sildenafil", "viagra", "tadalafil", "cialis",
      "carbamazepine", "haloperidol", "chlorpromazine", "largactil",
    ].join("|") +
    ")\\b",
  "i",
);

export const PHARMACY_WARNING =
  "Important for pharmacies and chemists: Meta, who own WhatsApp, ban selling prescription medicines on WhatsApp and can block your number for it. " +
  "Keep prescription-only medicines off your price list, for example antibiotics like Amoxil, Augmentin or Ciprotab, codeine syrups, tramadol and sleeping tablets. " +
  "If a customer asks for one, ask them to bring their prescription to your shop.";

/** True when the business's name or what it sells sounds like a pharmacy, chemist or health shop. */
export function looksLikePharmacy(...texts: Array<string | null | undefined>): boolean {
  return texts.some((t) => t && PHARMACY.test(t));
}

/** The names that look like prescription-only medicines, each once. */
export function prescriptionNames(names: string[]): string[] {
  return [...new Set(names.filter((n) => PRESCRIPTION.test(n)))];
}

/** A short note asking the owner to take these items off, or null when there are none. */
export function prescriptionNote(names: string[]): string | null {
  const found = prescriptionNames(names);
  if (!found.length) return null;
  const shown = found.slice(0, 8).join(", ");
  const more = found.length > 8 ? ` and ${found.length - 8} more` : "";
  return `These look like prescription medicines: ${shown}${more}. Meta bans selling prescription medicines on WhatsApp and can block your number for it, so please take them off your price list.`;
}
