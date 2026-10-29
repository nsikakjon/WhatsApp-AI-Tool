import type { Lang } from "../../core/i18n.js";
import type { Reply } from "../../core/product.js";

// What the bot says to "hi" (a welcome and how ordering works, with buttons)
// and to "help" (the same for customers, the command list for the owner).
// Written in code, not by the AI, so it only offers what the business has
// switched on. "Menu", "price list", "rate card" and the like ask to see what
// the business sells: the product cards when they're on, else the welcome.

const GREETING =
  /^(hi+|hello+|hel+o|hey+|hiya|howdy|yo|good (morning|afternoon|evening|day)|morning|evening|how far|how are you|bonjour|bonsoir|salut|coucou|bjr|bsr|cc|allo|all[oô]|ça va|ca va)( (there|sir|ma|madam|boss|team|o|oh|all|monsieur|madame|à tous|a tous|l équipe))?$/;
const HELP = /^(help|start|options|commands|what can you do|aide|démarrer|commencer|que pouvez vous faire)$/;
const LIST =
  "(food |drinks? |bar |cocktail |lunch |dinner |breakfast |today s |todays |daily )?(menu|menus|specials|list)" +
  "|(price|product|drinks?|wine|cocktail|service|item)s? ?list|pricelist|prices|rates|rate ?card|tariffs?" +
  "|catalog(ue)?s?|products|services|flavou?rs|combos|packages|bill of fare|whats on the menu|what s on the menu" +
  "|what (do|can) (you|u|una) (sell|have|offer|make)|what (you|u) (sell|have|got)|whats available|what s available" +
  "|wetin (you|u|una) (get|dey sell|sell|dey)" +
  "|carte|la carte|liste des prix|liste de prix|vos prix|tarifs?|catalogue produits|vos produits|vos articles|qu est ce que vous vendez|que vendez vous";
const CATALOGUE = new RegExp(
  `^(abeg |please |pls |plz |kindly |svp |s il vous plaît |s il vous plait )?((can|may) (i|we) (see|have|get) |(send|show|share|give|drop|i want|i need|i d like)( me| us)? |(envoyez|montrez|donnez)( moi| nous)? |je (veux|voudrais) (voir )?|(puis je|pouvez vous m envoyer) )?` +
    `(your |ur |the |una |ya |a |la |le |les |votre |vos )?(${LIST})( please| pls| abeg| biko| svp| s il vous plaît| s il vous plait)?$`,
);

const PRODUCTS_SHOWN = 8;

export const QUOTE_CHOICE = "get a quote";
export const TEAM_CHOICE = "talk to someone";

/** "greeting" for a plain hi, "help", "catalogue" for menu or price list, null for anything else. */
export function welcomeAsk(text: string): "greeting" | "help" | "catalogue" | null {
  const plain = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (HELP.test(plain)) return "help";
  if (CATALOGUE.test(plain)) return "catalogue";
  return GREETING.test(plain) ? "greeting" : null;
}

export interface CustomerWelcome {
  /** The customer's language (default English). */
  lang?: Lang;
  businessName: string;
  customerName?: string;
  /** Price list item names, "Product: option". */
  items: Array<{ name: string; minQuantity: number }>;
  voiceNotes: boolean;
  delivery: boolean;
  invoices: boolean;
  /** "menu" shows product cards. */
  catalogue?: boolean;
  /** Someone gets told when the customer taps "Talk to someone". */
  team: boolean;
}

