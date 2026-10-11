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
  placeholderPortrait,
  renderBirthdayFlyer,
  renderDesignSheet,
  renderEventFlyer,
  type FlyerStyle,
} from "./render.js";
import { COLOUR_NAMES, findTheme, parseColour, THEMES, themeById } from "./themes.js";
import { fetchPicture, fetchSheet, isCsv, MAX_ROWS, parseCsv, rowsFromTable, type ImportRow } from "./import.js";
import {
  addMonths,
  allowsDesign,
  cheapestWith,
  currentPlan,
  findPlan,
  formatNaira,
  PLANS,
  type Plan,
} from "./plans.js";
import type { FlyerStore, Group, Member, Picture } from "./store.js";
import type { WishWriter } from "./wish.js";

// Phase 3: birthday and event flyers for WhatsApp groups (alumni, friends).
//
// Group admins chat with the bot on its own WhatsApp number:
// - a photo captioned "add Ada Okafor, 14 March" saves a member,
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
  };
  log?: Pick<Console, "info" | "error">;
  /** For downloading Google Sheets and photo links. */
  fetch?: typeof fetch;
  /** Called with work that carries on after replying (a spreadsheet import), so tests can wait for it. */
  onBackground?: (work: Promise<void>) => void;
  /** The current time; tests replace it to check when plans run out. */
  now?: () => Date;
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
}

const HELP = `Here's what I can do:

🎂 *Add a member*: send their photo with the caption
   add Ada Okafor, 14 March
🖼️ *Event flyer*: send any photo with the text you want on it, e.g.
   Homecoming: Sat 12 Dec, 4pm, Alumni Hall
🏷️ *Logo*: send your group logo with the caption *logo* (send it as a file/document to keep a see-through background)
🎨 *Design*: send *design* to see the flyer designs and pick one
📋 *Import a list*: send a CSV file, or paste a Google Sheets link, with columns *Name*, *Birthday* and *Photo* (a photo link, e.g. from Google Drive)

Other commands:
• *members*: everyone and their birthdays
• *upcoming*: birthdays in the next 30 days
• *today*: today's birthday flyers
• *flyer Ada*: see Ada's birthday flyer now
• *remove Ada Okafor*
• a photo captioned *photo Ada Okafor*: add or change Ada's photo
• *add admin 08012345678*: let someone else manage this group
• *colour gold* (or a code like #1a7f37): change the highlight colour; *colour reset* to undo
• *background*: send a picture with this caption to use it behind your birthday flyers; *background off* to undo
• *groups*: your groups; *switch 2* to change group; *new group* to add one
• *plan*: your group's plan; *plans* for prices
• *support*: message a person on our team

On each birthday I'll send you the flyer in the morning, ready to forward to the group.`;

