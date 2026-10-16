import { createHash, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { UnknownBusinessError, type TestBots } from "./bots.js";
import { renderTestPage } from "./page.js";
import { MAX_QUESTION, type TestBotId } from "./questions.js";
import { askBot } from "./sandbox.js";
import type { Mark, MarkStore } from "./store.js";

// The owner test screen at /bot-test. Before a bot goes live, the owner runs
// common customer questions through it, reads each answer and marks it good
// or poor. Answers are shown on the screen only: nothing is sent on WhatsApp,
// and test quotes, orders and leads are never saved (see sandbox.ts).
//
// Switched off unless BOT_TEST_PASSWORD is set. The browser asks for the
// password; any username works. Each answer is one AI call, so there is a
// daily cap (BOT_TEST_DAILY_LIMIT).

export interface BotTestDeps {
  password: string;
  bots: TestBots;
  marks: MarkStore;
  dailyLimit: number;
  now?: () => Date;
  log?: Pick<Console, "error">;
}

const MAX_ANSWER = 5000;
const MAX_NOTE = 500;

export function createBotTest(deps: BotTestDeps) {
  const app = new Hono();
  const log = deps.log ?? console;
  const ids = (Object.keys(deps.bots.make) as TestBotId[]).filter((id) => deps.bots.make[id]);
  let day = "";
  let used = 0;

  app.use(
    "*",
    basicAuth({
      verifyUser: (_username, password) => samePassword(password, deps.password),
      realm: "yarnOga bot test",
    }),
  );
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    // Only the screen itself sends JSON; a form on another website can't, so
    // it can't use the owner's saved password to run up AI calls.
    if (c.req.method === "POST" && !c.req.header("content-type")?.startsWith("application/json")) {
      return c.json({ error: "Please use the test screen." }, 415);
    }
    await next();
  });

  app.get("/", (c) => c.html(renderTestPage(ids)));

  // The businesses to pick from, when the quote bot runs several. Empty otherwise.
  app.get("/businesses", async (c) => {
    if (!deps.bots.businesses) return c.json({ businesses: [] });
    try {
      return c.json({ businesses: await deps.bots.businesses() });
    } catch (err) {
      log.error("Bot test businesses failed to load:", err);
      return c.json({ error: "The list of businesses couldn't be loaded. Please refresh in a minute." }, 503);
    }
  });

  app.post("/ask", async (c) => {
    const body = await readJson(c.req.raw);
    const bot = pickBot(body?.bot);
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    const business = pickBusiness(body?.business);
    if (!bot) return c.json({ error: "That bot isn't switched on here." }, 400);
    if (!question || question.length > MAX_QUESTION) {
      return c.json({ error: `Questions must be between 1 and ${MAX_QUESTION} characters.` }, 400);
    }

    const today = lagosDate(deps.now?.() ?? new Date());
    if (today !== day) {
      day = today;
      used = 0;
    }
    if (used >= deps.dailyLimit) {
      return c.json({ error: `Today's ${deps.dailyLimit} test answers are used up. Try again tomorrow.` }, 429);
    }
    used += 1;

    try {
      return c.json(await askBot(await deps.bots.make[bot]!(business ?? undefined), question));
    } catch (err) {
      if (err instanceof UnknownBusinessError) return c.json({ error: "That business wasn't found." }, 400);
      log.error("Bot test question failed:", err);
      return c.json({ error: "The bot couldn't answer just now. Please try again." }, 502);
    }
  });

  app.get("/marks", async (c) => {
    const bot = pickBot(c.req.query("bot"));
    if (!bot) return c.json({ error: "That bot isn't switched on here." }, 400);
    try {
      const marks = await deps.marks.latest(bot, pickBusiness(c.req.query("business")));
      return c.json({ marks: marks.map((m) => ({ ...m, markedAt: m.markedAt.toISOString() })) });
    } catch (err) {
      log.error("Bot test marks failed to load:", err);
      return c.json({ error: "Saved marks couldn't be loaded. Has migration 0022 been run?" }, 503);
    }
  });

  app.post("/marks", async (c) => {
    const body = await readJson(c.req.raw);
    const bot = pickBot(body?.bot);
    const question = typeof body?.question === "string" ? body.question.trim() : "";
    const answer = typeof body?.answer === "string" ? body.answer : "";
    const mark: Mark | undefined = body?.mark === "good" || body?.mark === "poor" ? body.mark : undefined;
    const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, MAX_NOTE) : null;
    if (!bot || !question || question.length > MAX_QUESTION || !mark) {
      return c.json({ error: "That mark couldn't be saved." }, 400);
    }
    try {
      await deps.marks.save(bot, pickBusiness(body?.business), { question, answer: answer.slice(0, MAX_ANSWER), mark, note });
      return c.json({ ok: true });
    } catch (err) {
      log.error("Bot test mark failed to save:", err);
      return c.json({ error: "The mark couldn't be saved. Has migration 0022 been run?" }, 503);
    }
  });

  function pickBot(value: unknown): TestBotId | undefined {
    return ids.find((id) => id === value);
  }

  /** A business id from the screen, or null for the bot as it runs on the main number. */
  function pickBusiness(value: unknown): string | null {
    return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
  }

  return app;
}

async function readJson(req: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function samePassword(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function lagosDate(now: Date): string {
  // Lagos is UTC+1 all year.
  return new Date(now.getTime() + 60 * 60 * 1000).toISOString().slice(0, 10);
}
