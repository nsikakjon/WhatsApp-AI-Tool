import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import type { ProductContext } from "../../core/product.js";
import { describeFile, fileKind, memoryCustomerFiles } from "./customer-files.js";
import { createQuoteProduct } from "./index.js";
import type { Variant } from "./pricing.js";
import { joinNotes, type OrderStore, type SavedOrder } from "./store.js";
import type { Understanding } from "./understand.js";

const OWNER = "2348000000001";
const CUSTOMER = "2348012345678";

const variants: Variant[] = [
  { id: "v-card", name: "Business cards: 350gsm matte", minQuantity: 100, tiers: [{ minQuantity: 100, unitPriceKobo: 5_000 }], askFor: "Your artwork or logo" },
  { id: "v-agbada", name: "Agbada: Sewing", minQuantity: 1, tiers: [{ minQuantity: 1, unitPriceKobo: 2_500_000 }], askFor: "Measurements: chest, waist, length" },
  { id: "v-flyer", name: "Flyers: A5", minQuantity: 50, tiers: [{ minQuantity: 50, unitPriceKobo: 15_000 }] },
];

type Row = SavedOrder & { contactId: string; status: string; asked?: boolean };

function memoryOrders() {
  const orders: Row[] = [];
  const store: Required<OrderStore> = {
    async createQuote(contactId, lines, totalKobo) {
      const order: Row = { id: `o${orders.length + 1}`, orderNumber: 1001 + orders.length, totalKobo, lines, contactId, status: "quoted" };
      orders.push(order);
      return { ...order };
    },
    async latestOpenQuote(contactId) {
      const o = [...orders].reverse().find((x) => x.contactId === contactId && x.status === "quoted");
      return o ? { ...o } : null;
    },
    async lastOrder(contactId) {
      return [...orders].reverse().find((x) => x.contactId === contactId && ["confirmed", "paid"].includes(x.status)) ?? null;
    },
    async setStatus(orderId, status) {
      const o = orders.find((x) => x.id === orderId);
      if (!o || o.status !== "quoted") return false;
      o.status = status;
      return true;
    },
    async findOrder(orderNumber) {
      const o = orders.find((x) => x.orderNumber === orderNumber);
      return o
        ? { ...o, status: o.status as "confirmed", customerWaId: CUSTOMER, customerName: "Ada", createdAt: new Date(), paidAt: null }
        : null;
    },
    async markPaid(orderId) {
      const o = orders.find((x) => x.id === orderId);
      if (!o || o.status !== "confirmed") return false;
      o.status = "paid";
      return true;
    },
    async addNotes(orderId, notes) {
      const o = orders.find((x) => x.id === orderId)!;
      o.notes = joinNotes(o.notes, notes);
      return o.notes;
    },
    async askForDetails(orderId) {
      const o = orders.find((x) => x.id === orderId)!;
      if (o.asked) return false;
      o.asked = true;
      return true;
    },
  };
  return { store, orders };
}

function setup() {
  const mem = memoryOrders();
  const files = memoryCustomerFiles();
  const answers: Understanding[] = [];
  const product = createQuoteProduct({
    businessName: "Ada's Prints",
    orderPrefix: "KP",
    ownerWaId: OWNER,
    catalog: { activeVariants: async () => variants },
    orders: mem.store,
    customerFiles: files,
    orderLink: (ref) => `https://app.example/home/orders?q=${ref}`,
    ai: { understand: async () => answers.shift() ?? { intent: "other", items: [], message: "What do you need?" } },
    renderDocument: async () => new Uint8Array([0xff, 0xd8]),
    log: { error() {} },
  });
  const say = (body: string, ...next: Understanding[]) => {
    answers.push(...next);
    return product.handle({ waMessageId: `wamid.${Math.random()}`, from: CUSTOMER, contactName: "Ada", type: "text", text: body, timestamp: 1, raw: {} }, ctx);
  };
  const send = (file: { type?: string; caption?: string; fileName?: string; mimeType?: string; id?: string }, ...next: Understanding[]) => {
    answers.push(...next);
    const msg: IncomingMessage = {
      waMessageId: file.id ?? `wamid.file${files.files.length + 1}`,
      from: CUSTOMER,
      contactName: "Ada",
      type: file.type ?? "image",
      mediaId: "media-1",
      ...(file.caption ? { caption: file.caption } : {}),
      ...(file.fileName ? { fileName: file.fileName } : {}),
      timestamp: 1,
      raw: {},
    };
    const mime = file.mimeType ?? "image/jpeg";
    return product.handle(msg, { ...ctx, downloadMedia: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), mimeType: mime }) });
  };
  return { product, say, send, files, ...mem };
}

