import type { Notice } from "../../core/product.js";
import { localNumber } from "./emails.js";
import type { NumberQueueStore } from "./numbers.js";
import { liveMessage } from "./numbers-page.js";
import { NumberTakenError, type BusinessStore, type SetupStore } from "./store.js";

// A business that signed up by chat connects its number with Facebook, from
// the link the sign-up chat sends it (/signup?b=...). The number is put on the
// business and the bot switched on straight away: the price list is already
// in, and Meta has checked that the owner controls the number.

export interface ConnectedNumber {
  phoneNumberId: string;
  /** As Meta shows it, e.g. "+234 803 123 4567". */
  displayNumber?: string;
  /** The number stays in the WhatsApp Business app on the owner's phone. */
  coexistence: boolean;
}

export interface ConnectDeps {
  businesses: Pick<BusinessStore, "get">;
  setup: Pick<SetupStore, "updateBusiness">;
  /** The number queue, so a business that connected this way leaves it. */
  queue?: NumberQueueStore;
  log?: Pick<Console, "error">;
}

export type ConnectResult =
  | { kind: "live"; notify: Notice[] }
  /** Another business already answers on this number. */
  | { kind: "taken" }
  | { kind: "no_business" };

export async function connectSignedUpBusiness(
  deps: ConnectDeps,
  businessId: string,
  c: ConnectedNumber,
  /** Gets a WhatsApp message about it (the yarnOga team). */
  alertWaId?: string,
): Promise<ConnectResult> {
  const log = deps.log ?? console;
  const business = await deps.businesses.get(businessId);
  if (!business) return { kind: "no_business" };
  const { id: _, updatedAt: __, ...settings } = business;
  try {
    await deps.setup.updateBusiness(business.id, { ...settings, phoneNumberId: c.phoneNumberId, active: true });
  } catch (err) {
    if (err instanceof NumberTakenError) return { kind: "taken" };
    throw err;
  }

  const number = c.displayNumber?.replace(/\D/g, "") || null;
  if (deps.queue && number) {
    try {
      await deps.queue.setNumber(businessId, number, null);
      await deps.queue.update(businessId, { status: "live", phoneNumberId: c.phoneNumberId, liveAt: new Date(), note: "Connected with Facebook" });
    } catch (err) {
      log.error("Couldn't mark the number as live on the queue:", err);
    }
  }

  // With coexistence the owner can connect the very number they signed up
  // from. WhatsApp can't send a number a message from itself, so order alerts
  // can't reach them there: the team sorts out another number for alerts.
  const sameNumber = Boolean(number && number === business.ownerWaId);
  const notify: Notice[] = [];
  if (business.ownerWaId) {
    notify.push({
      to: business.ownerWaId,
      text: number
        ? sameNumber
          ? `Good news: *${business.name}* is live on WhatsApp at *${localNumber(number)}*. Customers who message that number now get your bot, and you'll see its replies in your WhatsApp Business app.\n\n` +
            "Order alerts can't come to the same number the bot answers on, so the yarnOga team will message you to set up another number for them."
          : liveMessage(business.name, number)
        : `Good news: *${business.name}* is connected and live on WhatsApp. Customers who message your number now get your bot.`,
    });
  }
  if (alertWaId) {
    notify.push({
      to: alertWaId,
      text:
        `${business.name} connected ${number ? localNumber(number) : `Phone number ID ${c.phoneNumberId}`} with Facebook${c.coexistence ? " (stays in the WhatsApp Business app)" : ""} and is now live.` +
        (sameNumber ? " It's the number they signed up from, so order alerts can't reach them: get another number for alerts and put it on /quote-setup." : ""),
    });
  }
  return { kind: "live", notify };
}
