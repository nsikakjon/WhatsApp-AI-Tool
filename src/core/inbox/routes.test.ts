import { describe, expect, it } from "vitest";
import type { MessageStore } from "../db/store.js";
import type { WhatsAppClient } from "../whatsapp/client.js";
import { createInbox, type BotPauses } from "./routes.js";
import type { ChatMessage, InboxStore } from "./store.js";

const PASSWORD = "correct horse battery";
const CONTACT = "11111111-2222-3333-4444-555555555555";
const MAIN = "100";
const FLYER = "200";
const silent = { info() {}, warn() {}, error() {} };

function setup(opts: { lastInbound?: Date | null; pauses?: boolean } = {}) {
  const sent: Array<{ to: string; body: string; from?: string }> = [];
  const recorded: Array<{ body: string; raw: unknown; businessNumberId?: string }> = [];
  const paused = new Set<string>();
  const thread: ChatMessage[] = [
    { direction: "inbound", type: "text", body: "How much for 100 flyers?", fromStaff: false, at: new Date() },
    { direction: "outbound", type: "text", body: "<b>N25,000</b>", fromStaff: false, at: new Date() },
  ];

  const inbox: InboxStore = {
    async listChats() {
      return [
        {
          contactId: CONTACT,
          businessNumberId: null,
          waId: "2348012345678",
          name: "Ada <script>",
          lastDirection: "inbound",
          lastType: "text",
          lastBody: "Hello",
          lastAt: new Date(),
        },
      ];
    },
    async contact(id) {
      return id === CONTACT ? { waId: "2348012345678", name: "Ada" } : null;
    },
    async chatMessages() {
      return thread;
    },
  };
  const messages = {
    async recordOutbound(_contactId: string, out: { body: string; raw: unknown; businessNumberId?: string }) {
      recorded.push(out);
    },
    async lastInboundAt() {
      return opts.lastInbound === undefined ? new Date() : opts.lastInbound;
    },
  } as unknown as MessageStore;
  const whatsapp = {
    async sendText(to: string, body: string, from?: string) {
      sent.push({ to, body, from });
      return { waMessageId: "wamid.staff", raw: { messages: [{ id: "wamid.staff" }] } };
    },
  } as unknown as WhatsAppClient;
  const pauses: BotPauses = {
    async isPaused(c, n) {
      return paused.has(`${c}/${n}`);
    },
    async pause(c, n) {
      paused.add(`${c}/${n}`);
    },
    async resume(c, n) {
      paused.delete(`${c}/${n}`);
    },
  };

  const app = createInbox({
    password: PASSWORD,
    appSecret: "app-secret",
    inbox,
    messages,
    whatsapp,
    numbers: [
      { id: MAIN, label: "Sales" },
      { id: FLYER, label: "Flyers" },
    ],
    pauses: opts.pauses === false ? undefined : pauses,
    log: silent,
  });
  return { app, sent, recorded, paused };
}

function form(fields: Record<string, string>, cookie?: string) {
  return {
    method: "POST",
    body: new URLSearchParams(fields),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  };
}

async function login(app: ReturnType<typeof setup>["app"]): Promise<string> {
  const res = await app.request("/login", form({ password: PASSWORD }));
  expect(res.status).toBe(303);
  const cookie = res.headers.get("set-cookie") ?? "";
  return cookie.split(";")[0]!;
}

const chatUrl = `/chat/${CONTACT}/${MAIN}`;

