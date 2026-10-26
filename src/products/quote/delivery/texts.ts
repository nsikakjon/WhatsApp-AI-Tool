import type { Lang } from "../../../core/i18n.js";

// Everything the delivery steps say, in English and French. Amounts arrive
// already formatted in the business's currency; nothing here works out money.

export interface DeliveryTexts {
  // To the customer
  confirmingFee(business: string): string;
  deliveryLine(zone: string | null): string;
  askAddress: string;
  collectFrom(pickup: string | undefined): string;
  total(amount: string): string;
  tapConfirm: string;
  confirmOrder: string;
  deliverInstead: string;
  changeAddress: string;
  tapConfirmOrChange: string;
  willConfirmFee(business: string): string;
  deliveryTo(where: string, zone: string | null, fee: string | null): string;
  items(amount: string): string;
  riderComing(rider: string, label: string, business: string, link: string): string;
  deliveryCancelled(label: string, business: string): string;
  pinnedLocation: string;
  addressGiven: string;

  // To the owner
  customerCollects: string;
  deliverTo(where: string): string;
  addRiderFirst(label: string): string;
  replyRider(label: string, first: string, all: string): string;
  aCustomer: string;
  theCustomer: string;
  outsideZones(label: string, who: string, waId: string, where: string): string;
  replyFee(label: string, currencyName: string): string;
  yourRiders: string;
  noRiders: string;
  notAPhone: string;
  added(name: string, waId: string): string;
  removed(name: string): string;
  noSuchRider(name: string): string;
  cantFind(label: string): string;
  notConfirmed(label: string): string;
  noDeliveryDetails(label: string): string;
  notWaitingForFee(label: string): string;
  justConfirmed(label: string): string;
  justChangedFee(label: string): string;
  sentFee(who: string, fee: string, label: string, total: string): string;
  wasCancelled(label: string): string;
  customerCollecting(label: string): string;
  alreadyPicked(rider: string, label: string): string;
  alreadyDelivered(label: string): string;
  unknownRider(who: string, example: string): string;
  justChangedRider(label: string, rider: string): string;
  sentTo(label: string, rider: string, customer: string): string;
  riderSilent(rider: string, label: string): string;
  notPaidYet(label: string, rider: string): string;
  deliveryAlreadyCancelled(label: string): string;
  cancelledDelivery(label: string, rider: string | null): string;
  refundNote(label: string, provider: string): string;
  ownerHelp(prefix: string, currencyName: string): string;

  // To the rider
  tapWhen(label: string): string;
  pickedUp: string;
  delivered: string;
  couldntDeliver: string;
  goneElsewhere(label: string): string;
  job(o: { ref: string; business: string; pickup: string; where: string; map: string; customer: string; payment: string; link: string }): string;
  paid: string;
  unpaid(total: string, business: string): string;
  dontDeliver(label: string, bringBack: string | null): string;
  notYours(label: string): string;
  noJob: string;
  alreadyMarked(ref: string, status: string): string;
  thanks: { picked_up: string; delivered: string; failed: string };
  gotLocation(ref: string, link: string): string;
  noLiveLocation(link: string): string;
  status: Record<string, string>;

  // Couriers through Shipbubble
  courierLine(courier: string): string;
  courierOffer(where: string, courier: string, eta: string | null, fee: string): string;
  courierComing(courier: string, label: string, business: string, link: string | null | undefined): string;
  courierToPay(label: string, courier: string, fee: string): string;
  courierPayLink(label: string, courier: string, fee: string, url: string): string;
  courierBooked(label: string, courier: string, phone: string | null | undefined, pickupEta: string | null, pickup: string): string;
  courierBookFailed(label: string, courier: string, why: string): string;
  courierNotFound(label: string): string;
  noCourier(label: string): string;
  courierAlreadyBooked(label: string, courier: string): string;
  courierNoPayments: string;
}

