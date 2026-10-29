import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailContent } from "../../core/email/layout.js";
import type { AccountFacts, Series } from "../../core/email/series.js";
import { formatNaira } from "../../core/money.js";

// The quote and order bot's welcome and setup-tip emails (copy approved by
// Jay, marketing/email/EMAILS.md). Day 0 is when the business goes live on
// its own number; the series stops once it's on a paid plan. Plan prices are
// read from quote_plans, never written into the copy.

export interface QuoteEmailFacts extends AccountFacts {
  business: string;
  /** The number customers message, as people write it ("0704 897 1600"); null before it's known. */
  botNumber: string | null;
  /** The same as digits with the country code, for wa.me links. */
  botWaId: string | null;
  priceRows: number;
  orders: number;
  /** Their plan has the 8am summary (Pro and above). */
  morningSummary: boolean;
  planName: string;
  /** The last 30 days. */
  month: { chats: number; quotes: number; orders: number; paidKobo: number };
  /** Monthly price and price a month paid yearly, in kobo, from quote_plans. */
  prices: Record<"starter" | "pro", { monthly: number; yearly: number | null } | undefined>;
}

/** "2347048971600" -> "0704 897 1600"; other countries as "+44 7700 900123". */
export function localNumber(waId: string): string {
  if (/^234\d{10}$/.test(waId)) {
    const n = `0${waId.slice(3)}`;
    return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
  }
  return `+${waId}`;
}

