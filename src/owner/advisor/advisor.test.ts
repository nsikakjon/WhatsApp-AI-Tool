import { describe, expect, it } from "vitest";
import type { Product } from "../../core/product.js";
import type { AppBusiness } from "../types.js";
import { answerText, ask, winBackFor, type Answer } from "./index.js";
import type { AdvisorOrder } from "./numbers.js";
import type { AdvisorStore } from "./store.js";
import { withAdvisor } from "./whatsapp.js";
import type { AdviceRequest } from "./writer.js";

const NOW = new Date("2026-11-18T09:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const quiet = { info: () => {}, error: () => {} };

const orders: AdvisorOrder[] = [5, 40, 70].map((ago) => ({
  customerId: ago === 5 ? "c2" : "c1",
  name: ago === 5 ? "Bola" : "Ada Okafor",
  waId: ago === 5 ? "2348030000002" : "2348030000001",
  confirmedAt: daysAgo(ago),
  paidAt: daysAgo(ago),
  totalKobo: 1_000_000,
  lines: [{ variantId: "v1", name: "Flyers: A5", quantity: 100, totalKobo: 1_000_000, unitCostKobo: null }],
}));

function setup(opts: { limit?: number | null; written?: number; advice?: string | null; plan?: boolean } = {}) {
  const saved: Array<{ answer: Answer; ai: boolean }> = [];
  const asked: AdviceRequest[] = [];
  const store: AdvisorStore = {
    orders: async () => orders,
    recent: async (q) => saved.filter((s) => s.answer.question === q).at(-1)?.answer ?? null,
    written: async () => (opts.written ?? 0) + saved.filter((s) => s.ai).length,
    save: async (answer, ai) => void saved.push({ answer, ai }),
  };
  const biz = {
    id: "b1",
    name: "KahnPrints",
    language: "en",
    currency: "NGN",
    features: {
      planCode: async () => "pro",
      has: async () => opts.plan !== false,
      limit: async () => (opts.limit === undefined ? 30 : opts.limit),
    },
    prices: {
      products: async () => [
        { id: "p1", name: "Flyers", active: true, options: [{ id: "v1", name: "A5", minQuantity: 50, stock: null, tiers: [{ minQuantity: 50, unitPriceKobo: 10_000 }] }] },
      ],
    },
    data: { info: async () => ({ description: "a print shop" }) },
    advisor: {
      store,
      writer: {
        async write(req: AdviceRequest) {
          asked.push(req);
          return opts.advice === undefined ? "Sales look steady." : opts.advice;
        },
      },
    },
  } as unknown as AppBusiness;
  return { biz, saved, asked };
}

describe("business advisor answers", () => {
  it("works out the figures in code and adds the AI's advice", async () => {
    const { biz, saved, asked } = setup();
    const { answer, left } = await ask(biz, biz.advisor!, "shop", NOW, quiet);
    expect(answer.facts).toContain("• Money in: ₦10,000 (₦10,000), about the same");
    expect(answer.facts).toContain("• Repeat customers: 0 of 1 (1 of 1)");
    expect(answer.advice).toBe("Sales look steady.");
    expect(asked[0]!.facts).toContain("₦10,000");
    expect(saved).toHaveLength(1);
    expect(left).toBe(29);
  });

  it("shows a saved answer again without asking the AI", async () => {
    const { biz, asked } = setup();
    await ask(biz, biz.advisor!, "grow", NOW, quiet);
    await ask(biz, biz.advisor!, "grow", NOW, quiet);
    expect(asked).toHaveLength(1);
  });

  it("gives figures only once the month's written answers are used", async () => {
    const { biz, asked } = setup({ limit: 30, written: 30 });
    const { answer, left } = await ask(biz, biz.advisor!, "shop", NOW, quiet);
    expect(asked).toHaveLength(0);
    expect(answer.advice).toBeNull();
    expect(answer.limitReached).toBe(true);
    expect(left).toBe(0);
    expect(answerText(biz, answer, left)).toContain("You've used this month's written answers");
  });

  it("lists customers who stopped buying with a win-back message", async () => {
    const { biz } = setup({ advice: "Hi {name}, we miss you at KahnPrints!" });
    const { answer } = await ask(biz, biz.advisor!, "lapsed", NOW, quiet);
    expect(answer.facts[1]).toBe("• Ada Okafor (+2348030000001): 2 orders, ₦20,000 paid, last on 9 Oct");
    expect(answer.winBack).toEqual({ draft: "Hi {name}, we miss you at KahnPrints!", people: [{ name: "Ada Okafor", waId: "2348030000001" }] });
    expect(winBackFor(answer.winBack!.draft, "Ada Okafor", "en")).toBe("Hi Ada, we miss you at KahnPrints!");
    expect(winBackFor(answer.winBack!.draft, null, "en")).toBe("Hi there, we miss you at KahnPrints!");
  });

  it("writes the post from code when the AI can't", async () => {
    const { biz } = setup({ advice: null });
    const { answer } = await ask(biz, biz.advisor!, "post", NOW, quiet);
    expect(answer.advice).toContain("• Flyers from ₦100");
  });
});

describe("business advisor on WhatsApp", () => {
  const echo: Product = { name: "quote", handle: async (msg) => ({ text: msg.text === "menu" ? "Your owner commands:\n• *app*: a link" : `bot: ${msg.text}` }) };
  const wrap = (biz: AppBusiness) =>
    withAdvisor(echo, { businessFor: async () => ({ id: "b1", ownerWaId: "234800" }), business: async () => biz, now: () => NOW, log: quiet });
  const send = (p: Product, text: string, from = "234800") => p.handle({ type: "text", text, from, id: "m1" } as never, {} as never);

  it("shows the owner the questions and answers a tap", async () => {
    const bot = wrap(setup().biz);
    const menu = await send(bot, "advice");
    expect(menu!.list!.rows.map((r) => r.id)).toEqual(["advice shop", "advice lapsed", "advice grow", "advice prices", "advice post"]);
    const reply = await send(bot, "advice shop");
    expect(reply!.text).toContain("*How is my shop doing?*");
    expect(reply!.text).toContain("💡 Sales look steady.");
  });

  it("adds advice to the owner's command list", async () => {
    expect((await send(wrap(setup().biz), "menu"))!.text).toContain("• *advice*: questions about your shop");
  });

  it("leaves customers' messages to the bot and tells a Starter owner to upgrade", async () => {
    expect((await send(wrap(setup().biz), "advice", "234999"))!.text).toBe("bot: advice");
    expect((await send(wrap(setup({ plan: false }).biz), "advice"))!.text).toContain("comes with Pro and above");
  });
});
