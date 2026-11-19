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
import { parseTicketForm, renderTickets, type TicketInput, type TicketRow } from "./partner-tickets.js";
import type { Partner, PartnerStore } from "./partners.js";
import { renderReport } from "./partner-report.js";
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
    ["biz-1", { id: "biz-1", name: "TEDxUNIUYO", ownerWaId: "2348031234567", live: false, planCode: "free", planUntil: null, noFee: false, about: null, address: null }],
  ]);
  const ticketRows: TicketRow[] = [];
  const savedTickets: TicketInput[] = [];
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
        tickets: p.businessId ? ticketRows : undefined,
        links: p.businessId ? { door: "https://app.example.com/door/biz-1.sig", chat: "https://wa.me/2348000000001" } : undefined,
      };
    },
    tickets(p) {
      if (!p.businessId) return null;
      return {
        rows: async () => ticketRows,
        async save(t) {
          savedTickets.push(t);
          ticketRows.push({ productId: "prod-1", variantId: `var-${ticketRows.length + 1}`, event: t.event, type: t.type, priceKobo: t.priceKobo, left: t.onSale, ticket: true, photo: Boolean(t.photo), sold: 0, checkedIn: 0 });
          return null;
        },
        async mark(productId, ticket) {
          for (const r of ticketRows) if (r.productId === productId) r.ticket = ticket;
        },
        async remove(variantId) {
          if (ticketRows.length === 1) return "That's the only thing on their price list, so it can't be removed.";
          ticketRows.splice(ticketRows.findIndex((r) => r.variantId === variantId), 1);
          return null;
        },
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
  packages.saveReminder = async (p, r) => {
    Object.assign(leads.find((l) => l.id === p.id)!, { reminderOn: r.on, eventTime: r.eventTime });
  };
  return { leads, codes, shops, partners, packages, ticketRows, savedTickets };
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
    expect(parseShopForm({ plan_code: "starter", plan_until: "2026-12-31", about: " Venue: main auditorium \r\n", no_fee: "on", address: " University of Uyo " }, PLANS)).toEqual({
      planCode: "starter",
      planUntil: "2026-12-31",
      about: "Venue: main auditorium",
      address: "University of Uyo",
      noFee: true,
    });
    expect(parseShopForm({ plan_code: "free", plan_until: "2026-12-31", about: "" }, PLANS)).toEqual({ planCode: "free", planUntil: null, about: null, address: null, noFee: false });
    expect(parseShopForm({ plan_code: "free", address: "x".repeat(201) }, PLANS)).toHaveProperty("problem");
    expect(parseShopForm({ plan_code: "gold" }, PLANS)).toHaveProperty("problem");
    expect(parseShopForm({ plan_code: "starter", about: "x".repeat(1501) }, PLANS)).toHaveProperty("problem");
  });

  it("shows the code's use and escapes what was typed", () => {
    const html = renderPackage(
      partner({ name: "<b>Fest</b>" }),
      {
        code: { code: "TEDXUNIUYO", percentOff: 70, maxUses: 200, endsOn: "2027-01-31", product: null, active: true, used: 3, waiting: 1, signups: 5 },
        shop: { id: "b", name: "Fest <shop>", ownerWaId: null, live: true, planCode: "starter", planUntil: null, noFee: true, about: "</textarea><script>", address: null },
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

describe("partner tickets", () => {
  const photo = (type: string, bytes = 10) => new File([new Uint8Array(bytes)], "ticket.jpg", { type });

  it("reads a ticket type with its price in kobo and an optional picture", async () => {
    expect(await parseTicketForm({ event: " TEDxUNIUYO  2026 ", type: "VIP", price: "₦10,000", on_sale: "150" })).toEqual({
      event: "TEDxUNIUYO 2026",
      type: "VIP",
      priceKobo: 1_000_000,
      onSale: 150,
      photo: null,
    });
    const withPhoto = await parseTicketForm({ event: "TEDxUNIUYO 2026", price: "3000", photo: photo("image/jpeg") });
    expect(withPhoto).toMatchObject({ type: "Regular", onSale: null, photo: { mimeType: "image/jpeg" } });
  });

  it("refuses a missing event, a colon, a bad price, count or picture", async () => {
    expect(await parseTicketForm({ price: "3000" })).toHaveProperty("problem");
    expect(await parseTicketForm({ event: "TEDx: 2026", price: "3000" })).toHaveProperty("problem");
    expect(await parseTicketForm({ event: "TEDx", price: "three thousand" })).toHaveProperty("problem");
    expect(await parseTicketForm({ event: "TEDx", price: "3000", on_sale: "-4" })).toHaveProperty("problem");
    expect(await parseTicketForm({ event: "TEDx", price: "3000", photo: photo("application/pdf") })).toHaveProperty("problem");
    expect(await parseTicketForm({ event: "TEDx", price: "3000", photo: photo("image/png", 6 * 1024 * 1024) })).toHaveProperty("problem");
  });

  it("lists the price list with sold and checked-in counts", () => {
    const html = renderTickets(1, [
      { productId: "p", variantId: "v", event: "TEDxUNIUYO 2026", type: "VIP", priceKobo: 1_000_000, left: 48, ticket: true, photo: true, sold: 2, checkedIn: 1 },
      { productId: "q", variantId: "w", event: "Tote <bag>", type: "Standard", priceKobo: null, left: null, ticket: false, photo: false, sold: 0, checkedIn: 0 },
    ]);
    expect(html).toContain("₦10,000");
    expect(html).toContain("2 / 1");
    expect(html).toContain("Make it a ticket");
    expect(html).toContain("No picture yet");
    expect(html).not.toContain("Tote <bag>");
    expect(html).toContain('enctype="multipart/form-data"');
  });
});

describe("partner package pages", () => {
  const auth = { Authorization: `Basic ${btoa("jay:secret")}`, Host: "app.example.com" };
  const post = (body: Record<string, string>, origin = "https://app.example.com") =>
    ({ method: "POST", headers: { ...auth, Origin: origin, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }) as RequestInit;

  it("sets up an agreed partner's code and shop from the partnerships page", async () => {
    const s = stores();
    const app = createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, partners: s.partners, partnerPackages: s.packages, now: () => NOW });

    const page = await (await app.request("/partners?view=packages", { headers: auth })).text();
    expect(page).toContain('id="package-1"');
    expect(page).not.toContain('id="package-2"');

    expect((await app.request("/partners/1/code", post({ code: "TEDXUNIUYO", percent_off: "70" }, "https://evil.example"))).status).toBe(403);

    const saved = await app.request("/partners/1/code", post({ code: "tedxuniuyo", percent_off: "70", max_uses: "200", ends_on: "2027-01-31", active: "on" }));
    expect(saved.headers.get("location")).toBe(`/dashboard/partners?view=packages&p=1&open=code&saved=${encodeURIComponent("Code TEDXUNIUYO saved.")}#package-1`);
    expect(s.codes.get("TEDXUNIUYO")).toMatchObject({ percentOff: 70, maxUses: 200, endsOn: "2027-01-31" });

    const clash = await app.request("/partners/1/code", post({ code: "DAYONES", percent_off: "50" }));
    expect(decodeURIComponent(clash.headers.get("location")!)).toContain("problem=DAYONES is already");

    const missing = await app.request("/partners/1/shop", post({ owner_number: "0809 999 9999" }));
    expect(decodeURIComponent(missing.headers.get("location")!)).toContain("No shop has signed up from +2348099999999");
    await app.request("/partners/1/shop", post({ owner_number: "0803 123 4567" }));
    expect(s.leads[0]!.businessId).toBe("biz-1");

    await app.request("/partners/1/shop/settings", post({ plan_code: "starter", plan_until: "2026-12-31", about: "Venue: main auditorium", no_fee: "on" }));
    expect(s.shops.get("biz-1")).toMatchObject({ planCode: "starter", planUntil: "2026-12-31", about: "Venue: main auditorium", noFee: true });

    const after = await (await app.request("/partners?view=packages&p=1", { headers: auth })).text();
    expect(after).toContain("TEDXUNIUYO");
    expect(after).toContain("Venue: main auditorium");
    expect(after).toContain("https://app.example.com/door/biz-1.sig");
    expect(after).toContain("https://wa.me/2348000000001");

    const form = new FormData();
    form.set("event", "TEDxUNIUYO 2026");
    form.set("type", "VIP");
    form.set("price", "10000");
    form.set("on_sale", "50");
    form.set("photo", new File([new Uint8Array(20)], "vip.png", { type: "image/png" }));
    const added = await app.request("/partners/1/tickets", { method: "POST", headers: { ...auth, Origin: "https://app.example.com" }, body: form });
    expect(decodeURIComponent(added.headers.get("location")!)).toContain("saved=TEDxUNIUYO 2026: VIP saved as a ticket.");
    expect(s.savedTickets[0]).toMatchObject({ event: "TEDxUNIUYO 2026", type: "VIP", priceKobo: 1_000_000, onSale: 50, photo: { mimeType: "image/png" } });

    await app.request("/partners/1/tickets/prod-1/off", post({}));
    expect(s.ticketRows[0]!.ticket).toBe(false);
    const only = await app.request("/partners/1/tickets/row/var-1/remove", post({}));
    expect(decodeURIComponent(only.headers.get("location")!)).toContain("only thing on their price list");

    await app.request("/partners/1/shop/unlink", post({}));
    expect(s.leads[0]!.businessId).toBeNull();
  });

  it("names the database change that's missing when saving the last day fails", async () => {
    const s = stores();
    s.packages.saveEnd = async () => {
      throw new Error("column ends_on does not exist");
    };
    const app = createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, partners: s.partners, partnerPackages: s.packages, now: () => NOW, log: { error: () => {} } });
    const res = await app.request("/partners/1/ends", post({ ends_on: "2026-11-28" }));
    const where = decodeURIComponent(res.headers.get("location")!);
    expect(where).toContain("view=packages&p=1&open=ends");
    expect(where).toContain("0092_partner_event_end.sql");
  });

  it("only gives a package to an agreed partnership", async () => {
    const s = stores();
    const app = createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, partners: s.partners, partnerPackages: s.packages, now: () => NOW });
    const res = await app.request("/partners/2/code", post({ code: "FOODFEST26", percent_off: "50" }));
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("Only an agreed partnership has a package.");
    expect(s.codes.size).toBe(0);
  });
});

