import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

// Files customers send in the chat: artwork and logos for a print shop, a
// style photo for a tailor, a picture of the cake they want, and payment
// screenshots (QUOTE_CUSTOMER_FILES, migration 0085). Each one is copied into
// storage, because WhatsApp only keeps a file for about 30 days, and linked to
// the customer's order so the owner finds it on the order board and in the
// inbox. Files are kept for KEEP_DAYS.

/** "order": something for the order (artwork, photo, measurements sheet). "payment": a transfer screenshot or receipt. */
export type FileKind = "order" | "payment";

export interface CustomerFile {
  id: string;
  contactId: string;
  orderId: string | null;
  waMessageId: string;
  kind: FileKind;
  path: string;
  mimeType: string;
  fileName: string | null;
  caption: string | null;
  bytes: number;
  createdAt: Date;
}

export interface NewCustomerFile {
  contactId: string;
  orderId: string | null;
  waMessageId: string;
  kind: FileKind;
  mimeType: string;
  fileName: string | null;
  caption: string | null;
  data: Uint8Array;
}

export interface CustomerFileStore {
  /** Keeps a file. Saving the same WhatsApp message again returns the file already kept. */
  save(file: NewCustomerFile): Promise<CustomerFile>;
  get(id: string): Promise<CustomerFile | null>;
  byMessage(waMessageId: string): Promise<CustomerFile | null>;
  update(id: string, change: { kind?: FileKind; orderId?: string }): Promise<void>;
  /**
   * Moves a customer's recent order files that aren't on a confirmed order yet
   * (none, or a quote they replaced) onto this quote. Returns how many moved.
   */
  moveToQuote(contactId: string, orderId: string, since: Date): Promise<number>;
  forOrders(orderIds: string[]): Promise<CustomerFile[]>;
  forContact(contactId: string): Promise<CustomerFile[]>;
  download(file: CustomerFile): Promise<Uint8Array | null>;
}

export const KEEP_DAYS = 90;
/** Supabase Storage's upload limit. A bigger file stays in WhatsApp only. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** How long after confirming an order a customer's file still goes with it. */
export const RECENT_ORDER_DAYS = 3;

// Words that say a file is a payment, in the languages the bot speaks.
const PAYMENT =
  /\b(paid|pay(ment)?|transfer(red)?|receipt|teller|debit(ed)?|alert|proof|evidence|sent the money|don pay|i don send|virement|paiement|pay[ée]|re[çc]u|preuve|nabiya|na tura|nimelipa|malipo|risiti|mpesa|m-pesa)\b/i;
// Formats only design software opens, never a bank's screenshot.
const DESIGN_FILE = /\.(cdr|ai|eps|psd|svg|indd|tiff?|zip|rar|docx?|pptx?|xlsx?|dxf|stl)$/i;

/**
 * What a file is. "ask" when a customer with an unpaid order sends a picture
 * or PDF with nothing saying what it is: a payment screenshot and an artwork
 * look the same to code, so the customer taps one of two buttons.
 */
export function fileKind(file: { caption?: string; mimeType: string; fileName?: string }, unpaidOrder: boolean): FileKind | "ask" {
  const caption = file.caption?.trim() ?? "";
  if (DESIGN_FILE.test(file.fileName ?? "")) return "order";
  if (!/^image\/|^application\/pdf$/.test(file.mimeType)) return "order";
  if (!unpaidOrder) return "order";
  if (PAYMENT.test(caption)) return "payment";
  return caption ? "order" : "ask";
}

/** Pictures a browser can show safely (never SVG, which can carry scripts). */
export function isPicture(mimeType: string): boolean {
  return /^image\/(jpeg|png|webp|gif)$/.test(mimeType);
}

/** "logo.cdr (2.4 MB)" or "Photo (310 KB)". */
export function describeFile(file: Pick<CustomerFile, "fileName" | "mimeType" | "bytes">): string {
  const name = file.fileName ?? (file.mimeType.startsWith("image/") ? "Photo" : file.mimeType === "application/pdf" ? "PDF" : "File");
  const size = file.bytes >= 1024 * 1024 ? `${(file.bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.bytes / 1024))} KB`;
  return `${name} (${size})`;
}