export function customerWelcome(w: CustomerWelcome): Reply {
  const products = [...new Set(w.items.map((i) => productName(i.name)))];
  const first = w.items[0];
  const firstName = w.customerName?.trim().split(/\s+/)[0];
  if (w.lang === "fr") return frenchWelcome(w, products, first, firstName);
  if (w.lang === "pcm") return pidginWelcome(w, products, first, firstName);
  const example = first ? `${Math.max(first.minQuantity, 10)} ${productName(first.name)}` : "what you need";
  const body = [
    `Hi${firstName ? ` ${firstName}` : ""}! Welcome to ${w.businessName}.`,
    ...(products.length ? [`We offer: ${products.slice(0, PRODUCTS_SHOWN).join(", ")}${products.length > PRODUCTS_SHOWN ? " and more" : ""}.`] : []),
    "",
    "How to order:",
    `1. Tell me what you need and how many, e.g. *${example}*${w.voiceNotes ? ". You can type it or send a voice note" : ""}.`,
    "2. I send you a quote with the total.",
    "3. Reply *YES* to order, or tell me what to change. *Cancel* drops the quote.",
    ...(w.delivery ? ["4. Tell me where to deliver, or say *pickup* to collect it."] : []),
    ...(w.invoices ? [`${w.delivery ? 5 : 4}. You get your invoice here.`] : []),
    "",
    w.catalogue ? "Send *menu* to see everything we sell, and *help* to see this again." : "Send *help* any time to see this again.",
  ].join("\n");
  return {
    text: "",
    buttons: {
      body,
      buttons: [{ id: QUOTE_CHOICE, title: "Get a quote" }, ...(w.team ? [{ id: TEAM_CHOICE, title: "Talk to someone" }] : [])],
    },
  };
}

function frenchWelcome(w: CustomerWelcome, products: string[], first: CustomerWelcome["items"][number] | undefined, firstName: string | undefined): Reply {
  const example = first ? `${Math.max(first.minQuantity, 10)} ${productName(first.name)}` : "ce qu'il vous faut";
  const body = [
    `Bonjour${firstName ? ` ${firstName}` : ""} ! Bienvenue chez ${w.businessName}.`,
    ...(products.length ? [`Nous proposons : ${products.slice(0, PRODUCTS_SHOWN).join(", ")}${products.length > PRODUCTS_SHOWN ? " et plus encore" : ""}.`] : []),
    "",
    "Pour commander :",
    `1. Dites-moi ce qu'il vous faut et en quelle quantité, par exemple *${example}*${w.voiceNotes ? ". Vous pouvez l'écrire ou envoyer un message vocal" : ""}.`,
    "2. Je vous envoie un devis avec le total.",
    "3. Répondez *OUI* pour commander, ou dites-moi ce qu'il faut changer. *Annuler* supprime le devis.",
    ...(w.delivery ? ["4. Dites-moi où livrer, ou répondez *retrait* pour venir le chercher."] : []),
    ...(w.invoices ? [`${w.delivery ? 5 : 4}. Vous recevez votre facture ici.`] : []),
    "",
    w.catalogue ? "Envoyez *menu* pour voir tout ce que nous vendons, et *aide* pour revoir ce message." : "Envoyez *aide* à tout moment pour revoir ce message.",
  ].join("\n");
  return {
    text: "",
    buttons: {
      body,
      buttons: [{ id: QUOTE_CHOICE, title: "Obtenir un devis" }, ...(w.team ? [{ id: TEAM_CHOICE, title: "Parler à quelqu'un" }] : [])],
    },
  };
}

