import { Hono, type Context } from "hono";
import { guardedBasicAuth } from "../core/security/guard.js";
import { adminPage, esc } from "../owner/layout.js";
import { cleanRcNumber, type Registry } from "./registry.js";
import { DOC_KINDS, STATUS_TEXT, requiredDocs, type VerificationStatus, type VerificationStore } from "./store.js";

// The compliance page at /compliance (COMPLIANCE_PASSWORD), for Jay: every
// business on the quote bot with its verification status, and for each one
// its details, documents, an optional CAC registry check, and Approve /
// Ask for more / Reject. The owner is told the decision on WhatsApp.

export interface ComplianceDeps {
  password: string;
  store: VerificationStore;
  /** CAC check through Dojah; without it the page links to the free public search. */
  registry?: Registry;
  /** Sends the owner a WhatsApp message about the decision. */
  notifyOwner?(businessId: string, text: string): Promise<void>;
  log?: Pick<Console, "info" | "error">;
}

const UUID = /^[0-9a-f-]{36}$/;
const ORDER: VerificationStatus[] = ["submitted", "more_info", "not_started", "rejected", "approved"];
const CAC_SEARCH = "https://search.cac.gov.ng/home";

const tag = (s: VerificationStatus) =>
  `<span class="tag ${s === "approved" ? "lime" : s === "submitted" ? "blue" : s === "more_info" ? "amber" : s === "rejected" ? "red" : ""}">${esc(STATUS_TEXT[s])}</span>`;
const day = (d: Date | null) =>
  d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" }) : "–";

/** What the owner is told on WhatsApp after a decision. */
export function decisionMessage(status: "approved" | "rejected" | "more_info", businessName: string, note: string | null): string {
  const why = note ? `\n\n${note}` : "";
  if (status === "approved") return `✅ ${businessName} is now verified on yarnOga. Thank you!${why}`;
  if (status === "more_info") return `We need a little more to verify ${businessName}.${why}\n\nSend *app* for a login link, then open *Verify business* to update it.`;
  return `We couldn't verify ${businessName}.${why}\n\nSend *app* for a login link and open *Verify business* to fix it, or reply here if you have questions.`;
}

