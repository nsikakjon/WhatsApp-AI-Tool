import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import type { MonthDay } from "./dates.js";
import {
  createFlyerBot,
  forwardTip,
  normalizeNumber,
  parseAddCaption,
  type BirthdayDeliverer,
  type BirthdayDelivery,
} from "./index.js";
import type { ChatState, FlyerStore, Group, Member } from "./store.js";
import { THEMES } from "./themes.js";
import type { Trial } from "./plans.js";
import type { PaymentLinks, PaymentRequest } from "../../core/payments/payments.js";
import type { Payment } from "../../core/payments/store.js";

const silent = { info: () => {}, error: () => {} };
const OWNER = "2348000000001";
const ADMIN = "2348000000002";

function memoryStore(plan = "organisation") {
  const groups: Group[] = [];
  const admins: Array<{ groupId: string; waId: string; usedAt: number }> = [];
  const members: Member[] = [];
  const pictures = new Map<string, Uint8Array>();
  const cutouts = new Map<string, Uint8Array | null>();
  const claims = new Set<string>();
  const chat = new Map<string, ChatState>();
  let clock = 0;

  const store: FlyerStore = {
    async groupsForAdmin(waId) {
      return admins
        .filter((a) => a.waId === waId)
        .sort((a, b) => b.usedAt - a.usedAt)
        .map((a) => groups.find((g) => g.id === a.groupId)!);
    },
    async createGroup(name, adminWaId) {
      const group: Group = {
        id: `g${groups.length + 1}`,
        name,
        logoPath: null,
        theme: "royal",
        accent: null,
        backgroundPath: null,
        plan,
        planUntil: null,
        trialFlyersLeft: null,
      };
      groups.push(group);
      await store.addAdmin(group.id, adminWaId);
      return group;
    },
    async addAdmin(groupId, waId) {
      admins.push({ groupId, waId, usedAt: ++clock });
    },
    async useGroup(groupId, waId) {
      admins.find((a) => a.groupId === groupId && a.waId === waId)!.usedAt = ++clock;
    },
    async saveLogo(groupId, logo) {
      const path = `${groupId}/logo`;
      pictures.set(path, logo.data);
      groups.find((g) => g.id === groupId)!.logoPath = path;
    },
    async saveBackground(groupId, picture) {
      const path = picture ? `${groupId}/background` : null;
      if (picture && path) pictures.set(path, picture.data);
      groups.find((g) => g.id === groupId)!.backgroundPath = path;
    },
    async setStyle(groupId, style) {
      Object.assign(groups.find((g) => g.id === groupId)!, style);
    },
    async saveMember(groupId, name, birthday, photo) {
      const path = photo ? `${groupId}/${name}` : null;
      if (photo && path) pictures.set(path, photo.data);
      const existing = members.find((m) => m.groupId === groupId && m.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        Object.assign(existing, { birthday }, path ? { photoPath: path } : {});
        return { ...existing, isNew: false };
      }
      const member: Member = { id: `m${members.length + 1}`, groupId, name, birthday, photoPath: path };
      members.push(member);
      return { ...member, isNew: true };
    },
    async removeMember(id) {
      members.splice(members.findIndex((m) => m.id === id), 1);
    },
    async members(groupId) {
      return members.filter((m) => m.groupId === groupId);
    },
    async birthdaysOn(dates: MonthDay[]) {
      return members
        .filter((m) => dates.some((d) => d.month === m.birthday.month && d.day === m.birthday.day))
        .map((member) => ({
          member,
          group: groups.find((g) => g.id === member.groupId)!,
          admins: admins.filter((a) => a.groupId === member.groupId).map((a) => a.waId),
        }));
    },
    async loadCutout(photoPath) {
      return cutouts.get(photoPath);
    },
    async saveCutout(photoPath, png) {
      cutouts.set(photoPath, png);
    },
    async loadPicture(path) {
      const pic = pictures.get(path);
      if (!pic) throw new Error(`no picture at ${path}`);
      return pic;
    },
    async claimBirthday(memberId, year) {
      const key = `${memberId}:${year}`;
      if (claims.has(key)) return false;
      claims.add(key);
      return true;
    },
    async releaseBirthday(memberId, year) {
      claims.delete(`${memberId}:${year}`);
    },
    async findGroups(q) {
      return groups.filter((g) => g.name.toLowerCase().includes(q.toLowerCase()));
    },
    async groupById(groupId) {
      return groups.find((g) => g.id === groupId) ?? null;
    },
    async setPlan(groupId, plan, until) {
      Object.assign(groups.find((g) => g.id === groupId)!, { plan, planUntil: until, trialFlyersLeft: null });
    },
    async startTrial(groupId, plan, until, flyers) {
      Object.assign(groups.find((g) => g.id === groupId)!, { plan, planUntil: until, trialFlyersLeft: flyers });
    },
    async setTrialFlyersLeft(groupId, left) {
      groups.find((g) => g.id === groupId)!.trialFlyersLeft = left;
    },
    async adminCount(groupId) {
      return admins.filter((a) => a.groupId === groupId).length;
    },
    async chatState(waId) {
      return chat.get(waId) ?? null;
    },
    async setChatState(waId, state) {
      if (state) chat.set(waId, state);
      else chat.delete(waId);
    },
    async planPrices() {
      return new Map<string, number | null>([
        ["free", 0],
        ["standard", 450000],
        ["premium", 800000],
        ["deluxe", 1000000],
        ["organisation", null],
      ]);
    },
    async planYearlyPrices() {
      return new Map<string, number | null>([
        ["free", null],
        ["standard", 250000],
        ["premium", 650000],
        ["deluxe", 850000],
        ["organisation", null],
      ]);
    },
    async planStartingPrices() {
      return new Map<string, number | null>([["organisation", 7300000]]);
    },
  };
  return { store, groups, members, claims, chat, cutouts };
}

const background: Array<Promise<void>> = [];
const webFetch = (async (url: string) => {
  if (url.includes("docs.google.com")) {
    return new Response("Name,Birthday,Photo\nNkem Obi,2/5,https://pics.example.com/nkem.jpg\nBola,sometime,", {
      headers: { "content-type": "text/csv" },
    });
  }
  if (url.includes("broken")) return new Response("no", { status: 404 });
  return new Response(new Uint8Array([9]), { headers: { "content-type": "image/jpeg" } });
}) as unknown as typeof fetch;

