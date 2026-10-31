import type { Lang } from "../../core/i18n.js";
import type { Currency } from "../../core/money.js";

// Every fixed message the quote bot sends, in English and French, and the
// customer messages in Nigerian Pidgin too. Messages to a customer follow the
// customer's language (see index.ts); messages to the owner use the
// business's language. Amounts arrive already written out (formatMoney), so
// nothing here works out a price.
//
// To change a wording, change it in English and French (TypeScript refuses a
// language that is missing a message), and in Pidgin if a customer sees it.
// A message missing from Pidgin goes out in English.

export interface QuoteTexts {
  // Customers
  voiceNotOnLine(): string;
  voiceUnclear(): string;
  sendRequest(): string;
  stopReminders(): string;
  ratingAsk(business: string, ref: string): string;
  orderAgainButton: string;
  lastTime(items: string): string;
  noLastOrder: string;
  someGone(items: string): string;
  ratingButtons: { great: string; ok: string; bad: string };
  ratingThanks(stars: number, business: string): string;
  ratingAlready: string;
  ownerLowRating(ref: string, who: string, phone: string): string;
  lowStock(items: Array<{ name: string; left: number }>): string;
  noPriceList(business: string): string;
  didntCatch(): string;
  teamNotified(business: string): string;
  /** Added when the business is closed: `when` is like "tomorrow at 08:00". */
  closedNow(when: string | null): string;
  closed(business: string): string;
  minimum(item: string, min: number): string;
  teamWillPrice(items: string): string;
  thanks(note: string): string;
  quoteHeader(ref: string): string;
  quoteTotal(total: string): string;
  replyYes(): string;
  noQuoteWaiting(): string;
  overLimitCustomer(business: string, ref: string, total: string): string;
  payLine(url: string, currency: Currency): string;
  /** Reminder 1 or 2 for a confirmed order that hasn't been paid; `how` is the pay link line or the bank details. */
  payReminder(n: 1 | 2, business: string, ref: string, total: string, how: string | null): string;
  nextWalkInLink(): string;
  nextWalkInCounter(ref: string): string;
  nextDeliveryLink(): string;
  nextReady(business: string): string;
  nextContactDelivery(business: string): string;
  confirmedInvoice(ref: string, total: string, next: string): string;
  confirmedTotal(ref: string, total: string, next: string): string;
  confirmedContact(ref: string, total: string, business: string, withDelivery: boolean): string;
  invoice(): string;
  receipt(): string;
  paymentThanks(ref: string, total: string, business: string): string;
  pickupAtTable(table: string): string;
  pickupWhenReady(): string;
  pickupShowQr(): string;
  pickupShowCode(code: string): string;
  hereIsReceipt(): string;
  noProblem(): string;
  cancelledQuote(ref: string): string;
  defaultHelp(names: string): string;
  poweredBy(): string;
  // Owner
  aCustomer(): string;
  talkRequest(who: string, number: string): string;
  manualQuote(who: string, number: string): string;
  wantsToOrder(who: string, number: string, ref: string): string;
  total(total: string): string;
  overLimitOwner(limit: number, plan: string, ref: string): string;
  newOrder(walkIn: boolean, ref: string, who: string, number: string, table: string | null): string;
  walkInScreensNote(online: boolean, ref: string): string;
  payLinkSentNote(ref: string): string;
  replyPaidNote(ref: string): string;
  paidTwice(who: string, ref: string, total: string, cancelled: boolean): string;
  paidCounter(ref: string, total: string, who: string): string;
  paidApp(ref: string, total: string, who: string): string;
  paidOnline(ref: string, total: string, who: string, fee: string | null, provider: string): string;
  onPickupScreens(stations: string[]): string;
  ownerHint(): string;
  logoHint(catalogue: boolean): string;
  logoCantSave(): string;
  logoFormat(): string;
  logoSaved(): string;
  cantFind(ref: string): string;
  noDocuments(): string;
  invoiceFor(ref: string, total: string): string;
  notPaidYet(ref: string): string;
  receiptFor(ref: string): string;
  cancelledCantPay(ref: string): string;
  alreadyPaid(ref: string, date: string | null): string;
  justUpdated(ref: string): string;
  markedPaidSent(ref: string, total: string, who: string): string;
  markedPaidTold(ref: string, total: string, who: string, couldntDraw: boolean): string;
  proofPassedOn(ref: string, business: string): string;
  proofCheck(who: string, ref: string, total: string, file: boolean, caption: string | undefined): string;
  proofButtons: { confirm: string; notReceived: string };
  /** QUOTE_LIMIT_ALERTS: the bot stays out of an over-limit customer's chat for this many hours. */
  handedOver(hours: number): string;
  limitButtons: { upgrade(plan: string): string; topUp: string; plans: string };
  checkInOk(): string;
  checkInCall(): string;
  notReceivedTold(ref: string, who: string): string;
  paidSoNotTold(ref: string): string;
  notReceived(ref: string, business: string): string;
  drawFailed(): string;
  boardNotOnPlan(): string;
  boardLink(link: string): string;
  ownerHelp(prefix: string): string;
}

