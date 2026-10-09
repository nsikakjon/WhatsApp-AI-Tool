import { describe, expect, it } from "vitest";
import { createWhatsAppClient } from "./client.js";

describe("WhatsApp client", () => {
  it("posts a text message to the Cloud API and returns the message id", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ messages: [{ id: "wamid.sent" }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = createWhatsAppClient({
      accessToken: "TOKEN",
      phoneNumberId: "PNID",
      graphApiVersion: "v23.0",
      fetch: fakeFetch,
    });
    const result = await client.sendText("2348012345678", "Hi");

    expect(result.waMessageId).toBe("wamid.sent");
    expect(captured?.url).toBe("https://graph.facebook.com/v23.0/PNID/messages");
    expect((captured?.init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN");
    expect(JSON.parse(captured?.init.body as string)).toMatchObject({
      messaging_product: "whatsapp",
      to: "2348012345678",
      type: "text",
      text: { body: "Hi" },
    });
  });

  it("throws with Meta's error message when the send fails", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ error: { message: "Invalid OAuth access token" } }), {
        status: 401,
      })) as unknown as typeof fetch;
    const client = createWhatsAppClient({
      accessToken: "BAD",
      phoneNumberId: "PNID",
      graphApiVersion: "v23.0",
      fetch: fakeFetch,
    });
    await expect(client.sendText("1", "x")).rejects.toThrow("Invalid OAuth access token");
  });
});
