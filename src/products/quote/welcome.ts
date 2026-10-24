import type { Reply } from "../../core/product.js";

// What the bot says to "hi" (a welcome and how ordering works, with buttons)
// and to "help" (the same for customers, the command list for the owner).
// Written in code, not by the AI, so it only offers what the business has
// switched on. "Menu", "price list", "rate card" and the like ask to see what
// the business sells: the product cards when they're on, else the welcome.

const GREETING =
  /^(hi+|hello+|hel+o|hey+|hiya|howdy|yo|good (morning|afternoon|evening|day)|morning|evening|how far|how are you)( (there|sir|ma|madam|boss|team|o|oh|all))?$/;
const HELP = /^(help|start|options|commands|what can you do)$/;
const LIST =
  "(food |drinks? |bar |cocktail |lunch |dinner |breakfast |today s |todays |daily )?(menu|menus|specials|list)" +
  "|(price|product|drinks?|wine|cocktail|service|item)s? ?list|pricelist|prices|rates|rate ?card|tariffs?" +
  "|catalog(ue)?s?|products|services|flavou?rs|combos|packages|bill of fare|whats on the menu|what s on the menu" +
  "|what (do|can) (you|u|una) (sell|have|offer|make)|what (you|u) (sell|have|got)|whats available|what s available" +
  "|wetin (you|u|una) (get|dey sell|sell|dey)";
const CATALOGUE = new RegExp(
  `^(abeg |please |pls |plz |kindly )?((can|may) (i|we) (see|have|get) |(send|show|share|give|drop|i want|i need|i d like)( me| us)? )?` +
    `(your |ur |the |una |ya |a )?(${LIST})( please| pls| abeg| biko)?$`,
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
  const example = first ? `${Math.max(first.minQuantity, 10)} ${productName(first.name)}` : "what you need";
  const firstName = w.customerName?.trim().split(/\s+/)[0];
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

export interface OwnerMenu {
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
    "",
    "Anything else you send, I answer the way a customer would see it, so you can test your bot.",
  ].join("\n");
}

function productName(name: string): string {
  return name.split(":")[0]!.trim();
}
