import type { Hono } from "hono";
import { isLang } from "../../core/i18n.js";
import { formatMoney, formatNaira, isCurrency, type Currency } from "../../core/money.js";
import { showWaId } from "../../core/whatsapp/ids.js";
import { hashPassword, normaliseWaId, passwordProblem } from "../auth.js";
import type { SectionContext } from "../index.js";
import { esc, field } from "../layout.js";
import type { AppContext, Env } from "../types.js";
import type { CareSettings } from "../store.js";
import type { PlanFeature, PlanFeatures } from "../../products/quote/features.js";
import { isPhoto } from "./prices.js";
import { cleanHours, DAYS, type BusinessAbout, type Day } from "../../products/quote/about.js";
import { DEFAULT_FEE_CAP, transactionFeeKobo } from "../../products/quote/paylinks.js";

// Settings (owners only): business details and logo, bank accounts (with
// what each payment costs in fees), alert numbers, the team, and the
// owner's password.

const UUID = /^[0-9a-f-]{36}$/;

/** Paystack's fee on one payment in Nigeria: 1.5% + ₦100 (no ₦100 under ₦2,500), at most ₦2,000. */
export function paystackFeeKobo(amountKobo: number): number {
  const percent = Math.ceil((amountKobo * 15) / 1000);
  const flat = amountKobo < 250_000 ? 0 : 10_000;
  return Math.min(percent + flat, 200_000);
}

/** yarnOga's fee on a pay-link payment, from the plan's rate in hundredths of a percent, at most the cap. */
export function yarnogaFeeKobo(amountKobo: number, basisPoints: number, capKobo: number | null = DEFAULT_FEE_CAP.NGN, currency: Currency = "NGN"): number {
  return transactionFeeKobo(amountKobo, basisPoints, capKobo, currency);
}

