// Sends messages through the WhatsApp Cloud API.

export interface WhatsAppClient {
  /** Sends a plain text message. Returns WhatsApp's ID for the sent message. */
  sendText(to: string, body: string): Promise<{ waMessageId: string; raw: unknown }>;
}

export interface WhatsAppClientOptions {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
  fetch?: typeof fetch;
}

export function createWhatsAppClient(opts: WhatsAppClientOptions): WhatsAppClient {
  const doFetch = opts.fetch ?? fetch;
  const url = `https://graph.facebook.com/${opts.graphApiVersion}/${opts.phoneNumberId}/messages`;

  return {
    async sendText(to, body) {
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
  };
}
