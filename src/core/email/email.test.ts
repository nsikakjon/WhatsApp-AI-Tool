import { describe, expect, it } from "vitest";
import type { ProductContext } from "../product.js";
import type { IncomingMessage } from "../whatsapp/types.js";
import { HOW_TO_ANSWER, createEmailAsker, emailIn, likelyTypo, withEmailReplies } from "./ask.js";
import { renderEmail } from "./layout.js";
import { EmailRejected, resendSender, type OutgoingEmail } from "./resend.js";
import { createEmailRoutes, emailLinks } from "./routes.js";
import { firstNameOf, sendDueEmails, type AccountFacts, type Series } from "./series.js";
import { createEmailSettings } from "./settings.js";
import { memoryEmails } from "./store.js";

const silent = { info() {}, error() {} };
const SECRET = "app-secret";
const links = emailLinks(SECRET, "https://app.yarnoga.com");

const msg = (text: string, from = "2348011111111"): IncomingMessage => ({
  waMessageId: `m-${Math.random()}`,
  from,
  contactName: "Nsikak John",
  type: "text",
  text,
  timestamp: 0,
  raw: {},
});
const ctx = (said: string[] = []): ProductContext => ({
  contactId: "contact",
  history: said.map((text) => ({ direction: "outbound" as const, text })),
  downloadMedia: async () => ({ data: new Blob([]), mimeType: "text/plain" }),
  sendLater: async () => {},
  canMessageFreely: async () => true,
});
const bot = { name: "bot", handle: async () => ({ text: "from the bot" }) };

describe("email layout", () => {
  it("keeps the approved look and escapes what it's given", () => {
    const { html, text } = renderEmail(
      {
        eyebrow: "Quotes and orders",
        subject: "Your yarnOga assistant is ready",
        preview: "Three things",
        hero: "welcome",
        blocks: ["Hi <Ada>, send *prices*.", { steps: [["Check", "your list"]] }, { list: ["one"] }, { note: ["Worth knowing:", "free for 72 hours"] }],
        button: { label: "Open your yarnOga app", href: "https://app.yarnoga.com/home" },
      },
      { imageBase: links.imageBase, unsubscribeUrl: "https://app.yarnoga.com/email/unsubscribe/x" },
    );
    // Background colours as bgcolor attributes, so Gmail keeps them.
    expect(html).toContain('bgcolor="#0a0d0b"');
    expect(html).toContain('bgcolor="#c6ff1f"');
    expect(html).toContain("https://app.yarnoga.com/email/img/hero-welcome.jpg");
    expect(html).toContain("Hi &lt;Ada&gt;, send <b>prices</b>.");
    expect(html).toContain("Nsikak John");
    expect(html).toContain('href="https://app.yarnoga.com/email/unsubscribe/x"');
    expect(html).toContain("RC 1601716. Photo from Pexels.");
    expect(text).toContain("Hi <Ada>, send prices.");
    expect(text).toContain("1. Check: your list");
    expect(text).toContain("Open your yarnOga app: https://app.yarnoga.com/home");
    expect(text).toContain("Unsubscribe: https://app.yarnoga.com/email/unsubscribe/x");
  });

  it("uses the first name, or 'there'", () => {
    expect(firstNameOf("Nsikak John")).toBe("Nsikak");
    expect(firstNameOf("  ")).toBe("there");
    expect(firstNameOf("🙂")).toBe("there");
    expect(firstNameOf(null)).toBe("there");
  });
});