export function registerSettings(app: Hono<Env>, ctx: SectionContext) {
  // Every settings page and form is for owners only.
  app.use("/settings/*", async (c, next) => (await ctx.ownerOnly(c)) ?? next());
  app.use("/settings", async (c, next) => (await ctx.ownerOnly(c)) ?? next());

  app.get("/settings", async (c) => {
    const biz = c.get("biz");
    const user = c.get("user");
    const [info, banks, alerts, team, logo, about, care] = await Promise.all([
      biz.data.info(),
      biz.data.banks().catch(() => []),
      biz.data.alertNumbers().catch(() => []),
      ctx.deps.users.team(biz.id).catch(() => []),
      biz.logo().catch(() => null),
      biz.data.about ? biz.data.about().catch(() => null) : Promise.resolve(null),
      biz.data.care ? biz.data.care().catch(() => null) : Promise.resolve(null),
    ]);
    const v = (x: string | null | undefined) => esc(x ?? "");
    const envNote = biz.fromEnv
      ? `<p class="flash bad">This business runs on yarnOga's main number, so its name, address and owner number are set by yarnOga. Message support to change them. Your bank accounts, alert numbers, team and logo below work as normal.</p>`
      : "";

    const fee = biz.payLinks?.on ? await biz.payLinks.feeBasisPoints().catch(() => 0) : 0;
    const cap = (biz.payLinks?.feeCap ? await biz.payLinks.feeCap().catch(() => null) : null) ?? DEFAULT_FEE_CAP[biz.currency];
    const percent = (fee / 100).toLocaleString("en-NG");
    const example = 1_000_000; // ₦10,000
    const exPaystack = paystackFeeKobo(example);
    const exOurs = yarnogaFeeKobo(example, fee, cap);
    const cfaExample = 5_000_000; // 50 000 FCFA
    const cfaOurs = yarnogaFeeKobo(cfaExample, fee, cap, biz.currency);
    const money = (minor: number) => formatMoney(minor, biz.currency);
    const feeNote = biz.currency !== "NGN"
      ? `<div class="card"><h3>About transaction fees</h3>
<ul>
<li><b>Mobile Money or bank transfer straight to you</b> (the details on your invoice): <b>no fees</b> from yarnOga. Your operator may charge its usual fees.</li>
${
  biz.payLinks?.on
    ? `<li><b>Mobile Money (MTN MoMo, Orange Money, Moov, Wave) or card through the pay link</b> on your invoices: Flutterwave takes its processing fee for your country and operator${fee ? `, and yarnOga's fee is ${percent}%, never more than ${money(cap)} a payment` : ""}. Both come out of the payment; the customer pays the order total and nothing more.</li>
${fee ? `<li>Example: on a ${money(cfaExample)} order, yarnOga keeps ${money(cfaOurs)} (${percent}% would be more, so the cap applies). You receive the rest, less Flutterwave's fee, in your Mobile Money or bank account.</li>` : ""}`
    : `<li><b>Mobile Money pay links</b> aren't on for your business yet. When they are, Flutterwave charges its processing fee and yarnOga's fee is ${fee ? `${percent}%, capped at ${money(cap)} a payment` : "shown here before anything is charged"}. Ask support to switch them on.</li>`
}
</ul><p class="muted small">Fees are taken from each payment, never charged separately.</p></div>`
      : `<div class="card"><h3>About transaction fees</h3>
<ul>
<li><b>Bank transfer straight to your account</b> (the details on your invoice): <b>no fees</b> from yarnOga or Paystack. Your bank may charge its usual fees.</li>
${
  biz.payLinks?.on
    ? `<li><b>Card, transfer or USSD through the pay link</b> on your invoices: Paystack's fee is 1.5% + ₦100 (no ₦100 on payments under ₦2,500, and never more than ₦2,000 a payment)${fee ? `, and yarnOga's fee is ${percent}%, never more than ${formatNaira(cap)} a payment` : ""}. Both come out of the payment; the customer pays the order total and nothing more.</li>
<li>Example: on a ${formatNaira(example)} order paid by pay link, Paystack keeps ${formatNaira(exPaystack)}${fee ? `, yarnOga keeps ${formatNaira(exOurs)}` : ""}, and <b>you receive ${formatNaira(example - exPaystack - exOurs)}</b>, paid into your account by Paystack (usually the next working day).</li>`
    : `<li><b>Online payments (card, transfer, USSD by pay link)</b> aren't on for your business yet. When they are, Paystack charges 1.5% + ₦100 a payment (no ₦100 under ₦2,500, at most ₦2,000) and yarnOga's fee is shown here before anything is charged. Ask support to switch them on.</li>`
}
</ul><p class="muted small">Fees are taken from each payment, never charged separately. Refunds go back through the same route.</p></div>`;

    const bankRows = banks
      .map(
        (b) => `<tr><td><b>${esc(b.bankName)}</b><br>${esc(b.accountNumber)} · ${esc(b.accountName)}</td>
<td>${b.isPrimary ? '<span class="tag lime">On invoices</span>' : `<form method="post" action="/app/settings/banks/${b.id}/primary"><button class="ghost small">Use on invoices</button></form>`}</td>
<td><form method="post" action="/app/settings/banks/${b.id}/remove"><button class="danger small">Remove</button></form></td></tr>`,
      )
      .join("");
    const bankList = ctx.deps.banks ? await ctx.deps.banks.banks().catch(() => []) : [];
    const bankInput = bankList.length
      ? `<select name="bank" required><option value="">Choose your bank</option>${bankList.map((b) => `<option value="${esc(b.code)}|${esc(b.name)}">${esc(b.name)}</option>`).join("")}</select>`
      : `<input name="bank_name" required maxlength="60" placeholder="e.g. GTBank">`;

    const alertRows = [
      ...(info?.ownerWaId ? [`<tr><td>${esc(showWaId(info.ownerWaId))}</td><td>Owner (main alert number)</td><td></td></tr>`] : []),
      ...alerts.map(
        (a) => `<tr><td>${esc(showWaId(a.waId))}</td><td>${esc(a.name ?? "")}</td><td><form method="post" action="/app/settings/alerts/${a.id}/remove"><button class="danger small">Remove</button></form></td></tr>`,
      ),
    ].join("");

    const teamRows = team
      .map(
        (m) => `<tr><td>${esc(m.name ?? "")}${m.id === user.id ? ' <span class="tag">you</span>' : ""}</td><td>${esc(showWaId(m.waId))}</td><td>${m.role === "owner" ? "Owner" : "Staff"}</td>
<td class="muted small">${m.lastLoginAt ? esc(m.lastLoginAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" })) : "never"}</td>
<td>${m.role === "staff" ? `<form method="post" action="/app/settings/team/${m.id}/remove"><button class="danger small">Remove</button></form>` : ""}</td></tr>`,
      )
      .join("");

    const body = `${envNote}
<h2 id="business">Business details</h2>
<form method="post" action="/app/settings/business" enctype="multipart/form-data" class="card">
<label>Business name<input name="name" required maxlength="80" value="${v(info?.name ?? biz.name)}"${biz.fromEnv ? " disabled" : ""}></label>
<label>What you do <span class="muted">(helps the AI understand customers, e.g. "a print shop in Ikeja")</span><input name="description" maxlength="200" value="${v(info?.description)}"${biz.fromEnv ? " disabled" : ""}></label>
<label>Address and phone <span class="muted">(printed on invoices and receipts)</span><textarea name="details" maxlength="400"${biz.fromEnv ? " disabled" : ""}>${v(info?.businessDetails)}</textarea></label>
<div class="row"><label>Your WhatsApp business number <span class="muted">(the one customers message; used on posters)</span><input name="whatsapp" inputmode="tel" value="${v(info?.whatsappNumber ? showWaId(info.whatsappNumber) : "")}" placeholder="0801 234 5678"></label>
<label>Owner's number <span class="muted">(gets new-order alerts and owner commands)</span><input name="owner" inputmode="tel" value="${v(info?.ownerWaId ? showWaId(info.ownerWaId) : "")}"${biz.fromEnv ? " disabled" : ""}></label></div>
<label>Logo <span class="muted">(JPEG or PNG; on invoices, receipts and posters)</span>${logo ? `<img src="/app/settings/logo" alt="Current logo" style="max-height:80px;display:block;margin:6px 0;background:#fff;border-radius:6px;padding:4px">` : ""}<input type="file" name="logo" accept="image/jpeg,image/png"></label>
<div class="actions"><button>Save details</button></div></form>

${aboutForm(about)}

${care ? careForm(care, await careOnPlan(biz.features)) : ""}

<h2 id="language">Language and currency</h2>
<form method="post" action="/app/settings/language" class="card">
<div class="row"><label>Bot language <span class="muted">(your messages and invoices; customers who write in French or English always get replies in their own language)</span>
<select name="language"${biz.fromEnv ? " disabled" : ""}>${option("en", "English", biz.language)}${option("fr", "Français (French)", biz.language)}</select></label>
<label>Currency <span class="muted">(your prices are in this currency)</span>
<select name="currency"${biz.fromEnv ? " disabled" : ""}>${option("NGN", "Naira (₦)", biz.currency)}${option("XOF", "CFA franc, West Africa (FCFA)", biz.currency)}${option("XAF", "CFA franc, Central Africa (FCFA)", biz.currency)}</select></label></div>
<label class="check"><input type="checkbox" name="voice" value="on"${biz.voiceReplies ? " checked" : ""}${biz.fromEnv ? " disabled" : ""}> Answer voice notes with a voice note as well as text</label>
<p class="muted small">Changing the currency doesn't convert your prices: check your price list and delivery fees afterwards.${biz.fromEnv ? " On the main number these are set by yarnOga; ask support to change them." : ""}</p>
<div class="actions"><button${biz.fromEnv ? " disabled" : ""}>Save</button></div></form>

<h2 id="banks">Bank accounts</h2>
<p class="muted">The account marked "On invoices" is printed on every invoice so customers know where to pay.${biz.fromEnv ? " (On the main number, invoices still show the details set by yarnOga until support updates them.)" : ""}</p>
<div class="scroll"><table>${bankRows || `<tr><td class="muted">No bank accounts yet.</td></tr>`}</table></div>
<details class="card" style="margin-top:12px"${banks.length ? "" : " open"}><summary><b>Add a bank account</b></summary>
<form method="post" action="/app/settings/banks"><label>Bank${bankInput}</label>
<div class="row"><label>Account number<input name="number" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" required placeholder="10 digits"></label>
<label>Account name ${bankList.length ? '<span class="muted">(checked with your bank)</span>' : ""}<input name="account_name" maxlength="100"${bankList.length ? "" : " required"}></label></div>
<div class="actions"><button>Add account</button></div></form></details>
${feeNote}

<h2 id="alerts">Alert numbers</h2>
<p class="muted">Who gets a WhatsApp message for each new order, payment and customer who asks for a person. Each number should send <b>hi</b> to your business number once, so WhatsApp lets alerts through.</p>
<div class="scroll"><table>${alertRows || `<tr><td class="muted">No alert numbers yet.</td></tr>`}</table></div>
<form method="post" action="/app/settings/alerts" class="card" style="margin-top:12px"><div class="row">
<label>WhatsApp number<input name="wa" inputmode="tel" required placeholder="0801 234 5678"></label><label>Name <span class="muted">(optional)</span><input name="name" maxlength="60" placeholder="e.g. Shop manager"></label></div>
<div class="actions"><button>Add alert number</button></div></form>

<h2 id="team">Team</h2>
<p class="muted">Staff log in by sending <b>app</b> to your business number from their own WhatsApp. They can use the inbox, orders, price list, delivery, posters and bot test, but not settings or exports.</p>
<div class="scroll"><table><tr><th>Name</th><th>WhatsApp</th><th>Role</th><th>Last login</th><th></th></tr>${teamRows}</table></div>
<form method="post" action="/app/settings/team" class="card" style="margin-top:12px"><div class="row">
<label>Name<input name="name" required maxlength="60"></label><label>WhatsApp number<input name="wa" inputmode="tel" required placeholder="0801 234 5678"></label></div>
<div class="actions"><button>Add staff member</button></div></form>

<h2 id="password">Your password</h2>
<p class="muted">${user.passwordHash ? "You have a password. Setting a new one logs out your other logins." : "Set one to log in with your number and password, without WhatsApp."}</p>
<form method="post" action="/app/settings/password" class="card"><input type="hidden" name="username" value="${esc(user.waId)}" autocomplete="username">
<label>New password <span class="muted">(at least 10 characters)</span><input type="password" name="password" required minlength="10" autocomplete="new-password"></label>
<label>Type it again<input type="password" name="again" required minlength="10" autocomplete="new-password"></label>
<div class="actions"><button>Save password</button></div></form>
<form method="post" action="/app/settings/logout-all" style="margin-top:12px"><button class="ghost small">Log out everywhere else</button></form>`;
    return ctx.render(c, "Settings", "/app/settings", body);
  });

  app.get("/settings/logo", async (c) => {
    const logo = await c.get("biz").logo();
    if (!logo) return c.notFound();
    const type = isPhoto(logo) ?? "image/png";
    return c.body(logo as unknown as ArrayBuffer, 200, { "Content-Type": type });
  });

  const done = (c: AppContext, msg: string, anchor = "") => c.redirect(`/app/settings?msg=${msg}${anchor}`, 303);

  app.post("/settings/business", async (c) => {
    const biz = c.get("biz");
    const form = (await c.req.parseBody()) as Record<string, unknown>;
    const info = await biz.data.info();
    if (!info) return done(c, "bad");
    const whatsappText = field(form, "whatsapp", 30);
    const whatsapp = whatsappText ? normaliseWaId(whatsappText) : null;
    if (whatsappText && !whatsapp) return done(c, "bad", "#business");
    if (!biz.fromEnv) {
      const name = field(form, "name", 80);
      const ownerText = field(form, "owner", 30);
      const owner = ownerText ? normaliseWaId(ownerText) : null;
      if (!name || (ownerText && !owner)) return done(c, "bad", "#business");
      await biz.data.saveInfo({
        name,
        description: field(form, "description", 200) || null,
        businessDetails: field(form, "details", 400) || null,
        ownerWaId: owner,
        whatsappNumber: whatsapp,
      });
    } else {
      await biz.data.saveInfo({ ...info, whatsappNumber: whatsapp });
    }
    const file = form.logo;
    if (file instanceof File && file.size > 0) {
      const data = new Uint8Array(await file.arrayBuffer());
      const type = isPhoto(data);
      if (!type || data.length > 5 * 1024 * 1024) return done(c, "bad", "#business");
      await biz.saveLogo(data, type);
    }
    return done(c, "saved", "#business");
  });

  app.post("/settings/care", async (c) => {
    const biz = c.get("biz");
    if (!biz.data.saveCare) return done(c, "bad", "#care");
    const form = (await c.req.parseBody()) as Record<string, unknown>;
    // A choice the plan doesn't include keeps its saved value, so it's as the owner left it after an upgrade.
    const [plan, before] = await Promise.all([careOnPlan(biz.features), biz.data.care ? biz.data.care() : null]);
    const on = (name: keyof CareSettings) => (plan[name] === true ? field(form, name, 4) === "on" : (before?.[name] ?? true));
    await biz.data.saveCare({ payReminders: on("payReminders"), ratings: on("ratings"), dailySummary: on("dailySummary") });
    return done(c, "saved", "#care");
  });

  app.post("/settings/about", async (c) => {
    const biz = c.get("biz");
    if (!biz.data.saveAbout) return done(c, "bad", "#about");
    const form = (await c.req.parseBody()) as Record<string, unknown>;
    const raw: Record<string, [string, string]> = {};
    for (const day of DAYS) {
      if (field(form, `${day}_open`, 4) !== "on") continue;
      raw[day] = [field(form, `${day}_from`, 5), field(form, `${day}_to`, 5)];
    }
    await biz.data.saveAbout(field(form, "about", 1500) || null, cleanHours(raw));
    ctx.log.info(`Owner app: ${biz.name} saved its About section`);
    return done(c, "saved", "#about");
  });

  app.post("/settings/language", async (c) => {
    const biz = c.get("biz");
    if (biz.fromEnv) return done(c, "bad", "#language");
    const form = (await c.req.parseBody()) as Record<string, unknown>;
    const language = field(form, "language", 4);
    const currency = field(form, "currency", 4);
    if (!isLang(language) || !isCurrency(currency)) return done(c, "bad", "#language");
    await biz.data.saveLanguage({ language, currency, voiceReplies: field(form, "voice", 4) === "on" });
    ctx.log.info(`Owner app: ${biz.name} set language ${language}, currency ${currency}`);
    return done(c, "saved", "#language");
  });

  app.post("/settings/banks", async (c) => {
    const biz = c.get("biz");
    const form = await c.req.parseBody();
    const number = field(form, "number", 10);
    if (!/^\d{10}$/.test(number)) return done(c, "bad", "#banks");
    let bankName = field(form, "bank_name", 60);
    let bankCode: string | null = null;
    let accountName = field(form, "account_name", 100);
    const picked = field(form, "bank", 120);
    if (picked) {
      const [code, ...name] = picked.split("|");
      bankCode = code || null;
      bankName = name.join("|");
    }
    if (ctx.deps.banks && bankCode) {
      // The bank's own name for the account, so a typo can't send customers' money elsewhere.
      const resolved = await ctx.deps.banks.resolve(number, bankCode).catch(() => null);
      if (!resolved) {
        return ctx.render(c, "Settings", "/app/settings", `<p class="flash bad">${esc(bankName)} couldn't find account ${esc(number)}. Please check the number and the bank.</p><p><a href="/app/settings#banks">Back to settings</a></p>`, 400);
      }
      accountName = resolved;
    }
    if (!bankName || !accountName) return done(c, "bad", "#banks");
    await biz.data.addBank({ bankName, bankCode, accountNumber: number, accountName });
    ctx.log.info(`Owner app: ${biz.name} added a bank account`);
    return done(c, "added", "#banks");
  });

  app.post("/settings/banks/:id/primary", async (c) => {
    if (UUID.test(c.req.param("id"))) await c.get("biz").data.setPrimaryBank(c.req.param("id"));
    return done(c, "saved", "#banks");
  });

  app.post("/settings/banks/:id/remove", async (c) => {
    if (UUID.test(c.req.param("id"))) await c.get("biz").data.removeBank(c.req.param("id"));
    return done(c, "removed", "#banks");
  });

  app.post("/settings/alerts", async (c) => {
    const form = await c.req.parseBody();
    const waId = normaliseWaId(field(form, "wa", 30));
    if (!waId) return done(c, "bad", "#alerts");
    await c.get("biz").data.addAlertNumber(waId, field(form, "name", 60) || null);
    return done(c, "added", "#alerts");
  });

  app.post("/settings/alerts/:id/remove", async (c) => {
    if (UUID.test(c.req.param("id"))) await c.get("biz").data.removeAlertNumber(c.req.param("id"));
    return done(c, "removed", "#alerts");
  });

  app.post("/settings/team", async (c) => {
    const form = await c.req.parseBody();
    const name = field(form, "name", 60);
    const waId = normaliseWaId(field(form, "wa", 30));
    if (!name || !waId) return done(c, "bad", "#team");
    await ctx.deps.users.addStaff(c.get("biz").id, waId, name);
    return done(c, "added", "#team");
  });

  app.post("/settings/team/:id/remove", async (c) => {
    if (UUID.test(c.req.param("id"))) await ctx.deps.users.removeStaff(c.get("biz").id, c.req.param("id"));
    return done(c, "removed", "#team");
  });

  app.post("/settings/password", async (c) => {
    const user = c.get("user");
    const form = await c.req.parseBody();
    const password = typeof form.password === "string" ? form.password : "";
    const again = typeof form.again === "string" ? form.again : "";
    const problem = password !== again ? "The two passwords don't match." : passwordProblem(password, user.waId);
    if (problem) {
      return ctx.render(c, "Settings", "/app/settings", `<p class="flash bad">${esc(problem)}</p><p><a href="/app/settings#password">Back to settings</a></p>`, 400);
    }
    await ctx.deps.users.setPassword(user.waId, await hashPassword(password));
    // This browser stays logged in with the new epoch.
    const fresh = await ctx.deps.users.get(user.id);
    if (fresh) await ctx.relogin(c, fresh);
    return done(c, "password", "#password");
  });

  app.post("/settings/logout-all", async (c) => {
    const user = c.get("user");
    await ctx.deps.users.bumpEpoch(user.waId);
    const fresh = await ctx.deps.users.get(user.id);
    if (fresh) await ctx.relogin(c, fresh);
    return done(c, "logout_all");
  });
}