const ctx: ProductContext = {
  contactId: "c1",
  history: [],
  downloadMedia: async () => ({ data: new Blob([]), mimeType: "image/jpeg" }),
  sendLater: async () => {},
  canMessageFreely: async () => true,
};

const quote = (variantId: string, quantity: number, notes?: string): Understanding => ({ intent: "quote", items: [{ variantId, quantity }], message: null, ...(notes ? { notes } : {}) });
const yes: Understanding = { intent: "confirm", items: [], message: null };

describe("what a file is", () => {
  it("only asks when a customer with an unpaid order sends a picture or PDF and says nothing", () => {
    expect(fileKind({ mimeType: "image/jpeg" }, false)).toBe("order");
    expect(fileKind({ mimeType: "image/jpeg" }, true)).toBe("ask");
    expect(fileKind({ mimeType: "application/pdf" }, true)).toBe("ask");
    expect(fileKind({ mimeType: "image/jpeg", caption: "I don pay" }, true)).toBe("payment");
    expect(fileKind({ mimeType: "image/png", caption: "transfer receipt" }, true)).toBe("payment");
    expect(fileKind({ mimeType: "image/jpeg", caption: "use this design" }, true)).toBe("order");
    expect(fileKind({ mimeType: "application/octet-stream", fileName: "logo.cdr" }, true)).toBe("order");
    expect(fileKind({ mimeType: "application/pdf", fileName: "artwork.ai" }, true)).toBe("order");
  });

  it("names files plainly", () => {
    expect(describeFile({ fileName: "logo.cdr", mimeType: "application/octet-stream", bytes: 2.4 * 1024 * 1024 })).toBe("logo.cdr (2.4 MB)");
    expect(describeFile({ fileName: null, mimeType: "image/jpeg", bytes: 300_000 })).toBe("Photo (293 KB)");
  });
});

