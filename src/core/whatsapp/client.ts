// Sends messages through the WhatsApp Cloud API.

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
  /** Downloads an attached file (e.g. a voice note) by its WhatsApp media id. */
  downloadMedia(mediaId: string): Promise<{ data: Blob; mimeType: string }>;
}

export interface OutgoingImage {
  data: Uint8Array;
  /** image/jpeg or image/png (the only picture types WhatsApp accepts). */
  mimeType: string;
  caption?: string;
}

export interface WhatsAppClientOptions {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
  fetch?: typeof fetch;
}

export function createWhatsAppClient(opts: WhatsAppClientOptions): WhatsAppClient {
  const doFetch = opts.fetch ?? fetch;
  const graph = `https://graph.facebook.com/${opts.graphApiVersion}`;
  const auth = { Authorization: `Bearer ${opts.accessToken}` };

  async function send(fromNumberId: string | undefined, message: Record<string, unknown>) {
    const url = `${graph}/${fromNumberId || opts.phoneNumberId}/messages`;
    const res = await doFetch(url, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...message }),
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

  return {
    async sendText(to, body, fromNumberId) {
      return send(fromNumberId, { to, type: "text", text: { preview_url: false, body } });
    },

    async sendImage(to, image, fromNumberId) {
      const number = fromNumberId || opts.phoneNumberId;
      const form = new FormData();
      form.append("messaging_product", "whatsapp");
      form.append("type", image.mimeType);
      const ext = image.mimeType === "image/png" ? "png" : "jpg";
      form.append("file", new Blob([new Uint8Array(image.data)], { type: image.mimeType }), `image.${ext}`);
      const upRes = await doFetch(`${graph}/${number}/media`, { method: "POST", headers: auth, body: form });
      const up = (await upRes.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      if (!upRes.ok || !up.id) {
        throw new Error(`WhatsApp image upload failed (${upRes.status}): ${up.error?.message ?? "unknown error"}`);
      }
      return send(number, {
        to,
        type: "image",
        image: image.caption ? { id: up.id, caption: image.caption } : { id: up.id },
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
