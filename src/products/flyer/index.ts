import type { PaidHandler, PaymentLinks } from "../../core/payments/payments.js";
import { promoAppliedText, promoCommand, promoRefusedText, takePromoCode, type PromoAdmin } from "../../core/payments/promos.js";
import type { Product, Reply } from "../../core/product.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import {
  birthdaysCelebratedOn,
  daysUntil,
  formatMonthDay,
  lagosNow,
  parseBirthday,
  type MonthDay,
} from "./dates.js";
import {
  placeholderCutout,
  placeholderPortrait,
  renderBirthdayFlyer,
  renderDesignSheet,
  renderEventFlyer,
  type FlyerStyle,
} from "./render.js";
import { cutOut } from "./cutout.js";
import { editPhoto, findPhotoEdit, NoPersonError, PHOTO_EDITS, preparePhoto, tonePhoto, type PhotoEdit } from "./photo.js";
import { COLOUR_NAMES, findTheme, parseColour, THEMES, themeById } from "./themes.js";
import { fetchPicture, fetchSheet, isCsv, MAX_ROWS, parseCsv, rowsFromTable, type ImportRow } from "./import.js";
import {
  addMonths,
  allowsDesign,
  cheapestWith,
  currentPlan,
  findPlan,
  formatNaira,
  onTrial,
  planById,
  PLANS,
  type Plan,
  type Trial,
} from "./plans.js";
import type { FlyerStore, Group, Member, Picture } from "./store.js";
import type { WishWriter } from "./wish.js";
import { guessLanguage, writtenLang, type Lang } from "../../core/i18n.js";

// Phase 3: birthday and event flyers for WhatsApp groups (alumni, friends).
//
// Group admins chat with the bot on its own WhatsApp number:
// - a photo captioned "add Ada Okafor, 14 March" saves a member; their photo
//   is framed and brightened automatically, and "brighter", "rotate" and a few
//   other words touch it up further,
// - a photo captioned "logo" sets the group's logo,
// - any other photo comes back as an event flyer: the photo with the logo
//   and the caption on it.
// - "design" shows the flyer designs to choose from; "colour" and a photo
//   captioned "background" change the look further.
// On each member's birthday morning, the bot sends the admins a finished
// birthday flyer and a short message, ready to forward to the group.
// With open sign-up, anyone who messages the number can set up their own group.

export interface FlyerBotOptions {
  store: FlyerStore;
  wishes: WishWriter;
  /** WhatsApp numbers that run the service: they can always create groups and hear about sign-ups. */
  owners: string[];
  /** Let anyone set up one group of their own, not just owners. */
  openSignup: boolean;
  /** The service's name, used when greeting new people. */
  brandName: string;
  /** Small print on every flyer, e.g. "Made with FlyerBot · wa.me/234...". Empty for none. */
  credit?: string;
  /** Lagos hour (0-23) from which birthday flyers go out. */
  sendHour: number;
  render?: {
    birthday: typeof renderBirthdayFlyer;
    event: typeof renderEventFlyer;
    designSheet: typeof renderDesignSheet;
    /** Cuts the person out of a photo (see cutout.ts). */
    cutout: typeof cutOut;
  };
  /** Touching up photos (see photo.ts). */
  photos?: {
    prepare: typeof preparePhoto;
    tone: typeof tonePhoto;
    edit: typeof editPhoto;
  };
  log?: Pick<Console, "info" | "error">;
  /** Asks an admin for their email for setup tips, once their group has 3 members; null when not to ask. Off when not given. */
  askEmail?: (a: { waId: string; groupId: string }) => Promise<string | null>;
  /** For downloading Google Sheets and photo links. */
  fetch?: typeof fetch;
  /** Called with work that carries on after replying (a spreadsheet import), so tests can wait for it. */
  onBackground?: (work: Promise<void>) => void;
  /** The current time; tests replace it to check when plans run out. */
  now?: () => Date;
  /** The free trial new groups start with (see plans.ts). Leave out for none. */
  trial?: Trial;
  /** Paystack checkout links. Without them, owners take payment by hand and send "set plan". */
  payments?: PaymentLinks;
  /** Promo codes (DAYONES): owners see and change them by sending "promos". */
  promos?: PromoAdmin;
}

/** One birthday flyer ready to go to one admin. */
export interface BirthdayDelivery {
  to: string;
  memberName: string;
  groupName: string;
  flyer: Uint8Array;
  wish: string;
  lang?: Lang;
}

export interface BirthdayDeliverer {
  /** False when this admin can't be messaged right now; they're tried again on the next run. */
  canReach(to: string): Promise<boolean>;
  send(d: BirthdayDelivery): Promise<void>;
}

export interface FlyerBot extends Product {
  /**
   * Makes today's birthday flyers that haven't gone out yet and hands each to
   * `delivery`, once per admin. A birthday is recorded first so it's never sent
   * twice; if it couldn't reach any admin, the record is undone so the next
   * run tries again.
   */
  sendDueBirthdays(now: Date, delivery: BirthdayDeliverer): Promise<void>;
  /** A plan payment went through: moves the group onto the plan and tells the payer and owners. */
  planPaid: PaidHandler;
}

const HELP = `Here's what I can do:

🎂 *Add a member*: send their photo with the caption
   add Ada Okafor, 14 March
🖼️ *Event flyer*: send any photo with the text you want on it, e.g.
   Homecoming: Sat 12 Dec, 4pm, Alumni Hall
🏷️ *Logo*: send your group logo with the caption *logo* (send it as a file/document to keep a see-through background)
🎨 *Design*: send *design* to browse the flyer designs and pick one; *see 8* shows design 8 full size
📋 *Import a list*: send a CSV file, or paste a Google Sheets link, with columns *Name*, *Birthday* and *Photo* (a photo link, e.g. from Google Drive)

Other commands:
• *members*: everyone and their birthdays
• *upcoming*: birthdays in the next 30 days
• *today*: today's birthday flyers
• *flyer Ada*: see Ada's birthday flyer now
• *remove Ada Okafor*
• a photo captioned *photo Ada Okafor*: add or change Ada's photo
• *brighter*, *darker*, *warmer*, *black and white*, *plain background*, *closer*, *rotate* or *original*: touch up the last photo you added (or add a name, e.g. *rotate Ada*)
• *change amadi to Amadi*: fix a name, a date (*change date to 30 October*), the group name or an event flyer's words, then I'll remake the flyer
• *add admin 08012345678*: let someone else manage this group
• *colour gold* (or a code like #1a7f37): change the highlight colour; *colour reset* to undo
• *background*: send a picture with this caption to use it behind your birthday flyers; *background off* to undo
• *groups*: your groups; *switch 2* to change group; *new group* to add one
• *plan*: your group's plan; *plans* for prices
• *support*: message a person on our team

On each birthday I'll send you the flyer in the morning, ready to forward to the group.

🇫🇷 Send *français* to use me in French.`;

const HELP_FR = `Voici ce que je sais faire :

🎂 *Ajouter un membre* : envoyez sa photo avec la légende
   ajouter Awa Diallo, 14 mars
🖼️ *Flyer d'événement* : envoyez n'importe quelle photo avec le texte à mettre dessus, par exemple
   Retrouvailles : sam. 12 déc., 16h, salle des fêtes
🏷️ *Logo* : envoyez le logo du groupe avec la légende *logo* (en document pour garder un fond transparent)
🎨 *Modèle* : envoyez *design* pour voir les modèles de flyers et en choisir un ; *voir 8* montre le modèle 8 en grand
📋 *Importer une liste* : envoyez un fichier CSV, ou collez un lien Google Sheets, avec les colonnes *Name*, *Birthday* et *Photo* (un lien vers la photo, par exemple Google Drive)

Autres commandes :
• *membres* : tout le monde et leurs anniversaires
• *à venir* : les anniversaires des 30 prochains jours
• *aujourd'hui* : les flyers d'anniversaire du jour
• *flyer Awa* : voir le flyer d'Awa maintenant
• *supprimer Awa Diallo*
• une photo avec la légende *photo Awa Diallo* : ajouter ou changer la photo d'Awa
• *plus clair*, *plus sombre*, *plus chaud*, *noir et blanc*, *fond uni*, *plus près*, *pivoter* ou *originale* : retoucher la dernière photo ajoutée (ou ajoutez un nom, par exemple *pivoter Awa*)
• *changer awa en Awa* : corriger un nom, une date (*changer la date en 30 octobre*), le nom du groupe ou les mots d'un flyer d'événement, puis je refais le flyer
• *ajouter admin +225 07 12 34 56 78* : laisser quelqu'un d'autre gérer ce groupe
• *couleur or* (ou un code comme #1a7f37) : changer la couleur ; *couleur par défaut* pour annuler
• *fond* : envoyez une image avec cette légende pour l'utiliser derrière vos flyers ; *sans fond* pour annuler
• *groupes* : vos groupes ; *changer 2* pour changer de groupe ; *nouveau groupe* pour en ajouter un
• *formule* : la formule de votre groupe ; *formules* pour les prix
• *assistance* : écrire à une personne de notre équipe

Le jour de chaque anniversaire, je vous envoie le flyer le matin, prêt à transférer au groupe.

🇬🇧 Send *english* to use me in English.`;

const helpText = (lang: Lang) => (lang === "fr" ? HELP_FR : HELP);
// Pidgin is optional: a message without it goes out in English.
const tr = (lang: Lang, en: string, fr: string, pcm?: string) => (lang === "fr" ? fr : lang === "pcm" ? (pcm ?? en) : en);

/**
 * French commands, turned into the English ones the bot reads, so French
 * admins can type "membres" or "ajouter Awa, 14 mars". Anything else is left as it is.
 */
