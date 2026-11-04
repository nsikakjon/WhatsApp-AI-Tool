import { randomInt } from "node:crypto";
import { Hono } from "hono";
import { localNumber } from "./emails.js";
import { isOpen, phoneFromText, staffAlert, type NumberQueueStore, type NumberRequest, type NumberStatus } from "./numbers.js";
import { esc, page } from "./setup.js";
import { NumberTakenError, type BusinessStore, type SetupStore } from "./store.js";

// The "Numbers to connect" queue at /quote-setup/numbers, behind the setup
// screen's password. Each business that signed up by chat and sent a new
// SIM's number has a page with the steps to connect it, who is doing it, and
// buttons that register the number with Meta and switch the bot on, so staff
// never need the WhatsApp access token.

export interface MetaNumbers {
  /** The number as WhatsApp shows it, read with our token. Fails if the ID isn't in our WhatsApp account. */
  displayNumber(phoneNumberId: string): Promise<string | null>;
  /** Puts the number on the Cloud API with this two-step verification PIN. */
  register(phoneNumberId: string, pin: string): Promise<void>;
}

export interface NumberQueueDeps {
  store: NumberQueueStore;
  businesses: BusinessStore;
  setup: Pick<SetupStore, "updateBusiness">;
  /** WhatsApp Phone number IDs no business may use (the yarnOga lines). */
  reservedNumberIds: string[];
  meta: MetaNumbers;
  /** Sends a WhatsApp message from the yarnOga sign-up number. */
  send(to: string, text: string): Promise<void>;
  publicUrl?: string;
  log?: Pick<Console, "error">;
}

const STATUS: Record<NumberStatus, string> = {
  no_number: "Waiting for the owner's number",
  new: "Number in, not started",
  added: "In WhatsApp Manager",
  registered: "Registered, ready to switch on",
  live: "Live",
};
const ORDER: NumberStatus[] = ["no_number", "new", "added", "registered", "live"];
const reached = (r: NumberRequest, s: NumberStatus) => ORDER.indexOf(r.status) >= ORDER.indexOf(s);

