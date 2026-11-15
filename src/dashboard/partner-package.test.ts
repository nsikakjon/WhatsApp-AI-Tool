import { describe, expect, it } from "vitest";
import { createDashboard } from "./index.js";
import {
  parseCodeForm,
  parseShopForm,
  renderPackage,
  type CodeInput,
  type PartnerPackageStore,
  type PartnerShop,
  type PlanChoice,
  type ShopInput,
} from "./partner-package.js";
import type { Partner, PartnerStore } from "./partners.js";
import { NOW, sampleStats } from "./testing.js";

const PLANS: PlanChoice[] = [
  { code: "free", name: "Free", monthlyPriceKobo: 0 },
  { code: "starter", name: "Starter", monthlyPriceKobo: 700_000 },
];

const partner = (extra: Partial<Partner> = {}): Partner => ({
  id: 1,
  name: "TEDxUNIUYO",
  kind: "TEDx",
  eventDate: "2026-11-28",
  place: "University of Uyo",
  contact: null,
  offer: null,
  status: "Agreed",
  sentOn: null,
  followUpOn: null,
  link: null,
  notes: null,
  ...extra,
});

function stores() {
  const leads = [partner(), partner({ id: 2, name: "Food Fest", status: "Sent" })];
  const codes = new Map<string, CodeInput>();
  const shops = new Map<string, PartnerShop>([
    ["biz-1", { id: "biz-1", name: "TEDxUNIUYO", ownerWaId: "2348031234567", live: false, planCode: "free", planUntil: null, noFee: false, about: null }],
  ]);
  const partners: PartnerStore = {
    list: async () => leads.map((l) => ({ ...l })),
    add: async () => {},
    update: async () => {},
    remove: async () => {},
  };
  const packages: PartnerPackageStore = {
    async load(p) {
      const c = p.promoCode ? codes.get(p.promoCode) : undefined;
      return {
        code: c ? { ...c, used: 3, waiting: 1, signups: 5 } : null,
        shop: p.businessId ? (shops.get(p.businessId) ?? null) : null,
      };
    },
    plans: async () => PLANS,
    async saveCode(p, c) {
      if (c.code === "DAYONES") return "DAYONES is already another partner's code. Pick another code.";
      codes.set(c.code, c);
      leads.find((l) => l.id === p.id)!.promoCode = c.code;
      return null;
    },
    async linkShop(p, waId) {
      const shop = [...shops.values()].find((s) => s.ownerWaId === waId);
      if (!shop) return `No shop has signed up from +${waId} yet.`;
      leads.find((l) => l.id === p.id)!.businessId = shop.id;
      return null;
    },
    async unlinkShop(p) {
      leads.find((l) => l.id === p.id)!.businessId = null;
    },
    async saveShop(p, s: ShopInput) {
      Object.assign(shops.get(p.businessId!)!, s);
    },
  };
  return { leads, codes, shops, partners, packages };
}