describe("customer files and order details", () => {
  it("keeps a file sent before any order and asks what it's for, then moves it onto the quote", async () => {
    const s = setup();
    const reply = await s.send({ type: "document", fileName: "logo.cdr", mimeType: "application/octet-stream" });
    expect(reply?.text).toBe("Got your file, thank you. What would you like us to do with it, and how many?");
    expect(s.files.files[0]).toMatchObject({ orderId: null, kind: "order", fileName: "logo.cdr" });

    const q = await s.say("200 cards", quote("v-card", 200));
    expect(q?.text).toContain("your quote (KP-1001)");
    expect(s.files.files[0]?.orderId).toBe("o1");
  });

  it("answers the words typed under a file like a message", async () => {
    const s = setup();
    const reply = await s.send({ caption: "200 cards with this logo" }, quote("v-card", 200));
    expect(reply?.text).toMatch(/^Got your file, thank you\.\n\n.*KP-1001/s);
    expect(s.files.files[0]?.orderId).toBe("o1");
  });

  it("asks whether a picture is a payment or a design when an order is waiting for payment", async () => {
    const s = setup();
    await s.say("200 cards", quote("v-card", 200));
    await s.send({ type: "document", fileName: "card.pdf", mimeType: "application/pdf" });
    expect((await s.say("yes", yes))?.text).toContain("Order KP-1001 is confirmed");

    const which = await s.send({ id: "wamid.pic" });
    expect(which?.buttons?.body).toBe("Thank you! Is this a payment receipt for KP-1001, or a design or photo for your order?");
    const [payment, design] = which!.buttons!.buttons.map((b) => b.id);

    // "Design or photo": kept with the order, and the owner gets it with a button to the order.
    const kept = await s.say(design!);
    expect(kept?.text).toContain("saved with your order KP-1001");
    expect(kept?.notify?.[0]).toMatchObject({
      to: OWNER,
      text: "📎 Ada sent a file for KP-1001: Photo (1 KB)",
      link: { label: "Open order", url: "https://app.example/home/orders?q=KP-1001" },
      images: [{ data: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" }],
    });

    // Changing their mind to "Payment receipt": the owner gets the payment check, once.
    const proof = await s.say(payment!);
    expect(proof?.notify?.[0]?.buttons?.buttons.map((b) => b.id)).toEqual(["paid KP-1001", "not paid KP-1001"]);
    expect(s.files.files[1]?.kind).toBe("payment");
    expect((await s.say(payment!))?.notify).toBeUndefined();
  });

  it("passes a screenshot captioned as a payment straight to the owner", async () => {
    const s = setup();
    await s.say("200 cards", quote("v-card", 200));
    await s.send({ type: "document", fileName: "card.pdf", mimeType: "application/pdf" });
    await s.say("yes", yes);
    const reply = await s.send({ caption: "I don pay" });
    expect(reply?.text).toContain("passed this to Ada's Prints to check against order KP-1001");
    expect(reply?.notify?.[0]?.buttons?.image).toBeDefined();
  });

  it("saves measurements as the quote's details and puts them in the owner's order alert", async () => {
    const s = setup();
    await s.say("1 agbada", quote("v-agbada", 1));
    const saved = await s.say("chest 42, waist 36, length 58", { intent: "other", items: [], message: "Thanks", notes: "chest 42, waist 36, length 58" });
    expect(saved?.text).toBe(
      "Thank you, I've added this to your quote KP-1001: chest 42, waist 36, length 58\n\nReply YES to confirm the order, or tell me what to change.",
    );
    const order = await s.say("yes", yes);
    expect(order?.text).toContain("Order KP-1001 is confirmed");
    expect(order?.notify?.[0]?.text).toContain("📝 Details: chest 42, waist 36, length 58");
    expect(order?.notify?.[0]?.link?.label).toBe("Open order");
  });

  it("asks once for what a product needs before confirming, then confirms and tells the owner it's missing", async () => {
    const s = setup();
    await s.say("1 agbada", quote("v-agbada", 1));
    const ask = await s.say("yes", yes);
    expect(ask?.text).toBe(
      "Before I confirm KP-1001, please send:\n• Agbada: Measurements: chest, waist, length\n\nYou can type it, send a voice note, or send a photo or file. Then reply YES.",
    );
    expect(s.orders[0]?.status).toBe("quoted");
    const order = await s.say("yes", yes);
    expect(order?.text).toContain("Order KP-1001 is confirmed");
    expect(order?.notify?.[0]?.text).toContain("⚠️ They haven't sent what you ask for yet: Agbada: Measurements: chest, waist, length");
  });

  it("takes details sent with the request onto the quote and keeps them when the quote changes", async () => {
    const s = setup();
    const first = await s.say("2 agbada chest 40", quote("v-agbada", 2, "chest 40"));
    expect(first?.text).toContain("📝 Details: chest 40");
    await s.say("make it 3", quote("v-agbada", 3));
    expect(s.orders[1]?.notes).toBe("chest 40");
  });

  it("never repeats details that look like money back to the customer", async () => {
    const s = setup();
    await s.say("1 agbada", quote("v-agbada", 1));
    const saved = await s.say("budget 20k", { intent: "other", items: [], message: null, notes: "budget 20k" });
    expect(saved?.text).toBe("Thank you, I've added this to your quote KP-1001.\n\nReply YES to confirm the order, or tell me what to change.");
  });

  it("tells the customer when a file is too big to keep", async () => {
    const s = setup();
    const big = new Uint8Array(50 * 1024 * 1024 + 1);
    const reply = await s.product.handle(
      { waMessageId: "wamid.big", from: CUSTOMER, type: "document", mediaId: "m", timestamp: 1, raw: {} },
      { ...ctx, downloadMedia: async () => ({ data: new Blob([big]), mimeType: "application/pdf" }) },
    );
    expect(reply?.text).toContain("too big for me to keep (over 50 MB)");
    expect(s.files.files).toHaveLength(0);
  });
});

describe("order notes", () => {
  it("adds new details on their own line and skips repeats", () => {
    expect(joinNotes(null, "chest 40")).toBe("chest 40");
    expect(joinNotes("chest 40", "waist 34")).toBe("chest 40\nwaist 34");
    expect(joinNotes("chest 40\nwaist 34", "Chest 40")).toBe("chest 40\nwaist 34");
  });
});
