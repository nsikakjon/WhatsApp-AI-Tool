// The two Marketing templates broadcasts are sent with (docs/BROADCASTS.md),
// made in a business's own WhatsApp account when it connects. Templates
// belong to one WhatsApp account, so a shop that connected its own number
// needs its own copies; our numbers have them made by hand in WhatsApp Manager.

export interface TemplateApp {
  appId: string;
  appSecret: string;
  graphApiVersion: string;
}

export interface BroadcastTemplates {
  /** Language code, e.g. "en". */
  language: string;
  text: string;
  /** Left out when broadcasts go without a picture. */
  image?: string;
}

/** A connected number's account and the key it gave us. */
export interface ConnectedAccount {
  phoneNumberId: string;
  wabaId: string;
  token: string;
}

export interface AccountDirectory {
  get(phoneNumberId: string): Promise<ConnectedAccount | null>;
  list(): Promise<ConnectedAccount[]>;
}

/** The picture Meta shows its reviewers on the template with a picture header. */
export interface SampleImage {
  data: Uint8Array;
  mimeType: string;
}

export interface TemplateProvisionerOptions {
  app: TemplateApp;
  templates: BroadcastTemplates;
  accounts: AccountDirectory;
  sample(): Promise<SampleImage>;
  fetch?: typeof fetch;
  now?: () => number;
  log?: Pick<Console, "info" | "error">;
}

export interface TemplateProvisioner {
  /** Makes whichever of the templates the account is missing. Templates Meta rejected are left alone. */
  ensure(account: ConnectedAccount): Promise<void>;
  /** Whether the picture template (else the text one) is approved on this number's account. True for numbers that weren't connected on /signup. */
  ready(phoneNumberId: string): Promise<boolean>;
  /** Runs ensure for every connected number, one after another. */
  sweep(): Promise<void>;
}

// Words and button are the ones in docs/BROADCASTS.md; the button's text is what the bot reads as "stop".
const BODY = "Hello! Here's an update from {{1}}:\n\n{{2}}\n\nReply STOP to stop these messages.";
const BODY_EXAMPLE = ["Mama Cakes", "This week only: 10% off all birthday cakes. Message us to order."];
const STOP_BUTTON = "Stop promotions";
const TEN_MINUTES = 10 * 60_000;

export function createTemplateProvisioner(opts: TemplateProvisionerOptions): TemplateProvisioner {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? console;
  const graph = `https://graph.facebook.com/${opts.app.graphApiVersion}`;
  const names = [opts.templates.text, ...(opts.templates.image ? [opts.templates.image] : [])];
  const checked = new Map<string, { approved: boolean; at: number }>();

  async function json<T>(res: Response, what: string): Promise<T> {
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new Error(`${what} failed (${res.status}): ${data.error?.message ?? "unknown error"}`);
    return data;
  }

  /** Status of each template this account already has, by name. */
  async function statuses(account: ConnectedAccount): Promise<Map<string, string>> {
    const found = new Map<string, string>();
    for (const name of names) {
      const url = `${graph}/${encodeURIComponent(account.wabaId)}/message_templates?fields=name,status,language&name=${encodeURIComponent(name)}&limit=50`;
      const data = await json<{ data?: Array<{ name: string; status: string; language: string }> }>(
        await doFetch(url, { headers: { Authorization: `Bearer ${account.token}` } }),
        "Reading the message templates",
      );
      const row = (data.data ?? []).find((t) => t.name === name && t.language === opts.templates.language);
      if (row) found.set(name, row.status);
    }
    return found;
  }

  /** Meta's upload for a template's sample picture; returns the handle the template is made with. */
  async function uploadSample(): Promise<string> {
    const image = await opts.sample();
    const auth = { Authorization: `OAuth ${opts.app.appId}|${opts.app.appSecret}` };
    const start = new URL(`${graph}/${opts.app.appId}/uploads`);
    start.searchParams.set("file_length", String(image.data.byteLength));
    start.searchParams.set("file_type", image.mimeType);
    start.searchParams.set("file_name", "sample.jpg");
    const session = await json<{ id?: string }>(await doFetch(start, { method: "POST", headers: auth }), "Starting the sample picture upload");
    if (!session.id) throw new Error("Starting the sample picture upload failed: Meta returned no upload id");
    const done = await json<{ h?: string }>(
      await doFetch(`${graph}/${session.id}`, { method: "POST", headers: { ...auth, file_offset: "0" }, body: new Uint8Array(image.data) }),
      "Uploading the sample picture",
    );
    if (!done.h) throw new Error("Uploading the sample picture failed: Meta returned no handle");
    return done.h;
  }

  async function create(account: ConnectedAccount, name: string, withImage: boolean) {
    const components: unknown[] = [];
    if (withImage) components.push({ type: "HEADER", format: "IMAGE", example: { header_handle: [await uploadSample()] } });
    components.push(
      { type: "BODY", text: BODY, example: { body_text: [BODY_EXAMPLE] } },
      { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: STOP_BUTTON }] },
    );
    await json(
      await doFetch(`${graph}/${encodeURIComponent(account.wabaId)}/message_templates`, {
        method: "POST",
        headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name, language: opts.templates.language, category: "MARKETING", components }),
      }),
      `Making the ${name} template`,
    );
    log.info(`Made the ${name} template on account ${account.wabaId}`);
  }

  async function ensure(account: ConnectedAccount) {
    const have = await statuses(account);
    for (const name of names) {
      const status = have.get(name);
      if (!status) {
        await create(account, name, name === opts.templates.image).catch((err) => log.error(`Account ${account.wabaId}:`, err));
      } else if (status !== "APPROVED" && status !== "PENDING") {
        // Meta turned it down or paused it: making it again under the same name would be refused, so it needs a person.
        log.error(`The ${name} template on account ${account.wabaId} is ${status}`);
      }
    }
    checked.set(account.phoneNumberId, { approved: names.every((n) => have.get(n) === "APPROVED"), at: now() });
  }

  return {
    ensure,

    async ready(phoneNumberId) {
      const hit = checked.get(phoneNumberId);
      if (hit && now() - hit.at < TEN_MINUTES) return hit.approved;
      const account = await opts.accounts.get(phoneNumberId);
      if (!account) return true;
      try {
        const have = await statuses(account);
        const approved = names.every((n) => have.get(n) === "APPROVED");
        checked.set(phoneNumberId, { approved, at: now() });
        return approved;
      } catch (err) {
        // Don't hide sending because Meta didn't answer; a broadcast that can't go out says so itself.
        log.error(`Couldn't check the templates on ${phoneNumberId}:`, err);
        return hit?.approved ?? true;
      }
    },

    async sweep() {
      for (const account of await opts.accounts.list()) {
        await ensure(account).catch((err) => log.error(`Couldn't check the templates on account ${account.wabaId}:`, err));
      }
    },
  };
}
