import { describe, expect, it } from "vitest";
import type { Product, ProductContext } from "../../core/product.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { AI_PER_PERSON_PER_DAY, SIGNUPS_PER_DAY, orderPrefix, withChatSignup, type ChatSignupOptions, type Signup, type SignupStore } from "./chat-signup.js";
import type { PriceListDraft, PriceListDrafter } from "./drafter.js";
import { createNumberCollector } from "./numbers.js";
import { memoryQueue } from "./numbers-testing.js";
import type { PriceListItem } from "./pricelist.js";

const NUMBER = "num-quotes";
const OWNER = "2348011111111";

function memoryStore() {
  const rows = new Map<string, Signup & { signedUpAt?: Date }>();
  const created: Array<{ name: string; orderPrefix: string; ownerWaId: string; referralCode: string | null }> = [];
  let signedUpToday = 0;
  const store: SignupStore = {
    async get(waId) {
      const row = rows.get(waId);
      return row ? { ...row } : null;
    },
    async save(waId, change) {
      const base: Signup = rows.get(waId) ?? {
        waId,
        step: "name",
        businessName: null,
        description: null,
        referralCode: null,
        draftCsv: null,
        businessId: null,
        trying: false,
        aiDay: null,
        aiUsed: 0,
      };
      rows.set(waId, { ...base, ...change });
    },
    async remove(waId) {
      rows.delete(waId);
    },
    async signedUpSince() {
      return signedUpToday + [...rows.values()].filter((r) => r.signedUpAt).length;
    },
    async codeExists(code) {
      return code === "KAHNP4821";
    },
    async createBusiness(b) {
      created.push(b);
      return `biz-${created.length}`;
    },
  };
  return { store, rows, created, fillToday: (n: number) => (signedUpToday = n) };
}

function memorySetup() {
  const lists = new Map<string, PriceListItem[]>();
  return {
    lists,
    setup: {
      async priceList(id: string) {
        return lists.get(id) ?? [];
      },
      async replacePriceList(id: string, items: PriceListItem[]) {
        lists.set(id, items);
      },
    },
  };
}

function drafter(draft: PriceListDraft) {
  const calls: Array<{ text: string; images: number }> = [];
  const d: PriceListDrafter = {
    async draft(input) {
      calls.push({ text: input.text, images: input.images.length });
      return draft;
    },
  };
  return { d, calls };
}

const CUPCAKES: PriceListDraft = {
  rows: [
    { product: "Cupcakes", option: "Standard", minQuantity: null, fromQuantity: null, price: "600" },
    { product: "Cupcakes", option: "box of 6", minQuantity: 2, fromQuantity: null, price: "3500" },
    { product: "Birthday cakes", option: "Standard", minQuantity: null, fromQuantity: null, price: null },
  ],
  notes: null,
};

const demo: Product = { name: "quote", handle: async () => ({ text: "Demo shop here." }) };

let n = 0;
function msg(text: string, over: Partial<IncomingMessage> = {}): IncomingMessage {
  n++;
  return { waMessageId: `w${n}`, from: OWNER, businessNumberId: NUMBER, type: "text", text, timestamp: 0, raw: {}, ...over };
}

function ctx(history = 1, media?: { data: Blob; mimeType: string }): ProductContext {
  return {
    contactId: "c1",
    history: Array.from({ length: history }, () => ({ direction: "inbound" as const, text: "hi" })),
    downloadMedia: async () => media ?? { data: new Blob([]), mimeType: "text/plain" },
    sendLater: async () => {},
    canMessageFreely: async () => true,
  };
}

function setUp(draft = CUPCAKES, extra: Partial<ChatSignupOptions> = {}) {
  const mem = memoryStore();
  const setup = memorySetup();
  const ai = drafter(draft);
  const bot = withChatSignup(demo, {
    numberId: NUMBER,
    store: mem.store,
    setup: setup.setup,
    drafter: ai.d,
    alertWaId: "2348099999999",
    now: () => new Date("2026-10-21T12:00:00Z"),
    log: { error: () => {} },
    ...extra,
  });
  const say = async (text: string, over: Partial<IncomingMessage> = {}, c = ctx()) => (await bot.handle(msg(text, over), c))!;
  return { bot, say, mem, setup, ai };
}

async function signUpToPrices(say: (t: string) => Promise<{ text: string }>) {
  await say("I want to sign up");
  await say("Mama Cakes");
  await say("cakes and pastries");
  await say("no");
}