export function quoteEmails(appUrl: string, facts: (businessId: string) => Promise<QuoteEmailFacts | null>): Series<QuoteEmailFacts> {
  const app = (path = "") => `${appUrl.replace(/\/+$/, "")}/home${path}`;
  const number = (f: QuoteEmailFacts) => f.botNumber ?? "your bot's number";
  const email = (e: Omit<EmailContent, "eyebrow"> & { eyebrow?: string }): EmailContent => ({ eyebrow: "Quotes and orders", ...e });
  const plan = (f: QuoteEmailFacts, code: "starter" | "pro", label: string, what: string) => {
    const p = f.prices[code];
    if (!p) return null;
    return `*${label}, ${formatNaira(p.monthly)} a month*${p.yearly ? ` (${formatNaira(p.yearly)} a month paid yearly)` : ""}: ${what}`;
  };

  return {
    facts,
    emails: [
      {
        key: "Q1",
        day: 0,
        content: (f, name) =>
          email({
            subject: "Your yarnOga assistant is ready",
            preview: "Three things to do this week, and who to ask for help.",
            hero: "welcome",
            blocks: [
              `Hi ${name},`,
              `Thanks for setting up *${f.business}* on yarnOga. Your assistant now answers customers on WhatsApp at *${number(f)}*, day and night, with prices from your own list.`,
              "Three things will get the most out of it this week:",
              {
                steps: [
                  ["Check your price list", "Send *prices* to your bot to see it. Anything not on the list, the bot hands to you instead of guessing."],
                  ["Test it like a customer would", 'Ask "how much for 50?" from your phone, or use Test your bot in the app.'],
                  ["Tell your customers", "Send your number to ten regular customers today."],
                ],
              },
              "Over the next few weeks I'll send one short email at a time, each showing one thing that saves you time or brings in more orders.",
              "If anything is unclear, reply to this email. A person reads every message.",
            ],
            button: { label: "Open your yarnOga app", href: app() },
          }),
      },
      {
        key: "Q2",
        day: 1,
        when: (f) => f.priceRows < 5,
        content: (f, name) =>
          email({
            subject: "Your bot can only quote what's on your list",
            preview: "It never guesses a price. Here's the fastest way to add yours.",
            blocks: [
              `Hi ${name},`,
              "Your yarnOga assistant never makes up a price. When a customer asks about something that isn't on your list, it tells them you'll reply and sends the chat to you.",
              `That keeps your prices right, but it also means a short list sends a lot of chats back to you. Right now ${f.business} has ${f.priceRows} item${f.priceRows === 1 ? "" : "s"}.`,
              "You can add items in whichever way is easiest:",
              {
                list: [
                  'Type them to your bot, one per line: "Round neck T-shirt, 5,000"',
                  "Send a photo of your printed price list or menu",
                  "Send a voice note reading out your prices",
                  "Send a Google Sheet link, and the bot keeps your list in step with the sheet",
                ],
              },
              "The bot shows you what it understood before anything is saved. Send *prices* any time to check.",
              "Quantity prices work too. If 1 to 9 cost ₦5,000 each and 10 or more cost ₦4,500, add both and the bot works out the right one.",
            ],
            button: { label: "Open your price list", href: app("/prices") },
          }),
      },
      {
        key: "Q3",
        day: 2,
        content: (_f, name) =>
          email({
            subject: "Ask your bot what your customers ask",
            preview: "Two minutes now saves an awkward chat later.",
            blocks: [
              `Hi ${name},`,
              "Before your customers find a wrong answer, find it yourself.",
              "In your app, open Test your bot and type what your customers really send. For example:",
              { list: ['"How much for 50 pieces?"', '"Do you deliver to Ikeja?"', '"Abeg how much be this one" with a photo', "A voice note in Pidgin or Yoruba"] },
              "You see the exact reply a customer would get. Nothing is sent and nothing is saved, so try as many as you like (60 a day).",
              "If an answer looks wrong, the fix is almost always in the price list: a missing size, a minimum order, or an item with two names. Change it and ask again.",
            ],
            button: { label: "Test your bot", href: app("/test") },
          }),
      },
      {
        key: "Q4",
        day: 4,
        content: (f, name) =>
          email({
            subject: "Put your WhatsApp number everywhere people find you",
            preview: "The bot can only answer the chats that reach it.",
            blocks: [
              `Hi ${name},`,
              `Your assistant answers every chat on ${number(f)} in seconds. The only thing that limits your orders now is how many people message that number.`,
              "Here is where to put it:",
              {
                list: [
                  `*Instagram, TikTok and Facebook bio.* ${f.botWaId ? `Use this link, which opens a chat with "Price list" already typed: https://wa.me/${f.botWaId}?text=Price%20list` : 'Use a wa.me link with "?text=Price%20list" on the end, so the chat opens with "Price list" already typed.'}`,
                  `*Your WhatsApp Status.* Post a product photo with "Send HI to ${number(f)} for prices" once or twice a week.`,
                  "*Your shop.* Print your QR poster from the app (QR posters) and stick it at the counter and on the door. Customers scan it and the chat opens.",
                  "*Every bag, receipt and delivery.* The QR poster comes as a small picture you can add to labels.",
                  '*Your old customers.* Send one message: "You can now get our prices and order on this number any time, even at night."',
                ],
              },
              "Keep it to one number. If staff answer a second number by hand, that is where orders get missed.",
            ],
            button: { label: "Print your QR poster", href: app("/posters") },
          }),
      },
      {
        key: "Q5",
        day: 7,
        content: (f, name) =>
          email({
            eyebrow: "Tip for your ads",
            subject: "Running ads? Point them at WhatsApp, not a website",
            preview: "Most customers would rather chat than fill in a form.",
            hero: "chat",
            blocks: [
              `Hi ${name},`,
              "If you run ads on Facebook or Instagram, or plan to, this is the most useful setting you'll choose.",
              "When an ad sends people to a website, many leave before the page loads. When it opens WhatsApp, your yarnOga assistant answers in seconds with your own prices, at 2pm or 2am.",
              "*How to set it up*",
              {
                steps: [
                  ["Choose the goal", "In Meta Ads Manager, pick *Engagement* (or Messages), and *WhatsApp* as where people go."],
                  ["Pick your number", `Choose *${number(f)}*, the number your assistant answers on.`],
                  ["Fill in their first message", 'For example "Hi, I want the price of the Ankara bag". The customer only taps Send, and the bot already knows what they want.'],
                  ["Put the number in the picture", `"Send HI to ${number(f)}" works on Status and in videos, where links don't.`],
                ],
              },
              { note: ["Worth knowing:", "chats that start from these ads can be answered free for 72 hours. Judge each ad by orders, not clicks. Your app shows how many chats became quotes and orders each month."] },
              "Test it the way a customer would: from a friend's phone, late at night, tap your own ad and see what happens.",
            ],
            button: { label: "See this month's chats and orders", href: app() },
          }),
      },
      {
        key: "Q6",
        day: 10,
        when: (f) => f.orders === 0,
        content: (f, name) =>
          email({
            subject: "Your first order is one share away",
            preview: "Ten messages and a poster. That's usually enough.",
            blocks: [
              `Hi ${name},`,
              `${f.business} hasn't had an order through yarnOga yet. That is normal in the first week or two, and it almost always means people don't know the number yet, not that the bot isn't working.`,
              "Two things that usually bring the first order:",
              {
                steps: [
                  ["Message ten regular customers", `From your phone, today: "Hi, you can now check our prices and order on ${number(f)} any time, even at night." Use the number, not a new group.`],
                  ["Put the QR poster up", "Where customers wait or pay. Print it from the app."],
                ],
              },
              "Then check your bot is answering by sending it a message from another phone.",
              "If something isn't working, reply here and tell me what you see. I'll look at it myself.",
            ],
            button: { label: "Print your QR poster", href: app("/posters") },
          }),
      },
      {
        key: "Q7",
        day: 10,
        when: (f) => f.orders > 0,
        content: (f, name) =>
          email({
            subject: "Getting paid faster",
            preview: 'Fewer "I have sent it" screenshots to check.',
            blocks: [
              `Hi ${name},`,
              `${f.business} has ${f.orders} order${f.orders === 1 ? "" : "s"} so far. Here are three ways yarnOga gets the money in faster.`,
              {
                list: [
                  "*Mark paid.* When a customer pays, tap Mark paid on the order in your app. The receipt goes to them on WhatsApp straight away. If they send a transfer screenshot, it comes to you with a Confirm button.",
                  "*Pay links.* Add your bank account in Settings and ask us to switch on pay links. Customers get a Paystack link with the invoice and pay by card, transfer or USSD. The money goes to your account and the order is marked paid on its own. yarnOga keeps 2.5% of each pay-link payment, never more than ₦2,000; transfers straight to your bank carry no fee.",
                  "*Payment reminders.* If an invoice isn't paid, the bot reminds the customer for you, twice at most, politely.",
                ],
              },
            ],
            button: { label: "Open Settings", href: app("/settings") },
          }),
      },
      {
        key: "Q8",
        day: 14,
        content: (_f, name) =>
          email({
            subject: "When to step in, and when to let the bot work",
            preview: "You can take over any chat, and hand it back.",
            blocks: [
              `Hi ${name},`,
              "Some chats need you: a big order, a complaint, a customer you know well. yarnOga is built for that.",
              {
                list: [
                  "*Reply from your phone* in WhatsApp Business, and the bot goes quiet in that chat so you don't talk over each other.",
                  "*Or use the Inbox* in your app. Open any chat, tap Take over, reply, and tap Hand back when you're done.",
                  "*Your staff* can have their own logins (Settings > Team), so they can answer from the Inbox without your phone.",
                ],
              },
              'A good rule: let the bot do prices, orders and "are you open?". Step in when someone is upset, or when an order is big enough that you\'d want to call them anyway.',
            ],
            button: { label: "Open your Inbox", href: app("/inbox") },
          }),
      },
      {
        key: "Q9",
        day: 21,
        content: (f, name) =>
          email({
            subject: "Your morning summary, and what it tells you",
            preview: "Yesterday's orders and money, before you open the shop.",
            blocks: [
              `Hi ${name},`,
              "On Pro and above, yarnOga sends you a summary every morning at 8am on WhatsApp: orders and money from yesterday, orders waiting to be made, unpaid invoices, and items running low.",
              f.morningSummary
                ? "You already get it. The Dashboard in your app has the same numbers for the whole month, with last month next to it."
                : "Your Dashboard still shows the month so far: chats, quotes, orders and money paid in. Have a look once a week. If quotes are high and orders are low, your prices or delivery fees may be the reason.",
            ],
            button: { label: "Open your Dashboard", href: app() },
          }),
      },
      {
        key: "Q10",
        day: 28,
        content: (f, name) =>
          email({
            subject: "What your first month on yarnOga looked like",
            preview: `${f.month.chats} chats answered, ${f.month.orders} orders.`,
            blocks: [
              `Hi ${name},`,
              `Here is ${f.business}'s first month on yarnOga:`,
              {
                list: [
                  `Customers who chatted: ${f.month.chats}`,
                  `Quotes sent: ${f.month.quotes}`,
                  `Orders: ${f.month.orders}`,
                  `Money marked paid: ${formatNaira(f.month.paidKobo)}`,
                ],
              },
              `You're on the ${f.planName} plan. The Free plan stays free, with 50 orders and 500 AI replies a month.`,
              "If you're getting close to that, or want more:",
              {
                list: [
                  plan(f, "starter", "Starter", "unlimited orders, 2,500 AI replies, voice notes, invoices and receipts, payment reminders, staff inbox."),
                  plan(f, "pro", "Pro", "7,500 AI replies, delivery and riders, order board, product photos and stock, broadcasts, morning summary."),
                ].filter((line): line is string => line !== null),
              },
              "Send *upgrade starter* or *upgrade pro* to your bot, or reply here if you want help choosing.",
              "Thank you for trying yarnOga in its first year.",
            ],
            button: { label: "Compare plans", href: "https://yarnoga.com/quotes.html#pricing" },
          }),
      },
    ],
  };
}

