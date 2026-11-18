import { formatMoney } from "../../core/money.js";
import { showWaId } from "../../core/whatsapp/ids.js";
import { lagosMonthStart } from "../../products/quote/plan.js";
import type { AppBusiness } from "../types.js";
import {
  BUSY_DAYS,
  growth,
  lapsedCustomers,
  LAPSED_DAYS,
  LAPSED_MIN_ORDERS,
  PERIOD_DAYS,
  postItems,
  priceCheck,
  shopHealth,
  SLOW_DAYS,
  TIER_DAYS,
  WEEKDAYS,
  type AdvisorData,
  type Period,
} from "./numbers.js";
import type { AdvisorStore } from "./store.js";
import type { AdviceLang, AdviceWriter } from "./writer.js";

// The business advisor (QUOTE_BUSINESS_ADVISOR, Pro and above): five
// questions a shop owner can ask in the owner app or by sending "advice" to
// their bot, answered from their own shop's figures. Code works out and
// writes every figure; the AI adds a few lines of plain advice. Owners only,
// never customers.
//
// Each plan gets a number of written answers a month (business_advisor in
// quote_plan_features, migration 0093). Past that, answers still show the
// figures, without the written advice. The same question asked again within
// a few hours shows the saved answer, so it costs nothing.

export const QUESTIONS = ["shop", "lapsed", "grow", "prices", "post"] as const;
export type QuestionId = (typeof QUESTIONS)[number];
export const isQuestion = (v: unknown): v is QuestionId => QUESTIONS.includes(v as QuestionId);

/** How long an answer is kept and shown again. */
export const FRESH_HOURS = 3;
const DAY = 86_400_000;
/** Customers listed under "Who stopped buying?". */
const LAPSED_SHOWN = 10;
/** Where a win-back message puts each customer's name. */
export const NAME_SLOT = "{name}";

export interface Answer {
  question: QuestionId;
  /** When the figures were worked out (ISO). */
  at: string;
  /** The figures, one line each, written by code. */
  facts: string[];
  /** The AI's advice, or null. For "Write my status post" it's the post itself. */
  advice: string | null;
  /** Why there's no written advice: the month's answers are used up. */
  limitReached?: boolean;
  /** "Who stopped buying?": a message to send them, with {name} where each name goes. */
  winBack?: { draft: string; people: Array<{ name: string | null; waId: string }> };
}

export interface Advisor {
  store: AdvisorStore;
  /** Leave out to answer with figures only. */
  writer?: AdviceWriter;
}

interface Texts {
  title: Record<QuestionId, string>;
  hint: Record<QuestionId, string>;
  periodHead: string;
  moneyIn: string;
  orders: string;
  average: string;
  repeatLabel: string;
  unpaidLabel: string;
  repeat(p: Period): string;
  unpaid(p: Period, money: (k: number) => string): string;
  up(pct: number): string;
  down(pct: number): string;
  same: string;
  lapsedHead(n: number): string;
  lapsedNone: string;
  lapsedLine(orders: number, spent: string, last: string): string;
  andMore(n: number): string;
  bestHead: string;
  bestLine(qty: number, money: string): string;
  noSales: string;
  slow(names: string): string;
  busy(days: string, quiet: string): string;
  times(n: number): string;
  costsOff: string;
  belowCostHead: string;
  belowCostLine(price: string, from: number, cost: string): string;
  soldBelowHead: string;
  soldBelowLine(times: number, loss: string): string;
  noCost(n: number): string;
  tiersHead: string;
  tierLine(from: number, biggest: number): string;
  pricesFine: string;
  postHead: string;
  postListHead: string;
  postLine(price: string): string;
  postNone: string;
  postFallback(shop: string, items: string[]): string;
  winBackFallback(shop: string): string;
  tasks: Record<QuestionId, string>;
}

