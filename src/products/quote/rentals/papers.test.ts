import { describe, expect, it } from "vitest";
import { agreementPdf, checklistPdf, createHirePaperLinks, hireChatLink, readHirePaperToken, stickersPdf } from "./papers.js";
import type { Booking } from "./store.js";

const BIZ = "11111111-1111-1111-1111-111111111111";
const ORDER = "22222222-2222-2222-2222-222222222222";
const PAPER = { name: "Demo Hire", details: "12 Admiralty Way, Lekki", orderPrefix: "DH", currency: "NGN" as const };
const BOOKING: Booking = {
  id: "b1",
  orderId: ORDER,
  orderNumber: 1012,
  orderStatus: "paid",
  variantId: "v1",
  name: "Generator: 20kVA",
  units: 2,
  start: "2026-11-27",
  back: "2026-11-30",
  dailyKobo: 25_000_00,
  weeklyKobo: 120_000_00,
  depositKobo: 50_000_00,
  status: "booked",
  heldUntil: null,
  outAt: null,
  contactId: "c1",
  customerWaId: "2348011111111",
  customerName: "Ada",
  startRemindedAt: null,
  returnRemindedAt: null,
  overdueRemindedAt: null,
};
const isPdf = (bytes: Uint8Array) => Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-";

describe("hire papers", () => {
  it("signs links so nobody can guess another business's papers", () => {
    const links = createHirePaperLinks("secret", "https://example.up.railway.app/", BIZ);
    const token = links.agreementLink(ORDER).split("/hire/")[1]!;
    expect(readHirePaperToken("secret", token)).toEqual({ businessId: BIZ, kind: "agreement", id: ORDER });
    expect(readHirePaperToken("other", token)).toBeNull();
    expect(readHirePaperToken("secret", token.replace("agreement", "checklist"))).toBeNull();
  });

  it("draws the agreement, the checklist and the stickers as PDFs", async () => {
    expect(isPdf(agreementPdf(PAPER, [BOOKING]))).toBe(true);
    expect(isPdf(checklistPdf(PAPER, [BOOKING]))).toBe(true);
    expect(isPdf(await stickersPdf(PAPER, "2347048971600", ["Generator: 20kVA", "Canopy: 20 x 20 ft"]))).toBe(true);
  });

  it("puts the booking request in the sticker's chat link", () => {
    expect(hireChatLink("2347048971600", "Generator: 20kVA")).toBe("https://wa.me/2347048971600?text=I'd%20like%20to%20hire%20the%20Generator%3A%2020kVA");
  });
});
