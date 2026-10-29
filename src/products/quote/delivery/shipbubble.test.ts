import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { courierStep, createShipbubble, isValidShipbubbleSignature, nairaToKoboAmount, pickupDate } from "./shipbubble.js";

const ok = (data: unknown) => Response.json({ status: "success", message: "ok", data });
const config = { apiKey: "sb_sandbox_key", contactEmail: "orders@yarnoga.com", itemKg: 0.5 };
const shop = { name: "KahnPrints", phone: "2348000000001", address: "12 Allen Avenue, Ikeja, Lagos" };
const customer = { name: "Ada", phone: "2348012345678", address: "5 Admiralty Way, Lekki", lat: 6.44, lng: 3.47 };

function fakeShipbubble(couriers: Array<Record<string, unknown>>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/shipping/address/validate")) {
      const body = JSON.parse(init!.body as string);
      return ok({ address_code: body.phone === "+2348000000001" ? 111 : 222 });
    }
    if (url.endsWith("/shipping/labels/categories")) return ok([{ category_id: 98246239, category: "Fashion wears" }]);
    if (url.endsWith("/shipping/fetch_rates")) return ok({ request_token: "tok", couriers });
    if (url.endsWith("/shipping/labels")) return ok({ order_id: "SB-9", tracking_url: "https://track/SB-9", courier: { name: "Kwik", phone: "0800" } });
    return new Response("{}", { status: 404 });
  });
}

describe("Shipbubble", () => {
  it("offers the cheapest courier that collects from the shop, in kobo", async () => {
    const fetch = fakeShipbubble([
      { courier_id: "dhl", courier_name: "DHL", service_code: "dhl", service_type: "dropoff", rate_card_amount: 900, total: 900 },
      { courier_id: "gig", courier_name: "GIG", service_code: "gig", service_type: "pickup", rate_card_amount: 4200.5, total: 4200.5, delivery_eta: "Within 1 - 2 working days" },
      { courier_id: "kwik", courier_name: "Kwik", service_code: "kwik", service_type: "pickup", rate_card_amount: 3063, total: 3063, pickup_eta: "Within 3 hours", delivery_eta: "Within 9 hrs" },
    ]);
    const sb = createShipbubble(config, { fetch: fetch as unknown as typeof globalThis.fetch, now: () => new Date("2026-10-26T10:00:00Z") });
    const quote = await sb.quote(shop, customer, [{ name: "Flyers: A5", quantity: 100, unitKobo: 15_000 }]);
    expect(quote).toEqual({ feeKobo: 306_300, courierName: "Kwik", courierId: "kwik", serviceCode: "kwik", requestToken: "tok", pickupEta: "Within 3 hours", deliveryEta: "Within 9 hrs" });

    const rates = JSON.parse((fetch.mock.calls.find(([u]) => String(u).endsWith("fetch_rates")) as unknown as [string, RequestInit])[1].body as string);
    expect(rates).toMatchObject({ sender_address_code: 111, reciever_address_code: 222, pickup_date: "2026-10-26", category_id: 98246239, service_type: "pickup" });
    expect(rates.package_items[0]).toEqual({ name: "Flyers: A5", description: "Flyers: A5", unit_weight: "0.5", unit_amount: "150", quantity: "100" });
    const validate = JSON.parse((fetch.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(validate).toMatchObject({ email: "orders@yarnoga.com" });
    const auth = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>;
    expect(auth.Authorization).toBe("Bearer sb_sandbox_key");

    // Addresses are checked once and remembered.
    await sb.quote(shop, customer, [{ name: "Flyers: A5", quantity: 100, unitKobo: 15_000 }]);
    expect(fetch.mock.calls.filter(([u]) => String(u).endsWith("validate"))).toHaveLength(2);
  });

  it("has no offer when no courier collects, and books by token", async () => {
    const none = createShipbubble(config, { fetch: fakeShipbubble([{ courier_id: "dhl", service_type: "dropoff", rate_card_amount: 900 }]) as unknown as typeof globalThis.fetch });
    expect(await none.quote(shop, customer, [])).toBeNull();
    const booking = await none.book({ requestToken: "tok", courierId: "kwik", serviceCode: "kwik" });
    expect(booking).toEqual({ orderId: "SB-9", trackingUrl: "https://track/SB-9", courierName: "Kwik", courierPhone: "0800" });
  });

  it("explains Shipbubble's errors", async () => {
    const fetch = vi.fn(async () => Response.json({ status: "failed", message: "Insufficient wallet balance" }, { status: 400 }));
    const sb = createShipbubble(config, { fetch: fetch as unknown as typeof globalThis.fetch });
    await expect(sb.book({ requestToken: "t", courierId: "k", serviceCode: "k" })).rejects.toThrow("Insufficient wallet balance");
  });

  it("checks webhook signatures and reads statuses, amounts and pickup days", () => {
    const body = JSON.stringify({ order_id: "SB-1", status: "completed" });
    const sig = createHmac("sha512", "sb_sandbox_key").update(body).digest("hex");
    expect(isValidShipbubbleSignature(body, sig, "sb_sandbox_key")).toBe(true);
    expect(isValidShipbubbleSignature(body, sig, "other")).toBe(false);
    expect(isValidShipbubbleSignature(body, undefined, "sb_sandbox_key")).toBe(false);
    expect(courierStep("in_transit")).toBe("picked_up");
    expect(courierStep("completed")).toBe("delivered");
    expect(courierStep("cancelled")).toBe("failed");
    expect(courierStep("confirmed")).toBeNull();
    expect(nairaToKoboAmount(12451.04)).toBe(1_245_104);
    expect(nairaToKoboAmount(0)).toBeNull();
    // After 6pm Lagos time, Shipbubble moves requests to the next day.
    expect(pickupDate(new Date("2026-10-26T16:59:00Z"))).toBe("2026-10-26");
    expect(pickupDate(new Date("2026-10-26T17:00:00Z"))).toBe("2026-10-27");
  });
});