const EN: Texts = {
  title: { shop: "How is my shop doing?", lapsed: "Who stopped buying?", grow: "How do I sell more?", prices: "Check my prices", post: "Write my status post" },
  hint: {
    shop: "Money in, orders, repeat customers and unpaid orders against last month",
    lapsed: "Regular customers who've gone quiet, with a message to win them back",
    grow: "Best sellers, slow items and your busiest days",
    prices: "Prices below cost, and bulk prices nobody reaches",
    post: "A status post and ad caption from what sells best",
  },
  periodHead: `Last ${PERIOD_DAYS} days, with the ${PERIOD_DAYS} days before in brackets:`,
  moneyIn: "Money in",
  orders: "Orders",
  average: "Average order",
  repeatLabel: "Repeat customers",
  unpaidLabel: "Unpaid orders",
  repeat: (p) => `${p.repeat} of ${p.customers}`,
  unpaid: (p, money) => (p.unpaid ? `${p.unpaid}, ${money(p.unpaidKobo)}` : "none"),
  up: (pct) => `up ${pct}%`,
  down: (pct) => `down ${pct}%`,
  same: "about the same",
  lapsedHead: (n) => `${n} customer${n === 1 ? "" : "s"} ordered ${LAPSED_MIN_ORDERS} or more times and ${n === 1 ? "hasn't" : "haven't"} ordered in ${LAPSED_DAYS} days. The biggest spenders first:`,
  lapsedNone: `Good news: every customer who ordered ${LAPSED_MIN_ORDERS} or more times has ordered in the last ${LAPSED_DAYS} days.`,
  lapsedLine: (orders, spent, last) => `${orders} orders, ${spent} paid, last on ${last}`,
  andMore: (n) => `and ${n} more`,
  bestHead: `Best sellers, last ${PERIOD_DAYS} days:`,
  bestLine: (qty, money) => `${qty.toLocaleString("en-NG")} sold, ${money}`,
  noSales: `No sales in the last ${PERIOD_DAYS} days yet.`,
  slow: (names) => `Not sold in ${SLOW_DAYS} days: ${names}`,
  busy: (days, quiet) => `Busiest days (last ${BUSY_DAYS / 7} weeks): ${days}. Quietest: ${quiet}.`,
  times: (n) => `${n} sale${n === 1 ? "" : "s"}`,
  costsOff: "Cost prices aren't switched on for your shop, so prices can't be checked against cost.",
  belowCostHead: "Priced below your cost price:",
  belowCostLine: (price, from, cost) => `${price} from ${from.toLocaleString("en-NG")}, but costs you ${cost}`,
  soldBelowHead: `Sold below cost in the last ${PERIOD_DAYS} days:`,
  soldBelowLine: (times, loss) => `${times} time${times === 1 ? "" : "s"}, ${loss} lost`,
  noCost: (n) => `${n} item${n === 1 ? " has" : "s have"} no cost price yet. Add ${n === 1 ? "it" : "them"} on the Price list page to check ${n === 1 ? "it" : "them"} too.`,
  tiersHead: `Bulk prices nobody reached in ${TIER_DAYS} days:`,
  tierLine: (from, biggest) => `bulk price from ${from.toLocaleString("en-NG")}, but the biggest order was ${biggest.toLocaleString("en-NG")}`,
  pricesFine: "Nothing is priced below cost and every bulk price was reached. Your prices look healthy.",
  postHead: "Your best sellers and their lowest prices:",
  postListHead: `No sales in the last ${PERIOD_DAYS} days yet, so here are items from your price list:`,
  postLine: (price) => `from ${price}`,
  postNone: "Add prices to your price list first, then I can write a post from what sells.",
  postFallback: (shop, items) => [`🔥 This week at ${shop}:`, ...items.map((i) => `• ${i}`), "", "Send us a message on WhatsApp to order! 📲"].join("\n"),
  winBackFallback: (shop) => `Hi ${NAME_SLOT}, it's been a while! We miss you at ${shop}. Send us a message whenever you need anything, we're here to help.`,
  tasks: {
    shop: "In 3 to 5 short sentences, tell the owner what stands out in these figures and one or two things to do this week.",
    lapsed: `Write one short, warm WhatsApp message the owner can send to each customer who stopped buying, to invite them back. Start it with "Hi ${NAME_SLOT}," exactly, as each customer's name goes there. No discount or price, no numbers at all. Under 50 words. Reply with the message only.`,
    grow: "Give three practical ideas to sell more this month, one short line each starting with •, using the best sellers, slow items and busiest days.",
    prices: "In 3 to 5 short sentences, say what to fix first and how (for example raise the price, check the cost price, or lower the bulk quantity). Never suggest a price or amount.",
    post: `Write a WhatsApp status post (under 60 words, a few emojis) and then, after a blank line, a short ad caption (under 30 words). Use only the items and prices given, written exactly as given. End the status post by asking people to send a message to order. Reply with the two texts only, the status post first.`,
  },
};

