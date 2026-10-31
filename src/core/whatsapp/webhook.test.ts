import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { echoProduct } from "../../products/echo/index.js";
import type { Product } from "../product.js";
import type { Transcriber } from "../voice/transcribe.js";
import type { UsageMeter } from "../usage.js";
import type { BotPause, MessageStore } from "../db/store.js";
import type { WhatsAppClient } from "./client.js";
import { FALLBACK_TEXT, isTransient, retryingClient } from "./webhook.js";
import type { IncomingMessage } from "./types.js";

const APP_SECRET = "test-secret";
const VERIFY_TOKEN = "test-verify-token";
const silent = { info() {}, warn() {}, error() {} };

function memoryStore() {
  const contacts = new Map<string, string>();
  const seen = new Set<string>();
  const outbound: string[] = [];
  const inboundText = new Map<string, string>();
  const pauses = new Map<string, BotPause>();
  const userIds = new Map<string, string>();
  const store: MessageStore = {
    async upsertContact(waId, _name, userId) {
      if (!contacts.has(waId)) contacts.set(waId, `contact-${contacts.size + 1}`);
      if (userId && !userIds.has(userId)) userIds.set(userId, waId);
      return contacts.get(waId)!;
    },
    async waIdForUser(userId) {
      return userIds.get(userId) ?? null;
    },
    async recordInbound(_contactId, msg) {
      if (seen.has(msg.waMessageId)) return "duplicate";
      seen.add(msg.waMessageId);
      return "new";
    },
    async recordOutbound(_contactId, out) {
      outbound.push(out.body);
    },
    async recentHistory() {
      return [];
    },
    async lastInboundAt() {
      return null;
    },
    async setInboundText(waMessageId, text) {
      inboundText.set(waMessageId, text);
    },
    async recordOwnerReply(_contactId, reply) {
      if (seen.has(reply.waMessageId)) return "duplicate";
      seen.add(reply.waMessageId);
      outbound.push(`[owner] ${reply.text ?? ""}`);
      return "new";
    },
    async pauseBot(contactId, businessNumberId, until, by) {
      pauses.set(`${contactId}:${businessNumberId}`, { until, by });
    },
    async resumeBot(contactId, businessNumberId) {
      pauses.delete(`${contactId}:${businessNumberId}`);
    },
    async botPause(contactId, businessNumberId) {
      return pauses.get(`${contactId}:${businessNumberId}`) ?? null;
    },
  };
  return { store, contacts, outbound, inboundText, pauses };
}

function setup(
  product: Product = echoProduct,
  transcriber?: Transcriber,
  route?: (msg: IncomingMessage) => Product,
  extra: { ownerReplyPauseMinutes?: number; now?: () => Date; retryDelaysMs?: number[]; usage?: UsageMeter } = {},
) {
  const sent: Array<{ to: string; body: string }> = [];
  const sentFrom: Array<string | undefined> = [];
  const whatsapp: WhatsAppClient = {
    async sendText(to, body, fromNumberId) {
      sent.push({ to, body });
      sentFrom.push(fromNumberId);
      if (to === "FAIL") throw new Error("send failed");
      return { waMessageId: `wamid.out.${sent.length}`, raw: {} };
    },
    async sendTemplate(to, template) {
      sent.push({ to, body: `[template] ${template.name}` });
      return { waMessageId: `wamid.out.${sent.length}`, raw: {} };
    },
    async sendImage(to, image, fromNumberId) {
      sent.push({ to, body: `[image] ${image.caption ?? ""}` });
      sentFrom.push(fromNumberId);
      return { waMessageId: `wamid.out.${sent.length}`, raw: {} };
    },
    async sendList(to, list) {
      sent.push({ to, body: `[list] ${list.body} | ${list.rows.map((r) => r.id).join(", ")}` });
      return { waMessageId: `wamid.out.${sent.length}`, raw: {} };
    },
    async sendButtons(to, message) {
      sent.push({ to, body: `[buttons] ${message.body} | ${message.buttons.map((b) => b.id).join(", ")}` });
      return { waMessageId: `wamid.out.${sent.length}`, raw: {} };
    },
    async sendLocationRequest(to, body) {
      sent.push({ to, body: `[location request] ${body}` });
      return { waMessageId: `wamid.out.${sent.length}`, raw: {} };
    },
    async downloadMedia(mediaId) {
      if (mediaId === "broken") throw new Error("download failed");
      return { data: new Blob(["audio"]), mimeType: "audio/ogg" };
    },
  };
  const mem = memoryStore();
  const app = createApp({
    verifyToken: VERIFY_TOKEN,
    appSecret: APP_SECRET,
    store: mem.store,
    whatsapp,
    transcriber,
    route: route ?? (() => product),
    log: silent,
    retryDelaysMs: [0, 0],
    ...extra,
  });
  return { app, sent, sentFrom, ...mem };
}

