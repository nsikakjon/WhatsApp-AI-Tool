import type { SupabaseClient } from "@supabase/supabase-js";
import { formatNaira } from "../../core/money.js";
import type { Product, ProductContext, Reply } from "../../core/product.js";
import { fetchSheet as defaultFetchSheet, parseCsv, sheetCsvUrl } from "../../core/sheets.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import {
  DRAFT_IMAGE_TYPES,
  MAX_DRAFT_IMAGE_BYTES,
  MAX_DRAFT_TEXT,
  draftToCsv,
  type DraftImage,
  type DraftImageType,
  type PriceListDrafter,
} from "./drafter.js";
import { TEMPLATE_CSV_URL, TEMPLATE_SHEET_URL, priceListCsv, readPriceList, type PriceListItem } from "./pricelist.js";
import { PHARMACY_WARNING, looksLikePharmacy, prescriptionNote } from "./prescription.js";
import { SHEET_LINK, type SheetSync } from "./sheet-sync.js";
import type { SetupStore } from "./store.js";
import { welcomeAsk } from "./welcome.js";

// Sign-up by WhatsApp on the yarnOga quotes number. That number runs the demo
// shop; a business owner who sends "sign up" is instead walked through:
//
// 1. business name, 2. what they sell, 3. a referral code if they have one,
// 4. their prices: typed, as a voice note, as a photo of their price list or
// as a CSV file. The AI drafts the
// price list (drafter.ts, as on the setup screen) and the bot shows it back.
// The owner corrects it in the chat or replies YES. Only then is the business
// created, on the Free plan and switched off until its own number is
// connected, so prices still only reach customers once the owner has
// confirmed them.
//
// Afterwards the owner can send "try" to chat with their own bot as a
// customer (test orders are not saved) and "prices" to change the list.

export type SignupStep = "name" | "about" | "referral" | "prices" | "done";

export interface Signup {
  waId: string;
  step: SignupStep;
  businessName: string | null;
  description: string | null;
  /** A promo or referral code given at sign-up, used on the business's first upgrade. */
  referralCode: string | null;
  /** The drafted price list waiting for YES, in the setup screen's CSV format. */
  draftCsv: string | null;
  businessId: string | null;
  trying: boolean;
  aiDay: string | null;
  aiUsed: number;
  /** The Google Sheet the draft came from, kept in step once saved (sheet-sync.ts). */
  sheetUrl?: string | null;
}

export interface SignupStore {
  get(waId: string): Promise<Signup | null>;
  /** Creates or updates the sign-up for this number. */
  save(waId: string, change: Partial<Omit<Signup, "waId">> & { signedUpAt?: Date }): Promise<void>;
  remove(waId: string): Promise<void>;
  /** How many businesses have signed up by chat since this time. */
  signedUpSince(since: Date): Promise<number>;
  /** True when this promo or referral code is switched on and can be used on a quote plan. */
  codeExists(code: string): Promise<boolean>;
  /** Adds the business on the Free plan, switched off, with this number for order alerts. Returns its id. */
  createBusiness(b: { name: string; description: string | null; orderPrefix: string; ownerWaId: string; referralCode: string | null }): Promise<string>;
}

export interface ChatSignupOptions {
  /** Phone number ID of the yarnOga quotes number. Messages to other numbers pass straight through. */
  numberId: string;
  store: SignupStore;
  setup: Pick<SetupStore, "priceList" | "replacePriceList">;
  drafter: PriceListDrafter;
  /** The owner's own bot for "try", with test orders kept in memory. */
  tryBot?: (businessId: string, ownerWaId: string) => Promise<Product | null>;
  /** Keeps saved price lists in step with the owner's Google Sheet. Off when not given. */
  sheets?: Pick<SheetSync, "remember" | "ownerCommand">;
  /** Gets a WhatsApp message for each new sign-up (the yarnOga team). */
  alertWaId?: string;
  /** Asks a new owner for their email for setup tips; null when not to ask. Off when not given. */
  askEmail?: (a: { waId: string; businessId: string }) => Promise<string | null>;
  now?: () => Date;
  fetchSheet?: (link: string) => Promise<string>;
  log?: Pick<Console, "error">;
}

/** AI drafts plus test replies one person can use in a day. */
export const AI_PER_PERSON_PER_DAY = 30;
/** AI drafts across everyone in a day, so the AI bill can't run away. */
export const DRAFTS_PER_DAY = 200;
/** New businesses by chat in a day; more are passed to the yarnOga team. */
export const SIGNUPS_PER_DAY = 30;
const MAX_CSV_BYTES = 1024 * 1024;
const PREVIEW_ITEMS = 40;