const FR: Texts = {
  title: { shop: "Comment va ma boutique ?", lapsed: "Qui n'achète plus ?", grow: "Comment vendre plus ?", prices: "Vérifier mes prix", post: "Écrire mon statut" },
  hint: {
    shop: "Encaissements, commandes, clients fidèles et impayés par rapport au mois dernier",
    lapsed: "Les clients réguliers qui ne commandent plus, avec un message pour les faire revenir",
    grow: "Meilleures ventes, articles lents et vos meilleurs jours",
    prices: "Prix sous le coût, et prix de gros jamais atteints",
    post: "Un statut et un texte de pub à partir de ce qui se vend le mieux",
  },
  periodHead: `${PERIOD_DAYS} derniers jours, avec les ${PERIOD_DAYS} jours d'avant entre parenthèses :`,
  moneyIn: "Encaissé",
  orders: "Commandes",
  average: "Commande moyenne",
  repeatLabel: "Clients fidèles",
  unpaidLabel: "Commandes impayées",
  repeat: (p) => `${p.repeat} sur ${p.customers}`,
  unpaid: (p, money) => (p.unpaid ? `${p.unpaid}, ${money(p.unpaidKobo)}` : "aucune"),
  up: (pct) => `+${pct}%`,
  down: (pct) => `-${pct}%`,
  same: "à peu près pareil",
  lapsedHead: (n) => `${n} client${n === 1 ? " a" : "s ont"} commandé ${LAPSED_MIN_ORDERS} fois ou plus mais rien depuis ${LAPSED_DAYS} jours. Les plus gros acheteurs d'abord :`,
  lapsedNone: `Bonne nouvelle : tous les clients qui ont commandé ${LAPSED_MIN_ORDERS} fois ou plus ont commandé ces ${LAPSED_DAYS} derniers jours.`,
  lapsedLine: (orders, spent, last) => `${orders} commandes, ${spent} payés, la dernière le ${last}`,
  andMore: (n) => `et ${n} de plus`,
  bestHead: `Meilleures ventes, ${PERIOD_DAYS} derniers jours :`,
  bestLine: (qty, money) => `${qty.toLocaleString("fr-FR")} vendus, ${money}`,
  noSales: `Pas encore de ventes ces ${PERIOD_DAYS} derniers jours.`,
  slow: (names) => `Rien vendu depuis ${SLOW_DAYS} jours : ${names}`,
  busy: (days, quiet) => `Jours les plus actifs (${BUSY_DAYS / 7} dernières semaines) : ${days}. Le plus calme : ${quiet}.`,
  times: (n) => `${n} vente${n === 1 ? "" : "s"}`,
  costsOff: "Les prix de revient ne sont pas activés pour votre boutique, donc les prix ne peuvent pas être comparés au coût.",
  belowCostHead: "Vendu sous votre prix de revient :",
  belowCostLine: (price, from, cost) => `${price} à partir de ${from}, mais vous coûte ${cost}`,
  soldBelowHead: `Vendu à perte ces ${PERIOD_DAYS} derniers jours :`,
  soldBelowLine: (times, loss) => `${times} fois, ${loss} perdus`,
  noCost: (n) => `${n} article${n === 1 ? " n'a" : "s n'ont"} pas encore de prix de revient. Ajoutez-le${n === 1 ? "" : "s"} dans la liste de prix pour le${n === 1 ? "" : "s"} vérifier aussi.`,
  tiersHead: `Prix de gros jamais atteints en ${TIER_DAYS} jours :`,
  tierLine: (from, biggest) => `prix de gros à partir de ${from}, mais la plus grosse commande était de ${biggest}`,
  pricesFine: "Rien n'est vendu sous le coût et chaque prix de gros a été atteint. Vos prix ont l'air sains.",
  postHead: "Vos meilleures ventes et leurs prix les plus bas :",
  postListHead: `Pas encore de ventes ces ${PERIOD_DAYS} derniers jours, voici donc des articles de votre liste de prix :`,
  postLine: (price) => `à partir de ${price}`,
  postNone: "Ajoutez d'abord des prix à votre liste, puis je pourrai écrire un statut à partir de ce qui se vend.",
  postFallback: (shop, items) => [`🔥 Cette semaine chez ${shop} :`, ...items.map((i) => `• ${i}`), "", "Écrivez-nous sur WhatsApp pour commander ! 📲"].join("\n"),
  winBackFallback: (shop) => `Bonjour ${NAME_SLOT}, ça fait longtemps ! Vous nous manquez chez ${shop}. Écrivez-nous quand vous voulez, nous sommes là pour vous aider.`,
  tasks: {
    shop: "En 3 à 5 phrases courtes, dites au propriétaire ce qui ressort de ces chiffres et une ou deux choses à faire cette semaine.",
    lapsed: `Écrivez un court message WhatsApp chaleureux que le propriétaire peut envoyer à chaque client qui n'achète plus, pour l'inviter à revenir. Commencez exactement par "Bonjour ${NAME_SLOT},", car le nom de chaque client va là. Pas de remise ni de prix, aucun chiffre. Moins de 50 mots. Répondez avec le message seulement.`,
    grow: "Donnez trois idées concrètes pour vendre plus ce mois-ci, une ligne courte chacune commençant par •, à partir des meilleures ventes, des articles lents et des jours les plus actifs.",
    prices: "En 3 à 5 phrases courtes, dites quoi corriger en premier et comment (par exemple augmenter le prix, vérifier le prix de revient ou baisser la quantité du prix de gros). Ne proposez jamais de prix ni de montant.",
    post: `Écrivez un statut WhatsApp (moins de 60 mots, quelques emojis) puis, après une ligne vide, un court texte de pub (moins de 30 mots). Utilisez seulement les articles et prix donnés, écrits exactement comme donnés. Terminez le statut en invitant à écrire pour commander. Répondez avec les deux textes seulement, le statut d'abord.`,
  },
};