function textWebhook(id: string, text: string) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: "PNID" },
              contacts: [{ profile: { name: "Ada" }, wa_id: "2348012345678" }],
              messages: [
                { from: "2348012345678", id, timestamp: "1760000000", type: "text", text: { body: text } },
              ],
            },
          },
        ],
      },
    ],
  });
}

function sign(body: string, secret = APP_SECRET) {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

function post(app: ReturnType<typeof setup>["app"], body: string, signature?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature) headers["x-hub-signature-256"] = signature;
  return app.request("/webhooks/whatsapp", { method: "POST", body, headers });
}

describe("GET /webhooks/whatsapp (Meta verification)", () => {
  it("echoes the challenge when the token matches", async () => {
    const { app } = setup();
    const res = await app.request(
      `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("12345");
  });

  it("refuses a wrong token", async () => {
    const { app } = setup();
    const res = await app.request(
      "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345",
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /webhooks/whatsapp (incoming messages)", () => {
  it("replies with an echo to a signed text message", async () => {
    const { app, sent, outbound, contacts } = setup();
    const body = textWebhook("wamid.1", "Hello");
    const res = await post(app, body, sign(body));
    expect(res.status).toBe(200);
    expect(sent).toEqual([{ to: "2348012345678", body: "You said: Hello" }]);
    expect(outbound).toEqual(["You said: Hello"]);
    expect(contacts.has("2348012345678")).toBe(true);
  });

  it("still answers a customer who hides their number behind a WhatsApp username", async () => {
    const { app, sent, contacts } = setup();
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "PNID" },
        contacts: [{ profile: { name: "Ada" }, user_id: "NG.1349120865530274" }],
        messages: [{ from_user_id: "NG.1349120865530274", id: "wamid.hidden", timestamp: "1", type: "text", text: { body: "Hello" } }],
      } }] }],
    });
    await post(app, body, sign(body));
    expect(sent).toEqual([{ to: "NG.1349120865530274", body: "You said: Hello" }]);
    expect(contacts.has("NG.1349120865530274")).toBe(true);
  });

  it("keeps a known customer on their phone number after they hide it", async () => {
    const { app, sent, contacts } = setup();
    const message = (extra: Record<string, unknown>, id: string) => {
      const body = JSON.stringify({
        object: "whatsapp_business_account",
        entry: [{ changes: [{ field: "messages", value: {
          metadata: { phone_number_id: "PNID" },
          messages: [{ ...extra, from_user_id: "NG.1349120865530274", id, timestamp: "1", type: "text", text: { body: "Hi" } }],
        } }] }],
      });
      return post(app, body, sign(body));
    };
    await message({ from: "2348012345678" }, "wamid.first");
    await message({}, "wamid.later");
    expect(sent.map((s) => s.to)).toEqual(["2348012345678", "2348012345678"]);
    expect([...contacts.keys()]).toEqual(["2348012345678"]);
  });

  it("routes by the number that was messaged and replies from that number", async () => {
    const other: Product = { name: "other", handle: async () => ({ text: "from other", notify: [{ to: "2348099999999", text: "alert" }] }) };
    const { app, sent, sentFrom } = setup(echoProduct, undefined, (msg) =>
      msg.businessNumberId === "PNID" ? other : echoProduct,
    );
    const body = textWebhook("wamid.route", "Hello");
    await post(app, body, sign(body));
    expect(sent.map((s) => s.body)).toEqual(["from other", "alert"]);
    expect(sentFrom).toEqual(["PNID", "PNID"]);
  });

  it("sends pictures after the text, and no text when the text is empty", async () => {
    const image = { data: new Uint8Array([1]), mimeType: "image/jpeg" };
    let text = "Here it is";
    const pics: Product = { name: "pics", handle: async () => ({ text, images: [{ ...image, caption: "Flyer" }] }) };
    const { app, sent } = setup(pics);
    let body = textWebhook("wamid.pic1", "Hello");
    await post(app, body, sign(body));
    expect(sent.map((s) => s.body)).toEqual(["Here it is", "[image] Flyer"]);

    text = "";
    body = textWebhook("wamid.pic2", "Hello");
    await post(app, body, sign(body));
    expect(sent.map((s) => s.body)).toEqual(["Here it is", "[image] Flyer", "[image] Flyer"]);
  });

  it("lets a product send a follow-up reply after answering", async () => {
    let later: ((r: { text: string }) => Promise<void>) | undefined;
    const slow: Product = {
      name: "slow",
      handle: async (_msg, ctx) => {
        later = ctx.sendLater;
        return { text: "Working on it" };
      },
    };
    const { app, sent, outbound } = setup(slow);
    const body = textWebhook("wamid.later", "go");
    await post(app, body, sign(body));
    await later!({ text: "All done" });
    expect(sent.map((s) => s.body)).toEqual(["Working on it", "All done"]);
    expect(outbound).toContain("All done");
  });

  it("passes a photo's caption and media id to the product", async () => {
    let seen: IncomingMessage | undefined;
    const spy: Product = { name: "spy", handle: async (msg) => ((seen = msg), null) };
    const { app, sent } = setup(spy);
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "PNID" },
        messages: [{ from: "2348012345678", id: "wamid.img", timestamp: "1", type: "image", image: { id: "img-1", caption: "Slab done" } }],
      } }] }],
    });
    await post(app, body, sign(body));
    expect(seen).toMatchObject({ type: "image", mediaId: "img-1", caption: "Slab done", businessNumberId: "PNID" });
    expect(seen?.text).toBeUndefined();
    expect(sent).toHaveLength(0);
  });

  it("sends a list of choices after the pictures", async () => {
    const image = { data: new Uint8Array([1]), mimeType: "image/jpeg" };
    const list = { body: "Pick one", button: "See designs", rows: [{ id: "design 1", title: "Royal purple" }] };
    const picker: Product = { name: "picker", handle: async () => ({ text: "Designs", images: [image], list }) };
    const { app, sent, outbound } = setup(picker);
    const body = textWebhook("wamid.list", "design");
    await post(app, body, sign(body));
    expect(sent.map((s) => s.body)).toEqual(["Designs", "[image] ", "[list] Pick one | design 1"]);
    expect(outbound).toContain("Pick one");
  });

  it("hands a tapped list choice to the product as its id", async () => {
    let seen: IncomingMessage | undefined;
    const spy: Product = { name: "spy", handle: async (msg) => ((seen = msg), null) };
    const { app } = setup(spy);
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "PNID" },
        messages: [{ from: "2348012345678", id: "wamid.tap", timestamp: "1", type: "interactive",
          interactive: { type: "list_reply", list_reply: { id: "design 8", title: "8. Evening gala" } } }],
      } }] }],
    });
    await post(app, body, sign(body));
    expect(seen).toMatchObject({ type: "interactive", text: "design 8" });
  });

  it("hands a tapped template button to the product as its label", async () => {
    let seen: IncomingMessage | undefined;
    const spy: Product = { name: "spy", handle: async (msg) => ((seen = msg), null) };
    const { app } = setup(spy);
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "PNID" },
        messages: [{ from: "2348012345678", id: "wamid.btn", timestamp: "1", type: "button",
          button: { text: "Stop promotions", payload: "Stop promotions" } }],
      } }] }],
    });
    await post(app, body, sign(body));
    expect(seen).toMatchObject({ type: "button", text: "Stop promotions" });
  });

  it("rejects a missing signature without doing any work", async () => {
    const { app, sent, contacts } = setup();
    const res = await post(app, textWebhook("wamid.1", "Hello"));
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
    expect(contacts.size).toBe(0);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const { app, sent } = setup();
    const body = textWebhook("wamid.1", "Hello");
    const res = await post(app, body, sign(body, "not-the-secret"));
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("rejects a body that was changed after signing", async () => {
    const { app, sent } = setup();
    const body = textWebhook("wamid.1", "Hello");
    const res = await post(app, textWebhook("wamid.1", "Hacked"), sign(body));
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("replies only once when Meta sends the same message twice", async () => {
    const { app, sent } = setup();
    const body = textWebhook("wamid.dup", "Hi");
    await post(app, body, sign(body));
    const res = await post(app, body, sign(body));
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("ignores delivery receipts that carry no messages", async () => {
    const { app, sent } = setup();
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.x", status: "read" }] } }] }],
    });
    const res = await post(app, body, sign(body));
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("tells the sender it can only echo text for other message types", async () => {
    const { app, sent } = setup();
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [{ from: "2348012345678", id: "wamid.audio", timestamp: "1", type: "audio", audio: { id: "media1" } }],
              },
            },
          ],
        },
      ],
    });
    await post(app, body, sign(body));
    expect(sent[0]?.body).toBe("I got your audio message. For now I can only echo text.");
  });

  it("sends a product's extra notifications after the reply, and survives one failing", async () => {
    const notifying: Product = {
      name: "notifying",
      async handle() {
        return {
          text: "Thanks!",
          notify: [
            { to: "FAIL", text: "never arrives" },
            { to: "2348099999999", text: "New order" },
          ],
        };
      },
    };
    const { app, sent } = setup(notifying);
    const body = textWebhook("wamid.notify", "Hi");
    const res = await post(app, body, sign(body));
    expect(res.status).toBe(200);
    expect(sent).toEqual([
      { to: "2348012345678", body: "Thanks!" },
      { to: "FAIL", body: "never arrives" },
      { to: "2348099999999", body: "New order" },
    ]);
  });

  it("sends pictures attached to a notification, e.g. a receipt", async () => {
    const notifying: Product = {
      name: "notifying",
      async handle() {
        return {
          text: "Marked paid",
          notify: [{ to: "2348099999999", text: "Thanks for paying", images: [{ data: new Uint8Array([1]), mimeType: "image/jpeg", caption: "Receipt" }] }],
        };
      },
    };
    const { app, sent } = setup(notifying);
    const body = textWebhook("wamid.notify-image", "paid 1001");
    await post(app, body, sign(body));
    expect(sent).toEqual([
      { to: "2348012345678", body: "Marked paid" },
      { to: "2348099999999", body: "Thanks for paying" },
      { to: "2348099999999", body: "[image] Receipt" },
    ]);
  });

  it("sends buttons and a location request after the text", async () => {
    const asking: Product = {
      name: "asking",
      handle: async () => ({
        text: "Your total",
        buttons: { body: "Confirm?", buttons: [{ id: "yes", title: "Confirm order" }] },
        locationRequest: "Where should we deliver?",
      }),
    };
    const { app, sent, outbound } = setup(asking);
    const body = textWebhook("wamid.buttons", "yes");
    await post(app, body, sign(body));
    expect(sent.map((s) => s.body)).toEqual(["Your total", "[buttons] Confirm? | yes", "[location request] Where should we deliver?"]);
    expect(outbound).toEqual(["Your total", "Confirm?", "Where should we deliver?"]);
  });

  it("sends cards after the text and before any buttons", async () => {
    const showing: Product = {
      name: "showing",
      handle: async () => ({
        text: "Here's what we sell",
        cards: [
          { body: "Mugs", buttons: [{ id: "I'd like Mugs", title: "Order this" }] },
          { body: "Cupcakes", buttons: [{ id: "I'd like Cupcakes", title: "Order this" }] },
        ],
        buttons: { body: "2 of 3", buttons: [{ id: "catalogue page 2", title: "See more" }] },
      }),
    };
    const { app, sent, outbound } = setup(showing);
    const body = textWebhook("wamid.cards", "catalogue");
    await post(app, body, sign(body));
    expect(sent.map((s) => s.body)).toEqual([
      "Here's what we sell",
      "[buttons] Mugs | I'd like Mugs",
      "[buttons] Cupcakes | I'd like Cupcakes",
      "[buttons] 2 of 3 | catalogue page 2",
    ]);
    expect(outbound).toEqual(["Here's what we sell", "Mugs", "Cupcakes", "2 of 3"]);
  });

  it("sends a notice's template to someone who hasn't messaged in the last day", async () => {
    const notifying: Product = {
      name: "notifying",
      handle: async (_msg, ctx) => ({
        text: (await ctx.canMessageFreely("2348099999999")) ? "can reach" : "can't reach",
        notify: [
          {
            to: "2348099999999",
            text: "On its way",
            buttons: { body: "Done?", buttons: [{ id: "delivered 1001", title: "Delivered" }] },
            template: { name: "order_update", language: "en", bodyParams: ["KP-1001", "KahnPrints", "On its way"] },
          },
        ],
      }),
    };
    const { app, sent } = setup(notifying);
    const body = textWebhook("wamid.notice", "Hi");
    await post(app, body, sign(body));
    expect(sent).toEqual([
      { to: "2348012345678", body: "can't reach" },
      { to: "2348099999999", body: "[template] order_update" },
    ]);
  });

  it("passes a location pin to the product", async () => {
    let seen: IncomingMessage | undefined;
    const spy: Product = { name: "spy", handle: async (msg) => ((seen = msg), null) };
    const { app } = setup(spy);
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "PNID" },
        messages: [{ from: "2348012345678", id: "wamid.pin", timestamp: "1", type: "location",
          location: { latitude: 6.6018, longitude: 3.3515, name: "Computer Village", address: "Ikeja, Lagos" } }],
      } }] }],
    });
    await post(app, body, sign(body));
    expect(seen).toMatchObject({
      type: "location",
      location: { latitude: 6.6018, longitude: 3.3515, name: "Computer Village", address: "Ikeja, Lagos" },
    });
  });

  function voiceWebhook(id: string, mediaId: string) {
    return JSON.stringify({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [{ from: "2348012345678", id, timestamp: "1", type: "audio", audio: { id: mediaId, mime_type: "audio/ogg; codecs=opus" } }],
              },
            },
          ],
        },
      ],
    });
  }

  it("transcribes voice notes and hands the text to the product", async () => {
    const transcriber: Transcriber = { transcribe: async () => ({ text: "I need fifty flyers", seconds: 3 }) };
    const { app, sent, inboundText } = setup(echoProduct, transcriber);
    const body = voiceWebhook("wamid.voice", "media-1");
    await post(app, body, sign(body));
    expect(sent[0]?.body).toBe("You said: I need fifty flyers");
    expect(inboundText.get("wamid.voice")).toBe("I need fifty flyers");
  });

  it("counts each voice note's length against the number it came in on", async () => {
    const counted: [string | undefined, number][] = [];
    const usage: UsageMeter = { ai: () => {}, voice: (numberId, seconds) => counted.push([numberId, seconds]) };
    const transcriber: Transcriber = { transcribe: async () => ({ text: "hello", seconds: 3 }) };
    const { app } = setup(echoProduct, transcriber, undefined, { usage });
    const body = voiceWebhook("wamid.voice3", "media-1");
    await post(app, body, sign(body));
    expect(counted).toEqual([[undefined, 3]]); // the sample webhook has no number id: the main number
  });

  it("still answers when a voice note can't be downloaded", async () => {
    const transcriber: Transcriber = { transcribe: async () => ({ text: "never used", seconds: null }) };
    const { app, sent } = setup(echoProduct, transcriber);
    const body = voiceWebhook("wamid.voice2", "broken");
    const res = await post(app, body, sign(body));
    expect(res.status).toBe(200);
    expect(sent[0]?.body).toBe("I got your audio message. For now I can only echo text.");
  });
});

function ownerEchoWebhook(id: string, text: string, to = "2348012345678", phoneNumberId = "PNID") {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "smb_message_echoes",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "15550000000", phone_number_id: phoneNumberId },
              message_echoes: [
                { from: "15550000000", to, id, timestamp: "1760000000", type: "text", text: { body: text } },
              ],
            },
          },
        ],
      },
    ],
  });
}

describe("owner replies from the WhatsApp Business app (coexistence)", () => {
  function clockedSetup(minutes = 60) {
    let time = new Date("2026-10-16T09:00:00Z");
    const ctx = setup(echoProduct, undefined, undefined, { ownerReplyPauseMinutes: minutes, now: () => time });
    return { ...ctx, advance: (mins: number) => (time = new Date(time.getTime() + mins * 60_000)) };
  }

  async function send(app: ReturnType<typeof setup>["app"], body: string) {
    const res = await post(app, body, sign(body));
    expect(res.status).toBe(200);
  }

  it("keeps the bot quiet in that chat after the owner replies, then lets it back in", async () => {
    const { app, sent, outbound, advance } = clockedSetup(60);
    await send(app, ownerEchoWebhook("wamid.owner1", "Hi, Jay here. Let me check for you."));
    expect(outbound).toEqual(["[owner] Hi, Jay here. Let me check for you."]);

    advance(30);
    await send(app, textWebhook("wamid.c1", "Thanks"));
    expect(sent).toEqual([]);

    advance(31);
    await send(app, textWebhook("wamid.c2", "Hello?"));
    expect(sent).toEqual([{ to: "2348012345678", body: "You said: Hello?" }]);
  });

  it("pushes the pause later with each owner reply", async () => {
    const { app, sent, advance } = clockedSetup(60);
    await send(app, ownerEchoWebhook("wamid.o1", "One sec"));
    advance(50);
    await send(app, ownerEchoWebhook("wamid.o2", "Done, here you go"));
    advance(50);
    await send(app, textWebhook("wamid.c3", "Great"));
    expect(sent).toEqual([]);
  });

  it("only pauses the chat the owner replied in", async () => {
    const { app, sent } = clockedSetup(60);
    await send(app, ownerEchoWebhook("wamid.o3", "Hi", "2348099999999"));
    await send(app, textWebhook("wamid.c4", "Hello"));
    expect(sent).toEqual([{ to: "2348012345678", body: "You said: Hello" }]);
  });

  it("does not pause the same chat on another of our numbers", async () => {
    const { app, sent } = clockedSetup(60);
    await send(app, ownerEchoWebhook("wamid.o4", "Hi", "2348012345678", "OTHER_PNID"));
    await send(app, textWebhook("wamid.c5", "Hello"));
    expect(sent).toHaveLength(1);
  });

  it("ignores a re-sent owner reply", async () => {
    const { app, outbound } = clockedSetup(60);
    const body = ownerEchoWebhook("wamid.o5", "Hi");
    await send(app, body);
    await send(app, body);
    expect(outbound).toEqual(["[owner] Hi"]);
  });

  it("stays quiet in a chat taken over with no end time, even after owner replies", async () => {
    const { app, sent, store, contacts, advance } = clockedSetup(60);
    await send(app, textWebhook("wamid.c8", "Hello"));
    const contactId = contacts.get("2348012345678")!;
    await store.pauseBot(contactId, "PNID", null, "inbox");
    await send(app, ownerEchoWebhook("wamid.o8", "I've got this"));
    advance(24 * 60);
    await send(app, textWebhook("wamid.c9", "Still there?"));
    expect(sent).toHaveLength(1);

    await store.resumeBot(contactId, "PNID");
    await send(app, textWebhook("wamid.c10", "Hi again"));
    expect(sent).toHaveLength(2);
  });

  it("does nothing with owner replies when the pause is switched off", async () => {
    const { app, sent, outbound, pauses } = clockedSetup(0);
    await send(app, ownerEchoWebhook("wamid.o6", "Hi"));
    await send(app, textWebhook("wamid.c6", "Hello"));
    expect(outbound).toEqual(["You said: Hello"]);
    expect(pauses.size).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("still answers if the pause can't be checked (e.g. table missing)", async () => {
    const { app, sent, store } = clockedSetup(60);
    store.botPause = async () => {
      throw new Error('relation "bot_pauses" does not exist');
    };
    await send(app, textWebhook("wamid.c7", "Hello"));
    expect(sent).toHaveLength(1);
  });

  it("rejects an owner echo with a bad signature", async () => {
    const { app, pauses } = clockedSetup(60);
    const body = ownerEchoWebhook("wamid.o7", "Hi");
    const res = await post(app, body, sign(body, "wrong-secret"));
    expect(res.status).toBe(401);
    expect(pauses.size).toBe(0);
  });
});

describe("when answering fails", () => {
  it("tries the bot again after a passing failure, then answers normally", async () => {
    let calls = 0;
    const flaky: Product = {
      name: "flaky",
      handle: async () => {
        calls += 1;
        if (calls === 1) throw new Error("Anthropic API overloaded (529)");
        return { text: "Here is your quote" };
      },
    };
    const { app, sent } = setup(flaky);
    const body = textWebhook("wamid.flaky", "500 flyers");
    await post(app, body, sign(body));
    expect(calls).toBe(2);
    expect(sent).toEqual([{ to: "2348012345678", body: "Here is your quote" }]);
  });

  it("sends the customer a fallback reply when the bot keeps failing", async () => {
    let calls = 0;
    const broken: Product = { name: "broken", handle: async () => { calls += 1; throw new Error("fetch failed"); } };
    const { app, sent, outbound } = setup(broken);
    const body = textWebhook("wamid.broken", "Hi");
    await post(app, body, sign(body));
    expect(calls).toBe(2);
    expect(sent).toEqual([{ to: "2348012345678", body: FALLBACK_TEXT }]);
    expect(outbound).toEqual([FALLBACK_TEXT]);
  });

  it("doesn't run the bot twice for a mistake that would fail the same way", async () => {
    let calls = 0;
    const buggy: Product = { name: "buggy", handle: async () => { calls += 1; throw new TypeError("x is undefined"); } };
    const { app, sent } = setup(buggy);
    const body = textWebhook("wamid.buggy", "Hi");
    await post(app, body, sign(body));
    expect(calls).toBe(1);
    expect(sent.map((s) => s.body)).toEqual([FALLBACK_TEXT]);
  });
});

describe("retryingClient", () => {
  it("tries a WhatsApp call again when WhatsApp is busy, not when the request is wrong", async () => {
    let tries = 0;
    const base = {
      sendText: async () => {
        tries += 1;
        if (tries < 3) throw new Error("WhatsApp send failed (503): Service unavailable");
        return { waMessageId: "ok", raw: {} };
      },
    } as unknown as WhatsAppClient;
    const client = retryingClient(base, [0, 0], silent);
    expect((await client.sendText("1", "hi")).waMessageId).toBe("ok");
    expect(tries).toBe(3);

    expect(isTransient(new Error("WhatsApp send failed (400): bad number"))).toBe(false);
    expect(isTransient(new Error("WhatsApp send failed (429): too many"))).toBe(true);
    expect(isTransient(Object.assign(new Error("x"), { status: 529 }))).toBe(true);
  });
});
