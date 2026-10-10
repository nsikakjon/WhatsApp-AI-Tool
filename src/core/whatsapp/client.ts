// Sends messages through the WhatsApp Cloud API.

export interface WhatsAppClient {
  /**
   * Sends a plain text message. Returns WhatsApp's ID for the sent message.
   * `fromNumberId` picks which of our numbers sends it (default: the one in settings).
   */
  sendText(to: string, body: string, fromNumberId?: string): Promise<{ waMessageId: string; raw: unknown }>;
  /** Downloads an attached file (e.g. a voice note) by its WhatsApp media id. */
  downloadMedia(mediaId: string): Promise<{ data: Blob; mimeType: string }>;
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

  return {
    async sendText(to, body, fromNumberId) {
      const url = `${graph}/${fromNumberId || opts.phoneNumberId}/messages`;
      const res = await doFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { preview_url: false, body },
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id: string }>;
        error?: { message?: string; code?: number };
      };
      if (!res.ok) {
        throw new Error(
          `WhatsApp send failed (${res.status}): ${data.error?.message ?? "unknown error"}`,
        );
      }
      return { waMessageId: data.messages?.[0]?.id ?? "", raw: data };
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