export function advisorTexts(lang: string): Texts {
  return lang === "fr" ? FR : EN;
}

const adviceLang = (lang: string): AdviceLang => (lang === "fr" ? "fr" : "en");

/** "up 18%", "down 5%", or "" when there's nothing to compare with. */
function change(t: Texts, now: number, before: number): string {
  if (!before) return "";
  const pct = Math.round(((now - before) * 100) / before);
  return pct === 0 ? `, ${t.same}` : `, ${pct > 0 ? t.up(pct) : t.down(-pct)}`;
}

function shortDay(d: Date, lang: string): string {
  return d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });
}

function list(t: Texts, names: string[], max: number): string {
  return names.length > max ? `${names.slice(0, max).join(", ")} ${t.andMore(names.length - max)}` : names.join(", ");
}

/** The figures for a question, and what the AI is given. */
interface Worked {
  facts: string[];
  /** Null: nothing for the AI to write (e.g. nobody stopped buying). */
  aiFacts: string | null;
  winBackPeople?: Array<{ name: string | null; waId: string }>;
  postItems?: string[];
}

function work(q: QuestionId, data: AdvisorData, biz: AppBusiness, now: Date): Worked {
  const t = advisorTexts(biz.language);
  const money = (k: number) => formatMoney(k, biz.currency);
  if (q === "shop") {
    const { recent: a, before: b } = shopHealth(data, now);
    const facts = [
      t.periodHead,
      `• ${t.moneyIn}: ${money(a.salesKobo)} (${money(b.salesKobo)})${change(t, a.salesKobo, b.salesKobo)}`,
      `• ${t.orders}: ${a.orders} (${b.orders})${change(t, a.orders, b.orders)}`,
      `• ${t.average}: ${a.averageKobo === null ? "-" : money(a.averageKobo)} (${b.averageKobo === null ? "-" : money(b.averageKobo)})`,
      `• ${t.repeatLabel}: ${t.repeat(a)} (${t.repeat(b)})`,
      `• ${t.unpaidLabel}: ${t.unpaid(a, money)} (${t.unpaid(b, money)})`,
    ];
    return { facts, aiFacts: facts.join("\n") };
  }
  if (q === "lapsed") {
    const people = lapsedCustomers(data, now);
    if (!people.length) return { facts: [t.lapsedNone], aiFacts: null };
    const shown = people.slice(0, LAPSED_SHOWN);
    const facts = [
      t.lapsedHead(people.length),
      ...shown.map((c) => `• ${c.name ?? showWaId(c.waId)}${c.name ? ` (${showWaId(c.waId)})` : ""}: ${t.lapsedLine(c.orders, money(c.spentKobo), shortDay(c.lastOrderAt, biz.language))}`),
      ...(people.length > shown.length ? [t.andMore(people.length - shown.length)] : []),
    ];
    // The AI writes one message for everyone, so it gets no names, numbers or amounts.
    const sells = growth(data, now).best.slice(0, 3).map((s) => s.name);
    return { facts, aiFacts: sells.length ? `The shop's best sellers: ${sells.join(", ")}` : "The shop's best sellers aren't known yet.", winBackPeople: shown.map((c) => ({ name: c.name, waId: c.waId })) };
  }
  if (q === "grow") {
    const g = growth(data, now);
    const busiest = WEEKDAYS.map((day, i) => ({ day: dayName(day, biz.language), n: g.days[i]! })).sort((a, b) => b.n - a.n);
    const facts = [
      ...(g.best.length ? [t.bestHead, ...g.best.slice(0, 5).map((s) => `• ${s.name}: ${t.bestLine(s.quantity, money(s.totalKobo))}`)] : [t.noSales]),
      ...(g.slow.length ? [t.slow(list(t, g.slow, 8))] : []),
      ...(busiest[0]!.n ? [t.busy(busiest.slice(0, 2).filter((d) => d.n).map((d) => `${d.day} (${t.times(d.n)})`).join(", "), `${busiest[6]!.day} (${t.times(busiest[6]!.n)})`)] : []),
    ];
    return { facts, aiFacts: facts.join("\n") };
  }
  if (q === "prices") {
    const p = priceCheck(data, now);
    const facts = [
      ...(p.costsOn ? [] : [t.costsOff]),
      ...(p.belowCost.length ? [t.belowCostHead, ...p.belowCost.slice(0, 8).map((b) => `• ${b.name}: ${t.belowCostLine(money(b.priceKobo), b.fromQuantity, money(b.costKobo))}`)] : []),
      ...(p.soldBelowCost.length ? [t.soldBelowHead, ...p.soldBelowCost.slice(0, 5).map((s) => `• ${s.name}: ${t.soldBelowLine(s.times, money(s.lossKobo))}`)] : []),
      ...(p.unusedTiers.length ? [t.tiersHead, ...p.unusedTiers.slice(0, 8).map((u) => `• ${u.name}: ${t.tierLine(u.fromQuantity, u.biggest)}`)] : []),
      ...(p.noCost ? [t.noCost(p.noCost)] : []),
    ];
    const problems = p.belowCost.length + p.soldBelowCost.length + p.unusedTiers.length;
    if (!problems && p.costsOn) facts.unshift(t.pricesFine);
    return { facts, aiFacts: problems ? facts.join("\n") : null };
  }
  const { items, fromSales } = postItems(data, now);
  if (!items.length) return { facts: [t.postNone], aiFacts: null };
  const lines = items.map((i) => `${i.name} ${t.postLine(money(i.fromKobo))}`);
  const facts = [fromSales ? t.postHead : t.postListHead, ...lines.map((l) => `• ${l}`)];
  return { facts, aiFacts: facts.join("\n"), postItems: lines };
}

