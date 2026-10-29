// Sends one email through Resend (resend.com), the service the alerts already
// use. The idempotency key means a retry after a timeout never sends twice.

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** One-click unsubscribe address, put in the List-Unsubscribe header Gmail and Yahoo ask for. */
  unsubscribeUrl: string;
  idempotencyKey: string;
}

/** Resend refused this email for good (e.g. a malformed address): trying again won't help. */
export class EmailRejected extends Error {}

export type EmailSender = (email: OutgoingEmail) => Promise<string>;

export function resendSender(opts: { apiKey: string; from: string; replyTo: string; fetch?: typeof fetch }): EmailSender {
  const doFetch = opts.fetch ?? fetch;
  return async (email) => {
    const res = await doFetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": email.idempotencyKey.slice(0, 256),
      },
      body: JSON.stringify({
        from: opts.from,
        to: [email.to],
        reply_to: opts.replyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: {
          "List-Unsubscribe": `<${email.unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const message = `Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`;
      // 401/403 is our key, 429 is too many at once: both are worth trying again later.
      throw res.status === 400 || res.status === 422 ? new EmailRejected(message) : new Error(message);
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    return body.id ?? "";
  };
}
