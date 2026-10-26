import type { Hono } from "hono";
import {
  DOC_KINDS,
  STATUS_TEXT,
  documentType,
  editable,
  requiredDocs,
  type DocKind,
  type EntityType,
  type Verification,
  type VerificationDoc,
} from "../../compliance/store.js";
import { cleanRcNumber } from "../../compliance/registry.js";
import type { SectionContext } from "../index.js";
import { esc, field, icon } from "../layout.js";
import type { AppContext, Env } from "../types.js";

// "Verify your business" (owners only): registration details and documents,
// sent to yarnOga for review. Jay approves on the compliance page. Documents
// are kept in a private store and only ever read through the server.

const UUID = /^[0-9a-f-]{36}$/;
const MAX_DOC = 5 * 1024 * 1024;
const KINDS = Object.keys(DOC_KINDS) as DocKind[];
const TYPES: Array<{ id: EntityType; label: string; hint: string }> = [
  { id: "company", label: "Registered company (Ltd)", hint: "Has an RC number" },
  { id: "business_name", label: "Registered business name", hint: "Has a BN number" },
  { id: "individual", label: "Not registered yet", hint: "Trading in your own name" },
];

export function statusTag(status: Verification["status"]): string {
  const colour = status === "approved" ? "lime" : status === "submitted" ? "blue" : status === "not_started" ? "" : status === "more_info" ? "amber" : "red";
  return `<span class="tag ${colour}">${esc(STATUS_TEXT[status])}</span>`;
}

/** Whether everything needed to send is there. Returns what's missing. */
export function missingForSubmit(v: Verification, docs: VerificationDoc[]): string[] {
  const missing: string[] = [];
  if (!v.entityType) missing.push("the type of business");
  if (!v.registeredName) missing.push("the business name");
  if (v.entityType && v.entityType !== "individual" && !v.rcNumber) missing.push(v.entityType === "company" ? "the RC number" : "the BN number");
  if (!v.address) missing.push("the business address");
  if (!v.directorName) missing.push(v.entityType === "company" ? "a director's name" : "the owner's name");
  for (const kind of requiredDocs(v.entityType)) if (!docs.some((d) => d.kind === kind)) missing.push(DOC_KINDS[kind].split(" (")[0]!);
  return missing;
}