const FR_DAYS: Record<string, string> = { Monday: "lundi", Tuesday: "mardi", Wednesday: "mercredi", Thursday: "jeudi", Friday: "vendredi", Saturday: "samedi", Sunday: "dimanche" };
const dayName = (day: string, lang: string) => (lang === "fr" ? FR_DAYS[day]! : day);

export interface AskResult {
  answer: Answer;
  /** Written answers left this month after this one (null: no limit). */
  left: number | null;
}

/**
 * Answers one question for this business. Throws only when the shop's
 * figures can't be read; the AI failing just leaves the advice out.
 */
export async function ask(biz: AppBusiness, advisor: Advisor, q: QuestionId, now: Date, log: Pick<Console, "error"> = console): Promise<AskResult> {
  const limit = biz.features ? await biz.features.limit("business_advisor") : null;
  const monthStart = lagosMonthStart(now);
  const written = async () => advisor.store.written(monthStart).catch((err) => (log.error("Business advisor: couldn't count answers:", err), 0));

  const saved = await advisor.store.recent(q, new Date(now.getTime() - FRESH_HOURS * 3_600_000)).catch((err) => (log.error("Business advisor: couldn't read saved answers:", err), null));
  if (saved) return { answer: saved, left: limit === null ? null : Math.max(0, limit - (await written())) };

  const since = new Date(now.getTime() - 365 * DAY);
  const [orders, counter, products, info] = await Promise.all([
    advisor.store.orders(since),
    biz.counter ? biz.counter.sales(new Date(now.getTime() - TIER_DAYS * DAY), now) : Promise.resolve([]),
    biz.prices.products(),
    biz.data.info().catch(() => null),
  ]);
  const data: AdvisorData = { orders, counter: counter.filter((s) => !s.voided).map((s) => ({ at: s.at, totalKobo: s.totalKobo, lines: s.lines })), products };
  const worked = work(q, data, biz, now);
  const t = advisorTexts(biz.language);

  const used = limit === null ? 0 : await written();
  const allowed = limit === null || used < limit;
  const advice =
    worked.aiFacts !== null && allowed && advisor.writer
      ? await advisor.writer.write({ shopName: biz.name, description: info?.description ?? null, language: adviceLang(biz.language), facts: worked.aiFacts, task: t.tasks[q] })
      : null;

  const answer: Answer = { question: q, at: now.toISOString(), facts: worked.facts, advice };
  if (worked.aiFacts !== null && !allowed) answer.limitReached = true;
  if (worked.winBackPeople) {
    const draft = advice?.includes(NAME_SLOT) ? advice : t.winBackFallback(biz.name);
    answer.winBack = { draft, people: worked.winBackPeople };
    answer.advice = null;
  }
  if (worked.postItems && !advice) answer.advice = t.postFallback(biz.name, worked.postItems);

  await advisor.store.save(answer, advice !== null).catch((err) => log.error("Business advisor: couldn't save the answer:", err));
  return { answer, left: limit === null ? null : Math.max(0, limit - used - (advice !== null ? 1 : 0)) };
}

