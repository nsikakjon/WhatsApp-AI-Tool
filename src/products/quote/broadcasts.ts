import { formatNaira } from "../../core/money.js";
import type { Product, ProductContext, Reply } from "../../core/product.js";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import type { Broadcast, BroadcastStore, BroadcastTally, PendingRecipient } from "./broadcast-store.js";

// Broadcasts: a business sends a promo or price update to customers who asked
// for them. A paid add-on, off unless BROADCASTS_ENABLED is true.
//
// Customers:
//   JOIN            -> opted in to this business's offers
//   STOP            -> opted out (only once they're opted in; before that,
//                      "stop" goes to the quote bot as usual)
//   UNSUBSCRIBE, STOP OFFERS, or the template's "Stop promotions" button
//                   -> always opted out
//
// The business owner (the number that gets order alerts):
//   broadcast <message>          -> saves a draft and shows a preview
//   (a photo with that caption)  -> the same, with the photo at the top
//   send broadcast 7             -> sends draft 7 to everyone opted in
//   cancel broadcast 7           -> stops it
//   broadcast                    -> how it works and this month's numbers
//
// Sending happens in the background a few messages a minute (sendDueBroadcasts),
// each person once, through an approved WhatsApp Marketing template.

export interface BroadcastOptions {
  /** The quote business this bot answers for. */
  businessId: string;
  businessName: string;
  /** WhatsApp number (digits only) allowed to send broadcasts. */
  ownerWaId?: string;
  store: BroadcastStore;
  /**
   * Messages a month this business may broadcast, or null if broadcasts
   * aren't part of its plan or add-ons.
   */
  monthlyLimit(businessId: string): Promise<number | null>;
  /** Whether an approved template with a picture header is set up. */
  pictures: boolean;
  /** Rough Meta charge per marketing message in kobo, for the preview. Optional. */
  costPerMessageKobo?: number;
  log?: Pick<Console, "error">;
}

const MAX_BODY = 900;

const JOIN = /^(join|subscribe|join offers|start offers)[.!]*$/i;
const STOP_ALWAYS = /^(unsubscribe|stop offers|stop promotions?|stop promos?)[.!]*$/i;
const STOP_IF_IN = /^stop[.!]*$/i;