export function registerVerify(app: Hono<Env>, ctx: SectionContext) {
  app.use("/verify", async (c, next) => (await ctx.ownerOnly(c)) ?? next());
  app.use("/verify/*", async (c, next) => (await ctx.ownerOnly(c)) ?? next());

  const off = (c: AppContext) => ctx.render(c, "Verify your business", "/app/verify", `<p>Business verification isn't switched on yet. Please ask yarnOga support.</p>`);

  app.get("/verify", async (c) => {
    const kyb = ctx.deps.verification;
    if (!kyb) return off(c);
    const biz = c.get("biz");
    const [v, docs] = await Promise.all([kyb.store.get(biz.id), kyb.store.docs(biz.id)]);
    const open = editable(v.status);
    const dis = open ? "" : " disabled";
    const val = (x: string | null) => esc(x ?? "");
    const missing = missingForSubmit(v, docs);
    const required = requiredDocs(v.entityType);
    const kinds = [...required, ...KINDS.filter((k) => !required.includes(k) && (v.entityType === "company" || k !== "memart"))];

    const banner =
      v.status === "approved"
        ? `<div class="card glow"><div class="cardhead"><h3>${icon("shield")} Your business is verified</h3>${statusTag(v.status)}</div><p class="muted" style="margin:0">Thank you. To change these details, message yarnOga support.</p></div>`
        : v.status === "submitted"
          ? `<div class="card"><div class="cardhead"><h3>We're reviewing your details</h3>${statusTag(v.status)}</div><p class="muted" style="margin:0">This usually takes 1 to 2 working days. We'll message you on WhatsApp when it's done.</p></div>`
          : v.status === "more_info" || v.status === "rejected"
            ? `<div class="flash bad"><b>${v.status === "more_info" ? "We need a little more from you" : "We couldn't verify your business"}</b>${v.reviewNote ? `<br>${esc(v.reviewNote)}` : ""}<br><span class="small">Update the details or documents below, then send them again.</span></div>`
            : `<div class="card"><div class="cardhead"><h3>Let's verify your business</h3>${statusTag(v.status)}</div><p class="muted" style="margin:0">So customers, Paystack and yarnOga know who they're dealing with. It takes about 5 minutes: your details, a few documents, then send.</p></div>`;

    const typeOptions = TYPES.map(
      (t) => `<label class="choice"><input type="radio" name="type" value="${t.id}"${v.entityType === t.id ? " checked" : ""}${dis} required><span><b>${t.label}</b><span class="muted small">${t.hint}</span></span></label>`,
    ).join("");

    const docRows = kinds
      .map((kind) => {
        const mine = docs.filter((d) => d.kind === kind);
        const files = mine
          .map(
            (d) => `<li><a href="/app/verify/doc/${d.id}" target="_blank" rel="noopener">${esc(d.fileName)}</a> <span class="muted small">${Math.max(1, Math.round(d.size / 1024))} KB</span>
${open ? `<form method="post" action="/app/verify/doc/${d.id}/remove" style="display:inline"><button class="danger small">Remove</button></form>` : ""}</li>`,
          )
          .join("");
        return `<div class="docrow"><div class="dochead"><b>${esc(DOC_KINDS[kind])}</b>${required.includes(kind) ? '<span class="tag amber">Required</span>' : '<span class="tag">Optional</span>'}${mine.length ? '<span class="tag lime">Uploaded</span>' : ""}</div>
${files ? `<ul class="files">${files}</ul>` : ""}
${open ? `<form method="post" action="/app/verify/doc" enctype="multipart/form-data" class="upload"><input type="hidden" name="kind" value="${kind}"><input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required aria-label="${esc(DOC_KINDS[kind])}"><button class="ghost small">${icon("upload", 16)}Upload</button></form>` : ""}</div>`;
      })
      .join("");

    const body = `${banner}
<h2>1. Your business</h2>
<form method="post" action="/app/verify/details" class="card">
<p class="label" style="margin-bottom:8px">What kind of business is it?</p><div class="choices">${typeOptions}</div>
<label>Registered business name <span class="muted">(exactly as on your certificate)</span><input name="name" maxlength="120" value="${val(v.registeredName)}"${dis}></label>
<div class="row"><label>RC or BN number <span class="muted">(not needed if not registered)</span><input name="rc" maxlength="20" value="${val(v.rcNumber)}" placeholder="e.g. RC 1234567"${dis}></label>
<label>Tax ID (TIN) <span class="muted">(optional)</span><input name="tin" maxlength="20" value="${val(v.tin)}"${dis}></label></div>
<label>Business address<textarea name="address" maxlength="300"${dis}>${val(v.address)}</textarea></label>
<div class="row"><label>Director's or owner's full name <span class="muted">(whose ID you upload)</span><input name="director" maxlength="120" value="${val(v.directorName)}"${dis}></label>
<label>Email <span class="muted">(optional)</span><input name="email" type="email" maxlength="120" value="${val(v.contactEmail)}"${dis}></label></div>
${open ? `<div class="actions"><button>Save details</button></div>` : ""}</form>

<h2>2. Documents</h2>
<p class="muted">PDF, PNG or JPG, up to 5 MB each. Clear photos of the full page are fine.</p>
<div class="card docs">${docRows}</div>

<h2>3. Send for review</h2>
<div class="card">${
      !open
        ? `<p class="muted" style="margin:0">Sent ${v.submittedAt ? esc(v.submittedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" })) : ""}. ${statusTag(v.status)}</p>`
        : missing.length
          ? `<p class="muted" style="margin:0 0 12px">Still needed: ${esc(missing.join(", "))}.</p><button disabled>Send for review</button>`
          : `<p class="muted" style="margin:0 0 12px">Everything's here. By sending, you confirm these documents are genuine and belong to this business.</p><form method="post" action="/app/verify/submit"><button>${icon("shield", 18)}Send for review</button></form>`
    }</div>`;
    return ctx.render(c, "Verify your business", "/app/verify", body);
  });

  async function guard(c: AppContext) {
    const kyb = ctx.deps.verification;
    if (!kyb) return null;
    const v = await kyb.store.get(c.get("biz").id);
    return editable(v.status) ? kyb : null;
  }

  app.post("/verify/details", async (c) => {
    const kyb = await guard(c);
    if (!kyb) return c.redirect("/app/verify", 303);
    const form = await c.req.parseBody();
    const type = TYPES.find((t) => t.id === form.type)?.id ?? null;
    const rcText = field(form, "rc", 20);
    const rc = rcText ? cleanRcNumber(rcText) : null;
    const email = field(form, "email", 120);
    if ((rcText && !rc) || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return c.redirect("/app/verify?msg=bad", 303);
    await kyb.store.saveDetails(c.get("biz").id, {
      entityType: type,
      registeredName: field(form, "name", 120) || null,
      rcNumber: type === "individual" ? null : rc,
      tin: field(form, "tin", 20).replace(/[^0-9A-Za-z-]/g, "") || null,
      address: field(form, "address", 300) || null,
      directorName: field(form, "director", 120) || null,
      contactEmail: email || null,
    });
    return c.redirect("/app/verify?msg=saved", 303);
  });

  app.post("/verify/doc", async (c) => {
    const kyb = await guard(c);
    if (!kyb) return c.redirect("/app/verify", 303);
    const form = await c.req.parseBody();
    const kind = KINDS.find((k) => k === form.kind);
    const file = form.file;
    if (!kind || !(file instanceof File) || file.size === 0 || file.size > MAX_DOC) return c.redirect("/app/verify?msg=bad", 303);
    const data = new Uint8Array(await file.arrayBuffer());
    const mimeType = documentType(data);
    if (!mimeType) return c.redirect("/app/verify?msg=bad", 303);
    const name = (file.name || "document").replace(/[^\w .()-]/g, "_").slice(0, 100);
    await kyb.store.addDoc(c.get("biz").id, kind, { name, mimeType, data });
    return c.redirect("/app/verify?msg=added", 303);
  });

  app.post("/verify/doc/:id/remove", async (c) => {
    const kyb = await guard(c);
    if (kyb && UUID.test(c.req.param("id"))) await kyb.store.removeDoc(c.get("biz").id, c.req.param("id"));
    return c.redirect("/app/verify?msg=removed", 303);
  });

  app.get("/verify/doc/:id", async (c) => {
    const kyb = ctx.deps.verification;
    const file = kyb && UUID.test(c.req.param("id")) ? await kyb.store.docFile(c.get("biz").id, c.req.param("id")) : null;
    if (!file) return c.notFound();
    return c.body(file.data as unknown as ArrayBuffer, 200, {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename="${file.fileName.replace(/"/g, "")}"`,
    });
  });

  app.post("/verify/submit", async (c) => {
    const kyb = ctx.deps.verification;
    if (!kyb) return c.redirect("/app/verify", 303);
    const biz = c.get("biz");
    const [v, docs] = await Promise.all([kyb.store.get(biz.id), kyb.store.docs(biz.id)]);
    if (missingForSubmit(v, docs).length || !(await kyb.store.submit(biz.id, `owner ${c.get("user").waId}`))) {
      return c.redirect("/app/verify?msg=bad", 303);
    }
    await kyb.onSubmitted?.(biz.id, biz.name).catch((err) => ctx.log.error("Couldn't tell yarnOga about a verification:", err));
    return c.redirect("/app/verify?msg=sent_review", 303);
  });
}
