import { describe, expect, it } from "vitest";
import type { Product, ProductContext } from "../../core/product.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import type { Broadcast, BroadcastStore, OptInStatus, PendingRecipient, RecipientResult } from "./broadcast-store.js";
import { finishedText, sendDueBroadcasts, withBroadcasts, type BroadcastOptions } from "./broadcasts.js";

const OWNER = "2348000000001";
const BIZ = "biz-1";

/** An in-memory version of the database tables, behaving like migration 0029. */
function memoryStore() {
  const optins = new Map<string, OptInStatus>(); // `${business}|${contact}`
  const optinOrder: string[] = [];
  const broadcasts = new Map<number, Broadcast>();
  const recipients: Array<PendingRecipient & { status: string; waMessageId?: string }> = [];
  let nextId = 1;
  let used = 0;

  const store: BroadcastStore = {
    async optInStatus(b, c) {
      return optins.get(`${b}|${c}`) ?? null;
    },
    async setOptIn(b, c, status) {
      const key = `${b}|${c}`;
      optins.set(key, status);
      if (status === "in") optinOrder.push(key);
    },
    async countOptedIn(b) {
      return [...optins].filter(([k, s]) => k.startsWith(`${b}|`) && s === "in").length;
    },
    async monthlyLimit() {
      return 100;
    },
    async usedThisMonth() {
      return used;
    },
    async createDraft(d) {
      const b: Broadcast = { ...d, id: nextId++, status: "draft", recipientCount: 0 };
      broadcasts.set(b.id, b);
      return b;
    },
    async get(id) {
      const b = broadcasts.get(id);
      return b ? { ...b } : null;
    },
    async queue(id, limit) {
      const b = broadcasts.get(id);
      if (!b || b.status !== "draft") return { outcome: "not_draft", recipients: 0 };
      const room = limit - used;
      if (room <= 0) return { outcome: "limit_reached", recipients: 0 };
      const people = [...new Set(optinOrder)]
        .filter((k) => k.startsWith(`${b.businessId}|`) && optins.get(k) === "in")
        .slice(0, room)
        .map((k) => k.split("|")[1]!);
      for (const contactId of people) {
        recipients.push({ broadcastId: id, contactId, waId: `2348${contactId.slice(1).padStart(2, "0")}`, status: "pending" });
      }
      used += people.length;
      b.status = people.length ? "queued" : "done";
      b.recipientCount = people.length;
      return { outcome: "queued", recipients: people.length };
    },
    async cancel(id) {
      const b = broadcasts.get(id);
      if (!b || (b.status !== "draft" && b.status !== "queued")) return false;
      b.status = "cancelled";
      for (const r of recipients) if (r.broadcastId === id && r.status === "pending") r.status = "skipped";
      return true;
    },
    async duePending(limit) {
      return recipients
        .filter((r) => r.status === "pending" && broadcasts.get(r.broadcastId)?.status === "queued")
        .slice(0, limit)
        .map(({ broadcastId, contactId, waId }) => ({ broadcastId, contactId, waId }));
    },
    async claim(r) {
      const row = recipients.find((x) => x.broadcastId === r.broadcastId && x.contactId === r.contactId);
      if (!row || row.status !== "pending") return false;
      row.status = "sending";
      return true;
    },
    async finishRecipient(r, result: RecipientResult) {
      const row = recipients.find((x) => x.broadcastId === r.broadcastId && x.contactId === r.contactId)!;
      row.status = result.status;
      if (result.status === "sent") row.waMessageId = result.waMessageId;
    },
    async finishIfComplete(id) {
      const mine = recipients.filter((r) => r.broadcastId === id);
      if (mine.some((r) => r.status === "pending" || r.status === "sending")) return null;
      const b = broadcasts.get(id)!;
      if (b.status !== "queued") return null;
      b.status = "done";
      const count = (s: string) => mine.filter((r) => r.status === s).length;
      return { sent: count("sent"), failed: count("failed"), skipped: count("skipped") };
    },
  };
  return { store, optins, recipients, broadcasts, setUsed: (n: number) => (used = n) };
}

const inner: Product = { name: "quote", handle: async (msg) => ({ text: `quote bot: ${msg.text ?? msg.caption ?? ""}` }) };

