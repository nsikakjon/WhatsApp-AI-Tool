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

Other commands:
• *members*: everyone and their birthdays
• *upcoming*: birthdays in the next 30 days
• *today*: today's birthday flyers
• *flyer Ada*: see Ada's birthday flyer now
• *remove Ada Okafor*
• *add admin 08012345678*: let someone else manage this group
• *colour gold* (or a code like #1a7f37): change the highlight colour; *colour reset* to undo
• *background*: send a picture with this caption to use it behind your birthday flyers; *background off* to undo
• *groups*: your groups (and *switch <name>*)

On each birthday I'll send you the flyer in the morning, ready to forward to the group.`;

const JPEG = "image/jpeg";

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
    return {
      theme: themeById(group.theme),
      accent: group.accent ?? undefined,
      background,
      credit: opts.credit || undefined,
    };
  }

  /** A member to show designs with: the group's first member, or an outline before there are any. */
  async function sampleFor(group: Group) {
    const first = (await opts.store.members(group.id))[0];
    return {
      photo: first ? await opts.store.loadPicture(first.photoPath) : await placeholderPortrait(),
      name: first?.name ?? "Your Member",
      dateLabel: first ? formatMonthDay(first.birthday) : "14 October",
      groupName: group.name,
      logo: await logoFor(group),
    };
  }

  async function birthdayFlyer(member: Member, group: Group): Promise<Uint8Array> {
    return render.birthday({
      style: await styleFor(group),
      photo: await opts.store.loadPicture(member.photoPath),
      name: member.name,
      dateLabel: formatMonthDay(member.birthday),
      groupName: group.name,
      logo: await logoFor(group),
    });
  }

  async function downloadPicture(
    msg: IncomingMessage,
    download: (id: string) => Promise<{ data: Blob; mimeType: string }>,
  ): Promise<Picture | null> {
    const file = await download(msg.mediaId!);
    if (!/^image\/(jpeg|png|webp)$/.test(file.mimeType)) return null;
    return { data: new Uint8Array(await file.data.arrayBuffer()), mimeType: file.mimeType };
  }

  async function handlePicture(
    msg: IncomingMessage,
    group: Group,
    caption: string,
    download: (id: string) => Promise<{ data: Blob; mimeType: string }>,
  ): Promise<Reply> {
    const picture = await downloadPicture(msg, download);
    if (!picture) return { text: "Please send a photo (JPG or PNG)." };

    if (/^logo$/i.test(caption)) {
      await opts.store.saveLogo(group.id, picture);
      return { text: `Logo saved for ${group.name} ✅ It'll appear on every flyer from now on.` };
    }

    if (/^background$/i.test(caption)) {
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
      const member = await opts.store.saveMember(group.id, parsed.name, parsed.birthday, picture);
      const flyer = await birthdayFlyer(member, group);
      return {
        text: `Saved ${member.name} 🎂 ${formatMonthDay(member.birthday)}. Here's a preview of their flyer:`,
        images: [{ data: flyer, mimeType: JPEG }],
      };
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
      const sheet = await render.designSheet(await sampleFor(group), THEMES, {
        accent: group.accent ?? undefined,
        credit: opts.credit || undefined,
      });
      const current = themeById(group.theme);
      return {
        text: `Your current design is *${current.label}*. Reply *design* and a number to change it, e.g. *design 2*.`,
        images: [{ data: sheet, mimeType: JPEG }],
      };
    }

    const design = text.match(/^design\s+(.+)$/i);
    if (design) {
      const theme = findTheme(design[1]!);
      if (!theme) return { text: `I don't have a design called "${design[1]}". Send *design* to see them all.` };
      await opts.store.setStyle(group.id, { theme: theme.id });
      const updated = { ...group, theme: theme.id };
      const flyer = await render.birthday({ ...(await sampleFor(updated)), style: await styleFor(updated) });
      const note = group.backgroundPath ? " (your own background picture is still on; send *background off* to see the design's colours)" : "";
      return { text: `Design changed to *${theme.label}* ✅${note}`, images: [{ data: flyer, mimeType: JPEG }] };
    }

    const colour = text.match(/^colou?r\s+(.+)$/i);
    if (colour) {
      const wanted = colour[1]!.trim().toLowerCase();
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
        images.push({ data: await birthdayFlyer(m, group), mimeType: JPEG, caption: wish });
      }
      return { text: forwardTip(celebrants.map((m) => m.name), group.name), images };
    }

    const flyerFor = text.match(/^(?:flyer|preview|test)\s+(.+)$/i);
    if (flyerFor) {
      const found = findMember(await opts.store.members(group.id), flyerFor[1]!);
      if (found.length !== 1) return { text: notFound(found, flyerFor[1]!) };
      const m = found[0]!;
      const wish = await opts.wishes.write({ name: m.name, groupName: group.name });
      return { text: "", images: [{ data: await birthdayFlyer(m, group), mimeType: JPEG, caption: wish }] };
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
      await opts.store.addAdmin(group.id, number);
      return {
        text: `Done. ${number} can now manage ${group.name}. Ask them to send "hi" to this number so I can send them birthday flyers.`,
      };
    }

    if (lower === "groups") {
      const list = groups.map((g, i) => `• ${g.name}${i === 0 ? " (current)" : ""}`).join("\n");
      return { text: `Your groups:\n${list}\n\nSend *switch <name>* to change group.` };
    }

    const switchTo = text.match(/^(?:switch|use)\s+(.+)$/i);
    if (switchTo) {
      const q = switchTo[1]!.toLowerCase();
      const target = groups.find((g) => g.name.toLowerCase() === q) ?? groups.find((g) => g.name.toLowerCase().includes(q));
      if (!target) return { text: `You're not an admin of a group called "${switchTo[1]}". Send *groups* to see yours.` };
      await opts.store.useGroup(target.id, from);
      return { text: `Now working on ${target.name}.` };
    }

    return { text: `*${group.name}*\n\n${HELP}` };
  }

  return {
    name: "flyer",

    async handle(msg, ctx): Promise<Reply | null> {
      const text = (msg.text ?? msg.caption ?? "").trim();
      const isOwner = owners.has(msg.from);
      const groups = await opts.store.groupsForAdmin(msg.from);

      const newGroup = text.match(/^new group\s+(.+)$/i);
      if (newGroup) {
        // Owners can set up any number of groups; with open sign-up, anyone else can set up one.
        if (!isOwner && !(opts.openSignup && groups.length === 0)) {
          return {
            text: opts.openSignup
              ? "You already run a group here. To set up another one, please contact us."
              : "Sorry, only the account owner can set up new groups.",
          };
        }
        const name = newGroup[1]!.trim().slice(0, 80);
        const group = await opts.store.createGroup(name, msg.from);
        log.info(`New flyer group "${group.name}" set up by ...${msg.from.slice(-4)}`);
        const who = msg.contactName ? `${msg.contactName} (${msg.from})` : msg.from;
        return {
          text: `Created *${group.name}* ✅ You're its admin.\n\n${HELP}`,
          notify: isOwner
            ? undefined
            : opts.owners.map((to) => ({ to, text: `🎉 New sign-up: ${who} set up "${group.name}" on ${opts.brandName}.` })),
        };
      }

      const group = groups[0];
      if (!group) {
        if (isOwner) return { text: "Welcome! Set up your first group by sending, for example:\nnew group Unilag Class of 2010" };
        return {
          text: opts.openSignup
            ? `Hi! I'm ${opts.brandName} 🎉 I make birthday flyers for the members of your WhatsApp group (alumni, friends, church, work) and remind you on each birthday morning, and I brand your event photos with your group's logo.\n\nTo start, send *new group* and your group's name, e.g.\nnew group Unilag Class of 2010`
            : "Hello! This number makes birthday and event flyers for WhatsApp groups. Ask your group's admin to add you.",
        };
      }

      const isPicture = (msg.type === "image" || msg.type === "document") && msg.mediaId;
      if (isPicture) return handlePicture(msg, group, text, ctx.downloadMedia);
      if (!text) return { text: `*${group.name}*\n\n${HELP}` };
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
          const flyer = await birthdayFlyer(member, group);
          const wish = await opts.wishes.write({ name: member.name, groupName: group.name });
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
