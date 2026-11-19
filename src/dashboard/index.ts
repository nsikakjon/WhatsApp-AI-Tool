import { randomBytes } from "node:crypto";
import { Hono, type Context } from "hono";
import { dashboardLogin } from "./login.js";
import { DASHBOARD_TABS, renderDashboard, type DashboardTab } from "./page.js";
import type { AdsSource } from "./ads.js";
import type { AnalyticsSource } from "./analytics.js";
import type { ShopCostSource } from "./costs.js";
import { parseFlyerPlanForm, parseQuotePlanForm, renderPlanEditor, type PlanEditorStore } from "./plans.js";
import { parseCommissionForm } from "./partner-commission.js";
import { ownerNumber, PACKAGE_PARTS, parseCodeForm, parseReminderForm, parseShopForm, renderPackage, type PackagePart, type PartnerPackageStore } from "./partner-package.js";
import { renderReport, type ReportSource } from "./partner-report.js";
import { parseOrganiserForm, renderOrganiserLink } from "./partner-organisers.js";
import { parseEndForm, reportUntil } from "./partner-access.js";
import { parseTicketForm } from "./partner-tickets.js";
import { chasedAgain, PARTNER_VIEWS, parsePartnerForm, pickPackage, renderPartners, summarisePartners, type PackagePicker, type Partner, type PartnerStore, type PartnerView } from "./partners.js";
import { parseMoneyForm, summariseMoney, type MoneyStore } from "./profit.js";
import { parseBalanceForm, summariseBalance, type BalanceStore } from "./balance.js";
import type { SocialsSource } from "./socials.js";
import { lagosDays, type StatsSource } from "./stats.js";
import { parseProgress, parseVisitForm, pickDay, renderTally, summariseTally, TALLY_VIEWS, type TallyStore } from "./tally.js";
import type { WebsiteStatsSource } from "./visits.js";
import { exchangeTikTokCode, tiktokAuthorizeUrl, type TikTokApp } from "./tiktok.js";

// The owner's analytics page at /dashboard. Sign in on /dashboard/login with
// DASHBOARD_PASSWORD (login.ts). It only reads from the database, except for
// the profit and loss entries and balance sheet lines the owner types in.

export interface DashboardDeps {
  password: string;
  stats: StatsSource;
  socials?: SocialsSource;
  /** yarnoga.com visitor numbers. */
  website?: WebsiteStatsSource;
  /** Google Analytics numbers for yarnoga.com. */
  analytics?: AnalyticsSource;
  /** Money in and out, for the profit and loss section. */
  money?: MoneyStore;
  /** What yarnOga owns and owes, for the balance sheet. */
  balance?: BalanceStore;
  /** What each shop costs us against what it pays (SHOP_COSTS). */
  costs?: ShopCostSource;
  /** Leads from WhatsApp ads on every number (AD_LEADS). */
  ads?: AdsSource;
  /** The door-to-door tally sheet at /dashboard/tally. */
  tally?: TallyStore;
  /** Events and organisers we pitch partnerships to, at /dashboard/partners. */
  partners?: PartnerStore;
  /** Discount codes and shops for agreed partners, on the same page. */
  partnerPackages?: PartnerPackageStore;
  /** The event report for an agreed partnership. */
  partnerReports?: ReportSource;
  /** The plan editor at /dashboard/plans (PLAN_EDITOR). */
  plans?: PlanEditorStore;
  /** Adds a link to the "Numbers to connect" queue on /quote-setup (QUOTE_NUMBER_QUEUE). */
  numberQueue?: boolean;
  /** The TikTok developer app, for the one-time connect button. */
  tiktokApp?: TikTokApp;
  fetch?: typeof fetch;
  now?: () => Date;
  log?: Pick<Console, "error">;
}