export function fromFrench(text: string): string {
  const rules: Array<[RegExp, string]> = [
    [/^aide$/i, "help"],
    [/^(membres|liste)$/i, "members"],
    [/^(à venir|a venir|anniversaires|prochains anniversaires)$/i, "upcoming"],
    [/^(aujourd'hui|aujourd’hui|aujourdhui)$/i, "today"],
    [/^(?:supprimer|retirer|enlever)\s+/i, "remove "],
    [/^ajouter\s+admin\s+/i, "add admin "],
    [/^ajouter\b/i, "add"],
    [/^anniversaire\s+(?=\S+.*\d)/i, "add "],
    [/^couleur\s+(?:par défaut|par defaut|d'origine|aucune)$/i, "colour reset"],
    [/^couleur\s+/i, "colour "],
    [/^(sans fond|fond désactivé|fond desactive|retirer le fond)$/i, "background off"],
    [/^fond$/i, "background"],
    [/^groupes$/i, "groups"],
    [/^(?:changer|modifier|corriger|remplacer)\s+(?=.+\s(?:en|par)\s)/i, "change "],
    [/^(?:changer|passer)\s+(?:au\s+groupe\s+|à\s+|a\s+)?(?=\S)/i, "switch "],
    [/^nouveau\s+groupe\b/i, "new group"],
    [/^(formule|ma formule|abonnement)$/i, "plan"],
    [/^(formules|tarifs|prix)$/i, "plans"],
    [/^voir\s+(?:le\s+)?(?:modèle\s+|modele\s+)?/i, "see "],
    [/^modèles?$/i, "design"],
    [/^(?:modèle|modele)\s+/i, "design "],
    [/^(?:aperçu|apercu)\s+/i, "flyer "],
    [/^(passer|plus tard|suivant)$/i, "skip"],
    [/^annuler$/i, "cancel"],
    [/^(assistance|parler à quelqu'un|parler a quelqu'un|réclamation|reclamation)\b/i, "support"],
    [/^plus de modèles$/i, "more designs"],
  ];
  for (const [from, to] of rules) if (from.test(text)) return text.replace(from, to);
  return text;
}

const JPEG = "image/jpeg";
const FREE_SUMMARY = planById("free").summary;
/** How many designs go on one picture when admins browse them. */
const DESIGNS_PER_PAGE = 6;
const UPGRADE = /^(?:upgrade|renew)(?:\s+(?:to\s+)?(.+?))?(?:\s+(?:for\s+)?(\d+)\s*(months?|years?))?$/i;
const DAY_MS = 24 * 60 * 60 * 1000;
/** "see 8", "see design 8", "see gala". */
const SEE_DESIGN = /^see\s+(?:design\s+)?(.+)$/i;

/** The page number in "designs page 2", "design page 2", "page 2" or "more designs" (page 2); null otherwise. */
function designPageWanted(text: string): number | null {
  if (/^more designs?$/i.test(text)) return 2;
  const m = text.match(/^(?:designs?\s+)?page\s+(\d{1,3})$/i);
  return m ? Number(m[1]) : null;
}
const GREETING = /^(hi+|hello|hey|hiya|good (morning|afternoon|evening|day)|start|yo|howdy|sup|ok|okay)[!.\s]*$/i;

/** Turns "0801 234 5678" or "+234 801 234 5678" into 2348012345678. */
export function normalizeNumber(text: string): string | null {
  let digits = text.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = `234${digits.slice(1)}`;
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

/** "add Ada Okafor, 14 March" (or without the comma) -> name and birthday. */
export function parseAddCaption(text: string): { name: string; birthday: MonthDay | null } | null {
  const rest = text.replace(/^\s*(add|birthday)\b[:\s]*/i, "").trim();
  const separated = rest.match(/^(.+?)\s*(?:,|\s-\s|–|:)\s*(.+)$/);
  if (separated) return { name: tidyName(separated[1]!), birthday: parseBirthday(separated[2]!) };

  // No comma: the date is wherever the rest of the caption reads as one.
  const words = rest.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const tail = words.slice(i).join(" ");
    if (!/^(\d|jan|feb|f[ée]v|mar|apr|avr|may|mai|jun|juin|jul|juil|aug|ao[uû]|sep|oct|nov|dec|d[ée]c)/i.test(tail)) continue;
    const birthday = parseBirthday(tail);
    if (birthday) return { name: tidyName(words.slice(0, i).join(" ")), birthday };
  }
  return null;
}

/** Tidies spacing, and capitalises a name typed all in lowercase ("amadi nnadozie" -> "Amadi Nnadozie"). */
export function tidyName(name: string): string {
  const tidy = name.trim().replace(/\s+/g, " ");
  if (tidy !== tidy.toLowerCase()) return tidy;
  return tidy.replace(/(^|[\s'’-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** "change Saturday to Sunday": the verb, then every way of splitting the rest into old and new text. */
const TEXT_EDIT = /^(?:edit|change|fix|correct|update|rename|replace)\s+(.+)$/i;
const TEXT_EDIT_JOIN = /\s+(?:to|with|into|en|par)\s+/gi;

export function textEditsWanted(text: string): Array<{ from: string; to: string }> {
  const rest = text.match(TEXT_EDIT)?.[1];
  if (!rest) return [];
  const unquote = (t: string) => t.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();
  const splits = [];
  for (const join of rest.matchAll(TEXT_EDIT_JOIN)) {
    const from = unquote(rest.slice(0, join.index));
    const to = unquote(rest.slice(join.index! + join[0].length));
    if (from && to) splits.push({ from, to });
  }
  return splits;
}

/** Replaces the first match of `from` in `text`, whatever its capitals. */
function swapText(text: string, from: string, to: string): string {
  const at = text.toLowerCase().indexOf(from.toLowerCase());
  return at < 0 ? text : text.slice(0, at) + to + text.slice(at + from.length);
}

const sameDay = (a: MonthDay, b: MonthDay | null) => !!b && a.month === b.month && a.day === b.day;

function findMember(members: Member[], query: string): Member[] {
  const q = query.trim().toLowerCase();
  const exact = members.filter((m) => m.name.toLowerCase() === q);
  if (exact.length) return exact;
  return members.filter((m) => m.name.toLowerCase().includes(q));
}

export function createFlyerBot(opts: FlyerBotOptions): FlyerBot {
  const log = opts.log ?? console;
  const render = opts.render ?? {
    birthday: renderBirthdayFlyer,
    event: renderEventFlyer,
    designSheet: renderDesignSheet,
    cutout: cutOut,
  };
  const photos = opts.photos ?? { prepare: preparePhoto, tone: tonePhoto, edit: editPhoto };
  /** Each admin's last member photo, so "brighter" on its own knows whose. Forgotten on restart; a name still works. */
  const lastPhoto = new Map<string, string>();
  /** Each admin's last event flyer, so its words can be corrected. Forgotten on restart. */
  const lastEvent = new Map<string, { groupId: string; photo: Uint8Array; caption: string }>();
  /** The language each number last wrote in, for people without a group yet. Forgotten on restart. */
  const spoken = new Map<string, Lang>();
  const owners = new Set(opts.owners);
  const now = opts.now ?? (() => new Date());
  const planOf = (group: Group) => currentPlan(group, now());
  const trialPlan = opts.trial ? planById(opts.trial.plan) : undefined;

  /**
   * Counts finished flyers against a group's free trial. Returns a line to add
   * to the reply when the trial is nearly over or has just ended, otherwise "".
   */
  async function useTrialFlyers(group: Group, count: number): Promise<string> {
    if (!onTrial(group, now()) || count < 1) return "";
    const left = Math.max(0, group.trialFlyersLeft! - count);
    await opts.store.setTrialFlyersLeft(group.id, left);
    group.trialFlyersLeft = left;
    const label = planById(group.plan).label;
    const lang = group.language;
    if (left === 0) {
      return tr(
        lang,
        `That was the last flyer of your free *${label}* trial, so *${group.name}* is now on the Free plan (${FREE_SUMMARY}). Send *upgrade ${group.plan}* to keep everything, or *plans* to compare.`,
        `C'était le dernier flyer de votre essai gratuit *${label}* : *${group.name}* passe à la formule Free (${planById("free").summaryFr}). Envoyez *upgrade ${group.plan}* pour tout garder, ou *formules* pour comparer.`,
      );
    }
    if (left <= 5) return tr(lang, `${left} flyer${left === 1 ? "" : "s"} left in your free *${label}* trial.`, `Il reste ${left} flyer${left === 1 ? "" : "s"} dans votre essai gratuit *${label}*.`);
    return "";
  }

  async function logoFor(group: Group): Promise<Uint8Array | undefined> {
    if (!group.logoPath) return undefined;
    try {
      return await opts.store.loadPicture(group.logoPath);
    } catch (err) {
      log.error(`Could not load the logo for ${group.name}:`, err);
      return undefined;
    }
  }

  async function styleFor(group: Group): Promise<FlyerStyle> {
    let background: Uint8Array | undefined;
    if (group.backgroundPath) {
      try {
        background = await opts.store.loadPicture(group.backgroundPath);
      } catch (err) {
        log.error(`Could not load the background for ${group.name}:`, err);
      }
    }
    // Anything the group's plan doesn't include (for example after a paid
    // plan runs out) falls back to the plain version, without losing the setting.
    const plan = planOf(group);
    const theme = plan.designs === "all" || plan.designs.includes(group.theme) ? group.theme : plan.designs[0]!;
    return {
      theme: themeById(theme),
      accent: plan.colour ? (group.accent ?? undefined) : undefined,
      background: plan.ownBackground ? background : undefined,
      credit: plan.credit ? opts.credit || undefined : undefined,
    };
  }

  /** The reply when a group's plan doesn't include something: why, then the cheapest plan that does. */
  function needsPlan(why: string, has: (p: Plan) => boolean, lang: Lang = "en"): Reply {
    const plan = cheapestWith(has);
    return {
      text: tr(
        lang,
        `${why} Upgrade to *${plan.label}* for this: send *upgrade ${plan.id}* and we'll get you set up, or *plans* to compare.`,
        `${why} Passez à *${plan.label}* pour cela : envoyez *upgrade ${plan.id}* et nous nous occupons du reste, ou *formules* pour comparer.`,
      ),
    };
  }

  /** "Importing a list isn't included on the Free plan." `fr` is the French for `what`. */
  const notOn = (what: string, group: Group, fr = what) =>
    tr(group.language, `${what} isn't included on the *${planOf(group).label}* plan.`, `${fr} n'est pas inclus dans la formule *${planOf(group).label}*.`);

  /** Null if the group has room for one more member, otherwise the reply saying it's full. */
  async function fullReply(group: Group, name: string): Promise<Reply | null> {
    const max = planOf(group).maxMembers;
    if (max === null) return null;
    const members = await opts.store.members(group.id);
    if (members.length < max || members.some((m) => m.name.toLowerCase() === name.toLowerCase())) return null;
    return needsPlan(
      tr(group.language, `${group.name} has ${members.length} members, the most the *${planOf(group).label}* plan allows.`, `${group.name} compte ${members.length} membres, le maximum de la formule *${planOf(group).label}*.`),
      (p) => p.maxMembers === null || p.maxMembers > max,
      group.language,
    );
  }

  async function plansText(lang: Lang = "en"): Promise<string> {
    let prices = new Map<string, number | null>();
    let yearly = new Map<string, number | null>();
    let from = new Map<string, number | null>();
    try {
      [prices, yearly] = await Promise.all([opts.store.planPrices(), opts.store.planYearlyPrices()]);
    } catch (err) {
      log.error("Could not load plan prices:", err);
    }
    try {
      from = (await opts.store.planStartingPrices?.()) ?? from;
    } catch (err) {
      // Most likely migration 0035 hasn't been run yet.
      log.error("Could not load plan starting prices:", err);
    }
    const fr = lang === "fr";
    const price = (p: Plan) => {
      const kobo = prices.get(p.id);
      if (p.id === "free") return fr ? "gratuit" : "free";
      if (kobo === undefined || kobo === null) {
        const start = from.get(p.id);
        if (fr) return start ? `à partir de ${formatNaira(start)} par mois, convenu avec vous` : "prix sur demande";
        return start ? `from ${formatNaira(start)} a month, agreed with you` : "price on request";
      }
      const perYear = yearly.get(p.id);
      if (fr) {
        const yearlyFr = perYear === undefined || perYear === null ? "" : `, ou ${formatNaira(perYear)} par mois payé à l'année (${formatNaira(perYear * 12)} par an)`;
        return `${formatNaira(kobo)} par mois${yearlyFr}`;
      }
      const yearlyText =
        perYear === undefined || perYear === null ? "" : `, or ${formatNaira(perYear)} a month paid yearly (${formatNaira(perYear * 12)} a year)`;
      return `${formatNaira(kobo)} a month${yearlyText}`;
    };
    const lines = PLANS.map((p) => `*${p.label}* (${price(p)}) : ${fr ? p.summaryFr : p.summary}.`.replace(") : ", fr ? ") : " : "): "));
    if (fr) {
      const promoFr = opts.payments ? " Un code promo ? Ajoutez-le à la fin, par exemple *upgrade standard CODE*." : "";
      return `Formules ${opts.brandName} :\n\n${lines.join("\n\n")}\n\nEnvoyez *upgrade* et le nom de la formule, par exemple *upgrade standard*.${promoFr}`;
    }
    const promo = opts.payments ? " Got a promo code? Add it at the end, e.g. *upgrade standard CODE*." : "";
    return `${opts.brandName} plans:\n\n${lines.join("\n\n")}\n\nSend *upgrade* and the plan's name, e.g. *upgrade standard*.${promo}`;
  }

  function formatDate(date: Date, lang: Lang = "en"): string {
    const d = lagosNow(date);
    return `${formatMonthDay(d, lang)} ${d.year}`;
  }

  /** A member to show designs with: the group's first member, or an outline before there are any. */
  async function sampleFor(group: Group) {
    const members = await opts.store.members(group.id);
    const first = members.find((m) => m.photoPath) ?? members[0];
    const photo = first?.photoPath ? await opts.store.loadPicture(first.photoPath) : await placeholderPortrait();
    return {
      photo,
      cutout: first?.photoPath ? await cutoutOf(first.photoPath, photo) : await placeholderCutout(),
      name: first?.name ?? tr(group.language, "Your Member", "Votre Membre"),
      dateLabel: first ? formatMonthDay(first.birthday, group.language) : formatMonthDay({ month: 10, day: 14 }, group.language),
      groupName: group.name,
      logo: await logoFor(group),
      lang: writtenLang(group.language),
    };
  }

  /**
   * The person cut out of a saved photo, made the first time a design needs it
   * and saved for next time. Undefined when there's no person in the photo or
   * the cut-out fails; designs then use the plain photo.
   */
  async function cutoutOf(photoPath: string, photo: Uint8Array): Promise<Uint8Array | undefined> {
    try {
      const saved = await opts.store.loadCutout(photoPath);
      if (saved !== undefined) return saved ?? undefined;
      const made = await render.cutout(photo);
      await opts.store.saveCutout(photoPath, made);
      return made ?? undefined;
    } catch (err) {
      log.error("Could not cut out a photo:", err);
      return undefined;
    }
  }

  /** A new member photo, framed and brightened, with the photo as sent kept alongside. If that fails, the photo as sent. */
  async function touchUp(picture: Picture): Promise<{ photo: Picture; original?: Picture }> {
    try {
      return { photo: { data: await photos.prepare(picture.data), mimeType: JPEG }, original: picture };
    } catch (err) {
      log.error("Could not touch up a photo:", err);
      return { photo: picture };
    }
  }

  /** The member's photo with the edits to choose from, as a tappable list. */
  async function photoSaved(lead: string, member: Member, group: Group, from: string): Promise<Reply> {
    lastPhoto.set(from, member.id);
    lastEvent.delete(from);
    const first = member.name.split(" ")[0];
    const fr = group.language === "fr";
    return {
      text: lead,
      images: [{ data: await birthdayFlyer(member, group), mimeType: JPEG }],
      list: {
        body: fr
          ? `J'ai centré la photo de ${first} et corrigé la lumière. Envie de changer quelque chose ? Touchez *Retoucher*, ou tapez simplement *plus clair*, *pivoter*, etc. Nom ou date à corriger ? Tapez par exemple *changer le nom en Awa Diallo*.`
          : `I've centred ${first}'s photo and fixed the light. Want to change anything? Tap *Edit photo*, or just type *brighter*, *rotate* and so on. Name or date wrong? Type e.g. *change name to Ada Okafor*.`,
        button: fr ? "Retoucher" : "Edit photo",
        rows: PHOTO_EDITS.map((e) => ({ id: `${e.word} ${member.name}`, title: fr ? e.titleFr : e.title, description: fr ? e.descriptionFr : e.description })),
      },
    };
  }

  /** From the third member on, asks an English-speaking admin once for their email (the tips are in English). */
  async function withEmailAsk(reply: Reply, group: Group, from: string): Promise<Reply> {
    if (!opts.askEmail || group.language === "fr" || !reply.list) return reply;
    const count = (await opts.store.members(group.id)).length;
    if (count < 3) return reply;
    const ask = await opts.askEmail({ waId: from, groupId: group.id });
    return ask ? { ...reply, list: { ...reply.list, body: `${reply.list.body}\n\nNice, ${count} members saved. ${ask}` } } : reply;
  }

  /** "brighter", "rotate Ada Okafor", "black and white Ada"... -> the edit and who it's for. */
  function photoEditWanted(text: string): { edit: PhotoEdit; name: string } | null {
    const words = text.trim().split(/\s+/);
    for (let i = Math.min(3, words.length); i >= 1; i--) {
      const edit = findPhotoEdit(words.slice(0, i).join(" "));
      if (edit) return { edit, name: words.slice(i).join(" ").replace(/^for\s+/i, "") };
    }
    return null;
  }

  async function changePhoto(group: Group, from: string, edit: PhotoEdit, name: string): Promise<Reply> {
    const members = await opts.store.members(group.id);
    const found = name ? findMember(members, name) : members.filter((m) => m.id === lastPhoto.get(from));
    const lang = group.language;
    if (found.length !== 1) {
      if (name) return { text: notFound(found, name, lang) };
      const word = PHOTO_EDITS.find((e) => e.edit === edit)!;
      return { text: tr(lang, `Whose photo? Add their name, e.g. *${word.word} Ada Okafor*.`, `La photo de qui ? Ajoutez son nom, par exemple *${word.wordFr} Awa Diallo*.`) };
    }
    const m = found[0]!;
    if (!m.photoPath) return { text: tr(lang, `${m.name} has no photo yet. Send one with the caption *photo ${m.name}*.`, `${m.name} n'a pas encore de photo. Envoyez-en une avec la légende *photo ${m.name}*.`) };
    const current = await opts.store.loadPicture(m.photoPath!);
    const kept = await opts.store.loadOriginal(m.photoPath!);
    if (edit === "original" && !kept) return { text: tr(lang, `${m.name}'s photo is already as it was sent.`, `La photo de ${m.name} est déjà telle qu'envoyée.`) };
    const original = kept ?? current;
    let result: Awaited<ReturnType<typeof editPhoto>>;
    try {
      result = await photos.edit(edit, current, original);
    } catch (err) {
      if (err instanceof NoPersonError) {
        return { text: tr(lang, `I couldn't find a person in ${m.name}'s photo, so I left the background as it is.`, `Je n'ai pas trouvé de personne sur la photo de ${m.name}, j'ai donc laissé le fond tel quel.`) };
      }
      throw err;
    }
    const saved = await opts.store.saveMember(group.id, m.name, m.birthday, { data: result.photo, mimeType: JPEG }, {
      data: result.original ?? original,
      mimeType: JPEG,
    });
    const done =
      edit === "original"
        ? tr(lang, `Back to ${m.name}'s photo as you sent it ✅`, `Retour à la photo de ${m.name} telle qu'envoyée ✅`)
        : tr(lang, `Done ✅ Here's ${m.name}'s flyer now:`, `C'est fait ✅ Voici le flyer de ${m.name} :`, `E don do ✅ See ${m.name} flyer now:`);
    return photoSaved(done, saved, group, from);
  }

  type TextTarget =
    | { field: "name"; member: Member; value: (to: string) => string }
    | { field: "birthday"; member: Member }
    | { field: "group"; value: (to: string) => string }
    | { field: "caption"; value: (to: string) => string };

  /** Where `from` appears: on the flyer just made first, then any member, then the group name. */
  function findText(from: string, group: Group, members: Member[], admin: string): TextTarget | null {
    const last = members.find((m) => m.id === lastPhoto.get(admin));
    const event = lastEvent.get(admin);
    const whole = (to: string) => to;
    const has = (text: string) => text.toLowerCase().includes(from.toLowerCase());
    const date = parseBirthday(from);

    // "name", "date", "group name", "Ada's birthday", "le nom de Awa"...
    const key = from.toLowerCase().replace(/^(?:(?:the|le|la)\s+|l['’])/, "");
    if (/^group(?:['’]s)?(?:\s+name)?$|^nom du groupe$/.test(key)) return { field: "group", value: whole };
    const field = key.match(/^(?:(.+?)['’]s\s+)?(name|nom|birthday|date|anniversaire)(?:\s+(?:of|for|de|d['’])\s*(.+))?$/);
    if (field) {
      const whose = field[1] ?? field[3];
      const who = whose ? findMember(members, whose) : last ? [last] : [];
      if (who.length !== 1) return null;
      return field[2] === "name" || field[2] === "nom" ? { field: "name", member: who[0]!, value: whole } : { field: "birthday", member: who[0]! };
    }

    if (event?.groupId === group.id && has(event.caption)) {
      return { field: "caption", value: (to) => swapText(event.caption, from, to) };
    }
    if (last && has(last.name)) return { field: "name", member: last, value: (to) => swapText(last.name, from, to) };
    if (last && date && sameDay(last.birthday, date)) return { field: "birthday", member: last };

    const exact = members.filter((m) => m.name.toLowerCase() === from.toLowerCase());
    if (exact.length === 1) return { field: "name", member: exact[0]!, value: whole };
    if (has(group.name)) return { field: "group", value: (to) => swapText(group.name, from, to) };
    const partly = members.filter((m) => has(m.name));
    if (partly.length === 1) return { field: "name", member: partly[0]!, value: (to) => swapText(partly[0]!.name, from, to) };
    const born = date ? members.filter((m) => sameDay(m.birthday, date)) : [];
    if (born.length === 1) return { field: "birthday", member: born[0]! };
    return null;
  }

  /** "change amadi nnadozie to Amadi Nnadozie", "change date to 30 October", "change 4pm to 5pm"... */
  async function changeText(group: Group, from: string, edits: Array<{ from: string; to: string }>): Promise<Reply> {
    const lang = group.language;
    const members = await opts.store.members(group.id);
    let target: TextTarget | null = null;
    let to = "";
    // Longest old words first, so "change Back to School to Back to Base" isn't read as changing "Back".
    for (const edit of [...edits].reverse()) {
      target = findText(edit.from, group, members, from);
      to = edit.to;
      if (target) break;
    }
    if (!target) {
      const old = edits[0]!.from;
      return {
        text: tr(
          lang,
          `I couldn't find "${old}" on your flyers. Type the words as they are now, then the new ones, e.g. *change ada okafor to Ada Okafor* or *change date to 30 October*.`,
          `Je ne trouve pas « ${old} » sur vos flyers. Tapez les mots tels qu'ils sont, puis les nouveaux, par exemple *changer awa diallo en Awa Diallo* ou *changer la date en 30 octobre*.`,
        ),
      };
    }

    if (target.field === "caption") {
      const event = lastEvent.get(from)!;
      const caption = target.value(to);
      lastEvent.set(from, { ...event, caption });
      const flyer = await render.event({ photo: event.photo, caption, logo: await logoFor(group), style: await styleFor(group) });
      return { text: tr(lang, "Done ✅ Here's the corrected flyer:", "C'est fait ✅ Voici le flyer corrigé :", "E don do ✅ See the correct flyer:"), images: [{ data: flyer, mimeType: JPEG }] };
    }

    if (target.field === "group") {
      const name = target.value(to).trim().replace(/\s+/g, " ").slice(0, 80);
      await opts.store.renameGroup(group.id, name);
      const renamed = { ...group, name };
      const last = members.find((m) => m.id === lastPhoto.get(from));
      const flyer = last ? await birthdayFlyer(last, renamed) : await render.birthday({ ...(await sampleFor(renamed)), style: await styleFor(renamed) });
      return {
        text: tr(lang, `Group name changed to *${name}* ✅ Every flyer uses it from now on.`, `Nom du groupe changé : *${name}* ✅ Tous les flyers l'utilisent désormais.`),
        images: [{ data: flyer, mimeType: JPEG }],
      };
    }

    let member = target.member;
    if (target.field === "birthday") {
      const birthday = parseBirthday(to);
      if (!birthday) return { text: tr(lang, `I couldn't read "${to}" as a date. Try one like 14 March or 14/03.`, `Je n'arrive pas à lire « ${to} » comme une date. Essayez par exemple 14 mars ou 14/03.`) };
      member = await opts.store.saveMember(group.id, member.name, birthday, null);
    } else {
      const name = tidyName(target.value(to));
      const taken = members.find((m) => m.id !== member.id && m.name.toLowerCase() === name.toLowerCase());
      if (taken) return { text: tr(lang, `${taken.name} is already in ${group.name}.`, `${taken.name} est déjà dans ${group.name}.`) };
      await opts.store.renameMember(member.id, name);
      member = { ...member, name };
    }
    lastPhoto.set(from, member.id);
    lastEvent.delete(from);
    return {
      text: tr(lang, `Done ✅ Here's ${member.name}'s flyer now:`, `C'est fait ✅ Voici le flyer de ${member.name} :`, `E don do ✅ See ${member.name} flyer now:`),
      images: [{ data: await birthdayFlyer(member, group), mimeType: JPEG }],
    };
  }

  async function birthdayFlyer(member: Member, group: Group, wish?: string): Promise<Uint8Array> {
    const style = await styleFor(group);
    const photo = member.photoPath ? await opts.store.loadPicture(member.photoPath) : undefined;
    return render.birthday({
      style,
      photo,
      cutout: photo && member.photoPath && style.theme.cutout ? await cutoutOf(member.photoPath, photo) : undefined,
      name: member.name,
      dateLabel: formatMonthDay(member.birthday, group.language),
      groupName: group.name,
      logo: await logoFor(group),
      wish,
      lang: writtenLang(group.language),
    });
  }

  /**
   * Checks a member list and replies straight away; saving everyone (and
   * downloading their photos) carries on afterwards, with a summary at the end.
   */
  function startImport(group: Group, csv: string, sendLater: (r: Reply) => Promise<void>): Reply {
    const lang = group.language;
    if (!planOf(group).importList) return needsPlan(notOn("Importing a list", group, "L'import d'une liste"), (p) => p.importList, lang);
    const rows = rowsFromTable(parseCsv(csv));
    if (!rows.length) {
      return {
        text: tr(
          lang,
          "I couldn't find any names in that list. Please use columns called *Name*, *Birthday* and *Photo* (a photo link), one member per row.",
          "Je n'ai trouvé aucun nom dans cette liste. Utilisez des colonnes *Name*, *Birthday* et *Photo* (un lien vers la photo), un membre par ligne.",
        ),
      };
    }
    if (rows.length > MAX_ROWS) {
      return { text: tr(lang, `That list has ${rows.length} rows. Please send at most ${MAX_ROWS} at a time.`, `Cette liste a ${rows.length} lignes. Envoyez-en au plus ${MAX_ROWS} à la fois.`) };
    }

    const work = importRows(group, rows)
      .then((summary) => sendLater({ text: summary }))
      .catch((err) => {
        log.error(`Import for ${group.name} failed:`, err);
        return sendLater({
          text: tr(lang, "Sorry, the import stopped part-way. Send *members* to see who was saved, then try again.", "Désolé, l'import s'est arrêté en cours de route. Envoyez *membres* pour voir qui a été enregistré, puis réessayez.", "Sorry, the import stop for middle. Send *members* to see who don save, then try again."),
        });
      });
    opts.onBackground?.(work);
    const withPhotos = rows.filter((r) => r.photoUrl).length;
    return {
      text: tr(
        lang,
        `Found ${rows.length} members${withPhotos ? `, ${withPhotos} with photo links` : ""}. Saving them now; I'll message you when it's done.`,
        `${rows.length} membres trouvés${withPhotos ? `, dont ${withPhotos} avec un lien photo` : ""}. Je les enregistre ; je vous écris quand c'est fini.`,
      ),
    };
  }

  async function importRows(group: Group, rows: ImportRow[]): Promise<string> {
    let added = 0;
    let updated = 0;
    const noPhoto: string[] = [];
    const badDates: string[] = [];
    const failed: string[] = [];
    const overLimit: string[] = [];

    // New names beyond the plan's member limit are left out; people already in the group are still updated.
    const max = planOf(group).maxMembers;
    const known = new Set((await opts.store.members(group.id)).map((m) => m.name.toLowerCase()));
    let room = max === null ? Infinity : max - known.size;
    const queue = rows.filter((row) => {
      const key = row.name.toLowerCase();
      if (known.has(key) || !row.birthday) return true;
      if (room <= 0) {
        overLimit.push(row.name);
        return false;
      }
      room--;
      known.add(key);
      return true;
    });
    const worker = async () => {
      for (let row = queue.shift(); row; row = queue.shift()) {
        if (!row.birthday) {
          badDates.push(`row ${row.line} (${row.name}: "${row.birthdayText || "blank"}")`);
          continue;
        }
        let picture: Picture | null = null;
        if (row.photoUrl) {
          try {
            picture = await fetchPicture(row.photoUrl, opts.fetch);
          } catch (err) {
            log.info(`Import: no photo for row ${row.line}: ${(err as Error).message}`);
          }
        }
        try {
          const touched = picture ? await touchUp(picture) : null;
          const saved = await opts.store.saveMember(group.id, row.name, row.birthday, touched?.photo ?? null, touched?.original);
          if (saved.isNew) added++;
          else updated++;
          if (!saved.photoPath) noPhoto.push(saved.name);
        } catch (err) {
          log.error(`Import: couldn't save row ${row.line}:`, err);
          failed.push(`row ${row.line} (${row.name})`);
        }
      }
    };
    // A few at a time: quick, without hammering Google or the database.
    await Promise.all([worker(), worker(), worker(), worker()]);

    if (group.language === "fr") return importSummaryFr(group, { added, updated, noPhoto, badDates, failed, overLimit, max });
    const list = (items: string[]) => (items.length > 15 ? `${items.slice(0, 15).join(", ")} and ${items.length - 15} more` : items.join(", "));
    const parts = [`✅ Import finished for *${group.name}*: ${added + updated} saved (${added} new, ${updated} updated).`];
    if (noPhoto.length) {
      parts.push(
        `📷 ${noPhoto.length} without a photo, so their flyers show their initials for now: ${list(noPhoto)}.\nTo add one, send their photo captioned *photo* and their name, e.g. *photo ${noPhoto[0]}*. (Photo links must be shared as "Anyone with the link".)`,
      );
    }
    if (badDates.length) parts.push(`⚠️ Couldn't read the birthday on ${list(badDates)}. Fix them and send the list again; nobody gets added twice.`);
    if (failed.length) parts.push(`⚠️ Couldn't save ${list(failed)}. Please try those again.`);
    if (overLimit.length) {
      const bigger = cheapestWith((p) => p.maxMembers === null || p.maxMembers > max!);
      parts.push(
        `🔒 ${overLimit.length} not added, because the *${planOf(group).label}* plan holds up to ${max} members: ${list(overLimit)}. Send *upgrade ${bigger.id}* to add everyone.`,
      );
    }
    parts.push("Send *members* to see everyone, or *design* to see the flyers.");
    return parts.join("\n\n");
  }

  function importSummaryFr(
    group: Group,
    r: { added: number; updated: number; noPhoto: string[]; badDates: string[]; failed: string[]; overLimit: string[]; max: number | null },
  ): string {
    const list = (items: string[]) => (items.length > 15 ? `${items.slice(0, 15).join(", ")} et ${items.length - 15} autres` : items.join(", "));
    const parts = [`✅ Import terminé pour *${group.name}* : ${r.added + r.updated} enregistrés (${r.added} nouveaux, ${r.updated} mis à jour).`];
    if (r.noPhoto.length) {
      parts.push(
        `📷 ${r.noPhoto.length} sans photo, leurs flyers affichent donc leurs initiales pour l'instant : ${list(r.noPhoto)}.\nPour en ajouter une, envoyez la photo avec la légende *photo* et le nom, par exemple *photo ${r.noPhoto[0]}*. (Les liens photo doivent être partagés avec « Tous les utilisateurs disposant du lien ».)`,
      );
    }
    if (r.badDates.length) parts.push(`⚠️ Date d'anniversaire illisible : ${list(r.badDates.map((b) => b.replace(/^row /, "ligne ")))}. Corrigez et renvoyez la liste ; personne n'est ajouté deux fois.`);
    if (r.failed.length) parts.push(`⚠️ Impossible d'enregistrer ${list(r.failed.map((b) => b.replace(/^row /, "ligne ")))}. Réessayez pour ceux-là.`);
    if (r.overLimit.length) {
      const bigger = cheapestWith((p) => p.maxMembers === null || p.maxMembers > r.max!);
      parts.push(
        `🔒 ${r.overLimit.length} non ajoutés, car la formule *${planOf(group).label}* va jusqu'à ${r.max} membres : ${list(r.overLimit)}. Envoyez *upgrade ${bigger.id}* pour ajouter tout le monde.`,
      );
    }
    parts.push("Envoyez *membres* pour voir tout le monde, ou *design* pour voir les flyers.");
    return parts.join("\n\n");
  }

  async function handlePicture(group: Group, caption: string, picture: Picture, from: string): Promise<Reply> {
    const lang = group.language;
    const photoFor = caption.match(/^photo\s+(.+)$/i);
    if (photoFor) {
      const found = findMember(await opts.store.members(group.id), photoFor[1]!);
      if (found.length !== 1) return { text: notFound(found, photoFor[1]!, lang) };
      const m = found[0]!;
      const touched = await touchUp(picture);
      const member = await opts.store.saveMember(group.id, m.name, m.birthday, touched.photo, touched.original);
      return photoSaved(tr(lang, `Photo saved for ${member.name} ✅`, `Photo enregistrée pour ${member.name} ✅`, `Photo don save for ${member.name} ✅`), member, group, from);
    }

    if (/^logo$/i.test(caption)) {
      await opts.store.saveLogo(group.id, picture);
      return { text: tr(lang, `Logo saved for ${group.name} ✅ It'll appear on every flyer from now on.`, `Logo enregistré pour ${group.name} ✅ Il apparaîtra désormais sur chaque flyer.`, `Logo don save for ${group.name} ✅ E go dey every flyer from now.`) };
    }

    if (/^background$/i.test(caption)) {
      if (!planOf(group).ownBackground) return needsPlan(notOn("Your own background picture", group, "Votre propre image de fond"), (p) => p.ownBackground, lang);
      await opts.store.saveBackground(group.id, picture);
      const sample = await sampleFor({ ...group });
      const flyer = await render.birthday({ ...sample, style: { ...(await styleFor(group)), background: picture.data } });
      return {
        text: tr(lang, "Background saved ✅ Birthday flyers now use it. Send *background off* to go back to the design's colours.", "Fond enregistré ✅ Les flyers d'anniversaire l'utilisent maintenant. Envoyez *sans fond* pour revenir aux couleurs du modèle."),
        images: [{ data: flyer, mimeType: JPEG }],
      };
    }

    if (/^(add|birthday)\b/i.test(caption)) {
      const parsed = parseAddCaption(caption);
      if (!parsed?.name) {
        return { text: tr(lang, "Please put the name and birthday in the caption, like this:\nadd Ada Okafor, 14 March", "Mettez le nom et la date d'anniversaire dans la légende, comme ceci :\najouter Awa Diallo, 14 mars", "Abeg put the name and birthday for the caption, like this:\nadd Ada Okafor, 14 March") };
      }
      if (!parsed.birthday) {
        return { text: tr(lang, `I couldn't read the birthday for ${parsed.name}. Try a date like 14 March or 14/03.`, `Je n'arrive pas à lire la date d'anniversaire de ${parsed.name}. Essayez une date comme 14 mars ou 14/03.`, `I no fit read the birthday for ${parsed.name}. Try date like 14 March or 14/03.`) };
      }
      const full = await fullReply(group, parsed.name);
      if (full) return full;
      const touched = await touchUp(picture);
      const member = await opts.store.saveMember(group.id, parsed.name, parsed.birthday, touched.photo, touched.original);
      const saved = await photoSaved(
        tr(lang, `Saved ${member.name} 🎂 ${formatMonthDay(member.birthday)}. Here's a preview of their flyer:`, `${member.name} est enregistré(e) 🎂 ${formatMonthDay(member.birthday, "fr")}. Voici un aperçu de son flyer :`, `${member.name} don save 🎂 ${formatMonthDay(member.birthday)}. See how their flyer go look:`),
        member,
        group,
        from,
      );
      return withEmailAsk(saved, group, from);
    }

    if (!planOf(group).eventFlyers) {
      return needsPlan(
        tr(
          lang,
          `To add a member, put *add*, their name and birthday in the caption, e.g. *add Ada Okafor, 14 March*.\n\n${notOn("Turning photos into event flyers", group)}`,
          `Pour ajouter un membre, mettez *ajouter*, son nom et sa date d'anniversaire dans la légende, par exemple *ajouter Awa Diallo, 14 mars*.\n\n${notOn("", group, "La transformation de photos en flyers d'événement")}`,
        ),
        (p) => p.eventFlyers,
        lang,
      );
    }
    let photo = picture.data;
    try {
      photo = await photos.tone(photo);
    } catch (err) {
      log.error("Could not touch up an event photo:", err);
    }
    const flyer = await render.event({
      photo,
      caption,
      logo: await logoFor(group),
      style: await styleFor(group),
    });
    lastEvent.set(from, { groupId: group.id, photo, caption });
    lastPhoto.delete(from);
    const fix = caption ? tr(lang, "Spotted a mistake? Type *change*, the words as they are, *to* and the new words, e.g. *change 4pm to 5pm*.", "Une erreur ? Tapez *changer*, les mots actuels, *en* et les nouveaux mots, par exemple *changer 16h en 17h*.") : "";
    const tip = group.logoPath ? "" : tr(lang, "Tip: send your group logo with the caption *logo* and I'll add it to every flyer.", "Astuce : envoyez le logo du groupe avec la légende *logo* et je l'ajouterai à chaque flyer.");
    const trialNote = await useTrialFlyers(group, 1);
    return {
      text: [fix, tip, trialNote].filter(Boolean).join("\n\n"),
      images: [{ data: flyer, mimeType: JPEG }],
    };
  }

  async function handleCommand(text: string, from: string, group: Group, groups: Group[]): Promise<Reply> {
    const lower = text.toLowerCase();
    const today = lagosNow(new Date());
    const lang = group.language;
    const fr = lang === "fr";

    if (lower === "design" || lower === "designs") {
      const current = themeById(group.theme);
      return designPage(group, 1, tr(lang, `Your current design is *${current.label}*.\n\n`, `Votre modèle actuel : *${current.labelFr}*.\n\n`));
    }

    const page = designPageWanted(text);
    if (page !== null) return designPage(group, page, "");

    const see = text.match(SEE_DESIGN);
    if (see) return seeDesign(group, see[1]!);

    const design = text.match(/^design\s+(.+)$/i);
    if (design) {
      const theme = findTheme(design[1]!);
      if (!theme) return { text: tr(lang, `I don't have a design called "${design[1]}". Send *design* to see them all.`, `Je n'ai pas de modèle appelé « ${design[1]} ». Envoyez *design* pour tous les voir.`) };
      if (!allowsDesign(planOf(group), theme.id)) {
        return needsPlan(notOn(`The *${theme.label}* design`, group, `Le modèle *${theme.labelFr}*`), (p) => allowsDesign(p, theme.id), lang);
      }
      await opts.store.setStyle(group.id, { theme: theme.id });
      const updated = { ...group, theme: theme.id };
      const flyer = await render.birthday({ ...(await sampleFor(updated)), style: await styleFor(updated) });
      const note = group.backgroundPath
        ? tr(lang, " (your own background picture is still on; send *background off* to see the design's colours)", " (votre image de fond est toujours active ; envoyez *sans fond* pour voir les couleurs du modèle)")
        : "";
      return { text: tr(lang, `Design changed to *${theme.label}* ✅${note}`, `Modèle changé : *${theme.labelFr}* ✅${note}`), images: [{ data: flyer, mimeType: JPEG }] };
    }

    const colour = text.match(/^colou?r\s+(.+)$/i);
    if (colour) {
      const wanted = colour[1]!.trim().toLowerCase();
      if (!planOf(group).colour && wanted !== "reset" && wanted !== "off") return needsPlan(notOn("Changing the colour", group, "Le changement de couleur"), (p) => p.colour, lang);
      const accent = wanted === "reset" || wanted === "off" ? null : parseColour(FRENCH_COLOURS[wanted] ?? wanted);
      if (accent === null && wanted !== "reset" && wanted !== "off") {
        return {
          text: tr(lang, `Try one of: ${COLOUR_NAMES.join(", ")}. Or a colour code like #1a7f37.`, `Essayez l'une de ces couleurs : ${Object.keys(FRENCH_COLOURS).join(", ")}. Ou un code couleur comme #1a7f37.`),
        };
      }
      await opts.store.setStyle(group.id, { accent });
      const updated = { ...group, accent };
      const flyer = await render.birthday({ ...(await sampleFor(updated)), style: await styleFor(updated) });
      return {
        text: accent ? tr(lang, "Colour changed ✅", "Couleur changée ✅") : tr(lang, "Back to the design's own colour ✅", "Retour à la couleur du modèle ✅"),
        images: [{ data: flyer, mimeType: JPEG }],
      };
    }

    const photoEdit = photoEditWanted(text);
    if (photoEdit) return changePhoto(group, from, photoEdit.edit, photoEdit.name);

    const textEdits = textEditsWanted(text);
    if (textEdits.length) return changeText(group, from, textEdits);

    if (lower === "background off" || lower === "background reset") {
      await opts.store.saveBackground(group.id, null);
      return { text: tr(lang, "Background removed. Birthday flyers use the design's colours again.", "Fond retiré. Les flyers d'anniversaire reprennent les couleurs du modèle.") };
    }

    if (lower === "members" || lower === "list") {
      const members = await opts.store.members(group.id);
      if (!members.length) return { text: `${tr(lang, `No members in ${group.name} yet.`, `Pas encore de membres dans ${group.name}.`, `No member dey ${group.name} yet.`)}\n\n${helpText(lang)}` };
      const lines = members
        .sort((a, b) => daysUntil(a.birthday, today) - daysUntil(b.birthday, today))
        .map((m) => `• ${m.name}${fr ? " : " : ": "}${formatMonthDay(m.birthday, lang)}`);
      return {
        text: `${tr(lang, `*${group.name}* (${members.length} members, next birthday first)`, `*${group.name}* (${members.length} membres, prochain anniversaire en premier)`)}\n${lines.join("\n")}`,
      };
    }

    if (lower === "upcoming" || lower === "birthdays") {
      const soon = (await opts.store.members(group.id))
        .map((m) => ({ m, days: daysUntil(m.birthday, today) }))
        .filter((x) => x.days <= 30)
        .sort((a, b) => a.days - b.days);
      if (!soon.length) return { text: tr(lang, `No birthdays in ${group.name} in the next 30 days.`, `Aucun anniversaire dans ${group.name} dans les 30 prochains jours.`, `No birthday for ${group.name} for the next 30 days.`) };
      const when = (d: number) =>
        fr ? (d === 0 ? "aujourd'hui 🎉" : d === 1 ? "demain" : `dans ${d} jours`) : d === 0 ? "today 🎉" : d === 1 ? "tomorrow" : `in ${d} days`;
      return {
        text: `${tr(lang, `Coming up in ${group.name}:`, `Bientôt dans ${group.name} :`)}\n${soon.map((x) => `• ${x.m.name}${fr ? " : " : ": "}${formatMonthDay(x.m.birthday, lang)} (${when(x.days)})`).join("\n")}`,
      };
    }

    if (lower === "today") {
      const dates = birthdaysCelebratedOn(today.year, today.month, today.day);
      const celebrants = (await opts.store.members(group.id)).filter((m) =>
        dates.some((d) => d.month === m.birthday.month && d.day === m.birthday.day),
      );
      if (!celebrants.length) return { text: tr(lang, `No birthdays in ${group.name} today.`, `Aucun anniversaire dans ${group.name} aujourd'hui.`, `No birthday for ${group.name} today.`) };
      const images = [];
      for (const m of celebrants) {
        const wish = await opts.wishes.write({ name: m.name, groupName: group.name, lang: writtenLang(lang) });
        images.push({ data: await birthdayFlyer(m, group, wish), mimeType: JPEG, caption: withCredit(group, wish) });
      }
      const trialNote = await useTrialFlyers(group, celebrants.length);
      const tip = forwardTip(celebrants.map((m) => m.name), group.name, lang);
      return { text: trialNote ? `${tip}\n\n${trialNote}` : tip, images };
    }

    const flyerFor = text.match(/^(?:flyer|preview|test)\s+(.+)$/i);
    if (flyerFor) {
      const found = findMember(await opts.store.members(group.id), flyerFor[1]!);
      if (found.length !== 1) return { text: notFound(found, flyerFor[1]!, lang) };
      const m = found[0]!;
      lastPhoto.set(from, m.id);
      lastEvent.delete(from);
      const wish = await opts.wishes.write({ name: m.name, groupName: group.name, lang: writtenLang(lang) });
      const image = { data: await birthdayFlyer(m, group, wish), mimeType: JPEG, caption: withCredit(group, wish) };
      return { text: await useTrialFlyers(group, 1), images: [image] };
    }

    const remove = text.match(/^(?:remove|delete)\s+(.+)$/i);
    if (remove) {
      const found = findMember(await opts.store.members(group.id), remove[1]!);
      if (found.length !== 1) return { text: notFound(found, remove[1]!, lang) };
      await opts.store.removeMember(found[0]!.id);
      return { text: tr(lang, `Removed ${found[0]!.name} from ${group.name}.`, `${found[0]!.name} a été retiré(e) de ${group.name}.`, `I don remove ${found[0]!.name} from ${group.name}.`) };
    }

    const addAdmin = text.match(/^add admin\s+(.+)$/i);
    if (addAdmin) {
      const number = normalizeNumber(addAdmin[1]!);
      if (!number) return { text: tr(lang, "Please send their WhatsApp number, e.g. add admin 08012345678", "Envoyez son numéro WhatsApp, par exemple ajouter admin +225 07 12 34 56 78") };
      const maxAdmins = planOf(group).maxAdmins;
      if (maxAdmins !== null && (await opts.store.adminCount(group.id)) >= maxAdmins) {
        return needsPlan(
          tr(lang, `The *${planOf(group).label}* plan allows ${maxAdmins} admin${maxAdmins === 1 ? "" : "s"}.`, `La formule *${planOf(group).label}* permet ${maxAdmins} administrateur${maxAdmins === 1 ? "" : "s"}.`),
          (p) => p.maxAdmins === null || p.maxAdmins > maxAdmins,
          lang,
        );
      }
      await opts.store.addAdmin(group.id, number);
      return {
        text: tr(
          lang,
          `Done. ${number} can now manage ${group.name}. Ask them to send "hi" to this number so I can send them birthday flyers.`,
          `C'est fait. ${number} peut maintenant gérer ${group.name}. Demandez-lui d'envoyer « bonjour » à ce numéro pour que je puisse lui envoyer les flyers d'anniversaire.`,
        ),
      };
    }

    if (lower === "plan" || lower === "my plan") {
      const plan = planOf(group);
      const lapsed = plan.id !== planById(group.plan).id;
      const until = !lapsed && plan.id !== "free" && group.planUntil ? tr(lang, ` until ${formatDate(group.planUntil)}`, ` jusqu'au ${formatDate(group.planUntil, lang)}`) : "";
      const count = (await opts.store.members(group.id)).length;
      const limit = plan.maxMembers === null ? "" : tr(lang, ` of ${plan.maxMembers}`, ` sur ${plan.maxMembers}`);
      const trial = group.trialFlyersLeft !== null;
      if (fr) {
        const statusFr = trial
          ? lapsed
            ? `*${group.name}* est sur la formule *Free* (votre essai gratuit ${planById(group.plan).label} est terminé).`
            : `*${group.name}* est en essai gratuit *${plan.label}*${until}, avec ${group.trialFlyersLeft} flyer${group.trialFlyersLeft === 1 ? "" : "s"} restant${group.trialFlyersLeft === 1 ? "" : "s"}. Ensuite, il passe à la formule Free sauf si vous changez de formule.`
          : `*${group.name}* est sur la formule *${plan.label}*${until}${lapsed ? ` (votre formule ${group.plan} a pris fin le ${formatDate(group.planUntil!, lang)})` : ""}.`;
        return {
          text: [statusFr, `Membres : ${count}${limit}.`, `Inclus : ${plan.summaryFr}.`, "Envoyez *formules* pour comparer, ou *upgrade* et le nom d'une formule."].join("\n"),
        };
      }
      const status = trial
        ? lapsed
          ? `*${group.name}* is on the *Free* plan (your free ${planById(group.plan).label} trial has ended).`
          : `*${group.name}* is on a free *${plan.label}* trial${until}, with ${group.trialFlyersLeft} flyer${group.trialFlyersLeft === 1 ? "" : "s"} left. Then it moves to the Free plan unless you upgrade.`
        : `*${group.name}* is on the *${plan.label}* plan${until}${lapsed ? ` (your ${group.plan} plan ran out on ${formatDate(group.planUntil!)})` : ""}.`;
      return {
        text: [
          status,
          `Members: ${count}${limit}.`,
          `Includes: ${plan.summary}.`,
          "Send *plans* to compare, or *upgrade* and a plan's name.",
        ].join("\n"),
      };
    }

    const asked = takePromoCode(text, (t) => {
      const m = t.match(UPGRADE);
      return !!m && (!m[1] || !!findPlan(m[1]));
    });
    const upgrade = asked.text.match(UPGRADE);
    if (upgrade) {
      const wanted = upgrade[1] ? findPlan(upgrade[1]) : group.plan !== "free" ? findPlan(group.plan) : null;
      if (!wanted || wanted.id === "free") return { text: await plansText(lang) };
      const months = Number(upgrade[2] ?? 1) * (upgrade[3]?.toLowerCase().startsWith("year") ? 12 : 1);
      if (months < 1 || months > 12) {
        return { text: tr(lang, "You can pay for 1 to 12 months at a time, e.g. *upgrade standard 3 months*.", "Vous pouvez payer de 1 à 12 mois à la fois, par exemple *upgrade standard 3 months*.") };
      }
      const checkout = await checkoutReply(group, wanted, months, from, asked.code);
      if (checkout) return checkout;
      const contact = `${from}${group.name ? ` for "${group.name}"` : ""}`;
      return {
        text: tr(
          lang,
          `Thanks! We'll message you shortly with how to pay for *${wanted.label}*. Your group switches over as soon as it's paid.`,
          `Merci ! Nous vous écrivons très vite pour le paiement de *${wanted.label}*. Votre groupe change de formule dès le paiement reçu.`,
        ),
        notify: opts.owners.map((to) => ({
          to,
          text: `💰 Upgrade request: ${contact} wants *${wanted.label}*${asked.code ? ` with code ${asked.code}` : ""}.\nWhen they've paid, send: set plan ${wanted.id} ${monthsText(months)} for ${group.name}`,
        })),
      };
    }

    // Numbered alphabetically, so the numbers don't move when switching.
    const byName = [...groups].sort((a, b) => a.name.localeCompare(b.name));
    if (lower === "groups") {
      const list = byName.map((g, i) => `${i + 1}. ${g.name} (${planOf(g).label})${g.id === group.id ? tr(lang, " ← current", " ← actuel") : ""}`).join("\n");
      return {
        text: tr(
          lang,
          `Your groups:\n${list}\n\nSend *switch* and a number or name to change group, e.g. *switch 2*. Send *new group* to set up another.`,
          `Vos groupes :\n${list}\n\nEnvoyez *changer* et un numéro ou un nom pour changer de groupe, par exemple *changer 2*. Envoyez *nouveau groupe* pour en créer un autre.`,
        ),
      };
    }

    const switchTo = text.match(/^(?:switch|use)\s+(?:to\s+)?(.+)$/i);
    if (switchTo) {
      const q = switchTo[1]!.toLowerCase().trim();
      const target = /^\d+$/.test(q)
        ? byName[Number(q) - 1]
        : (groups.find((g) => g.name.toLowerCase() === q) ?? groups.find((g) => g.name.toLowerCase().includes(q)));
      if (!target) return { text: tr(lang, `You're not an admin of a group called "${switchTo[1]}". Send *groups* to see yours.`, `Vous n'êtes pas administrateur d'un groupe appelé « ${switchTo[1]} ». Envoyez *groupes* pour voir les vôtres.`) };
      await opts.store.useGroup(target.id, from);
      return { text: tr(target.language, `Now working on *${target.name}*. Everything you send now is for this group.`, `Vous travaillez maintenant sur *${target.name}*. Tout ce que vous envoyez concerne ce groupe.`) };
    }

    return { text: `*${group.name}*\n\n${helpText(lang)}` };
  }

  /** Owners: "set plan standard 3 months for Unilag Class of 2010". */
  async function setGroupPlan(planName: string, count: string | undefined, unit: string | undefined, groupName: string): Promise<Reply> {
    const plan = findPlan(planName);
    if (!plan) return { text: `Plans are: ${PLANS.map((p) => p.id).join(", ")}. E.g. set plan standard 1 month for Unilag Class of 2010` };
    const matches = await opts.store.findGroups(groupName.trim());
    const exact = matches.filter((g) => g.name.toLowerCase() === groupName.trim().toLowerCase());
    const found = exact.length ? exact : matches;
    if (found.length !== 1) {
      return {
        text: found.length
          ? `More than one group matches "${groupName}": ${found.map((g) => g.name).join(", ")}. Please use the full name.`
          : `No group called "${groupName}".`,
      };
    }
    const group = found[0]!;
    if (plan.id === "free") {
      await opts.store.setPlan(group.id, "free", null);
      return { text: `${group.name} is now on the Free plan.` };
    }
    const months = Number(count ?? 1) * (unit?.toLowerCase().startsWith("year") ? 12 : 1);
    if (!Number.isInteger(months) || months < 1 || months > 60) return { text: "Please give between 1 month and 5 years." };
    const until = await extendPlan(group, plan, months);
    log.info(`Flyer group "${group.name}" set to ${plan.id} until ${until.toISOString()}`);
    return { text: `✅ ${group.name} is on *${plan.label}* until ${formatDate(until)}.` };
  }

  /**
   * Puts a group on a paid plan. Renewing early adds the time on top of what's
   * left; a free trial's leftover days aren't added, so paid time starts now.
   */
  async function extendPlan(group: Group, plan: Plan, months: number): Promise<Date> {
    const current = currentPlan(group, now());
    const start =
      current.id !== "free" && !onTrial(group, now()) && group.planUntil && group.planUntil > now() ? group.planUntil : now();
    const until = addMonths(start, months);
    await opts.store.setPlan(group.id, plan.id, until);
    return until;
  }

  /**
   * A Paystack link for the plan, priced from the database: twelve months use
   * the paid-yearly price when there is one. Null when online payment isn't
   * possible (switched off, price on request, Paystack down), and the owners
   * then take payment by hand.
   */
  async function checkoutReply(group: Group, plan: Plan, months: number, from: string, code?: string): Promise<Reply | null> {
    if (!opts.payments) return null;
    try {
      const [monthly, yearly] = await Promise.all([opts.store.planPrices(), opts.store.planYearlyPrices()]);
      const perMonth = (months === 12 ? yearly.get(plan.id) : null) ?? monthly.get(plan.id);
      if (!perMonth) return null;
      const link = await opts.payments.createLink({
        product: "flyer",
        waId: from,
        amountKobo: perMonth * months,
        purpose: { groupId: group.id, plan: plan.id, months },
        title: `${opts.brandName} ${plan.label}, ${monthsText(months)}, for ${group.name}`,
        promo: code ? { code, months } : undefined,
      });
      if (link.url === null) return { text: promoRefusedText(link.refused) };
      if (group.language === "fr") {
        return {
          text: [
            `*${plan.label}* pour *${group.name}*, ${monthsText(months, "fr")} : *${formatNaira(link.amountKobo)}*.`,
            ...(link.promo ? [promoAppliedText(link.promo)] : []),
            `Payez par carte ou virement ici :\n${link.url}`,
            "Votre groupe change de formule dès que le paiement passe, et je vous écris ici.",
          ].join("\n\n"),
        };
      }
      return {
        text: [
          `*${plan.label}* for *${group.name}*, ${monthsText(months)}: *${formatNaira(link.amountKobo)}*.`,
          ...(link.promo ? [promoAppliedText(link.promo)] : []),
          `Pay by card, bank transfer or USSD here:\n${link.url}`,
          "Your group switches over as soon as the payment goes through, and I'll message you here.",
        ].join("\n\n"),
      };
    } catch (err) {
      log.error(`Couldn't make a payment link for "${group.name}":`, err);
      return null;
    }
  }

  /** Null if this person may set up another group, otherwise the reply saying why not. */
  function canCreateGroup(isOwner: boolean, groups: Group[], lang: Lang = "en"): Reply | null {
    if (isOwner) return null;
    if (!opts.openSignup) return { text: tr(lang, "Sorry, only the account owner can set up new groups.", "Désolé, seul le propriétaire du compte peut créer de nouveaux groupes.") };
    // One Free (or free trial) group each; people whose groups are all on paid plans can add more.
    const free = groups.find((g) => planOf(g).id === "free" || onTrial(g, now()));
    if (!free) return null;
    if (lang === "fr") {
      const whereFr = onTrial(free, now()) ? "en essai gratuit" : "sur la formule Free";
      return {
        text: `Chaque personne peut gérer un groupe gratuit, et *${free.name}* est ${whereFr}. Pour créer un autre groupe, changez d'abord sa formule (envoyez *upgrade standard*), ou envoyez *upgrade deluxe* pour gérer plusieurs groupes ou sections.`,
      };
    }
    const where = onTrial(free, now()) ? "its free trial" : "Free";
    return {
      text: `Each person can run one free group, and *${free.name}* is on ${where}. To set up another group, upgrade it first (send *upgrade standard*), or send *upgrade deluxe* to run several groups or chapters.`,
    };
  }

  function designsNote(plan: Plan, lang: Lang = "en"): string {
    if (plan.designs === "all") return "";
    const numbers = THEMES.flatMap((t, i) => (allowsDesign(plan, t.id) ? [`${i + 1}`] : []));
    return tr(
      lang,
      `\n\nYour *${plan.label}* plan includes designs ${numbers.join(" and ")}; send *upgrade standard* for all of them.`,
      `\n\nVotre formule *${plan.label}* comprend les modèles ${numbers.join(" et ")} ; envoyez *upgrade standard* pour les avoir tous.`,
    );
  }

  /**
   * One page of designs: a picture of up to six, with the group's name on
   * them, then a tappable list to pick one or turn the page. Designs keep
   * their numbers across pages, so "design 14" works from anywhere.
   */
  async function designPage(group: Group, wanted: number, lead: string, ask?: string): Promise<Reply> {
    const pages = Math.ceil(THEMES.length / DESIGNS_PER_PAGE);
    const page = Math.min(Math.max(wanted, 1), pages);
    const first = (page - 1) * DESIGNS_PER_PAGE;
    const plan = planOf(group);
    const current = themeById(group.theme).id;
    const fr = group.language === "fr";
    const items = THEMES.slice(first, first + DESIGNS_PER_PAGE).map((theme, i) => ({
      theme,
      number: first + i + 1,
      note:
        theme.id === current
          ? fr
            ? "Votre modèle"
            : "Your design"
          : allowsDesign(plan, theme.id)
            ? undefined
            : fr
              ? `Formule ${cheapestWith((p) => allowsDesign(p, theme.id)).label}`
              : `${cheapestWith((p) => allowsDesign(p, theme.id)).label} plan`,
    }));
    const last = first + items.length;
    const style = await styleFor(group);
    const sheet = await render.designSheet(await sampleFor(group), items, { accent: style.accent, credit: style.credit });

    if (fr) {
      const rangeFr = pages > 1 ? `Modèles ${first + 1} à ${last} sur ${THEMES.length}. ` : "";
      const howFr = ask ?? "Touchez *Choisir un modèle* pour en choisir un, ou répondez *design* et un numéro, par exemple *design 2*.";
      const moreFr = page < pages ? " Touchez *Plus de modèles* dans la liste pour voir la suite." : "";
      const rowsFr = items.map((it) => ({ id: `design ${it.number}`, title: `${it.number}. ${it.theme.labelFr}`.slice(0, 24), description: it.note }));
      if (page < pages) {
        const to = Math.min(last + DESIGNS_PER_PAGE, THEMES.length);
        rowsFr.push({ id: `designs page ${page + 1}`, title: "Plus de modèles ▶", description: `Modèles ${last + 1} à ${to}` });
      }
      if (page > 1) rowsFr.push({ id: `designs page ${page - 1}`, title: "◀ Retour", description: `Modèles ${first - DESIGNS_PER_PAGE + 1} à ${first}` });
      return {
        text: `${lead}${rangeFr}${howFr}${moreFr} Pour en voir un en grand d'abord, répondez *voir* et son numéro, par exemple *voir ${first + 1}*.${designsNote(plan, "fr")}`,
        images: [{ data: sheet, mimeType: JPEG }],
        list: { body: `Modèles ${first + 1} à ${last} : touchez-en un pour l'utiliser sur vos flyers.`, button: "Choisir un modèle", rows: rowsFr },
      };
    }
    const range = pages > 1 ? `Designs ${first + 1} to ${last} of ${THEMES.length}. ` : "";
    const how = ask ?? "Tap *Choose a design* to pick one, or reply *design* and a number, e.g. *design 2*.";
    const more = page < pages ? " Tap *More designs* in the list to see the next ones." : "";
    const rows = items.map((it) => ({ id: `design ${it.number}`, title: `${it.number}. ${it.theme.label}`, description: it.note }));
    if (page < pages) {
      const to = Math.min(last + DESIGNS_PER_PAGE, THEMES.length);
      rows.push({ id: `designs page ${page + 1}`, title: "More designs ▶", description: `Designs ${last + 1} to ${to}` });
    }
    if (page > 1) rows.push({ id: `designs page ${page - 1}`, title: "◀ Back", description: `Designs ${first - DESIGNS_PER_PAGE + 1} to ${first}` });
    return {
      text: `${lead}${range}${how}${more} To see one full size first, reply *see* and its number, e.g. *see ${first + 1}*.${designsNote(plan)}`,
      images: [{ data: sheet, mimeType: JPEG }],
      list: { body: `Designs ${first + 1} to ${last}: tap one to use it on your flyers.`, button: "Choose a design", rows },
    };
  }

  /** "see 8": one design full size with the group's name, without switching to it. */
  async function seeDesign(group: Group, query: string): Promise<Reply> {
    const theme = findTheme(query);
    const lang = group.language;
    if (!theme) return { text: tr(lang, `I don't have a design called "${query}". Send *design* to see them all.`, `Je n'ai pas de modèle appelé « ${query} ». Envoyez *design* pour tous les voir.`) };
    const number = THEMES.indexOf(theme) + 1;
    const flyer = await render.birthday({ ...(await sampleFor(group)), style: { ...(await styleFor(group)), theme } });
    const needed = cheapestWith((p) => allowsDesign(p, theme.id)).label;
    const locked = allowsDesign(planOf(group), theme.id)
      ? ""
      : tr(lang, ` It's on the *${needed}* plan (send *plans* to compare).`, ` Il fait partie de la formule *${needed}* (envoyez *formules* pour comparer).`);
    return {
      text: tr(lang, `This is design ${number}, *${theme.label}*. Reply *design ${number}* to use it.${locked}`, `Voici le modèle ${number}, *${theme.labelFr}*. Répondez *design ${number}* pour l'utiliser.${locked}`),
      images: [{ data: flyer, mimeType: JPEG }],
    };
  }

  function setupDone(lang: Lang = "en"): string {
    if (lang === "fr") {
      return [
        "*Étape 3 sur 3 : ajoutez vos membres.*",
        "• Un par un : envoyez la photo d'un membre avec la légende *ajouter Awa Diallo, 14 mars*",
        "• Tous d'un coup (formule Standard et plus) : collez un lien Google Sheets, ou envoyez un fichier CSV, avec les colonnes *Name*, *Birthday* et *Photo*",
        "",
        "C'est tout ! Le matin de chaque anniversaire, je vous envoie le flyer du membre à transférer au groupe. Envoyez *aide* à tout moment pour voir tout ce que je sais faire, ou *assistance* pour parler à une personne.",
      ].join("\n");
    }
    if (lang === "pcm") {
      return [
        "*Step 3 of 3: add your members.*",
        "• One by one: send member photo with the caption *add Ada Okafor, 14 March*",
        "• All at once (Standard plan and up): paste Google Sheets link, or send CSV file, with columns *Name*, *Birthday* and *Photo*",
        "",
        "Na everything be that! Every birthday morning, I go send you the member flyer to forward to the group. Send *help* anytime to see everything I fit do, or *support* to reach person.",
      ].join("\n");
    }
    return [
      "*Step 3 of 3: add your members.*",
      "• One at a time: send a member's photo with the caption *add Ada Okafor, 14 March*",
      "• All at once (Standard plan and up): paste a Google Sheets link, or send a CSV file, with columns *Name*, *Birthday* and *Photo*",
      "",
      "That's it! On each birthday morning I'll send you the member's flyer to forward to the group. Send *help* any time to see everything I can do, or *support* to reach a person.",
    ].join("\n");
  }

  /**
   * Steps 1 (logo) and 2 (design) of setting up a new group. Returns null when
   * the message isn't an answer to the step, so it's handled as usual.
   */
  async function setupStep(
    step: "logo" | "design",
    group: Group,
    msg: IncomingMessage,
    text: string,
    ctx: { downloadMedia: (id: string) => Promise<{ data: Blob; mimeType: string }> },
  ): Promise<Reply | null> {
    const skip = /^(skip|next|later|no)$/i.test(text);
    const lang = group.language;
    const step2 = async (lead: string, page = 1): Promise<Reply> => {
      await opts.store.setChatState(msg.from, { step: "design", groupId: group.id });
      return designPage(
        group,
        page,
        page === 1
          ? `${lead}${tr(lang, "*Step 2 of 3: pick a design.* Here they are with your group's name on them. ", "*Étape 2 sur 3 : choisissez un modèle.* Les voici avec le nom de votre groupe. ", "*Step 2 of 3: pick design.* See dem with your group name for top. ")}`
          : "",
        tr(lang, "Tap *Choose a design* to pick one, or reply with a number, e.g. *1*, or *skip* to keep design 1.", "Touchez *Choisir un modèle*, ou répondez avec un numéro, par exemple *1*, ou *passer* pour garder le modèle 1.", "Tap *Choose a design* to pick one, or reply with number, like *1*, or *skip* to keep design 1."),
      );
    };

    if (step === "logo") {
      if (skip) return step2(tr(lang, "No problem, you can send it later with the caption *logo*.\n\n", "Pas de souci, vous pourrez l'envoyer plus tard avec la légende *logo*.\n\n", "No wahala, you fit send am later with the caption *logo*.\n\n"));
      const isPicture = (msg.type === "image" || msg.type === "document") && msg.mediaId;
      if (!isPicture || !/^(logo)?$/i.test(text)) return null;
      const file = await ctx.downloadMedia(msg.mediaId!);
      if (!/^image\/(jpeg|png|webp)$/.test(file.mimeType)) return null;
      await opts.store.saveLogo(group.id, { data: new Uint8Array(await file.data.arrayBuffer()), mimeType: file.mimeType });
      const withLogo = (await opts.store.groupsForAdmin(msg.from)).find((g) => g.id === group.id) ?? group;
      group = withLogo;
      return step2(tr(lang, "Logo saved ✅\n\n", "Logo enregistré ✅\n\n", "Logo don save ✅\n\n"));
    }

    if (skip) {
      await opts.store.setChatState(msg.from, null);
      return { text: setupDone(lang) };
    }
    // Turning the page or looking at one design keeps the guided setup going.
    const page = designPageWanted(text);
    if (page !== null) return step2("", page);
    const see = text.match(SEE_DESIGN);
    if (see) {
      await opts.store.setChatState(msg.from, { step: "design", groupId: group.id });
      return seeDesign(group, see[1]!);
    }
    const theme = findTheme(text.replace(/^design\s+/i, ""));
    if (!theme) return null;
    if (!allowsDesign(planOf(group), theme.id)) {
      return needsPlan(notOn(`The *${theme.label}* design`, group, `Le modèle *${theme.labelFr}*`), (p) => allowsDesign(p, theme.id), lang);
    }
    await opts.store.setStyle(group.id, { theme: theme.id });
    await opts.store.setChatState(msg.from, null);
    const updated = { ...group, theme: theme.id };
    const flyer = await render.birthday({ ...(await sampleFor(updated)), style: await styleFor(updated) });
    return {
      text: tr(
        lang,
        `Design set to *${theme.label}* ✅ (change it any time with *design*)\n\n${setupDone()}`,
        `Modèle choisi : *${theme.labelFr}* ✅ (changez-le quand vous voulez avec *design*)\n\n${setupDone("fr")}`, `Design don set to *${theme.label}* ✅ (change am anytime with *design*)\n\n${setupDone("pcm")}`,
      ),
      images: [{ data: flyer, mimeType: JPEG }],
    };
  }

  /** The birthday message, with the "Made with" line on plans that carry it, so it travels with the forwarded flyer. */
  function withCredit(group: Group, wish: string): string {
    return planOf(group).credit && opts.credit ? `${wish}\n\n${opts.credit}` : wish;
  }

  return {
    name: "flyer",

    async handle(msg, ctx): Promise<Reply | null> {
      const said = (msg.text ?? msg.caption ?? "").trim();
      const text = fromFrench(said);
      const isOwner = owners.has(msg.from);
      const groups = await opts.store.groupsForAdmin(msg.from);
      const who = msg.contactName ? `${msg.contactName} (${msg.from})` : msg.from;
      const isPicture = (msg.type === "image" || msg.type === "document") && !!msg.mediaId;
      // The group's language once there is one; before that, the language they write in.
      // Someone who writes Pidgin to an English group gets Pidgin back; the flyers stay in English.
      const heard = guessLanguage(said);
      if (heard) spoken.set(msg.from, heard);
      let lang: Lang = groups[0]?.language ?? spoken.get(msg.from) ?? "en";
      if (lang === "en" && spoken.get(msg.from) === "pcm") lang = "pcm";

      if (/^(?:language\s+)?(pidgin|pigin|naija|broken english)$/i.test(said)) {
        spoken.set(msg.from, "pcm");
        if (groups[0]?.language === "fr") await opts.store.setStyle(groups[0].id, { language: "en" });
        return { text: "No wahala, I go dey yarn you for Pidgin from now. Your flyers go still dey for English. Send *english* to change am back." };
      }

      // "français" / "english" switches the current group's language.
      const switchLang = said.match(/^(?:langue\s+|language\s+)?(français|francais|french|english|anglais)$/i);
      if (switchLang) {
        lang = /^(english|anglais)$/i.test(switchLang[1]!) ? "en" : "fr";
        spoken.set(msg.from, lang);
        if (groups[0]) await opts.store.setStyle(groups[0].id, { language: lang });
        return { text: tr(lang, "OK, I'll speak English from now on, and your flyers will be in English. 🇬🇧", "D'accord, je vous parle désormais en français, et vos flyers seront en français. 🇫🇷") };
      }

      if (/^(plans|prices|pricing)$/i.test(text)) return { text: await plansText(lang) };

      if (isOwner) {
        const promoReply = opts.promos ? await promoCommand(opts.promos, text) : null;
        if (promoReply) return { text: promoReply };
        const setPlan = text.match(/^set plan\s+(\S+)(?:\s+(\d+)\s*(months?|years?))?\s+(?:for\s+)?(.+)$/i);
        if (setPlan) return setGroupPlan(setPlan[1]!, setPlan[2], setPlan[3], setPlan[4]!);
        const answer = text.match(/^reply\s+(\+?[\d\s]{10,18}?)\s*[:,]?\s+(\D[\s\S]*)$/i);
        if (answer) {
          const to = normalizeNumber(answer[1]!);
          if (!to) return { text: "Please start with their number, e.g. reply 2348012345678 Thanks, that's fixed now." };
          return {
            text: `Sent to ${to} ✅ (it only arrives if they've messaged in the last 24 hours)`,
            notify: [{ to, text: `💬 *${opts.brandName} support:* ${answer[2]!.trim()}` }],
          };
        }
      }

      // Support: "support my flyer has the wrong date", or "support" and then the message.
      const state = await opts.store.chatState(msg.from);
      if (state && /^(cancel|stop)$/i.test(text)) {
        await opts.store.setChatState(msg.from, null);
        return {
          text: groups.length
            ? tr(lang, "OK, cancelled.", "D'accord, c'est annulé.", "Okay, I don cancel am.")
            : tr(lang, "OK, cancelled. Message me any time to set up a group.", "D'accord, c'est annulé. Écrivez-moi quand vous voulez pour créer un groupe.", "Okay, I don cancel am. Message me anytime you wan set up group."),
        };
      }
      const support = text.match(/^(?:support|help me|talk to (?:a )?(?:person|human|someone)|agent|complain(?:t)?)\b[:\s]*([\s\S]*)$/i);
      if (support || state?.step === "support") {
        const body = support ? support[1]!.trim() : text;
        if (!body) {
          await opts.store.setChatState(msg.from, { step: "support", groupId: groups[0]?.id ?? null });
          return { text: tr(lang, "What do you need help with? Type your message and I'll pass it to a person on our team.", "En quoi puis-je vous aider ? Écrivez votre message et je le transmets à une personne de notre équipe.", "Wetin you need help with? Type your message, I go pass am to person for our team.") };
        }
        await opts.store.setChatState(msg.from, null);
        const where = groups[0] ? ` (group: ${groups[0].name}, ${planOf(groups[0]).label} plan)` : "";
        log.info(`Support message from ...${msg.from.slice(-4)}`);
        return {
          text: tr(lang, "Thanks, I've passed that to our team. They'll reply to you here.", "Merci, j'ai transmis votre message à notre équipe. Elle vous répondra ici.", "Thank you, I don pass am to our team. Dem go reply you here."),
          notify: opts.owners.map((to) => ({
            to,
            text: `🆘 Support from ${who}${where}:\n${body}\n\nTo answer, send: reply ${msg.from} <your message>`,
          })),
        };
      }

      const newGroup = text.match(/^new group\b\s*(.*)$/i);
      if (newGroup || state?.step === "name") {
        const blocked = canCreateGroup(isOwner, groups, lang);
        if (blocked) return blocked;
        const name = newGroup ? newGroup[1]!.trim() : text;
        if (!name || isPicture || GREETING.test(name)) {
          await opts.store.setChatState(msg.from, { step: "name", groupId: null });
          return {
            text: tr(
              lang,
              `What's your group called? Reply with its name as it should appear on the flyers, e.g. *Unilag Class of 2010*.${groups.length ? " (Or *cancel*.)" : ""}`,
              `Comment s'appelle votre groupe ? Répondez avec son nom tel qu'il doit apparaître sur les flyers, par exemple *Promo 2010 Lycée Classique*.${groups.length ? " (Ou *annuler*.)" : ""}`, `Wetin be your group name? Reply with the name as e suppose show for the flyers, like *Unilag Class of 2010*.${groups.length ? " (Or *cancel*.)" : ""}`,
            ),
          };
        }
        const group = await opts.store.createGroup(name.slice(0, 80), msg.from);
        if (lang === "fr") {
          await opts.store.setStyle(group.id, { language: "fr" });
          group.language = "fr";
        }
        let trialNote = "";
        if (opts.trial && trialPlan && group.plan === "free") {
          const until = new Date(now().getTime() + opts.trial.days * DAY_MS);
          await opts.store.startTrial(group.id, trialPlan.id, until, opts.trial.flyers);
          trialNote = tr(
            lang,
            `\n\n🎁 *Free ${trialPlan.label} trial:* for the next ${opts.trial.days} days (or ${opts.trial.flyers} flyers, whichever comes first) you get every ${trialPlan.label} feature: all designs and colours, spreadsheet import and event flyers. No card needed. After that the group carries on free on the Free plan unless you upgrade.`,
            `\n\n🎁 *Essai gratuit ${trialPlan.label} :* pendant ${opts.trial.days} jours (ou ${opts.trial.flyers} flyers, au premier des deux termes), vous avez tout ${trialPlan.label} : tous les modèles et couleurs, l'import de tableur et les flyers d'événement. Sans carte bancaire. Ensuite, le groupe continue gratuitement sur la formule Free, sauf si vous changez de formule.`, `\n\n🎁 *Free ${trialPlan.label} trial:* for the next ${opts.trial.days} days (or ${opts.trial.flyers} flyers, whichever one reach first) you go get every ${trialPlan.label} feature: all the designs and colours, spreadsheet import and event flyers. No card needed. After that, the group go continue free on the Free plan unless you upgrade.`,
          );
        }
        await opts.store.setChatState(msg.from, { step: "logo", groupId: group.id });
        log.info(`New flyer group "${group.name}" set up by ...${msg.from.slice(-4)}`);
        return {
          text: tr(
            lang,
            `Created *${group.name}* ✅ You're its admin.${trialNote}\n\nThree quick steps to get it ready:\n\n*Step 1 of 3: your logo.* Send your group's logo as a picture. (Send it as a document to keep a see-through background.) No logo? Reply *skip*.`,
            `*${group.name}* est créé ✅ Vous en êtes l'administrateur.${trialNote}\n\nTrois petites étapes pour le préparer :\n\n*Étape 1 sur 3 : votre logo.* Envoyez le logo du groupe en image. (En document pour garder un fond transparent.) Pas de logo ? Répondez *passer*.`, `*${group.name}* don ready ✅ Na you be the admin.${trialNote}\n\nThree quick steps to set am up:\n\n*Step 1 of 3: your logo.* Send your group logo as picture. (Send am as document if you wan keep see-through background.) No logo? Reply *skip*.`,
          ),
          notify: isOwner
            ? undefined
            : opts.owners.map((to) => ({ to, text: `🎉 New sign-up: ${who} set up "${group.name}" on ${opts.brandName}.` })),
        };
      }

      const group = groups[0] && lang === "pcm" ? { ...groups[0], language: lang } : groups[0];
      if (!group) {
        if (!isOwner && !opts.openSignup) {
          return {
            text: tr(lang, "Hello! This number makes birthday and event flyers for WhatsApp groups. Ask your group's admin to add you.", "Bonjour ! Ce numéro crée des flyers d'anniversaire et d'événement pour les groupes WhatsApp. Demandez à l'administrateur de votre groupe de vous ajouter.", "Hello! This number dey make birthday and event flyers for WhatsApp groups. Ask your group admin make dem add you."),
          };
        }
        await opts.store.setChatState(msg.from, { step: "name", groupId: null });
        if (lang === "fr") {
          return {
            text: `Bonjour ! Je suis ${opts.brandName} 🎉 Je crée des flyers d'anniversaire pour les membres de votre groupe WhatsApp (anciens élèves, amis, église, travail), je vous les envoie le matin de chaque anniversaire, prêts à transférer, et j'ajoute le logo de votre groupe sur vos photos d'événement.\n\nC'est gratuit pour les groupes jusqu'à ${planById("free").maxMembers} personnes${trialPlan ? `, et les nouveaux groupes essaient tout ${trialPlan.label} gratuitement pendant ${opts.trial!.days} jours, sans carte bancaire` : ""} (envoyez *formules* pour les grands groupes). Des questions ? Envoyez *assistance*.\n\nCréons votre groupe. *Comment s'appelle-t-il ?* Répondez avec son nom, par exemple *Promo 2010 Lycée Classique*.\n\n(Send *english* for English.)`,
          };
        }
        if (lang === "pcm") {
          return {
            text: `How far! Na ${opts.brandName} 🎉 I dey make birthday flyers for the members of your WhatsApp group (alumni, friends, church, work), I go send dem to you every birthday morning ready to forward, and I go put your group logo for your event photos.\n\nE free for groups wey get up to ${planById("free").maxMembers} people${trialPlan ? `, and new groups fit try every ${trialPlan.label} feature free for ${opts.trial!.days} days, no card needed` : ""} (send *plans* for bigger groups). Any question? Send *support*.\n\nMake we set up your group. *Wetin be the name?* Reply with the name, like *Unilag Class of 2010*.`,
          };
        }
        return {
          text: `Hi! I'm ${opts.brandName} 🎉 I make birthday flyers for the members of your WhatsApp group (alumni, friends, church, work), send them to you on each birthday morning ready to forward, and brand your event photos with your group's logo.\n\nIt's free for groups of up to ${planById("free").maxMembers} people${trialPlan ? `, and new groups try every ${trialPlan.label} feature free for ${opts.trial!.days} days, no card needed` : ""} (send *plans* for bigger groups). Questions? Send *support*.\n\nLet's set up your group. *What's it called?* Reply with its name, e.g. *Unilag Class of 2010*.`,
        };
      }

      // Steps 1 and 2 of setting up a new group. Anything that isn't an answer
      // ends the guided setup and is handled as a normal message.
      if (state && (state.step === "logo" || state.step === "design") && state.groupId === group.id) {
        const guided = await setupStep(state.step, group, msg, text, ctx);
        if (guided) return guided;
        await opts.store.setChatState(msg.from, null);
      }

      if (isPicture) {
        const file = await ctx.downloadMedia(msg.mediaId!);
        if (isCsv(file.mimeType)) return startImport(group, await file.data.text(), ctx.sendLater);
        if (!/^image\/(jpeg|png|webp)$/.test(file.mimeType)) {
          return {
            text: tr(
              lang,
              "Please send a photo (JPG or PNG), or a member list as a CSV file. From Excel or Google Sheets: File > Download > CSV.",
              "Envoyez une photo (JPG ou PNG), ou une liste de membres en fichier CSV. Depuis Excel ou Google Sheets : Fichier > Télécharger > CSV.", "Abeg send photo (JPG or PNG), or member list as CSV file. From Excel or Google Sheets: File > Download > CSV.",
            ),
          };
        }
        return handlePicture(group, text, { data: new Uint8Array(await file.data.arrayBuffer()), mimeType: file.mimeType }, msg.from);
      }
      if (!text) return { text: `*${group.name}*\n\n${helpText(lang)}` };

      const sheetLink = text.match(/https:\/\/docs\.google\.com\/spreadsheets\/\S+/);
      if (sheetLink) {
        try {
          return startImport(group, await fetchSheet(sheetLink[0], opts.fetch), ctx.sendLater);
        } catch (err) {
          return { text: tr(lang, `I couldn't open that sheet: ${(err as Error).message}.`, `Je n'ai pas pu ouvrir ce tableau : ${(err as Error).message}.`) };
        }
      }
      return handleCommand(text, msg.from, group, groups);
    },

    async planPaid(payment) {
      const { groupId, plan: planId, months } = payment.purpose as { groupId?: string; plan?: string; months?: number };
      const plan = findPlan(String(planId ?? ""));
      const group = groupId ? await opts.store.groupById(groupId) : null;
      if (!plan || !group || !Number.isInteger(months) || months! < 1) {
        throw new Error(`Payment ${payment.reference} is for something we can't find: ${JSON.stringify(payment.purpose)}`);
      }
      const until = await extendPlan(group, plan, months!);
      log.info(`Flyer group "${group.name}" paid for ${plan.id} until ${until.toISOString()}`);
      const paid = formatNaira(payment.amountKobo);
      return [
        {
          to: payment.waId,
          text: tr(
            group.language,
            `✅ Payment of ${paid} received, thank you. *${group.name}* is on *${plan.label}* until ${formatDate(until)}.`,
            `✅ Paiement de ${paid} reçu, merci. *${group.name}* est sur la formule *${plan.label}* jusqu'au ${formatDate(until, "fr")}.`,
          ),
        },
        ...opts.owners.map((to) => ({
          to,
          text: `💰 Paid: ${payment.waId} paid ${paid} for *${plan.label}* (${monthsText(months!)}) for ${group.name}. Active until ${formatDate(until)}.`,
        })),
      ];
    },

    async sendDueBirthdays(now, delivery) {
      const today = lagosNow(now);
      if (today.hour < opts.sendHour) return;
      const due = await opts.store.birthdaysOn(birthdaysCelebratedOn(today.year, today.month, today.day));

      // One copy of each group, so trial flyers are counted correctly when several members share a birthday.
      const sameGroup = new Map<string, Group>();
      for (const { member, group: row, admins: all } of due) {
        const group = sameGroup.get(row.id) ?? row;
        sameGroup.set(row.id, group);
        const admins = [];
        for (const to of all) if (await delivery.canReach(to)) admins.push(to);
        if (!admins.length) continue;
        if (!(await opts.store.claimBirthday(member.id, today.year))) continue;
        let delivered = 0;
        try {
          const written = await opts.wishes.write({ name: member.name, groupName: group.name, lang: group.language });
          const flyer = await birthdayFlyer(member, group, written);
          const wish = withCredit(group, written);
          for (const to of admins) {
            try {
              await delivery.send({ to, memberName: member.name, groupName: group.name, flyer, wish, lang: group.language });
              delivered++;
            } catch (err) {
              log.error(`Birthday flyer for ${member.name} didn't reach admin ...${to.slice(-4)}:`, err);
            }
          }
        } catch (err) {
          log.error(`Birthday flyer for ${member.name} (${group.name}) failed:`, err);
        }
        if (delivered === 0) {
          await opts.store.releaseBirthday(member.id, today.year);
        } else {
          await useTrialFlyers(group, 1).catch((err) => log.error(`Could not count a trial flyer for ${group.name}:`, err));
          log.info(`Birthday flyer for ${member.name} (${group.name}) sent to ${delivered} admin(s)`);
        }
      }
    },
  };
}

/** The note that goes with a birthday flyer, telling the admin what to do. */
export function forwardTip(names: string[], groupName: string, lang: Lang = "en"): string {
  if (lang === "fr") {
    const qui = names.length === 1 ? `l'anniversaire de ${names[0]}` : `l'anniversaire de ${names.join(", ")}`;
    return `🎂 Aujourd'hui, c'est ${qui} ! Transférez le${names.length > 1 ? "s" : ""} flyer${names.length > 1 ? "s" : ""} à ${groupName}, puis tapez @ et choisissez le nom pour l'identifier.`;
  }
  const who = names.length === 1 ? `${names[0]}'s birthday` : `birthdays of ${names.join(", ")}`;
  return `🎂 Today is ${who}! Forward the flyer${names.length > 1 ? "s" : ""} to ${groupName}, then type @ and pick the name to tag them.`;
}

function notFound(found: Member[], query: string, lang: Lang = "en"): string {
  if (lang === "fr") {
    if (!found.length) return `Je ne trouve pas « ${query} ». Envoyez *membres* pour voir tout le monde.`;
    return `Plusieurs résultats pour « ${query} » : ${found.map((m) => m.name).join(", ")}. Utilisez le nom complet.`;
  }
  if (!found.length) return `I couldn't find "${query}". Send *members* to see everyone.`;
  return `More than one match for "${query}": ${found.map((m) => m.name).join(", ")}. Please use the full name.`;
}

function monthsText(months: number, lang: Lang = "en"): string {
  if (lang === "fr") return months === 12 ? "1 an" : `${months} mois`;
  return months === 12 ? "1 year" : `${months} month${months === 1 ? "" : "s"}`;
}

/** French colour names admins may type, turned into the English names themes.ts knows. */
const FRENCH_COLOURS: Record<string, string> = {
  or: "gold",
  doré: "gold",
  rouge: "red",
  bleu: "blue",
  vert: "green",
  violet: "purple",
  rose: "pink",
  orange: "orange",
  noir: "black",
  blanc: "white",
  argent: "silver",
  jaune: "yellow",
  turquoise: "teal",
};
