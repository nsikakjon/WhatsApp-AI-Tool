// Languages the bots speak. Each business (and flyer group) picks English or
// French for its fixed messages, documents and flyers. A customer who writes
// in another language gets answers in theirs when the AI (or the quick guess
// below) can tell. Nigerian Pidgin ("pcm") is only ever a chat language:
// invoices, receipts, flyers and messages to the owner stay in the business's
// own language.

export type Lang = "en" | "fr" | "pcm";
/** The languages a business or flyer group can choose. */
export const LANGS: Lang[] = ["en", "fr"];

/** True for a language a business or group can choose (not Pidgin, which follows the customer). */
export function isLang(value: unknown): value is Lang {
  return value === "en" || value === "fr";
}

/** The language for things that are written down: Pidgin chats get English documents and flyers. */
export function writtenLang(lang: Lang | undefined): "en" | "fr" {
  return lang === "fr" ? "fr" : "en";
}

// Common French words that rarely appear in English or Pidgin messages.
const FRENCH =
  /\b(bonjour|bonsoir|salut|merci|combien|voudrais|veux|voulez|pouvez|pourriez|svp|s'il vous pla[iî]t|s il vous pla[iî]t|je|j'|vous|nous|est-ce|c'est|qu'|quel|quelle|quels|oui|non merci|commande|commander|prix|livraison|tarifs?|pour|avec|aussi|aujourd'hui|demain|d'accord|annuler)\b/i;
const ENGLISH =
  /\b(hello|hi|hey|good (morning|afternoon|evening)|please|how much|i want|i need|price|order|deliver|thanks|thank you|yes|cancel)\b/i;
// Words and phrases that only show up when someone writes Pidgin. Short words
// like "na" or "go" are left out on their own: they're too common in English.
const PIDGIN =
  /\b(abeg|wetin|dey|una|wahala|oya|abi|sef|sha|shey|wey|dem|don (do|finish|reach|pay|send|come)|i wan|we wan|you wan|u wan|make i|make una|make you|how far|how much e be|how much (na|be) (am|e|this|that|di)|na (im|so|how|wetin|why)|e (don|dey|go|no)|i go (pay|take|come|buy|send)|no vex|no wahala|pikin|comot|chop|waka|ehn|biko|o jare|jare|wan buy|fit (send|do|deliver|bring)|i no (fit|get|sabi|know|wan)|sabi|kuku|nawa|abeg o)\b/i;

/**
 * A quick guess at the language of a short message, for replies made before
 * (or without) the AI, like the welcome. Null when it can't tell.
 */
export function guessLanguage(text: string | null | undefined): Lang | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (PIDGIN.test(t)) return "pcm";
  const fr = FRENCH.test(t) || /[àâçéèêëîïôûùüÿœ]/.test(t);
  const en = ENGLISH.test(t);
  if (fr && !en) return "fr";
  if (en && !fr) return "en";
  return null;
}

/** "fr" -> "French": for telling the AI which language to use. */
export function languageName(lang: Lang): string {
  return lang === "fr" ? "French" : lang === "pcm" ? "Nigerian Pidgin" : "English";
}
