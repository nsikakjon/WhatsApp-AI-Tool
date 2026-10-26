import { describe, expect, it, vi } from "vitest";
import { createCompliance, decisionMessage } from "./index.js";
import { cleanRcNumber, createDojahRegistry, sameBusinessName } from "./registry.js";
import { BIZ, memoryVerifications } from "./memory.js";
import { blankVerification, documentType } from "./store.js";
import { missingForSubmit } from "../owner/sections/verify.js";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

const auth = { Authorization: `Basic ${btoa("jay:compliance-password")}`, Origin: "https://x.example", Host: "x.example" };
const form = (body: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(body), headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" } });

describe("compliance page", () => {
  it("needs the password", async () => {
    const app = createCompliance({ password: "compliance-password", store: memoryVerifications().store });
    expect((await app.request("/")).status).toBe(401);
    expect(await (await app.request("/", { headers: auth })).text()).toContain("KahnPrints");
  });

  it("shows a business's details and documents and records Jay's decision, telling the owner", async () => {
    const mem = memoryVerifications();
    await mem.store.saveDetails(BIZ, { entityType: "company", registeredName: "Kahn Prints Ltd", rcNumber: "1234567", tin: null, address: "12 Allen Ave", directorName: "Ada Okafor", contactEmail: null });
    await mem.store.addDoc(BIZ, "certificate", { name: "cert.pdf", mimeType: "application/pdf", data: PDF });
    await mem.store.submit(BIZ, "owner");
    const notifyOwner = vi.fn(async () => {});
    const app = createCompliance({ password: "compliance-password", store: mem.store, notifyOwner, log: { info() {}, error() {} } });

    const page = await (await app.request(`/b/${BIZ}`, { headers: auth })).text();
    expect(page).toContain("Kahn Prints Ltd");
    expect(page).toContain("cert.pdf");
    expect(page).toContain("Missing:"); // no status report, ID or proof of address yet
    expect(page).toContain("search.cac.gov.ng");

    const doc = await app.request(`/b/${BIZ}/doc/${mem.docs[0]!.id}`, { headers: auth });
    expect(doc.headers.get("content-type")).toBe("application/pdf");

    // Asking for more needs a note.
    expect((await app.request(`/b/${BIZ}/decide`, form({ decision: "more_info" }))).status).toBe(400);
    await app.request(`/b/${BIZ}/decide`, form({ decision: "more_info", note: "Please upload a recent utility bill." }));
    expect(mem.rows.get(BIZ)!.status).toBe("more_info");
    expect(notifyOwner).toHaveBeenCalledWith(BIZ, expect.stringContaining("recent utility bill"));

    await app.request(`/b/${BIZ}/decide`, form({ decision: "approved" }));
    expect(mem.rows.get(BIZ)!.status).toBe("approved");
  });

  it("runs a CAC check when Dojah is set up", async () => {
    const mem = memoryVerifications();
    await mem.store.saveDetails(BIZ, { entityType: "company", registeredName: "Kahn Prints", rcNumber: "RC 1261103", tin: null, address: null, directorName: null, contactEmail: null });
    const registry = { check: vi.fn(async () => ({ found: true, name: "KAHN PRINTS LIMITED", status: "ACTIVE", type: "COMPANY", registeredOn: "2020-01-01", address: null, people: [], nameMatches: true, provider: "Dojah" })) };
    const app = createCompliance({ password: "compliance-password", store: mem.store, registry });
    await app.request(`/b/${BIZ}/check`, form({}));
    expect(registry.check).toHaveBeenCalledWith("1261103", "company", "Kahn Prints");
    expect(await (await app.request(`/b/${BIZ}`, { headers: auth })).text()).toContain("KAHN PRINTS LIMITED");
  });
});

describe("Dojah CAC registry", () => {
  it("reads the company and its directors, and compares names", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ entity: { company_name: "KAHN PRINTS LIMITED", status: "ACTIVE", type_of_company: "COMPANY", date_of_registration: "2020-03-04T00:00:00Z", city: "Ikeja", state: "Lagos", affiliates: [{ first_name: "ADA", last_name: "OKAFOR", affiliate_type: "DIRECTOR" }] } }),
    );
    const r = await createDojahRegistry({ appId: "a", secretKey: "s", sandbox: true, fetch }).check("1261103", "company", "Kahn Prints Ltd.");
    expect(r).toMatchObject({ found: true, name: "KAHN PRINTS LIMITED", registeredOn: "2020-03-04", people: ["ADA OKAFOR (director)"], nameMatches: true });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://sandbox.dojah.io/api/v1/kyc/cac/advance?rc_number=1261103&company_type=COMPANY");
    expect((init.headers as Record<string, string>).Authorization).toBe("s");
  });

  it("explains an empty wallet and a missing company", async () => {
    const reg = (status: number) => createDojahRegistry({ appId: "a", secretKey: "s", fetch: async () => new Response("{}", { status }) });
    expect((await reg(402).check("1", "company", null)).error).toContain("wallet");
    expect((await reg(404).check("1", "company", null)).found).toBe(false);
    expect((await reg(200).check("1", "individual", null)).error).toContain("Individuals");
  });

  it("matches business names and reads RC numbers the way people type them", () => {
    expect(sameBusinessName("Kahn Prints Ltd.", "KAHN PRINTS LIMITED")).toBe(true);
    expect(sameBusinessName("Kahn Prints", "Kahn Foods Limited")).toBe(false);
    expect(cleanRcNumber("RC 1234567")).toBe("1234567");
    expect(cleanRcNumber("BN-3456789")).toBe("3456789");
    expect(cleanRcNumber("abc")).toBeNull();
  });
});

describe("helpers", () => {
  it("only accepts real PDF, JPEG or PNG files", () => {
    expect(documentType(PDF)).toBe("application/pdf");
    expect(documentType(new TextEncoder().encode("<html>"))).toBeNull();
  });

  it("lists what's still needed before the owner can send", () => {
    const v = { ...blankVerification(BIZ), entityType: "business_name" as const, registeredName: "Kahn", rcNumber: "123", address: "x", directorName: "Ada" };
    expect(missingForSubmit(v, [])).toEqual(["Certificate of incorporation or business name registration", "ID of a director or the owner", "Proof of address"]);
  });

  it("words the owner's message for each decision", () => {
    expect(decisionMessage("approved", "Kahn", null)).toContain("now verified");
    expect(decisionMessage("rejected", "Kahn", "Fake certificate")).toContain("Fake certificate");
  });
});