// Groups start on the plan with everything, so these tests are about the features;
// the "plans" tests below start on Free.
function setup(opts: { openSignup?: boolean; plan?: string; now?: () => Date; trial?: Trial; payments?: PaymentLinks } = {}) {
  const mem = memoryStore(opts.plan);
  const render = {
    birthday: vi.fn(async (input: { name: string; logo?: Uint8Array }) =>
      Buffer.from(`birthday:${input.name}:${input.logo ? "logo" : "nologo"}`),
    ),
    event: vi.fn(async (input: { caption: string; logo?: Uint8Array }) =>
      Buffer.from(`event:${input.caption}:${input.logo ? "logo" : "nologo"}`),
    ),
    designSheet: vi.fn(async (sample: { name: string }) => Buffer.from(`sheet:${sample.name}`)),
    cutout: vi.fn(async (): Promise<Buffer | null> => Buffer.from("cut")),
  };
  const bot = createFlyerBot({
    store: mem.store,
    wishes: { write: async ({ name, groupName }) => `Happy birthday ${name} from ${groupName}` },
    owners: [OWNER],
    openSignup: opts.openSignup ?? false,
    brandName: "Flyer Bot",
    credit: "Made with Flyer Bot",
    sendHour: 7,
    render: render as never,
    log: silent,
    fetch: webFetch,
    onBackground: (work) => void background.push(work),
    now: opts.now,
    trial: opts.trial,
    payments: opts.payments,
  });
  return { bot, render, ...mem };
}

let n = 0;
function msg(from: string, fields: Partial<IncomingMessage>): IncomingMessage {
  return { waMessageId: `wamid.${++n}`, from, type: "text", timestamp: 0, raw: {}, ...fields };
}
function photo(from: string, caption?: string): IncomingMessage {
  return msg(from, { type: "image", mediaId: "media-1", caption });
}
const ctx = {
  contactId: "c1",
  history: [],
  downloadMedia: async () => ({ data: new Blob(["jpg"]), mimeType: "image/jpeg" }),
  sendLater: async (r: { text: string }) => void later.push(r.text),
  canMessageFreely: async () => true,
};
const later: string[] = [];
const text = (b: Uint8Array | undefined) => Buffer.from(b ?? []).toString();

async function withGroup(opts: Parameters<typeof setup>[0] = {}) {
  const s = setup(opts);
  await s.bot.handle(msg(OWNER, { text: "new group Unilag Class of 2010" }), ctx);
  return s;
}

describe("flyer bot: setup", () => {
  it("only lets owners create groups", async () => {
    const { bot, groups } = setup();
    const reply = await bot.handle(msg(ADMIN, { text: "new group Friends" }), ctx);
    expect(reply?.text).toContain("only the account owner");
    expect(groups).toHaveLength(0);
  });

  it("creates a group and makes the owner its admin", async () => {
    const { groups } = await withGroup();
    expect(groups.map((g) => g.name)).toEqual(["Unilag Class of 2010"]);
  });

  it("tells strangers to ask their group admin", async () => {
    const { bot } = setup();
    const reply = await bot.handle(msg("2348099999999", { text: "hi" }), ctx);
    expect(reply?.text).toContain("Ask your group's admin");
  });

  it("adds another admin by phone number", async () => {
    const { bot } = await withGroup();
    const reply = await bot.handle(msg(OWNER, { text: "add admin 0800 000 0002" }), ctx);
    expect(reply?.text).toContain("2348000000002 can now manage");
    const helped = await bot.handle(msg(ADMIN, { text: "hi" }), ctx);
    expect(helped?.text).toContain("Unilag Class of 2010");
  });

  it("switches between groups", async () => {
    const { bot } = await withGroup();
    await bot.handle(msg(OWNER, { text: "new group Lekki Crew" }), ctx);
    const list = (await bot.handle(msg(OWNER, { text: "groups" }), ctx))?.text;
    expect(list).toContain("1. Lekki Crew (Organisation) ← current");
    expect(list).toContain("2. Unilag Class of 2010 (Organisation)");
    await bot.handle(msg(OWNER, { text: "switch unilag" }), ctx);
    expect((await bot.handle(msg(OWNER, { text: "groups" }), ctx))?.text).toContain("2. Unilag Class of 2010 (Organisation) ← current");
    expect((await bot.handle(msg(OWNER, { text: "switch 1" }), ctx))?.text).toContain("Now working on *Lekki Crew*");
  });
});

describe("flyer bot: importing a member list", () => {
  const csvCtx = (csv: string) => ({ ...ctx, downloadMedia: async () => ({ data: new Blob([csv]), mimeType: "text/csv" }) });
  const settle = async () => {
    await Promise.all(background.splice(0));
  };

  it("imports a CSV file, downloading photos, and reports what's missing", async () => {
    const { bot, members } = await withGroup();
    later.length = 0;
    const csv = "Name,Birthday,Photo\nAda Okafor,14/03,https://pics.example.com/ada.jpg\nTunde,1 Jan,https://pics.example.com/broken.jpg\nBola,someday,";
    const reply = await bot.handle(msg(OWNER, { type: "document", mediaId: "d1" }), csvCtx(csv));
    expect(reply?.text).toBe("Found 3 members, 2 with photo links. Saving them now; I'll message you when it's done.");
    await settle();

    expect(members.map((m) => [m.name, m.photoPath !== null]).sort()).toEqual([["Ada Okafor", true], ["Tunde", false]]);
    expect(later[0]).toContain("2 saved (2 new, 0 updated)");
    expect(later[0]).toContain("1 without a photo");
    expect(later[0]).toContain("*photo Tunde*");
    expect(later[0]).toContain('row 4 (Bola: "someday")');
  });

  it("imports from a Google Sheets link and updates people already there", async () => {
    const { bot, members } = await withGroup();
    await bot.handle(photo(OWNER, "add Nkem Obi, 1 May"), ctx);
    later.length = 0;
    const reply = await bot.handle(msg(OWNER, { text: "https://docs.google.com/spreadsheets/d/abc/edit#gid=0" }), ctx);
    expect(reply?.text).toContain("Found 2 members");
    await settle();
    expect(members.find((m) => m.name === "Nkem Obi")?.birthday).toEqual({ month: 5, day: 2 });
    expect(later[0]).toContain("1 saved (0 new, 1 updated)");
  });

  it("explains when the list has no names, or the file isn't a list", async () => {
    const { bot } = await withGroup();
    expect((await bot.handle(msg(OWNER, { type: "document", mediaId: "d1" }), csvCtx("\n\n")))?.text).toContain("couldn't find any names");
  });

  it("adds a photo to a member who has none, and draws initials until then", async () => {
    const { bot, members, render } = await withGroup();
    await bot.handle(msg(OWNER, { type: "document", mediaId: "d1" }), csvCtx("Tunde Bakare,1 Jan"));
    await settle();
    await bot.handle(msg(OWNER, { text: "flyer tunde" }), ctx);
    expect((render.birthday.mock.calls.at(-1)![0] as { photo?: Uint8Array }).photo).toBeUndefined();

    const reply = await bot.handle(photo(OWNER, "photo tunde"), ctx);
    expect(reply?.text).toBe("Photo saved for Tunde Bakare ✅");
    expect(members[0]!.photoPath).not.toBeNull();
  });
});

