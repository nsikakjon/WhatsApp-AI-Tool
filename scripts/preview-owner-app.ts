// Runs the owner app with made-up data on http://localhost:4545/app, for
// looking at the design without a database. Not used by the server.
//   npx tsx scripts/preview-owner-app.ts
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { hashToken } from "../src/owner/auth.js";
import { createOwnerApp } from "../src/owner/index.js";
import type { AppUser, ProductRecord, UserStore } from "../src/owner/store.js";
import type { AppBusiness } from "../src/owner/types.js";
import type { BoardOrder } from "../src/products/quote/board.js";
import { memoryVerifications } from "../src/compliance/memory.js";
import { createCompliance } from "../src/compliance/index.js";

const BIZ = "11111111-1111-1111-1111-111111111111";
const owner: AppUser = { id: "00000000-0000-0000-0000-000000000001", businessId: BIZ, waId: "2348011111111", name: "Jay", role: "owner", passwordHash: null, sessionEpoch: 0, active: true, lastLoginAt: new Date() };
const staff: AppUser = { ...owner, id: "00000000-0000-0000-0000-000000000002", waId: "2348022222222", name: "Bola", role: "staff" };
const tokens = new Map<string, string>([[hashToken("owner"), owner.id], [hashToken("staff"), staff.id]]);
const users: UserStore = {
  get: async (id) => [owner, staff].find((u) => u.id === id) ?? null,
  byWaId: async (wa) => [owner, staff].filter((u) => u.waId === wa),
  ensureOwner: async () => owner,
  team: async () => [owner, staff],
  addStaff: async () => staff,
  removeStaff: async () => {},
  setPassword: async () => {},
  bumpEpoch: async () => {},
  touchLogin: async () => {},
  saveToken: async () => {},
  useToken: async (hash) => tokens.get(hash) ?? null,
};
const day = 86_400_000;
const now = Date.now();
const names = ["Ada Okafor", "Chinedu Eze", "Bola Ade", "Tunde Bakare", "Ngozi Obi", "Musa Bello", "Kemi Lawal", "Ifeoma N."];
const items = ["500 x Flyers: A5, both sides", "20 x Branded T-shirts: white, 1 colour", "2 x Roll-up banner", "100 x Business cards", "50 x Mugs: white"];
const stages: Array<Pick<BoardOrder, "status" | "stage" | "deliveryStatus">> = [
  { status: "confirmed", stage: null, deliveryStatus: null },
  { status: "paid", stage: null, deliveryStatus: null },
  { status: "paid", stage: "in_production", deliveryStatus: null },
  { status: "paid", stage: null, deliveryStatus: "assigned" },
  { status: "paid", stage: "delivered", deliveryStatus: null },
];
const orders: BoardOrder[] = Array.from({ length: 11 }, (_, i) => ({
  id: `33333333-3333-3333-3333-${String(i).padStart(12, "0")}`,
  orderNumber: 1040 + i,
  ...stages[i % 5]!,
  customerName: names[i % names.length]!,
  customerWaId: "234803333333" + (i % 10),
  items: items[i % items.length]!,
  totalKobo: [4_500_000, 12_000_000, 3_600_000, 2_500_000, 750_000][i % 5]!,
  confirmedAt: new Date(now - i * 3_600_000 * 7),
  movedAt: new Date(now - i * 3_600_000 * 5),
}));
const products: ProductRecord[] = [
  { id: "22222222-2222-2222-2222-000000000001", name: "Flyers", description: "Glossy 150gsm, full colour", category: "Printing", unit: "piece", leadTimeDays: 2, active: true, photoPath: null, options: [{ id: "a", name: "A5, both sides", minQuantity: 100, stock: null, tiers: [{ minQuantity: 100, unitPriceKobo: 9_000 }, { minQuantity: 1000, unitPriceKobo: 6_500 }] }] },
  { id: "22222222-2222-2222-2222-000000000002", name: "Branded T-shirts", description: "Cotton, white or black", category: "Apparel", unit: "piece", leadTimeDays: 3, active: true, photoPath: null, options: [{ id: "b", name: "white, 1 colour", minQuantity: 10, stock: 4, tiers: [{ minQuantity: 10, unitPriceKobo: 600_000 }] }] },
  { id: "22222222-2222-2222-2222-000000000003", name: "Mugs", description: null, category: "Gifts", unit: "mug", leadTimeDays: 1, active: true, photoPath: null, options: [{ id: "c", name: "white", minQuantity: 12, stock: 40, tiers: [{ minQuantity: 12, unitPriceKobo: 250_000 }] }] },
];
const biz: AppBusiness = {
  id: BIZ, name: "KahnPrints", orderPrefix: "KP", fromEnv: false, language: "en", currency: "NGN", voiceReplies: false, courier: { available: true, on: true, set: async () => {} }, numberId: "PNID", includeUnnumbered: false,
  features: { planCode: async () => "pro", has: async () => true, limit: async (f) => (f === "ai_credits" ? 7500 : f === "bot_messages" ? 3000 : f === "transaction_fee" ? 250 : null) },
  board: {
    orders: async () => orders,
    setStage: async () => true,
    sales: async (from) => (from.getTime() > now - 31 * day ? { quotes: 64, orders: 41, paidInKobo: 182_450_000 } : { quotes: 52, orders: 30, paidInKobo: 141_200_000 }),
    aiRepliesUsed: async () => 4820,
  },
  prices: { products: async () => products, product: async (id) => products.find((p) => p.id === id) ?? null, save: async () => products[0]!.id, remove: async () => {} },
  delivery: {
    onTheRoad: async () => [
      { id: "d1", orderRef: "KP-1042", status: "picked_up" as const, riderName: "Musa", riderWaId: "2348055555555", customerName: "Ada Okafor", customerWaId: "2348012345678", address: "12 Admiralty Way, Lekki", drop: { lat: 6.4474, lng: 3.4727 }, rider: { lat: 6.4541, lng: 3.4316, seenAt: new Date(Date.now() - 60_000) }, assignedAt: new Date(Date.now() - 40 * 60_000), trackLink: "https://example.com/track/x" },
      { id: "d2", orderRef: "KP-1043", status: "assigned" as const, riderName: "Femi", riderWaId: "2348066666666", customerName: "Tunde", customerWaId: "2348023456789", address: "5 Allen Avenue, Ikeja", drop: null, rider: null, assignedAt: new Date(Date.now() - 5 * 60_000) },
    ],
    zones: async () => [{ id: "z1", name: "Mainland", areas: ["ikeja", "yaba", "surulere"], feeKobo: 250_000 }, { id: "z2", name: "Island", areas: ["lekki", "vi", "ikoyi", "ajah"], feeKobo: 400_000 }],
    saveZone: async () => {}, removeZone: async () => {},
    riders: async () => [{ id: "r1", name: "Musa", waId: "2348055555555" }, { id: "r2", name: "Femi", waId: "2348066666666" }],
    addRider: async () => {}, removeRider: async () => {},
  },
  data: {
    info: async () => ({ name: "KahnPrints", description: "a print shop in Ikeja", orderPrefix: "KP", ownerWaId: owner.waId, businessDetails: "12 Allen Avenue, Ikeja\n0801 111 1111", paymentDetails: null, whatsappNumber: "2348099999999", sheetKey: "a".repeat(32) }),
    saveInfo: async () => {}, saveLanguage: async () => {},
    customers: async () => [
      { contactId: "c1", name: "Ada Okafor", waId: "2348012345678", orders: 6, spentKobo: 18_500_000, lastOrderAt: new Date(Date.now() - 2 * 86_400_000), rating: 4.7 },
      { contactId: "c2", name: "Tunde Bakare", waId: "2348023456789", orders: 2, spentKobo: 3_200_000, lastOrderAt: new Date(Date.now() - 9 * 86_400_000), rating: null },
      { contactId: "c3", name: null, waId: "2348034567890", orders: 1, spentKobo: 0, lastOrderAt: new Date(Date.now() - 30 * 60_000), rating: null },
    ],
    ratings: async () => ({ count: 23, average: 4.6, bad: 1 }),
    about: async () => ({ text: "We're at 12 Allen Avenue, Ikeja, opposite the filling station.", hours: { mon: ["08:00", "18:00"], tue: ["08:00", "18:00"], wed: ["08:00", "18:00"], thu: ["08:00", "18:00"], fri: ["08:00", "18:00"], sat: ["10:00", "16:00"] } }),
    saveAbout: async () => {}, newSheetKey: async () => "b",
    banks: async () => [{ id: "44444444-4444-4444-4444-444444444444", bankName: "GTBank", bankCode: "058", accountNumber: "0123456789", accountName: "KAHNPRINTS LTD", isPrimary: true }],
    addBank: async () => {}, removeBank: async () => {}, setPrimaryBank: async () => {},
    alertNumbers: async () => [{ id: "55555555-5555-5555-5555-555555555555", waId: "2348077777777", name: "Shop manager" }],
    addAlertNumber: async () => {}, removeAlertNumber: async () => {},
    confirmedSince: async () => Array.from({ length: 48 }, (_, i) => new Date(now - ((i * 7919) % 13) * day - (i % 5) * 3_600_000)),
    topItems: async () => [
      { name: "Flyers: A5, both sides", quantity: 6500, totalKobo: 58_500_000 },
      { name: "Branded T-shirts: white, 1 colour", quantity: 70, totalKobo: 42_000_000 },
      { name: "Roll-up banner", quantity: 12, totalKobo: 30_000_000 },
      { name: "Business cards", quantity: 2400, totalKobo: 14_400_000 },
      { name: "Mugs: white", quantity: 48, totalKobo: 12_000_000 },
    ],
    chatCounts: async () => ({ customers: 138, inbound: 1240, outbound: 1610 }),
    exportRows: async () => [],
  },
  logo: async () => null, saveLogo: async () => {},
  markPaid: async () => true,
  botMessages: async () => ({ sent: 1610, limit: 3000 }),
  payLinks: { on: true, feeBasisPoints: async () => 250 },
};
const inboxChats = names.map((n, i) => ({
  contactId: `66666666-6666-6666-6666-${String(i).padStart(12, "0")}`, businessNumberId: "PNID", waId: "23480444444" + i, name: n,
  lastDirection: (i % 3 ? "outbound" : "inbound") as "inbound" | "outbound", lastType: "text",
  lastBody: ["How much for 500 flyers?", "Here's your quote KP-1042…", "Do you deliver to Lekki?", "Thank you! Your receipt is below.", "YES"][i % 5]!, lastAt: new Date(now - i * 47 * 60_000),
}));
const kyb = memoryVerifications();
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
await kyb.store.saveDetails(BIZ, { entityType: "company", registeredName: "KahnPrints Limited", rcNumber: "1261103", tin: null, address: "12 Allen Avenue, Ikeja, Lagos", directorName: "Ada Okafor", contactEmail: "hello@kahnprints.ng" });
await kyb.store.addDoc(BIZ, "certificate", { name: "cac-certificate.pdf", mimeType: "application/pdf", data: pdf });
await kyb.store.addDoc(BIZ, "id", { name: "ada-nin-slip.jpg", mimeType: "application/pdf", data: pdf });
const app = new Hono();
app.route("/compliance", createCompliance({ password: "preview-password", store: kyb.store, notifyOwner: async () => {} }));
app.route(
  "/app",
  createOwnerApp({
    secret: "preview",
    publicUrl: "http://localhost:4545",
    users,
    business: async (id) => (id === BIZ ? biz : null),
    support: { email: "support@yarnoga.com", waNumber: "2348000000000" },
    verification: { store: kyb.store, onSubmitted: async () => {} },
    health: async () => ({ ok: true, checkedAt: new Date().toISOString(), uptimeSeconds: 9000, version: null, checks: { database: { ok: true, ms: 120 }, whatsapp: { ok: true, ms: 310 }, ai: { ok: true, ms: 140 }, messages: { ok: true, ms: 90, note: "last one 3 minutes ago" } } }),
    healthLabels: { database: "Database (Supabase)", whatsapp: "WhatsApp Cloud API", ai: "AI replies (Anthropic)", messages: "Customer messages" },
    inbox: {
      store: {
        listChats: async () => inboxChats,
        contact: async (id) => ({ waId: "2348044444440", name: inboxChats.find((c) => c.contactId === id)?.name ?? "Ada" }),
        chatMessages: async () => [
          { direction: "inbound", type: "text", body: "Good evening, how much for 500 A5 flyers, both sides?", fromStaff: false, at: new Date(now - 50 * 60_000) },
          { direction: "outbound", type: "text", body: "Here's your quote KP-1042:\n500 x Flyers: A5, both sides\nTotal: ₦45,000\nReply YES to order.", fromStaff: false, at: new Date(now - 49 * 60_000) },
          { direction: "inbound", type: "text", body: "Can you deliver to Lekki tomorrow?", fromStaff: false, at: new Date(now - 30 * 60_000) },
          { direction: "outbound", type: "text", body: "Yes we can, delivery to Lekki is ₦4,000.", fromStaff: true, at: new Date(now - 20 * 60_000) },
        ],
      },
      messages: { botPause: async () => null, lastInboundAt: async () => new Date() } as never,
      whatsapp: {} as never,
    },
    log: { info() {}, warn() {}, error: console.error },
  }),
);
serve({ fetch: app.fetch, port: 4545 }, () => console.log("Preview on http://localhost:4545/app (log in: /app/l/owner)"));
