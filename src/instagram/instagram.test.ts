import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createInstagramClient, type InstagramClient } from "./client.js";
import { loadInstagramConfig } from "./config.js";
import { extractComments, type IncomingComment } from "./parse.js";
import type { CommentProgress, InstagramCommentStore } from "./store.js";
import { createInstagramWebhook } from "./webhook.js";

const APP_SECRET = "ig-secret";
const ACCOUNT = "17841400000000000";
const silent = { info() {}, warn() {}, error() {} };

function memoryStore() {
  const rows = new Map<string, { status: string; dm: boolean; pub: boolean }>();
  const store: InstagramCommentStore = {
    async claim(c: IncomingComment): Promise<CommentProgress | null> {
      const row = rows.get(c.commentId);
      if (!row) {
        rows.set(c.commentId, { status: "working", dm: false, pub: false });
        return { privateReplySent: false, publicReplySent: false };
      }
      if (row.status !== "failed") return null;
      row.status = "working";
      return { privateReplySent: row.dm, publicReplySent: row.pub };
    },
    async markPrivateReplySent(id) {
      rows.get(id)!.dm = true;
    },
    async markPublicReplySent(id) {
      rows.get(id)!.pub = true;
    },
    async markDone(id) {
      rows.get(id)!.status = "done";
    },
    async markFailed(id) {
      const row = rows.get(id);
      if (row) row.status = "failed";
    },
  };
  return { store, rows };
}

function fakeInstagram(failPublicTimes = 0) {
  const privateReplies: Array<{ commentId: string; text: string }> = [];
  const publicReplies: Array<{ commentId: string; text: string }> = [];
  let failures = failPublicTimes;
  const instagram: InstagramClient = {
    async sendPrivateReply(commentId, text) {
      privateReplies.push({ commentId, text });
    },
    async replyToComment(commentId, text) {
      if (failures > 0) {
        failures--;
        throw new Error("Instagram is down");
      }
      publicReplies.push({ commentId, text });
    },
  };
  return { instagram, privateReplies, publicReplies };
}

function setup(failPublicTimes = 0) {
  const { store, rows } = memoryStore();
  const ig = fakeInstagram(failPublicTimes);
  const app = createInstagramWebhook({
    verifyToken: "verify-me",
    appSecret: APP_SECRET,
    accountId: ACCOUNT,
    businessName: "Acme Homes",
    whatsappNumber: "2348012345678",
    store,
    instagram: ig.instagram,
    log: silent,
  });
  return { app, rows, ...ig };
}

function commentPayload(value: Record<string, unknown>) {
  return { object: "instagram", entry: [{ id: ACCOUNT, time: 1, changes: [{ field: "comments", value }] }] };
}

const COMMENT = { id: "c1", text: "How much is this?", from: { id: "999", username: "ada" }, media: { id: "m1" } };

function post(app: ReturnType<typeof setup>["app"], body: unknown, secret = APP_SECRET) {
  const raw = JSON.stringify(body);
  const sig = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
  return app.request("/", { method: "POST", body: raw, headers: { "x-hub-signature-256": sig } });
}

