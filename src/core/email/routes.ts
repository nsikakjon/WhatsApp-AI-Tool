import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import type { EmailLinks } from "./series.js";
import type { EmailStore } from "./store.js";

// The email pages at /email: the logo and photos the emails show, and the
// unsubscribe link at the bottom of every email. Opening the link
// unsubscribes straight away (one click), and Gmail's own Unsubscribe button
// posts to the same address. The page offers a way back in case of a mistap.

const imageDir = fileURLToPath(new URL("../../../assets/email/", import.meta.url));
const IMAGES: Record<string, string> = {
  "logo.png": "image/png",
  "hero-welcome.jpg": "image/jpeg",
  "hero-chat.jpg": "image/jpeg",
  "hero-flyers.jpg": "image/jpeg",
  "hero-site.jpg": "image/jpeg",
  "hero-property.jpg": "image/jpeg",
};

const UUID = /^[0-9a-f-]{36}$/;
const signature = (secret: string, id: string) => createHmac("sha256", secret).update(`email-unsubscribe:${id}`).digest("base64url").slice(0, 24);

export function emailLinks(secret: string, publicUrl: string): EmailLinks {
  const base = publicUrl.replace(/\/+$/, "");
  return { imageBase: `${base}/email/img`, unsubscribe: (id) => `${base}/email/unsubscribe/${id}.${signature(secret, id)}` };
}

function readToken(secret: string, token: string): string | null {
  const [id, sig] = token.split(".");
  if (!id || !sig || !UUID.test(id)) return null;
  const expected = Buffer.from(signature(secret, id));
  const given = Buffer.from(sig);
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

export function createEmailRoutes(deps: { secret: string; store: EmailStore; now?: () => Date; log?: Pick<Console, "info" | "error"> }) {
  const app = new Hono();
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? console;
  const files = new Map<string, Buffer>();

  app.get("/img/:file", (c) => {
    const name = c.req.param("file");
    const type = IMAGES[name];
    if (!type) return c.notFound();
    if (!files.has(name)) files.set(name, readFileSync(`${imageDir}${name}`));
    return c.body(new Uint8Array(files.get(name)!), 200, { "Content-Type": type, "Cache-Control": "public, max-age=604800" });
  });

  const contactFor = async (token: string) => {
    const id = readToken(deps.secret, token);
    return id ? deps.store.get(id) : null;
  };

  // Opening the link, or Gmail's one-click button (a POST with List-Unsubscribe=One-Click).
  const unsubscribe = async (token: string) => {
    const contact = await contactFor(token);
    if (!contact) return null;
    if (!contact.unsubscribedAt) {
      await deps.store.update([contact.id], { unsubscribedAt: now() });
      log.info(`Email unsubscribe: ${contact.product} contact ${contact.id}`);
    }
    return contact;
  };

  app.get("/unsubscribe/:token", async (c) => {
    c.header("Cache-Control", "no-store");
    const contact = await unsubscribe(c.req.param("token"));
    if (!contact) return c.html(page("Link not recognised", "<h1>That link isn't working</h1><p>It may have been cut short when it was copied. Open it again from the email, or send <b>stop emails</b> to your yarnOga number on WhatsApp.</p>"), 404);
    return c.html(
      page(
        "Unsubscribed",
        `<h1>You're unsubscribed</h1><p>We won't send any more tips to <b>${esc(contact.email ?? "your email")}</b>. Your yarnOga bot keeps working as normal.</p>
<form method="post" action="/email/resubscribe/${esc(c.req.param("token"))}"><button>I didn't mean to, keep sending tips</button></form>`,
      ),
    );
  });

  app.post("/unsubscribe/:token", async (c) => {
    const contact = await unsubscribe(c.req.param("token"));
    return contact ? c.body(null, 200) : c.notFound();
  });

  app.post("/resubscribe/:token", async (c) => {
    c.header("Cache-Control", "no-store");
    const contact = await contactFor(c.req.param("token"));
    if (!contact) return c.notFound();
    await deps.store.update([contact.id], { unsubscribedAt: null });
    log.info(`Email resubscribe: ${contact.product} contact ${contact.id}`);
    return c.html(page("Subscribed again", "<h1>You're back on the list</h1><p>The setup tips carry on where they left off, one short email at a time.</p>"));
  });

  return app;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)} · yarnOga</title>
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@700&family=Instrument+Sans:wght@400;600&display=swap" rel="stylesheet">
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0d0b;color:#f3f1e6;font:16px/1.6 'Instrument Sans','Segoe UI',Helvetica,Arial,sans-serif;padding:24px 16px;box-sizing:border-box}
main{max-width:440px;width:100%;background:#121614;border:1px solid #232a25;border-radius:12px;padding:32px 28px}
img{display:block;margin-bottom:24px}
h1{font:700 28px/1.15 'Chakra Petch',Arial,sans-serif;margin:0 0 12px;letter-spacing:-.02em}
p{margin:0 0 20px;color:#c9cec7}
button{font:600 15px/1.2 inherit;font-family:inherit;padding:12px 18px;border-radius:6px;border:1px solid #3a443d;background:transparent;color:#f3f1e6;cursor:pointer}
button:hover{border-color:#c6ff1f;color:#c6ff1f}
a{color:#c6ff1f}
</style></head><body><main><img src="/email/img/logo.png" width="132" height="60" alt="yarnOga">${body}
<p style="margin:24px 0 0;font-size:14px">Questions? <a href="mailto:support@yarnoga.com">support@yarnoga.com</a></p></main></body></html>`;
}
