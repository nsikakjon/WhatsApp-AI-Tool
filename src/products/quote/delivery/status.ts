import type { Notice } from "../../../core/product.js";
import type { Delivery, DeliveryStatus, DeliveryStore } from "./store.js";

// A rider's progress on a job. The same steps run whether the rider taps a
// button in WhatsApp or on the tracking page.

export type RiderStep = "picked_up" | "delivered" | "failed";

const FROM: Record<RiderStep, DeliveryStatus[]> = {
  picked_up: ["assigned"],
  delivered: ["assigned", "picked_up"],
  failed: ["assigned", "picked_up"],
};

export interface TemplateName {
  name: string;
  language: string;
}

/**
 * A message about a delivery. Someone who hasn't messaged in the last day
 * gets it through the approved order update template instead, when there is one.
 */
export function deliveryNotice(to: string, text: string, d: Delivery, template?: TemplateName): Notice {
  return template ? { to, text, template: { ...template, bodyParams: [d.orderRef, d.businessName, text] } } : { to, text };
}

/**
 * Moves the job on and returns who to tell. Null when it had already moved
 * on, so a second tap tells nobody anything twice.
 */
export async function riderStep(
  store: DeliveryStore,
  d: Delivery,
  step: RiderStep,
  opts: { trackingLink: string; template?: TemplateName },
): Promise<{ delivery: Delivery; notices: Notice[] } | null> {
  const delivery = await store.update(d.id, FROM[step], { status: step });
  if (!delivery) return null;

  const rider = delivery.riderName ?? "The rider";
  const customer = delivery.customerName ?? `+${delivery.customerWaId}`;
  const forCustomer = {
    picked_up: `${rider} has picked up your order ${delivery.orderRef} and is on the way. Follow it here: ${opts.trackingLink}`,
    delivered: `Your order ${delivery.orderRef} has been delivered. Thank you for choosing ${delivery.businessName}!`,
    failed: `${rider} couldn't complete the delivery of ${delivery.orderRef}. ${delivery.businessName} will contact you to arrange another time.`,
  }[step];
  const forOwner = {
    picked_up: `${rider} picked up ${delivery.orderRef}.`,
    delivered: `✅ ${delivery.orderRef} delivered to ${customer} by ${rider}.`,
    failed: `${rider} couldn't deliver ${delivery.orderRef} to ${customer} (+${delivery.customerWaId}). Send *rider ${delivery.orderRef} <name>* to try again, or *cancel delivery ${delivery.orderRef}*.`,
  }[step];

  const notices = [deliveryNotice(delivery.customerWaId, forCustomer, delivery, opts.template)];
  if (delivery.ownerWaId) notices.push(deliveryNotice(delivery.ownerWaId, forOwner, delivery, opts.template));
  return { delivery, notices };
}