const en: DeliveryTexts = {
  confirmingFee: (b) => `${b} is confirming the delivery fee to your address. You'll get the new total here shortly.`,
  deliveryLine: (z) => (z ? `Delivery (${z})` : "Delivery"),
  askAddress:
    "Where should we deliver? Tap *Send location* to share a pin, or type the full address with the area (for example: 12 Allen Avenue, Ikeja). Reply *PICKUP* to collect it yourself.",
  collectFrom: (p) => `No problem, you'll collect it${p ? ` from:\n${p}` : "."}`,
  total: (a) => `*Total: ${a}*`,
  tapConfirm: "Tap *Confirm order* to place it.",
  confirmOrder: "Confirm order",
  deliverInstead: "Deliver instead",
  changeAddress: "Change address",
  tapConfirmOrChange: "Tap *Confirm order* to place it, or change the address.",
  willConfirmFee: (b) => `Thanks! ${b} will confirm the delivery fee to that address and send you the new total here.`,
  deliveryTo: (w, z, f) => `Delivery to ${w}${z ? ` (${z})` : ""}: ${f ?? "free"}`,
  items: (a) => `Items: ${a}`,
  riderComing: (r, l, b, link) => `${r} will deliver your order ${l} from ${b}. Follow it here: ${link}`,
  deliveryCancelled: (l, b) => `The delivery of your order ${l} has been cancelled. ${b} will contact you.`,
  pinnedLocation: "the pinned location",
  addressGiven: "the address given",

  customerCollects: "The customer will collect it.",
  deliverTo: (w) => `Deliver to: ${w}`,
  addRiderFirst: (l) => `To send it out, add your rider first: *add rider Musa 0803 123 4567*, then *rider ${l} Musa*.`,
  replyRider: (l, first, all) => `To send it out, reply *rider ${l} ${first}* (your riders: ${all}).`,
  aCustomer: "a customer",
  theCustomer: "The customer",
  outsideZones: (l, who, w, where) => `${l}: ${who} (+${w}) wants delivery to ${where}, which isn't in any of your delivery zones.`,
  replyFee: (l, c) => `Reply *fee ${l} 2500* with the delivery fee in ${c} (or *fee ${l} 0* for free delivery).`,
  yourRiders: "Your riders:",
  noRiders: "You haven't added any riders yet. Send *add rider Musa 0803 123 4567*.",
  notAPhone: "That doesn't look like a phone number. Try: *add rider Musa 0803 123 4567*",
  added: (n, w) => `Added ${n} (+${w}). Ask ${n} to send *hi* to this WhatsApp number once, so WhatsApp lets my job messages through.`,
  removed: (n) => `${n} won't be offered for deliveries any more.`,
  noSuchRider: (n) => `I can't find a rider called ${n}. Send *riders* to see your list.`,
  cantFind: (l) => `I can't find order ${l}. Please check the number.`,
  notConfirmed: (l) => `${l} hasn't been confirmed by the customer yet.`,
  noDeliveryDetails: (l) => `${l} has no delivery details. It was ordered before delivery was switched on, or the customer hasn't chosen yet.`,
  notWaitingForFee: (l) => `${l} isn't waiting for a delivery fee, so I've left it as it is.`,
  justConfirmed: (l) => `${l} has just been confirmed or cancelled, so I've left the fee as it was.`,
  justChangedFee: (l) => `${l} has just changed. Send the fee again if it's still needed.`,
  sentFee: (who, f, l, t) => `Sent ${who} the delivery fee of ${f} for ${l} (new total ${t}).`,
  wasCancelled: (l) => `${l} was cancelled.`,
  customerCollecting: (l) => `The customer is collecting ${l} themselves.`,
  alreadyPicked: (r, l) => `${r} has already picked up ${l}.`,
  alreadyDelivered: (l) => `${l} has already been delivered.`,
  unknownRider: (who, ex) => `I don't know a rider called ${who}. Add them first: *add rider ${ex}*`,
  justChangedRider: (l, r) => `${l} has just changed. Send *rider ${l} ${r}* again if it still needs a rider.`,
  sentTo: (l, r, c) => `Sent ${l} to ${r}. ${c} has a link to follow the delivery.`,
  riderSilent: (r, l) =>
    `⚠️ ${r} hasn't messaged this number in the last 24 hours, so WhatsApp may not deliver the job. Ask ${r} to send *hi* to this number, then send *rider ${l} ${r}* again, or forward this:`,
  notPaidYet: (l, r) => `${l} isn't marked paid yet. If ${r} collects payment on delivery, reply *paid ${l}* once you have it.`,
  deliveryAlreadyCancelled: (l) => `${l}'s delivery was already cancelled.`,
  cancelledDelivery: (l, r) => `Cancelled the delivery of ${l}. I've told the customer${r ? ` and ${r}` : ""}.`,
  refundNote: (l, p) => `${l} was paid. If the customer should get money back, refund it from your ${p} dashboard (open the payment, then Refund) or by bank transfer.`,
  ownerHelp: (prefix, c) =>
    [
      "Delivery:",
      "• *add rider Musa 0803 123 4567* saves a rider. *riders* lists them, *remove rider Musa* takes one off.",
      `• *rider ${prefix}-1001 Musa* sends Musa the job and gives the customer a tracking link.`,
      `• *fee ${prefix}-1001 2500* sets the delivery fee (in ${c}) when an address isn't in your zones.`,
      `• *cancel delivery ${prefix}-1001* stops a delivery and tells the customer and rider.`,
      "Delivery zones and fees are set in your yarnOga app, under Delivery.",
    ].join("\n"),

  tapWhen: (l) => `Tap when ${l} is picked up and when it's delivered.`,
  pickedUp: "Picked up",
  delivered: "Delivered",
  couldntDeliver: "Couldn't deliver",
  goneElsewhere: (l) => `${l} has gone to another rider, so you don't need to deliver it.`,
  job: (o) =>
    [
      `New delivery ${o.ref} from ${o.business}`,
      `Pick up: ${o.pickup}`,
      `Deliver to: ${o.where}`,
      `Map: ${o.map}`,
      `Customer: ${o.customer}`,
      o.payment,
      "",
      "When you set off, open this link and keep it open so the customer can see you coming:",
      o.link,
    ].join("\n"),
  paid: "Payment: already paid.",
  unpaid: (t, b) => `Payment: not paid yet (${t}). Check with ${b} before you hand it over.`,
  dontDeliver: (l, back) => `${l} is cancelled, so don't deliver it.${back ? ` Please bring it back to ${back}.` : ""}`,
  notYours: (l) => `${l} isn't one of your deliveries.`,
  noJob: "You don't have a delivery in progress.",
  alreadyMarked: (r, s) => `${r} is already marked ${s}.`,
  thanks: { picked_up: "Thanks! The customer knows you're on the way.", delivered: "Thanks! Marked delivered.", failed: "Okay, I've told the business." },
  gotLocation: (r, link) => `Got your location for ${r}. For live updates, keep your rider page open: ${link}`,
  noLiveLocation: (link) => `WhatsApp doesn't pass live location on to me. To share where you are, open your rider page and keep it open: ${link}`,
  status: { picked_up: "picked up", delivered: "delivered", failed: "not delivered", cancelled: "cancelled" },

  courierLine: (c) => `Delivery by ${c}`,
  courierOffer: (w, c, eta, f) => `Delivery to ${w} by ${c}${eta ? ` (${eta.toLowerCase()})` : ""}: ${f}`,
  courierComing: (c, l, b, link) => `${c} will deliver your order ${l} from ${b}.${link ? ` Follow it here: ${link}` : ""}`,
  courierToPay: (l, c, f) =>
    `The customer chose delivery by ${c} (${f}). The courier fee wasn't paid online, so it's with you: reply *courier ${l}* for a link to pay it, and the courier is booked as soon as it's paid.`,
  courierPayLink: (l, c, f, url) => `Pay the ${c} fee of ${f} for ${l} here, and I'll book the courier as soon as it's paid:\n${url}`,
  courierBooked: (l, c, phone, eta, pickup) =>
    `🚚 ${c} is booked for ${l}${phone ? ` (${phone})` : ""}. They'll collect it from ${pickup}${eta ? `, ${eta.toLowerCase()}` : ""}. Please have it packed and labelled ${l}. The customer has a tracking link.`,
  courierBookFailed: (l, c, why) =>
    `⚠️ I couldn't book ${c} for ${l}: ${why}. The fee has been paid, so yarnOga support has been told and will sort it out, or send *rider ${l} <name>* to use your own rider.`,
  courierNotFound: (l) => `I can't find a courier delivery for ${l}.`,
  noCourier: (l) => `${l} isn't going by courier.`,
  courierAlreadyBooked: (l, c) => `${c} is already booked for ${l}.`,
  courierNoPayments: "I can't make a payment link just now. Please contact yarnOga support to book the courier.",
};

