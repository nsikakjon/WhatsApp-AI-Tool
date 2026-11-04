// Sends messages through the WhatsApp Cloud API.

import { isPhoneNumber } from "./ids.js";

export interface WhatsAppClient {
  /**
   * Sends a plain text message. Returns WhatsApp's ID for the sent message.
   * `fromNumberId` picks which of our numbers sends it (default: the one in settings).
   */
  sendText(to: string, body: string, fromNumberId?: string): Promise<{ waMessageId: string; raw: unknown }>;
  /**
   * Sends a picture (e.g. a flyer) with an optional caption: uploads it to
   * WhatsApp first, then sends it. Returns WhatsApp's ID for the sent message.
   */
  sendImage(
    to: string,
    image: OutgoingImage,
    fromNumberId?: string,
  ): Promise<{ waMessageId: string; raw: unknown }>;
  /**
   * Sends a pre-approved template message, the only kind WhatsApp delivers
   * more than 24 hours after the person last messaged us.
   */
  sendTemplate(
    to: string,
    template: OutgoingTemplate,
    fromNumberId?: string,
  ): Promise<{ waMessageId: string; raw: unknown }>;
  /**
   * Sends a tappable list: a message with a button that opens up to 10
   * choices. When the person taps one, it comes back as a message whose text
   * is that choice's id (see parse.ts).
   */
  sendList(to: string, list: OutgoingList, fromNumberId?: string): Promise<{ waMessageId: string; raw: unknown }>;
  /**
   * Sends a message with up to 3 buttons under it. A tap comes back like a
   * list choice: a message whose text is the button's id.
   */
  sendButtons(to: string, buttons: OutgoingButtons, fromNumberId?: string): Promise<{ waMessageId: string; raw: unknown }>;
  /**
   * Sends a message with a "Send location" button. The person's pin comes
   * back as an ordinary location message.
   */
  sendLocationRequest(to: string, body: string, fromNumberId?: string): Promise<{ waMessageId: string; raw: unknown }>;
  /**
   * Sends a voice note (OGG with the Opus codec, which WhatsApp plays as a
   * voice message): uploads it, then sends it. Optional, so test fakes and
   * older wrappers without it still work.
   */
  sendAudio?(to: string, audio: OutgoingAudio, fromNumberId?: string): Promise<{ waMessageId: string; raw: unknown }>;
  /**
   * Downloads an attached file (e.g. a voice note) by its WhatsApp media id.
   * `toNumberId` is the number that received it, so its business's key is used.
   */
  downloadMedia(mediaId: string, toNumberId?: string): Promise<{ data: Blob; mimeType: string }>;
}

export interface OutgoingImage {
  data: Uint8Array;
  /** image/jpeg or image/png (the only picture types WhatsApp accepts). */
  mimeType: string;
  caption?: string;
}

export interface OutgoingAudio {
  data: Uint8Array;
  /** audio/ogg (Opus) for a voice note. */
  mimeType: string;
}

export interface OutgoingList {
  /** The message above the button (up to 1024 characters). */
  body: string;
  /** The button's label that opens the list (up to 20 characters). */
  button: string;
  /**
   * The choices, at most 10. `id` comes back as the message text when tapped,
   * so it can simply be the command a person would type (e.g. "design 8").
   * Titles are cut to 24 characters and descriptions to 72.
   */
  rows: Array<{ id: string; title: string; description?: string }>;
}

export interface OutgoingButtons {
  /** A picture on top, which makes the message look like a card. */
  image?: OutgoingImage;
  /** The message above the buttons (up to 1024 characters). */
  body: string;
  /** At most 3. `id` comes back as the message text when tapped; titles are cut to 20 characters. */
  buttons: Array<{ id: string; title: string }>;
}

export interface OutgoingTemplate {
  /** The template's name in WhatsApp Manager, e.g. "birthday_flyer". */
  name: string;
  /** Its language code, e.g. "en". */
  language: string;
  /** A picture for a template with an image header. */
  headerImage?: OutgoingImage;
  /** Values for {{1}}, {{2}}, ... in the template's body, in order. */
  bodyParams: string[];
  /**
   * A Marketing template (a broadcast or a follow-up). It goes through Meta's
   * Marketing Messages API when the number's WhatsApp Business Account has
   * signed up for it, and through the normal send otherwise.
   */
  marketing?: boolean;
}

