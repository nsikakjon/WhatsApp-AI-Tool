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
import type { FlyerStore, Group, Member } from "./store.js";

const silent = { info: () => {}, error: () => {} };
const OWNER = "2348000000001";
const ADMIN = "2348000000002";

function memoryStore() {
  const groups: Group[] = [];
  const admins: Array<{ groupId: string; waId: string; usedAt: number }> = [];
  const members: Member[] = [];
  const pictures = new Map<string, Uint8Array>();
  const claims = new Set<string>();
  let clock = 0;

  const store: FlyerStore = {
    async groupsForAdmin(waId) {
      return admins
        .filter((a) => a.waId === waId)
        .sort((a, b) => b.usedAt - a.usedAt)
        .map((a) => groups.find((g) => g.id === a.groupId)!);
    },
    async createGroup(name, adminWaId) {
      const group = { id: `g${groups.length + 1}`, name, logoPath: null };
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
    async saveMember(groupId, name, birthday, photo) {
      const path = `${groupId}/${name}`;
      pictures.set(path, photo.data);
      const existing = members.find((m) => m.groupId === groupId && m.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        Object.assign(existing, { birthday, photoPath: path });
        return existing;
      }
      const member = { id: `m${members.length + 1}`, groupId, name, birthday, photoPath: path };
      members.push(member);
      return member;
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
  };
  return { store, groups, members, claims };
}

function setup() {
  const mem = memoryStore();
  const render = {
    birthday: vi.fn(async (input: { name: string; logo?: Uint8Array }) =>
      Buffer.from(`birthday:${input.name}:${input.logo ? "logo" : "nologo"}`),
    ),
    event: vi.fn(async (input: { caption: string; logo?: Uint8Array }) =>
      Buffer.from(`event:${input.caption}:${input.logo ? "logo" : "nologo"}`),
    ),
  };
  const bot = createFlyerBot({
    store: mem.store,
    wishes: { write: async ({ name, groupName }) => `Happy birthday ${name} from ${groupName}` },
    owners: [OWNER],
    sendHour: 7,
    render: render as never,
    log: silent,
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
};
const text = (b: Uint8Array | undefined) => Buffer.from(b ?? []).toString();

async function withGroup() {
  const s = setup();
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
    expect((await bot.handle(msg(OWNER, { text: "groups" }), ctx))?.text).toContain("Lekki Crew (current)");
    await bot.handle(msg(OWNER, { text: "switch unilag" }), ctx);
    expect((await bot.handle(msg(OWNER, { text: "groups" }), ctx))?.text).toContain("Unilag Class of 2010 (current)");
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
    expect(reply?.text).toContain("Please send a photo");
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