export function createNumberQueuePage(deps: NumberQueueDeps) {
  const app = new Hono();
  const log = deps.log ?? console;

  app.get("/", async (c) => {
    const [requests, staff] = await Promise.all([deps.store.list(), deps.store.staff()]);
    const name = (id: string | null) => staff.find((s) => s.id === id)?.name ?? '<span class="warn">nobody</span>';
    const row = (r: NumberRequest) => `<tr><td><a href="/quote-setup/numbers/${r.businessId}">${esc(r.businessName)}</a></td>
<td>${r.number ? esc(localNumber(r.number)) : '<span class="muted">not sent</span>'}</td>
<td>${STATUS[r.status]}${r.note ? `<br><small class="warn">${esc(r.note)}</small>` : ""}</td>
<td>${r.status === "live" ? "" : name(r.assignedTo)}</td>
<td>${r.status === "live" ? (r.liveAt ? day(r.liveAt) : "") : r.numberAt ? since(r.numberAt) : '<span class="muted">-</span>'}</td></tr>`;
    const table = (list: NumberRequest[], when: string) =>
      list.length
        ? `<table><thead><tr><th>Business</th><th>New number</th><th>Status</th><th>Assigned to</th><th>${when}</th></tr></thead><tbody>${list.map(row).join("")}</tbody></table>`
        : `<p class="muted">None.</p>`;
    const open = requests.filter(isOpen);
    return c.html(
      page(
        "Numbers to connect",
        `<p>Businesses that signed up by chat send the number of a new SIM for their bot. Open one to see the steps. New numbers are shared out to the person with the fewest still to do, and they get a WhatsApp message.</p>
<h2>To do (${open.length})</h2>${table(open, "Waiting")}
<h2>Waiting for the owner's number</h2>${table(requests.filter((r) => r.status === "no_number"), "")}
<h2>Live</h2>${table(requests.filter((r) => r.status === "live").slice(0, 30), "Live since")}
<h2>Who connects numbers</h2>
${staff.length ? `<table><tbody>${staff.map((s) => `<tr><td>${esc(s.name)}</td><td>+${esc(s.waId)}</td><td><form method="post" action="/quote-setup/numbers/staff/${s.id}/remove"><button type="submit">Remove</button></form></td></tr>`).join("")}</tbody></table>` : `<p class="warn">Nobody yet, so new numbers aren't assigned. Add the people who will connect them.</p>`}
<p class="muted">Each person should send <b>hi</b> to the sign-up number once, so WhatsApp lets the bot message them.</p>
<form method="post" action="/quote-setup/numbers/staff" class="stack">
<label>Name<input name="name" required maxlength="60"></label>
<label>WhatsApp number <small>e.g. 0803 123 4567 or 2348031234567</small><input name="waId" required inputmode="tel"></label>
<p><button type="submit">Add</button></p>
</form>`,
      ),
    );
  });

  app.post("/staff", async (c) => {
    const body = await c.req.parseBody();
    const name = String(body.name ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
    const waId = phoneFromText(String(body.waId ?? ""));
    if (!name || !waId) return c.html(page("Numbers to connect", `<p class="error">Give a name and a WhatsApp number, e.g. 0803 123 4567.</p><p><a href="/quote-setup/numbers">Back</a></p>`), 400);
    await deps.store.addStaff(name, waId);
    return c.redirect("/quote-setup/numbers", 303);
  });

  app.post("/staff/:id/remove", async (c) => {
    if (!UUID.test(c.req.param("id"))) return c.notFound();
    await deps.store.removeStaff(c.req.param("id"));
    return c.redirect("/quote-setup/numbers", 303);
  });

  app.get("/:id", async (c) => {
    const r = await found(c.req.param("id"));
    if (!r) return c.notFound();
    return c.html(await detail(r, c.req.query("done") ?? null, []));
  });

  app.post("/:id/assign", async (c) => {
    const r = await found(c.req.param("id"));
    if (!r) return c.notFound();
    const id = String((await c.req.parseBody()).assignedTo ?? "");
    const person = (await deps.store.staff()).find((s) => s.id === id) ?? null;
    await deps.store.update(r.businessId, { assignedTo: person?.id ?? null });
    if (person && person.id !== r.assignedTo && r.number) await tell(person.waId, staffAlert(r, deps.publicUrl));
    return c.redirect(`/quote-setup/numbers/${r.businessId}?done=assigned`, 303);
  });

  app.post("/:id/note", async (c) => {
    const r = await found(c.req.param("id"));
    if (!r) return c.notFound();
    const note = String((await c.req.parseBody()).note ?? "").trim().slice(0, 300);
    await deps.store.update(r.businessId, { note: note || null });
    return c.redirect(`/quote-setup/numbers/${r.businessId}`, 303);
  });

  app.post("/:id/added", async (c) => {
    const r = await found(c.req.param("id"));
    if (!r) return c.notFound();
    if (r.status === "new") await deps.store.update(r.businessId, { status: "added" });
    return c.redirect(`/quote-setup/numbers/${r.businessId}`, 303);
  });

  app.post("/:id/register", async (c) => {
    const r = await found(c.req.param("id"));
    if (!r) return c.notFound();
    const body = await c.req.parseBody();
    const phoneNumberId = String(body.phoneNumberId ?? "").replace(/\s/g, "");
    const byHand = body.byHand === "on";
    if (!/^\d{5,20}$/.test(phoneNumberId)) return c.html(await detail(r, null, ['The Phone number ID is the long number WhatsApp Manager shows under the number (digits only), not the phone number.']), 400);
    if (deps.reservedNumberIds.includes(phoneNumberId)) return c.html(await detail(r, null, ["That Phone number ID is one of yarnOga's own numbers."]), 400);
    const other = await deps.businesses.findByPhoneNumberId(phoneNumberId);
    if (other && other.id !== r.businessId) return c.html(await detail(r, null, [`That Phone number ID already answers for ${other.name}.`]), 400);

    let shown: string | null;
    try {
      shown = await deps.meta.displayNumber(phoneNumberId);
    } catch (err) {
      log.error(`Couldn't read Phone number ID ${phoneNumberId}:`, err);
      return c.html(await detail(r, null, ["WhatsApp doesn't know that Phone number ID in our account. Check you copied it from the right number."]), 400);
    }
    const digits = (shown ?? "").replace(/\D/g, "");
    if (r.number && digits && digits !== r.number) {
      return c.html(await detail(r, null, [`That Phone number ID belongs to ${shown}, not ${localNumber(r.number)}.`]), 400);
    }
    let pin: string | null = null;
    if (!byHand) {
      pin = String(randomInt(0, 1_000_000)).padStart(6, "0");
      try {
        await deps.meta.register(phoneNumberId, pin);
      } catch (err) {
        log.error(`Registering ${phoneNumberId} failed:`, err);
        const message = err instanceof Error ? err.message : String(err);
        return c.html(await detail(r, null, [`WhatsApp didn't register it: ${message}. Read the message before trying again: WhatsApp allows 10 tries in 3 days.`]), 502);
      }
    }
    await deps.store.update(r.businessId, { status: "registered", phoneNumberId, ...(pin ? { pin } : {}) });
    return c.redirect(`/quote-setup/numbers/${r.businessId}?done=registered`, 303);
  });

  app.post("/:id/live", async (c) => {
    const r = await found(c.req.param("id"));
    if (!r) return c.notFound();
    if (r.status !== "registered" || !r.phoneNumberId) return c.html(await detail(r, null, ["Register the number first."]), 400);
    const business = await deps.businesses.get(r.businessId);
    if (!business) return c.notFound();
    const { id: _, updatedAt: __, ...settings } = business;
    try {
      await deps.setup.updateBusiness(business.id, { ...settings, phoneNumberId: r.phoneNumberId, active: true });
    } catch (err) {
      if (err instanceof NumberTakenError) return c.html(await detail(r, null, ["Another business already uses that Phone number ID."]), 400);
      throw err;
    }
    await deps.store.update(r.businessId, { status: "live", liveAt: new Date(), note: null });
    if (business.ownerWaId && r.number) await tell(business.ownerWaId, liveMessage(business.name, r.number));
    return c.redirect(`/quote-setup/numbers/${r.businessId}?done=live`, 303);
  });

  async function found(id: string): Promise<NumberRequest | null> {
    return UUID.test(id) ? deps.store.get(id) : null;
  }

  async function tell(to: string, text: string): Promise<void> {
    try {
      await deps.send(to, text);
    } catch (err) {
      log.error(`Couldn't message ${to} about a number to connect:`, err);
    }
  }

  async function detail(r: NumberRequest, done: string | null, problems: string[]): Promise<string> {
    const staff = await deps.store.staff();
    const step = (n: number, title: string, isDone: boolean, body: string) =>
      `<section class="notice"><h2>${isDone ? "✓" : n}. ${title}</h2>${isDone ? "" : body}</section>`;
    const owner = r.ownerWaId ? `<a href="https://wa.me/${r.ownerWaId}" target="_blank" rel="noopener">+${esc(r.ownerWaId)}</a>` : "not known";
    const banner = done === "live" ? "Live. The owner has been told on WhatsApp." : done === "registered" ? "Registered." : done === "assigned" ? "Saved." : "";
    const body = `${banner ? `<p class="ok">${banner}</p>` : ""}${problems.length ? `<ul class="error">${problems.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
<table><tbody>
<tr><th>New number</th><td>${r.number ? `<b>${esc(localNumber(r.number))}</b>` : '<span class="muted">The owner hasn\'t sent it yet. They can send it to the sign-up number any time.</span>'}</td></tr>
<tr><th>Owner's WhatsApp</th><td>${owner}</td></tr>
<tr><th>Status</th><td>${STATUS[r.status]}</td></tr>
${r.pin ? `<tr><th>PIN</th><td><b>${esc(r.pin)}</b> <small>WhatsApp asks for this if the number is ever moved. Don't share it.</small></td></tr>` : ""}
</tbody></table>
${r.status === "live" ? "" : `<form method="post" action="/quote-setup/numbers/${r.businessId}/assign" class="stack"><label>Assigned to<select name="assignedTo"><option value="">Nobody</option>${staff.map((s) => `<option value="${s.id}"${s.id === r.assignedTo ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label><p><button type="submit">Save</button></p></form>`}
${
  r.number && r.status !== "live"
    ? `${step(
        1,
        "Add the number in WhatsApp Manager",
        reached(r, "added"),
        `<p>Open <a href="https://business.facebook.com/wa/manage/phone-numbers/" target="_blank" rel="noopener">WhatsApp Manager</a>, pick yarnOga's WhatsApp account, then <b>Add phone number</b>.</p>
<ul><li>Display name: <b>${esc(r.businessName)}</b> (what customers will see)</li><li>Category: whatever fits the business</li><li>Number: <b>${esc(localNumber(r.number))}</b>, code by SMS (voice call if SMS doesn't come)</li></ul>
<p>Message or call the owner on ${owner} and ask them to read you the code Meta sends to the new SIM. If Meta says "too many codes", wait a day and try the voice call.</p>
<form method="post" action="/quote-setup/numbers/${r.businessId}/added"><button type="submit">Done: the number is in WhatsApp Manager</button></form>`,
      )}
${step(
  2,
  "Register it",
  reached(r, "registered"),
  `<p>In WhatsApp Manager, click the new number and copy its <b>Phone number ID</b> (the long number, not the phone number). Paste it here. We check it's the right number, then register it with a new PIN.</p>
<form method="post" action="/quote-setup/numbers/${r.businessId}/register" class="stack"><label>Phone number ID<input name="phoneNumberId" required inputmode="numeric" value="${esc(r.phoneNumberId ?? "")}"></label>
<label class="check"><input type="checkbox" name="byHand"> I registered it by hand already</label>
<p><button type="submit">Check and register</button></p></form>`,
)}
${step(
  3,
  "Switch it on",
  false,
  r.status === "registered"
    ? `<p>In WhatsApp Manager, check the number shows <b>Connected</b> and <b>Subscribe webhooks</b> is on. Then switch the bot on. The owner gets a WhatsApp message that it's live, and customers get answers within a minute.</p>
<form method="post" action="/quote-setup/numbers/${r.businessId}/live"><button type="submit">Switch on and tell the owner</button></form>`
    : `<p class="muted">After step 2.</p>`,
)}`
    : ""
}
${r.status === "live" ? `<p>Live${r.liveAt ? ` since ${day(r.liveAt)}` : ""}. To test: send a price question to ${r.number ? esc(localNumber(r.number)) : "the number"} from a phone that isn't the bot's.</p>` : ""}
<form method="post" action="/quote-setup/numbers/${r.businessId}/note" class="stack"><label>Note <small>anything holding it up, so others can see</small><textarea name="note" rows="2" maxlength="300">${esc(r.note ?? "")}</textarea></label><p><button type="submit">Save note</button></p></form>
<p><a href="/quote-setup/b/${r.businessId}">Business settings</a> · <a href="/quote-setup/numbers">All numbers</a></p>`;
    return page(r.businessName, body);
  }

  return app;
}

/** What the owner gets on WhatsApp when their bot goes live. */
export function liveMessage(businessName: string, number: string): string {
  return (
    `Good news: *${businessName}* is live on WhatsApp at *${localNumber(number)}*. Customers who message that number now get your bot, with prices from your list.\n\n` +
    `Try it from your own phone: https://wa.me/${number}\n` +
    "New orders come to you here on your own WhatsApp. Send *plan* to your bot's number to see your plan."
  );
}

const UUID = /^[0-9a-f-]{36}$/i;

function day(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" });
}

function since(d: Date, now = new Date()): string {
  const hours = Math.floor((now.getTime() - d.getTime()) / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${Math.floor(hours / 24)} days`;
}
