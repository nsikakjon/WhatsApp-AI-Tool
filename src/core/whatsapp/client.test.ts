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

    await client.sendText("2348012345678", "Hi", "OTHER_PNID");
    expect(captured?.url).toBe("https://graph.facebook.com/v23.0/OTHER_PNID/messages");
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

  it("uploads a picture, then sends it with its caption", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body });
      if (url.endsWith("/media")) return new Response(JSON.stringify({ id: "media-9" }), { status: 200 });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.img" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createWhatsAppClient({ accessToken: "TOKEN", phoneNumberId: "PNID", graphApiVersion: "v23.0", fetch: fakeFetch });

    const result = await client.sendImage("2348012345678", { data: new Uint8Array([1, 2]), mimeType: "image/jpeg", caption: "Hi" }, "OTHER");

    expect(result.waMessageId).toBe("wamid.img");
    expect(calls.map((c) => c.url)).toEqual([
      "https://graph.facebook.com/v23.0/OTHER/media",
      "https://graph.facebook.com/v23.0/OTHER/messages",
    ]);
    const form = calls[0]!.body as FormData;
    expect(form.get("messaging_product")).toBe("whatsapp");
    expect((form.get("file") as Blob).size).toBe(2);
    expect(JSON.parse(calls[1]!.body as string)).toMatchObject({
      to: "2348012345678",
      type: "image",
      image: { id: "media-9", caption: "Hi" },
    });
  });

  it("uploads a file, then sends it with its name and caption", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body });
      if (url.endsWith("/media")) return new Response(JSON.stringify({ id: "media-3" }), { status: 200 });
      return new Response(JSON.stringify({ messages: [{ id: "wamid.doc" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createWhatsAppClient({ accessToken: "TOKEN", phoneNumberId: "PNID", graphApiVersion: "v23.0", fetch: fakeFetch });

    const doc = { data: new Uint8Array([1, 2, 3]), mimeType: "application/pdf", filename: "Report.pdf", caption: "Today" };
    const result = await client.sendDocument("2348012345678", doc);

    expect(result.waMessageId).toBe("wamid.doc");
    const form = calls[0]!.body as FormData;
    expect(form.get("type")).toBe("application/pdf");
    expect((form.get("file") as File).name).toBe("Report.pdf");
    expect(JSON.parse(calls[1]!.body as string)).toMatchObject({
      type: "document",
      document: { id: "media-3", filename: "Report.pdf", caption: "Today" },
    });
  });

  it("sends a template with a picture header and body values", async () => {
    const bodies: unknown[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      if (url.endsWith("/media")) return new Response(JSON.stringify({ id: "media-7" }), { status: 200 });
      bodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ messages: [{ id: "wamid.t" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createWhatsAppClient({ accessToken: "TOKEN", phoneNumberId: "PNID", graphApiVersion: "v23.0", fetch: fakeFetch });

    await client.sendTemplate("234", {
      name: "birthday_flyer",
      language: "en",
      headerImage: { data: new Uint8Array([1]), mimeType: "image/jpeg" },
      bodyParams: ["Ada", "Happy\nbirthday"],
    });

    expect(bodies[0]).toMatchObject({
      to: "234",
      type: "template",
      template: {
        name: "birthday_flyer",
        language: { code: "en" },
        components: [
          { type: "header", parameters: [{ type: "image", image: { id: "media-7" } }] },
          { type: "body", parameters: [{ type: "text", text: "Ada" }, { type: "text", text: "Happy birthday" }] },
        ],
      },
    });
  });

  it("sends a list of choices, cutting titles to WhatsApp's limits", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ messages: [{ id: "wamid.list" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createWhatsAppClient({ accessToken: "T", phoneNumberId: "PNID", graphApiVersion: "v23.0", fetch: fakeFetch });
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `design ${i + 1}`, title: `${i + 1}. A very long design name here`, description: "Standard plan" }));
    const result = await client.sendList("2348012345678", { body: "Pick a design", button: "See designs", rows });

    expect(result.waMessageId).toBe("wamid.list");
    const sent = JSON.parse(captured?.init.body as string);
    expect(sent).toMatchObject({ type: "interactive", interactive: { type: "list", body: { text: "Pick a design" } } });
    expect(sent.interactive.action.button).toBe("See designs");
    const sentRows = sent.interactive.action.sections[0].rows;
    expect(sentRows).toHaveLength(10);
    expect(sentRows[0]).toEqual({ id: "design 1", title: "1. A very long design n…", description: "Standard plan" });
    expect(sentRows[0].title.length).toBe(24);
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