export function createCompliance(deps: ComplianceDeps) {
  const app = new Hono();
  const log = deps.log ?? console;

  app.use("*", guardedBasicAuth({ password: deps.password, realm: "yarnOga compliance" }));
  app.use("*", async (c, next) => {
    if (c.req.method === "POST" && !sameSite(c)) return c.text("This form must be sent from the compliance page itself.", 403);
    await next();
    c.header("Cache-Control", "no-store");
    c.header("X-Frame-Options", "DENY");
    c.header("Referrer-Policy", "no-referrer");
  });
  app.onError((err, c) => {
    log.error("Compliance page failed:", err);
    return c.html(adminPage("Something went wrong", "Compliance", `<p>The page couldn't load. If you've just switched this on, check that migration 0050 has been run in Supabase.</p><p><a href="/compliance">Back</a></p>`), 500);
  });

  app.get("/", async (c) => {
    const filter = c.req.query("show") ?? "";
    const all = (await deps.store.list()).sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
    const shown = filter && (ORDER as string[]).includes(filter) ? all.filter((v) => v.status === filter) : all;
    const counts = ORDER.map((s) => `<a class="tile" href="/compliance?show=${s}"><span>${esc(STATUS_TEXT[s])}</span><b>${all.filter((v) => v.status === s).length}</b></a>`).join("");
    const rows = shown
      .map(
        (v) => `<tr><td><a href="/compliance/b/${v.businessId}"><b>${esc(v.businessName)}</b></a>${v.active ? "" : ' <span class="tag">switched off</span>'}<br><span class="muted small">${esc(v.registeredName ?? "")}${v.rcNumber ? ` · ${esc(v.rcNumber)}` : ""}</span></td>
<td>${tag(v.status)}</td><td class="muted small">${day(v.submittedAt)}</td><td class="muted small">${day(v.reviewedAt)}</td><td><a class="button ghost small" href="/compliance/b/${v.businessId}">Review</a></td></tr>`,
      )
      .join("");
    return c.html(
      adminPage(
        "Business verification",
        "yarnOga compliance",
        `<div class="tiles" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr));margin-bottom:18px">${counts}</div>
${filter ? `<p><a href="/compliance">Show all</a></p>` : ""}
<div class="scroll"><table><tr><th>Business</th><th>Status</th><th>Sent</th><th>Decided</th><th></th></tr>${rows || `<tr><td colspan="5" class="muted">Nothing here.</td></tr>`}</table></div>
<p class="muted small" style="margin-top:12px">Waiting for review comes first. Owners send their details from the app (Verify business).</p>`,
      ),
    );
  });

  async function load(c: Context) {
    const id = c.req.param("id") ?? "";
    if (!UUID.test(id)) return null;
    const list = await deps.store.list();
    const found = list.find((v) => v.businessId === id);
    return found ?? null;
  }

  app.get("/b/:id", async (c) => {
    const v = await load(c);
    if (!v) return c.notFound();
    const [docs, events] = await Promise.all([deps.store.docs(v.businessId), deps.store.events(v.businessId)]);
    const required = requiredDocs(v.entityType);
    const missing = required.filter((k) => !docs.some((d) => d.kind === k));
    const detail = (label: string, value: string | null) => `<tr><th style="width:34%">${esc(label)}</th><td>${esc(value ?? "–")}</td></tr>`;
    const type = v.entityType === "company" ? "Registered company" : v.entityType === "business_name" ? "Business name" : v.entityType === "individual" ? "Not registered" : null;
    const docRows = docs
      .map(
        (d) => `<tr><td>${esc(DOC_KINDS[d.kind].split(" (")[0]!)}${required.includes(d.kind) ? "" : ' <span class="tag">optional</span>'}</td>
<td><a href="/compliance/b/${v.businessId}/doc/${d.id}" target="_blank" rel="noopener">${esc(d.fileName)}</a><br><span class="muted small">${Math.max(1, Math.round(d.size / 1024))} KB · ${day(d.uploadedAt)}</span></td></tr>`,
      )
      .join("");
    const r = v.registry;
    const registry = r
      ? r.found
        ? `<table>${detail("Registered name", r.name)}${detail("Name matches what they typed", r.nameMatches == null ? "–" : r.nameMatches ? "Yes" : "NO: check carefully")}${detail("Status", r.status)}${detail("Type", r.type)}${detail("Registered on", r.registeredOn)}${detail("Address", r.address)}${detail("Directors and owners", r.people.join(", ") || null)}</table>
<p class="muted small">Checked ${day(v.registryCheckedAt)} with ${esc(r.provider)}.</p>`
        : `<p class="flash bad">${esc(r.error ?? "Not found on the CAC register.")}</p><p class="muted small">Checked ${day(v.registryCheckedAt)} with ${esc(r.provider)}.</p>`
      : `<p class="muted">Not checked yet.</p>`;
    const canCheck = deps.registry && v.rcNumber && v.entityType && v.entityType !== "individual";
    const history = events
      .map((e) => `<li><b>${esc(e.action.replace(/_/g, " "))}</b> · ${esc(e.actor)} · <span class="muted small">${esc(e.at.toISOString().replace("T", " ").slice(0, 16))} UTC</span>${e.note ? `<br><span class="muted">${esc(e.note)}</span>` : ""}</li>`)
      .join("");

    const body = `<p><a href="/compliance">← All businesses</a></p>
<div class="card banner"><div><h3 style="margin:0 0 4px">${esc(v.businessName)}</h3><p class="muted small" style="margin:0">Sent ${day(v.submittedAt)}${v.reviewedAt ? ` · last decision ${day(v.reviewedAt)}` : ""}</p></div>${tag(v.status)}</div>
${v.reviewNote ? `<p class="muted">Last note to the owner: ${esc(v.reviewNote)}</p>` : ""}
<div class="split even">
<section><h2>Details they gave</h2><div class="scroll"><table>
${detail("Type", type)}${detail("Registered name", v.registeredName)}${detail(v.entityType === "business_name" ? "BN number" : "RC number", v.rcNumber)}${detail("TIN", v.tin)}${detail("Address", v.address)}${detail("Director or owner", v.directorName)}${detail("Email", v.contactEmail)}
</table></div></section>
<section><h2>Documents</h2><div class="scroll"><table>${docRows || `<tr><td class="muted">No documents.</td></tr>`}</table></div>
${missing.length ? `<p class="flash bad" style="margin-top:10px">Missing: ${esc(missing.map((k) => DOC_KINDS[k].split(" (")[0]!).join(", "))}</p>` : ""}</section>
</div>
<h2>CAC register</h2>
<div class="card">${registry}
<div class="actions">${canCheck ? `<form method="post" action="/compliance/b/${v.businessId}/check"><button class="ghost">Check with CAC (Dojah)</button></form>` : ""}
<a class="button ghost" href="${CAC_SEARCH}" target="_blank" rel="noopener">Search CAC yourself (free)</a></div>
<p class="muted small" style="margin-top:10px">${deps.registry ? "Each Dojah check costs a little from the Dojah wallet." : "Add DOJAH_APP_ID and DOJAH_SECRET_KEY on Railway to check automatically."} On the free CAC search, type the ${v.entityType === "business_name" ? "BN" : "RC"} number ${v.rcNumber ? `<code>${esc(v.rcNumber)}</code>` : ""} or the name.</p></div>
<h2>Decision</h2>
<form method="post" action="/compliance/b/${v.businessId}/decide" class="card">
<label>Note to the owner <span class="muted">(sent on WhatsApp; needed when asking for more or rejecting)</span><textarea name="note" maxlength="600" placeholder="e.g. The proof of address is older than 3 months. Please upload a recent utility bill."></textarea></label>
<div class="actions"><button name="decision" value="approved">Approve</button><button class="ghost" name="decision" value="more_info">Ask for more</button><button class="danger" name="decision" value="rejected">Reject</button></div>
<p class="muted small" style="margin-top:10px">Check that the names on the certificate, the CAC register and the ID match, the documents are clear and not edited, and the address is real.</p></form>
<h2>History</h2>
<div class="card"><ul style="margin:0;padding-left:18px;display:grid;gap:8px">${history || '<li class="muted">Nothing yet.</li>'}</ul></div>`;
    return c.html(adminPage(v.businessName, "Business verification", body));
  });

  app.get("/b/:id/doc/:doc", async (c) => {
    const id = c.req.param("id");
    const docId = c.req.param("doc");
    if (!UUID.test(id) || !UUID.test(docId)) return c.notFound();
    const file = await deps.store.docFile(id, docId);
    if (!file) return c.notFound();
    return c.body(file.data as unknown as ArrayBuffer, 200, {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename="${file.fileName.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
    });
  });

  app.post("/b/:id/check", async (c) => {
    const v = await load(c);
    if (!v || !deps.registry || !v.rcNumber || !v.entityType) return c.redirect(`/compliance/b/${c.req.param("id")}`, 303);
    const rc = cleanRcNumber(v.rcNumber);
    const result = rc
      ? await deps.registry.check(rc, v.entityType, v.registeredName).catch((err) => {
          log.error("CAC check failed:", err);
          return { found: false, name: null, status: null, type: null, registeredOn: null, address: null, people: [], nameMatches: null, provider: "Dojah", error: "The check didn't go through. Try again in a minute." };
        })
      : { found: false, name: null, status: null, type: null, registeredOn: null, address: null, people: [], nameMatches: null, provider: "-", error: "That isn't an RC or BN number." };
    await deps.store.saveRegistry(v.businessId, result, "Jay");
    return c.redirect(`/compliance/b/${v.businessId}`, 303);
  });

  app.post("/b/:id/decide", async (c) => {
    const v = await load(c);
    if (!v) return c.notFound();
    const form = await c.req.parseBody();
    const decision = form.decision === "approved" || form.decision === "rejected" || form.decision === "more_info" ? form.decision : null;
    const note = typeof form.note === "string" ? form.note.trim().slice(0, 600) || null : null;
    if (!decision || (decision !== "approved" && !note)) {
      return c.html(adminPage(v.businessName, "Business verification", `<p class="flash bad">Choose a decision${decision ? ", and write a note telling the owner what to fix" : ""}.</p><p><a href="/compliance/b/${v.businessId}">Back</a></p>`), 400);
    }
    await deps.store.review(v.businessId, decision, note, "Jay");
    log.info(`Compliance: ${v.businessName} ${decision}`);
    try {
      await deps.notifyOwner?.(v.businessId, decisionMessage(decision, v.businessName, note));
    } catch (err) {
      log.error(`Compliance: couldn't message the owner of ${v.businessName}:`, err);
    }
    return c.redirect(`/compliance/b/${v.businessId}`, 303);
  });

  return app;
}

function sameSite(c: Context): boolean {
  if (c.req.header("sec-fetch-site") === "same-origin") return true;
  const origin = c.req.header("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === c.req.header("host");
  } catch {
    return false;
  }
}