/** Wraps a business's quote bot with opt-in, opt-out and owner broadcast commands. */
export function withBroadcasts(inner: Product, opts: BroadcastOptions): Product {
  const log = opts.log ?? console;

  return {
    name: inner.name,
    async handle(msg, ctx) {
      let reply: Reply | null = null;
      try {
        reply =
          opts.ownerWaId && msg.from === opts.ownerWaId
            ? await ownerCommand(msg)
            : await customerKeyword(msg, ctx);
      } catch (err) {
        // E.g. migration 0029 hasn't been run. The quote bot carries on as before.
        log.error("Broadcasts: could not handle message:", err);
      }
      return reply ?? inner.handle(msg, ctx);
    },
  };

  async function customerKeyword(msg: IncomingMessage, ctx: ProductContext): Promise<Reply | null> {
    const text = (msg.text ?? "").trim();
    if (!text) return null;
    const source = msg.type === "button" ? "button" : "keyword";

    if (JOIN.test(text)) {
      const before = await opts.store.optInStatus(opts.businessId, ctx.contactId);
      if (before !== "in") await opts.store.setOptIn(opts.businessId, ctx.contactId, "in", source, msg.waMessageId);
      return {
        text:
          before === "in"
            ? `You're already on the list for offers from ${opts.businessName}. Reply STOP any time to stop them.`
            : `You're in ✅ ${opts.businessName} will send you offers and price updates on WhatsApp now and then. Reply STOP any time to stop them.`,
      };
    }

    const always = STOP_ALWAYS.test(text);
    if (!always && !STOP_IF_IN.test(text)) return null;
    const before = await opts.store.optInStatus(opts.businessId, ctx.contactId);
    // A plain "stop" from someone who never joined is about their quote, not offers.
    if (!always && before !== "in") return null;
    if (before !== "out") await opts.store.setOptIn(opts.businessId, ctx.contactId, "out", source, msg.waMessageId);
    return {
      text: `Done, ${opts.businessName} won't send you any more offers. You can still message us for quotes any time. Reply JOIN if you'd like offers again.`,
    };
  }

  async function ownerCommand(msg: IncomingMessage): Promise<Reply | null> {
    const hasPicture = (msg.type === "image" || msg.type === "document") && !!msg.mediaId;
    const text = ((hasPicture ? msg.caption : msg.text) ?? "").trim();

    if (/^broadcasts?[.!?]*$/i.test(text) && !hasPicture) return { text: await help() };

    const send = text.match(/^send\s+broadcast\s*#?\s*(\d+)[.!]*$/i);
    if (send && !hasPicture) return sendDraft(Number(send[1]));

    const cancel = text.match(/^cancel\s+broadcast\s*#?\s*(\d+)[.!]*$/i);
    if (cancel && !hasPicture) return cancelBroadcast(Number(cancel[1]));

    const draft = text.match(/^broadcast\s*[:\-]?\s+([\s\S]+)$/i);
    if (draft) return makeDraft(draft[1]!.trim(), hasPicture ? msg.mediaId! : null, msg.businessNumberId ?? null);

    return null;
  }

  async function help(): Promise<string> {
    const room = await broadcastRoom(opts.store, opts.businessId, await opts.monthlyLimit(opts.businessId));
    if (!room) return notOnPlan();
    const optedIn = await opts.store.countOptedIn(opts.businessId);
    return [
      "Broadcasts send a message to every customer who opted in.",
      "",
      `• Opted in: ${optedIn} customer${optedIn === 1 ? "" : "s"}`,
      ...usage(room).map((line) => `• ${line}`),
      "",
      "Customers opt in by sending *JOIN* to this number (put it on your status, receipts or flyers). They can reply *STOP* any time.",
      "",
      "To send one, write *broadcast* followed by your message, e.g.",
      "_broadcast This week only: 10% off all A5 flyers!_",
      ...(opts.pictures ? ["To add a picture, send the photo with that as its caption."] : []),
      "You'll see a preview before anything is sent.",
    ].join("\n");
  }

  async function makeDraft(body: string, imageMediaId: string | null, fromNumberId: string | null): Promise<Reply> {
    const room = await broadcastRoom(opts.store, opts.businessId, await opts.monthlyLimit(opts.businessId));
    if (!room) return { text: notOnPlan() };
    if (imageMediaId && !opts.pictures) {
      return { text: "Broadcasts with a picture aren't set up yet. Send the message as text for now, or ask yarnOga support to switch pictures on." };
    }
    if (body.length > MAX_BODY) {
      return { text: `That message is ${body.length} characters. Please keep a broadcast under ${MAX_BODY} characters and send it again.` };
    }

    const optedIn = await opts.store.countOptedIn(opts.businessId);
    if (optedIn === 0) {
      return { text: "Nobody has opted in yet, so there's no one to send to. Ask customers to send *JOIN* to this number first." };
    }
    const left = room.left;
    if (left === 0) return { text: usedUp(room) };

    const draft = await opts.store.createDraft({
      businessId: opts.businessId,
      businessName: opts.businessName,
      fromNumberId,
      ownerWaId: opts.ownerWaId!,
      body,
      imageMediaId,
    });
    const reach = Math.min(optedIn, left);
    const cost =
      opts.costPerMessageKobo !== undefined
        ? `Meta charges about ${formatNaira(opts.costPerMessageKobo)} per message, so roughly ${formatNaira(opts.costPerMessageKobo * reach)} for this one.`
        : "Meta charges for every marketing message (see WhatsApp Manager for today's rate).";
    return {
      text: [
        `Broadcast ${draft.id} preview${imageMediaId ? " (with your picture at the top)" : ""}:`,
        "",
        `"${body}"`,
        "",
        reach < optedIn
          ? `${optedIn} customers opted in, but only ${reach} message${reach === 1 ? " is" : "s are"} left, so it will go to the first ${reach}.`
          : `It will go to ${reach} customer${reach === 1 ? "" : "s"} who opted in.`,
        ...usage(room).map((line) => `${line}.`),
        cost,
        "",
        `Reply *send broadcast ${draft.id}* to send it, or *cancel broadcast ${draft.id}*.`,
      ].join("\n"),
    };
  }

  async function sendDraft(id: number): Promise<Reply> {
    const broadcast = await opts.store.get(id);
    if (!broadcast || broadcast.businessId !== opts.businessId) {
      return { text: `I can't find broadcast ${id}. Write *broadcast* followed by your message to start a new one.` };
    }
    if (broadcast.status === "queued") return { text: `Broadcast ${id} is already on its way to ${broadcast.recipientCount} customers.` };
    if (broadcast.status === "done") return { text: `Broadcast ${id} has already been sent.` };
    if (broadcast.status === "cancelled") return { text: `Broadcast ${id} was cancelled. Write *broadcast* followed by your message to start a new one.` };

    const room = await broadcastRoom(opts.store, opts.businessId, await opts.monthlyLimit(opts.businessId));
    if (!room) return { text: notOnPlan() };
    const result = await opts.store.queue(id, room.limit);
    if (result.outcome === "limit_reached") return { text: `Broadcast ${id} wasn't sent. ${usedUp(room)}` };
    if (result.outcome === "not_draft") return { text: `Broadcast ${id} has already been sent or cancelled.` };
    if (result.recipients === 0) return { text: `Nobody is opted in any more, so broadcast ${id} went to no one.` };
    return {
      text: `✅ Broadcast ${id} is on its way to ${result.recipients} customer${result.recipients === 1 ? "" : "s"}. It goes out a few messages a minute; I'll tell you when it's done. Send *cancel broadcast ${id}* to stop the rest.`,
    };
  }

  async function cancelBroadcast(id: number): Promise<Reply> {
    const broadcast = await opts.store.get(id);
    if (!broadcast || broadcast.businessId !== opts.businessId) return { text: `I can't find broadcast ${id}.` };
    if (!(await opts.store.cancel(id))) return { text: `Broadcast ${id} has already finished or been cancelled.` };
    return {
      text:
        broadcast.status === "queued"
          ? `Stopped. Nobody else will get broadcast ${id} (anyone it already reached keeps their copy).`
          : `Broadcast ${id} cancelled. Nothing was sent.`,
    };
  }

  function notOnPlan(): string {
    return opts.pictures
      ? "Broadcasts (sending offers to customers who opted in) aren't on your plan yet. Buy a message pack on the Flyers page of your app to start, or ask yarnOga support."
      : NOT_ON_PLAN;
  }

  function usedUp(room: BroadcastRoom): string {
    // Message packs are sold under a flyer in the owner app, which is there when pictures are set up.
    const buy = opts.pictures ? " To send more now, buy a message pack on the Flyers page of your app." : "";
    return room.limit > 0
      ? `You've used all ${room.limit} broadcast messages for this month. Your limit resets on the 1st.${buy}`
      : `Your message pack is used up.${buy}`;
  }
}

/** What a business can still broadcast: the month's messages, then its pack. */
export interface BroadcastRoom {
  /** The plan or add-on's messages a month (0 for a shop with packs only). */
  limit: number;
  used: number;
  /** Pack messages left. */
  pack: number;
  left: number;
}

/** Null when broadcasts aren't on the business's plan and it has no pack. */
export async function broadcastRoom(store: BroadcastStore, businessId: string, monthlyLimit: number | null): Promise<BroadcastRoom | null> {
  const pack = await store.packBalance(businessId);
  if (monthlyLimit === null && pack === 0) return null;
  const limit = monthlyLimit ?? 0;
  const used = limit > 0 ? Math.min(await store.usedThisMonth(businessId), limit) : 0;
  return { limit, used, pack, left: limit - used + pack };
}

function usage(room: BroadcastRoom): string[] {
  return [
    ...(room.limit > 0 ? [`This month: ${room.used} of ${room.limit} messages used`] : []),
    ...(room.pack > 0 ? [`Message pack: ${room.pack} left`] : []),
  ];
}

/** Sending a picture made in the owner app (a business flyer) to everyone who opted in, without the chat commands. */
export interface PictureBroadcasts {
  /** How many opted in, the messages left (this month's and the pack's) and the messages the plan gives a month (0: none). */
  reach(): Promise<{ optedIn: number; left: number; monthly: number }>;
  /** Queues the picture and message straight away. `recipients` is how many it goes to. */
  send(body: string, imageMediaId: string, ownerWaId: string): Promise<{ outcome: "queued"; id: number; recipients: number } | { outcome: "not_on_plan" | "nobody" | "limit_reached" }>;
}

export function createPictureBroadcasts(opts: { businessId: string; businessName: string; fromNumberId: string | null; store: BroadcastStore }): PictureBroadcasts {
  const room = async () => broadcastRoom(opts.store, opts.businessId, await opts.store.monthlyLimit(opts.businessId));
  return {
    async reach() {
      const [now, optedIn] = await Promise.all([room(), opts.store.countOptedIn(opts.businessId)]);
      return { optedIn, left: now?.left ?? 0, monthly: now?.limit ?? 0 };
    },
    async send(body, imageMediaId, ownerWaId) {
      const now = await room();
      if (!now) return { outcome: "not_on_plan" };
      if ((await opts.store.countOptedIn(opts.businessId)) === 0) return { outcome: "nobody" };
      if (now.left === 0) return { outcome: "limit_reached" };
      const draft = await opts.store.createDraft({ businessId: opts.businessId, businessName: opts.businessName, fromNumberId: opts.fromNumberId, ownerWaId, body: body.slice(0, MAX_BODY), imageMediaId });
      const result = await opts.store.queue(draft.id, now.limit);
      if (result.outcome === "limit_reached") return { outcome: "limit_reached" };
      if (result.outcome !== "queued" || result.recipients === 0) return { outcome: "nobody" };
      return { outcome: "queued", id: draft.id, recipients: result.recipients };
    },
  };
}

const NOT_ON_PLAN =
  "Broadcasts (sending offers to customers who opted in) are a paid add-on that isn't on your plan yet. Ask yarnOga support to switch it on.";

export interface SendBroadcastsOptions {
  store: BroadcastStore;
  /** Sends one broadcast to one person through the approved template. Returns WhatsApp's message id. */
  send(to: string, broadcast: Broadcast): Promise<string>;
  /** Tells the owner a broadcast has finished. Errors are logged. */
  notifyOwner(broadcast: Broadcast, tally: BroadcastTally): Promise<void>;
  /** The most messages to send in one run (one run a minute keeps the rate). */
  perRun: number;
  log?: Pick<Console, "error" | "info">;
}

/**
 * Sends the next few messages of any confirmed broadcasts. Each person is
 * marked before the message goes, so a crash or an overlapping run never
 * sends anyone the same broadcast twice. People who opted out after the
 * broadcast was confirmed are skipped.
 */
export async function sendDueBroadcasts(opts: SendBroadcastsOptions): Promise<void> {
  const log = opts.log ?? console;
  const due = await opts.store.duePending(opts.perRun);
  const broadcasts = new Map<number, Broadcast | null>();
  const touched = new Set<number>();

  for (const r of due) {
    if (!(await opts.store.claim(r))) continue;
    touched.add(r.broadcastId);
    if (!broadcasts.has(r.broadcastId)) broadcasts.set(r.broadcastId, await opts.store.get(r.broadcastId));
    const broadcast = broadcasts.get(r.broadcastId)!;
    await sendOne(r, broadcast);
  }

  for (const id of touched) {
    try {
      const tally = await opts.store.finishIfComplete(id);
      const broadcast = broadcasts.get(id);
      if (tally && broadcast) await opts.notifyOwner(broadcast, tally);
    } catch (err) {
      log.error(`Broadcast ${id}: could not finish up:`, err);
    }
  }

  async function sendOne(r: PendingRecipient, broadcast: Broadcast | null) {
    if (!broadcast || broadcast.status !== "queued") {
      await opts.store.finishRecipient(r, { status: "skipped" });
      return;
    }
    if ((await opts.store.optInStatus(broadcast.businessId, r.contactId)) !== "in") {
      await opts.store.finishRecipient(r, { status: "skipped" });
      return;
    }
    try {
      const waMessageId = await opts.send(r.waId, broadcast);
      await opts.store.finishRecipient(r, { status: "sent", waMessageId });
    } catch (err) {
      log.error(`Broadcast ${broadcast.id} to ...${r.waId.slice(-4)} failed:`, err);
      await opts.store.finishRecipient(r, { status: "failed", error: err instanceof Error ? err.message : String(err) });
    }
  }
}

/** The owner's "it's done" message. */
export function finishedText(broadcast: Broadcast, tally: BroadcastTally): string {
  const parts = [`✅ Broadcast ${broadcast.id} is done: sent to ${tally.sent} customer${tally.sent === 1 ? "" : "s"}.`];
  if (tally.failed) parts.push(`${tally.failed} couldn't be delivered (WhatsApp sometimes holds back marketing messages, e.g. to people who get many).`);
  if (tally.skipped) parts.push(`${tally.skipped} opted out or were stopped before it reached them.`);
  return parts.join(" ");
}