export interface WhatsAppClientOptions {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
  /**
   * The key a business gave us when it connected its own number on /signup.
   * Numbers without one (ours) use `accessToken`.
   */
  tokenFor?: (phoneNumberId: string) => Promise<string | undefined>;
  /**
   * The WhatsApp Business Account a number belongs to. Only given when
   * MARKETING_MESSAGES_API is on: marketing templates then go through the
   * Marketing Messages API for accounts Meta reports as ONBOARDED.
   */
  marketingAccountFor?: (phoneNumberId: string) => Promise<string | undefined>;
  fetch?: typeof fetch;
  now?: () => number;
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const HOUR = 60 * 60 * 1000;

export function createWhatsAppClient(opts: WhatsAppClientOptions): WhatsAppClient {
  const doFetch = opts.fetch ?? fetch;
  const graph = `https://graph.facebook.com/${opts.graphApiVersion}`;
  const ourAuth = { Authorization: `Bearer ${opts.accessToken}` };
  const now = opts.now ?? Date.now;
  // Meta's answer per account, and templates the Marketing Messages API turned
  // down (e.g. a Utility one), each rechecked after an hour.
  const onboarded = new Map<string, { ready: boolean; at: number }>();
  const refused = new Map<string, number>();

  /** Makes a request with the number's own key, or ours if it has none or Meta no longer takes it. */
  async function authorised(numberId: string | undefined, request: (auth: Record<string, string>) => Promise<Response>) {
    const token = numberId && numberId !== opts.phoneNumberId && opts.tokenFor ? await opts.tokenFor(numberId) : undefined;
    if (token) {
      const auth = { Authorization: `Bearer ${token}` };
      const res = await request(auth);
      // A key the business has since withdrawn: ours still works for numbers in our own Meta account.
      if (res.status !== 401) return { res, auth };
    }
    return { res: await request(ourAuth), auth: ourAuth };
  }

  async function send(
    fromNumberId: string | undefined,
    { to, ...message }: { to: string } & Record<string, unknown>,
    edge: "messages" | "marketing_messages" = "messages",
  ) {
    // A customer with a hidden number is addressed by their user ID, which Meta takes as "recipient".
    const address = isPhoneNumber(to) ? { to } : { recipient: to };
    const url = `${graph}/${fromNumberId || opts.phoneNumberId}/${edge}`;
    const body = JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...address, ...message });
    const { res } = await authorised(fromNumberId, (auth) =>
      doFetch(url, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body }),
    );
    const data = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id: string }>;
      error?: { message?: string; code?: number };
    };
    if (!res.ok) {
      throw Object.assign(new Error(`WhatsApp send failed (${res.status}): ${data.error?.message ?? "unknown error"}`), {
        status: res.status,
      });
    }
    return { waMessageId: data.messages?.[0]?.id ?? "", raw: data as unknown };
  }

  /** The number's account, when Meta says it has signed up for the Marketing Messages API. */
  async function marketingAccount(numberId: string): Promise<string | undefined> {
    const account = await opts.marketingAccountFor?.(numberId);
    if (!account) return undefined;
    let hit = onboarded.get(account);
    if (!hit || now() - hit.at >= HOUR) {
      const { res } = await authorised(numberId, (auth) =>
        doFetch(`${graph}/${encodeURIComponent(account)}?fields=marketing_messages_onboarding_status`, { headers: auth }),
      );
      const data = (await res.json().catch(() => ({}))) as { marketing_messages_onboarding_status?: string };
      hit = { ready: res.ok && data.marketing_messages_onboarding_status === "ONBOARDED", at: now() };
      onboarded.set(account, hit);
    }
    return hit.ready ? account : undefined;
  }

  async function uploadImage(fromNumberId: string | undefined, image: { data: Uint8Array; mimeType: string }): Promise<string> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", image.mimeType);
    const ext = image.mimeType === "image/png" ? "png" : image.mimeType.startsWith("audio/") ? "ogg" : "jpg";
    form.append("file", new Blob([new Uint8Array(image.data)], { type: image.mimeType }), `file.${ext}`);
    const { res } = await authorised(fromNumberId, (auth) =>
      doFetch(`${graph}/${fromNumberId || opts.phoneNumberId}/media`, { method: "POST", headers: auth, body: form }),
    );
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok || !data.id) {
      throw new Error(`WhatsApp upload failed (${res.status}): ${data.error?.message ?? "unknown error"}`);
    }
    return data.id;
  }

  return {
    async sendText(to, body, fromNumberId) {
      return send(fromNumberId, { to, type: "text", text: { preview_url: false, body } });
    },

    async sendImage(to, image, fromNumberId) {
      const mediaId = await uploadImage(fromNumberId, image);
      return send(fromNumberId, {
        to,
        type: "image",
        image: image.caption ? { id: mediaId, caption: image.caption } : { id: mediaId },
      });
    },

    async sendAudio(to, audio, fromNumberId) {
      const mediaId = await uploadImage(fromNumberId, audio);
      return send(fromNumberId, { to, type: "audio", audio: { id: mediaId } });
    },

    async sendTemplate(to, template, fromNumberId) {
      const components: unknown[] = [];
      if (template.headerImage) {
        const mediaId = await uploadImage(fromNumberId, template.headerImage);
        components.push({ type: "header", parameters: [{ type: "image", image: { id: mediaId } }] });
      }
      if (template.bodyParams.length) {
        components.push({
          type: "body",
          // WhatsApp rejects template values containing line breaks or tabs.
          parameters: template.bodyParams.map((text) => ({ type: "text", text: text.replace(/\s+/g, " ").trim() })),
        });
      }
      const message = {
        to,
        type: "template",
        template: { name: template.name, language: { code: template.language }, components },
      };
      const numberId = fromNumberId || opts.phoneNumberId;
      const account = template.marketing ? await marketingAccount(numberId).catch(() => undefined) : undefined;
      const key = `${account}/${template.name}`;
      const refusedAt = refused.get(key);
      if (account && (refusedAt === undefined || now() - refusedAt >= HOUR)) {
        try {
          return await send(fromNumberId, message, "marketing_messages");
        } catch (err) {
          // Meta turned the message down, so nothing went out: send it the normal way.
          // A busy or unreachable Meta is left to the usual retry instead.
          const status = (err as { status?: number }).status;
          if (!status || status === 408 || status === 429 || status >= 500) throw err;
          refused.set(key, now());
          console.warn(`Marketing Messages API refused ${template.name} (${String(err)}); sending through the Cloud API`);
        }
      }
      return send(fromNumberId, message);
    },

    async sendList(to, list, fromNumberId) {
      const rows = list.rows.slice(0, 10).map((r) => ({
        id: r.id.slice(0, 200),
        title: cut(r.title, 24),
        ...(r.description ? { description: cut(r.description, 72) } : {}),
      }));
      return send(fromNumberId, {
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: cut(list.body, 1024) },
          action: { button: cut(list.button, 20), sections: [{ title: cut(list.button, 24), rows }] },
        },
      });
    },

    async sendButtons(to, message, fromNumberId) {
      const header = message.image ? { header: { type: "image", image: { id: await uploadImage(fromNumberId, message.image) } } } : {};
      return send(fromNumberId, {
        to,
        type: "interactive",
        interactive: {
          type: "button",
          ...header,
          body: { text: cut(message.body, 1024) },
          action: {
            buttons: message.buttons
              .slice(0, 3)
              .map((b) => ({ type: "reply", reply: { id: b.id.slice(0, 256), title: cut(b.title, 20) } })),
          },
        },
      });
    },

    async sendLocationRequest(to, body, fromNumberId) {
      return send(fromNumberId, {
        to,
        type: "interactive",
        interactive: { type: "location_request_message", body: { text: cut(body, 1024) }, action: { name: "send_location" } },
      });
    },

    async downloadMedia(mediaId, toNumberId) {
      // Step 1: ask Meta where the file is. Step 2: fetch it (the link needs the same key).
      const { res: infoRes, auth } = await authorised(toNumberId, (a) =>
        doFetch(`${graph}/${encodeURIComponent(mediaId)}`, { headers: a }),
      );
      const info = (await infoRes.json().catch(() => ({}))) as { url?: string; mime_type?: string };
      if (!infoRes.ok || !info.url) {
        throw new Error(`WhatsApp media lookup failed (${infoRes.status})`);
      }
      const fileRes = await doFetch(info.url, { headers: auth });
      if (!fileRes.ok) throw new Error(`WhatsApp media download failed (${fileRes.status})`);
      return { data: await fileRes.blob(), mimeType: info.mime_type ?? "application/octet-stream" };
    },
  };
}