const en: QuoteTexts = {
  voiceNotOnLine: () => "Sorry, I can't take voice notes on this line. Please type what you need (for example: 100 A5 flyers).",
  voiceUnclear: () => "Sorry, I couldn't make out that voice note. Could you type what you need (for example: 100 A5 flyers)?",
  sendRequest: () => "Please send your request as a message or voice note (for example: 100 A5 flyers).",
  stopReminders: () => "Okay, I won't send you any more quote reminders. Message me any time you need a quote.",
  ratingAsk: (b, ref) => `How did we do with your order ${ref}? Your answer helps ${b} serve you better.`,
  orderAgainButton: "🔁 Order again",
  lastTime: (items) => `Last time you ordered: ${items}. Tap *Order again* for a fresh quote for the same.`,
  noLastOrder: "I can't find an earlier order for you. Tell me what you need and I'll send you a quote.",
  someGone: (items) => `Some of your last order isn't on the price list any more (${items}), so I've left it out.`,
  ratingButtons: { great: "😀 Great", ok: "🙂 OK", bad: "🙁 Not good" },
  ratingThanks: (stars, b) =>
    stars >= 5
      ? `Thank you! 🙏 We're glad you're happy. If you know someone who'd like ${b}, please share our number with them.`
      : stars >= 3
        ? "Thanks for telling us. If there's anything we could do better, just reply here."
        : `We're sorry it wasn't right. I've told the ${b} team and someone will contact you to put it right.`,
  ratingAlready: "Thanks, we already have your answer for that order. 🙏",
  ownerLowRating: (ref, who, phone) => `🙁 ${who} (${phone}) said order ${ref} was *not good*. Please contact them to put it right.`,
  lowStock: (items) =>
    [
      "📦 Running low after this order:",
      ...items.map((i) => `• ${i.name}: ${i.left === 0 ? "*sold out*" : `${i.left} left`}`),
      "Send *stock* to see everything, or update it in your app's price list.",
    ].join("\n"),
  noPriceList: (b) => `Thanks for messaging ${b}! Our price list isn't online yet, so someone from the team will get back to you.`,
  didntCatch: () => "Sorry, I didn't catch that. Could you tell me what you'd like and how many?",
  teamNotified: (b) => `I've let the ${b} team know. Someone will reply to you here shortly.`,
  closedNow: (when) => `🕗 We're closed right now${when ? ` and open again ${when}` : ""}. You can still order here; the team will take it from there when we open.`,
  closed: (b) => `Sorry, ${b} isn't taking new orders right now. Please ask a member of staff.`,
  minimum: (item, min) => `${item}: the minimum order is ${min}.`,
  teamWillPrice: (items) => `The team will send you a price for: ${items}.`,
  thanks: (note) => `Thanks! ${note}`,
  quoteHeader: (ref) => `Here's your quote (${ref}):`,
  quoteTotal: (total) => `*Total: ${total}*`,
  replyYes: () => "Reply YES to place this order, or tell me what to change.",
  noQuoteWaiting: () => "There's no quote waiting for confirmation. Tell me what you'd like and I'll send you one.",
  overLimitCustomer: (b, ref, total) => `Thank you! The ${b} team will contact you shortly to complete order ${ref} (total ${total}).`,
  payLine: (url, currency) =>
    currency === "NGN" ? `Pay online by card, bank transfer or USSD: ${url}` : `Pay online by Mobile Money (MTN MoMo, Orange Money) or card: ${url}`,
  payReminder: (n, b, ref, total, how) =>
    [
      n === 1
        ? `Hi! A quick reminder from ${b}: your order ${ref} (${total}) is waiting for payment.`
        : `Hi again from ${b}: we're still holding your order ${ref} (${total}) for you.`,
      how ?? "",
      n === 1 ? "Already paid? Thank you, please ignore this." : "This is our last reminder. If you've changed your mind, just reply and let us know.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  nextWalkInLink: () => "Pay with the link, then show the QR code on your receipt when you collect.",
  nextWalkInCounter: (ref) => `Please pay at the counter and give them your order number, ${ref}.`,
  nextDeliveryLink: () => "We'll send you a link to follow your delivery once a rider is on the way.",
  nextReady: (b) => `The ${b} team will let you know when it's ready.`,
  nextContactDelivery: (b) => `The ${b} team will contact you shortly about delivery.`,
  confirmedInvoice: (ref, total, next) => `Thank you! Order ${ref} is confirmed. Here's your invoice for ${total}. ${next}`,
  confirmedTotal: (ref, total, next) => `Thank you! Order ${ref} is confirmed (total ${total}). ${next}`,
  confirmedContact: (ref, total, b, withDelivery) =>
    `Thank you! Order ${ref} is confirmed (total ${total}). The ${b} team will contact you shortly about payment${withDelivery ? " and delivery" : ""}.`,
  invoice: () => "Invoice",
  receipt: () => "Receipt",
  paymentThanks: (ref, total, b) => `Payment received for order ${ref} (${total}). Thank you for choosing ${b}!`,
  pickupAtTable: (table) => `We'll bring it to ${table}.`,
  pickupWhenReady: () => "We'll message you when it's ready to collect.",
  pickupShowQr: () => "Show the QR code on this receipt when you collect.",
  pickupShowCode: (code) => `Show this message when you collect. Your code is ${code}.`,
  hereIsReceipt: () => "Here's your receipt:",
  noProblem: () => "No problem. Let me know if you need anything else.",
  cancelledQuote: (ref) => `No problem, I've cancelled quote ${ref}. Message me any time you need a new one.`,
  defaultHelp: (names) => `I can give you a quote for: ${names}. Tell me what you need and how many.`,
  poweredBy: () => "_Powered by yarnOga · yarnoga.com_",
  aCustomer: () => "A customer",
  talkRequest: (who, number) => `${who} (${number}) would like to talk to someone. Please reply to them on WhatsApp.`,
  manualQuote: (who, number) => `Quote request from ${who} (${number}), please reply to them with a price:`,
  wantsToOrder: (who, number, ref) => `${who} (${number}) wants to order ${ref}:`,
  total: (total) => `Total: ${total}`,
  overLimitOwner: (limit, plan, ref) =>
    `You've used all ${limit} orders on your ${plan} plan this month, so I haven't confirmed it or sent an invoice. Please reply to them yourself. Send *paid ${ref}* once they've paid, or *plan* to see how to upgrade.`,
  newOrder: (walkIn, ref, who, number, table) => `New ${walkIn ? "walk-in " : ""}order ${ref} from ${who} (${number})${table ? ` at ${table}` : ""}:`,
  walkInScreensNote: (online, ref) =>
    `It goes to your pickup screens once it's paid${online ? " online" : `. If they pay at the counter, tap *Paid at counter* on the screen or reply *paid ${ref}*`}.`,
  payLinkSentNote: (ref) => `They've been sent a link to pay online. I'll tell you when it's paid and send them a receipt. If they pay you another way, reply *paid ${ref}*.`,
  replyPaidNote: (ref) => `When they've paid, reply *paid ${ref}* and I'll send them a receipt.`,
  paidTwice: (who, ref, total, cancelled) =>
    `⚠️ ${who} paid ${ref} online (${total}), but it was already ${cancelled ? "cancelled" : "marked paid"}. If they've paid twice, message yarnOga support to refund the online payment.`,
  paidCounter: (ref, total, who) => `💰 ${ref} was paid at the counter (${total}). I've sent ${who} their receipt.`,
  paidApp: (ref, total, who) => `💰 ${ref} was marked paid in the app (${total}). I've sent ${who} their receipt.`,
  paidOnline: (ref, total, who, fee, provider) =>
    `💰 ${ref} paid online (${total}) by ${who}. I've sent them their receipt, and ${provider} pays the money into your account` +
    (fee ? `, less the yarnOga fee (${fee}) and ${provider}'s fee.` : "."),
  onPickupScreens: (stations) => `It's on your pickup ${stations.length > 1 ? "screens" : "screen"}: ${stations.join(", ")}.`,
  ownerHint: () => "You're the owner: send *menu* for your commands.",
  logoHint: (catalogue) =>
    "To use this picture as the logo on your invoices and receipts, send it again with the caption *logo*." +
    (catalogue ? " For a product photo, use the caption *photo* and the product's name, e.g. *photo T-shirts*." : ""),
  logoCantSave: () => "Logos can't be saved yet on this setup. Please let yarnOga support know.",
  logoFormat: () => "Please send the logo as a picture (PNG or JPEG). A PNG sent as a document keeps a see-through background.",
  logoSaved: () => "Logo saved ✅ It'll be on every invoice and receipt from now on.",
  cantFind: (ref) => `I can't find order ${ref}. Please check the number.`,
  noDocuments: () => "Invoice and receipt pictures aren't on your plan. Send *plan* to see your options.",
  invoiceFor: (ref, total) => `Invoice for ${ref} (${total}):`,
  notPaidYet: (ref) => `${ref} isn't marked paid yet. Send *paid ${ref}* once the customer has paid.`,
  receiptFor: (ref) => `Receipt for ${ref}:`,
  cancelledCantPay: (ref) => `${ref} was cancelled, so I can't mark it paid.`,
  alreadyPaid: (ref, date) => `${ref} was already marked paid${date ? ` on ${date}` : ""}. Here's the receipt again:`,
  justUpdated: (ref) => `${ref} has just been updated by another message. Send *receipt ${ref}* to see where it stands.`,
  markedPaidSent: (ref, total, who) =>
    `✅ ${ref} marked paid (${total}). I've sent ${who} this receipt. If they haven't messaged in the last 24 hours WhatsApp may hold it back, so you can forward this copy.`,
  markedPaidTold: (ref, total, who, couldntDraw) => `✅ ${ref} marked paid (${total}). I've told ${who}${couldntDraw ? ", but couldn't draw the receipt" : ""}.`,
  proofPassedOn: (ref, b) => `Thank you! I've passed this to ${b} to check against order ${ref}. Your receipt comes here as soon as they confirm the money has arrived.`,
  proofCheck: (who, ref, total, file, caption) =>
    `${who} sent ${file ? "a file (open it in your chats inbox)" : "this"} as payment for ${ref} (${total}).${caption ? `\n\nTheir note: "${caption}"` : ""}\n\nCheck your bank app that the money has arrived before you confirm. Fake transfer screenshots are common.`,
  proofButtons: { confirm: "✅ Confirm paid", notReceived: "Not received" },
  handedOver: (hours) => `I've handed this chat to you, so the bot won't answer them for the next ${hours} hours.`,
  limitButtons: { upgrade: (plan) => `Upgrade to ${plan}`, topUp: "Top up AI replies", plans: "See plans" },
  checkInOk: () => "Glad to hear it, thank you!",
  checkInCall: () => "Thank you. Someone from yarnOga will call you soon.",
  notReceivedTold: (ref, who) => `OK. I've told ${who} the payment for ${ref} hasn't arrived yet.`,
  paidSoNotTold: (ref) => `${ref} is already marked paid, so I haven't sent the customer anything.`,
  notReceived: (ref, b) =>
    `${b} hasn't received the payment for order ${ref} yet. Transfers sometimes take a few minutes. If the money has left your account, please send the transfer receipt again or reply here to talk to them.`,
  drawFailed: () => "Sorry, I couldn't draw that just now. Please try again in a minute.",
  boardNotOnPlan: () => "The order board and sales dashboard come with Pro and above. Send *plan* to see how to upgrade.",
  boardLink: (link) => `Your orders and sales: ${link}\n\nKeep this link to yourself: anyone who has it can see your orders.`,
  ownerHelp: (prefix) =>
    [
      "Invoices and receipts:",
      "• Send your logo as a picture with the caption *logo* to put it on every invoice and receipt.",
      `• *paid ${prefix}-1001* marks an order paid and sends the customer a receipt. When a customer sends a transfer screenshot, you get it with a Confirm button.`,
      `• *invoice ${prefix}-1001* or *receipt ${prefix}-1001* sends you a copy.`,
      "Customers get their invoice automatically when they confirm an order.",
    ].join("\n"),
};

const fr: QuoteTexts = {
  voiceNotOnLine: () => "Désolé, je ne peux pas écouter les messages vocaux sur cette ligne. Écrivez-moi ce qu'il vous faut (par exemple : 100 flyers A5).",
  voiceUnclear: () => "Désolé, je n'ai pas compris ce message vocal. Pouvez-vous m'écrire ce qu'il vous faut (par exemple : 100 flyers A5) ?",
  sendRequest: () => "Envoyez votre demande par message ou par message vocal (par exemple : 100 flyers A5).",
  stopReminders: () => "D'accord, je ne vous enverrai plus de rappels de devis. Écrivez-moi quand vous voulez un devis.",
  ratingAsk: (b, ref) => `Comment s'est passée votre commande ${ref} ? Votre avis aide ${b} à mieux vous servir.`,
  orderAgainButton: "🔁 Recommander",
  lastTime: (items) => `Votre dernière commande : ${items}. Touchez *Recommander* pour un nouveau devis identique.`,
  noLastOrder: "Je ne trouve pas de commande précédente. Dites-moi ce qu'il vous faut et je vous envoie un devis.",
  someGone: (items) => `Une partie de votre dernière commande n'est plus sur la liste de prix (${items}), je l'ai donc retirée.`,
  ratingButtons: { great: "😀 Très bien", ok: "🙂 Correct", bad: "🙁 Pas bien" },
  ratingThanks: (stars, b) =>
    stars >= 5
      ? `Merci ! 🙏 Ravis que vous soyez satisfait. Si vous connaissez quelqu'un qui aimerait ${b}, partagez-lui notre numéro.`
      : stars >= 3
        ? "Merci de nous l'avoir dit. S'il y a quelque chose à améliorer, répondez simplement ici."
        : `Désolés que ce n'était pas bien. J'ai prévenu l'équipe de ${b}, quelqu'un va vous contacter pour arranger cela.`,
  ratingAlready: "Merci, nous avons déjà votre avis pour cette commande. 🙏",
  ownerLowRating: (ref, who, phone) => `🙁 ${who} (${phone}) a dit que la commande ${ref} n'était *pas bien*. Contactez-le pour arranger cela.`,
  lowStock: (items) =>
    [
      "📦 Stock bas après cette commande :",
      ...items.map((i) => `• ${i.name} : ${i.left === 0 ? "*épuisé*" : `il en reste ${i.left}`}`),
      "Envoyez *stock* pour tout voir, ou mettez-le à jour dans la liste de prix de votre appli.",
    ].join("\n"),
  noPriceList: (b) => `Merci d'avoir écrit à ${b} ! Notre liste de prix n'est pas encore en ligne : quelqu'un de l'équipe va vous répondre.`,
  didntCatch: () => "Désolé, je n'ai pas bien compris. Pouvez-vous me dire ce que vous voulez et en quelle quantité ?",
  teamNotified: (b) => `J'ai prévenu l'équipe de ${b}. Quelqu'un va vous répondre ici très vite.`,
  closedNow: (when) => `🕗 Nous sommes fermés pour le moment${when ? ` et rouvrons ${when}` : ""}. Vous pouvez quand même commander ici ; l'équipe s'en occupera à l'ouverture.`,
  closed: (b) => `Désolé, ${b} ne prend pas de nouvelles commandes pour le moment. Adressez-vous à un membre du personnel.`,
  minimum: (item, min) => `${item} : la commande minimum est de ${min}.`,
  teamWillPrice: (items) => `L'équipe va vous envoyer un prix pour : ${items}.`,
  thanks: (note) => `Merci ! ${note}`,
  quoteHeader: (ref) => `Voici votre devis (${ref}) :`,
  quoteTotal: (total) => `*Total : ${total}*`,
  replyYes: () => "Répondez OUI pour passer la commande, ou dites-moi ce qu'il faut changer.",
  noQuoteWaiting: () => "Il n'y a pas de devis en attente de confirmation. Dites-moi ce que vous voulez et je vous en envoie un.",
  overLimitCustomer: (b, ref, total) => `Merci ! L'équipe de ${b} va vous contacter très vite pour finaliser la commande ${ref} (total ${total}).`,
  payLine: (url, currency) =>
    currency === "NGN"
      ? `Payez en ligne par carte, virement ou USSD : ${url}`
      : `Payez en ligne par Mobile Money (MTN MoMo, Orange Money) ou par carte : ${url}`,
  payReminder: (n, b, ref, total, how) =>
    [
      n === 1
        ? `Bonjour ! Petit rappel de ${b} : votre commande ${ref} (${total}) attend votre paiement.`
        : `Rebonjour de la part de ${b} : nous gardons toujours votre commande ${ref} (${total}) pour vous.`,
      how ?? "",
      n === 1 ? "Déjà payé ? Merci, ignorez ce message." : "C'est notre dernier rappel. Si vous avez changé d'avis, répondez simplement pour nous le dire.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  nextWalkInLink: () => "Payez avec le lien, puis montrez le QR code de votre reçu au retrait.",
  nextWalkInCounter: (ref) => `Payez à la caisse en donnant votre numéro de commande, ${ref}.`,
  nextDeliveryLink: () => "Nous vous enverrons un lien pour suivre la livraison dès qu'un livreur sera en route.",
  nextReady: (b) => `L'équipe de ${b} vous préviendra quand ce sera prêt.`,
  nextContactDelivery: (b) => `L'équipe de ${b} va vous contacter très vite pour la livraison.`,
  confirmedInvoice: (ref, total, next) => `Merci ! La commande ${ref} est confirmée. Voici votre facture de ${total}. ${next}`,
  confirmedTotal: (ref, total, next) => `Merci ! La commande ${ref} est confirmée (total ${total}). ${next}`,
  confirmedContact: (ref, total, b, withDelivery) =>
    `Merci ! La commande ${ref} est confirmée (total ${total}). L'équipe de ${b} va vous contacter très vite pour le paiement${withDelivery ? " et la livraison" : ""}.`,
  invoice: () => "Facture",
  receipt: () => "Reçu",
  paymentThanks: (ref, total, b) => `Paiement reçu pour la commande ${ref} (${total}). Merci d'avoir choisi ${b} !`,
  pickupAtTable: (table) => `Nous vous l'apportons à ${table}.`,
  pickupWhenReady: () => "Nous vous écrirons quand ce sera prêt à retirer.",
  pickupShowQr: () => "Montrez le QR code de ce reçu au retrait.",
  pickupShowCode: (code) => `Montrez ce message au retrait. Votre code est ${code}.`,
  hereIsReceipt: () => "Voici votre reçu :",
  noProblem: () => "Pas de souci. Dites-moi si vous avez besoin d'autre chose.",
  cancelledQuote: (ref) => `Pas de souci, j'ai annulé le devis ${ref}. Écrivez-moi quand vous voulez en refaire un.`,
  defaultHelp: (names) => `Je peux vous faire un devis pour : ${names}. Dites-moi ce qu'il vous faut et en quelle quantité.`,
  poweredBy: () => "_Propulsé par yarnOga · yarnoga.com_",
  aCustomer: () => "Un client",
  talkRequest: (who, number) => `${who} (${number}) voudrait parler à quelqu'un. Répondez-lui sur WhatsApp.`,
  manualQuote: (who, number) => `Demande de devis de ${who} (${number}), répondez-lui avec un prix :`,
  wantsToOrder: (who, number, ref) => `${who} (${number}) veut commander ${ref} :`,
  total: (total) => `Total : ${total}`,
  overLimitOwner: (limit, plan, ref) =>
    `Vous avez utilisé les ${limit} commandes de votre formule ${plan} ce mois-ci : je ne l'ai donc pas confirmée et je n'ai pas envoyé de facture. Répondez-lui vous-même. Envoyez *paid ${ref}* une fois payé, ou *plan* pour voir comment passer à la formule supérieure.`,
  newOrder: (walkIn, ref, who, number, table) => `Nouvelle commande${walkIn ? " sur place" : ""} ${ref} de ${who} (${number})${table ? ` à ${table}` : ""} :`,
  walkInScreensNote: (online, ref) =>
    `Elle apparaît sur vos écrans de retrait dès qu'elle est payée${online ? " en ligne" : `. S'il paie à la caisse, touchez *Paid at counter* sur l'écran ou répondez *paid ${ref}*`}.`,
  payLinkSentNote: (ref) => `Un lien de paiement en ligne lui a été envoyé. Je vous préviens quand c'est payé et je lui envoie le reçu. S'il vous paie autrement, répondez *paid ${ref}*.`,
  replyPaidNote: (ref) => `Une fois payé, répondez *paid ${ref}* et je lui enverrai le reçu.`,
  paidTwice: (who, ref, total, cancelled) =>
    `⚠️ ${who} a payé ${ref} en ligne (${total}), mais la commande était déjà ${cancelled ? "annulée" : "marquée payée"}. S'il a payé deux fois, écrivez au support yarnOga pour rembourser le paiement en ligne.`,
  paidCounter: (ref, total, who) => `💰 ${ref} a été payée à la caisse (${total}). J'ai envoyé le reçu à ${who}.`,
  paidApp: (ref, total, who) => `💰 ${ref} a été marquée payée dans l'appli (${total}). J'ai envoyé le reçu à ${who}.`,
  paidOnline: (ref, total, who, fee, provider) =>
    `💰 ${ref} payée en ligne (${total}) par ${who}. Je lui ai envoyé son reçu, et ${provider} verse l'argent sur votre compte` +
    (fee ? `, moins les frais yarnOga (${fee}) et les frais ${provider}.` : "."),
  onPickupScreens: (stations) => `Elle est sur ${stations.length > 1 ? "vos écrans" : "votre écran"} de retrait : ${stations.join(", ")}.`,
  ownerHint: () => "Vous êtes le propriétaire : envoyez *menu* pour voir vos commandes.",
  logoHint: (catalogue) =>
    "Pour mettre cette image en logo sur vos factures et reçus, renvoyez-la avec la légende *logo*." +
    (catalogue ? " Pour une photo de produit, mettez la légende *photo* et le nom du produit, par exemple *photo T-shirts*." : ""),
  logoCantSave: () => "Les logos ne peuvent pas encore être enregistrés ici. Prévenez le support yarnOga.",
  logoFormat: () => "Envoyez le logo en image (PNG ou JPEG). Un PNG envoyé en document garde un fond transparent.",
  logoSaved: () => "Logo enregistré ✅ Il sera sur toutes vos factures et reçus.",
  cantFind: (ref) => `Je ne trouve pas la commande ${ref}. Vérifiez le numéro.`,
  noDocuments: () => "Les factures et reçus en image ne sont pas dans votre formule. Envoyez *plan* pour voir les options.",
  invoiceFor: (ref, total) => `Facture de ${ref} (${total}) :`,
  notPaidYet: (ref) => `${ref} n'est pas encore marquée payée. Envoyez *paid ${ref}* quand le client a payé.`,
  receiptFor: (ref) => `Reçu de ${ref} :`,
  cancelledCantPay: (ref) => `${ref} a été annulée, je ne peux donc pas la marquer payée.`,
  alreadyPaid: (ref, date) => `${ref} était déjà marquée payée${date ? ` le ${date}` : ""}. Voici à nouveau le reçu :`,
  justUpdated: (ref) => `${ref} vient d'être modifiée par un autre message. Envoyez *receipt ${ref}* pour voir où elle en est.`,
  markedPaidSent: (ref, total, who) =>
    `✅ ${ref} marquée payée (${total}). J'ai envoyé ce reçu à ${who}. S'il n'a pas écrit depuis 24 heures, WhatsApp peut le retenir : vous pouvez lui transférer cette copie.`,
  markedPaidTold: (ref, total, who, couldntDraw) => `✅ ${ref} marquée payée (${total}). J'ai prévenu ${who}${couldntDraw ? ", mais je n'ai pas pu créer le reçu" : ""}.`,
  proofPassedOn: (ref, b) => `Merci ! J'ai transmis ceci à ${b} pour vérifier le paiement de la commande ${ref}. Votre reçu arrive ici dès que l'argent est confirmé.`,
  proofCheck: (who, ref, total, file, caption) =>
    `${who} a envoyé ${file ? "un fichier (ouvrez-le dans votre boîte de discussions)" : "ceci"} comme paiement de ${ref} (${total}).${caption ? `\n\nSon message : « ${caption} »` : ""}\n\nVérifiez dans votre application bancaire que l'argent est bien arrivé avant de confirmer. Les fausses captures de virement sont courantes.`,
  proofButtons: { confirm: "✅ Paiement reçu", notReceived: "Pas reçu" },
  handedOver: (hours) => `Je vous passe cette discussion : le bot ne lui répondra pas pendant les ${hours} prochaines heures.`,
  limitButtons: { upgrade: (plan) => `Passer à ${plan}`, topUp: "Plus de réponses IA", plans: "Voir les formules" },
  checkInOk: () => "Ravi de l'entendre, merci !",
  checkInCall: () => "Merci. Quelqu'un de yarnOga va vous appeler très vite.",
  notReceivedTold: (ref, who) => `D'accord. J'ai prévenu ${who} que le paiement de ${ref} n'est pas encore arrivé.`,
  paidSoNotTold: (ref) => `${ref} est déjà marquée payée, je n'ai donc rien envoyé au client.`,
  notReceived: (ref, b) =>
    `${b} n'a pas encore reçu le paiement de la commande ${ref}. Un virement peut prendre quelques minutes. Si l'argent a quitté votre compte, renvoyez la preuve de virement ou répondez ici pour leur parler.`,
  drawFailed: () => "Désolé, je n'ai pas pu créer ce document. Réessayez dans une minute.",
  boardNotOnPlan: () => "Le tableau des commandes et des ventes est inclus à partir de la formule Pro. Envoyez *plan* pour voir comment changer de formule.",
  boardLink: (link) => `Vos commandes et ventes : ${link}\n\nGardez ce lien pour vous : toute personne qui l'a peut voir vos commandes.`,
  ownerHelp: (prefix) =>
    [
      "Factures et reçus :",
      "• Envoyez votre logo en image avec la légende *logo* pour le mettre sur toutes vos factures et reçus.",
      `• *paid ${prefix}-1001* marque une commande payée et envoie le reçu au client. Quand un client envoie une capture de virement, vous la recevez avec un bouton pour confirmer.`,
      `• *invoice ${prefix}-1001* ou *receipt ${prefix}-1001* vous en envoie une copie.`,
      "Les clients reçoivent leur facture automatiquement quand ils confirment une commande.",
    ].join("\n"),
};

const pcm: QuoteTexts = {
  ...en,
  voiceNotOnLine: () => "Sorry, I no fit listen to voice note for this line. Abeg type wetin you need (like: 100 A5 flyers).",
  voiceUnclear: () => "Sorry, I no hear that voice note well. Abeg you fit type wetin you need (like: 100 A5 flyers)?",
  sendRequest: () => "Abeg send wetin you need as message or voice note (like: 100 A5 flyers).",
  stopReminders: () => "No wahala, I no go send you quote reminder again. Message me anytime you need quote.",
  ratingAsk: (b, ref) => `How we take do your order ${ref}? Wetin you talk go help ${b} serve you better.`,
  orderAgainButton: "🔁 Order am again",
  lastTime: (items) => `Last time, you order: ${items}. Tap *Order am again* make I send you fresh quote for the same thing.`,
  noLastOrder: "I no see any order wey you don do before. Tell me wetin you need, I go send you quote.",
  someGone: (items) => `Some things for your last order no dey the price list again (${items}), so I comot am.`,
  ratingButtons: { great: "😀 E sweet me", ok: "🙂 E dey okay", bad: "🙁 E no good" },
  ratingThanks: (stars, b) =>
    stars >= 5
      ? `Thank you well well! 🙏 We happy say e sweet you. If you know person wey go like ${b}, abeg share our number with dem.`
      : stars >= 3
        ? "Thank you for telling us. If anything dey wey we fit do better, just reply here."
        : `Sorry say e no good. I don tell the ${b} team, somebody go call you to fix am.`,
  ratingAlready: "Thank you, we don already get your answer for that order. 🙏",
  noPriceList: (b) => `Thank you for messaging ${b}! Our price list never dey online, so somebody from the team go reply you.`,
  didntCatch: () => "Sorry, I no understand well. Wetin you want, and how many?",
  teamNotified: (b) => `I don tell the ${b} team. Somebody go reply you here soon.`,
  closedNow: (when) => `🕗 We don close for now${when ? `, we go open again ${when}` : ""}. You fit still order here; the team go handle am once we open.`,
  closed: (b) => `Sorry, ${b} no dey take new order now. Abeg ask any of the staff.`,
  minimum: (item, min) => `${item}: the smallest order na ${min}.`,
  teamWillPrice: (items) => `The team go send you price for: ${items}.`,
  thanks: (note) => `Thank you! ${note}`,
  quoteHeader: (ref) => `See your quote (${ref}):`,
  replyYes: () => "Reply YES make I place this order, or tell me wetin to change.",
  noQuoteWaiting: () => "No quote dey wait to confirm. Tell me wetin you want, I go send you one.",
  overLimitCustomer: (b, ref, total) => `Thank you! The ${b} team go reach you soon to finish order ${ref} (total ${total}).`,
  payLine: (url, currency) =>
    currency === "NGN" ? `Pay online with card, bank transfer or USSD: ${url}` : `Pay online with Mobile Money (MTN MoMo, Orange Money) or card: ${url}`,
  payReminder: (n, b, ref, total, how) =>
    [
      n === 1
        ? `Hello! Small reminder from ${b}: your order ${ref} (${total}) still dey wait for payment.`
        : `Hello again from ${b}: we still dey hold your order ${ref} (${total}) for you.`,
      how ?? "",
      n === 1 ? "You don pay already? Thank you, abeg ignore this one." : "This na our last reminder. If you don change your mind, just reply make we know.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  nextWalkInLink: () => "Pay with the link, then show the QR code for your receipt when you come collect.",
  nextWalkInCounter: (ref) => `Abeg pay for the counter and give dem your order number, ${ref}.`,
  nextDeliveryLink: () => "Once rider don start to come, we go send you link to follow your delivery.",
  nextReady: (b) => `The ${b} team go tell you when e ready.`,
  nextContactDelivery: (b) => `The ${b} team go reach you soon about delivery.`,
  confirmedInvoice: (ref, total, next) => `Thank you! Order ${ref} don confirm. See your invoice for ${total}. ${next}`,
  confirmedTotal: (ref, total, next) => `Thank you! Order ${ref} don confirm (total ${total}). ${next}`,
  confirmedContact: (ref, total, b, withDelivery) =>
    `Thank you! Order ${ref} don confirm (total ${total}). The ${b} team go reach you soon about payment${withDelivery ? " and delivery" : ""}.`,
  paymentThanks: (ref, total, b) => `We don receive payment for order ${ref} (${total}). Thank you as you choose ${b}!`,
  pickupAtTable: (table) => `We go bring am come ${table}.`,
  pickupWhenReady: () => "We go message you when e ready to collect.",
  pickupShowQr: () => "Show the QR code for this receipt when you come collect.",
  pickupShowCode: (code) => `Show this message when you come collect. Your code na ${code}.`,
  hereIsReceipt: () => "See your receipt:",
  noProblem: () => "No wahala. Tell me if you need anything else.",
  cancelledQuote: (ref) => `No wahala, I don cancel quote ${ref}. Message me anytime you need new one.`,
  defaultHelp: (names) => `I fit give you quote for: ${names}. Tell me wetin you need and how many.`,
};

export const QUOTE_TEXTS: Record<Lang, QuoteTexts> = { en, fr, pcm };
