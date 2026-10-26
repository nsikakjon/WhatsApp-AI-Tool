import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Business verification (KYB, migration 0050): the details and documents an
// owner sends from the app, and Jay's decisions on the compliance page.
// Kept behind an interface so tests use an in-memory version.

export type EntityType = "company" | "business_name" | "individual";
export type VerificationStatus = "not_started" | "submitted" | "more_info" | "approved" | "rejected";
export type DocKind = "certificate" | "status_report" | "memart" | "id" | "address" | "licence" | "other";

export const DOC_KINDS: Record<DocKind, string> = {
  certificate: "Certificate of incorporation or business name registration",
  status_report: "CAC status report (CAC 1.1 / CAC 7 or BN form)",
  memart: "Memorandum and Articles of Association",
  id: "ID of a director or the owner (NIN slip, voter's card, driver's licence or passport)",
  address: "Proof of address (utility bill or bank statement, last 3 months)",
  licence: "Operating licence (if your business needs one)",
  other: "Any other document",
};

/** What each kind of business must send before it can submit. */
export function requiredDocs(type: EntityType | null): DocKind[] {
  if (type === "company") return ["certificate", "status_report", "id", "address"];
  if (type === "business_name") return ["certificate", "id", "address"];
  return ["id", "address"];
}

export const STATUS_TEXT: Record<VerificationStatus, string> = {
  not_started: "Not sent yet",
  submitted: "Waiting for review",
  more_info: "More information needed",
  approved: "Verified",
  rejected: "Not approved",
};

/** The owner can change details and documents in these states only. */
export function editable(status: VerificationStatus): boolean {
  return status === "not_started" || status === "more_info" || status === "rejected";
}

export interface VerificationDetails {
  entityType: EntityType | null;
  registeredName: string | null;
  rcNumber: string | null;
  tin: string | null;
  address: string | null;
  directorName: string | null;
  contactEmail: string | null;
}

/** What a CAC registry check found (see registry.ts). */
export interface RegistryResult {
  found: boolean;
  name: string | null;
  status: string | null;
  type: string | null;
  registeredOn: string | null;
  address: string | null;
  /** Directors, proprietors and shareholders, when the check returns them. */
  people: string[];
  /** Whether the registered name matches the one the owner typed. */
  nameMatches: boolean | null;
  provider: string;
  error?: string;
}

export interface Verification extends VerificationDetails {
  businessId: string;
  status: VerificationStatus;
  reviewNote: string | null;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  registry: RegistryResult | null;
  registryCheckedAt: Date | null;
}

export interface VerificationDoc {
  id: string;
  kind: DocKind;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
}

export interface VerificationEvent {
  action: string;
  note: string | null;
  actor: string;
  at: Date;
}

export interface VerificationStore {
  /** The business's verification, or a blank "not started" one. */
  get(businessId: string): Promise<Verification>;
  saveDetails(businessId: string, details: VerificationDetails): Promise<void>;
  docs(businessId: string): Promise<VerificationDoc[]>;
  addDoc(businessId: string, kind: DocKind, file: { name: string; mimeType: string; data: Uint8Array }): Promise<void>;
  removeDoc(businessId: string, docId: string): Promise<void>;
  docFile(businessId: string, docId: string): Promise<{ data: Uint8Array; mimeType: string; fileName: string } | null>;
  /** Sends it for review; false when it wasn't in a state the owner can send from. */
  submit(businessId: string, actor: string): Promise<boolean>;
  review(businessId: string, status: "approved" | "rejected" | "more_info", note: string | null, actor: string): Promise<void>;
  saveRegistry(businessId: string, result: RegistryResult, actor: string): Promise<void>;
  /** Every quote business with its verification, newest change first. */
  list(): Promise<Array<Verification & { businessName: string; active: boolean }>>;
  events(businessId: string): Promise<VerificationEvent[]>;
}

const BUCKET = "kyb-documents";

type Row = {
  business_id: string;
  entity_type: EntityType | null;
  registered_name: string | null;
  rc_number: string | null;
  tin: string | null;
  address: string | null;
  director_name: string | null;
  contact_email: string | null;
  status: VerificationStatus;
  review_note: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  registry_result: RegistryResult | null;
  registry_checked_at: string | null;
};

const date = (v: string | null) => (v ? new Date(v) : null);

export function blankVerification(businessId: string): Verification {
  return {
    businessId,
    entityType: null,
    registeredName: null,
    rcNumber: null,
    tin: null,
    address: null,
    directorName: null,
    contactEmail: null,
    status: "not_started",
    reviewNote: null,
    submittedAt: null,
    reviewedAt: null,
    registry: null,
    registryCheckedAt: null,
  };
}

function toVerification(r: Row): Verification {
  return {
    businessId: r.business_id,
    entityType: r.entity_type,
    registeredName: r.registered_name,
    rcNumber: r.rc_number,
    tin: r.tin,
    address: r.address,
    directorName: r.director_name,
    contactEmail: r.contact_email,
    status: r.status,
    reviewNote: r.review_note,
    submittedAt: date(r.submitted_at),
    reviewedAt: date(r.reviewed_at),
    registry: r.registry_result,
    registryCheckedAt: date(r.registry_checked_at),
  };
}