const SIGN_UP = /\b(sign\s*-?\s*up|register|get started|onboard)\b/i;
const CANCEL = /^(cancel|stop|quit)[.!]*$/i;
const YES = /^(yes|yeah|yep|ok|okay|save|save it|confirm|correct)[.!]*$/i;
const TRY = /^(try|try it|test|test it|try my bot)[.!]*$/i;
const DONE_TRYING = /^(done|stop|exit|end|finish)[.!]*$/i;
const PRICES = /^(prices|price list|my prices|change prices|update prices)[.!]*$/i;
const NO_CODE = /^(no|nope|none|nah|skip|no code|i don'?t have (one|a code|any))[.!]*$/i;

const ASK_REFERRAL = "Do you have a referral code? Send it now, or send *no* to carry on.";

const ASK_PRICES =
  "Now your prices. Type them, send a voice note, or send a photo of your price list, for example:\n" +
  "_Cupcakes ₦600 each, box of 6 for ₦3,500. Birthday cakes from ₦25,000, minimum 2 boxes._\n\n" +
  `Prefer a spreadsheet? Copy our Google Sheet template (${TEMPLATE_SHEET_URL}) or download the CSV (${TEMPLATE_CSV_URL}) and fill it in. ` +
  'Then send the CSV file here, or send the link to your Google Sheet, shared as "Anyone with the link" can view.';

export function withChatSignup(next: Product, opts: ChatSignupOptions): Product {
  const now = opts.now ?? (() => new Date());
  const log = opts.log ?? console;
  const fetchSheet = opts.fetchSheet ?? defaultFetchSheet;
  const drafts = { day: "", count: 0 };
  const tryBots = new Map<string, Product>();

  return {
    name: next.name,
    async handle(msg, ctx) {
      if (msg.businessNumberId !== opts.numberId) return next.handle(msg, ctx);
      const text = (msg.text ?? "").trim();

      let signup: Signup | null;
      try {
        signup = await opts.store.get(msg.from);
      } catch (err) {
        // Most likely migration 0039 hasn't been run yet: the demo shop carries on.
        log.error("Could not read the chat sign-up:", err);
        return next.handle(msg, ctx);
      }

      if (signup?.trying) return tryReply(signup, msg, ctx, text);

      if (!signup || signup.step === "done") {
        if (signup?.businessId) {
          const sheetReply = opts.sheets ? await opts.sheets.ownerCommand(signup.businessId, msg) : null;
          if (sheetReply) return sheetReply;
          if (SIGN_UP.test(text)) return { text: `You've already signed up as *${signup.businessName}*.\n\n${AFTER}` };
          if (TRY.test(text)) return startTrying(signup, msg);
          if (PRICES.test(text)) {
            const current = await opts.setup.priceList(signup.businessId);
            await opts.store.save(msg.from, { step: "prices", draftCsv: current.length ? priceListCsv(current) : null });
            return { text: current.length ? `Tell me what to change, or send your whole new list.\n\n${preview(current)}` : ASK_PRICES };
          }
        }
        if (SIGN_UP.test(text)) {
          await opts.store.save(msg.from, { step: "name", businessName: null, description: null, referralCode: null, draftCsv: null, trying: false });
          return {
            text: "Let's set up your WhatsApp quote bot. It takes a few minutes, and you can send *cancel* any time.\n\nFirst, what's your business called?",
          };
        }
        const reply = await next.handle(msg, ctx);
        const ask = welcomeAsk(text);
        const welcome = ask === "greeting" || ask === "help";
        if (signup?.businessId && welcome && reply) return addNote(reply, AFTER);
        if (signup || (ctx.history.length > 0 && !welcome)) return reply;
        if (!reply) return { text: INVITE };
        const invited = addNote(reply, INVITE);
        if (invited.buttons && invited.buttons.buttons.length < 3) {
          invited.buttons.buttons = [...invited.buttons.buttons, { id: "sign up", title: "Get my own bot" }];
        }
        return invited;
      }

      if (CANCEL.test(text)) {
        if (signup.businessId) {
          await opts.store.save(msg.from, { step: "done", draftCsv: null });
          return { text: "Okay, I've kept your price list as it was." };
        }
        await opts.store.remove(msg.from);
        return { text: "Okay, I've stopped the sign-up. Send *sign up* any time to start again." };
      }

      switch (signup.step) {
        case "name": {
          const name = text.replace(/\s+/g, " ");
          if (SIGN_UP.test(name)) return { text: "What's your business called?" };
          if (name.length < 2 || name.length > 80) return { text: "Please type your business name (80 letters at most)." };
          await opts.store.save(msg.from, { step: "about", businessName: name });
          return { text: `Thanks. In a few words, what does *${name}* sell? For example: _cakes and pastries_ or _printed T-shirts and mugs_.` };
        }
        case "about": {
          const about = text.replace(/\s+/g, " ");
          if (!about) return { text: "In a few words, what do you sell?" };
          if (about.length > 120) return { text: "Please keep that short, a few words is enough (120 letters at most)." };
          await opts.store.save(msg.from, { step: "referral", description: about });
          return { text: looksLikePharmacy(signup.businessName, about) ? `${PHARMACY_WARNING}\n\n${ASK_REFERRAL}` : ASK_REFERRAL };
        }
        case "referral": {
          if (NO_CODE.test(text)) {
            await opts.store.save(msg.from, { step: "prices", referralCode: null });
            return { text: ASK_PRICES };
          }
          const code = text.replace(/\s+/g, "").toUpperCase();
          if (!/^[A-Z0-9]{4,20}$/.test(code) || !(await opts.store.codeExists(code))) {
            return { text: `I can't find the code *${text}*. Check the spelling and send it again, or send *no* to carry on without one.` };
          }
          await opts.store.save(msg.from, { step: "prices", referralCode: code });
          return { text: `Thanks, I've kept *${code}*. Its discount comes off your first month when you upgrade.\n\n${ASK_PRICES}` };
        }
        default:
          return pricesStep(signup, msg, ctx, text);
      }
    },
  };

  async function pricesStep(signup: Signup, msg: IncomingMessage, ctx: ProductContext, text: string): Promise<Reply> {
    if (YES.test(text) && signup.draftCsv) return confirm(signup, msg.from);

    const sheetLink = text.match(SHEET_LINK)?.[0];
    if (sheetLink && sheetCsvUrl(sheetLink)) {
      try {
        return await showDraft(msg.from, await fetchSheet(sheetLink), [], sheetLink);
      } catch (err) {
        return { text: `I couldn't open that Google Sheet: ${err instanceof Error ? err.message : String(err)}.` };
      }
    }

    if (msg.type === "document" && msg.mediaId) {
      const file = await ctx.downloadMedia(msg.mediaId);
      const csv = await csvFrom(file);
      if (typeof csv !== "string") return csv;
      return showDraft(msg.from, csv, []);
    }

    let images: DraftImage[] = [];
    let ownerText: string | null = text;
    if (msg.type === "image" && msg.mediaId) {
      const file = await ctx.downloadMedia(msg.mediaId);
      const type = file.mimeType.toLowerCase();
      if (!(DRAFT_IMAGE_TYPES as readonly string[]).includes(type) || file.data.size > MAX_DRAFT_IMAGE_BYTES) {
        return { text: "I couldn't read that picture. Please send a clear photo or screenshot of your price list (under 3.5 MB)." };
      }
      images = [{ mediaType: type as DraftImageType, data: Buffer.from(await file.data.arrayBuffer()).toString("base64") }];
      ownerText = null;
    } else if (!text) {
      return { text: msg.type === "audio" ? "Sorry, I couldn't make out that voice note. Could you type your prices instead?" : ASK_PRICES };
    }
    if (text.length > MAX_DRAFT_TEXT) return { text: "That's a long list. Please send it in parts, or as a photo or CSV file." };

    if (!(await useAi(signup, msg.from, true))) {
      return { text: "I've read as many price lists as I can for today. Please try again tomorrow, or send your list as a CSV file." };
    }
    const caption = (msg.caption ?? "").trim();
    const request = [
      signup.draftCsv ? `The price list so far:\n${signup.draftCsv}` : "",
      images.length ? [signup.draftCsv ? "Add what's in the photo to it." : "", caption].filter(Boolean).join(" ") : signup.draftCsv ? `The owner's changes: ${text}` : text,
    ]
      .filter(Boolean)
      .join("\n\n");
    let draft;
    try {
      draft = await opts.drafter.draft({ businessName: signup.businessName ?? "the business", description: signup.description, text: request, images });
    } catch (err) {
      log.error("Chat sign-up price list draft failed:", err);
      return { text: "Sorry, I couldn't read that just now. Please try again in a minute." };
    }
    // Typed or spoken prices are checked word for word against what the owner
    // sent (and the list so far); prices read from a photo can't be.
    const { csv, droppedPrices } = draftToCsv(draft, ownerText === null ? null : request);
    const flags = [
      draft.notes ?? "",
      droppedPrices ? `I left ${droppedPrices} price${droppedPrices === 1 ? "" : "s"} empty because I couldn't find ${droppedPrices === 1 ? "it" : "them"} in what you sent. Tell me the price, or leave it for you to price by hand.` : "",
    ].filter(Boolean);
    return showDraft(msg.from, csv, flags);
  }

  async function showDraft(waId: string, csv: string, flags: string[], sheetUrl: string | null = null): Promise<Reply> {
    const { items, problems } = readPriceList(parseCsv(csv));
    if (!items.length && !problems.length) {
      return { text: "I didn't find any products or prices in that. Please add more detail, or send a clearer photo." };
    }
    await opts.store.save(waId, { draftCsv: csv, ...(opts.sheets ? { sheetUrl } : {}) });
    if (problems.length) {
      const list = problems.slice(0, 5).map((p) => `• ${p.message}`).join("\n");
      return { text: `A few things need fixing before I can save this:\n${list}\n\nTell me the corrections, or send the list again.` };
    }
    const prescription = prescriptionNote(items.map((i) => (i.option === "Standard" ? i.product : `${i.product}, ${i.option}`)));
    if (prescription) flags = [...flags, prescription];
    return {
      text: [
        preview(items),
        ...(flags.length ? ["", ...flags] : []),
        "",
        "Please check every price. Reply *YES* to save it, or tell me what to change (you can also send another photo).",
      ].join("\n"),
    };
  }

  async function confirm(signup: Signup, waId: string): Promise<Reply> {
    const { items, problems } = readPriceList(parseCsv(signup.draftCsv!));
    if (problems.length || !items.length) return { text: "That list still needs fixing. Tell me the corrections, or send it again." };

    if (signup.businessId) {
      await opts.setup.replacePriceList(signup.businessId, items);
      if (opts.sheets) await opts.sheets.remember(signup.businessId, signup.sheetUrl ?? null);
      await opts.store.save(waId, { step: "done", draftCsv: null });
      return { text: `Saved. ${signup.businessName}'s bot quotes from the new prices from now on.\n\n${AFTER}` };
    }

    const today = new Date(now());
    today.setUTCHours(0, 0, 0, 0);
    if ((await opts.store.signedUpSince(today)) >= SIGNUPS_PER_DAY) {
      return {
        text: "Thanks! We've had a lot of sign-ups today, so the yarnOga team will message you to finish setting up. Your price list is kept.",
        ...alert(`Sign-up waiting (daily limit reached): ${signup.businessName} (${signup.description}), +${waId}, ${items.length} items. Their list is saved in quote_signups.`),
      };
    }

    const businessId = await opts.store.createBusiness({
      name: signup.businessName!,
      description: signup.description,
      orderPrefix: orderPrefix(signup.businessName!),
      ownerWaId: waId,
      referralCode: signup.referralCode,
    });
    await opts.store.save(waId, { businessId });
    await opts.setup.replacePriceList(businessId, items);
    if (opts.sheets && signup.sheetUrl) await opts.sheets.remember(businessId, signup.sheetUrl);
    await opts.store.save(waId, { step: "done", draftCsv: null, signedUpAt: now() });
    const emailAsk = opts.askEmail ? await opts.askEmail({ waId, businessId }) : null;
    return {
      text: [
        `Done! *${signup.businessName}* is set up on the yarnOga Free plan.`,
        ...(opts.sheets && signup.sheetUrl ? ["", "I'll check your Google Sheet every day and tell you when your prices change there."] : []),
        "",
        AFTER,
        "",
        "Last step: your customers need your WhatsApp number to reach the bot. The yarnOga team will message you shortly to connect it.",
        ...(emailAsk ? ["", emailAsk] : []),
      ].join("\n"),
      ...alert(
        `New quote bot sign-up: ${signup.businessName} (${signup.description}), +${waId}, ${items.length} items${signup.referralCode ? `, code ${signup.referralCode}` : ""}. It's switched off until their number is connected: add its Phone number ID on /quote-setup and switch it on.`,
      ),
    };
  }

  async function startTrying(signup: Signup, msg: IncomingMessage): Promise<Reply> {
    const bot = opts.tryBot ? await opts.tryBot(signup.businessId!, msg.from) : null;
    if (!bot) return { text: "Trying your bot isn't available just now. The yarnOga team will show you once your number is connected." };
    tryBots.set(msg.from, bot);
    await opts.store.save(msg.from, { trying: true });
    return {
      text: `You're now chatting with *${signup.businessName}*'s bot, as your customers will. Ask for a quote for something on your price list. Test orders aren't saved, and the order alerts come to you.\n\nSend *done* to stop.`,
    };
  }

  async function tryReply(signup: Signup, msg: IncomingMessage, ctx: ProductContext, text: string): Promise<Reply | null> {
    if (DONE_TRYING.test(text) || !signup.businessId) {
      tryBots.delete(msg.from);
      await opts.store.save(msg.from, { trying: false });
      return { text: `You're back with yarnOga.\n\n${AFTER}` };
    }
    if (!(await useAi(signup, msg.from, false))) {
      return { text: "That's all the test messages for today. Send *done* to stop, and try again tomorrow." };
    }
    let bot = tryBots.get(msg.from);
    if (!bot) {
      bot = (await opts.tryBot?.(signup.businessId, msg.from)) ?? undefined;
      if (!bot) return { text: "Trying your bot isn't available just now. Send *done* to stop." };
      tryBots.set(msg.from, bot);
    }
    return bot.handle(msg, ctx);
  }

  /** Counts one AI call against the person's daily allowance (and, for drafts, everyone's). */
  async function useAi(signup: Signup, waId: string, isDraft: boolean): Promise<boolean> {
    const today = now().toISOString().slice(0, 10);
    const used = signup.aiDay === today ? signup.aiUsed : 0;
    if (used >= AI_PER_PERSON_PER_DAY) return false;
    if (isDraft) {
      if (drafts.day !== today) Object.assign(drafts, { day: today, count: 0 });
      if (drafts.count >= DRAFTS_PER_DAY) return false;
      drafts.count++;
    }
    await opts.store.save(waId, { aiDay: today, aiUsed: used + 1 });
    signup.aiDay = today;
    signup.aiUsed = used + 1;
    return true;
  }

  function alert(text: string): Pick<Reply, "notify"> {
    return opts.alertWaId ? { notify: [{ to: opts.alertWaId, text }] } : {};
  }
}

const INVITE = "Want a WhatsApp bot like this for your own business? Send *sign up* and I'll set it up with you here.";

/** Adds a paragraph to the end of a reply, inside its buttons message if it has one. */
function addNote(reply: Reply, note: string): Reply {
  if (reply.buttons) return { ...reply, buttons: { ...reply.buttons, body: `${reply.buttons.body}\n\n${note}` } };
  return { ...reply, text: reply.text ? `${reply.text}\n\n${note}` : note };
}

const AFTER = "Send *try* to chat with your bot as a customer would, or *prices* to change your price list.";

/** A CSV file the owner sent, as text, or the reply explaining why it can't be read. */
async function csvFrom(file: { data: Blob; mimeType: string }): Promise<string | Reply> {
  const type = file.mimeType.toLowerCase();
  if (/spreadsheetml|opendocument|numbers/.test(type)) {
    return { text: "Please save the spreadsheet as CSV first (File > Download > CSV in Google Sheets, or Save As > CSV in Excel), then send that file." };
  }
  if (file.data.size > MAX_CSV_BYTES) return { text: "That file is too big. Price lists must be under 1 MB." };
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  // Old Excel files can arrive with the same label as CSV; real CSV has no zero bytes.
  if (!/csv|text|excel/.test(type) || bytes.subarray(0, 2000).includes(0)) {
    return { text: "I can read price lists as a CSV file, a photo, or typed out. Please send it one of those ways." };
  }
  return new TextDecoder().decode(bytes);
}

/** The price list as a short WhatsApp message. */
export function preview(items: PriceListItem[]): string {
  const lines = items.slice(0, PREVIEW_ITEMS).map((i) => {
    const name = i.option === "Standard" ? i.product : `${i.product}, ${i.option}`;
    const prices = i.tiers.length
      ? i.tiers.map((t, n) => (n === 0 ? `${formatNaira(t.unitPriceKobo)} each` : `${formatNaira(t.unitPriceKobo)} from ${t.minQuantity}`)).join(", ")
      : "you price it by hand";
    return `• ${name}: ${prices}${i.minQuantity > 1 ? ` (minimum ${i.minQuantity})` : ""}`;
  });
  const more = items.length > PREVIEW_ITEMS ? [`...and ${items.length - PREVIEW_ITEMS} more`] : [];
  return [`Your price list (${items.length} item${items.length === 1 ? "" : "s"}):`, ...lines, ...more].join("\n");
}

/** Letters before order numbers: "Mama Cakes" gives MC (MC-1001). */
export function orderPrefix(name: string): string {
  const words = name.toUpperCase().replace(/['’]/g, "").split(/[^A-Z]+/).filter(Boolean);
  const initials = words.map((w) => w[0]).join("").slice(0, 3);
  if (initials.length >= 2) return initials;
  return (words[0] ?? "").slice(0, 3) || "Q";
}

type SignupRow = {
  wa_id: string;
  step: SignupStep;
  business_name: string | null;
  description: string | null;
  referral_code?: string | null;
  draft_csv: string | null;
  business_id: string | null;
  trying: boolean;
  ai_day: string | null;
  ai_used: number;
  sheet_url?: string | null;
};

export function createSupabaseSignups(db: SupabaseClient): SignupStore {
  return {
    async get(waId) {
      const { data, error } = await db.from("quote_signups").select("*").eq("wa_id", waId).maybeSingle();
      if (error) throw new Error(`quote sign-up lookup failed: ${error.message}`);
      if (!data) return null;
      const r = data as SignupRow;
      return {
        waId: r.wa_id,
        step: r.step,
        businessName: r.business_name,
        description: r.description,
        referralCode: r.referral_code ?? null,
        draftCsv: r.draft_csv,
        businessId: r.business_id,
        trying: r.trying,
        aiDay: r.ai_day,
        aiUsed: r.ai_used,
        sheetUrl: r.sheet_url ?? null,
      };
    },
    async save(waId, c) {
      const row = {
        wa_id: waId,
        updated_at: new Date().toISOString(),
        ...(c.step !== undefined ? { step: c.step } : {}),
        ...(c.businessName !== undefined ? { business_name: c.businessName } : {}),
        ...(c.description !== undefined ? { description: c.description } : {}),
        ...(c.referralCode !== undefined ? { referral_code: c.referralCode } : {}),
        ...(c.draftCsv !== undefined ? { draft_csv: c.draftCsv } : {}),
        ...(c.businessId !== undefined ? { business_id: c.businessId } : {}),
        ...(c.trying !== undefined ? { trying: c.trying } : {}),
        ...(c.aiDay !== undefined ? { ai_day: c.aiDay } : {}),
        ...(c.aiUsed !== undefined ? { ai_used: c.aiUsed } : {}),
        ...(c.sheetUrl !== undefined ? { sheet_url: c.sheetUrl } : {}),
        ...(c.signedUpAt !== undefined ? { signed_up_at: c.signedUpAt.toISOString() } : {}),
      };
      const { error } = await db.from("quote_signups").upsert(row, { onConflict: "wa_id" });
      if (error) throw new Error(`save quote sign-up failed: ${error.message}`);
    },
    async remove(waId) {
      const { error } = await db.from("quote_signups").delete().eq("wa_id", waId);
      if (error) throw new Error(`remove quote sign-up failed: ${error.message}`);
    },
    async signedUpSince(since) {
      const { count, error } = await db
        .from("quote_signups")
        .select("wa_id", { count: "exact", head: true })
        .gte("signed_up_at", since.toISOString());
      if (error) throw new Error(`count quote sign-ups failed: ${error.message}`);
      return count ?? 0;
    },
    async codeExists(code) {
      const { data, error } = await db
        .from("promo_codes")
        .select("code")
        .eq("code", code)
        .eq("active", true)
        .or("product.is.null,product.eq.quote")
        .maybeSingle();
      if (error) throw new Error(`promo code lookup failed: ${error.message}`);
      return Boolean(data);
    },
    async createBusiness(b) {
      const { data, error } = await db
        .from("quote_businesses")
        .insert({
          name: b.name,
          description: b.description,
          order_prefix: b.orderPrefix,
          owner_wa_id: b.ownerWaId,
          plan_code: "free",
          active: false,
          ...(b.referralCode ? { referral_code: b.referralCode } : {}),
        })
        .select("id")
        .single();
      if (error) throw new Error(`create signed-up business failed: ${error.message}`);
      return (data as { id: string }).id;
    },
  };
}