describe("Instagram comment auto-reply webhook", () => {
  it("answers Meta's verification check only with the right token", async () => {
    const { app } = setup();
    const ok = await app.request("/?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("abc");
    const bad = await app.request("/?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc");
    expect(bad.status).toBe(403);
  });

  it("rejects a webhook with a bad signature before doing anything", async () => {
    const { app, privateReplies, publicReplies } = setup();
    const res = await post(app, commentPayload(COMMENT), "not-the-secret");
    expect(res.status).toBe(401);
    expect(privateReplies).toHaveLength(0);
    expect(publicReplies).toHaveLength(0);
  });

  it("sends a private message with the WhatsApp link, then replies in public", async () => {
    const { app, privateReplies, publicReplies } = setup();
    const res = await post(app, commentPayload(COMMENT));
    expect(res.status).toBe(200);
    expect(privateReplies).toHaveLength(1);
    expect(privateReplies[0].commentId).toBe("c1");
    expect(privateReplies[0].text).toContain("@ada");
    expect(privateReplies[0].text).toContain("Acme Homes");
    expect(privateReplies[0].text).toContain("https://wa.me/2348012345678?text=");
    expect(publicReplies).toEqual([{ commentId: "c1", text: expect.stringContaining("@ada") }]);
  });

  it("never mentions a price", async () => {
    const { app, privateReplies, publicReplies } = setup();
    await post(app, commentPayload(COMMENT));
    for (const r of [...privateReplies, ...publicReplies]) expect(r.text).not.toMatch(/₦|naira|kobo/i);
  });

  it("answers a comment only once when Meta sends the webhook twice", async () => {
    const { app, privateReplies, publicReplies } = setup();
    await post(app, commentPayload(COMMENT));
    await post(app, commentPayload(COMMENT));
    expect(privateReplies).toHaveLength(1);
    expect(publicReplies).toHaveLength(1);
  });

  it("asks Meta to retry when a step fails, then does only the missing step", async () => {
    const { app, privateReplies, publicReplies } = setup(1);
    const first = await post(app, commentPayload(COMMENT));
    expect(first.status).toBe(500);
    expect(privateReplies).toHaveLength(1);
    expect(publicReplies).toHaveLength(0);

    const retry = await post(app, commentPayload(COMMENT));
    expect(retry.status).toBe(200);
    expect(privateReplies).toHaveLength(1);
    expect(publicReplies).toHaveLength(1);
  });

  it("ignores its own replies and replies inside a comment thread", async () => {
    const { app, privateReplies, publicReplies } = setup();
    await post(app, commentPayload({ ...COMMENT, id: "own", from: { id: ACCOUNT, username: "acmehomes" } }));
    await post(app, commentPayload({ ...COMMENT, id: "threaded", parent_id: "c0" }));
    expect(privateReplies).toHaveLength(0);
    expect(publicReplies).toHaveLength(0);
  });
});

describe("extractComments", () => {
  it("ignores other kinds of webhook", () => {
    expect(extractComments({ object: "whatsapp_business_account", entry: [] }, ACCOUNT)).toEqual([]);
    const mention = { object: "instagram", entry: [{ id: ACCOUNT, changes: [{ field: "mentions", value: COMMENT }] }] };
    expect(extractComments(mention, ACCOUNT)).toEqual([]);
    expect(extractComments(null, ACCOUNT)).toEqual([]);
  });
});

describe("loadInstagramConfig", () => {
  const full = {
    INSTAGRAM_AUTOREPLY: "on",
    INSTAGRAM_ACCOUNT_ID: ACCOUNT,
    INSTAGRAM_ACCESS_TOKEN: "token",
    INSTAGRAM_APP_SECRET: "secret",
    INSTAGRAM_WHATSAPP_NUMBER: "+234 801 234 5678",
    WHATSAPP_VERIFY_TOKEN: "wa-verify",
    LEADS_BUSINESS_NAME: "Acme Homes",
  };

  it("is off unless INSTAGRAM_AUTOREPLY is switched on", () => {
    expect(loadInstagramConfig({}).status).toBe("off");
    expect(loadInstagramConfig({ ...full, INSTAGRAM_AUTOREPLY: "" }).status).toBe("off");
    expect(loadInstagramConfig({ ...full, INSTAGRAM_AUTOREPLY: "off" }).status).toBe("off");
  });

  it("stays off and lists what's missing instead of crashing", () => {
    expect(loadInstagramConfig({ INSTAGRAM_AUTOREPLY: "on", INSTAGRAM_ACCOUNT_ID: ACCOUNT })).toEqual({
      status: "missing",
      missing: ["INSTAGRAM_ACCESS_TOKEN", "INSTAGRAM_APP_SECRET", "INSTAGRAM_WHATSAPP_NUMBER", "INSTAGRAM_VERIFY_TOKEN"],
    });
  });

  it("reads the settings, cleaning the WhatsApp number and borrowing the leads name", () => {
    const setup = loadInstagramConfig(full);
    expect(setup.status).toBe("on");
    if (setup.status !== "on") return;
    expect(setup.config.whatsappNumber).toBe("2348012345678");
    expect(setup.config.verifyToken).toBe("wa-verify");
    expect(setup.config.businessName).toBe("Acme Homes");
  });
});

describe("createInstagramClient", () => {
  it("calls the comment reply and private reply endpoints and hides the token in errors", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const client = createInstagramClient({
      accountId: ACCOUNT,
      accessToken: "secret-token",
      graphApiVersion: "v23.0",
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        if (calls.length === 3) {
          return new Response(JSON.stringify({ error: { message: "bad token secret-token" } }), { status: 400 });
        }
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    await client.replyToComment("c1", "hi");
    await client.sendPrivateReply("c1", "dm");
    expect(calls[0]).toEqual({ url: "https://graph.instagram.com/v23.0/c1/replies", body: { message: "hi" } });
    expect(calls[1]).toEqual({
      url: `https://graph.instagram.com/v23.0/${ACCOUNT}/messages`,
      body: { recipient: { comment_id: "c1" }, message: { text: "dm" } },
    });
    await expect(client.replyToComment("c2", "x")).rejects.toThrow(/\*\*\*/);
    await expect(client.replyToComment("c2", "x")).resolves.toBeUndefined();
  });
});