describe("Resend", () => {
  it("sends with reply-to, the unsubscribe headers and an idempotency key", async () => {
    let sent: { headers: Record<string, string>; body: Record<string, unknown> } | null = null;
    const send = resendSender({
      apiKey: "re_key",
      from: "Nsikak John at yarnOga <hello@updates.yarnoga.com>",
      replyTo: "support@yarnoga.com",
      fetch: (async (_url: string, init: RequestInit) => {
        sent = { headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
        return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const id = await send({ to: "ada@gmail.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi", unsubscribeUrl: "https://u", idempotencyKey: "c1/Q1" });
    expect(id).toBe("re_1");
    expect(sent!.headers["Idempotency-Key"]).toBe("c1/Q1");
    expect(sent!.body).toMatchObject({
      from: "Nsikak John at yarnOga <hello@updates.yarnoga.com>",
      to: ["ada@gmail.com"],
      reply_to: "support@yarnoga.com",
      headers: { "List-Unsubscribe": "<https://u>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
  });

  it("tells a refused address from a passing problem", async () => {
    const answering = (status: number) =>
      resendSender({ apiKey: "k", from: "a@b.co", replyTo: "c@d.co", fetch: (async () => new Response("no", { status })) as unknown as typeof fetch });
    const email: OutgoingEmail = { to: "x", subject: "s", html: "", text: "", unsubscribeUrl: "u", idempotencyKey: "k" };
    await expect(answering(422)(email)).rejects.toBeInstanceOf(EmailRejected);
    const busy = await answering(429)(email).catch((e) => e);
    expect(busy).toBeInstanceOf(Error);
    expect(busy).not.toBeInstanceOf(EmailRejected);
  });
});

describe("asking for an email in WhatsApp", () => {
  it("finds one address in a short message, and common typos", () => {
    expect(emailIn("my email is Ada.Obi@Gmail.com.")).toBe("ada.obi@gmail.com");
    expect(emailIn("a@b.com or c@d.com")).toBeNull();
    expect(emailIn("skip")).toBeNull();
    expect(likelyTypo("nsikak.john@gamil.com")).toBe("nsikak.john@gmail.com");
    expect(likelyTypo("ada@gmail.com")).toBeNull();
  });

  it("asks once per person, and not when the account already gets the emails", async () => {
    const store = memoryEmails();
    const asker = createEmailAsker(store, { log: silent });
    const a = { product: "quote" as const, accountId: "b1", waId: "2348011111111", question: "Want tips?", source: "test" };
    expect(await asker.ask(a)).toBe(`Want tips? ${HOW_TO_ANSWER}`);
    expect(store.contacts[0]).toMatchObject({ askedAt: expect.any(Date), tipsAt: null });
    expect(await asker.ask(a)).toBeNull();
    store.contacts[0]!.email = "ada@gmail.com";
    expect(await asker.ask({ ...a, waId: "2348022222222" })).toBeNull();
  });

  it("saves the address with their agreement and name", async () => {
    const store = memoryEmails();
    await createEmailAsker(store).ask({ product: "quote", accountId: "b1", waId: "2348011111111", question: "Want tips?", source: "test" });
    const bot2 = withEmailReplies(bot, { store, log: silent });
    const reply = await bot2.handle(msg("nsikak.john@gmail.com"), ctx());
    expect(reply?.text).toContain("I'll send setup tips to nsikak.john@gmail.com");
    expect(store.contacts[0]).toMatchObject({ email: "nsikak.john@gmail.com", firstName: "Nsikak John", tipsAt: expect.any(Date) });
  });

  it("checks a mistyped address before saving it", async () => {
    const store = memoryEmails();
    await createEmailAsker(store).ask({ product: "quote", accountId: "b1", waId: "2348011111111", question: "Want tips?", source: "test" });
    const reply = await withEmailReplies(bot, { store }).handle(msg("nsikak.john@gamil.com"), ctx());
    expect(reply?.text).toContain("Did you mean *nsikak.john@gmail.com*?");
    expect(store.contacts[0]!.email).toBeNull();
  });

  it("only takes 'skip' as an answer straight after the question", async () => {
    const store = memoryEmails();
    await createEmailAsker(store).ask({ product: "flyer", accountId: "g1", waId: "2348011111111", question: "Want tips?", source: "test" });
    const replies = withEmailReplies(bot, { store });
    expect((await replies.handle(msg("skip"), ctx(["Send your logo, or *skip*."])))?.text).toBe("from the bot");
    expect(store.contacts[0]!.declinedAt).toBeNull();
    expect((await replies.handle(msg("skip"), ctx([`Saved Ada. Want tips? ${HOW_TO_ANSWER}`])))?.text).toContain("No problem");
    expect(store.contacts[0]!.declinedAt).toBeInstanceOf(Date);
  });

  it("passes an email address through when nothing was asked", async () => {
    const reply = await withEmailReplies(bot, { store: memoryEmails() }).handle(msg("ada@gmail.com"), ctx());
    expect(reply?.text).toBe("from the bot");
  });

  it("'stop emails' unsubscribes everything for that number", async () => {
    const store = memoryEmails();
    await store.save("quote", "b1", "2348011111111", { email: "a@b.co", tipsAt: new Date() });
    await store.save("flyer", "g1", "2348011111111", { email: "a@b.co", tipsAt: new Date() });
    const replies = withEmailReplies(bot, { store });
    expect((await replies.handle(msg("Stop emails"), ctx()))?.text).toContain("won't get any more emails");
    expect(store.contacts.every((c) => c.unsubscribedAt)).toBe(true);
    // Someone we've never emailed: the bot answers as usual.
    expect((await replies.handle(msg("stop emails", "2348099999999"), ctx()))?.text).toBe("from the bot");
  });
});

describe("the series", () => {
  type F = AccountFacts & { rows: number };
  const series = (facts: F | null): Series<F> => ({
    facts: async () => facts,
    emails: [
      { key: "A1", day: 0, content: (_f, name) => ({ eyebrow: "e", subject: `Welcome ${name}`, preview: "p", blocks: ["hi"] }) },
      { key: "A2", day: 1, when: (f) => f.rows < 5, content: () => ({ eyebrow: "e", subject: "Add prices", preview: "p", blocks: ["x"] }) },
      { key: "A3", day: 2, content: () => ({ eyebrow: "e", subject: "Test it", preview: "p", blocks: ["x"] }) },
    ],
  });
  // 29 Oct 2026, 11:00 in Lagos (10:00 UTC).
  const start = new Date("2026-10-29T10:00:00Z");
  const at = (days: number, utcHour = 10) => new Date(start.getTime() + days * 86_400_000 + (utcHour - 10) * 3_600_000);

  async function run(opts: { facts?: F | null; now: Date; store?: ReturnType<typeof memoryEmails>; limit?: number; fail?: "reject" | "down" }) {
    let clock = opts.now;
    const store = opts.store ?? memoryEmails(() => clock);
    if (!opts.store) await store.save("quote", "b1", "2348011111111", { email: "ada@gmail.com", firstName: "Ada Obi", tipsAt: start });
    const sent: OutgoingEmail[] = [];
    const count = await sendDueEmails({
      store,
      series: { quote: series(opts.facts === undefined ? { live: true, rows: 2 } : opts.facts) },
      send: async (e) => {
        if (opts.fail === "reject") throw new EmailRejected("bad address");
        if (opts.fail === "down") throw new Error("timeout");
        sent.push(e);
        return "re_1";
      },
      links,
      dailyLimit: opts.limit ?? 90,
      now: () => clock,
      log: silent,
    });
    return { store, sent, count, setClock: (d: Date) => (clock = d) };
  }

  it("sends the welcome straight away, by name, with a signed unsubscribe link", async () => {
    const { store, sent } = await run({ now: at(0, 22) });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe("Welcome Ada");
    expect(sent[0]!.idempotencyKey).toBe("c1/A1");
    expect(sent[0]!.unsubscribeUrl).toMatch(/^https:\/\/app\.yarnoga\.com\/email\/unsubscribe\/c1\.[\w-]{24}$/);
    expect(store.contacts[0]!.seriesStartedAt).toEqual(at(0, 22));
    expect(store.done).toEqual([expect.objectContaining({ key: "A1", status: "sent", resendId: "re_1" })]);
  });

  it("waits until the account is live", async () => {
    const { store, sent } = await run({ facts: { live: false, rows: 0 }, now: at(0) });
    expect(sent).toHaveLength(0);
    expect(store.contacts[0]!.seriesStartedAt).toBeNull();
  });

  it("sends nothing once the account says stop, or is gone", async () => {
    expect((await run({ facts: { live: true, stop: true, rows: 0 }, now: at(0) })).sent).toHaveLength(0);
    expect((await run({ facts: null, now: at(0) })).sent).toHaveLength(0);
  });

  it("sends later emails on their day, in Lagos daytime, one a day", async () => {
    const first = await run({ now: at(0) });
    const { store } = first;
    const again = async (now: Date) => {
      first.setClock(now);
      return (await run({ now, store })).sent.map((e) => e.subject);
    };
    expect(await again(at(0, 15))).toEqual([]); // A2 isn't due until day 1
    expect(await again(at(1, 22))).toEqual([]); // 11pm in Lagos
    expect(await again(at(1, 9))).toEqual([]); // 23 hours in: not a full day yet
    expect(await again(at(1, 12))).toEqual(["Add prices"]);
    expect(await again(at(2, 7))).toEqual([]); // 8am in Lagos, but under 20 hours since the last one
    expect(await again(at(2, 12))).toEqual(["Test it"]);
    expect(await again(at(9, 12))).toEqual([]);
  });

  it("skips an email whose step is already done", async () => {
    const { store } = await run({ facts: { live: true, rows: 20 }, now: at(0) });
    const later = await run({ facts: { live: true, rows: 20 }, now: at(2, 12), store });
    expect(later.sent.map((e) => e.subject)).toEqual(["Test it"]);
    expect(store.done.map((d) => [d.key, d.status])).toEqual([["A1", "sent"], ["A2", "skipped"], ["A3", "sent"]]);
  });

  it("stops at the daily limit", async () => {
    expect((await run({ now: at(0), limit: 0 })).sent).toHaveLength(0);
  });

  it("gives up on an address Resend refuses, and retries a passing problem", async () => {
    const refused = await run({ now: at(0), fail: "reject" });
    expect(refused.store.done).toEqual([expect.objectContaining({ key: "A1", status: "failed" })]);
    const down = await run({ now: at(0), fail: "down" });
    expect(down.store.done).toEqual([]);
  });

  it("sends one series when the same address is on an account twice", async () => {
    const store = memoryEmails(() => at(0));
    await store.save("quote", "b1", "", { email: "ada@gmail.com", tipsAt: start });
    await store.save("quote", "b1", "2348011111111", { email: "Ada@gmail.com", tipsAt: at(0) });
    const { sent } = await run({ now: at(0), store });
    expect(sent).toHaveLength(1);
  });
});

describe("unsubscribe page", () => {
  async function setup() {
    const store = memoryEmails();
    const c = await store.save("quote", "00000000-0000-4000-8000-000000000001", "2348011111111", { email: "ada@gmail.com", tipsAt: new Date() });
    // The memory store's ids aren't UUIDs; the page only takes UUIDs.
    c.id = "11111111-2222-4333-8444-555555555555";
    const app = createEmailRoutes({ secret: SECRET, store, log: silent });
    const path = new URL(links.unsubscribe(c.id)).pathname.replace(/^\/email/, "");
    return { app, store, c, path };
  }

  it("unsubscribes on opening the link, and lets them back in", async () => {
    const { app, c, path } = await setup();
    const res = await app.request(path);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("ada@gmail.com");
    expect(c.unsubscribedAt).toBeInstanceOf(Date);
    const back = await app.request(path.replace("unsubscribe", "resubscribe"), { method: "POST" });
    expect(back.status).toBe(200);
    expect(c.unsubscribedAt).toBeNull();
  });

  it("takes Gmail's one-click unsubscribe", async () => {
    const { app, c, path } = await setup();
    const res = await app.request(path, { method: "POST", body: "List-Unsubscribe=One-Click" });
    expect(res.status).toBe(200);
    expect(c.unsubscribedAt).toBeInstanceOf(Date);
  });

  it("refuses a link that wasn't signed by us", async () => {
    const { app, c } = await setup();
    const res = await app.request(`/unsubscribe/${c.id}.AAAAAAAAAAAAAAAAAAAAAAAA`);
    expect(res.status).toBe(404);
    expect(c.unsubscribedAt).toBeNull();
  });

  it("serves the email pictures and nothing else from the folder", async () => {
    const { app } = await setup();
    const logo = await app.request("/img/logo.png");
    expect(logo.status).toBe(200);
    expect(logo.headers.get("content-type")).toBe("image/png");
    expect((await app.request("/img/..%2F..%2Fpackage.json")).status).toBe(404);
  });
});

describe("email settings (owner app and /signup)", () => {
  it("keeps receipts and tips apart, and unticking unsubscribes", async () => {
    const store = memoryEmails();
    const settings = createEmailSettings(store);
    const base = { product: "quote" as const, accountId: "b1", waId: "2348011111111", source: "owner app settings" };
    expect(await settings.save({ ...base, email: "ada@gmail.com", tips: false })).toBeNull();
    expect(store.contacts[0]).toMatchObject({ email: "ada@gmail.com", receiptsAt: expect.any(Date), tipsAt: null });
    expect(await settings.get("quote", "b1", base.waId)).toEqual({ email: "ada@gmail.com", tips: false });
    await settings.save({ ...base, email: "ada@gmail.com", tips: true });
    expect(await settings.get("quote", "b1", base.waId)).toEqual({ email: "ada@gmail.com", tips: true });
    await settings.save({ ...base, email: "ada@gmail.com", tips: false });
    expect(store.contacts[0]!.unsubscribedAt).toBeInstanceOf(Date);
    expect(await settings.save({ ...base, email: "ada@gamil.com", tips: true })).toBe("typo");
    expect(await settings.save({ ...base, email: "not an email", tips: true })).toBe("bad");
    expect(store.contacts[0]!.email).toBe("ada@gmail.com");
  });
});
