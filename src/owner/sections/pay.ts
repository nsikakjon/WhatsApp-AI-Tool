import type { Hono } from "hono";
import { formatNaira, parseMoney } from "../../core/money.js";
import { showWaId } from "../../core/whatsapp/ids.js";
import type { SectionContext } from "../index.js";
import { esc, field } from "../layout.js";
import { PaymentsHeld } from "../../products/quote/paylinks.js";
import { MIN_PAYOUT_KOBO, MIN_TOPUP_KOBO, type Payout, type PayoutStatus, type Recipient, type UnpaidDelivery } from "../payouts.js";
import type { AppContext, Env } from "../types.js";

// Pay people (QUOTE_PAYOUTS): the payout balance, riders' delivery pay and
// staff wages. Owners and managers can pay; only the owner can set where
// each person's money goes, so nobody else can swap in their own account.

const UUID = /^[0-9a-f-]{36}$/;
const DELIVERY_DAYS = 30;

/** A rider or staff member who can be paid. `key` is "rider:<id>" or "staff:<id>". */
export interface Payee {
  key: string;
  name: string;
  role: string;
  waId: string;
  recipient: Recipient | null;
}

const STATUS: Record<Exclude<PayoutStatus, "draft">, { label: string; tag: string }> = {
  sending: { label: "Sending", tag: "amber" },
  pending: { label: "Bank processing", tag: "amber" },
  otp: { label: "Held by Paystack", tag: "amber" },
  success: { label: "Paid", tag: "lime" },
  failed: { label: "Failed, money returned", tag: "red" },
  reversed: { label: "Reversed, money returned", tag: "red" },
};

const SEND_FLASH: Record<string, string> = {
  sent: "pay_sent",
  pending: "pay_pending",
  failed: "pay_failed",
  unsure: "pay_unsure",
  otp: "pay_otp",
  low: "pay_low",
  expired: "pay_expired",
  gone: "pay_gone",
  paid: "pay_twice",
};

export function accountLabel(r: Pick<Recipient, "bankName" | "accountNumber">): string {
  return `${r.bankName} ••••${r.accountNumber.slice(-4)}`;
}

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });

export function registerPay(app: Hono<Env>, ctx: SectionContext) {
  app.use("/pay", gate);
  app.use("/pay/*", gate);
  async function gate(c: AppContext, next: () => Promise<void>) {
    const denied = ctx.need(c, "pay_out");
    if (denied) return denied;
    if (!c.get("biz").payouts) return c.redirect("/home", 303);
    await next();
  }

  async function payees(c: AppContext): Promise<Payee[]> {
    const biz = c.get("biz");
    const [riders, team, recipients] = await Promise.all([
      biz.delivery ? biz.delivery.riders() : Promise.resolve([]),
      ctx.deps.users.team(biz.id),
      biz.payouts!.service.store.recipients(),
    ]);
    return [
      ...riders.map((r) => ({ key: `rider:${r.id}`, name: r.name, role: "Rider", waId: r.waId, recipient: recipients.find((x) => x.riderId === r.id) ?? null })),
      ...team
        .filter((u) => u.role !== "owner")
        .map((u) => ({
          key: `staff:${u.id}`,
          name: u.name ?? showWaId(u.waId),
          role: u.role[0]!.toUpperCase() + u.role.slice(1),
          waId: u.waId,
          recipient: recipients.find((x) => x.userId === u.id) ?? null,
        })),
    ];
  }

  app.get("/pay", async (c) => {
    const biz = c.get("biz");
    const owner = c.get("user").role === "owner";
    const store = biz.payouts!.service.store;
    const since = new Date(ctx.now().getTime() - DELIVERY_DAYS * 86_400_000);
    const [balance, people, owed, recent] = await Promise.all([store.balance(), payees(c), biz.delivery ? store.unpaidDeliveries(since) : Promise.resolve([]), store.recent(30)]);
    const bankList = owner && ctx.deps.banks ? await ctx.deps.banks.banks().catch(() => []) : [];

    const bankForm = (p: Payee) =>
      !owner
        ? ""
        : !bankList.length
          ? `<p class="muted small">Bank list unavailable just now. Please try again later.</p>`
          : `<details><summary class="small">${p.recipient ? "Change bank details" : "Add bank details"}</summary>
<form method="post" action="/home/pay/bank"><input type="hidden" name="who" value="${esc(p.key)}">
<label>Bank<select name="bank" required><option value="">Choose the bank</option>${bankList.map((b) => `<option value="${esc(b.code)}|${esc(b.name)}">${esc(b.name)}</option>`).join("")}</select></label>
<label>Account number<input name="account" inputmode="numeric" pattern="[0-9]{10}" maxlength="10" required></label>
<div class="actions"><button class="small">Check and save</button></div></form></details>`;

    const payForm = (p: Payee) =>
      !p.recipient
        ? `<span class="muted small">${owner ? "Add bank details to pay" : "The owner needs to add bank details"}</span>`
        : `<details><summary class="small">Pay ${esc(p.name)}</summary>
<form method="post" action="/home/pay/new"><input type="hidden" name="who" value="${esc(p.key)}">
<div class="row"><label>Amount (₦)<input name="amount" inputmode="decimal" required placeholder="25000"></label>
<label>What for<input name="reason" required maxlength="80" placeholder="${p.role === "Rider" ? "Deliveries this week" : "Wages for November"}"></label></div>
<div class="actions"><button class="small">Next: check and confirm</button></div></form></details>`;

    const peopleRows = people
      .map(
        (p) => `<tr><td><b>${esc(p.name)}</b><br><span class="muted small">${esc(p.role)}</span></td>
<td>${p.recipient ? `${esc(accountLabel(p.recipient))}<br><span class="muted small">${esc(p.recipient.accountName)}</span>` : `<span class="muted">No bank details</span>`}${bankForm(p)}</td>
<td>${payForm(p)}</td></tr>`,
      )
      .join("");

    const owedRows = owed
      .map((d: UnpaidDelivery) => {
        const rider = people.find((p) => p.key === `rider:${d.riderId}`);
        const action = !rider
          ? `<span class="muted small">${esc(d.riderName)} is no longer on your riders list</span>`
          : !rider.recipient
            ? `<span class="muted small">${owner ? "Add their bank details below" : "The owner needs to add their bank details"}</span>`
            : `<form method="post" action="/home/pay/new" class="inline"><input type="hidden" name="who" value="${esc(rider.key)}"><input type="hidden" name="delivery" value="${d.id}">
<input name="amount" inputmode="decimal" required style="width:5.5rem" value="${d.feeKobo ? (d.feeKobo / 100).toFixed(2).replace(/\.00$/, "") : ""}" aria-label="Amount for ${esc(d.orderRef)}"><button class="small">Pay</button></form>`;
        const fee = d.feeKobo !== null ? ` · fee ${formatNaira(d.feeKobo)}` : "";
        return `<tr><td><b>${esc(d.orderRef)}</b> · ${esc(d.riderName)}<br><span class="muted small">Delivered ${day(d.deliveredAt)}${fee}</span></td><td>${action}</td></tr>`;
      })
      .join("");

    const recentRows = recent
      .map((p: Payout) => {
        const s = STATUS[p.status as Exclude<PayoutStatus, "draft">];
        const check = ["sending", "pending", "otp"].includes(p.status)
          ? `<form method="post" action="/home/pay/${p.id}/check" style="margin-top:6px"><button class="ghost small">Check again</button></form>`
          : "";
        return `<tr><td>${day(p.createdAt)}</td><td><b>${esc(p.payeeName)}</b><br><span class="muted small">${esc(p.reason)} · ${esc(p.accountLabel)}</span></td>
<td>${formatNaira(p.amountKobo)}<br><span class="muted small">+ ${formatNaira(p.feeKobo)} fee</span></td><td><span class="tag ${s.tag}">${s.label}</span>${p.failure ? `<br><span class="muted small">${esc(p.failure)}</span>` : ""}${check}</td></tr>`;
      })
      .join("");

    return ctx.render(
      c,
      "Pay people",
      "/home/pay",
      `<div class="card"><div class="cardhead"><h3>Payout balance</h3><b style="font-size:1.6rem">${formatNaira(balance)}</b></div>
<p class="muted small" style="margin:0">Your sales go straight to your own bank, so add money here first. Each payment comes off this balance and lands in the person's bank account within minutes.</p>
<form method="post" action="/home/pay/topup" class="row" style="margin-top:12px"><label>Add (₦)<input name="amount" inputmode="decimal" required placeholder="50000"></label><button>Pay with Paystack</button></form>
<p class="muted small" style="margin:8px 0 0">Paystack keeps its usual charge from what you add (1.5%, never more than ₦2,000). Each payment out costs Paystack's transfer fee, from ₦10, shown before you confirm.</p></div>
${
  biz.delivery
    ? `<h2>Delivery pay owed</h2>
<p class="muted">Orders your riders delivered in the last ${DELIVERY_DAYS} days that haven't been paid from here. The amount starts at the delivery fee the customer paid; change it to what you pay the rider.</p>
<div class="scroll"><table><tr><th>Order and rider</th><th>Pay (₦)</th></tr>${owedRows || `<tr><td colspan="2" class="muted">Nothing owed.</td></tr>`}</table></div>`
    : ""
}
<h2>Riders and staff</h2>
<p class="muted">${owner ? "Bank details are checked with the bank before they're saved. Only you can set or change them." : "Only the owner can set or change bank details."} Add riders under <a href="/home/delivery">Riders &amp; delivery</a> and staff under Settings &gt; Team.</p>
<div class="scroll"><table><tr><th>Name</th><th>Paid into</th><th></th></tr>${peopleRows || `<tr><td colspan="3" class="muted">No riders or staff yet.</td></tr>`}</table></div>
<h2>Payments</h2>
<div class="scroll"><table><tr><th>Date</th><th>To</th><th>Amount</th><th>Status</th></tr>${recentRows || `<tr><td colspan="4" class="muted">No payments yet.</td></tr>`}</table></div>`,
    );
  });

  app.post("/pay/topup", async (c) => {
    const amount = parseMoney(field(await c.req.parseBody(), "amount", 20));
    if (amount === null || amount < MIN_TOPUP_KOBO) {
      return ctx.render(c, "Pay people", "/home/pay", `<p class="flash bad">Add at least ${formatNaira(MIN_TOPUP_KOBO)}.</p><p><a href="/home/pay">Back</a></p>`, 400);
    }
    try {
      return c.redirect(await c.get("biz").payouts!.topUpLink(c.get("user").waId, amount), 303);
    } catch (err) {
      if (err instanceof PaymentsHeld) return c.redirect(`/home/pay?msg=${err.reason === "paused" ? "payments_paused" : "payout_limit"}`, 303);
      ctx.log.error(`Owner app: payout top-up link for ${c.get("biz").name} failed:`, err);
      return c.redirect("/home/pay?msg=topup_failed", 303);
    }
  });

  app.post("/pay/bank", async (c) => {
    if (c.get("user").role !== "owner") return c.redirect("/home/pay?msg=owner_only", 303);
    const biz = c.get("biz");
    const form = await c.req.parseBody();
    const payee = (await payees(c)).find((p) => p.key === field(form, "who", 60));
    const [code, ...name] = field(form, "bank", 120).split("|");
    const number = field(form, "account", 20);
    if (!payee || !code || !name.length || !/^\d{10}$/.test(number) || !ctx.deps.banks) return c.redirect("/home/pay?msg=bad", 303);
    const bankName = name.join("|");
    const accountName = await ctx.deps.banks.resolve(number, code).catch(() => null);
    if (!accountName) {
      return ctx.render(c, "Pay people", "/home/pay", `<p class="flash bad">${esc(bankName)} couldn't find account ${esc(number)}. Please check the number and the bank.</p><p><a href="/home/pay">Back</a></p>`, 400);
    }
    const recipientCode = await biz.payouts!.recipient(accountName, number, code);
    const [kind, id] = payee.key.split(":") as ["rider" | "staff", string];
    await biz.payouts!.service.store.saveRecipient({
      riderId: kind === "rider" ? id : null,
      userId: kind === "staff" ? id : null,
      bankCode: code,
      bankName,
      accountNumber: number,
      accountName,
      recipientCode,
    });
    ctx.log.info(`Owner app: ${biz.name} set bank details for a ${kind}`);
    return c.redirect("/home/pay?msg=bank_saved", 303);
  });

  // Step one: nothing is sent, the next page asks to confirm.
  app.post("/pay/new", async (c) => {
    const biz = c.get("biz");
    const form = await c.req.parseBody();
    const payee = (await payees(c)).find((p) => p.key === field(form, "who", 60));
    const amount = parseMoney(field(form, "amount", 20));
    if (!payee?.recipient || amount === null) return c.redirect("/home/pay?msg=bad", 303);
    if (amount < MIN_PAYOUT_KOBO) {
      return ctx.render(c, "Pay people", "/home/pay", `<p class="flash bad">The smallest payment is ${formatNaira(MIN_PAYOUT_KOBO)}.</p><p><a href="/home/pay">Back</a></p>`, 400);
    }
    let reason = field(form, "reason", 80);
    let deliveryId: string | null = null;
    const delivery = field(form, "delivery", 40);
    if (delivery) {
      const since = new Date(ctx.now().getTime() - DELIVERY_DAYS * 86_400_000);
      const owed = UUID.test(delivery) ? (await biz.payouts!.service.store.unpaidDeliveries(since)).find((d) => d.id === delivery) : undefined;
      if (!owed || payee.key !== `rider:${owed.riderId}`) return c.redirect("/home/pay?msg=pay_twice", 303);
      deliveryId = owed.id;
      reason = `Delivery ${owed.orderRef}`;
    }
    if (!reason) return c.redirect("/home/pay?msg=bad", 303);
    const id = await biz.payouts!.service.draft({
      recipientId: payee.recipient.id,
      recipientCode: payee.recipient.recipientCode,
      payeeName: payee.name,
      payeeWaId: payee.waId,
      accountLabel: `${accountLabel(payee.recipient)} (${payee.recipient.accountName})`,
      amountKobo: amount,
      reason,
      deliveryId,
      createdBy: c.get("user").id,
    });
    return c.redirect(`/home/pay/confirm/${id}`, 303);
  });

  app.get("/pay/confirm/:id", async (c) => {
    const store = c.get("biz").payouts!.service.store;
    const p = UUID.test(c.req.param("id")) ? await store.get(c.req.param("id")) : null;
    if (!p || p.status !== "draft") return c.redirect("/home/pay?msg=pay_gone", 303);
    const balance = await store.balance();
    const total = p.amountKobo + p.feeKobo;
    const enough = balance >= total;
    return ctx.render(
      c,
      "Confirm payment",
      "/home/pay",
      `<div class="card" style="max-width:34rem">
<p class="muted small" style="margin:0">Please check before you send. Money sent to the wrong account can't be pulled back.</p>
<table style="margin:14px 0"><tr><td class="muted">To</td><td><b>${esc(p.payeeName)}</b></td></tr>
<tr><td class="muted">Account</td><td>${esc(p.accountLabel)}</td></tr>
<tr><td class="muted">For</td><td>${esc(p.reason)}</td></tr>
<tr><td class="muted">Amount</td><td><b style="font-size:1.3rem">${formatNaira(p.amountKobo)}</b></td></tr>
<tr><td class="muted">Paystack fee</td><td>${formatNaira(p.feeKobo)}</td></tr>
<tr><td class="muted">Balance after</td><td>${enough ? formatNaira(balance - total) : `<span class="tag red">Not enough: you have ${formatNaira(balance)}</span>`}</td></tr></table>
${
  enough
    ? `<form method="post" action="/home/pay/${p.id}/send"><div class="actions"><button>Yes, send ${formatNaira(p.amountKobo)} to ${esc(p.payeeName)}</button><a class="button ghost" href="/home/pay">Cancel</a></div></form>`
    : `<div class="actions"><a class="button" href="/home/pay">Back to add money</a></div>`
}
<p class="muted small">This screen works for 10 minutes. Tapping the button again won't pay twice.</p></div>`,
    );
  });

  app.post("/pay/:id/send", async (c) => {
    if (!UUID.test(c.req.param("id"))) return c.redirect("/home/pay?msg=bad", 303);
    if ((await ctx.deps.verification?.store.get(c.get("biz").id))?.paused) return c.redirect("/home/pay?msg=payments_paused", 303);
    const result = await c.get("biz").payouts!.service.send(c.req.param("id"));
    return c.redirect(`/home/pay?msg=${SEND_FLASH[result] ?? "pay_unsure"}`, 303);
  });

  app.post("/pay/:id/check", async (c) => {
    if (!UUID.test(c.req.param("id"))) return c.redirect("/home/pay?msg=bad", 303);
    const status = await c.get("biz").payouts!.service.check(c.req.param("id"));
    const msg = status === "success" ? "pay_sent" : status === "failed" || status === "reversed" ? "pay_failed" : status === "otp" ? "pay_otp" : "pay_pending";
    return c.redirect(`/home/pay?msg=${msg}`, 303);
  });
}