describe("chat sign-up on the quotes number", () => {
  it("leaves other numbers alone", async () => {
    const { bot } = setUp();
    const reply = await bot.handle(msg("sign up", { businessNumberId: "other" }), ctx());
    expect(reply?.text).toBe("Demo shop here.");
  });

  it("lets the demo shop answer and invites first-time visitors to sign up", async () => {
    const { bot } = setUp();
    expect((await bot.handle(msg("How much for 20 T-shirts?"), ctx(0)))?.text).toMatch(/Demo shop here\.\n\n.*sign up/);
    expect((await bot.handle(msg("And mugs?"), ctx(3)))?.text).toBe("Demo shop here.");
  });

  it("meets an ad's \"Can I get more info on this?\" with yarnOga, not the demo shop", async () => {
    const { say } = setUp();
    const reply = await say("Hello! Can I get more info on this?");
    expect(reply.buttons?.body).toMatch(/This is yarnOga\..*What do you sell\?$/s);
    expect(reply.buttons?.buttons.map((b) => b.id)).toEqual(["sign up", "see it as a customer", "set it up for me"]);
    expect((await say("Do you have more details on the 20 mugs?")).text).toBe("Demo shop here.");
  });

  it("hands someone who asks us to set it up to the yarnOga team, once a day", async () => {
    const { say, mem } = setUp();
    await say("Hello! Can I get more info on this?");
    await say("cakes");
    const reply = await say("set it up for me", { contactName: "Ada Obi" });
    expect(reply.text).toMatch(/^No problem\. Someone from the yarnOga team will message you here today/);
    expect(reply.notify).toEqual([{ to: "2348099999999", text: expect.stringMatching(/^Set-up request on the quotes line: Ada Obi, \+\d+, sells cakes\./) }]);
    expect((await say("set it up for me")).notify).toBeUndefined();
    expect(mem.rows.size).toBe(0);
  });

  describe("an owner asking how to connect their WhatsApp", () => {
    const unsure: Product = { name: "quote", handle: async () => ({ text: "Which item do you want?", stage: "unclear" }) };
    const owner = async (extra: Partial<ChatSignupOptions> = {}) => {
      const t = setUp(CUPCAKES, { connectLink: (id) => `https://yarnoga.com/connect/${id}`, ...extra });
      await t.mem.store.save(OWNER, { step: "done", businessId: "biz-9", businessName: "NaNa's Home Essentials" });
      return t;
    };

    it("answers in code: keep the WhatsApp Business app, open the link, log in with Facebook", async () => {
      const { say } = await owner();
      const reply = await say("Wait how do i move this to my WhatsApp business account?");
      expect(reply.text).toMatch(/^You don't need to move your number or your chats\. Keep using your WhatsApp Business app/);
      expect(reply.text).toContain("https://yarnoga.com/connect/biz-9");
      expect(reply.text).toContain("Log in with the Facebook account");
      expect(reply.text).not.toMatch(/install the free WhatsApp Business app/i);
      expect(reply.stage).toBeUndefined();
    });

    it("gets the yarnOga team, with a button to the chat, when they ask again", async () => {
      const { say } = await owner({ chatLink: async (contactId) => `https://app.yarnoga.com/home/inbox/${contactId}` });
      await say("I have 2 WhatsApp installed already. So i need to know how to connect it with this one");
      const reply = await say("I'm not moving any chat. I only need to connect all of this here to the business account that's it", { contactName: "NaNa" });
      expect(reply.text).toMatch(/^Let me get someone from the yarnOga team to help you/);
      expect(reply.stage).toBeUndefined();
      expect(reply.notify).toEqual([
        {
          to: "2348099999999",
          text: expect.stringMatching(/^Help needed on the quotes line: NaNa, \+\d+, NaNa's Home Essentials\. They asked how to connect/),
          link: { label: "Open chat", url: "https://app.yarnoga.com/home/inbox/c1" },
        },
      ]);
      const again = await say("how do I link my number?");
      expect(again.text).toBe("The yarnOga team has your message and will reply here shortly.");
      expect(again.notify).toBeUndefined();
    });

    it("tells a visitor they connect at the end of sign-up and keep their app", async () => {
      const { say } = setUp(CUPCAKES, { connectLink: (id) => `https://yarnoga.com/connect/${id}` });
      const reply = await say("Can I connect my WhatsApp Business number?");
      expect(reply.buttons?.body).toMatch(/^You connect your number at the end of sign-up/);
      expect(reply.buttons?.buttons.map((b) => b.id)).toEqual(["sign up"]);
    });

    it("leaves shop questions to the shop", async () => {
      const { say } = await owner();
      expect((await say("Do you deliver to Lekki?")).text).toBe("Demo shop here.");
      expect((await say("Send the price to my whatsapp")).text).toBe("Demo shop here.");
    });

    it("gets the team after two replies in a row the bot couldn't answer, instead of going quiet", async () => {
      const mem = memoryStore();
      await mem.store.save(OWNER, { step: "done", businessId: "biz-9", businessName: "NaNa's Home Essentials" });
      const bot = withChatSignup(unsure, {
        numberId: NUMBER,
        store: mem.store,
        setup: memorySetup().setup,
        drafter: drafter(CUPCAKES).d,
        alertWaId: "2348099999999",
        now: () => new Date("2026-11-10T09:00:00Z"),
        log: { error: () => {} },
      });
      const first = await bot.handle(msg("Answer me"), ctx());
      expect(first).toEqual({ text: "Which item do you want?", stage: "unclear" });
      const second = await bot.handle(msg("Hey im waiting"), ctx());
      expect(second?.text).toMatch(/^Let me get someone from the yarnOga team/);
      expect(second?.stage).toBeUndefined();
      expect(second?.notify?.[0]?.text).toContain("The bot couldn't answer their last two messages");
    });
  });

  describe("guiding a visitor from hi to sign-up", () => {
    const shop: Product = {
      name: "quote",
      async handle(m) {
        if (m.text === "hi") return { text: "", buttons: { body: "Welcome to the demo shop.", buttons: [{ id: "get a quote", title: "Get a quote" }] } };
        if (m.text === "20 T-shirts") return { text: "Quote DEMO-1: ₦50,000" };
        return { text: "Which item do you want?", stage: "unclear" };
      },
    };
    const guest = () => {
      const mem = memoryStore();
      let day = "2026-11-03";
      const bot = withChatSignup(shop, {
        numberId: NUMBER,
        store: mem.store,
        setup: memorySetup().setup,
        drafter: drafter(CUPCAKES).d,
        now: () => new Date(`${day}T12:00:00Z`),
      });
      const say = async (text: string, history = 3) => (await bot.handle(msg(text, { contactName: "Sulaiman Soja" }), ctx(history)))!;
      return { mem, say, nextDay: () => (day = "2026-11-04") };
    };
    const ids = (r: { buttons?: { buttons: Array<{ id: string }> } }) => r.buttons?.buttons.map((b) => b.id);

    it("meets hi with yarnOga and asks what they sell, not with the demo shop", async () => {
      const { say } = guest();
      const reply = await say("Hi");
      expect(reply.buttons?.body).toMatch(/^Hi Sulaiman! This is yarnOga\. We give your business a WhatsApp assistant.*\n\nWhat do you sell\?$/s);
      expect(ids(reply)).toEqual(["sign up", "see it as a customer"]);
    });

    it("pitches in their words, then signs up without asking what they sell again", async () => {
      const { say, mem } = guest();
      await say("hello");
      const pitch = await say("I sell cakes and small chops.");
      expect(pitch.buttons?.body).toMatch(/^For \*cakes and small chops\*, your assistant answers "how much\?" with your own prices/);
      expect(ids(pitch)).toEqual(["sign up", "see it as a customer"]);

      await say("sign up");
      expect((await say("Mama Cakes")).text).toBe("Thanks, *Mama Cakes* it is.\n\nDo you have a referral code? Send it now, or send *no* to carry on.");
      expect(mem.rows.get(OWNER)).toMatchObject({ step: "referral", businessName: "Mama Cakes", description: "cakes and small chops" });
    });

    it("asks again when the answer can't be a trade, and sends the sign-up message on the second", async () => {
      const { say } = guest();
      await say("hi");
      const again = await say("Hmm");
      expect(again.text).toMatch(/few words what your business sells/);
      const nudge = await say("40000");
      expect(nudge.buttons?.body).toMatch(/^It looks like you may be here for your own business/);
      // Both count towards the two replies a chat gets to messages with no clear request.
      expect([again.stage, nudge.stage]).toEqual(["unclear", "unclear"]);
      expect(ids(nudge)).toEqual(["sign up", "see it as a customer"]);
    });

    it("opens the demo shop for See it as a customer, and passes shop questions straight to it", async () => {
      const { say } = guest();
      await say("hi");
      const demo = await say("see it as a customer");
      expect(demo.buttons?.body).toMatch(/^You're now a customer of the yarnOga Demo Shop\..*\n\nWelcome to the demo shop\.$/s);
      await say("hi");
      expect((await say("Do you have mugs?")).text).toBe("Which item do you want?");
    });

    it("answers who we are instead of the sign-up message", async () => {
      const { say } = guest();
      await say("Okay");
      const who = await say("Please, who are you?");
      expect(who.buttons?.body).toMatch(/^I'm yarnOga, a WhatsApp assistant for businesses/);
      expect(ids(who)).toEqual(["sign up", "see it as a customer"]);
      expect((await say("Moni")).text).toBe("Which item do you want?");
    });

    it("answers a question about us after the intro, then asks again what they sell", async () => {
      const { say } = guest();
      await say("hi");
      expect((await say("Are you a bot?")).buttons?.body).toMatch(/^I'm an AI assistant, not a person\..*\n\nWhat do you sell\?$/s);
      expect((await say("I sell shoes")).buttons?.body).toMatch(/^For \*shoes\*/);
    });

    it("says no to \"Are you interested\", without taking it as what they sell", async () => {
      const { say } = guest();
      await say("hi");
      const reply = await say("Are you interested");
      expect(reply.buttons?.body).toMatch(/^No, thank you\. You're chatting with the yarnOga quote bot/);
      expect(reply.buttons?.body).not.toMatch(/For \*Are you interested\*/);
    });

    it("sends the sign-up message after two messages in a row the shop can't use, once a day", async () => {
      const { say, nextDay } = guest();
      expect((await say("Okay")).text).toBe("Which item do you want?");
      expect((await say("Moni")).buttons?.body).toMatch(/your own business/);
      expect((await say("20000")).text).toBe("Which item do you want?");
      expect((await say("Hmm")).text).toBe("Which item do you want?");
      nextDay();
      expect((await say("lol")).buttons?.body).toMatch(/your own business/);
    });

    it("starts the count again after a message the shop understood", async () => {
      const { say } = guest();
      await say("Okay");
      await say("20 T-shirts");
      expect((await say("Moni")).text).toBe("Which item do you want?");
    });

    it("starts the sign-up when they say okay to the intro, and answers a quick second sign up once", async () => {
      const { say, mem } = guest();
      await say("hi");
      expect((await say("Ok")).text).toMatch(/^Let's set up your WhatsApp quote bot/);
      expect(await say("sign up")).toBeNull();
      expect(mem.rows.get(OWNER)?.step).toBe("name");
    });

    it("opens the demo shop when they ask to see it as a customer part way through signing up", async () => {
      const { say, mem } = guest();
      await say("hi");
      await say("I sell shoes");
      await say("sign up");
      const demo = await say("see it as a customer");
      expect(demo.buttons?.body).toMatch(/^You're now a customer of the yarnOga Demo Shop/);
      expect(mem.rows.has(OWNER)).toBe(false);

      await say("sign up");
      expect((await say("Shoe Palace")).text).toMatch(/^Thanks, \*Shoe Palace\* it is\./);
      expect(mem.rows.get(OWNER)?.description).toBe("shoes");
    });

    it("opens the demo shop for a typed request to see the customer side", async () => {
      const { say } = guest();
      await say("hi");
      expect((await say("I want to see how it works as a customer")).buttons?.body).toMatch(/^You're now a customer/);
    });

    it("shows the intro when a first message can't be used", async () => {
      const { say } = guest();
      expect((await say("Good morning o, I'm not feeling fine", 0)).buttons?.body).toMatch(/This is yarnOga.*What do you sell\?$/s);
    });
  });

  it("walks an owner from sign up to a saved business on the Free plan", async () => {
    const { say, mem, setup, ai } = setUp();
    expect((await say("sign up")).text).toMatch(/what's your business called/i);
    expect((await say("Mama  Cakes")).text).toMatch(/what does \*Mama Cakes\* sell/);
    expect((await say("cakes and pastries")).text).toBe("Do you have a referral code? Send it now, or send *no* to carry on.");
    expect((await say("No")).text).toMatch(/Now your prices/);

    const preview = await say("Cupcakes N600 each, box of 6 for 3,500, minimum 2 boxes. Birthday cakes price on request");
    expect(ai.calls[0]!.text).toContain("Cupcakes N600");
    expect(preview.text).toContain("• Cupcakes: ₦600 each");
    expect(preview.text).toContain("• Cupcakes, box of 6: ₦3,500 each (minimum 2)");
    expect(preview.text).toContain("• Birthday cakes: you price it by hand");
    expect(preview.text).toMatch(/Reply \*YES\*/);
    expect(mem.created).toHaveLength(0);

    const done = await say("YES");
    expect(done.text).toMatch(/Mama Cakes\* is set up on the yarnOga Free plan/);
    expect(done.notify?.[0]).toMatchObject({ to: "2348099999999" });
    expect(mem.created).toEqual([{ name: "Mama Cakes", description: "cakes and pastries", orderPrefix: "MC", ownerWaId: OWNER, referralCode: null }]);
    expect(setup.lists.get("biz-1")).toHaveLength(3);
    expect(mem.rows.get(OWNER)).toMatchObject({ step: "done", businessId: "biz-1", draftCsv: null });
  });

  it("asks for a new SIM's number after sign-up and puts it on the queue", async () => {
    const q = memoryQueue([{ id: "s1", name: "Tolu", waId: "2348022222222" }]);
    const { say } = setUp(CUPCAKES, { numbers: createNumberCollector({ store: q.store }) });
    expect((await say("sign up")).text).toMatch(/fresh SIM that has never been on WhatsApp.*\n\nFirst, what's your business called\?$/s);
    await say("cancel");
    await signUpToPrices(say);
    await say("Cupcakes 600");
    const done = await say("YES");
    expect(done.text).toContain("Get a fresh SIM");
    expect(done.text).not.toContain("will message you shortly");
    expect(q.rows.get("biz-1")?.status).toBe("no_number");

    const got = await say("0803 123 4567");
    expect(got.text).toMatch(/We've got \*0803 123 4567\*/);
    expect(got.notify?.[0]).toMatchObject({ to: "2348022222222" });
    expect(q.rows.get("biz-1")).toMatchObject({ number: "2348031234567", assignedTo: "s1" });
    expect((await say("try")).text).toMatch(/chatting with \*Mama Cakes\*'s bot|isn't available/);
  });

  it("offers connecting with Facebook first, with a new SIM as the other way", async () => {
    const q = memoryQueue();
    const connectLink = (id: string) => `https://app.example.com/signup?b=${id}&t=tok`;
    const { say } = setUp(CUPCAKES, { numbers: createNumberCollector({ store: q.store, connectLink }), connectLink });
    expect((await say("sign up")).text).toContain("connect that number with Facebook and keep using the app");
    await say("cancel");
    await signUpToPrices(say);
    await say("Cupcakes 600");
    const done = await say("YES");
    expect(done.text).toContain("*Connect with Facebook*");
    expect(done.text).toContain("Instagram or Facebook page link");
    expect(done.text).toContain("https://app.example.com/signup?b=biz-1&t=tok");
    expect(done.text).toContain("*Or send us a new SIM's number*");
    expect(done.notify?.[0]?.text).toContain("connect a number with Facebook");
    expect((await say("number")).text).toContain("https://app.example.com/signup?b=biz-1&t=tok");
    expect((await say(OWNER)).text).toMatch(/number you're chatting from.*connect it with Facebook/s);
  });

  describe("asking demo visitors to sign up after the delivery question", () => {
    const placed: string[] = [];
    const shop: Product = {
      name: "quote",
      async handle(m) {
        if (m.text === "pickup") {
          return {
            text: "No problem, you'll collect it.\n\n*Total: ₦50,000*",
            buttons: { body: "Tap *Confirm order* to place it.", buttons: [{ id: "yes", title: "Confirm order" }, { id: "deliver instead", title: "Deliver instead" }] },
            stage: "delivery_chosen",
          };
        }
        if (m.text === "yes") {
          placed.push(m.from);
          return { text: "Order DEMO-1001 confirmed." };
        }
        return { text: "Demo shop here." };
      },
    };
    const gated = (on = true) => {
      placed.length = 0;
      const mem = memoryStore();
      const bot = withChatSignup(shop, { numberId: NUMBER, store: mem.store, setup: memorySetup().setup, drafter: drafter(CUPCAKES).d, signUpToContinue: on });
      return { mem, say: async (text: string) => (await bot.handle(msg(text), ctx()))! };
    };

    it("swaps Confirm order for Sign up free, keeping the total and Deliver instead", async () => {
      const { say } = gated();
      const reply = await say("pickup");
      expect(reply.text).toContain("*Total: ₦50,000*");
      expect(reply.buttons?.body).toMatch(/sign up free first/);
      expect(reply.buttons?.buttons.map((b) => b.id)).toEqual(["sign up", "deliver instead"]);
      expect(reply.stage).toBeUndefined();
    });

    it("holds the order until they've signed up, then YES finishes it", async () => {
      const { say } = gated();
      await say("pickup");
      expect((await say("yes")).buttons?.buttons.map((b) => b.id)).toEqual(["sign up"]);
      expect(placed).toEqual([]);

      await signUpToPrices(say);
      await say("Cupcakes 600");
      expect((await say("YES")).text).toMatch(/send \*yes\* to finish it and see the invoice/);
      expect((await say("yes")).text).toBe("Order DEMO-1001 confirmed.");
      expect(placed).toEqual([OWNER]);
    });

    it("lets the order through when the switch is off", async () => {
      const { say } = gated(false);
      expect((await say("pickup")).buttons?.buttons.map((b) => b.id)).toEqual(["yes", "deliver instead"]);
      expect((await say("yes")).text).toBe("Order DEMO-1001 confirmed.");
    });
  });

  describe("starter price lists", () => {
    const barber = async () => {
      const t = setUp();
      await t.say("sign up");
      await t.say("Barber business");
      return t;
    };

    it("asks again when the answer to what they sell is a filler, and carries on when a referral answer isn't a code", async () => {
      const { say, mem } = await barber();
      expect((await say("Np")).text).toMatch(/what does \*Barber business\* sell or do\?/);
      expect((await say("I cut hair")).text).toBe("Do you have a referral code? Send it now, or send *no* to carry on.");
      const prices = await say("Low cut");
      expect(prices.text).toMatch(/^That doesn't look like a referral code, so let's carry on without one\.\n\nNow your prices\. Here's a starter price list for a barber/);
      expect(prices.text).toContain("• Low cut: ₦1,200 each");
      expect(prices.text).toContain("_low cut 1,500_");
      expect(mem.rows.get(OWNER)).toMatchObject({ step: "prices", referralCode: null, description: "I cut hair" });
    });

    it("saves the starter list on YES", async () => {
      const { say, setup } = await barber();
      await say("haircuts and shaving");
      await say("no");
      expect((await say("YES")).text).toMatch(/Barber business\* is set up/);
      const list = setup.lists.get("biz-1")!;
      expect(list.find((i) => i.product === "Low cut")?.tiers).toEqual([{ minQuantity: 1, unitPriceKobo: 120000 }]);
    });

    it("gives the AI the starter list with the owner's changes, so its prices aren't dropped", async () => {
      const { say, ai } = setUp({
        rows: [
          { product: "Low cut", option: "Standard", minQuantity: null, fromQuantity: null, price: "1500" },
          { product: "Skin cut", option: "Standard", minQuantity: null, fromQuantity: null, price: "1500" },
        ],
        notes: null,
      });
      await say("sign up");
      await say("Fresh Cuts");
      await say("barbing salon");
      await say("no");
      const reply = await say("low cut 1500");
      expect(ai.calls[0]!.text).toMatch(/^A starter price list we suggested:\nProduct,Option.*\nLow cut,Standard,,,1200/s);
      expect(ai.calls[0]!.text).toContain("The owner's changes: low cut 1500");
      expect(reply.text).toContain("• Low cut: ₦1,500 each");
      expect(reply.text).toContain("• Skin cut: ₦1,500 each");
    });

    it("lets a photo replace the starter list", async () => {
      const { bot, say, ai } = await barber();
      await say("haircuts");
      await say("no");
      const photo = { data: new Blob([new Uint8Array([1, 2, 3])]), mimeType: "image/jpeg" };
      await bot.handle(msg("", { type: "image", mediaId: "m1", text: undefined }), ctx(1, photo));
      expect(ai.calls[0]!.text).not.toMatch(/starter|so far/);
    });
  });

  it("ends the sign-up by asking for an email, when emails are on", async () => {
    const asked: Array<{ waId: string; businessId: string }> = [];
    const { say } = setUp(CUPCAKES, {
      askEmail: async (a) => {
        asked.push(a);
        return "Want tips by email? Send your email address, or send *skip*.";
      },
    });
    await signUpToPrices(say);
    await say("Cupcakes N600 each");
    const done = await say("YES");
    expect(done.text.endsWith("Want tips by email? Send your email address, or send *skip*.")).toBe(true);
    expect(asked).toEqual([{ waId: OWNER, businessId: "biz-1" }]);
  });

  it("keeps a referral code for the first upgrade, and asks again when it can't find one", async () => {
    const { say, mem } = setUp();
    await say("sign up");
    await say("Mama Cakes");
    await say("cakes and pastries");
    expect((await say("KAHNP482")).text).toMatch(/can't find the code \*KAHNP482\*/);
    expect((await say("kahnp 4821")).text).toMatch(/^Thanks, I've kept \*KAHNP4821\*.*\n\nNow your prices/s);
    await say("Cupcakes 600 each, box of 6 3500 min 2, birthday cakes on request");
    const done = await say("yes");
    expect(mem.created[0]?.referralCode).toBe("KAHNP4821");
    expect(done.notify?.[0]?.text).toContain("code KAHNP4821");
  });

  it("drops typed prices the owner never wrote", async () => {
    const { say } = setUp({
      rows: [{ product: "Cupcakes", option: "Standard", minQuantity: null, fromQuantity: null, price: "750" }],
      notes: null,
    });
    await signUpToPrices(say);
    const preview = await say("Cupcakes 600 each");
    expect(preview.text).toContain("• Cupcakes: you price it by hand");
    expect(preview.text).toMatch(/left 1 price empty/);
  });

  it("builds corrections on the list so far", async () => {
    const { say, ai } = setUp();
    await signUpToPrices(say);
    await say("Cupcakes 600, box of 6 3500 min 2, birthday cakes on request");
    await say("make the box 3,500 from 2");
    expect(ai.calls[1]!.text).toMatch(/The price list so far:\n.*Cupcakes/s);
    expect(ai.calls[1]!.text).toContain("The owner's changes: make the box 3,500 from 2");
  });

  it("reads a photo of the price list", async () => {
    const { bot, ai } = setUp();
    const say = (t: string) => bot.handle(msg(t), ctx()) as Promise<{ text: string }>;
    await signUpToPrices(say);
    const photo = { data: new Blob([new Uint8Array([1, 2, 3])]), mimeType: "image/jpeg" };
    const reply = await bot.handle(msg("", { type: "image", mediaId: "m1", text: undefined }), ctx(1, photo));
    expect(ai.calls[0]!.images).toBe(1);
    // Prices read from a photo can't be checked word for word, so they stay for the owner to check.
    expect(reply?.text).toContain("₦600 each");
  });

  it("reads a CSV file without the AI", async () => {
    const { bot, ai } = setUp();
    const say = (t: string) => bot.handle(msg(t), ctx()) as Promise<{ text: string }>;
    await signUpToPrices(say);
    const csv = { data: new Blob(["Product,Price\nMugs,2500\n"]), mimeType: "text/csv" };
    const reply = await bot.handle(msg("", { type: "document", mediaId: "m1", text: undefined }), ctx(1, csv));
    expect(ai.calls).toHaveLength(0);
    expect(reply?.text).toContain("• Mugs: ₦2,500 each");
  });

  it("warns a pharmacy about prescription medicines and flags them on the list", async () => {
    const { bot, say } = setUp();
    await say("sign up");
    await say("Grace Pharmacy");
    expect((await say("medicines and toiletries")).text).toMatch(/ban selling prescription medicines on WhatsApp[\s\S]*Do you have a referral code/);
    await say("no");
    const csv = { data: new Blob(["Product,Price\nParacetamol,500\nAmoxil 500mg,2500\n"]), mimeType: "text/csv" };
    const reply = await bot.handle(msg("", { type: "document", mediaId: "m1", text: undefined }), ctx(1, csv));
    expect(reply?.text).toContain("These look like prescription medicines: Amoxil 500mg.");
    expect(reply?.text).not.toMatch(/medicines: .*Paracetamol/);
  });

  it("offers the templates and reads a shared Google Sheet without the AI", async () => {
    const links: string[] = [];
    const { say, ai } = setUp(CUPCAKES, { fetchSheet: async (link) => (links.push(link), "Product,Price\nMugs,2500\n") });
    await say("sign up");
    await say("Mama Hampers");
    await say("gift hampers");
    expect((await say("skip")).text).toMatch(/Templates: https:\/\/docs\.google\.com\/spreadsheets\/d\/.+\/copy or https/);
    const reply = await say("here https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing");
    expect(links).toEqual(["https://docs.google.com/spreadsheets/d/abc123/edit?usp=sharing"]);
    expect(ai.calls).toHaveLength(0);
    expect(reply.text).toContain("• Mugs: ₦2,500 each");
  });

  it("keeps a signed-up list in step with the Google Sheet it came from", async () => {
    const remembered: Array<[string, string | null]> = [];
    const sheets = {
      remember: async (id: string, url: string | null) => void remembered.push([id, url]),
      ownerCommand: async (_id: string, m: IncomingMessage) => (m.text === "refresh" ? { text: "Sheet checked." } : null),
    };
    const { say } = setUp(CUPCAKES, { sheets, fetchSheet: async () => "Product,Price\nMugs,2500\n" });
    await signUpToPrices(say);
    await say("https://docs.google.com/spreadsheets/d/abc123/edit");
    expect((await say("yes")).text).toMatch(/check your Google Sheet every day/);
    expect(remembered).toEqual([["biz-1", "https://docs.google.com/spreadsheets/d/abc123/edit"]]);
    expect((await say("refresh")).text).toBe("Sheet checked.");
  });

  it("explains a Google Sheet that isn't shared", async () => {
    const { say } = setUp(CUPCAKES, {
      fetchSheet: async () => {
        throw new Error('the sheet isn\'t public. In Google Sheets, tap Share and set "Anyone with the link" to Viewer');
      },
    });
    await signUpToPrices(say);
    expect((await say("https://docs.google.com/spreadsheets/d/abc123/edit")).text).toMatch(/couldn't open that Google Sheet: the sheet isn't public/);
  });

  it("asks for CSV instead of an Excel file", async () => {
    const { bot } = setUp();
    const say = (t: string) => bot.handle(msg(t), ctx()) as Promise<{ text: string }>;
    await signUpToPrices(say);
    const xlsx = { data: new Blob(["PK"]), mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
    const reply = await bot.handle(msg("", { type: "document", mediaId: "m1", text: undefined }), ctx(1, xlsx));
    expect(reply?.text).toMatch(/save the spreadsheet as CSV/);
  });

  it("asks for a photo or typed prices when a video comes, and passes on the AI's question when it finds no item", async () => {
    const { say } = setUp({ rows: [], notes: "What is the item that costs ₦25,000 called?" });
    await signUpToPrices(say);
    expect((await say("", { type: "video", mediaId: "m1" })).text).toMatch(/^I can't read that here\. Please send a \*photo\*/);
    expect((await say("This one is 25k")).text).toBe("What is the item that costs ₦25,000 called?");
  });

  it("stops on cancel", async () => {
    const { say, mem } = setUp();
    await say("sign up");
    expect((await say("cancel")).text).toMatch(/stopped the sign-up/);
    expect(mem.rows.has(OWNER)).toBe(false);
  });

  it("caps AI drafts per person per day", async () => {
    const { say, ai } = setUp();
    await signUpToPrices(say);
    for (let i = 0; i < AI_PER_PERSON_PER_DAY; i++) await say(`Cupcakes 600 attempt ${i}`);
    expect((await say("Cupcakes 600")).text).toMatch(/as many price lists as I can for today/);
    expect(ai.calls).toHaveLength(AI_PER_PERSON_PER_DAY);
  });

  it("passes sign-ups over the daily limit to the yarnOga team", async () => {
    const { say, mem } = setUp();
    mem.fillToday(SIGNUPS_PER_DAY);
    await signUpToPrices(say);
    await say("Cupcakes 600, box of 6 3500 min 2");
    const reply = await say("yes");
    expect(reply.text).toMatch(/yarnOga team will message you/);
    expect(mem.created).toHaveLength(0);
  });

  it("lets a signed-up owner try their bot and change prices", async () => {
    const tried: string[] = [];
    const own: Product = { name: "quote", handle: async (m) => (tried.push(m.text ?? ""), { text: "Your bot here." }) };
    const { say, setup } = setUp(CUPCAKES, { tryBot: async () => own });
    await signUpToPrices(say);
    await say("Cupcakes 600, box of 6 3500 min 2");
    await say("yes");

    expect((await say("try")).text).toMatch(/chatting with \*Mama Cakes\*'s bot/);
    expect((await say("2 boxes of cupcakes")).text).toBe("Your bot here.");
    expect(tried).toEqual(["2 boxes of cupcakes"]);
    expect((await say("done")).text).toMatch(/back with yarnOga/);
    expect((await say("hello")).text).toBe("Demo shop here.\n\nSend *try* to chat with your bot as a customer would, or *prices* to change your price list.");

    const prices = await say("prices");
    expect(prices.text).toContain("• Cupcakes: ₦600 each");
    await say("Cupcakes 600 and box of 6 for 3500 min 2");
    expect((await say("yes")).text).toMatch(/Saved/);
    expect(setup.lists.get("biz-1")).toHaveLength(3);
  });
});

describe("order prefix", () => {
  it("uses the business's initials", () => {
    expect(orderPrefix("Mama Cakes")).toBe("MC");
    expect(orderPrefix("Ade's Print & Design Hub")).toBe("APD");
    expect(orderPrefix("Bakery")).toBe("BAK");
    expect(orderPrefix("123")).toBe("Q");
  });
});
