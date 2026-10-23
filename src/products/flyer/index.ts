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
• *add admin 08012345678*: let someone else manage this group
• *colour gold* (or a code like #1a7f37): change the highlight colour; *colour reset* to undo
• *background*: send a picture with this caption to use it behind your birthday flyers; *background off* to undo
• *groups*: your groups; *switch 2* to change group; *new group* to add one
• *plan*: your group's plan; *plans* for prices
• *support*: message a person on our team

On each birthday I'll send you the flyer in the morning, ready to forward to the group.`;

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
    if (!/^(\d|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(tail)) continue;
    const birthday = parseBirthday(tail);
    if (birthday) return { name: tidyName(words.slice(0, i).join(" ")), birthday };
  }
  return null;
}

function tidyName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

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
    if (left === 0) {
      return `That was the last flyer of your free *${label}* trial, so *${group.name}* is now on the Free plan (${FREE_SUMMARY}). Send *upgrade ${group.plan}* to keep everything, or *plans* to compare.`;
    }
    if (left <= 5) return `${left} flyer${left === 1 ? "" : "s"} left in your free *${label}* trial.`;
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
  function needsPlan(why: string, has: (p: Plan) => boolean): Reply {
    const plan = cheapestWith(has);
    return {
      text: `${why} Upgrade to *${plan.label}* for this: send *upgrade ${plan.id}* and we'll get you set up, or *plans* to compare.`,
    };
  }

  const notOn = (what: string, group: Group) => `${what} isn't included on the *${planOf(group).label}* plan.`;

  /** Null if the group has room for one more member, otherwise the reply saying it's full. */
  async function fullReply(group: Group, name: string): Promise<Reply | null> {
    const max = planOf(group).maxMembers;
    if (max === null) return null;
    const members = await opts.store.members(group.id);
    if (members.length < max || members.some((m) => m.name.toLowerCase() === name.toLowerCase())) return null;
    return needsPlan(`${group.name} has ${members.length} members, the most the *${planOf(group).label}* plan allows.`, (p) => p.maxMembers === null || p.maxMembers > max);
  }

  async function plansText(): Promise<string> {
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
    const price = (p: Plan) => {
      const kobo = prices.get(p.id);
      if (p.id === "free") return "free";
      if (kobo === undefined || kobo === null) {
        const start = from.get(p.id);
        return start ? `from ${formatNaira(start)} a month, agreed with you` : "price on request";
      }
      const perYear = yearly.get(p.id);
      const yearlyText =
        perYear === undefined || perYear === null ? "" : `, or ${formatNaira(perYear)} a month paid yearly (${formatNaira(perYear * 12)} a year)`;
      return `${formatNaira(kobo)} a month${yearlyText}`;
    };
    const lines = PLANS.map((p) => `*${p.label}* (${price(p)}): ${p.summary}.`);
    const promo = opts.payments ? " Got a promo code? Add it at the end, e.g. *upgrade standard CODE*." : "";
    return `${opts.brandName} plans:\n\n${lines.join("\n\n")}\n\nSend *upgrade* and the plan's name, e.g. *upgrade standard*.${promo}`;
  }

  function formatDate(date: Date): string {
    const d = lagosNow(date);
    return `${formatMonthDay(d)} ${d.year}`;
  }

  /** A member to show designs with: the group's first member, or an outline before there are any. */
  async function sampleFor(group: Group) {
    const members = await opts.store.members(group.id);
    const first = members.find((m) => m.photoPath) ?? members[0];
    const photo = first?.photoPath ? await opts.store.loadPicture(first.photoPath) : await placeholderPortrait();
    return {
      photo,
      cutout: first?.photoPath ? await cutoutOf(first.photoPath, photo) : await placeholderCutout(),
      name: first?.name ?? "Your Member",
      dateLabel: first ? formatMonthDay(first.birthday) : "14 October",
      groupName: group.name,
      logo: await logoFor(group),
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
    const first = member.name.split(" ")[0];
    return {
      text: lead,
      images: [{ data: await birthdayFlyer(member, group), mimeType: JPEG }],
      list: {
        body: `I've centred ${first}'s photo and fixed the light. Want to change anything? Tap *Edit photo*, or just type *brighter*, *rotate* and so on.`,
        button: "Edit photo",
        rows: PHOTO_EDITS.map((e) => ({ id: `${e.word} ${member.name}`, title: e.title, description: e.description })),
      },
    };
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
    if (found.length !== 1) {
      if (name) return { text: notFound(found, name) };
      return { text: `Whose photo? Add their name, e.g. *${PHOTO_EDITS.find((e) => e.edit === edit)!.word} Ada Okafor*.` };
    }
    const m = found[0]!;
    if (!m.photoPath) return { text: `${m.name} has no photo yet. Send one with the caption *photo ${m.name}*.` };
    const current = await opts.store.loadPicture(m.photoPath!);
    const kept = await opts.store.loadOriginal(m.photoPath!);
    if (edit === "original" && !kept) return { text: `${m.name}'s photo is already as it was sent.` };
    const original = kept ?? current;
    let result: Awaited<ReturnType<typeof editPhoto>>;
    try {
      result = await photos.edit(edit, current, original);
    } catch (err) {
      if (err instanceof NoPersonError) return { text: `I couldn't find a person in ${m.name}'s photo, so I left the background as it is.` };
      throw err;
    }
    const saved = await opts.store.saveMember(group.id, m.name, m.birthday, { data: result.photo, mimeType: JPEG }, {
      data: result.original ?? original,
      mimeType: JPEG,
    });
    const done = edit === "original" ? `Back to ${m.name}'s photo as you sent it ✅` : `Done ✅ Here's ${m.name}'s flyer now:`;
    return photoSaved(done, saved, group, from);
  }

  async function birthdayFlyer(member: Member, group: Group, wish?: string): Promise<Uint8Array> {
    const style = await styleFor(group);
    const photo = member.photoPath ? await opts.store.loadPicture(member.photoPath) : undefined;
    return render.birthday({
      style,
      photo,
      cutout: photo && member.photoPath && style.theme.cutout ? await cutoutOf(member.photoPath, photo) : undefined,
      name: member.name,
      dateLabel: formatMonthDay(member.birthday),
      groupName: group.name,
      logo: await logoFor(group),
      wish,
    });
  }

  /**
   * Checks a member list and replies straight away; saving everyone (and
   * downloading their photos) carries on afterwards, with a summary at the end.
   */
  function startImport(group: Group, csv: string, sendLater: (r: Reply) => Promise<void>): Reply {
    if (!planOf(group).importList) return needsPlan(notOn("Importing a list", group), (p) => p.importList);
    const rows = rowsFromTable(parseCsv(csv));
    if (!rows.length) {
      return {
        text: "I couldn't find any names in that list. Please use columns called *Name*, *Birthday* and *Photo* (a photo link), one member per row.",
      };
    }
    if (rows.length > MAX_ROWS) return { text: `That list has ${rows.length} rows. Please send at most ${MAX_ROWS} at a time.` };

    const work = importRows(group, rows)
      .then((summary) => sendLater({ text: summary }))
      .catch((err) => {
        log.error(`Import for ${group.name} failed:`, err);
        return sendLater({ text: "Sorry, the import stopped part-way. Send *members* to see who was saved, then try again." });
      });
    opts.onBackground?.(work);
    const withPhotos = rows.filter((r) => r.photoUrl).length;
    return {
      text: `Found ${rows.length} members${withPhotos ? `, ${withPhotos} with photo links` : ""}. Saving them now; I'll message you when it's done.`,
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

  async function handlePicture(group: Group, caption: string, picture: Picture, from: string): Promise<Reply> {
    const photoFor = caption.match(/^photo\s+(.+)$/i);
    if (photoFor) {
      const found = findMember(await opts.store.members(group.id), photoFor[1]!);
      if (found.length !== 1) return { text: notFound(found, photoFor[1]!) };
      const m = found[0]!;
      const touched = await touchUp(picture);
      const member = await opts.store.saveMember(group.id, m.name, m.birthday, touched.photo, touched.original);
      return photoSaved(`Photo saved for ${member.name} ✅`, member, group, from);
    }

    if (/^logo$/i.test(caption)) {
      await opts.store.saveLogo(group.id, picture);
      return { text: `Logo saved for ${group.name} ✅ It'll appear on every flyer from now on.` };
    }

    if (/^background$/i.test(caption)) {
      if (!planOf(group).ownBackground) return needsPlan(notOn("Your own background picture", group), (p) => p.ownBackground);
      await opts.store.saveBackground(group.id, picture);
      const sample = await sampleFor({ ...group });
      const flyer = await render.birthday({ ...sample, style: { ...(await styleFor(group)), background: picture.data } });
      return {
        text: "Background saved ✅ Birthday flyers now use it. Send *background off* to go back to the design's colours.",
        images: [{ data: flyer, mimeType: JPEG }],
      };
    }

    if (/^(add|birthday)\b/i.test(caption)) {
      const parsed = parseAddCaption(caption);
      if (!parsed?.name) {
        return { text: "Please put the name and birthday in the caption, like this:\nadd Ada Okafor, 14 March" };
      }
      if (!parsed.birthday) {
        return { text: `I couldn't read the birthday for ${parsed.name}. Try a date like 14 March or 14/03.` };
      }
      const full = await fullReply(group, parsed.name);
      if (full) return full;
      const touched = await touchUp(picture);
      const member = await opts.store.saveMember(group.id, parsed.name, parsed.birthday, touched.photo, touched.original);
      return photoSaved(`Saved ${member.name} 🎂 ${formatMonthDay(member.birthday)}. Here's a preview of their flyer:`, member, group, from);
    }

    if (!planOf(group).eventFlyers) {
      return needsPlan(
        `To add a member, put *add*, their name and birthday in the caption, e.g. *add Ada Okafor, 14 March*.\n\n${notOn("Turning photos into event flyers", group)}`,
        (p) => p.eventFlyers,
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
    const tip = group.logoPath ? "" : "Tip: send your group logo with the caption *logo* and I'll add it to every flyer.";
    const trialNote = await useTrialFlyers(group, 1);
    return {
      text: [tip, trialNote].filter(Boolean).join("\n\n"),
      images: [{ data: flyer, mimeType: JPEG }],
    };
  }

  async function handleCommand(text: string, from: string, group: Group, groups: Group[]): Promise<Reply> {
    const lower = text.toLowerCase();
    const today = lagosNow(new Date());

    if (lower === "design" || lower === "designs") {
      const current = themeById(group.theme);
      return designPage(group, 1, `Your current design is *${current.label}*.\n\n`);
    }

    const page = designPageWanted(text);
    if (page !== null) return designPage(group, page, "");

    const see = text.match(SEE_DESIGN);
    if (see) return seeDesign(group, see[1]!);

    const design = text.match(/^design\s+(.+)$/i);
    if (design) {
      const theme = findTheme(design[1]!);
      if (!theme) return { text: `I don't have a design called "${design[1]}". Send *design* to see them all.` };
      if (!allowsDesign(planOf(group), theme.id)) return needsPlan(notOn(`The *${theme.label}* design`, group), (p) => allowsDesign(p, theme.id));
      await opts.store.setStyle(group.id, { theme: theme.id });
      const updated = { ...group, theme: theme.id };
      const flyer = await render.birthday({ ...(await sampleFor(updated)), style: await styleFor(updated) });
      const note = group.backgroundPath ? " (your own background picture is still on; send *background off* to see the design's colours)" : "";
      return { text: `Design changed to *${theme.label}* ✅${note}`, images: [{ data: flyer, mimeType: JPEG }] };
    }

    const colour = text.match(/^colou?r\s+(.+)$/i);
    if (colour) {
      const wanted = colour[1]!.trim().toLowerCase();
      if (!planOf(group).colour && wanted !== "reset" && wanted !== "off") return needsPlan(notOn("Changing the colour", group), (p) => p.colour);
      const accent = wanted === "reset" || wanted === "off" ? null : parseColour(wanted);
      if (accent === null && wanted !== "reset" && wanted !== "off") {
        return { text: `Try one of: ${COLOUR_NAMES.join(", ")}. Or a colour code like #1a7f37.` };
      }
      await opts.store.setStyle(group.id, { accent });
      const updated = { ...group, accent };
      const flyer = await render.birthday({ ...(await sampleFor(updated)), style: await styleFor(updated) });
      return {
        text: accent ? "Colour changed ✅" : "Back to the design's own colour ✅",
        images: [{ data: flyer, mimeType: JPEG }],
      };
    }

    const photoEdit = photoEditWanted(text);
    if (photoEdit) return changePhoto(group, from, photoEdit.edit, photoEdit.name);

    if (lower === "background off" || lower === "background reset") {
      await opts.store.saveBackground(group.id, null);
      return { text: "Background removed. Birthday flyers use the design's colours again." };
    }

    if (lower === "members" || lower === "list") {
      const members = await opts.store.members(group.id);
      if (!members.length) return { text: `No members in ${group.name} yet.\n\n${HELP}` };
      const lines = members
        .sort((a, b) => daysUntil(a.birthday, today) - daysUntil(b.birthday, today))
        .map((m) => `• ${m.name}: ${formatMonthDay(m.birthday)}`);
      return { text: `*${group.name}* (${members.length} members, next birthday first)\n${lines.join("\n")}` };
    }

    if (lower === "upcoming" || lower === "birthdays") {
      const soon = (await opts.store.members(group.id))
        .map((m) => ({ m, days: daysUntil(m.birthday, today) }))
        .filter((x) => x.days <= 30)
        .sort((a, b) => a.days - b.days);
      if (!soon.length) return { text: `No birthdays in ${group.name} in the next 30 days.` };
      const when = (d: number) => (d === 0 ? "today 🎉" : d === 1 ? "tomorrow" : `in ${d} days`);
      return {
        text: `Coming up in ${group.name}:\n${soon.map((x) => `• ${x.m.name}: ${formatMonthDay(x.m.birthday)} (${when(x.days)})`).join("\n")}`,
      };
    }

    if (lower === "today") {
      const dates = birthdaysCelebratedOn(today.year, today.month, today.day);
      const celebrants = (await opts.store.members(group.id)).filter((m) =>
        dates.some((d) => d.month === m.birthday.month && d.day === m.birthday.day),
      );
      if (!celebrants.length) return { text: `No birthdays in ${group.name} today.` };
      const images = [];
      for (const m of celebrants) {
        const wish = await opts.wishes.write({ name: m.name, groupName: group.name });
        images.push({ data: await birthdayFlyer(m, group, wish), mimeType: JPEG, caption: withCredit(group, wish) });
      }
      const trialNote = await useTrialFlyers(group, celebrants.length);
      const tip = forwardTip(celebrants.map((m) => m.name), group.name);
      return { text: trialNote ? `${tip}\n\n${trialNote}` : tip, images };
    }

    const flyerFor = text.match(/^(?:flyer|preview|test)\s+(.+)$/i);
    if (flyerFor) {
      const found = findMember(await opts.store.members(group.id), flyerFor[1]!);
      if (found.length !== 1) return { text: notFound(found, flyerFor[1]!) };
      const m = found[0]!;
      const wish = await opts.wishes.write({ name: m.name, groupName: group.name });
      const image = { data: await birthdayFlyer(m, group, wish), mimeType: JPEG, caption: withCredit(group, wish) };
      return { text: await useTrialFlyers(group, 1), images: [image] };
    }

    const remove = text.match(/^(?:remove|delete)\s+(.+)$/i);
    if (remove) {
      const found = findMember(await opts.store.members(group.id), remove[1]!);
      if (found.length !== 1) return { text: notFound(found, remove[1]!) };
      await opts.store.removeMember(found[0]!.id);
      return { text: `Removed ${found[0]!.name} from ${group.name}.` };
    }

    const addAdmin = text.match(/^add admin\s+(.+)$/i);
    if (addAdmin) {
      const number = normalizeNumber(addAdmin[1]!);
      if (!number) return { text: "Please send their WhatsApp number, e.g. add admin 08012345678" };
      const maxAdmins = planOf(group).maxAdmins;
      if (maxAdmins !== null && (await opts.store.adminCount(group.id)) >= maxAdmins) {
        return needsPlan(`The *${planOf(group).label}* plan allows ${maxAdmins} admin${maxAdmins === 1 ? "" : "s"}.`, (p) => p.maxAdmins === null || p.maxAdmins > maxAdmins);
      }
      await opts.store.addAdmin(group.id, number);
      return {
        text: `Done. ${number} can now manage ${group.name}. Ask them to send "hi" to this number so I can send them birthday flyers.`,
      };
    }

    if (lower === "plan" || lower === "my plan") {
      const plan = planOf(group);
      const lapsed = plan.id !== planById(group.plan).id;
      const until = !lapsed && plan.id !== "free" && group.planUntil ? ` until ${formatDate(group.planUntil)}` : "";
      const count = (await opts.store.members(group.id)).length;
      const limit = plan.maxMembers === null ? "" : ` of ${plan.maxMembers}`;
      const trial = group.trialFlyersLeft !== null;
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
      if (!wanted || wanted.id === "free") return { text: await plansText() };
      const months = Number(upgrade[2] ?? 1) * (upgrade[3]?.toLowerCase().startsWith("year") ? 12 : 1);
      if (months < 1 || months > 12) return { text: "You can pay for 1 to 12 months at a time, e.g. *upgrade standard 3 months*." };
      const checkout = await checkoutReply(group, wanted, months, from, asked.code);
      if (checkout) return checkout;
      const contact = `${from}${group.name ? ` for "${group.name}"` : ""}`;
      return {
        text: `Thanks! We'll message you shortly with how to pay for *${wanted.label}*. Your group switches over as soon as it's paid.`,
        notify: opts.owners.map((to) => ({
          to,
          text: `💰 Upgrade request: ${contact} wants *${wanted.label}*${asked.code ? ` with code ${asked.code}` : ""}.\nWhen they've paid, send: set plan ${wanted.id} ${monthsText(months)} for ${group.name}`,
        })),
      };
    }

    // Numbered alphabetically, so the numbers don't move when switching.
    const byName = [...groups].sort((a, b) => a.name.localeCompare(b.name));
    if (lower === "groups") {
      const list = byName.map((g, i) => `${i + 1}. ${g.name} (${planOf(g).label})${g.id === group.id ? " ← current" : ""}`).join("\n");
      return {
        text: `Your groups:\n${list}\n\nSend *switch* and a number or name to change group, e.g. *switch 2*. Send *new group* to set up another.`,
      };
    }

    const switchTo = text.match(/^(?:switch|use)\s+(?:to\s+)?(.+)$/i);
    if (switchTo) {
      const q = switchTo[1]!.toLowerCase().trim();
      const target = /^\d+$/.test(q)
        ? byName[Number(q) - 1]
        : (groups.find((g) => g.name.toLowerCase() === q) ?? groups.find((g) => g.name.toLowerCase().includes(q)));
      if (!target) return { text: `You're not an admin of a group called "${switchTo[1]}". Send *groups* to see yours.` };
      await opts.store.useGroup(target.id, from);
      return { text: `Now working on *${target.name}*. Everything you send now is for this group.` };
    }

    return { text: `*${group.name}*\n\n${HELP}` };
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
  function canCreateGroup(isOwner: boolean, groups: Group[]): Reply | null {
    if (isOwner) return null;
    if (!opts.openSignup) return { text: "Sorry, only the account owner can set up new groups." };
    // One Free (or free trial) group each; people whose groups are all on paid plans can add more.
    const free = groups.find((g) => planOf(g).id === "free" || onTrial(g, now()));
    if (!free) return null;
    const where = onTrial(free, now()) ? "its free trial" : "Free";
    return {
      text: `Each person can run one free group, and *${free.name}* is on ${where}. To set up another group, upgrade it first (send *upgrade standard*), or send *upgrade deluxe* to run several groups or chapters.`,
    };
  }

  function designsNote(plan: Plan): string {
    if (plan.designs === "all") return "";
    const numbers = THEMES.flatMap((t, i) => (allowsDesign(plan, t.id) ? [`${i + 1}`] : []));
    return `\n\nYour *${plan.label}* plan includes designs ${numbers.join(" and ")}; send *upgrade standard* for all of them.`;
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
    const items = THEMES.slice(first, first + DESIGNS_PER_PAGE).map((theme, i) => ({
      theme,
      number: first + i + 1,
      note:
        theme.id === current
          ? "Your design"
          : allowsDesign(plan, theme.id)
            ? undefined
            : `${cheapestWith((p) => allowsDesign(p, theme.id)).label} plan`,
    }));
    const last = first + items.length;
    const style = await styleFor(group);
    const sheet = await render.designSheet(await sampleFor(group), items, { accent: style.accent, credit: style.credit });

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
    if (!theme) return { text: `I don't have a design called "${query}". Send *design* to see them all.` };
    const number = THEMES.indexOf(theme) + 1;
    const flyer = await render.birthday({ ...(await sampleFor(group)), style: { ...(await styleFor(group)), theme } });
    const locked = allowsDesign(planOf(group), theme.id)
      ? ""
      : ` It's on the *${cheapestWith((p) => allowsDesign(p, theme.id)).label}* plan (send *plans* to compare).`;
    return {
      text: `This is design ${number}, *${theme.label}*. Reply *design ${number}* to use it.${locked}`,
      images: [{ data: flyer, mimeType: JPEG }],
    };
  }

  function setupDone(): string {
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
    const step2 = async (lead: string, page = 1): Promise<Reply> => {
      await opts.store.setChatState(msg.from, { step: "design", groupId: group.id });
      return designPage(
        group,
        page,
        page === 1 ? `${lead}*Step 2 of 3: pick a design.* Here they are with your group's name on them. ` : "",
        "Tap *Choose a design* to pick one, or reply with a number, e.g. *1*, or *skip* to keep design 1.",
      );
    };

    if (step === "logo") {
      if (skip) return step2("No problem, you can send it later with the caption *logo*.\n\n");
      const isPicture = (msg.type === "image" || msg.type === "document") && msg.mediaId;
      if (!isPicture || !/^(logo)?$/i.test(text)) return null;
      const file = await ctx.downloadMedia(msg.mediaId!);
      if (!/^image\/(jpeg|png|webp)$/.test(file.mimeType)) return null;
      await opts.store.saveLogo(group.id, { data: new Uint8Array(await file.data.arrayBuffer()), mimeType: file.mimeType });
      const withLogo = (await opts.store.groupsForAdmin(msg.from)).find((g) => g.id === group.id) ?? group;
      group = withLogo;
      return step2("Logo saved ✅\n\n");
    }

    if (skip) {
      await opts.store.setChatState(msg.from, null);
      return { text: setupDone() };
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
    if (!allowsDesign(planOf(group), theme.id)) return needsPlan(notOn(`The *${theme.label}* design`, group), (p) => allowsDesign(p, theme.id));
    await opts.store.setStyle(group.id, { theme: theme.id });
    await opts.store.setChatState(msg.from, null);
    const updated = { ...group, theme: theme.id };
    const flyer = await render.birthday({ ...(await sampleFor(updated)), style: await styleFor(updated) });
    return { text: `Design set to *${theme.label}* ✅ (change it any time with *design*)\n\n${setupDone()}`, images: [{ data: flyer, mimeType: JPEG }] };
  }

  /** The birthday message, with the "Made with" line on plans that carry it, so it travels with the forwarded flyer. */
  function withCredit(group: Group, wish: string): string {
    return planOf(group).credit && opts.credit ? `${wish}\n\n${opts.credit}` : wish;
  }

  return {
    name: "flyer",

    async handle(msg, ctx): Promise<Reply | null> {
      const text = (msg.text ?? msg.caption ?? "").trim();
      const isOwner = owners.has(msg.from);
      const groups = await opts.store.groupsForAdmin(msg.from);
      const who = msg.contactName ? `${msg.contactName} (${msg.from})` : msg.from;
      const isPicture = (msg.type === "image" || msg.type === "document") && !!msg.mediaId;

      if (/^(plans|prices|pricing)$/i.test(text)) return { text: await plansText() };

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
        return { text: groups.length ? "OK, cancelled." : "OK, cancelled. Message me any time to set up a group." };
      }
      const support = text.match(/^(?:support|help me|talk to (?:a )?(?:person|human|someone)|agent|complain(?:t)?)\b[:\s]*([\s\S]*)$/i);
      if (support || state?.step === "support") {
        const body = support ? support[1]!.trim() : text;
        if (!body) {
          await opts.store.setChatState(msg.from, { step: "support", groupId: groups[0]?.id ?? null });
          return { text: "What do you need help with? Type your message and I'll pass it to a person on our team." };
        }
        await opts.store.setChatState(msg.from, null);
        const where = groups[0] ? ` (group: ${groups[0].name}, ${planOf(groups[0]).label} plan)` : "";
        log.info(`Support message from ...${msg.from.slice(-4)}`);
        return {
          text: "Thanks, I've passed that to our team. They'll reply to you here.",
          notify: opts.owners.map((to) => ({
            to,
            text: `🆘 Support from ${who}${where}:\n${body}\n\nTo answer, send: reply ${msg.from} <your message>`,
          })),
        };
      }

      const newGroup = text.match(/^new group\b\s*(.*)$/i);
      if (newGroup || state?.step === "name") {
        const blocked = canCreateGroup(isOwner, groups);
        if (blocked) return blocked;
        const name = newGroup ? newGroup[1]!.trim() : text;
        if (!name || isPicture || GREETING.test(name)) {
          await opts.store.setChatState(msg.from, { step: "name", groupId: null });
          return {
            text: `What's your group called? Reply with its name as it should appear on the flyers, e.g. *Unilag Class of 2010*.${groups.length ? " (Or *cancel*.)" : ""}`,
          };
        }
        const group = await opts.store.createGroup(name.slice(0, 80), msg.from);
        let trialNote = "";
        if (opts.trial && trialPlan && group.plan === "free") {
          const until = new Date(now().getTime() + opts.trial.days * DAY_MS);
          await opts.store.startTrial(group.id, trialPlan.id, until, opts.trial.flyers);
          trialNote = `\n\n🎁 *Free ${trialPlan.label} trial:* for the next ${opts.trial.days} days (or ${opts.trial.flyers} flyers, whichever comes first) you get every ${trialPlan.label} feature: all designs and colours, spreadsheet import and event flyers. No card needed. After that the group carries on free on the Free plan unless you upgrade.`;
        }
        await opts.store.setChatState(msg.from, { step: "logo", groupId: group.id });
        log.info(`New flyer group "${group.name}" set up by ...${msg.from.slice(-4)}`);
        return {
          text: `Created *${group.name}* ✅ You're its admin.${trialNote}\n\nThree quick steps to get it ready:\n\n*Step 1 of 3: your logo.* Send your group's logo as a picture. (Send it as a document to keep a see-through background.) No logo? Reply *skip*.`,
          notify: isOwner
            ? undefined
            : opts.owners.map((to) => ({ to, text: `🎉 New sign-up: ${who} set up "${group.name}" on ${opts.brandName}.` })),
        };
      }

      const group = groups[0];
      if (!group) {
        if (!isOwner && !opts.openSignup) {
          return { text: "Hello! This number makes birthday and event flyers for WhatsApp groups. Ask your group's admin to add you." };
        }
        await opts.store.setChatState(msg.from, { step: "name", groupId: null });
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
            text: "Please send a photo (JPG or PNG), or a member list as a CSV file. From Excel or Google Sheets: File > Download > CSV.",
          };
        }
        return handlePicture(group, text, { data: new Uint8Array(await file.data.arrayBuffer()), mimeType: file.mimeType }, msg.from);
      }
      if (!text) return { text: `*${group.name}*\n\n${HELP}` };

      const sheetLink = text.match(/https:\/\/docs\.google\.com\/spreadsheets\/\S+/);
      if (sheetLink) {
        try {
          return startImport(group, await fetchSheet(sheetLink[0], opts.fetch), ctx.sendLater);
        } catch (err) {
          return { text: `I couldn't open that sheet: ${(err as Error).message}.` };
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
        { to: payment.waId, text: `✅ Payment of ${paid} received, thank you. *${group.name}* is on *${plan.label}* until ${formatDate(until)}.` },
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
          const written = await opts.wishes.write({ name: member.name, groupName: group.name });
          const flyer = await birthdayFlyer(member, group, written);
          const wish = withCredit(group, written);
          for (const to of admins) {
            try {
              await delivery.send({ to, memberName: member.name, groupName: group.name, flyer, wish });
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
export function forwardTip(names: string[], groupName: string): string {
  const who = names.length === 1 ? `${names[0]}'s birthday` : `birthdays of ${names.join(", ")}`;
  return `🎂 Today is ${who}! Forward the flyer${names.length > 1 ? "s" : ""} to ${groupName}, then type @ and pick the name to tag them.`;
}

function notFound(found: Member[], query: string): string {
  if (!found.length) return `I couldn't find "${query}". Send *members* to see everyone.`;
  return `More than one match for "${query}": ${found.map((m) => m.name).join(", ")}. Please use the full name.`;
}

function monthsText(months: number): string {
  return months === 12 ? "1 year" : `${months} month${months === 1 ? "" : "s"}`;
}
