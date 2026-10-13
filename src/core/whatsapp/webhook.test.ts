import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { echoProduct } from "../../products/echo/index.js";
import type { Product } from "../product.js";
import type { Transcriber } from "../voice/transcribe.js";
import type { MessageStore } from "../db/store.js";
import type { WhatsAppClient } from "./client.js";
import type { IncomingMessage } from "./types.js";

const APP_SECRET = "test-secret";
const VERIFY_TOKEN = "test-verify-token";
const silent = { info() {}, warn() {}, error() {} };

function memoryStore() {
  const contacts = new Map<string, string>();
  const seen = new Set<string>();
  const outbound: string[] = [];
  const inboundText = new Map<string, string>();
  const store: MessageStore = {
    async upsertContact(waId) {
      if (!contacts.has(waId)) contacts.set(waId, `contact-${contacts.size + 1}`);
      return contacts.get(waId)!;
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
  };
  return { store, contacts, outbound, inboundText };
}

function setup(
  product: Product = echoProduct,
  transcriber?: Transcriber,
  route?: (msg: IncomingMessage) => Product,
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
    const transcriber: Transcriber = { transcribe: async () => "I need fifty flyers" };
    const { app, sent, inboundText } = setup(echoProduct, transcriber);
    const body = voiceWebhook("wamid.voice", "media-1");
    await post(app, body, sign(body));
    expect(sent[0]?.body).toBe("You said: I need fifty flyers");
    expect(inboundText.get("wamid.voice")).toBe("I need fifty flyers");
  });

  it("still answers when a voice note can't be downloaded", async () => {
    const transcriber: Transcriber = { transcribe: async () => "never used" };
    const { app, sent } = setup(echoProduct, transcriber);
    const body = voiceWebhook("wamid.voice2", "broken");
    const res = await post(app, body, sign(body));
    expect(res.status).toBe(200);
    expect(sent[0]?.body).toBe("I got your audio message. For now I can only echo text.");
  });
});