export function createSupabaseVerifications(db: SupabaseClient): VerificationStore {
  const fail = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what} failed: ${error.message}`);
  };
  const log = async (businessId: string, action: string, note: string | null, actor: string) => {
    const { error } = await db.from("quote_verification_events").insert({ business_id: businessId, action, note, actor });
    fail("verification event", error);
  };
  const upsert = async (businessId: string, fields: Record<string, unknown>) => {
    const { error } = await db
      .from("quote_business_verifications")
      .upsert({ business_id: businessId, ...fields, updated_at: new Date().toISOString() }, { onConflict: "business_id" });
    fail("save verification", error);
  };

  const store: VerificationStore = {
    async get(businessId) {
      const { data, error } = await db.from("quote_business_verifications").select("*").eq("business_id", businessId).maybeSingle();
      fail("verification", error);
      return data ? toVerification(data as Row) : blankVerification(businessId);
    },

    async saveDetails(businessId, d) {
      await upsert(businessId, {
        entity_type: d.entityType,
        registered_name: d.registeredName,
        rc_number: d.rcNumber,
        tin: d.tin,
        address: d.address,
        director_name: d.directorName,
        contact_email: d.contactEmail,
      });
    },

    async docs(businessId) {
      const { data, error } = await db
        .from("quote_business_documents")
        .select("id, kind, file_name, mime_type, size_bytes, uploaded_at")
        .eq("business_id", businessId)
        .order("uploaded_at");
      fail("documents", error);
      return (data ?? []).map((d) => ({
        id: d.id as string,
        kind: d.kind as DocKind,
        fileName: d.file_name as string,
        mimeType: d.mime_type as string,
        size: Number(d.size_bytes),
        uploadedAt: new Date(d.uploaded_at as string),
      }));
    },

    async addDoc(businessId, kind, file) {
      const path = `${businessId}/${kind}-${randomUUID()}`;
      const up = await db.storage.from(BUCKET).upload(path, file.data, { contentType: file.mimeType, upsert: false });
      fail("upload document", up.error);
      const { error } = await db.from("quote_business_documents").insert({
        business_id: businessId,
        kind,
        file_path: path,
        file_name: file.name,
        mime_type: file.mimeType,
        size_bytes: file.data.length,
      });
      if (error) {
        await db.storage.from(BUCKET).remove([path]);
        fail("save document", error);
      }
    },

    async removeDoc(businessId, docId) {
      const { data, error } = await db
        .from("quote_business_documents")
        .delete()
        .eq("id", docId)
        .eq("business_id", businessId)
        .select("file_path");
      fail("remove document", error);
      const paths = (data ?? []).map((d) => d.file_path as string);
      if (paths.length) await db.storage.from(BUCKET).remove(paths);
    },

    async docFile(businessId, docId) {
      const { data, error } = await db
        .from("quote_business_documents")
        .select("file_path, file_name, mime_type")
        .eq("id", docId)
        .eq("business_id", businessId)
        .maybeSingle();
      fail("document", error);
      if (!data) return null;
      const file = await db.storage.from(BUCKET).download(data.file_path as string);
      if (file.error || !file.data) return null;
      return { data: new Uint8Array(await file.data.arrayBuffer()), mimeType: data.mime_type as string, fileName: data.file_name as string };
    },

    async submit(businessId, actor) {
      const current = await store.get(businessId);
      if (!editable(current.status)) return false;
      await upsert(businessId, { status: "submitted", submitted_at: new Date().toISOString() });
      await log(businessId, "submitted", null, actor);
      return true;
    },

    async review(businessId, status, note, actor) {
      await upsert(businessId, { status, review_note: note, reviewed_at: new Date().toISOString() });
      await log(businessId, status, note, actor);
    },

    async saveRegistry(businessId, result, actor) {
      await upsert(businessId, { registry_result: result, registry_checked_at: new Date().toISOString() });
      await log(businessId, "registry_check", result.found ? `Found: ${result.name ?? ""}` : (result.error ?? "Not found"), actor);
    },

    async list() {
      const { data, error } = await db
        .from("quote_businesses")
        .select("id, name, active, quote_business_verifications(*)")
        .order("created_at", { ascending: false });
      fail("verification list", error);
      type ListRow = { id: string; name: string; active: boolean; quote_business_verifications: Row | Row[] | null };
      return ((data ?? []) as unknown as ListRow[]).map((b) => {
        const v = Array.isArray(b.quote_business_verifications) ? b.quote_business_verifications[0] : b.quote_business_verifications;
        return { ...(v ? toVerification(v) : blankVerification(b.id)), businessName: b.name, active: b.active };
      });
    },

    async events(businessId) {
      const { data, error } = await db
        .from("quote_verification_events")
        .select("action, note, actor, created_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(50);
      fail("verification events", error);
      return (data ?? []).map((e) => ({
        action: e.action as string,
        note: (e.note as string | null) ?? null,
        actor: e.actor as string,
        at: new Date(e.created_at as string),
      }));
    },
  };
  return store;
}

/** True when the bytes really are a PDF, JPEG or PNG; the type, or null. */
export function documentType(bytes: Uint8Array): "application/pdf" | "image/jpeg" | "image/png" | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return null;
}
