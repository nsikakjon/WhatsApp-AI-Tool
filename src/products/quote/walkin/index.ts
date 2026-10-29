import { guessLanguage } from "../../../core/i18n.js";
import { randomInt } from "node:crypto";
import type { Reply } from "../../../core/product.js";
import type { IncomingMessage } from "../../../core/whatsapp/types.js";
import type { Pickup } from "../documents.js";
import type { PlanFeatures } from "../features.js";
import type { QuoteLine } from "../pricing.js";
import type { SavedOrder } from "../store.js";
import { ALL_STATIONS, type WalkInLinks } from "./links.js";
import { itemsText, type WalkInStore } from "./store.js";

// Walk-in orders (QUOTE_WALK_IN, migration 0047) for restaurants, bars and
// events, on the plans that include walk_in. The owner sends "walk-in on".
//
// 1. A customer at the venue messages the bot. A poster's QR code opens the
//    chat with "I'm here" (or a table card's with "Table 7") already typed,
//    which checks them in for the next 12 hours.
// 2. They order as usual, but the bot doesn't ask about delivery. On YES
//    the order gets a 4-digit pickup code.
//
// A business that also delivers keeps delivering: only checked-in chats are
// walk-in, so customers at home carry on as before, and "close orders" only
// stops orders at the venue. A business with no delivery treats every chat
// as walk-in. Each branch has its own number and its own walk-in switch, so
// an event at one branch doesn't touch the others.
// 3. Once paid (pay link, or staff tap "Paid at counter"), each screen that
//    makes part of it gets a ticket: drinks to the Bar, food to the Kitchen.
//    The receipt carries a QR code and the code to type instead.
// 4. Staff tap Ready (the customer gets a message), then scan the QR code
//    when the customer collects. Each ticket can be handed over once.
//
// Owner commands: walk-in on/off, close orders / open orders, stations,
// station 3 Bar, screens.

/** Products with no screen of their own go to this one. */
export const COUNTER = "Counter";
/** A check-in or table label from a customer only counts for this long. */
const SPOT_HOURS = 12;
/** Saved for a customer who checked in without a table. */
const ON_SITE = "On site";

export interface WalkInMode {
  on: boolean;
  paused: boolean;
}

export interface WalkIn {
  /** Whether walk-in orders are on for this business and its plan, and whether new orders are paused. */
  mode(): Promise<WalkInMode>;
  ownerCommand(msg: IncomingMessage): Promise<Reply | null>;
  /** A customer checking in ("I'm here", "Table 7"); null for anything else. Only call while walk-in is on. */
  customerMessage(msg: IncomingMessage, contactId: string): Promise<Reply | null>;
  /** Whether this customer checked in at the venue in the last 12 hours. */
  checkedIn(contactId: string): Promise<boolean>;
  /** Gives a newly confirmed order its pickup code and the customer's table. */
  confirmed(order: SavedOrder, contactId: string): Promise<{ code: string; table: string | null }>;
  /** Sends a paid walk-in order to its screens and returns the receipt's pickup box; null for other orders. */
  paid(order: SavedOrder): Promise<Pickup | null>;
  /** The pickup box for a copy of an earlier receipt; null for orders that aren't walk-in. */
  pickup(order: SavedOrder): Promise<Pickup | null>;
}

export interface WalkInOptions {
  businessId: string;
  orderPrefix: string;
  store: WalkInStore;
  links: WalkInLinks;
  features?: PlanFeatures;
  now?: () => Date;
}

const CHECK_IN = /^(?:(?:i'?m|we'?re|i am|we are)\s+(?:here|at the (?:event|venue|party|bar|restaurant|shop|counter))|check(?:ing)?[\s-]?in)[.!]?$/i;
const CHECK_IN_FR = /^(?:je suis|nous sommes|on est)\s+(?:là|la|ici|arrivée?s?|sur place|au (?:bar|restaurant|comptoir|magasin))[.!]?$/i;
const TABLE = /^(?:(?:i'?m|we'?re|i am|we are)\s+(?:at|on)\s+|at\s+)?(table|tbl|seat|booth|spot|section|zone)\s*(?:no\.?|number)?\s*#?\s*([a-z0-9][a-z0-9-]{0,7})[.!]?$/i;
const TABLE_FR = /^(?:(?:je suis|nous sommes|on est)\s+)?(?:à la\s+|a la\s+)?(table|place|zone)\s*(?:n[°o]\.?|numéro)?\s*#?\s*([a-z0-9][a-z0-9-]{0,7})[.!]?$/i;

