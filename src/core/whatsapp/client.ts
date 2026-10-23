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
  /** Downloads an attached file (e.g. a voice note) by its WhatsApp media id. */
  downloadMedia(mediaId: string): Promise<{ data: Blob; mimeType: string }>;
}

export interface OutgoingImage {
  data: Uint8Array;
  /** image/jpeg or image/png (the only picture types WhatsApp accepts). */
  mimeType: string;
  caption?: string;
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
}

export interface WhatsAppClientOptions {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
  fetch?: typeof fetch;
}

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export function createWhatsAppClient(opts: WhatsAppClientOptions): WhatsAppClient {
  const doFetch = opts.fetch ?? fetch;
  const graph = `https://graph.facebook.com/${opts.graphApiVersion}`;
  const auth = { Authorization: `Bearer ${opts.accessToken}` };

  async function send(fromNumberId: string | undefined, { to, ...message }: { to: string } & Record<string, unknown>) {
    // A customer with a hidden number is addressed by their user ID, which Meta takes as "recipient".
    const address = isPhoneNumber(to) ? { to } : { recipient: to };
    const url = `${graph}/${fromNumberId || opts.phoneNumberId}/messages`;
    const res = await doFetch(url, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...address, ...message }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      messages?: Array<{ id: string }>;
      error?: { message?: string; code?: number };
    };
    if (!res.ok) {
      throw new Error(`WhatsApp send failed (${res.status}): ${data.error?.message ?? "unknown error"}`);
    }
    return { waMessageId: data.messages?.[0]?.id ?? "", raw: data as unknown };
  }

  async function uploadImage(fromNumberId: string | undefined, image: OutgoingImage): Promise<string> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", image.mimeType);
    const ext = image.mimeType === "image/png" ? "png" : "jpg";
    form.append("file", new Blob([new Uint8Array(image.data)], { type: image.mimeType }), `image.${ext}`);
    const res = await doFetch(`${graph}/${fromNumberId || opts.phoneNumberId}/media`, {
      method: "POST",
      headers: auth,
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
    if (!res.ok || !data.id) {
      throw new Error(`WhatsApp image upload failed (${res.status}): ${data.error?.message ?? "unknown error"}`);
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
      return send(fromNumberId, {
        to,
        type: "template",
        template: { name: template.name, language: { code: template.language }, components },
      });
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
      return send(fromNumberId, {
        to,
        type: "interactive",
        interactive: {
          type: "button",
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

    async downloadMedia(mediaId) {
      // Step 1: ask Meta where the file is. Step 2: fetch it (the link needs the token too).
      const infoRes = await doFetch(`${graph}/${encodeURIComponent(mediaId)}`, { headers: auth });
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