const BUCKET = "quote-files";
const EXTENSIONS: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf" };

type Row = {
  id: string;
  contact_id: string;
  order_id: string | null;
  wa_message_id: string;
  kind: FileKind;
  path: string;
  mime_type: string;
  file_name: string | null;
  caption: string | null;
  bytes: number;
  created_at: string;
};

const toFile = (r: Row): CustomerFile => ({
  id: r.id,
  contactId: r.contact_id,
  orderId: r.order_id,
  waMessageId: r.wa_message_id,
  kind: r.kind,
  path: r.path,
  mimeType: r.mime_type,
  fileName: r.file_name,
  caption: r.caption,
  bytes: r.bytes,
  createdAt: new Date(r.created_at),
});

/** `readIds`: the businesses whose files can be read, e.g. a business and its branches in the owner app. New files go under `businessId`. */
export function createSupabaseCustomerFiles(db: SupabaseClient, businessId: string, readIds: string[] = [businessId]): CustomerFileStore {
  const table = () => db.from("quote_customer_files");
  const one = async (column: string, value: string) => {
    const { data, error } = await table().select("*").in("business_id", readIds).eq(column, value).maybeSingle();
    if (error) throw new Error(`customer file failed: ${error.message}`);
    return data ? toFile(data as Row) : null;
  };

  return {
    async save(file) {
      const existing = await one("wa_message_id", file.waMessageId);
      if (existing) return existing;
      const ext = file.fileName?.match(/\.[a-z0-9]{1,5}$/i)?.[0]?.toLowerCase() ?? EXTENSIONS[file.mimeType] ?? "";
      const path = `businesses/${businessId}/customer-files/${randomUUID()}${ext}`;
      const upload = await db.storage.from(BUCKET).upload(path, file.data, { contentType: file.mimeType });
      if (upload.error) throw new Error(`customer file upload failed: ${upload.error.message}`);
      const { data, error } = await table()
        .insert({
          business_id: businessId,
          contact_id: file.contactId,
          order_id: file.orderId,
          wa_message_id: file.waMessageId,
          kind: file.kind,
          path,
          mime_type: file.mimeType,
          file_name: file.fileName,
          caption: file.caption,
          bytes: file.data.byteLength,
        })
        .select("*")
        .single();
      if (error) {
        await db.storage.from(BUCKET).remove([path]);
        // The same message saved at the same moment by a retried webhook.
        if (error.code === "23505") return (await one("wa_message_id", file.waMessageId))!;
        throw new Error(`customer file save failed: ${error.message}`);
      }
      return toFile(data as Row);
    },

    get: (id) => one("id", id),
    byMessage: (waMessageId) => one("wa_message_id", waMessageId),

    async update(id, change) {
      const { error } = await table()
        .update({ ...(change.kind ? { kind: change.kind } : {}), ...(change.orderId ? { order_id: change.orderId } : {}) })
        .eq("business_id", businessId)
        .eq("id", id);
      if (error) throw new Error(`customer file update failed: ${error.message}`);
    },

    async moveToQuote(contactId, orderId, since) {
      const { data, error } = await table()
        .select("id, order_id, quote_orders(status)")
        .eq("business_id", businessId)
        .eq("contact_id", contactId)
        .eq("kind", "order")
        .gte("created_at", since.toISOString());
      if (error) throw new Error(`customer files to move failed: ${error.message}`);
      const ids = ((data ?? []) as unknown as Array<{ id: string; order_id: string | null; quote_orders: { status: string } | null }>)
        .filter((r) => r.order_id !== orderId && (!r.order_id || r.quote_orders?.status === "quoted" || r.quote_orders?.status === "cancelled"))
        .map((r) => r.id);
      if (!ids.length) return 0;
      const moved = await table().update({ order_id: orderId }).eq("business_id", businessId).in("id", ids);
      if (moved.error) throw new Error(`customer files move failed: ${moved.error.message}`);
      return ids.length;
    },

    async forOrders(orderIds) {
      if (!orderIds.length) return [];
      const { data, error } = await table().select("*").in("business_id", readIds).in("order_id", orderIds).order("created_at");
      if (error) throw new Error(`order files failed: ${error.message}`);
      return ((data ?? []) as Row[]).map(toFile);
    },

    async forContact(contactId) {
      const { data, error } = await table().select("*").in("business_id", readIds).eq("contact_id", contactId).order("created_at");
      if (error) throw new Error(`chat files failed: ${error.message}`);
      return ((data ?? []) as Row[]).map(toFile);
    },

    async download(file) {
      const { data, error } = await db.storage.from(BUCKET).download(file.path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  };
}

/**
 * Keeps a file a customer sends while a person is handling the chat and the
 * bot is quiet. It isn't linked to an order yet: the inbox shows it, and it
 * goes on the customer's next quote.
 */
export async function keepQuietFile(
  files: CustomerFileStore,
  msg: { waMessageId: string; type: string; mediaId?: string; fileName?: string; caption?: string },
  contactId: string,
  downloadMedia: (mediaId: string) => Promise<{ data: Blob; mimeType: string }>,
): Promise<boolean> {
  if ((msg.type !== "image" && msg.type !== "document") || !msg.mediaId) return false;
  const media = await downloadMedia(msg.mediaId);
  const data = new Uint8Array(await media.data.arrayBuffer());
  if (data.byteLength > MAX_FILE_BYTES) return false;
  await files.save({
    contactId,
    orderId: null,
    waMessageId: msg.waMessageId,
    kind: "order",
    mimeType: media.mimeType,
    fileName: msg.fileName ?? null,
    caption: msg.caption?.trim() || null,
    data,
  });
  return true;
}

/** Deletes every business's files older than KEEP_DAYS, a batch at a time. */
export async function deleteOldCustomerFiles(db: SupabaseClient, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000);
  const { data, error } = await db.from("quote_customer_files").select("id, path").lt("created_at", cutoff.toISOString()).limit(500);
  if (error) throw new Error(`old customer files failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; path: string }>;
  if (!rows.length) return 0;
  await db.storage.from(BUCKET).remove(rows.map((r) => r.path));
  const gone = await db.from("quote_customer_files").delete().in("id", rows.map((r) => r.id));
  if (gone.error) throw new Error(`old customer files delete failed: ${gone.error.message}`);
  return rows.length;
}

/** Customer files in memory, for tests and the owner's test bot. */
export function memoryCustomerFiles(): CustomerFileStore & { files: CustomerFile[]; blobs: Map<string, Uint8Array> } {
  const files: CustomerFile[] = [];
  const blobs = new Map<string, Uint8Array>();
  return {
    files,
    blobs,
    async save(file) {
      const existing = files.find((f) => f.waMessageId === file.waMessageId);
      if (existing) return existing;
      const saved: CustomerFile = {
        id: `f${files.length + 1}`,
        contactId: file.contactId,
        orderId: file.orderId,
        waMessageId: file.waMessageId,
        kind: file.kind,
        path: `files/f${files.length + 1}`,
        mimeType: file.mimeType,
        fileName: file.fileName,
        caption: file.caption,
        bytes: file.data.byteLength,
        createdAt: new Date(),
      };
      files.push(saved);
      blobs.set(saved.path, file.data);
      return saved;
    },
    async get(id) {
      return files.find((f) => f.id === id) ?? null;
    },
    async byMessage(waMessageId) {
      return files.find((f) => f.waMessageId === waMessageId) ?? null;
    },
    async update(id, change) {
      const f = files.find((x) => x.id === id);
      if (!f) return;
      if (change.kind) f.kind = change.kind;
      if (change.orderId) f.orderId = change.orderId;
    },
    async moveToQuote(contactId, orderId) {
      const moving = files.filter((f) => f.contactId === contactId && f.kind === "order" && !f.orderId);
      for (const f of moving) f.orderId = orderId;
      return moving.length;
    },
    async forOrders(orderIds) {
      return files.filter((f) => f.orderId && orderIds.includes(f.orderId));
    },
    async forContact(contactId) {
      return files.filter((f) => f.contactId === contactId);
    },
    async download(file) {
      return blobs.get(file.path) ?? null;
    },
  };
}