function msg(text: string, from = "2348012345678", over: Partial<IncomingMessage> = {}): IncomingMessage {
  return { waMessageId: `w-${Math.random()}`, from, businessNumberId: "PNID", type: "text", text, timestamp: 0, raw: {}, ...over };
}

function ctx(contactId = "c1"): ProductContext {
  return { contactId, history: [], downloadMedia: async () => ({ data: new Blob(), mimeType: "" }), sendLater: async () => {}, canMessageFreely: async () => true };
}

function bot(store: BroadcastStore, over: Partial<BroadcastOptions> = {}) {
  return withBroadcasts(inner, {
    businessId: BIZ,
    businessName: "Mama Cakes",
    ownerWaId: OWNER,
    store,
    monthlyLimit: async () => 100,
    pictures: false,
    log: { error: () => {} },
    ...over,
  });
}

describe("broadcast opt-in and opt-out", () => {
  it("opts a customer in with JOIN and out with STOP", async () => {
    const { store, optins } = memoryStore();
    const b = bot(store);
    expect((await b.handle(msg("JOIN"), ctx()))!.text).toContain("You're in");
    expect(optins.get(`${BIZ}|c1`)).toBe("in");
    expect((await b.handle(msg("join"), ctx()))!.text).toContain("already on the list");
    expect((await b.handle(msg("Stop"), ctx()))!.text).toContain("won't send you any more offers");
    expect(optins.get(`${BIZ}|c1`)).toBe("out");
  });

  it("leaves a plain STOP to the quote bot when the customer never joined", async () => {
    const { store, optins } = memoryStore();
    expect((await bot(store).handle(msg("stop"), ctx()))!.text).toBe("quote bot: stop");
    expect(optins.size).toBe(0);
  });

  it("always honours UNSUBSCRIBE and the template's Stop promotions button", async () => {
    const { store, optins } = memoryStore();
    const b = bot(store);
    await b.handle(msg("unsubscribe"), ctx("c1"));
    expect(optins.get(`${BIZ}|c1`)).toBe("out");
    await b.handle(msg("JOIN"), ctx("c2"));
    await b.handle(msg("Stop promotions", "234802", { type: "button" }), ctx("c2"));
    expect(optins.get(`${BIZ}|c2`)).toBe("out");
  });

  it("passes every other message to the quote bot", async () => {
    const { store } = memoryStore();
    expect((await bot(store).handle(msg("100 A5 flyers"), ctx()))!.text).toBe("quote bot: 100 A5 flyers");
  });

  it("keeps the quote bot answering if the broadcast tables are missing", async () => {
    const { store } = memoryStore();
    const broken = { ...store, optInStatus: async () => Promise.reject(new Error("relation does not exist")) };
    expect((await bot(broken).handle(msg("JOIN"), ctx()))!.text).toBe("quote bot: JOIN");
  });
});

