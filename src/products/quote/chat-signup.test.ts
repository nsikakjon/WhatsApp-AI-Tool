import { describe, expect, it } from "vitest";
import type { Product, ProductContext } from "../../core/product.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { AI_PER_PERSON_PER_DAY, SIGNUPS_PER_DAY, orderPrefix, withChatSignup, type ChatSignupOptions, type Signup, type SignupStore } from "./chat-signup.js";
import type { PriceListDraft, PriceListDrafter } from "./drafter.js";
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

  it("invites visitors who say hi to sign up, with a button under the demo shop's welcome", async () => {
    const welcome: Product = {
      name: "quote",
      handle: async () => ({ text: "", buttons: { body: "Welcome to the demo shop.", buttons: [{ id: "get a quote", title: "Get a quote" }] } }),
    };
    const bot = withChatSignup(welcome, { numberId: NUMBER, store: memoryStore().store, setup: memorySetup().setup, drafter: drafter(CUPCAKES).d });
    const reply = (await bot.handle(msg("Hi"), ctx(5)))!;
    expect(reply.buttons?.body).toMatch(/Welcome to the demo shop\.\n\n.*sign up/);
    expect(reply.buttons?.buttons.map((b) => b.id)).toEqual(["get a quote", "sign up"]);
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
    await say("Mama Cakes");
    await say("cakes");
    expect((await say("skip")).text).toMatch(/Google Sheet template \(https:\/\/docs\.google\.com\/spreadsheets\/d\/.+\/copy\)/);
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