describe("flyer bot: open sign-up", () => {
  it("walks a stranger through setting up a group: name, logo, design, then members", async () => {
    const { bot, groups, chat } = setup({ openSignup: true, plan: "free" });
    const hello = await bot.handle(msg(ADMIN, { text: "Hi" }), ctx);
    expect(hello?.text).toContain("I'm Flyer Bot");
    expect(hello?.text).toContain("What's it called?");

    expect((await bot.handle(msg(ADMIN, { text: "hello" }), ctx))?.text).toContain("What's your group called?");
    expect(groups).toHaveLength(0);

    const created = await bot.handle(msg(ADMIN, { text: "Lekki Crew", contactName: "Bola" }), ctx);
    expect(created?.text).toContain("Created *Lekki Crew*");
    expect(created?.text).toContain("Step 1 of 3");
    expect(created?.notify).toEqual([
      { to: OWNER, text: `🎉 New sign-up: Bola (${ADMIN}) set up "Lekki Crew" on Flyer Bot.` },
    ]);

    const logo = await bot.handle(photo(ADMIN), ctx);
    expect(logo?.text).toContain("Logo saved");
    expect(logo?.text).toContain("Step 2 of 3");
    expect(logo?.text).toContain("includes designs 1 and 4");
    expect(text(logo?.images?.[0]?.data)).toBe("sheet:Your Member");
    expect(groups[0]!.logoPath).not.toBeNull();

    expect(logo?.list?.rows[0]?.id).toBe("design 1");

    // Turning the page or looking closer keeps the setup going.
    expect((await bot.handle(msg(ADMIN, { text: "designs page 2" }), ctx))?.text).toContain("Designs 7 to");
    expect((await bot.handle(msg(ADMIN, { text: "see 7" }), ctx))?.text).toContain("Gold stars");
    expect(chat.get(ADMIN)?.step).toBe("design");

    expect((await bot.handle(msg(ADMIN, { text: "3" }), ctx))?.text).toContain("upgrade standard");
    const design = await bot.handle(msg(ADMIN, { text: "4" }), ctx);
    expect(design?.text).toContain("Design set to *Classic cream*");
    expect(design?.text).toContain("Step 3 of 3");
    expect(groups[0]!.theme).toBe("classic");
    expect(chat.size).toBe(0);
  });

  it("lets people skip setup steps, or leave setup by doing something else", async () => {
    const { bot, chat } = setup({ openSignup: true });
    await bot.handle(msg(ADMIN, { text: "new group Lekki Crew" }), ctx);
    const skipped = await bot.handle(msg(ADMIN, { text: "skip" }), ctx);
    expect(skipped?.text).toContain("Step 2 of 3");
    const members = await bot.handle(msg(ADMIN, { text: "members" }), ctx);
    expect(members?.text).toContain("No members in Lekki Crew yet");
    expect(chat.size).toBe(0);
  });

  it("allows one Free group each, and more once the others are paid for", async () => {
    const { bot, groups } = setup({ openSignup: true, plan: "free" });
    await bot.handle(msg(ADMIN, { text: "new group Lekki Crew" }), ctx);
    const second = await bot.handle(msg(ADMIN, { text: "new group Another" }), ctx);
    expect(second?.text).toContain("one free group, and *Lekki Crew* is on Free");
    expect(groups).toHaveLength(1);

    await bot.handle(msg(OWNER, { text: "set plan standard 1 month for Lekki Crew" }), ctx);
    const third = await bot.handle(msg(ADMIN, { text: "new group Another" }), ctx);
    expect(third?.text).toContain("Created *Another*");
    expect(groups).toHaveLength(2);
  });

  it("lets owners set up many groups without alerting themselves", async () => {
    const { bot, groups } = setup({ openSignup: true });
    expect((await bot.handle(msg(OWNER, { text: "new group A" }), ctx))?.notify).toBeUndefined();
    await bot.handle(msg(OWNER, { text: "new group B" }), ctx);
    expect(groups).toHaveLength(2);
  });
});

describe("flyer bot: support", () => {
  it("passes a support message to the owners, and their answer back", async () => {
    const { bot } = await withGroup();
    await bot.handle(msg(OWNER, { text: `add admin ${ADMIN}` }), ctx);
    const ask = await bot.handle(msg(ADMIN, { text: "support" }), ctx);
    expect(ask?.text).toContain("What do you need help with?");
    const sent = await bot.handle(msg(ADMIN, { text: "My flyer shows the wrong date", contactName: "Bola" }), ctx);
    expect(sent?.text).toContain("passed that to our team");
    expect(sent?.notify?.[0]).toMatchObject({ to: OWNER });
    expect(sent?.notify?.[0]?.text).toContain("Bola (2348000000002) (group: Unilag Class of 2010, Organisation plan):\nMy flyer shows the wrong date");
    expect(sent?.notify?.[0]?.text).toContain(`reply ${ADMIN} <your message>`);

    const answer = await bot.handle(msg(OWNER, { text: `reply ${ADMIN} Fixed it, send flyer Ada to check` }), ctx);
    expect(answer?.notify).toEqual([{ to: ADMIN, text: "💬 *Flyer Bot support:* Fixed it, send flyer Ada to check" }]);
  });

  it("takes a support message in one go, even from someone without a group", async () => {
    const { bot } = setup({ openSignup: true });
    const sent = await bot.handle(msg(ADMIN, { text: "support how much is premium?" }), ctx);
    expect(sent?.notify?.[0]?.text).toContain("how much is premium?");
  });
});

