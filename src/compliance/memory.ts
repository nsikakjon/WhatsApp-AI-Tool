import {
  blankVerification,
  editable,
  type Verification,
  type VerificationDoc,
  type VerificationEvent,
  type VerificationStore,
} from "./store.js";

// An in-memory verification store, for tests and the design preview
// (scripts/preview-owner-app.ts). Not used by the server.

export const BIZ = "11111111-1111-1111-1111-111111111111";

export function memoryVerifications() {
  const rows = new Map<string, Verification>();
  const docs: Array<VerificationDoc & { businessId: string; data: Uint8Array }> = [];
  const events: Array<VerificationEvent & { businessId: string }> = [];
  const get = (id: string) => rows.get(id) ?? blankVerification(id);
  const store: VerificationStore = {
    get: async (id) => ({ ...get(id) }),
    saveDetails: async (id, d) => void rows.set(id, { ...get(id), ...d }),
    docs: async (id) => docs.filter((d) => d.businessId === id),
    addDoc: async (id, kind, f) =>
      void docs.push({ id: `22222222-2222-2222-2222-${String(docs.length).padStart(12, "0")}`, businessId: id, kind, fileName: f.name, mimeType: f.mimeType, size: f.data.length, uploadedAt: new Date(), data: f.data }),
    removeDoc: async (id, docId) => {
      const i = docs.findIndex((d) => d.id === docId && d.businessId === id);
      if (i >= 0) docs.splice(i, 1);
    },
    docFile: async (id, docId) => {
      const d = docs.find((x) => x.id === docId && x.businessId === id);
      return d ? { data: d.data, mimeType: d.mimeType, fileName: d.fileName } : null;
    },
    submit: async (id, actor) => {
      if (!editable(get(id).status)) return false;
      rows.set(id, { ...get(id), status: "submitted", submittedAt: new Date() });
      events.push({ businessId: id, action: "submitted", note: null, actor, at: new Date() });
      return true;
    },
    review: async (id, status, note, actor) => {
      rows.set(id, { ...get(id), status, reviewNote: note, reviewedAt: new Date() });
      events.push({ businessId: id, action: status, note, actor, at: new Date() });
    },
    saveRegistry: async (id, result) => void rows.set(id, { ...get(id), registry: result, registryCheckedAt: new Date() }),
    list: async () => [{ ...get(BIZ), businessName: "KahnPrints", active: true }],
    events: async (id) => events.filter((e) => e.businessId === id),
  };
  return { store, rows, docs };
}