function option(value: string, label: string, current: string): string {
  return `<option value="${value}"${value === current ? " selected" : ""}>${label}</option>`;
}

const DAY_LABELS: Record<Day, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };

/** "About your business": what the bot may tell customers, and opening hours. */
function aboutForm(about: BusinessAbout | null): string {
  const hours = about?.hours ?? null;
  const rows = (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as Day[])
    .map((d) => {
      const slot = hours?.[d];
      // With no hours saved yet, suggest a usual week so the owner only adjusts it.
      const open = hours ? Boolean(slot) : d !== "sun";
      const [from, to] = slot ?? (d === "sat" ? ["10:00", "16:00"] : ["08:00", "18:00"]);
      return `<tr><td><label class="check" style="margin:0"><input type="checkbox" name="${d}_open" value="on"${open ? " checked" : ""}> <span class="long">${DAY_LABELS[d]}</span><span class="short">${DAY_LABELS[d].slice(0, 3)}</span></label></td>
<td><input type="time" name="${d}_from" value="${from}" aria-label="${DAY_LABELS[d]} opens"></td><td><input type="time" name="${d}_to" value="${to}" aria-label="${DAY_LABELS[d]} closes"></td></tr>`;
    })
    .join("");
  return `<h2 id="about">About your business</h2>
<form method="post" action="/app/settings/about" class="card">
<label>What customers often ask <span class="muted">(where you are, landmarks, delivery days, returns, how long orders take; don't put prices here, they come from your price list)</span>
<textarea name="about" maxlength="1500" rows="6" placeholder="e.g. We're at 12 Allen Avenue, Ikeja, opposite the filling station. Orders are ready in 2 working days. We deliver Monday to Saturday. Returns within 7 days with the receipt.">${esc(about?.text ?? "")}</textarea></label>
<p style="margin:14px 0 6px"><b>Opening hours</b> <span class="muted small">(Lagos time; outside these hours the bot tells customers when you open again)</span></p>
<div class="scroll"><table class="hours"><tr><th>Day</th><th>From</th><th>To</th></tr>${rows}</table></div>
<div class="actions"><button>Save</button></div></form>`;
}