const fr: DeliveryTexts = {
  confirmingFee: (b) => `${b} confirme les frais de livraison à votre adresse. Vous recevrez le nouveau total ici sous peu.`,
  deliveryLine: (z) => (z ? `Livraison (${z})` : "Livraison"),
  askAddress:
    "Où devons-nous livrer ? Touchez *Envoyer la position* pour partager un repère, ou écrivez l'adresse complète avec le quartier (par exemple : Rue 12, Plateau). Répondez *RETRAIT* pour venir le chercher vous-même.",
  collectFrom: (p) => `Pas de souci, vous viendrez le chercher${p ? ` à :\n${p}` : "."}`,
  total: (a) => `*Total : ${a}*`,
  tapConfirm: "Touchez *Confirmer* pour passer la commande.",
  confirmOrder: "Confirmer",
  deliverInstead: "Plutôt livrer",
  changeAddress: "Changer l'adresse",
  tapConfirmOrChange: "Touchez *Confirmer* pour passer la commande, ou changez l'adresse.",
  willConfirmFee: (b) => `Merci ! ${b} va confirmer les frais de livraison à cette adresse et vous enverra le nouveau total ici.`,
  deliveryTo: (w, z, f) => `Livraison à ${w}${z ? ` (${z})` : ""} : ${f ?? "gratuite"}`,
  items: (a) => `Articles : ${a}`,
  riderComing: (r, l, b, link) => `${r} va livrer votre commande ${l} de ${b}. Suivez-la ici : ${link}`,
  deliveryCancelled: (l, b) => `La livraison de votre commande ${l} a été annulée. ${b} va vous contacter.`,
  pinnedLocation: "la position partagée",
  addressGiven: "l'adresse donnée",

  customerCollects: "Le client viendra la chercher.",
  deliverTo: (w) => `Livrer à : ${w}`,
  addRiderFirst: (l) => `Pour l'envoyer, ajoutez d'abord votre livreur : *add rider Moussa +225 07 12 34 56 78*, puis *rider ${l} Moussa*.`,
  replyRider: (l, first, all) => `Pour l'envoyer, répondez *rider ${l} ${first}* (vos livreurs : ${all}).`,
  aCustomer: "un client",
  theCustomer: "Le client",
  outsideZones: (l, who, w, where) => `${l} : ${who} (+${w}) veut être livré à ${where}, qui n'est dans aucune de vos zones de livraison.`,
  replyFee: (l, c) => `Répondez *fee ${l} 2500* avec les frais de livraison en ${c} (ou *fee ${l} 0* pour une livraison gratuite).`,
  yourRiders: "Vos livreurs :",
  noRiders: "Vous n'avez pas encore ajouté de livreur. Envoyez *add rider Moussa +225 07 12 34 56 78*.",
  notAPhone: "Ça ne ressemble pas à un numéro de téléphone. Essayez : *add rider Moussa +225 07 12 34 56 78*",
  added: (n, w) => `${n} (+${w}) est ajouté. Demandez à ${n} d'envoyer *bonjour* une fois à ce numéro WhatsApp, pour que WhatsApp laisse passer mes messages.`,
  removed: (n) => `${n} ne recevra plus de livraisons.`,
  noSuchRider: (n) => `Je ne trouve pas de livreur nommé ${n}. Envoyez *riders* pour voir votre liste.`,
  cantFind: (l) => `Je ne trouve pas la commande ${l}. Vérifiez le numéro.`,
  notConfirmed: (l) => `${l} n'a pas encore été confirmée par le client.`,
  noDeliveryDetails: (l) => `${l} n'a pas de détails de livraison. Elle a été commandée avant l'activation de la livraison, ou le client n'a pas encore choisi.`,
  notWaitingForFee: (l) => `${l} n'attend pas de frais de livraison, je n'y ai donc pas touché.`,
  justConfirmed: (l) => `${l} vient d'être confirmée ou annulée, j'ai donc laissé les frais tels quels.`,
  justChangedFee: (l) => `${l} vient de changer. Renvoyez les frais s'ils sont toujours nécessaires.`,
  sentFee: (who, f, l, t) => `J'ai envoyé à ${who} les frais de livraison de ${f} pour ${l} (nouveau total ${t}).`,
  wasCancelled: (l) => `${l} a été annulée.`,
  customerCollecting: (l) => `Le client vient chercher ${l} lui-même.`,
  alreadyPicked: (r, l) => `${r} a déjà récupéré ${l}.`,
  alreadyDelivered: (l) => `${l} a déjà été livrée.`,
  unknownRider: (who, ex) => `Je ne connais pas de livreur nommé ${who}. Ajoutez-le d'abord : *add rider ${ex}*`,
  justChangedRider: (l, r) => `${l} vient de changer. Renvoyez *rider ${l} ${r}* s'il faut toujours un livreur.`,
  sentTo: (l, r, c) => `${l} est envoyée à ${r}. ${c} a un lien pour suivre la livraison.`,
  riderSilent: (r, l) =>
    `⚠️ ${r} n'a pas écrit à ce numéro ces dernières 24 heures, WhatsApp risque donc de ne pas lui remettre la course. Demandez à ${r} d'envoyer *bonjour* à ce numéro, puis renvoyez *rider ${l} ${r}*, ou transférez ceci :`,
  notPaidYet: (l, r) => `${l} n'est pas encore marquée payée. Si ${r} encaisse à la livraison, répondez *paid ${l}* une fois l'argent reçu.`,
  deliveryAlreadyCancelled: (l) => `La livraison de ${l} était déjà annulée.`,
  cancelledDelivery: (l, r) => `Livraison de ${l} annulée. J'ai prévenu le client${r ? ` et ${r}` : ""}.`,
  refundNote: (l, p) => `${l} était payée. Si le client doit être remboursé, faites-le depuis votre tableau de bord ${p} (ouvrez le paiement, puis Rembourser) ou par Mobile Money.`,
  ownerHelp: (prefix, c) =>
    [
      "Livraison :",
      "• *add rider Moussa +225 07 12 34 56 78* enregistre un livreur. *riders* les liste, *remove rider Moussa* en retire un.",
      `• *rider ${prefix}-1001 Moussa* envoie la course à Moussa et donne au client un lien de suivi.`,
      `• *fee ${prefix}-1001 2500* fixe les frais de livraison (en ${c}) quand une adresse n'est pas dans vos zones.`,
      `• *cancel delivery ${prefix}-1001* arrête une livraison et prévient le client et le livreur.`,
      "Les zones et frais de livraison se règlent dans votre appli yarnOga, rubrique Livraison.",
    ].join("\n"),

  tapWhen: (l) => `Touchez quand ${l} est récupérée, puis quand elle est livrée.`,
  pickedUp: "Récupérée",
  delivered: "Livrée",
  couldntDeliver: "Pas pu livrer",
  goneElsewhere: (l) => `${l} a été confiée à un autre livreur, vous n'avez pas besoin de la livrer.`,
  job: (o) =>
    [
      `Nouvelle livraison ${o.ref} de ${o.business}`,
      `À récupérer : ${o.pickup}`,
      `À livrer à : ${o.where}`,
      `Carte : ${o.map}`,
      `Client : ${o.customer}`,
      o.payment,
      "",
      "Au départ, ouvrez ce lien et gardez-le ouvert pour que le client vous voie arriver :",
      o.link,
    ].join("\n"),
  paid: "Paiement : déjà payé.",
  unpaid: (t, b) => `Paiement : pas encore payé (${t}). Vérifiez avec ${b} avant de remettre la commande.`,
  dontDeliver: (l, back) => `${l} est annulée, ne la livrez pas.${back ? ` Merci de la rapporter à ${back}.` : ""}`,
  notYours: (l) => `${l} ne fait pas partie de vos livraisons.`,
  noJob: "Vous n'avez pas de livraison en cours.",
  alreadyMarked: (r, s) => `${r} est déjà marquée ${s}.`,
  thanks: { picked_up: "Merci ! Le client sait que vous êtes en route.", delivered: "Merci ! Marquée livrée.", failed: "D'accord, j'ai prévenu l'entreprise." },
  gotLocation: (r, link) => `Position reçue pour ${r}. Pour un suivi en direct, gardez votre page livreur ouverte : ${link}`,
  noLiveLocation: (link) => `WhatsApp ne me transmet pas la position en direct. Pour partager où vous êtes, ouvrez votre page livreur et gardez-la ouverte : ${link}`,
  status: { picked_up: "récupérée", delivered: "livrée", failed: "non livrée", cancelled: "annulée" },

  courierLine: (c) => `Livraison par ${c}`,
  courierOffer: (w, c, eta, f) => `Livraison à ${w} par ${c}${eta ? ` (${eta.toLowerCase()})` : ""} : ${f}`,
  courierComing: (c, l, b, link) => `${c} va livrer votre commande ${l} de ${b}.${link ? ` Suivez-la ici : ${link}` : ""}`,
  courierToPay: (l, c, f) =>
    `Le client a choisi la livraison par ${c} (${f}). Les frais du coursier n'ont pas été payés en ligne, vous les avez donc : répondez *courier ${l}* pour un lien de paiement, et le coursier est réservé dès le paiement.`,
  courierPayLink: (l, c, f, url) => `Payez les frais de ${c} de ${f} pour ${l} ici, et je réserve le coursier dès le paiement :\n${url}`,
  courierBooked: (l, c, phone, eta, pickup) =>
    `🚚 ${c} est réservé pour ${l}${phone ? ` (${phone})` : ""}. Il viendra la chercher à ${pickup}${eta ? `, ${eta.toLowerCase()}` : ""}. Préparez le colis marqué ${l}. Le client a un lien de suivi.`,
  courierBookFailed: (l, c, why) =>
    `⚠️ Je n'ai pas pu réserver ${c} pour ${l} : ${why}. Les frais sont payés, l'assistance yarnOga a été prévenue et va régler cela, ou envoyez *rider ${l} <nom>* pour votre propre livreur.`,
  courierNotFound: (l) => `Je ne trouve pas de livraison par coursier pour ${l}.`,
  noCourier: (l) => `${l} ne part pas par coursier.`,
  courierAlreadyBooked: (l, c) => `${c} est déjà réservé pour ${l}.`,
  courierNoPayments: "Je ne peux pas créer de lien de paiement pour l'instant. Contactez l'assistance yarnOga pour réserver le coursier.",
};

export const DELIVERY_TEXTS: Record<Lang, DeliveryTexts> = { en, fr };