export function createWalkIn(opts: WalkInOptions): WalkIn {
  const now = () => (opts.now ? opts.now() : new Date());
  const onPlan = () => (opts.features ? opts.features.has("walk_in") : Promise.resolve(true));
  const notOnPlan: Reply = { text: "Walk-in orders come with Starter and above. Send *plan* to see how to upgrade." };
  const ref = (n: number) => `${opts.orderPrefix}-${n}`;

  const spotOf = (contactId: string) => opts.store.spot(contactId, new Date(now().getTime() - SPOT_HOURS * 3_600_000));

  async function stationsFor(lines: QuoteLine[]): Promise<Map<string, QuoteLine[]>> {
    const byVariant = await opts.store.stationsOf([...new Set(lines.map((l) => l.variantId))]);
    const groups = new Map<string, QuoteLine[]>();
    for (const line of lines) {
      const station = byVariant.get(line.variantId) ?? COUNTER;
      groups.set(station, [...(groups.get(station) ?? []), line]);
    }
    return groups;
  }

  function pickupBox(order: SavedOrder, code: string, table: string | null, stations: string[]): Pickup {
    return {
      qrText: opts.links.pickup(opts.businessId, order.id),
      code: `${ref(order.orderNumber)} · ${code}`,
      ...(table ? { table } : {}),
      stations,
    };
  }

  async function stationList(): Promise<string> {
    const products = await opts.store.products();
    if (!products.length) return "Your price list is empty.";
    return [
      "Which screen makes each product:",
      ...products.map((p, i) => `${i + 1}. ${p.name}: ${p.station ?? COUNTER}`),
      "",
      "Send *station 3 Bar* to send product 3 to the Bar screen, or *station 3 off* to send it back to the Counter.",
    ].join("\n");
  }

  async function setStation(number: number, name: string): Promise<string> {
    const products = await opts.store.products();
    const product = products[number - 1];
    if (!product) return `There's no product ${number}. Send *stations* to see the numbers.`;
    if (/^(off|none|counter)$/i.test(name)) {
      await opts.store.setStation(product.id, null);
      return `${product.name} now goes to the ${COUNTER} screen.`;
    }
    const station = tidyStation(name);
    if (!station) return "Please give the screen a short name of up to 30 letters, e.g. *station 3 Bar*.";
    const known = products.map((p) => p.station).find((s) => s?.toLowerCase() === station.toLowerCase()) ?? station;
    const limit = opts.features ? await opts.features.limit("stations") : null;
    const after = new Set(products.map((p) => (p.id === product.id ? known : (p.station ?? COUNTER))));
    if (limit !== null && after.size > limit) {
      return `Your plan has ${limit === 1 ? "one pickup screen" : `up to ${limit} pickup screens`}. Send *plan* to see plans with more.`;
    }
    await opts.store.setStation(product.id, known);
    return `${product.name} now goes to the ${known} screen. Send *screens* for its link.`;
  }

  async function screensReply(): Promise<string> {
    const stations = [...new Set((await opts.store.products()).map((p) => p.station ?? COUNTER))].sort();
    return [
      "Your pickup screens. Open each on the phone or tablet at that spot:",
      ...(stations.length > 1 ? [`• Every order: ${opts.links.screen(opts.businessId, ALL_STATIONS)}`] : []),
      ...stations.map((s) => `• ${s}: ${opts.links.screen(opts.businessId, s)}`),
      "",
      "Keep these links to your staff: anyone who has one can hand orders over.",
    ].join("\n");
  }

  return {
    async mode() {
      if (!(await onPlan())) return { on: false, paused: false };
      const s = await opts.store.settings();
      return { on: s.walkIn, paused: s.walkIn && s.paused };
    },

    async ownerCommand(msg) {
      const text = (msg.text ?? "").trim();
      const toggle = text.match(/^walk[\s-]?ins?(?:\s+orders?)?(?:\s+(on|off))?$/i);
      const pause = text.match(/^(close|stop|pause|open|start|resume)\s+orders?$/i);
      const station = text.match(/^station\s+(\d{1,3})\s*[:=-]?\s*(.+)$/i);
      const list = /^stations?$/i.test(text);
      const screens = /^(pickup |kitchen |bar )?screens?$/i.test(text);
      if (!toggle && !pause && !station && !list && !screens) return null;
      if (!(await onPlan())) return notOnPlan;

      if (toggle) {
        const want = toggle[1]?.toLowerCase();
        if (!want) {
          const s = await opts.store.settings();
          return {
            text: [
              `Walk-in orders are ${s.walkIn ? "on" : "off"}${s.walkIn && s.paused ? ", and new orders are closed" : ""}.`,
              "",
              "• *walk-in on* or *walk-in off*",
              "• *close orders* or *open orders*: stop or restart new orders (e.g. last orders)",
              "• *stations*: which screen makes each product, and *station 3 Bar* to change it",
              "• *screens*: the links for your pickup screens",
            ].join("\n"),
          };
        }
        await opts.store.setSettings({ walkIn: want === "on", ...(want === "on" ? { paused: false } : {}) });
        return {
          text:
            want === "on"
              ? "Walk-in orders are on ✅ Paid orders go to your pickup screens with a QR code on the receipt. Send *screens* for the links, and *stations* to send drinks and food to different screens.\n\nIf you also deliver, customers at home carry on as before. Customers at your venue check in by sending *I'm here* or their table (*Table 7*): put that on your posters and table cards."
              : "Walk-in orders are off. The bot is back to taking orders as before.",
        };
      }
      if (pause) {
        const close = /^(close|stop|pause)$/i.test(pause[1]!);
        await opts.store.setSettings({ paused: close });
        return {
          text: close
            ? "New orders are closed. Customers who message are told you've stopped taking orders; paid orders still show on your screens. Send *open orders* to start again."
            : "Orders are open again ✅",
        };
      }
      if (station) return { text: await setStation(Number(station[1]), station[2]!.trim()) };
      if (list) return { text: await stationList() };
      return { text: await screensReply() };
    },

    async customerMessage(msg, contactId) {
      const text = (msg.text ?? "").trim();
      if (CHECK_IN_FR.test(text)) {
        await opts.store.setSpot(contactId, ON_SITE);
        return { text: "Bienvenue ! Commandez ici et récupérez votre commande quand elle est prête. Que désirez-vous ? Envoyez *menu* pour tout voir." };
      }
      if (CHECK_IN.test(text)) {
        await opts.store.setSpot(contactId, ON_SITE);
        return { text: "Welcome! Order here and collect it when it's ready. What would you like? Send *menu* to see everything." };
      }
      // "Table 7" alone reads the same in both languages: answer in English unless there's French in it.
      const english = text.match(TABLE);
      const fr = english ? guessLanguage(text) === "fr" : TABLE_FR.test(text);
      const match = english ?? text.match(TABLE_FR);
      if (!match) return null;
      const kind = match[1]!.toLowerCase() === "tbl" ? "Table" : capitalise(match[1]!);
      const label = `${kind} ${match[2]!.toUpperCase()}`;
      await opts.store.setSpot(contactId, label);
      if (fr) return { text: `Merci, vous êtes à : ${label}. Que désirez-vous ? Envoyez *menu* pour tout voir.` };
      return { text: `Thanks, you're at ${label}. What would you like? Send *menu* to see everything.` };
    },

    async checkedIn(contactId) {
      return (await spotOf(contactId)) !== null;
    },

    async confirmed(order, contactId) {
      const code = String(randomInt(0, 10_000)).padStart(4, "0");
      const spot = await spotOf(contactId);
      const table = spot === ON_SITE ? null : spot;
      await opts.store.setPickup(order.id, table, code);
      return { code, table };
    },

    async paid(order) {
      const saved = await opts.store.order(order.id);
      if (!saved?.pickupCode) return null;
      const groups = await stationsFor(order.lines);
      await opts.store.createTickets(
        order.id,
        [...groups].map(([station, lines]) => ({ station, items: itemsText(lines) })),
      );
      return pickupBox(order, saved.pickupCode, saved.tableLabel, [...groups.keys()].sort());
    },

    async pickup(order) {
      const saved = await opts.store.order(order.id);
      if (!saved?.pickupCode) return null;
      const tickets = await opts.store.ticketsForOrder(order.id);
      const stations = tickets.length ? tickets.map((t) => t.station) : [...(await stationsFor(order.lines)).keys()];
      return pickupBox(order, saved.pickupCode, saved.tableLabel, [...new Set(stations)].sort());
    },
  };
}

function capitalise(word: string): string {
  return word[0]!.toUpperCase() + word.slice(1).toLowerCase();
}

/** "bar" becomes "Bar"; anything that isn't a short plain name is refused. */
function tidyStation(name: string): string | null {
  const clean = name.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > 30 || clean === ALL_STATIONS || /[<>"]/.test(clean)) return null;
  return clean[0]!.toUpperCase() + clean.slice(1);
}