describe("partner reminder and report", () => {
  const auth = { Authorization: `Basic ${btoa("jay:secret")}`, Host: "app.example.com" };
  const post = (body: Record<string, string>) =>
    ({ method: "POST", headers: { ...auth, Origin: "https://app.example.com", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }) as RequestInit;

  it("switches the reminder on with the start time and shows a preview", async () => {
    const s = stores();
    s.leads[0]!.businessId = "biz-1";
    s.shops.get("biz-1")!.address = "Main Auditorium, University of Uyo";
    const app = createDashboard({ password: "secret", stats: { load: async () => sampleStats() }, partners: s.partners, partnerPackages: s.packages, now: () => NOW });

    expect(decodeURIComponent((await app.request("/partners/1/reminder", post({ event_time: "9am" }))).headers.get("location")!)).toContain("problem=");
    await app.request("/partners/1/reminder", post({ event_time: "09:00", reminder_on: "on" }));
    expect(s.leads[0]).toMatchObject({ reminderOn: true, eventTime: "09:00" });
    const page = await (await app.request("/partners?view=packages&open=reminder", { headers: auth })).text();
    expect(page).toContain('id="part-reminder" open');
    expect(page).toContain("is tomorrow, Saturday 28 November at 9am.");
    expect(page).toContain('href="/dashboard/partners/1/report"');

    s.leads[0]!.reminderSentAt = "2026-11-27T10:00:00Z";
    expect(decodeURIComponent((await app.request("/partners/1/reminder", post({ reminder_on: "" }))).headers.get("location")!)).toContain("already gone out");
  });

  it("shows the event report for an agreed partnership only", async () => {
    const s = stores();
    const app = createDashboard({
      password: "secret",
      stats: { load: async () => sampleStats() },
      partners: s.partners,
      partnerPackages: s.packages,
      partnerReports: {
        report: async () => ({
          shopName: "TEDxUNIUYO",
          tickets: [{ name: "TEDxUNIUYO 2026: VIP", sold: 40, checkedIn: 30 }],
          ticketMoneyKobo: 40_000_000,
          people: 310,
          replies: 1_204,
          code: null,
        }),
      },
      now: () => NOW,
    });
    const report = await (await app.request("/partners/1/report", { headers: auth })).text();
    expect(report).toContain("TEDxUNIUYO 2026: VIP");
    expect(report).toContain("₦400,000");
    expect(report).toContain("75%");
    expect(report).toContain("1,204 replies sent");
    expect((await app.request("/partners/2/report", { headers: auth })).status).toBe(303);
  });

  it("says when the reminder went out", () => {
    const html = renderReport(partner({ reminderSentAt: "2026-11-27T10:00:00Z", reminderSentCount: 38 }), { shopName: null, tickets: [], ticketMoneyKobo: 0, people: 0, replies: 0, code: null }, "2026-11-29");
    expect(html).toContain("Sent the day before to 38 ticket holders.");
    expect(html).toContain("No tickets sold through yarnOga.");
  });
});
