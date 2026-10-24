// The Meta (Graph API) calls that finish connecting a number after someone
// completes the sign-up pop-up.

export interface MetaApp {
  appId: string;
  appSecret: string;
  graphApiVersion: string;
}

interface GraphError {
  error?: { message?: string };
}

async function graphJson<T>(res: Response, what: string): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & GraphError;
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${data.error?.message ?? "unknown error"}`);
  return data;
}

/**
 * Swaps the one-time code from the pop-up for the business's access token.
 * The code only works once and only for a short while.
 */
export async function exchangeCode(doFetch: typeof fetch, app: MetaApp, code: string): Promise<string> {
  const url = new URL(`https://graph.facebook.com/${app.graphApiVersion}/oauth/access_token`);
  url.searchParams.set("client_id", app.appId);
  url.searchParams.set("client_secret", app.appSecret);
  url.searchParams.set("code", code);
  const data = await graphJson<{ access_token?: string }>(await doFetch(url), "Exchanging the sign-up code");
  if (!data.access_token) throw new Error("Exchanging the sign-up code failed: Meta returned no token");
  return data.access_token;
}

/** Tells Meta to send this WhatsApp account's messages to our webhook. */
export async function subscribeApp(doFetch: typeof fetch, app: MetaApp, wabaId: string, token: string) {
  const res = await doFetch(
    `https://graph.facebook.com/${app.graphApiVersion}/${encodeURIComponent(wabaId)}/subscribed_apps`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  await graphJson(res, "Connecting the WhatsApp account to the bot");
}

/** The number as people see it and its display name, for the confirmation screen. */
export async function phoneDetails(
  doFetch: typeof fetch,
  app: MetaApp,
  phoneNumberId: string,
  token: string,
): Promise<{ displayNumber?: string; verifiedName?: string }> {
  const url = `https://graph.facebook.com/${app.graphApiVersion}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`;
  const data = await graphJson<{ display_phone_number?: string; verified_name?: string }>(
    await doFetch(url, { headers: { Authorization: `Bearer ${token}` } }),
    "Reading the phone number",
  );
  return { displayNumber: data.display_phone_number, verifiedName: data.verified_name };
}

/**
 * Puts a brand-new number on the Cloud API. Numbers that stay in the WhatsApp
 * Business app (coexistence) must skip this. The PIN becomes the number's
 * two-step verification PIN.
 */
export async function registerNumber(doFetch: typeof fetch, app: MetaApp, phoneNumberId: string, token: string, pin: string) {
  const res = await doFetch(`https://graph.facebook.com/${app.graphApiVersion}/${encodeURIComponent(phoneNumberId)}/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
  await graphJson(res, "Registering the number");
}