function pidginWelcome(w: CustomerWelcome, products: string[], first: CustomerWelcome["items"][number] | undefined, firstName: string | undefined): Reply {
  const example = first ? `${Math.max(first.minQuantity, 10)} ${productName(first.name)}` : "wetin you need";
  const body = [
    `How far${firstName ? ` ${firstName}` : ""}! You don land ${w.businessName}.`,
    ...(products.length ? [`Wetin we get: ${products.slice(0, PRODUCTS_SHOWN).join(", ")}${products.length > PRODUCTS_SHOWN ? " and more" : ""}.`] : []),
    "",
    "How to order:",
    `1. Tell me wetin you need and how many, like *${example}*${w.voiceNotes ? ". You fit type am or send voice note" : ""}.`,
    "2. I go send you quote with the total.",
    "3. Reply *YES* to order, or tell me wetin to change. *Cancel* go drop the quote.",
    ...(w.delivery ? ["4. Tell me where we go deliver am, or talk *pickup* if you go come collect am."] : []),
    ...(w.invoices ? [`${w.delivery ? 5 : 4}. Your invoice go come here.`] : []),
    "",
    w.catalogue ? "Send *menu* to see everything we dey sell, and *help* to see this one again." : "Send *help* anytime to see this one again.",
  ].join("\n");
  return {
    text: "",
    buttons: {
      body,
      buttons: [{ id: QUOTE_CHOICE, title: "Get quote" }, ...(w.team ? [{ id: TEAM_CHOICE, title: "Talk to person" }] : [])],
    },
  };
}

export interface OwnerMenu {
  /** The business's language (default English). */
  lang?: Lang;
  orderPrefix: string;
  ordersLink: boolean;
  invoices: boolean;
  logo: boolean;
  catalogue: boolean;
  plan: boolean;
  referral: boolean;
  delivery: boolean;
  walkIn?: boolean;
}

export function ownerMenu(m: OwnerMenu): string {
  const order = `${m.orderPrefix}-1001`;
  // The commands themselves stay the same words in both languages.
  if (m.lang === "fr") {
    return [
      "Vos commandes de propriétaire :",
      ...(m.ordersLink ? ["• *orders* : votre tableau des commandes et des ventes"] : []),
      `• *paid ${order}* : marque une commande payée${m.invoices ? " et envoie le reçu au client" : ""}`,
      ...(m.invoices ? [`• *invoice ${order}* ou *receipt ${order}* : une copie pour vous`] : []),
      ...(m.logo ? ["• une image avec la légende *logo* : votre logo sur les factures et reçus"] : []),
      ...(m.catalogue ? ["• *stock* : ce qu'il reste de chaque article, et *stock 3 25* pour le changer", "• une photo avec la légende *photo T-shirts* : une photo de produit pour les devis"] : []),
      ...(m.delivery ? ["• *delivery* : livreurs et livraison"] : []),
      ...(m.walkIn ? ["• *walk-in* : commandes sur place, écrans de retrait et fermeture des commandes"] : []),
      ...(m.plan ? ["• *plan* : votre formule, l'utilisation du mois et les changements de formule"] : []),
      ...(m.referral ? ["• *referral* : votre code de parrainage"] : []),
      "• *app* : un lien pour ouvrir votre appli yarnOga",
      "",
      "Tout autre message, je le traite comme un client, pour que vous puissiez tester votre bot.",
    ].join("\n");
  }
  return [
    "Your owner commands:",
    ...(m.ordersLink ? ["• *orders*: your order board and sales"] : []),
    `• *paid ${order}*: marks an order paid${m.invoices ? " and sends the customer a receipt" : ""}`,
    ...(m.invoices ? [`• *invoice ${order}* or *receipt ${order}*: a copy for you`] : []),
    ...(m.logo ? ["• a picture captioned *logo*: your logo on invoices and receipts"] : []),
    ...(m.catalogue ? ["• *stock*: what's left of each item, and *stock 3 25* to set it", "• a photo captioned *photo T-shirts*: a product photo for quotes"] : []),
    ...(m.delivery ? ["• *delivery*: riders and delivery commands"] : []),
    ...(m.walkIn ? ["• *walk-in*: walk-in orders, pickup screens and closing orders"] : []),
    ...(m.plan ? ["• *plan*: your plan, this month's use and upgrades"] : []),
    ...(m.referral ? ["• *referral*: your referral code"] : []),
    "• *app*: a link to open your yarnOga app",
    "",
    "Anything else you send, I answer the way a customer would see it, so you can test your bot.",
  ].join("\n");
}

function productName(name: string): string {
  return name.split(":")[0]!.trim();
}
