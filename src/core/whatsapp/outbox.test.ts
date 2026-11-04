import { describe, expect, it } from "vitest";
import type { MessageStore } from "../db/store.js";
import type { OutgoingTemplate, WhatsAppClient } from "./client.js";
import { sendNotice } from "./outbox.js";

const HOUR = 60 * 60 * 1000;

// The owner last wrote to the flyer line an hour ago and to the quotes line two days ago.
function setup() {
  const lastWrote: Record<string, Date> = { flyer: new Date(Date.now() - HOUR), quotes: new Date(Date.now() - 48 * HOUR) };
  const sent: Array<{ kind: "text" | "template"; to: string; from?: string; text?: string; template?: OutgoingTemplate }> = [];
  const store = {
    upsertContact: async () => "contact-1",
    recordOutbound: async () => {},
    lastInboundAt: async (_waId: string, numberId?: string) =>
      numberId ? (lastWrote[numberId] ?? null) : new Date(Math.max(...Object.values(lastWrote).map(Number))),
  } as unknown as MessageStore;
  const whatsapp = {
    sendText: async (to: string, text: string, from?: string) => {
      sent.push({ kind: "text", to, from, text });
      return { waMessageId: "m", raw: {} };
    },
    sendTemplate: async (to: string, template: OutgoingTemplate, from?: string) => {
      sent.push({ kind: "template", to, from, template });
      return { waMessageId: "m", raw: {} };
    },
  } as unknown as WhatsAppClient;
  return { store, whatsapp, sent };
}

const alert = { to: "2348000000001", text: "New quote bot sign-up: Ada's Shop\nReply *on* to switch it on." };
const ownerAlert = { name: "owner_alert", language: "en" };

describe("sendNotice", () => {
  it("sends the alert template when the owner hasn't written to that number in a day", async () => {
    const { store, whatsapp, sent } = setup();
    await sendNotice({ store, whatsapp, noticeTemplate: ownerAlert }, alert, "quotes");
    expect(sent).toEqual([
      {
        kind: "template",
        to: alert.to,
        from: "quotes",
        template: { ...ownerAlert, bodyParams: ["New quote bot sign-up: Ada's Shop · Reply *on* to switch it on."] },
      },
    ]);
  });

  it("sends plain text inside the owner's 24 hours on that number", async () => {
    const { store, whatsapp, sent } = setup();
    await sendNotice({ store, whatsapp, noticeTemplate: ownerAlert }, alert, "flyer");
    expect(sent).toEqual([{ kind: "text", to: alert.to, from: "flyer", text: alert.text }]);
  });

  it("checks the default number's 24 hours when no number is named", async () => {
    const { store, whatsapp, sent } = setup();
    await sendNotice({ store, whatsapp, noticeTemplate: ownerAlert, defaultNumberId: "quotes" }, alert);
    expect(sent[0].kind).toBe("template");
  });

  it("prefers the notice's own template", async () => {
    const { store, whatsapp, sent } = setup();
    const own = { name: "order_update", language: "en", bodyParams: ["a", "b"] };
    await sendNotice({ store, whatsapp, noticeTemplate: ownerAlert }, { ...alert, template: own }, "quotes");
    expect(sent[0].template).toEqual(own);
  });
});