/** A win-back message with the customer's first name in it ("there" when we don't know it). */
export function winBackFor(draft: string, name: string | null, lang: string): string {
  const first = name?.trim().split(/\s+/)[0];
  return draft.replace(NAME_SLOT, first || (lang === "fr" ? "" : "there")).replace(/\s+,/, ",");
}

/** The answer as a WhatsApp message. */
export function answerText(biz: Pick<AppBusiness, "language">, answer: Answer, left: number | null): string {
  const t = advisorTexts(biz.language);
  const fr = biz.language === "fr";
  const parts = [`*${t.title[answer.question]}*`, answer.facts.join("\n")];
  if (answer.winBack) {
    parts.push(`${fr ? "✍️ Message à leur envoyer" : "✍️ A message to send them"}:\n${answer.winBack.draft.replace(NAME_SLOT, fr ? "[prénom]" : "[their name]")}`);
    parts.push(fr ? "Dans l'appli, chaque client a un bouton pour l'envoyer avec son prénom." : "In your app, each customer has a button that sends it with their name.");
  }
  if (answer.advice) parts.push(answer.question === "post" ? answer.advice : `💡 ${answer.advice}`);
  if (answer.limitReached) {
    parts.push(fr ? "Vous avez utilisé les réponses écrites de ce mois-ci : voici les chiffres seulement. Il y en aura d'autres le mois prochain." : "You've used this month's written answers, so this one has the figures only. More come next month.");
  } else if (left !== null && left <= 3) {
    parts.push(fr ? `Réponses écrites restantes ce mois-ci : ${left}.` : `Written answers left this month: ${left}.`);
  }
  parts.push(fr ? "Une autre question ? Envoyez *advice*." : "Another question? Send *advice*.");
  return parts.join("\n\n");
}