/**
 * What the quote emails need to know about a business, from the database.
 * Business #1 on the main number keeps its name and plan in Railway, so those
 * are passed in.
 */
export function createSupabaseQuoteEmailFacts(
  db: SupabaseClient,
  opts: {
    main?: { id: string; name: string; plan?: string; phoneNumberId: string };
    /** Whether the business's plan has the morning summary. */
    morningSummary(businessId: string): Promise<boolean>;
    now?: () => Date;
  },
): (businessId: string) => Promise<QuoteEmailFacts | null> {
  const now = opts.now ?? (() => new Date());
  return async (businessId) => {
    const { data: row, error } = await db.from("quote_businesses").select("*").eq("id", businessId).maybeSingle();
    if (error) throw new Error(`email facts: business lookup failed: ${error.message}`);
    if (!row) return null;
    const main = opts.main?.id === businessId ? opts.main : undefined;
    const numberId = main ? main.phoneNumberId : ((row.phone_number_id as string | null) ?? null);
    const paidUntil = row.plan_paid_until ? new Date(row.plan_paid_until as string) : null;
    const planCode = main ? (main.plan ?? "free") : paidUntil && paidUntil <= now() ? "free" : ((row.plan_code as string | null) ?? "free");

    let botWaId = (row.whatsapp_number as string | null) ?? null;
    if (!botWaId && numberId) {
      const { data: conn } = await db.from("whatsapp_connections").select("display_number").eq("phone_number_id", numberId).maybeSingle();
      botWaId = ((conn?.display_number as string | null) ?? "").replace(/\D/g, "") || null;
    }

    const since = new Date(now().getTime() - 30 * 86_400_000).toISOString();
    const count = async (q: PromiseLike<{ count: number | null; error: { message: string } | null }>, what: string) => {
      const { count, error } = await q;
      if (error) throw new Error(`email facts: ${what} failed: ${error.message}`);
      return count ?? 0;
    };
    const [priceRows, orders, quotes, monthOrders, paid, chats, plans] = await Promise.all([
      count(
        db.from("quote_variants").select("id, quote_products!inner(business_id)", { count: "exact", head: true }).eq("quote_products.business_id", businessId).eq("active", true),
        "price rows",
      ),
      count(db.from("quote_orders").select("id", { count: "exact", head: true }).eq("business_id", businessId).in("status", ["confirmed", "paid"]), "orders"),
      count(db.from("quote_orders").select("id", { count: "exact", head: true }).eq("business_id", businessId).gte("created_at", since), "quotes"),
      count(
        db.from("quote_orders").select("id", { count: "exact", head: true }).eq("business_id", businessId).in("status", ["confirmed", "paid"]).gte("created_at", since),
        "month orders",
      ),
      db.from("quote_orders").select("total_kobo").eq("business_id", businessId).eq("status", "paid").gte("created_at", since).limit(10_000),
      numberId
        ? db.from("messages").select("contact_id").eq("business_number_id", numberId).eq("direction", "inbound").gte("created_at", since).limit(10_000)
        : Promise.resolve({ data: [], error: null }),
      db.from("quote_plans").select("code, name, monthly_price_kobo, monthly_price_paid_yearly_kobo"),
    ]);
    if (paid.error) throw new Error(`email facts: paid orders failed: ${paid.error.message}`);
    if (chats.error) throw new Error(`email facts: chats failed: ${chats.error.message}`);
    if (plans.error) throw new Error(`email facts: plans failed: ${plans.error.message}`);
    const planRows = (plans.data ?? []) as Array<{ code: string; name: string; monthly_price_kobo: number; monthly_price_paid_yearly_kobo: number | null }>;
    const price = (code: string) => {
      const p = planRows.find((r) => r.code === code);
      return p ? { monthly: Number(p.monthly_price_kobo), yearly: p.monthly_price_paid_yearly_kobo == null ? null : Number(p.monthly_price_paid_yearly_kobo) } : undefined;
    };

    return {
      live: main ? true : row.active === true && Boolean(numberId),
      // Paid customers get the after-upgrade emails instead of the setup series.
      stop: planCode !== "free",
      business: main ? main.name : (row.name as string),
      botNumber: botWaId ? localNumber(botWaId) : null,
      botWaId,
      priceRows,
      orders,
      morningSummary: await opts.morningSummary(businessId),
      planName: planRows.find((r) => r.code === planCode)?.name ?? "Free",
      month: {
        chats: new Set(((chats.data ?? []) as Array<{ contact_id: string }>).map((r) => r.contact_id)).size,
        quotes,
        orders: monthOrders,
        paidKobo: ((paid.data ?? []) as Array<{ total_kobo: number }>).reduce((sum, r) => sum + Number(r.total_kobo), 0),
      },
      prices: { starter: price("starter"), pro: price("pro") },
    };
  };
}
