import type { Lang } from "../../../core/i18n.js";
import type { Notice } from "../../../core/product.js";
import type { Delivery, DeliveryStatus, DeliveryStore } from "./store.js";
import { showWaId } from "../../../core/whatsapp/ids.js";

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
  opts: { trackingLink: string; template?: TemplateName; lang?: Lang },
): Promise<{ delivery: Delivery; notices: Notice[] } | null> {
  const delivery = await store.update(d.id, FROM[step], { status: step });
  if (!delivery) return null;

  const fr = opts.lang === "fr";
  const rider = delivery.riderName ?? delivery.courier?.name ?? (fr ? "Le livreur" : "The rider");
  const customer = delivery.customerName ?? showWaId(delivery.customerWaId);
  const ref = delivery.orderRef;
  const business = delivery.businessName;
  const forCustomer = fr
    ? {
        picked_up: `${rider} a récupéré votre commande ${ref} et est en route. Suivez-la ici : ${opts.trackingLink}`,
        delivered: `Votre commande ${ref} a été livrée. Merci d'avoir choisi ${business} !`,
        failed: `${rider} n'a pas pu livrer ${ref}. ${business} va vous contacter pour convenir d'un autre moment.`,
      }[step]
    : {
        picked_up: `${rider} has picked up your order ${ref} and is on the way. Follow it here: ${opts.trackingLink}`,
        delivered: `Your order ${ref} has been delivered. Thank you for choosing ${business}!`,
        failed: `${rider} couldn't complete the delivery of ${ref}. ${business} will contact you to arrange another time.`,
      }[step];
  const forOwner = fr
    ? {
        picked_up: `${rider} a récupéré ${ref}.`,
        delivered: `✅ ${ref} livrée à ${customer} par ${rider}.`,
        failed: `${rider} n'a pas pu livrer ${ref} à ${customer} (+${delivery.customerWaId}). Envoyez *rider ${ref} <nom>* pour réessayer, ou *cancel delivery ${ref}*.`,
      }[step]
    : {
        picked_up: `${rider} picked up ${ref}.`,
        delivered: `✅ ${ref} delivered to ${customer} by ${rider}.`,
        failed: `${rider} couldn't deliver ${ref} to ${customer} (+${delivery.customerWaId}). Send *rider ${ref} <name>* to try again, or *cancel delivery ${ref}*.`,
      }[step];

  const notices = [deliveryNotice(delivery.customerWaId, forCustomer, delivery, opts.template)];
  if (delivery.ownerWaId) notices.push(deliveryNotice(delivery.ownerWaId, forOwner, delivery, opts.template));
  return { delivery, notices };
}