describe("partner package forms", () => {
  it("reads a discount code, in capitals and with no spaces", () => {
    expect(parseCodeForm({ code: " tedx uniuyo ", percent_off: "70", max_uses: "200", ends_on: "2027-01-31", product: "", active: "on" })).toEqual({
      code: "TEDXUNIUYO",
      percentOff: 70,
      maxUses: 200,
      endsOn: "2027-01-31",
      product: null,
      active: true,
    });
    expect(parseCodeForm({ code: "TEDX", percent_off: "50", max_uses: "", product: "quote" })).toMatchObject({ maxUses: null, endsOn: null, product: "quote", active: false });
  });

  it("refuses a bad code, percent, limit or day", () => {
    expect(parseCodeForm({ code: "AB", percent_off: "70" })).toHaveProperty("problem");
    expect(parseCodeForm({ code: "TEDX-26", percent_off: "70" })).toHaveProperty("problem");
    expect(parseCodeForm({ code: "TEDX26", percent_off: "100" })).toHaveProperty("problem");
    expect(parseCodeForm({ code: "TEDX26", percent_off: "0" })).toHaveProperty("problem");
    expect(parseCodeForm({ code: "TEDX26", percent_off: "70", max_uses: "0" })).toHaveProperty("problem");
    expect(parseCodeForm({ code: "TEDX26", percent_off: "70", ends_on: "31/01/2027" })).toHaveProperty("problem");
    expect(parseCodeForm({ code: "TEDX26", percent_off: "70", product: "farm" })).toHaveProperty("problem");
  });

  it("reads the shop settings, with no end date on Free", () => {
    expect(parseShopForm({ plan_code: "starter", plan_until: "2026-12-31", about: " Venue: main auditorium \r\n", no_fee: "on" }, PLANS)).toEqual({
      planCode: "starter",
      planUntil: "2026-12-31",
      about: "Venue: main auditorium",
      noFee: true,
    });
    expect(parseShopForm({ plan_code: "free", plan_until: "2026-12-31", about: "" }, PLANS)).toEqual({ planCode: "free", planUntil: null, about: null, noFee: false });
    expect(parseShopForm({ plan_code: "gold" }, PLANS)).toHaveProperty("problem");
    expect(parseShopForm({ plan_code: "starter", about: "x".repeat(1501) }, PLANS)).toHaveProperty("problem");
  });

  it("shows the code's use and escapes what was typed", () => {
    const html = renderPackage(
      partner({ name: "<b>Fest</b>" }),
      {
        code: { code: "TEDXUNIUYO", percentOff: 70, maxUses: 200, endsOn: "2027-01-31", product: null, active: true, used: 3, waiting: 1, signups: 5 },
        shop: { id: "b", name: "Fest <shop>", ownerWaId: null, live: true, planCode: "starter", planUntil: null, noFee: true, about: "</textarea><script>" },
      },
      PLANS,
      "2026-11-15",
    );
    expect(html).toContain("70% off the first month of any paid plan, until 31 Jan 2027");
    expect(html).toContain("3 of 200 paid, 196 places left");
    expect(html).toContain("5 signed up with it");
    expect(html).not.toContain("<b>Fest</b>");
    expect(html).not.toContain("</textarea><script>");
    expect(html).toContain('name="no_fee" checked');
  });

  it("marks a code past its last day as ended", () => {
    const html = renderPackage(
      partner(),
      { code: { code: "OLD1", percentOff: 10, maxUses: null, endsOn: "2026-11-01", product: "flyer", active: true, used: 0, waiting: 0, signups: 0 }, shop: null },
      PLANS,
      "2026-11-15",
    );
    expect(html).toContain("Ended");
    expect(html).toContain("flyer plans");
  });
});

describe("partner package pages", () => {
  const auth = { Authorization: `Basic ${btoa("jay:secret")}`, Host: "app.example.com" };
  const post = (body: Record<string, string>, origin = "https://app.example.com") =>
    ({ method: "POST", headers: { ...auth, Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }) as RequestInit;

  it("sets up an agreed partner's code and shop from the partnerships page", async () => {
    const s = stores();
    const app = createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, partners: s.partners, partnerPackages: s.packages, now: () => NOW });

    const page = await (await app.request("/partners", { headers: auth })).text();
    expect(page).toContain('id="package-1"');
    expect(page).not.toContain('id="package-2"');

    expect((await app.request("/partners/1/code", post({ code: "TEDXUNIUYO", percent_off: "70" }, "https://evil.example"))).status).toBe(403);

    const saved = await app.request("/partners/1/code", post({ code: "tedxuniuyo", percent_off: "70", max_uses: "200", ends_on: "2027-01-31", active: "on" }));
    expect(saved.headers.get("location")).toBe(`/dashboard/partners?saved=${encodeURIComponent("Code TEDXUNIUYO saved.")}#package-1`);
    expect(s.codes.get("TEDXUNIUYO")).toMatchObject({ percentOff: 70, maxUses: 200, endsOn: "2027-01-31" });

    const clash = await app.request("/partners/1/code", post({ code: "DAYONES", percent_off: "50" }));
    expect(decodeURIComponent(clash.headers.get("location")!)).toContain("problem=DAYONES is already");

    const missing = await app.request("/partners/1/shop", post({ owner_number: "0809 999 9999" }));
    expect(decodeURIComponent(missing.headers.get("location")!)).toContain("No shop has signed up from +2348099999999");
    await app.request("/partners/1/shop", post({ owner_number: "0803 123 4567" }));
    expect(s.leads[0]!.businessId).toBe("biz-1");

    await app.request("/partners/1/shop/settings", post({ plan_code: "starter", plan_until: "2026-12-31", about: "Venue: main auditorium", no_fee: "on" }));
    expect(s.shops.get("biz-1")).toMatchObject({ planCode: "starter", planUntil: "2026-12-31", about: "Venue: main auditorium", noFee: true });

    const after = await (await app.request("/partners", { headers: auth })).text();
    expect(after).toContain("TEDXUNIUYO");
    expect(after).toContain("Venue: main auditorium");

    await app.request("/partners/1/shop/unlink", post({}));
    expect(s.leads[0]!.businessId).toBeNull();
  });

  it("only gives a package to an agreed partnership", async () => {
    const s = stores();
    const app = createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, partners: s.partners, partnerPackages: s.packages, now: () => NOW });
    const res = await app.request("/partners/2/code", post({ code: "FOODFEST26", percent_off: "50" }));
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("Only an agreed partnership has a package.");
    expect(s.codes.size).toBe(0);
  });
});
