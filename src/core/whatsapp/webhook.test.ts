import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { echoProduct } from "../../products/echo/index.js";
import type { Product } from "../product.js";
import type { MessageStore } from "../db/store.js";
import type { WhatsAppClient } from "./client.js";

const APP_SECRET = "test-secret";
const VERIFY_TOKEN = "test-verify-token";
const silent = { info() {}, warn() {}, error() {} };

function memoryStore() {
  const contacts = new Map<string, string>();
  const seen = new Set<string>();
  const outbound: string[] = [];
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
  };
  return { store, contacts, outbound };
}

function setup(product: Product = echoProduct) {
  const sent: Array<{ to: string; body: string }> = [];
  const whatsapp: WhatsAppClient = {
    async sendText(to, body) {
      sent.push({ to, body });
      if (to === "FAIL") throw new Error("send failed");
      return { waMessageId: `wamid.out.${sent.length}`, raw: {} };
    },
  };
  const mem = memoryStore();
  const app = createApp({
    verifyToken: VERIFY_TOKEN,
    appSecret: APP_SECRET,
    store: mem.store,
    whatsapp,
    route: () => product,
    log: silent,
  });
  return { app, sent, ...mem };
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
});
