// Languages the bots speak. Each business (and flyer group) has a language
// for its fixed messages; a customer who writes in the other language gets
// answers in theirs when the AI (or the quick guess below) can tell.

export type Lang = "en" | "fr";
export const LANGS: Lang[] = ["en", "fr"];

export function isLang(value: unknown): value is Lang {
  return value === "en" || value === "fr";
}

// Common French words that rarely appear in English or Pidgin messages.
const FRENCH =
  /\b(bonjour|bonsoir|salut|merci|combien|voudrais|veux|voulez|pouvez|pourriez|svp|s'il vous pla[iî]t|s il vous pla[iî]t|je|j'|vous|nous|est-ce|c'est|qu'|quel|quelle|quels|oui|non merci|commande|commander|prix|livraison|tarifs?|pour|avec|aussi|aujourd'hui|demain|d'accord|annuler)\b/i;
const ENGLISH =
  /\b(hello|hi|hey|good (morning|afternoon|evening)|please|how much|i want|i need|price|order|deliver|thanks|thank you|yes|cancel|abeg|wetin|dey|how far)\b/i;

/**
 * A quick guess at the language of a short message, for replies made before
 * (or without) the AI, like the welcome. Null when it can't tell.
 */
export function guessLanguage(text: string | null | undefined): Lang | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const fr = FRENCH.test(t) || /[àâçéèêëîïôûùüÿœ]/.test(t);
  const en = ENGLISH.test(t);
  if (fr && !en) return "fr";
  if (en && !fr) return "en";
  return null;
}

/** "fr" -> "French": for telling the AI which language to use. */
export function languageName(lang: Lang): string {
  return lang === "fr" ? "French" : "English";
}