export function createDashboard(deps: DashboardDeps) {
  const app = new Hono();
  const log = deps.log ?? console;

  app.use("*", dashboardLogin(app, { password: deps.password, now: deps.now }));

  app.get("/", async (c) => {
    c.header("Cache-Control", "no-store");
    try {
      const now = deps.now?.() ?? new Date();
      const [stats, socials, website, analytics, money, costs, ads, balance] = await Promise.all([
        deps.stats.load(now),
        deps.socials?.load(now) ?? [],
        // A website problem (say, the table isn't created yet) mustn't hide everything else.
        deps.website?.load(now).catch((err) => {
          log.error("Website visits failed to load:", err);
          return "error" as const;
        }),
        deps.analytics?.load(now),
        deps.money?.list().then(summariseMoney).catch((err) => {
          log.error("Profit and loss failed to load:", err);
          return "error" as const;
        }),
        deps.costs?.load(now).catch((err) => {
          log.error("Shop costs failed to load:", err);
          return "error" as const;
        }),
        deps.ads?.load(now).catch((err) => {
          log.error("Ad leads failed to load:", err);
          return "error" as const;
        }),
        deps.balance &&
          Promise.all([
            deps.balance.list(),
            deps.balance.heldForShops().catch((err) => {
              log.error("Shops' payout balances failed to load:", err);
              return "error" as const;
            }),
          ])
            .then(([items, held]) => summariseBalance(items, held))
            .catch((err) => {
              log.error("Balance sheet failed to load:", err);
              return "error" as const;
            }),
      ]);
      const problem = c.req.query("problem")?.slice(0, 200);
      const editId = Number(c.req.query("edit")) || undefined;
      const asked = c.req.query("tab") as DashboardTab | undefined;
      return c.html(
        renderDashboard(stats, {
          tab: asked && DASHBOARD_TABS.includes(asked) ? asked : "overview",
          show: c.req.query("show"),
          socials,
          website,
          analytics,
          profit: money && { pnl: money, now, problem, editId },
          balance: balance && { sheet: balance, now, problem, editId },
          costs,
          ads,
          planEditor: Boolean(deps.plans),
          numberQueue: deps.numberQueue,
          tallySheet: Boolean(deps.tally),
          partners: Boolean(deps.partners),
        }),
      );
    } catch (err) {
      log.error("Dashboard failed to load:", err);
      return c.text("The dashboard couldn't read the database just now. Please refresh in a minute.", 500);
    }
  });

  // Adding, editing and removing profit and loss entries. The browser re-sends the
  // password to any site that posts a form here, so only forms sent from the
  // dashboard itself are accepted.
  const backToMoney = (problem?: string, editId?: number) =>
    `/dashboard?tab=money${editId ? `&edit=${editId}` : ""}${problem ? `&problem=${encodeURIComponent(problem)}` : ""}#${editId ? "edit" : "money"}`;

  app.post("/money", async (c) => {
    if (!deps.money || !fromDashboard(c.req.header("origin"), c.req.header("referer"), c.req.header("host"))) {
      return c.text("Not allowed.", 403);
    }
    const line = parseMoneyForm(await c.req.parseBody());
    if ("problem" in line) return c.redirect(backToMoney(line.problem), 303);
    try {
      await deps.money.add(line);
    } catch (err) {
      log.error("Couldn't save a money line:", err);
      return c.redirect(backToMoney("Couldn't save that just now. Please try again."), 303);
    }
    return c.redirect(backToMoney(), 303);
  });

  app.post("/money/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!deps.money || !fromDashboard(c.req.header("origin"), c.req.header("referer"), c.req.header("host"))) {
      return c.text("Not allowed.", 403);
    }
    if (!Number.isSafeInteger(id) || id <= 0) return c.redirect(backToMoney(), 303);
    const line = parseMoneyForm(await c.req.parseBody());
    if ("problem" in line) return c.redirect(backToMoney(line.problem, id), 303);
    try {
      await deps.money.update(id, line);
    } catch (err) {
      log.error("Couldn't change a money line:", err);
      return c.redirect(backToMoney("Couldn't save that change just now. Please try again.", id), 303);
    }
    return c.redirect(backToMoney(), 303);
  });

  app.post("/money/:id/delete", async (c) => {
    const id = Number(c.req.param("id"));
    if (!deps.money || !fromDashboard(c.req.header("origin"), c.req.header("referer"), c.req.header("host"))) {
      return c.text("Not allowed.", 403);
    }
    if (!Number.isSafeInteger(id) || id <= 0) return c.redirect(backToMoney(), 303);
    try {
      await deps.money.remove(id);
    } catch (err) {
      log.error("Couldn't remove a money line:", err);
      return c.redirect(backToMoney("Couldn't remove that just now. Please try again."), 303);
    }
    return c.redirect(backToMoney(), 303);
  });

  // Adding, editing and removing balance sheet lines, from the dashboard only.
  const backToBalance = (problem?: string, editId?: number) =>
    `/dashboard?tab=money&show=balance${editId ? `&edit=${editId}` : ""}${problem ? `&problem=${encodeURIComponent(problem)}` : ""}#${editId ? "edit" : "balance"}`;
  const balanceAllowed = (c: Context) =>
    Boolean(deps.balance) && fromDashboard(c.req.header("origin"), c.req.header("referer"), c.req.header("host"));

  app.post("/balance", async (c) => {
    if (!balanceAllowed(c)) return c.text("Not allowed.", 403);
    const item = parseBalanceForm(await c.req.parseBody());
    if ("problem" in item) return c.redirect(backToBalance(item.problem), 303);
    try {
      await deps.balance!.add(item);
    } catch (err) {
      log.error("Couldn't save a balance sheet line:", err);
      return c.redirect(backToBalance("Couldn't save that just now. If 0095_balance_sheet.sql hasn't been run yet, run it, then try again."), 303);
    }
    return c.redirect(backToBalance(), 303);
  });

  app.post("/balance/:id", async (c) => {
    if (!balanceAllowed(c)) return c.text("Not allowed.", 403);
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id <= 0) return c.redirect(backToBalance(), 303);
    const item = parseBalanceForm(await c.req.parseBody());
    if ("problem" in item) return c.redirect(backToBalance(item.problem, id), 303);
    try {
      await deps.balance!.update(id, item);
    } catch (err) {
      log.error("Couldn't change a balance sheet line:", err);
      return c.redirect(backToBalance("Couldn't save that change just now. Please try again.", id), 303);
    }
    return c.redirect(backToBalance(), 303);
  });

  app.post("/balance/:id/delete", async (c) => {
    if (!balanceAllowed(c)) return c.text("Not allowed.", 403);
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id <= 0) return c.redirect(backToBalance(), 303);
    try {
      await deps.balance!.remove(id);
    } catch (err) {
      log.error("Couldn't remove a balance sheet line:", err);
      return c.redirect(backToBalance("Couldn't remove that just now. Please try again."), 303);
    }
    return c.redirect(backToBalance(), 303);
  });

  // The door-to-door tally sheet: add a shop, update its ticks, remove it.
  const today = () => lagosDays(deps.now?.() ?? new Date(), 1)[0]!.date;
  const backToTally = (day: string, problem?: string) =>
    `/dashboard/tally?day=${day}${problem ? `&problem=${encodeURIComponent(problem)}` : ""}#day`;
  const tallyAllowed = (c: Context) =>
    Boolean(deps.tally) && fromDashboard(c.req.header("origin"), c.req.header("referer"), c.req.header("host"));

  app.get("/tally", async (c) => {
    if (!deps.tally) return c.notFound();
    c.header("Cache-Control", "no-store");
    const now = today();
    const day = pickDay(c.req.query("day"), now);
    const tally = await deps.tally
      .list()
      .then((visits) => summariseTally(visits, day))
      .catch((err) => {
        log.error("Tally sheet failed to load:", err);
        return "error" as const;
      });
    const view = TALLY_VIEWS.find((v) => v === c.req.query("view"));
    return c.html(renderTally(tally, now, day, c.req.query("problem")?.slice(0, 200), view));
  });

  app.post("/tally", async (c) => {
    if (!tallyAllowed(c)) return c.text("Not allowed.", 403);
    const form = await c.req.parseBody();
    const day = pickDay(typeof form.date === "string" ? form.date : undefined, today());
    const visit = parseVisitForm(form);
    if ("problem" in visit) return c.redirect(backToTally(day, visit.problem), 303);
    try {
      await deps.tally!.add(visit);
    } catch (err) {
      log.error("Couldn't save a door visit:", err);
      return c.redirect(backToTally(day, "Couldn't save that just now. Please try again."), 303);
    }
    return c.redirect(backToTally(day), 303);
  });

  app.post("/tally/:id", async (c) => {
    if (!tallyAllowed(c)) return c.text("Not allowed.", 403);
    const id = Number(c.req.param("id"));
    const form = await c.req.parseBody();
    const day = pickDay(typeof form.day === "string" ? form.day : undefined, today());
    if (!Number.isSafeInteger(id) || id <= 0) return c.redirect(backToTally(day), 303);
    const progress = parseProgress(form);
    if ("problem" in progress) return c.redirect(backToTally(day, progress.problem), 303);
    try {
      await deps.tally!.update(id, progress);
    } catch (err) {
      log.error("Couldn't update a door visit:", err);
      return c.redirect(backToTally(day, "Couldn't save that just now. Please try again."), 303);
    }
    return c.redirect(backToTally(day), 303);
  });

  app.post("/tally/:id/delete", async (c) => {
    if (!tallyAllowed(c)) return c.text("Not allowed.", 403);
    const id = Number(c.req.param("id"));
    const form = await c.req.parseBody();
    const day = pickDay(typeof form.day === "string" ? form.day : undefined, today());
    if (!Number.isSafeInteger(id) || id <= 0) return c.redirect(backToTally(day), 303);
    try {
      await deps.tally!.remove(id);
    } catch (err) {
      log.error("Couldn't remove a door visit:", err);
      return c.redirect(backToTally(day, "Couldn't remove that just now. Please try again."), 303);
    }
    return c.redirect(backToTally(day), 303);
  });

  // The partnerships list: add a lead, change it, remove it.
  const backToPartners = (problem?: string, editId?: number, saved?: string) =>
    `/dashboard/partners?view=leads${editId ? `&edit=${editId}` : ""}${problem ? `&problem=${encodeURIComponent(problem)}` : saved ? `&saved=${encodeURIComponent(saved)}` : ""}${editId ? "#edit" : ""}`;
  const partnersAllowed = (c: Context) =>
    Boolean(deps.partners) && fromDashboard(c.req.header("origin"), c.req.header("referer"), c.req.header("host"));

  app.get("/partners", async (c) => {
    if (!deps.partners) return c.notFound();
    c.header("Cache-Control", "no-store");
    const summary = await deps.partners
      .list()
      .then(summarisePartners)
      .catch((err) => {
        log.error("Partnerships list failed to load:", err);
        return "error" as const;
      });
    const view = c.req.query("view") as PartnerView | undefined;
    const asked = Number(c.req.query("p")) || undefined;
    let packages: PackagePicker | undefined;
    const agreed = summary === "error" ? [] : summary.all.filter((p) => p.status === "Agreed");
    const current = pickPackage(agreed, asked, today());
    // Only the one package on show is loaded.
    if (view === "packages" && deps.partnerPackages && current) {
      const store = deps.partnerPackages;
      const [plans, pkg] = await Promise.all([
        store.plans().catch((err) => {
          log.error("Plans failed to load for partner packages:", err);
          return [];
        }),
        store.load(current).catch((err) => {
          log.error(`Partner package for ${current.name} failed to load:`, err);
          return "error" as const;
        }),
      ]);
      const open = PACKAGE_PARTS.find((part) => part === c.req.query("open"));
      packages = { agreed, current: current.id, html: renderPackage(current, pkg, plans, today(), open) };
    }
    return c.html(
      renderPartners(summary, today(), {
        view: view && PARTNER_VIEWS.includes(view) ? view : undefined,
        filter: c.req.query("filter"),
        showAll: c.req.query("all") === "1",
        editId: Number(c.req.query("edit")) || undefined,
        problem: c.req.query("problem")?.slice(0, 200),
        saved: c.req.query("saved")?.slice(0, 120),
        packages,
      }),
    );
  });

  app.post("/partners", async (c) => {
    if (!partnersAllowed(c)) return c.text("Not allowed.", 403);
    const lead = parsePartnerForm(await c.req.parseBody(), today());
    if ("problem" in lead) return c.redirect(backToPartners(lead.problem), 303);
    try {
      await deps.partners!.add(lead);
    } catch (err) {
      log.error("Couldn't save a partner lead:", err);
      return c.redirect(backToPartners("Couldn't save that just now. Please try again."), 303);
    }
    return c.redirect(backToPartners(undefined, undefined, `${lead.name} added.`), 303);
  });

  app.post("/partners/:id", async (c) => {
    if (!partnersAllowed(c)) return c.text("Not allowed.", 403);
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id <= 0) return c.redirect(backToPartners(), 303);
    const lead = parsePartnerForm(await c.req.parseBody(), today());
    if ("problem" in lead) return c.redirect(backToPartners(lead.problem, id), 303);
    try {
      await deps.partners!.update(id, lead);
    } catch (err) {
      log.error("Couldn't change a partner lead:", err);
      return c.redirect(backToPartners("Couldn't save that change just now. Please try again.", id), 303);
    }
    return c.redirect(backToPartners(undefined, undefined, `${lead.name} saved.`), 303);
  });

  // "Chased": keeps the lead as it is and sets the next follow-up a few days from today.
  app.post("/partners/:id/chased", async (c) => {
    if (!partnersAllowed(c)) return c.text("Not allowed.", 403);
    const id = Number(c.req.param("id"));
    const back = (notice: string, key = "saved") => `/dashboard/partners?${key}=${encodeURIComponent(notice)}`;
    try {
      const lead = (await deps.partners!.list()).find((p) => p.id === id);
      if (!lead) return c.redirect(back("That lead isn't on the list any more.", "problem"), 303);
      const next = chasedAgain(lead, today());
      await deps.partners!.update(id, next);
      return c.redirect(back(`${lead.name}: next follow-up ${next.followUpOn}.`), 303);
    } catch (err) {
      log.error("Couldn't mark a partner lead chased:", err);
      return c.redirect(back("Couldn't save that just now. Please try again.", "problem"), 303);
    }
  });

  app.post("/partners/:id/delete", async (c) => {
    if (!partnersAllowed(c)) return c.text("Not allowed.", 403);
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id <= 0) return c.redirect(backToPartners(), 303);
    try {
      await deps.partners!.remove(id);
    } catch (err) {
      log.error("Couldn't remove a partner lead:", err);
      return c.redirect(backToPartners("Couldn't remove that just now. Please try again."), 303);
    }
    return c.redirect(backToPartners(), 303);
  });

  // A partner's package: the discount code and their shop.
  const backToPackage = (id: number, notice: { problem?: string; saved?: string }, part?: PackagePart) => {
    const [key, value] = notice.problem ? ["problem", notice.problem] : ["saved", notice.saved ?? "Saved."];
    return `/dashboard/partners?view=packages&p=${id}${part ? `&open=${part}` : ""}&${key}=${encodeURIComponent(value)}#package-${id}`;
  };
  const agreedPartner = async (c: Context): Promise<Partner | null> => {
    const id = Number(c.req.param("id"));
    if (!Number.isSafeInteger(id) || id <= 0) return null;
    const partner = (await deps.partners!.list()).find((p) => p.id === id);
    return partner?.status === "Agreed" ? partner : null;
  };
  const packageRoute = (path: string, run: (p: Partner, form: Record<string, unknown>, c: Context) => Promise<{ problem?: string; saved?: string }>) =>
    app.post(path, async (c) => {
      if (!deps.partnerPackages || !partnersAllowed(c)) return c.text("Not allowed.", 403);
      try {
        const partner = await agreedPartner(c);
        if (!partner) return c.redirect(backToPartners("Only an agreed partnership has a package."), 303);
        return c.redirect(backToPackage(partner.id, await run(partner, await c.req.parseBody(), c), PACKAGE_PARTS.find((part) => part === path.split("/")[3])), 303);
      } catch (err) {
        log.error("Couldn't save a partner package:", err);
        const migration = path.endsWith("/ends") ? "0092_partner_event_end.sql" : path.endsWith("/commission") ? "0096_partner_commission.sql" : "0089_partner_packages.sql";
        const problem = `Couldn't save that just now. If ${migration} hasn't been run yet, run it, then try again.`;
        const id = Number(c.req.param("id"));
        return c.redirect(Number.isSafeInteger(id) && id > 0 ? backToPackage(id, { problem }, PACKAGE_PARTS.find((part) => part === path.split("/")[3])) : backToPartners(problem), 303);
      }
    });

  packageRoute("/partners/:id/code", async (p, form) => {
    const code = parseCodeForm(form);
    if ("problem" in code) return code;
    const problem = await deps.partnerPackages!.saveCode(p, code);
    return problem ? { problem } : { saved: `Code ${code.code} saved.` };
  });
  packageRoute("/partners/:id/commission", async (p, form) => {
    const commission = parseCommissionForm(form);
    if ("problem" in commission) return commission;
    await deps.partnerPackages!.saveCommission(p, commission);
    return { saved: "Commission saved." };
  });
  packageRoute("/partners/:id/shop", async (p, form) => {
    const waId = ownerNumber(form);
    if (!waId) return { problem: "Type the WhatsApp number they signed up from, e.g. 0803 123 4567." };
    const problem = await deps.partnerPackages!.linkShop(p, waId);
    return problem ? { problem } : { saved: "Shop linked." };
  });
  packageRoute("/partners/:id/shop/create", async (p) => {
    const problem = await deps.partnerPackages!.createShop(p);
    return problem ? { problem } : { saved: `Shop created for ${p.name}. Give it a keyword and make their logins below.` };
  });
  packageRoute("/partners/:id/shop/settings", async (p, form) => {
    if (!p.businessId) return { problem: "Link their shop first." };
    const shop = parseShopForm(form, await deps.partnerPackages!.plans());
    if ("problem" in shop) return shop;
    const problem = await deps.partnerPackages!.saveShop(p, shop);
    return problem ? { problem } : { saved: "Shop saved. The bot picks it up within a minute." };
  });
  const ticketsOf = (p: Partner) => {
    const admin = deps.partnerPackages!.tickets(p);
    if (!admin) throw new Error("No shop linked to this partner.");
    return admin;
  };
  packageRoute("/partners/:id/tickets", async (p, form) => {
    if (!p.businessId) return { problem: "Link their shop first." };
    const ticket = await parseTicketForm(form);
    if ("problem" in ticket) return ticket;
    const problem = await ticketsOf(p).save(ticket);
    return problem ? { problem } : { saved: `${ticket.event}: ${ticket.type} saved as a ticket.` };
  });
  for (const [state, on] of [["on", true], ["off", false]] as const) {
    packageRoute(`/partners/:id/tickets/:product/${state}`, async (p, _form, c) => {
      if (!p.businessId) return { problem: "Link their shop first." };
      await ticketsOf(p).mark(c.req.param("product")!, on);
      return { saved: on ? "Now sold as a ticket with a QR code." : "No longer sold as a ticket." };
    });
  }
  packageRoute("/partners/:id/tickets/row/:variant/remove", async (p, _form, c) => {
    if (!p.businessId) return { problem: "Link their shop first." };
    const problem = await ticketsOf(p).remove(c.req.param("variant")!);
    return problem ? { problem } : { saved: "Taken off their price list." };
  });
  packageRoute("/partners/:id/reminder", async (p, form) => {
    if (p.reminderSentAt) return { problem: "The reminder has already gone out." };
    const reminder = parseReminderForm(form);
    if ("problem" in reminder) return reminder;
    if (reminder.on && !p.eventDate) return { problem: "Set the event day on the lead (Edit) first." };
    await deps.partnerPackages!.saveReminder(p, reminder);
    return { saved: reminder.on ? "Reminder on." : "Reminder saved, switched off." };
  });

  packageRoute("/partners/:id/ends", async (p, form) => {
    const end = parseEndForm(form);
    if ("problem" in end) return end;
    await deps.partnerPackages!.saveEnd(p, end.endsOn);
    return { saved: end.endsOn ? `Last day saved. Organisers keep the event report until ${reportUntil(end.endsOn)}.` : "Last day cleared." };
  });

  app.post("/partners/:id/organisers", async (c) => {
    if (!deps.partnerPackages || !partnersAllowed(c)) return c.text("Not allowed.", 403);
    c.header("Cache-Control", "no-store");
    try {
      const partner = await agreedPartner(c);
      if (!partner) return c.redirect(backToPartners("Only an agreed partnership has a package."), 303);
      const who = parseOrganiserForm(await c.req.parseBody());
      if ("problem" in who) return c.redirect(backToPackage(partner.id, who, "organisers"), 303);
      const login = await deps.partnerPackages.organiserLogin(partner, who);
      if (login && "problem" in login) return c.redirect(backToPackage(partner.id, login, "organisers"), 303);
      if (!login) return c.redirect(backToPackage(partner.id, { problem: "Link their shop first, and check the owner app is switched on." }, "organisers"), 303);
      return c.html(renderOrganiserLink(partner, who, login, deps.partnerPackages.doorLink(partner)));
    } catch (err) {
      log.error("Couldn't make an organiser login:", err);
      return c.redirect(backToPartners("Couldn't make that login just now. If 0091_organiser_role.sql hasn't been run yet, run it, then try again."), 303);
    }
  });

  app.get("/partners/:id/report", async (c) => {
    if (!deps.partners || !deps.partnerPackages || !deps.partnerReports) return c.notFound();
    c.header("Cache-Control", "no-store");
    const partner = await agreedPartner(c).catch(() => null);
    if (!partner) return c.redirect(backToPartners("Only an agreed partnership has a report."), 303);
    const report = await deps.partnerPackages
      .load(partner)
      .then((pkg) => deps.partnerReports!.report(partner, pkg.code))
      .catch((err) => {
        log.error("Partner report failed:", err);
        return "error" as const;
      });
    return c.html(renderReport(partner, report, today()));
  });

  packageRoute("/partners/:id/shop/unlink", async (p) => {
    await deps.partnerPackages!.unlinkShop(p);
    return { saved: "Shop unlinked." };
  });

  // The plan editor: one form per plan, each saved on its own.
  const backToPlans = (anchor: string, notice: { saved?: string; problem?: string }) => {
    const [key, value] = notice.problem ? ["problem", notice.problem] : ["saved", notice.saved ?? ""];
    return `/dashboard/plans?${key}=${encodeURIComponent(value)}#${anchor}`;
  };

  app.get("/plans", async (c) => {
    if (!deps.plans) return c.notFound();
    c.header("Cache-Control", "no-store");
    const notice = { saved: c.req.query("saved")?.slice(0, 60), problem: c.req.query("problem")?.slice(0, 200) };
    const plans = await deps.plans.load().catch((err) => {
      log.error("Plans failed to load:", err);
      return "error" as const;
    });
    return c.html(renderPlanEditor(plans, notice));
  });

  app.post("/plans/quote/:code", async (c) => {
    if (!deps.plans || !fromDashboard(c.req.header("origin"), c.req.header("referer"), c.req.header("host"))) {
      return c.text("Not allowed.", 403);
    }
    const code = c.req.param("code");
    const anchor = `quote-${code}`;
    try {
      const plan = (await deps.plans.load()).quote.find((p) => p.code === code);
      if (!plan) return c.redirect(backToPlans("quote", { problem: "That plan doesn't exist any more." }), 303);
      const edit = parseQuotePlanForm(await c.req.parseBody(), plan.features.map((f) => f.feature));
      if ("problem" in edit) return c.redirect(backToPlans(anchor, edit), 303);
      await deps.plans.saveQuotePlan(code, edit.plan, edit.features);
      return c.redirect(backToPlans(anchor, { saved: plan.name }), 303);
    } catch (err) {
      log.error(`Couldn't save quote plan ${code}:`, err);
      return c.redirect(backToPlans(anchor, { problem: "Couldn't save that just now. Please try again." }), 303);
    }
  });

  app.post("/plans/flyer/:id", async (c) => {
    if (!deps.plans || !fromDashboard(c.req.header("origin"), c.req.header("referer"), c.req.header("host"))) {
      return c.text("Not allowed.", 403);
    }
    const id = c.req.param("id");
    const anchor = `flyer-${id}`;
    const edit = parseFlyerPlanForm(await c.req.parseBody());
    if ("problem" in edit) return c.redirect(backToPlans(anchor, edit), 303);
    try {
      await deps.plans.saveFlyerPlan(id, edit);
    } catch (err) {
      log.error(`Couldn't save flyer plan ${id}:`, err);
      return c.redirect(backToPlans(anchor, { problem: "Couldn't save that just now. Please try again." }), 303);
    }
    return c.redirect(backToPlans(anchor, { saved: `the ${id} flyer plan` }), 303);
  });

  // Connecting TikTok: send the owner to TikTok to allow access, then show the
  // key TikTok hands back so they can paste it into Railway.
  const pendingStates = new Set<string>();
  const callbackUrl = (host: string | undefined) => `https://${host}/dashboard/tiktok/callback`;

  app.get("/tiktok/connect", (c) => {
    if (!deps.tiktokApp) {
      return c.text("Add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET on Railway first (see docs/DASHBOARD.md).", 400);
    }
    const state = randomBytes(16).toString("hex");
    pendingStates.add(state);
    return c.redirect(tiktokAuthorizeUrl(deps.tiktokApp, callbackUrl(c.req.header("host")), state));
  });

  app.get("/tiktok/callback", async (c) => {
    c.header("Cache-Control", "no-store");
    const state = c.req.query("state") ?? "";
    const code = c.req.query("code");
    if (!deps.tiktokApp || !pendingStates.delete(state) || !code) {
      return c.text("This TikTok sign-in link has expired. Open /dashboard/tiktok/connect and try again.", 400);
    }
    try {
      const tokens = await exchangeTikTokCode(
        deps.fetch ?? fetch,
        deps.tiktokApp,
        code,
        callbackUrl(c.req.header("host")),
      );
      return c.html(tiktokConnectedPage(tokens.refreshToken));
    } catch (err) {
      log.error("TikTok connect failed:", err);
      return c.text(`TikTok sign-in didn't finish: ${err instanceof Error ? err.message : String(err)}`, 502);
    }
  });

  return app;
}

function tiktokConnectedPage(refreshToken: string): string {
  const safe = refreshToken.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>TikTok connected</title>
<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#0c0d0d;color:#f3f4ef}main{max-width:640px;margin:0 auto;padding:32px 16px}
code{display:block;word-break:break-all;background:#191a1a;border:1px solid #2e302f;border-radius:8px;padding:12px;margin:12px 0;user-select:all}a{color:#c6ff1f}</style></head>
<body><main><h1>TikTok connected</h1>
<p>One last step. Copy this key, then in Railway open <b>Variables</b> and add it as <b>TIKTOK_REFRESH_TOKEN</b>:</p>
<code>${safe}</code>
<p>Keep it private, like a password. After Railway redeploys, your TikTok numbers appear on the <a href="/dashboard">dashboard</a>. The key lasts about a year; when TikTok stops loading, open this connect page again.</p>
</main></body></html>`;
}

/** True when a form was sent from a page on this same server. */
export function fromDashboard(origin: string | undefined, referer: string | undefined, host: string | undefined): boolean {
  const source = origin && origin !== "null" ? origin : referer;
  if (!source || !host) return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}

/** Compares in constant time, so response timing can't reveal the password letter by letter. */