describe("owner broadcasts", () => {
  async function withSubscribers(n: number) {
    const mem = memoryStore();
    const b = bot(mem.store, { costPerMessageKobo: 7000 });
    for (let i = 1; i <= n; i++) await b.handle(msg("JOIN", `23480${i}`), ctx(`c${i}`));
    return { ...mem, b };
  }

  it("previews before sending, with the reach and Meta's cost", async () => {
    const { b, recipients } = await withSubscribers(3);
    const preview = (await b.handle(msg("broadcast 10% off all flyers this week!", OWNER), ctx("owner")))!.text;
    expect(preview).toContain('"10% off all flyers this week!"');
    expect(preview).toContain("It will go to 3 customers who opted in.");
    expect(preview).toContain("₦70 per message, so roughly ₦210");
    expect(preview).toContain("send broadcast 1");
    expect(recipients).toHaveLength(0);
  });

  it("queues on 'send broadcast N' only once", async () => {
    const { b, recipients } = await withSubscribers(2);
    await b.handle(msg("broadcast Sale!", OWNER), ctx("owner"));
    expect((await b.handle(msg("send broadcast 1", OWNER), ctx("owner")))!.text).toContain("on its way to 2 customers");
    expect((await b.handle(msg("send broadcast 1", OWNER), ctx("owner")))!.text).toContain("already on its way");
    expect(recipients).toHaveLength(2);
  });

  it("stops at the month's limit", async () => {
    const mem = await withSubscribers(3);
    mem.setUsed(99);
    const preview = (await mem.b.handle(msg("broadcast Sale!", OWNER), ctx("owner")))!.text;
    expect(preview).toContain("only 1 message are left this month");
    await mem.b.handle(msg("send broadcast 1", OWNER), ctx("owner"));
    expect(mem.recipients).toHaveLength(1);
    mem.setUsed(100);
    expect((await mem.b.handle(msg("broadcast Again", OWNER), ctx("owner")))!.text).toContain("used all 100");
  });

  it("says it's a paid add-on when the business doesn't have it", async () => {
    const { store } = memoryStore();
    const b = bot(store, { monthlyLimit: async () => null });
    expect((await b.handle(msg("broadcast Sale!", OWNER), ctx("owner")))!.text).toContain("paid add-on");
  });

  it("won't take a picture when no picture template is set up", async () => {
    const { b } = await withSubscribers(1);
    const photo = msg("", OWNER, { type: "image", text: undefined, caption: "broadcast New designs!", mediaId: "m1" });
    expect((await b.handle(photo, ctx("owner")))!.text).toContain("aren't set up yet");
  });

  it("can't touch another business's broadcast", async () => {
    const { store } = await withSubscribers(1);
    await bot(store).handle(msg("JOIN"), ctx("c1"));
    await bot(store).handle(msg("broadcast Sale!", OWNER), ctx("owner"));
    const other = bot(store, { businessId: "biz-2" });
    expect((await other.handle(msg("send broadcast 1", OWNER), ctx("owner")))!.text).toContain("can't find broadcast 1");
  });

  it("leaves the owner's other messages to the quote bot", async () => {
    const { store } = memoryStore();
    expect((await bot(store).handle(msg("paid KP-1001", OWNER), ctx("owner")))!.text).toBe("quote bot: paid KP-1001");
  });
});

describe("sending broadcasts", () => {
  async function queued(n: number) {
    const mem = memoryStore();
    const b = bot(mem.store);
    for (let i = 1; i <= n; i++) await b.handle(msg("JOIN", `23480${i}`), ctx(`c${i}`));
    await b.handle(msg("broadcast Sale!", OWNER), ctx("owner"));
    await b.handle(msg("send broadcast 1", OWNER), ctx("owner"));
    return { ...mem, b };
  }

  it("sends each person once, a few per run, then tells the owner", async () => {
    const { store, b } = await queued(3);
    const sent: string[] = [];
    const told: string[] = [];
    const run = () =>
      sendDueBroadcasts({
        store,
        perRun: 2,
        send: async (to) => (sent.push(to), `wamid.${to}`),
        notifyOwner: async (bc, tally) => void told.push(finishedText(bc, tally)),
        log: { error: () => {}, info: () => {} },
      });
    // Someone opts out after the broadcast was confirmed: they're skipped.
    await b.handle(msg("STOP", "234803"), ctx("c3"));
    await run();
    expect(sent).toHaveLength(2);
    expect(told).toHaveLength(0);
    await run();
    await run();
    expect(sent.sort()).toEqual(["234801", "234802"]);
    expect(told).toEqual(["✅ Broadcast 1 is done: sent to 2 customers. 1 opted out or were stopped before it reached them."]);
  });

  it("records a failed send without retrying it", async () => {
    const { store, recipients } = await queued(1);
    let tries = 0;
    const opts = {
      store,
      perRun: 5,
      send: async () => {
        tries++;
        throw new Error("131049 marketing limit");
      },
      notifyOwner: async () => {},
      log: { error: () => {}, info: () => {} },
    };
    await sendDueBroadcasts(opts);
    await sendDueBroadcasts(opts);
    expect(tries).toBe(1);
    expect(recipients[0]!.status).toBe("failed");
  });

  it("sends nothing more once the owner cancels", async () => {
    const { store, b } = await queued(2);
    expect((await b.handle(msg("cancel broadcast 1", OWNER), ctx("owner")))!.text).toContain("Stopped");
    const sent: string[] = [];
    await sendDueBroadcasts({
      store,
      perRun: 5,
      send: async (to) => (sent.push(to), "x"),
      notifyOwner: async () => {},
    });
    expect(sent).toHaveLength(0);
  });
});