const JPEG = "image/jpeg";
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
  };
  const owners = new Set(opts.owners);
  const now = opts.now ?? (() => new Date());
  const planOf = (group: Group) => currentPlan(group, now());

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
    try {
      prices = await opts.store.planPrices();
    } catch (err) {
      log.error("Could not load plan prices:", err);
    }
    const price = (p: Plan) => {
      const kobo = prices.get(p.id);
      if (p.id === "free") return "free";
      return kobo === undefined || kobo === null ? "price on request" : `${formatNaira(kobo)} a month`;
    };
    const lines = PLANS.map((p) => `*${p.label}* (${price(p)}): ${p.summary}.`);
    return `${opts.brandName} plans:\n\n${lines.join("\n\n")}\n\nSend *upgrade* and the plan's name, e.g. *upgrade standard*.`;
  }

  function formatDate(date: Date): string {
    const d = lagosNow(date);
    return `${formatMonthDay(d)} ${d.year}`;
  }

  /** A member to show designs with: the group's first member, or an outline before there are any. */
  async function sampleFor(group: Group) {
    const members = await opts.store.members(group.id);
    const first = members.find((m) => m.photoPath) ?? members[0];
    return {
      photo: first?.photoPath ? await opts.store.loadPicture(first.photoPath) : await placeholderPortrait(),
      name: first?.name ?? "Your Member",
      dateLabel: first ? formatMonthDay(first.birthday) : "14 October",
      groupName: group.name,
      logo: await logoFor(group),
    };
  }

  async function birthdayFlyer(member: Member, group: Group, wish?: string): Promise<Uint8Array> {
    return render.birthday({
      style: await styleFor(group),
      photo: member.photoPath ? await opts.store.loadPicture(member.photoPath) : undefined,
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
          const saved = await opts.store.saveMember(group.id, row.name, row.birthday, picture);
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

  async function handlePicture(group: Group, caption: string, picture: Picture): Promise<Reply> {
    const photoFor = caption.match(/^photo\s+(.+)$/i);
    if (photoFor) {
      const found = findMember(await opts.store.members(group.id), photoFor[1]!);
      if (found.length !== 1) return { text: notFound(found, photoFor[1]!) };
      const m = found[0]!;
      const member = await opts.store.saveMember(group.id, m.name, m.birthday, picture);
      return { text: `Photo saved for ${member.name} ✅`, images: [{ data: await birthdayFlyer(member, group), mimeType: JPEG }] };
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
      const member = await opts.store.saveMember(group.id, parsed.name, parsed.birthday, picture);
      const flyer = await birthdayFlyer(member, group);
      return {
        text: `Saved ${member.name} 🎂 ${formatMonthDay(member.birthday)}. Here's a preview of their flyer:`,
        images: [{ data: flyer, mimeType: JPEG }],
      };
    }

    if (!planOf(group).eventFlyers) {
      return needsPlan(
        `To add a member, put *add*, their name and birthday in the caption, e.g. *add Ada Okafor, 14 March*.\n\n${notOn("Turning photos into event flyers", group)}`,
        (p) => p.eventFlyers,
      );
    }
    const flyer = await render.event({
      photo: picture.data,
      caption,
      logo: await logoFor(group),
      style: await styleFor(group),
    });
    return {
      text: group.logoPath ? "" : "Tip: send your group logo with the caption *logo* and I'll add it to every flyer.",
      images: [{ data: flyer, mimeType: JPEG }],
    };
  }

  async function handleCommand(text: string, from: string, group: Group, groups: Group[]): Promise<Reply> {
    const lower = text.toLowerCase();
    const today = lagosNow(new Date());

    if (lower === "design" || lower === "designs") {
      const current = themeById(group.theme);
      return {
        text: `Your current design is *${current.label}*. Reply *design* and a number to change it, e.g. *design 2*.${designsNote(planOf(group))}`,
        images: [{ data: await designSheet(group), mimeType: JPEG }],
      };
    }

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
      return { text: forwardTip(celebrants.map((m) => m.name), group.name), images };
    }

    const flyerFor = text.match(/^(?:flyer|preview|test)\s+(.+)$/i);
    if (flyerFor) {
      const found = findMember(await opts.store.members(group.id), flyerFor[1]!);
      if (found.length !== 1) return { text: notFound(found, flyerFor[1]!) };
      const m = found[0]!;
      const wish = await opts.wishes.write({ name: m.name, groupName: group.name });
      return { text: "", images: [{ data: await birthdayFlyer(m, group, wish), mimeType: JPEG, caption: withCredit(group, wish) }] };
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
      const lapsed = plan.id !== group.plan;
      const until = !lapsed && plan.id !== "free" && group.planUntil ? ` until ${formatDate(group.planUntil)}` : "";
      const count = (await opts.store.members(group.id)).length;
      const limit = plan.maxMembers === null ? "" : ` of ${plan.maxMembers}`;
      return {
        text: [
          `*${group.name}* is on the *${plan.label}* plan${until}${lapsed ? ` (your ${group.plan} plan ran out on ${formatDate(group.planUntil!)})` : ""}.`,
          `Members: ${count}${limit}.`,
          `Includes: ${plan.summary}.`,
          "Send *plans* to compare, or *upgrade* and a plan's name.",
        ].join("\n"),
      };
    }

    const upgrade = text.match(/^(?:upgrade|renew)(?:\s+(?:to\s+)?(.+))?$/i);
    if (upgrade) {
      const wanted = upgrade[1] ? findPlan(upgrade[1]) : group.plan !== "free" ? findPlan(group.plan) : null;
      if (!wanted || wanted.id === "free") return { text: await plansText() };
      const contact = `${from}${group.name ? ` for "${group.name}"` : ""}`;
      return {
        text: `Thanks! We'll message you shortly with how to pay for *${wanted.label}*. Your group switches over as soon as it's paid.`,
        notify: opts.owners.map((to) => ({
          to,
          text: `💰 Upgrade request: ${contact} wants *${wanted.label}*.\nWhen they've paid, send: set plan ${wanted.id} 1 month for ${group.name}`,
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
    // Renewing early adds the time on top of what's left.
    const current = currentPlan(group, now());
    const start = current.id !== "free" && group.planUntil && group.planUntil > now() ? group.planUntil : now();
    const until = addMonths(start, months);
    await opts.store.setPlan(group.id, plan.id, until);
    log.info(`Flyer group "${group.name}" set to ${plan.id} until ${until.toISOString()}`);
    return { text: `✅ ${group.name} is on *${plan.label}* until ${formatDate(until)}.` };
  }

  /** Null if this person may set up another group, otherwise the reply saying why not. */
  function canCreateGroup(isOwner: boolean, groups: Group[]): Reply | null {
    if (isOwner) return null;
    if (!opts.openSignup) return { text: "Sorry, only the account owner can set up new groups." };
    // One Free group each; people whose groups are all on paid plans can add more.
    const free = groups.find((g) => planOf(g).id === "free");
    if (!free) return null;
    return {
      text: `Each person can run one group on the Free plan, and *${free.name}* is on Free. To set up another group, upgrade it first (send *upgrade standard*), or send *support* to ask about the *Organisation* plan for several groups.`,
    };
  }

  function designsNote(plan: Plan): string {
    if (plan.designs === "all") return "";
    const numbers = THEMES.flatMap((t, i) => (allowsDesign(plan, t.id) ? [`${i + 1}`] : []));
    return `\n\nYour *${plan.label}* plan includes designs ${numbers.join(" and ")}; send *upgrade standard* for all of them.`;
  }

  async function designSheet(group: Group): Promise<Uint8Array> {
    const style = await styleFor(group);
    return render.designSheet(await sampleFor(group), THEMES, { accent: style.accent, credit: style.credit });
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
    const step2 = async (lead: string): Promise<Reply> => {
      await opts.store.setChatState(msg.from, { step: "design", groupId: group.id });
      return {
        text: `${lead}*Step 2 of 3: pick a design.* Here they all are with your group's name on them. Reply with a number, e.g. *1*, or *skip* to keep design 1.${designsNote(planOf(group))}`,
        images: [{ data: await designSheet(group), mimeType: JPEG }],
      };
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
        await opts.store.setChatState(msg.from, { step: "logo", groupId: group.id });
        log.info(`New flyer group "${group.name}" set up by ...${msg.from.slice(-4)}`);
        return {
          text: `Created *${group.name}* ✅ You're its admin. Three quick steps to get it ready:\n\n*Step 1 of 3: your logo.* Send your group's logo as a picture. (Send it as a document to keep a see-through background.) No logo? Reply *skip*.`,
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
          text: `Hi! I'm ${opts.brandName} 🎉 I make birthday flyers for the members of your WhatsApp group (alumni, friends, church, work), send them to you on each birthday morning ready to forward, and brand your event photos with your group's logo.\n\nIt's free for groups of up to 20 people (send *plans* for bigger groups). Questions? Send *support*.\n\nLet's set up your group. *What's it called?* Reply with its name, e.g. *Unilag Class of 2010*.`,
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
        return handlePicture(group, text, { data: new Uint8Array(await file.data.arrayBuffer()), mimeType: file.mimeType });
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

    async sendDueBirthdays(now, delivery) {
      const today = lagosNow(now);
      if (today.hour < opts.sendHour) return;
      const due = await opts.store.birthdaysOn(birthdaysCelebratedOn(today.year, today.month, today.day));

      for (const { member, group, admins: all } of due) {
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