describe("flyer bot: designs", () => {
  it("shows the designs six at a time, with a list to pick one or turn the page", async () => {
    const { bot, render } = await withGroup();
    const reply = await bot.handle(msg(OWNER, { text: "design" }), ctx);
    expect(reply?.text).toContain("current design is *Royal purple*");
    expect(reply?.text).toContain(`Designs 1 to 6 of ${THEMES.length}`);
    expect(text(reply?.images?.[0]?.data)).toBe("sheet:Your Member");
    const items = render.designSheet.mock.calls[0]![1] as Array<{ number: number; note?: string }>;
    expect(items.map((i) => i.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(items[0]!.note).toBe("Your design");
    expect(render.designSheet.mock.calls[0]![2]).toEqual({ accent: undefined, credit: undefined });
    const rows = reply?.list?.rows ?? [];
    expect(rows.map((r) => r.id)).toEqual(["design 1", "design 2", "design 3", "design 4", "design 5", "design 6", "designs page 2"]);
    expect(rows[1]!.title).toBe("2. Emerald and gold");

    // Tapping "More designs" sends its id back as text.
    const next = await bot.handle(msg(OWNER, { text: "designs page 2" }), ctx);
    expect(next?.text).toContain("Designs 7 to");
    const nextItems = render.designSheet.mock.calls[1]![1] as Array<{ number: number }>;
    expect(nextItems[0]!.number).toBe(7);
    expect(next?.list?.rows.at(-1)).toMatchObject({ id: "designs page 1", title: "◀ Back" });
    expect((await bot.handle(msg(OWNER, { text: "more designs" }), ctx))?.text).toContain("Designs 7 to");
    expect((await bot.handle(msg(OWNER, { text: "page 99" }), ctx))?.text).toContain(`of ${THEMES.length}`);
  });

  it("marks designs the group's plan doesn't include", async () => {
    const { bot, render } = await withGroup({ plan: "free" });
    const reply = await bot.handle(msg(OWNER, { text: "design" }), ctx);
    const items = render.designSheet.mock.calls[0]![1] as Array<{ number: number; note?: string }>;
    expect(items.map((i) => i.note)).toEqual(["Your design", "Standard plan", "Standard plan", undefined, "Standard plan", "Standard plan"]);
    expect(reply?.list?.rows[3]).toEqual({ id: "design 4", title: "4. Classic cream", description: undefined });
  });

  it("shows one design full size without switching to it", async () => {
    const { bot, groups, render } = await withGroup({ plan: "free" });
    const reply = await bot.handle(msg(OWNER, { text: "see 8" }), ctx);
    expect(reply?.text).toContain("design 8, *Evening gala*");
    expect(reply?.text).toContain("Reply *design 8* to use it");
    expect(reply?.text).toContain("*Standard* plan");
    const style = (render.birthday.mock.calls.at(-1)![0] as { style: { theme: { id: string } } }).style;
    expect(style.theme.id).toBe("gala");
    expect(groups[0]!.theme).toBe("royal");
    expect((await bot.handle(msg(OWNER, { text: "see design 99" }), ctx))?.text).toContain("don't have a design");
  });

  it("changes the design by number or name, and shows a preview", async () => {
    const { bot, groups, render } = await withGroup();
    await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
    const reply = await bot.handle(msg(OWNER, { text: "design 2" }), ctx);
    expect(reply?.text).toContain("Emerald and gold");
    expect(groups[0]!.theme).toBe("emerald");
    expect(text(reply?.images?.[0]?.data)).toBe("birthday:Ada Okafor:nologo");
    const style = (render.birthday.mock.calls.at(-1)![0] as { style: { theme: { id: string } } }).style;
    expect(style.theme.id).toBe("emerald");

    await bot.handle(msg(OWNER, { text: "design midnight" }), ctx);
    expect(groups[0]!.theme).toBe("midnight");
    expect((await bot.handle(msg(OWNER, { text: "design 99" }), ctx))?.text).toContain("don't have a design");
  });

  it("changes and resets the highlight colour", async () => {
    const { bot, groups } = await withGroup();
    await bot.handle(msg(OWNER, { text: "colour red" }), ctx);
    expect(groups[0]!.accent).toBe("#e63946");
    await bot.handle(msg(OWNER, { text: "color #1A7F37" }), ctx);
    expect(groups[0]!.accent).toBe("#1a7f37");
    expect((await bot.handle(msg(OWNER, { text: "colour sparkly" }), ctx))?.text).toContain("Try one of");
    await bot.handle(msg(OWNER, { text: "colour reset" }), ctx);
    expect(groups[0]!.accent).toBeNull();
  });

  it("uses an uploaded background until it's switched off", async () => {
    const { bot, groups, render } = await withGroup();
    const reply = await bot.handle(photo(OWNER, "background"), ctx);
    expect(reply?.text).toContain("Background saved");
    expect(groups[0]!.backgroundPath).toBe("g1/background");
    const style = (render.birthday.mock.calls.at(-1)![0] as { style: { background?: Uint8Array } }).style;
    expect(style.background).toBeDefined();

    await bot.handle(msg(OWNER, { text: "background off" }), ctx);
    expect(groups[0]!.backgroundPath).toBeNull();
  });

  it("puts the credit and colour on event flyers", async () => {
    const { bot, render } = await withGroup({ plan: "standard" });
    await bot.handle(msg(OWNER, { text: "colour gold" }), ctx);
    await bot.handle(photo(OWNER, "Homecoming"), ctx);
    const style = (render.event.mock.calls.at(-1)![0] as { style: { accent?: string; credit?: string } }).style;
    expect(style).toMatchObject({ accent: "#f5c451", credit: "Made with Flyer Bot" });
  });
});

describe("flyer bot: plans", () => {
  it("lists the plans with prices from the database", async () => {
    const { bot } = setup();
    const reply = await bot.handle(msg("2348099999999", { text: "plans" }), ctx);
    expect(reply?.text).toContain("*Free* (free): up to 10 members");
    expect(reply?.text).toContain("*Standard* (₦4,500 a month, or ₦2,500 a month paid yearly (₦30,000 a year)): up to 50 members");
    expect(reply?.text).toContain("*Premium* (₦8,000 a month, or ₦6,500 a month paid yearly (₦78,000 a year)): up to 500 members");
    expect(reply?.text).toContain("*Deluxe* (₦10,000 a month, or ₦8,500 a month paid yearly (₦102,000 a year)): unlimited members");
    expect(reply?.text).toContain("*Organisation* (from ₦73,000 a month, agreed with you)");
  });

  it("stops a Free group at 10 members, but still updates existing ones", async () => {
    const { bot, members } = await withGroup({ plan: "free" });
    for (let i = 1; i <= 10; i++) await bot.handle(photo(OWNER, `add Member ${i}, 1 March`), ctx);
    expect(members).toHaveLength(10);
    const full = await bot.handle(photo(OWNER, "add Member 11, 1 March"), ctx);
    expect(full?.text).toContain("the most the *Free* plan allows");
    expect(full?.text).toContain("upgrade standard");
    expect(members).toHaveLength(10);
    const update = await bot.handle(photo(OWNER, "add Member 3, 2 April"), ctx);
    expect(update?.text).toContain("Saved Member 3");
  });

  it("locks paid features on Free and points to the right plan", async () => {
    const { bot, render } = await withGroup({ plan: "free" });
    expect((await bot.handle(msg(OWNER, { text: "design 2" }), ctx))?.text).toContain("upgrade standard");
    expect((await bot.handle(msg(OWNER, { text: "design 4" }), ctx))?.text).toContain("Design changed");
    expect((await bot.handle(msg(OWNER, { text: "colour gold" }), ctx))?.text).toContain("Changing the colour isn't included");
    expect((await bot.handle(photo(OWNER, "background"), ctx))?.text).toContain("upgrade premium");
    expect((await bot.handle(photo(OWNER, "Homecoming"), ctx))?.text).toContain("event flyers isn't included");
    expect(render.event).not.toHaveBeenCalled();
    expect((await bot.handle(msg(OWNER, { text: "add admin 08011111111" }), ctx))?.text).toContain("allows 1 admin");
    expect((await bot.handle(msg(OWNER, { text: "https://docs.google.com/spreadsheets/d/abc/edit" }), ctx))?.text).toContain(
      "Importing a list isn't included",
    );
  });

  it("imports only up to the member limit and says who was left out", async () => {
    const { bot, members } = await withGroup({ plan: "standard" });
    const rows = Array.from({ length: 53 }, (_, i) => `Person ${i + 1},1/1,`).join("\n");
    const withCsv = { ...ctx, downloadMedia: async () => ({ data: new Blob([`Name,Birthday,Photo\n${rows}`]), mimeType: "text/csv" }) };
    later.length = 0;
    await bot.handle(msg(OWNER, { type: "document", mediaId: "csv" }), withCsv);
    await Promise.all(background);
    expect(members).toHaveLength(50);
    expect(later.at(-1)).toContain("3 not added");
    expect(later.at(-1)).toContain("upgrade premium");
  });

  it("puts the credit line on Standard flyers but not Premium ones", async () => {
    for (const [plan, credit] of [["standard", "Made with Flyer Bot"], ["premium", undefined]] as const) {
      const { bot, render } = await withGroup({ plan });
      await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
      const style = (render.birthday.mock.calls.at(-1)![0] as { style: { credit?: string } }).style;
      expect(style.credit).toBe(credit);
    }
  });

  it("lets owners set a plan, extends it when renewed early, and drops to Free when it runs out", async () => {
    let now = new Date("2026-10-10T10:00:00Z");
    const { bot, groups, render } = await withGroup({ plan: "free", now: () => now });
    const set = await bot.handle(msg(OWNER, { text: "set plan premium 1 month for unilag class of 2010" }), ctx);
    expect(set?.text).toContain("*Premium* until 10 November 2026");
    await bot.handle(msg(OWNER, { text: "set plan premium 1 month for Unilag" }), ctx);
    expect(groups[0]!.planUntil?.toISOString()).toBe("2026-12-10T10:00:00.000Z");
    expect((await bot.handle(msg(OWNER, { text: "plan" }), ctx))?.text).toContain("on the *Premium* plan until 10 December 2026");

    await bot.handle(msg(OWNER, { text: "colour gold" }), ctx);
    now = new Date("2026-12-11T10:00:00Z");
    expect((await bot.handle(msg(OWNER, { text: "plan" }), ctx))?.text).toContain("ran out on 10 December 2026");
    await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
    const style = (render.birthday.mock.calls.at(-1)![0] as { style: { accent?: string; credit?: string } }).style;
    expect(style).toMatchObject({ accent: undefined, credit: "Made with Flyer Bot" });
  });

  it("only owners can set plans", async () => {
    const { bot, groups } = await withGroup({ plan: "free" });
    await bot.handle(msg(ADMIN, { text: "set plan premium 1 month for Unilag" }), ctx);
    expect(groups[0]!.plan).toBe("free");
  });

  it("adds the clickable credit line to the birthday message on Free, so it travels with the flyer", async () => {
    for (const [plan, caption] of [
      ["free", "Happy birthday Ada Okafor from Unilag Class of 2010\n\nMade with Flyer Bot"],
      ["premium", "Happy birthday Ada Okafor from Unilag Class of 2010"],
    ] as const) {
      const { bot } = await withGroup({ plan });
      await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
      const reply = await bot.handle(msg(OWNER, { text: "flyer Ada" }), ctx);
      expect(reply?.images?.[0]?.caption).toBe(caption);
    }
  });

  it("gives the drawing step the birthday message, for the design that prints it", async () => {
    const { bot, render } = await withGroup();
    await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
    await bot.handle(msg(OWNER, { text: "flyer Ada" }), ctx);
    expect(render.birthday.mock.calls.at(-1)![0]).toMatchObject({ wish: "Happy birthday Ada Okafor from Unilag Class of 2010" });
  });

  it("passes upgrade requests to the owners", async () => {
    const { bot } = await withGroup({ plan: "free" });
    const reply = await bot.handle(msg(OWNER, { text: "upgrade standard" }), ctx);
    expect(reply?.text).toContain("how to pay for *Standard*");
    expect(reply?.notify?.[0]?.text).toContain("set plan standard 1 month for Unilag Class of 2010");
  });
});

describe("flyer bot: paying online", () => {
  const JAN = new Date("2026-01-15T09:00:00Z");

  function paystack(fail = false) {
    return {
      createLink: vi.fn(async (req: PaymentRequest) => {
        if (fail) throw new Error("Paystack down");
        const url = `https://checkout.paystack.com/${String(req.purpose.plan)}`;
        if (!req.promo) return { url, amountKobo: req.amountKobo, promo: null };
        if (req.promo.code !== "DAYONES") return { url: null, refused: { result: "used" as const, code: req.promo.code, maxUses: 10 } };
        const off = req.amountKobo / req.promo.months / 2;
        return { url, amountKobo: req.amountKobo - off, promo: { code: "DAYONES", percentOff: 50, amountOffKobo: off } };
      }),
    };
  }

  const paid = (purpose: Record<string, unknown>, amountKobo: number): Payment => ({
    id: "p1",
    reference: "yarnoga-flyer-1",
    product: "flyer",
    waId: OWNER,
    purpose,
    amountKobo,
    status: "paid",
  });

  it("sends a checkout link priced from the database for the months asked", async () => {
    const payments = paystack();
    const { bot, groups } = await withGroup({ plan: "free", payments });
    const reply = await bot.handle(msg(OWNER, { text: "upgrade standard 3 months" }), ctx);
    expect(payments.createLink).toHaveBeenCalledWith(
      expect.objectContaining({ product: "flyer", waId: OWNER, amountKobo: 1350000, purpose: { groupId: groups[0]!.id, plan: "standard", months: 3 } }),
    );
    expect(reply?.text).toContain("₦13,500");
    expect(reply?.text).toContain("https://checkout.paystack.com/standard");
    expect(reply?.notify).toBeUndefined();
  });

  it("charges the paid-yearly price for a year", async () => {
    const payments = paystack();
    const { bot } = await withGroup({ plan: "free", payments });
    const reply = await bot.handle(msg(OWNER, { text: "upgrade premium 1 year" }), ctx);
    expect(payments.createLink.mock.calls[0]![0]).toMatchObject({ amountKobo: 7800000, purpose: { months: 12 } });
    expect(reply?.text).toContain("1 year: *₦78,000*");
  });

  it("falls back to the owners when Paystack fails or the price is on request", async () => {
    const down = await withGroup({ plan: "free", payments: paystack(true) });
    const reply = await down.bot.handle(msg(OWNER, { text: "upgrade standard 2 months" }), ctx);
    expect(reply?.text).toContain("how to pay for *Standard*");
    expect(reply?.notify?.[0]?.text).toContain("set plan standard 2 months for");

    const payments = paystack();
    const { bot } = await withGroup({ plan: "free", payments });
    const org = await bot.handle(msg(OWNER, { text: "upgrade organisation" }), ctx);
    expect(payments.createLink).not.toHaveBeenCalled();
    expect(org?.notify?.[0]?.text).toContain("set plan organisation");
  });

  it("takes off a promo code typed at the end of the upgrade", async () => {
    const payments = paystack();
    const { bot } = await withGroup({ plan: "free", payments });
    const reply = await bot.handle(msg(OWNER, { text: "upgrade standard 3 months DAYONES" }), ctx);
    expect(payments.createLink.mock.calls[0]![0]).toMatchObject({ amountKobo: 1350000, promo: { code: "DAYONES", months: 3 } });
    expect(reply?.text).toContain("*₦11,250*");
    expect(reply?.text).toContain("you save ₦2,250");
    const again = await bot.handle(msg(OWNER, { text: "upgrade standard code oldone" }), ctx);
    expect(again?.text).toContain("already used *OLDONE*");
  });

  it("takes at most 12 months in one payment", async () => {
    const { bot } = await withGroup({ plan: "free", payments: paystack() });
    expect((await bot.handle(msg(OWNER, { text: "upgrade premium 2 years" }), ctx))?.text).toContain("1 to 12 months");
  });

  it("moves the group onto the plan once paid, and tells the payer and owners", async () => {
    const { bot, groups } = await withGroup({ plan: "free", now: () => JAN });
    const notes = await bot.planPaid(paid({ groupId: groups[0]!.id, plan: "standard", months: 1 }, 450000));
    expect(groups[0]).toMatchObject({ plan: "standard", planUntil: new Date("2026-02-15T09:00:00Z") });
    expect(notes[0]).toMatchObject({ to: OWNER, text: expect.stringContaining("₦4,500 received") });
    expect(notes.some((m) => m.text.startsWith("💰 Paid"))).toBe(true);
  });

  it("refuses a payment for a group that's gone, so it can be retried", async () => {
    const { bot } = await withGroup({ plan: "free" });
    await expect(bot.planPaid(paid({ groupId: "nope", plan: "standard", months: 1 }, 450000))).rejects.toThrow();
  });
});

describe("flyer bot: free trial", () => {
  const trial: Trial = { plan: "standard", days: 7, flyers: 3 };
  const start = new Date("2026-10-16T10:00:00Z");

  it("starts new Free groups on a Standard trial and says so", async () => {
    const { bot, groups } = setup({ openSignup: true, plan: "free", trial, now: () => start });
    expect((await bot.handle(msg(ADMIN, { text: "Hi" }), ctx))?.text).toContain("up to 10 people, and new groups try every Standard feature free for 7 days, no card needed");
    const created = await bot.handle(msg(ADMIN, { text: "Lekki Crew" }), ctx);
    expect(created?.text).toContain("Free Standard trial");
    expect(created?.text).toContain("next 7 days (or 3 flyers, whichever comes first)");
    expect(created?.text).toContain("No card needed");
    expect(groups[0]).toMatchObject({ plan: "standard", trialFlyersLeft: 3 });
    expect(groups[0]!.planUntil?.toISOString()).toBe("2026-10-23T10:00:00.000Z");
    expect((await bot.handle(msg(ADMIN, { text: "plan" }), ctx))?.text).toContain("free *Standard* trial until 23 October 2026, with 3 flyers left");
    expect((await bot.handle(msg(ADMIN, { text: "colour gold" }), ctx))?.text).toContain("Colour changed");
  });

  it("ends after its flyers are used up, warning near the end", async () => {
    const { bot, groups, render } = await withGroup({ plan: "free", trial, now: () => start });
    expect((await bot.handle(photo(OWNER, "Homecoming"), ctx))?.text).toContain("2 flyers left in your free *Standard* trial");
    await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
    expect((await bot.handle(msg(OWNER, { text: "flyer Ada" }), ctx))?.text).toContain("1 flyer left");
    // Previews and design samples don't count.
    expect(groups[0]!.trialFlyersLeft).toBe(1);
    const last = await bot.handle(photo(OWNER, "Reunion"), ctx);
    expect(last?.images).toHaveLength(1);
    expect(last?.text).toContain("last flyer of your free *Standard* trial");
    expect(last?.text).toContain("upgrade standard");
    expect((await bot.handle(photo(OWNER, "Picnic"), ctx))?.text).toContain("event flyers isn't included");
    expect(render.event).toHaveBeenCalledTimes(2);
    expect((await bot.handle(msg(OWNER, { text: "plan" }), ctx))?.text).toContain("your free Standard trial has ended");
  });

  it("ends after its days, and paying moves the group off the trial from today", async () => {
    let now = start;
    const { bot, groups } = await withGroup({ plan: "free", trial, now: () => now });
    now = new Date("2026-10-31T10:00:00Z");
    expect((await bot.handle(msg(OWNER, { text: "colour gold" }), ctx))?.text).toContain("isn't included on the *Free* plan");

    now = new Date("2026-10-20T10:00:00Z");
    await bot.handle(msg(OWNER, { text: "set plan standard 1 month for Unilag" }), ctx);
    expect(groups[0]).toMatchObject({ plan: "standard", trialFlyersLeft: null });
    expect(groups[0]!.planUntil?.toISOString()).toBe("2026-11-20T10:00:00.000Z");
  });

  it("counts birthday morning flyers, once per flyer", async () => {
    const { bot, groups } = await withGroup({ plan: "free", trial, now: () => start });
    await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
    await bot.handle(photo(OWNER, "add Bola Ade, 14 March"), ctx);
    const sent: BirthdayDelivery[] = [];
    await bot.sendDueBirthdays(new Date("2027-03-14T07:00:00Z"), collect(sent));
    expect(sent).toHaveLength(2);
    expect(groups[0]!.trialFlyersLeft).toBe(1);
  });

  it("counts a trial group as the person's one free group", async () => {
    const { bot } = setup({ openSignup: true, plan: "free", trial, now: () => start });
    await bot.handle(msg(ADMIN, { text: "new group Lekki Crew" }), ctx);
    expect((await bot.handle(msg(ADMIN, { text: "new group Second" }), ctx))?.text).toContain("*Lekki Crew* is on its free trial");
  });

  it("leaves groups alone when there's no trial", async () => {
    const { groups } = await withGroup({ plan: "free" });
    expect(groups[0]).toMatchObject({ plan: "free", trialFlyersLeft: null });
  });
});

describe("flyer bot: members and flyers", () => {
  it("saves a member from a captioned photo and shows a preview flyer", async () => {
    const { bot, members } = await withGroup();
    const reply = await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
    expect(members).toMatchObject([{ name: "Ada Okafor", birthday: { month: 3, day: 14 } }]);
    expect(reply?.text).toContain("Saved Ada Okafor 🎂 14 March");
    expect(text(reply?.images?.[0]?.data)).toBe("birthday:Ada Okafor:nologo");
  });

  it("cuts the person out once for designs that use cutouts, then reuses it", async () => {
    const { bot, render, cutouts } = await withGroup();
    await bot.handle(msg(OWNER, { text: "design midnight" }), ctx);
    await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
    await bot.handle(msg(OWNER, { text: "flyer Ada" }), ctx);
    expect(render.cutout).toHaveBeenCalledTimes(1);
    expect(text(cutouts.get("g1/Ada Okafor") ?? undefined)).toBe("cut");
    const last = render.birthday.mock.calls.at(-1)![0] as { cutout?: Uint8Array };
    expect(text(last.cutout)).toBe("cut");
  });

  it("doesn't cut out photos for designs that don't use cutouts", async () => {
    const { bot, render } = await withGroup();
    await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
    expect(render.cutout).not.toHaveBeenCalled();
    const last = render.birthday.mock.calls.at(-1)![0] as { cutout?: Uint8Array };
    expect(last.cutout).toBeUndefined();
  });

  it("remembers when no person was found and uses the plain photo", async () => {
    const { bot, render } = await withGroup();
    render.cutout.mockResolvedValue(null);
    await bot.handle(msg(OWNER, { text: "design midnight" }), ctx);
    await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
    const reply = await bot.handle(msg(OWNER, { text: "flyer Ada" }), ctx);
    expect(render.cutout).toHaveBeenCalledTimes(1);
    expect(text(reply?.images?.[0]?.data)).toBe("birthday:Ada Okafor:nologo");
    const last = render.birthday.mock.calls.at(-1)![0] as { cutout?: Uint8Array };
    expect(last.cutout).toBeUndefined();
  });

  it("still makes the flyer when cutting out fails", async () => {
    const { bot, render } = await withGroup();
    render.cutout.mockRejectedValue(new Error("model broke"));
    await bot.handle(msg(OWNER, { text: "design midnight" }), ctx);
    const reply = await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
    expect(text(reply?.images?.[0]?.data)).toBe("birthday:Ada Okafor:nologo");
  });

  it("asks again when the birthday can't be read", async () => {
    const { bot, members } = await withGroup();
    const reply = await bot.handle(photo(OWNER, "add Ada Okafor, someday"), ctx);
    expect(reply?.text).toContain("couldn't read the birthday");
    expect(members).toHaveLength(0);
  });

  it("brands any other photo as an event flyer, with the logo once there is one", async () => {
    const { bot } = await withGroup();
    const first = await bot.handle(photo(OWNER, "Homecoming 12 Dec"), ctx);
    expect(text(first?.images?.[0]?.data)).toBe("event:Homecoming 12 Dec:nologo");
    expect(first?.text).toContain("send your group logo");

    expect((await bot.handle(photo(OWNER, "Logo"), ctx))?.text).toContain("Logo saved");
    const second = await bot.handle(photo(OWNER, "Homecoming 12 Dec"), ctx);
    expect(text(second?.images?.[0]?.data)).toBe("event:Homecoming 12 Dec:logo");
    expect(second?.text).toBe("");
  });

  it("refuses files that aren't pictures", async () => {
    const { bot } = await withGroup();
    const pdf = { ...ctx, downloadMedia: async () => ({ data: new Blob(["%PDF"]), mimeType: "application/pdf" }) };
    const reply = await bot.handle(msg(OWNER, { type: "document", mediaId: "d1", caption: "logo" }), pdf);
    expect(reply?.text).toContain("Please send a photo (JPG or PNG), or a member list as a CSV file");
  });

  it("lists members, removes one and makes a flyer on request", async () => {
    const { bot } = await withGroup();
    await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
    await bot.handle(photo(OWNER, "add Tunde Bakare 1/1"), ctx);
    expect((await bot.handle(msg(OWNER, { text: "members" }), ctx))?.text).toMatch(/Ada Okafor: 14 March|Tunde Bakare: 1 January/);

    const flyer = await bot.handle(msg(OWNER, { text: "flyer ada" }), ctx);
    expect(flyer?.images?.[0]?.caption).toBe("Happy birthday Ada Okafor from Unilag Class of 2010");

    expect((await bot.handle(msg(OWNER, { text: "remove tunde" }), ctx))?.text).toBe(
      "Removed Tunde Bakare from Unilag Class of 2010.",
    );
    expect((await bot.handle(msg(OWNER, { text: "flyer tunde" }), ctx))?.text).toContain("couldn't find");
  });
});

function collect(sent: BirthdayDelivery[], reachable = (_to: string) => true): BirthdayDeliverer {
  return { canReach: async (to) => reachable(to), send: async (d) => void sent.push(d) };
}

describe("flyer bot: birthday mornings", () => {
  // 14 March 2027, 08:00 in Lagos.
  const morning = new Date("2027-03-14T07:00:00Z");

  it("waits until the send hour", async () => {
    const { bot } = await withGroup();
    await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
    const sent: BirthdayDelivery[] = [];
    await bot.sendDueBirthdays(new Date("2027-03-14T05:00:00Z"), collect(sent));
    expect(sent).toHaveLength(0);
  });

  it("sends each admin the flyer and message once", async () => {
    const { bot } = await withGroup();
    await bot.handle(msg(OWNER, { text: "add admin 2348000000002" }), ctx);
    await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
    await bot.handle(photo(OWNER, "add Tunde Bakare, 15 March"), ctx);

    const sent: BirthdayDelivery[] = [];
    await bot.sendDueBirthdays(morning, collect(sent));
    await bot.sendDueBirthdays(morning, collect(sent));

    expect(sent.map((d) => d.to)).toEqual([OWNER, ADMIN]);
    expect(sent[0]).toMatchObject({
      memberName: "Ada Okafor",
      groupName: "Unilag Class of 2010",
      wish: "Happy birthday Ada Okafor from Unilag Class of 2010",
    });
    expect(text(sent[0]!.flyer)).toBe("birthday:Ada Okafor:nologo");
  });

  it("tries again next time if no admin could be reached", async () => {
    const { bot } = await withGroup();
    await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
    await bot.sendDueBirthdays(morning, {
      canReach: async () => true,
      send: async () => {
        throw new Error("WhatsApp down");
      },
    });
    const sent: BirthdayDelivery[] = [];
    await bot.sendDueBirthdays(morning, collect(sent));
    expect(sent).toHaveLength(1);
  });

  it("skips admins it can't reach yet, and sends once one can be reached", async () => {
    const { bot, claims } = await withGroup();
    await bot.handle(photo(OWNER, "add Ada Okafor, 14 March"), ctx);
    const sent: BirthdayDelivery[] = [];
    await bot.sendDueBirthdays(morning, collect(sent, () => false));
    expect(sent).toHaveLength(0);
    expect(claims.size).toBe(0);
    await bot.sendDueBirthdays(morning, collect(sent));
    expect(sent).toHaveLength(1);
  });

  it("celebrates 29 February birthdays on 28 February in other years", async () => {
    const { bot } = await withGroup();
    await bot.handle(photo(OWNER, "add Leap Baby, 29 Feb"), ctx);
    const sent: BirthdayDelivery[] = [];
    await bot.sendDueBirthdays(new Date("2027-02-28T09:00:00Z"), collect(sent));
    expect(sent.map((d) => d.memberName)).toEqual(["Leap Baby"]);
  });
});

describe("helpers", () => {
  it.each([
    ["add Ada Okafor, 14 March", "Ada Okafor", { month: 3, day: 14 }],
    ["add Ada Okafor 14 March", "Ada Okafor", { month: 3, day: 14 }],
    ["Add  June  Okeke - 3/9", "June Okeke", { month: 9, day: 3 }],
    ["birthday: Bola, March 2nd", "Bola", { month: 3, day: 2 }],
  ])("reads %s", (caption, name, birthday) => {
    expect(parseAddCaption(caption)).toEqual({ name, birthday });
  });

  it("normalises Nigerian numbers", () => {
    expect(normalizeNumber("0801 234 5678")).toBe("2348012345678");
    expect(normalizeNumber("+234 801 234 5678")).toBe("2348012345678");
    expect(normalizeNumber("12345")).toBeNull();
  });

  it("writes the forwarding tip", () => {
    expect(forwardTip(["Ada"], "Class of 2010")).toBe(
      "🎂 Today is Ada's birthday! Forward the flyer to Class of 2010, then type @ and pick the name to tag them.",
    );
  });
});