describe("staff inbox", () => {
  it("sends visitors without a login to the login page", async () => {
    const { app } = setup();
    for (const path of ["/", chatUrl]) {
      const res = await app.request(path);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/inbox/login");
    }
    const post = await app.request(`${chatUrl}/reply`, form({ text: "hi" }));
    expect(post.headers.get("location")).toBe("/inbox/login");
  });

  it("refuses a wrong password and a forged cookie", async () => {
    const { app } = setup();
    const res = await app.request("/login", form({ password: "nope" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();

    const forged = await app.request("/", { headers: { Cookie: "inbox_session=99999999999999.fake" } });
    expect(forged.headers.get("location")).toBe("/inbox/login");
  });

  it("locks out an address after 5 wrong passwords, even with the right one", async () => {
    const { app } = setup();
    const from = (fields: Record<string, string>) => {
      const init = form(fields);
      return { ...init, headers: { ...init.headers, "X-Forwarded-For": "1.2.3.4" } };
    };
    for (let i = 0; i < 5; i++) await app.request("/login", from({ password: "wrong" }));
    const res = await app.request("/login", from({ password: PASSWORD }));
    expect(res.status).toBe(429);
  });

  it("lists chats and escapes what customers wrote", async () => {
    const { app } = setup();
    const cookie = await login(app);
    const res = await app.request("/", { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("Ada &lt;script&gt;");
    expect(page).not.toContain("Ada <script>");
    // Chats saved before numbers were recorded open on the main number.
    expect(page).toContain(`/inbox/chat/${CONTACT}/${MAIN}`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("shows a chat with the bot's state", async () => {
    const { app } = setup();
    const cookie = await login(app);
    const page = await (await app.request(chatUrl, { headers: { Cookie: cookie } })).text();
    expect(page).toContain("How much for 100 flyers?");
    expect(page).toContain("&lt;b&gt;N25,000&lt;/b&gt;");
    expect(page).toContain("The bot is answering this chat");
    expect(page).toContain("Take over");
  });

  it("returns 404 for a number or contact that isn't ours", async () => {
    const { app } = setup();
    const cookie = await login(app);
    const badNumber = await app.request(`/chat/${CONTACT}/999`, { headers: { Cookie: cookie } });
    expect(badNumber.status).toBe(404);
    const badContact = await app.request(`/chat/not-a-uuid/${MAIN}`, { headers: { Cookie: cookie } });
    expect(badContact.status).toBe(404);
  });

  it("takes over and hands back", async () => {
    const { app, paused } = setup();
    const cookie = await login(app);
    await app.request(`${chatUrl}/takeover`, form({}, cookie));
    expect(paused.has(`${CONTACT}/${MAIN}`)).toBe(true);
    const page = await (await app.request(chatUrl, { headers: { Cookie: cookie } })).text();
    expect(page).toContain("You're handling this chat");

    await app.request(`${chatUrl}/handback`, form({}, cookie));
    expect(paused.size).toBe(0);
  });

  it("sends a staff reply from the chat's own number and pauses the bot", async () => {
    const { app, sent, recorded, paused } = setup();
    const cookie = await login(app);
    const res = await app.request(`/chat/${CONTACT}/${FLYER}/reply`, form({ text: "  I'll call you now  " }, cookie));
    expect(res.status).toBe(303);
    expect(sent).toEqual([{ to: "2348012345678", body: "I'll call you now", from: FLYER }]);
    expect(recorded[0]).toMatchObject({ body: "I'll call you now", businessNumberId: FLYER, raw: { inbox: true } });
    expect(paused.has(`${CONTACT}/${FLYER}`)).toBe(true);
  });

  it("won't send outside WhatsApp's 24-hour window", async () => {
    const { app, sent } = setup({ lastInbound: new Date(Date.now() - 30 * 60 * 60 * 1000) });
    const cookie = await login(app);
    const res = await app.request(`${chatUrl}/reply`, form({ text: "Hello?" }, cookie));
    expect(res.headers.get("location")).toContain("error=window");
    expect(sent).toEqual([]);
    const page = await (await app.request(chatUrl, { headers: { Cookie: cookie } })).text();
    expect(page).toContain("last wrote more than a day ago");
  });

  it("works without take over when bot pausing isn't available", async () => {
    const { app } = setup({ pauses: false });
    const cookie = await login(app);
    const page = await (await app.request(chatUrl, { headers: { Cookie: cookie } })).text();
    expect(page).not.toContain("Take over");
    const res = await app.request(`${chatUrl}/takeover`, form({}, cookie));
    expect(res.status).toBe(404);
  });

  it("logs out", async () => {
    const { app } = setup();
    const cookie = await login(app);
    const res = await app.request("/logout", form({}, cookie));
    expect(res.headers.get("set-cookie")).toContain("inbox_session=;");
  });
});
