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

  it("downloads media in two steps, sending the token both times", async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, auth: (init.headers as Record<string, string>).Authorization });
      if (url.endsWith("/media-1")) {
        return new Response(JSON.stringify({ url: "https://lookaside.example/file", mime_type: "audio/ogg" }), { status: 200 });
      }
      return new Response("AUDIO", { status: 200 });
    }) as unknown as typeof fetch;

    const client = createWhatsAppClient({ accessToken: "TOKEN", phoneNumberId: "PNID", graphApiVersion: "v23.0", fetch: fakeFetch });
    const media = await client.downloadMedia("media-1");

    expect(calls.map((c) => c.url)).toEqual(["https://graph.facebook.com/v23.0/media-1", "https://lookaside.example/file"]);
    expect(calls.every((c) => c.auth === "Bearer TOKEN")).toBe(true);
    expect(media.mimeType).toBe("audio/ogg");
    expect(await media.data.text()).toBe("AUDIO");
  });
});