/** Which of the bot's messages the business's plan includes ("Starter" or "Pro" names the plan a missing one comes with). */
async function careOnPlan(features?: PlanFeatures): Promise<Record<keyof CareSettings, true | "Starter" | "Pro">> {
  const has = async (f: PlanFeature, plan: "Starter" | "Pro") => (!features || (await features.has(f)) ? (true as const) : plan);
  return { payReminders: await has("pay_reminders", "Starter"), ratings: await has("ratings", "Starter"), dailySummary: await has("daily_summary", "Pro") };
}

/** Which messages the bot sends for the business. */
function careForm(care: CareSettings, onPlan: Record<keyof CareSettings, true | "Starter" | "Pro">): string {
  const box = (name: keyof CareSettings, title: string, note: string) =>
    onPlan[name] === true
      ? `<label class="check" style="align-items:flex-start"><input type="checkbox" name="${name}" value="on"${care[name] ? " checked" : ""} style="margin-top:4px"> <span><b>${title}</b><br><span class="muted small">${note}</span></span></label>`
      : `<label class="check" style="align-items:flex-start"><input type="checkbox" disabled style="margin-top:4px"> <span><b>${title}</b> <span class="muted small">(comes with ${onPlan[name]} and above; send <b>plan</b> to your bot to upgrade)</span><br><span class="muted small">${note}</span></span></label>`;
  return `<h2 id="care">Messages the bot sends for you</h2>
<form method="post" action="/app/settings/care" class="card">
${box("payReminders", "Remind customers who haven't paid", "At most two friendly reminders with the pay link, about 3 and 20 hours after they confirm.")}
${box("ratings", "Ask customers how it went", "Once per paid order, with Great / OK / Not good buttons. You hear about a \"Not good\" straight away.")}
${box("dailySummary", "Morning summary to me", "Yesterday's orders, money in, unpaid orders and low stock at 8am. Tap \"Got it\" to keep it coming.")}
<p class="muted small">These only go inside WhatsApp's free 24-hour window, so they cost you nothing.</p>
<div class="actions"><button>Save</button></div></form>`;
}
