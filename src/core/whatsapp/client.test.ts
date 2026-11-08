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

  it("sends from a connected business's number with that business's own key", async () => {
    const used: Array<{ url: string; auth: string }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string>).Authorization!;
      used.push({ url, auth });
      if (auth === "Bearer WITHDRAWN") return new Response(JSON.stringify({ error: { message: "Session expired" } }), { status: 401 });
      if (url.endsWith("/MEDIA1")) return new Response(JSON.stringify({ url: "https://lookaside.example/file", mime_type: "image/jpeg" }));
      if (url.startsWith("https://lookaside")) return new Response("jpeg");
      return new Response(JSON.stringify({ messages: [{ id: "wamid.sent" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const keys: Record<string, string> = { CLIENT: "CLIENT_KEY", OLD: "WITHDRAWN" };
    const client = createWhatsAppClient({
      accessToken: "OURS",
      phoneNumberId: "PNID",
      graphApiVersion: "v23.0",
      tokenFor: async (id) => keys[id],
      fetch: fakeFetch,
    });

    await client.sendText("2348012345678", "Hi", "CLIENT");
    await client.sendText("2348012345678", "Hi", "ANOTHER_OF_OURS");
    await client.sendText("2348012345678", "Hi");
    expect(used.map((u) => u.auth)).toEqual(["Bearer CLIENT_KEY", "Bearer OURS", "Bearer OURS"]);

    used.length = 0;
    await client.sendText("2348012345678", "Hi", "OLD");
    expect(used.map((u) => u.auth)).toEqual(["Bearer WITHDRAWN", "Bearer OURS"]);

    used.length = 0;
    await client.downloadMedia("MEDIA1", "CLIENT");
    expect(used.map((u) => u.auth)).toEqual(["Bearer CLIENT_KEY", "Bearer CLIENT_KEY"]);
  });

  it("addresses a customer with a hidden number by their user ID", async () => {
    let sentBody: Record<string, unknown> = {};
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ messages: [{ id: "wamid.sent" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createWhatsAppClient({ accessToken: "T", phoneNumberId: "PNID", graphApiVersion: "v23.0", fetch: fakeFetch });

    await client.sendText("NG.1349120865530274", "Hi");
    expect(sentBody).toMatchObject({ recipient: "NG.1349120865530274", type: "text" });
    expect(sentBody).not.toHaveProperty("to");
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

  it("sends up to three reply buttons and a location request", async () => {
    const bodies: unknown[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ messages: [{ id: "wamid.b" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createWhatsAppClient({ accessToken: "T", phoneNumberId: "PNID", graphApiVersion: "v23.0", fetch: fakeFetch });
    const buttons = ["picked 1001", "delivered 1001", "failed 1001", "extra"].map((id) => ({ id, title: `${id} with a long title` }));
    await client.sendButtons("2348012345678", { body: "New delivery", buttons });
    await client.sendLocationRequest("2348012345678", "Where should we deliver?");

    const [sentButtons, sentRequest] = bodies as Array<{ interactive: Record<string, any> }>;
    expect(sentButtons!.interactive.type).toBe("button");
    expect(sentButtons!.interactive.action.buttons).toHaveLength(3);
    expect(sentButtons!.interactive.action.buttons[0]).toEqual({ type: "reply", reply: { id: "picked 1001", title: "picked 1001 with a …" } });
    expect(sentRequest!.interactive).toEqual({
      type: "location_request_message",
      body: { text: "Where should we deliver?" },
      action: { name: "send_location" },
    });
  });

  it("sends a button that opens a web page", async () => {
    const bodies: unknown[] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ messages: [{ id: "wamid.l" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createWhatsAppClient({ accessToken: "T", phoneNumberId: "PNID", graphApiVersion: "v23.0", fetch: fakeFetch });
    await client.sendLink("2348012345678", "Ada would like to talk to someone.", { label: "Open chat in your inbox", url: "https://app.yarnoga.com/home/inbox/c1" });

    const [sent] = bodies as Array<{ interactive: Record<string, any> }>;
    expect(sent!.interactive).toEqual({
      type: "cta_url",
      body: { text: "Ada would like to talk to someone." },
      action: { name: "cta_url", parameters: { display_text: "Open chat in your i…", url: "https://app.yarnoga.com/home/inbox/c1" } },
    });
  });

  it("puts a card's picture on top of its buttons", async () => {
    const bodies: unknown[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      if (url.endsWith("/media")) return new Response(JSON.stringify({ id: "media-5" }), { status: 200 });
      bodies.push(JSON.parse(init.body as string));
      return new Response(JSON.stringify({ messages: [{ id: "wamid.c" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createWhatsAppClient({ accessToken: "T", phoneNumberId: "PNID", graphApiVersion: "v23.0", fetch: fakeFetch });
    await client.sendButtons("2348012345678", {
      image: { data: new Uint8Array([1]), mimeType: "image/jpeg" },
      body: "*Mugs*",
      buttons: [{ id: "I'd like Mugs", title: "Order this" }],
    });

    const [sent] = bodies as Array<{ interactive: Record<string, any> }>;
    expect(sent!.interactive.header).toEqual({ type: "image", image: { id: "media-5" } });
    expect(sent!.interactive.body).toEqual({ text: "*Mugs*" });
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

  describe("marketing templates", () => {
    const offer = { name: "business_offer", language: "en", bodyParams: ["Ada Prints", "10% off"], marketing: true };

    function setup(status: string, opts: { marketingStatus?: number; accounts?: Record<string, string> } = {}) {
      const calls: string[] = [];
      let clock = 0;
      const fakeFetch = (async (url: string) => {
        calls.push(url.replace("https://graph.facebook.com/v23.0/", ""));
        if (url.includes("fields=marketing_messages_onboarding_status")) {
          return new Response(JSON.stringify({ marketing_messages_onboarding_status: status }));
        }
        if (url.endsWith("/marketing_messages") && opts.marketingStatus) {
          return new Response(JSON.stringify({ error: { message: "Template is not a marketing template" } }), {
            status: opts.marketingStatus,
          });
        }
        return new Response(JSON.stringify({ messages: [{ id: "wamid.sent" }] }));
      }) as unknown as typeof fetch;
      const accounts = opts.accounts ?? { PNID: "WABA1" };
      const client = createWhatsAppClient({
        accessToken: "OURS",
        phoneNumberId: "PNID",
        graphApiVersion: "v23.0",
        marketingAccountFor: async (id) => accounts[id],
        fetch: fakeFetch,
        now: () => clock,
      });
      return { client, calls, later: (ms: number) => (clock += ms) };
    }

    it("go through the Marketing Messages API once the account is onboarded, checking Meta once an hour", async () => {
      const { client, calls, later } = setup("ONBOARDED");
      await client.sendTemplate("2348012345678", offer);
      await client.sendTemplate("2348012345678", offer);
      expect(calls).toEqual([
        "WABA1?fields=marketing_messages_onboarding_status",
        "PNID/marketing_messages",
        "PNID/marketing_messages",
      ]);
      later(60 * 60 * 1000);
      await client.sendTemplate("2348012345678", offer);
      expect(calls.slice(3)).toEqual(["WABA1?fields=marketing_messages_onboarding_status", "PNID/marketing_messages"]);
    });

    it("use the normal send when the account isn't onboarded, the number's account is unknown, or the template isn't marketing", async () => {
      const notYet = setup("ELIGIBLE");
      await notYet.client.sendTemplate("2348012345678", offer);
      expect(notYet.calls).toEqual(["WABA1?fields=marketing_messages_onboarding_status", "PNID/messages"]);

      const unknown = setup("ONBOARDED", { accounts: {} });
      await unknown.client.sendTemplate("2348012345678", offer, "OTHER");
      expect(unknown.calls).toEqual(["OTHER/messages"]);

      const utility = setup("ONBOARDED");
      await utility.client.sendTemplate("2348012345678", { ...offer, marketing: false });
      expect(utility.calls).toEqual(["PNID/messages"]);
    });

    it("fall back to the normal send when Meta turns one down, and stop trying that template for an hour", async () => {
      const { client, calls, later } = setup("ONBOARDED", { marketingStatus: 400 });
      const sent = await client.sendTemplate("2348012345678", offer);
      expect(sent.waMessageId).toBe("wamid.sent");
      await client.sendTemplate("2348012345678", offer);
      expect(calls).toEqual([
        "WABA1?fields=marketing_messages_onboarding_status",
        "PNID/marketing_messages",
        "PNID/messages",
        "PNID/messages",
      ]);
      later(60 * 60 * 1000);
      await client.sendTemplate("2348012345678", offer);
      expect(calls.slice(4)).toEqual([
        "WABA1?fields=marketing_messages_onboarding_status",
        "PNID/marketing_messages",
        "PNID/messages",
      ]);
    });

    it("leave a busy Meta to the usual retry instead of sending twice", async () => {
      const { client, calls } = setup("ONBOARDED", { marketingStatus: 503 });
      await expect(client.sendTemplate("2348012345678", offer)).rejects.toMatchObject({ status: 503 });
      expect(calls.at(-1)).toBe("PNID/marketing_messages");
    });
  });
});
