import type { Lang } from "./core/i18n.js";
import type { Currency } from "./core/money.js";
import { serve } from "@hono/node-server";
import { createClient } from "@supabase/supabase-js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createSupabaseStore } from "./core/db/store.js";
import { createSupabaseInboxStore } from "./core/inbox/store.js";
import { createGroqTranscriber } from "./core/voice/transcribe.js";
import { createWhatsAppClient } from "./core/whatsapp/client.js";
import type { Product } from "./core/product.js";
import { echoProduct } from "./products/echo/index.js";
import { createQuoteProduct, type QuoteProduct } from "./products/quote/index.js";
import { orderPayLinks, withOrderPayments } from "./products/quote/paylinks.js";
import {
  createSupabaseBranding,
  createSupabaseBusinesses,
  createSupabaseCatalog,
  createSupabaseOrders,
  createSupabaseSetup,
  DEFAULT_BUSINESS_ID,
  NumberTakenError,
  type QuoteBusiness,
} from "./products/quote/store.js";
import { createQuoteRouter } from "./products/quote/businesses.js";
import { createSupabaseBroadcasts } from "./products/quote/broadcast-store.js";
import { finishedText, sendDueBroadcasts, withBroadcasts } from "./products/quote/broadcasts.js";
import type { OutgoingImage, OutgoingTemplate } from "./core/whatsapp/client.js";
import { createSupabaseFollowUps, sendDueFollowUps, type FollowUpTarget } from "./products/quote/followups.js";
import { createSupabasePayReminders, sendPayReminders } from "./products/quote/payreminders.js";
import { cachedAbout, createSupabaseAbout } from "./products/quote/about.js";
import { isPauseActive } from "./core/db/store.js";
import { createClaudeUnderstander } from "./products/quote/understand.js";
import { createDispatch, type Dispatch, type DispatchOptions } from "./products/quote/delivery/index.js";
import { createShipbubble } from "./products/quote/delivery/shipbubble.js";
import { createSupabaseDeliveryStore } from "./products/quote/delivery/store.js";
import { createTrackingLinks } from "./products/quote/delivery/tracking.js";
import {
  createPlanGate,
  createPlanPaidHandler,
  createSupabasePlanPayments,
  createSupabasePlanStore,
} from "./products/quote/plan.js";
import { createClaudeDrafter } from "./products/quote/drafter.js";
import { createSupabaseSignups, withChatSignup } from "./products/quote/chat-signup.js";
import { memoryOrderStore, readOnlyBranding } from "./bottest/sandbox.js";
import { createPlanFeatures, createSupabaseFeatureStore, type PlanFeatures } from "./products/quote/features.js";
import { createAiCredits, createSupabaseCreditStore, lagosMonthKey } from "./products/quote/credits.js";
import { createMessageAllowance, createSupabaseSentStore } from "./products/quote/messages.js";
import { createSupabaseBoardStore, ordersLink } from "./products/quote/board.js";
import { createCatalogue, createSupabaseCatalogue } from "./products/quote/catalogue.js";
import { createWalkIn } from "./products/quote/walkin/index.js";
import { createWalkInLinks } from "./products/quote/walkin/links.js";
import { createSupabaseWalkInStore } from "./products/quote/walkin/store.js";
import { createSiteReporter } from "./products/site/index.js";
import { createSupabaseSiteStore } from "./products/site/store.js";
import { createClaudeSummariser } from "./products/site/summarise.js";
import { createLeadQualifier } from "./products/leads/index.js";
import { createSupabaseLeadStore } from "./products/leads/store.js";
import { createClaudeLeadUnderstander } from "./products/leads/understand.js";
import { runEvery } from "./core/schedule.js";
import { createTestBots } from "./bottest/bots.js";
import { loadBotTestConfig } from "./bottest/config.js";
import { createBotTest } from "./bottest/index.js";
import { createSupabaseMarkStore } from "./bottest/store.js";
import {
  canMessageFreely,
  sendAndRecord,
  sendImageAndRecord,
  sendNotice,
  sendTemplateAndRecord,
} from "./core/whatsapp/outbox.js";
import { createFlyerBot, forwardTip } from "./products/flyer/index.js";
import { createSupabaseFlyerStore } from "./products/flyer/store.js";
import { createWishWriter } from "./products/flyer/wish.js";
import { TRIAL } from "./products/flyer/plans.js";
import { createSupabaseStats } from "./dashboard/stats.js";
import { createSocials } from "./dashboard/socials.js";
import { createSupabaseConnectionStore } from "./signup/store.js";
import { createSupabaseVisitStore, createSupabaseWebsiteStats } from "./dashboard/visits.js";
import { createSupabaseMoneyStore } from "./dashboard/profit.js";
import { createClaudeGeneratorWriter } from "./generator/index.js";
import { createPaystackClient } from "./core/payments/paystack.js";
import { createPayments, type PaidHandler, type PaymentRequest } from "./core/payments/payments.js";
import { createSupabasePaymentStore } from "./core/payments/store.js";
import { createSupabasePromoAdmin } from "./core/payments/promos.js";
import { createSupabaseReferrals, referralReply, rewardReferrer } from "./products/quote/referrals.js";
import { createAlerter, resendEmail, watchErrors } from "./core/alerts/alerter.js";
import { createSentry } from "./core/alerts/sentry.js";
import { createWatchdog, runChecks, type HealthDeps } from "./core/health.js";
import { createPaystackBanks } from "./core/payments/paystack.js";
import { createFlutterwaveClient } from "./core/payments/flutterwave.js";
import { createAzureSpeaker, createGoogleSpeaker, withVoiceReplies } from "./core/voice/speak.js";
import type { OwnerAppDeps } from "./owner/index.js";
import {
  createSupabaseBusinessData,
  createSupabaseDeliverySetup,
  createSupabasePrices,
  createSupabaseUsers,
} from "./owner/store.js";
import { copyOwnerNotices, withAlertCopies, withAppLogin } from "./owner/whatsapp.js";
import { createSupabaseVerifications } from "./compliance/store.js";
import { createDojahRegistry } from "./compliance/registry.js";
import type { ComplianceDeps } from "./compliance/index.js";
import type { Notice } from "./core/product.js";

const config = loadConfig();

const supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
  auth: { persistSession: false },
});

// With QUOTE_MULTI_BUSINESS on, business #1 (the main number) only sees its
// own price list and orders. With it off, nothing looks at businesses at all.
const quoteBusinesses = config.quoteBusinesses;
const mainBusinessId = quoteBusinesses ? DEFAULT_BUSINESS_ID : undefined;

// With QUOTE_DELIVERY on, each business's quote bot asks where to deliver and
// the owner sends their own riders out (see docs/DELIVERY.md).
const delivery = config.activeProduct === "quote" ? config.delivery : undefined;
const trackingLinks = delivery && createTrackingLinks(config.whatsapp.appSecret, delivery.publicUrl);

// Paystack links for quote plan upgrades. `payments` is set up further down;
// the link is only asked for when an owner sends "upgrade ...".
const planCheckout = (businessId: string) =>
  config.paystack
    ? { businessId, links: { createLink: (req: PaymentRequest) => payments!.createLink(req) } }
    : undefined;
// Pay links on invoices (QUOTE_PAY_LINKS), for a business with a Paystack
// subaccount: the money goes to its own bank account.
// yarnOga's fee comes from the plan (transaction_fee, migration 0048); no plan or no row, no fee.
// Shipbubble couriers for addresses outside a business's zones (SHIPBUBBLE_API_KEY).
// Naira only, and only with online payments, so yarnOga always collects the
// courier fee before its wallet pays the courier.
const couriers = config.shipbubble ? createShipbubble(config.shipbubble) : undefined;
function courierFor(
  businessId: string,
  businessName: string,
  orderPrefix: string,
  b: { on: boolean; ownerWaId?: string | null; pickup?: string | null; currency?: Currency },
): DispatchOptions["courier"] {
  if (!couriers || !b.on || !config.paystack || (b.currency ?? "NGN") !== "NGN" || !b.ownerWaId || !b.pickup) return undefined;
  const ownerWaId = b.ownerWaId;
  return {
    service: couriers,
    from: { name: businessName, phone: ownerWaId, address: b.pickup.replace(/\s*\n\s*/g, ", ") },
    async payLink(order, feeKobo) {
      const link = await payments!.createLink({
        product: "quote",
        waId: ownerWaId,
        amountKobo: feeKobo,
        purpose: { kind: "courier", businessId, orderNumber: order.orderNumber },
        title: `Courier for ${businessName} order ${orderPrefix}-${order.orderNumber}`,
      });
      if (!link.url) throw new Error("No payment link was made");
      return link.url;
    },
  };
}

// CFA franc businesses are paid through Flutterwave, to their Flutterwave subaccount.
const payLinkFor = (
  businessId: string,
  businessName: string,
  orderPrefix: string,
  accounts: { paystack?: string | null; flutterwave?: string | null; currency?: Currency },
  features?: PlanFeatures,
  dispatch?: Dispatch,
) => {
  const currency = accounts.currency ?? "NGN";
  const cfa = currency !== "NGN";
  const subaccount = cfa ? accounts.flutterwave : accounts.paystack;
  const provider = cfa ? config.flutterwave : config.paystack;
  return config.quotePayLinks && provider && subaccount
    ? orderPayLinks({
        links: { createLink: (req) => payments!.createLink(req) },
        businessId,
        businessName,
        orderPrefix,
        subaccount,
        currency,
        feeBasisPoints: features
          ? async () => ((await features.has("transaction_fee")) ? ((await features.limit("transaction_fee")) ?? 0) : 0)
          : undefined,
        // The cap is a plan feature too (migration 0052); without the row, the default cap applies.
        feeCap: features ? () => features.limit(cfa ? "transaction_fee_cap_cfa" : "transaction_fee_cap_ngn").catch(() => null) : undefined,
        // A Shipbubble courier's fee goes to yarnOga, which pays the courier from its wallet.
        courierKobo: dispatch
          ? async (order) => {
              const charge = await dispatch.charge(order.id);
              return charge?.courier ? charge.feeKobo : 0;
            }
          : undefined,
      })
    : undefined;
};
// Each quote business's own referral code (QUOTE_REFERRALS), paid for through Paystack.
const referrals = config.quoteReferrals && quoteBusinesses && config.paystack ? createSupabaseReferrals(supabase) : undefined;

// Broadcasts to opted-in customers (BROADCASTS_ENABLED). Off: the quote bot
// is exactly as before.
const broadcastConfig = config.broadcasts;
const broadcastStore = broadcastConfig ? createSupabaseBroadcasts(supabase) : undefined;
function addBroadcasts(bot: Product, businessId: string, businessName: string, ownerWaId: string | undefined): Product {
  if (!broadcastConfig || !broadcastStore) return bot;
  return withBroadcasts(bot, {
    businessId,
    businessName,
    ownerWaId,
    store: broadcastStore,
    monthlyLimit: (id) => broadcastStore.monthlyLimit(id),
    pictures: !!broadcastConfig.imageTemplateName,
    costPerMessageKobo: broadcastConfig.costPerMessageKobo,
  });
}

// Quote follow-up reminders; with QUOTE_FOLLOW_UPS off nothing reads or writes them.
const followUpConfig = config.quoteFollowUps;
const followUps = followUpConfig ? createSupabaseFollowUps(supabase) : undefined;
const optOutFor = (businessId: string) =>
  followUps ? (contactId: string) => followUps.optOut(businessId, contactId) : undefined;

// The owner's orders page (QUOTE_ORDER_BOARD): the link each owner gets by sending "orders".
const orderBoard = config.activeProduct === "quote" ? config.quoteOrderBoard : undefined;
const ordersLinkFor = (businessId: string) =>
  orderBoard ? ordersLink(config.whatsapp.appSecret, orderBoard.publicUrl, businessId) : undefined;

// Plan features (AI credits, voice notes, invoices), only with
// QUOTE_PLAN_FEATURES on. Business #1 always counts AI use under its fixed id.
// A branch passes its main business's id: same plan, one pool of AI replies.
function planFeatures(businessId: string, code?: string) {
  if (!config.quotePlanFeatures) return {};
  const features = createPlanFeatures({ code, store: createSupabaseFeatureStore(supabase, businessId) });
  return { features, credits: createAiCredits({ features, store: createSupabaseCreditStore(supabase, businessId) }) };
}

// Bot messages a number may send a month on its plan, with plan features on.
// The main number also counts messages saved without a number id ("").
const botMessagesFor = (numberIds: string[], features?: PlanFeatures) =>
  features ? createMessageAllowance({ features, store: createSupabaseSentStore(supabase, numberIds) }) : undefined;

// Product photos and stock (QUOTE_CATALOGUE), on the business's own price list.
const catalogueFor = (businessId: string, features?: PlanFeatures, currency?: Currency) =>
  config.quoteCatalogue ? createCatalogue({ store: createSupabaseCatalogue(supabase, businessId), features, currency }) : undefined;

// Walk-in orders, pickup screens and receipt QR codes (QUOTE_WALK_IN).
const walkInConfig = config.activeProduct === "quote" ? config.quoteWalkIn : undefined;
const walkInLinks = walkInConfig && createWalkInLinks(config.whatsapp.appSecret, walkInConfig.publicUrl);
const walkInFor = (businessId: string, orderPrefix: string, features?: PlanFeatures) =>
  walkInLinks
    ? createWalkIn({ businessId, orderPrefix, store: createSupabaseWalkInStore(supabase, businessId), links: walkInLinks, features })
    : undefined;

// How many numbers (business plus branches) a main business's plan allows; null = no cap.
async function numbersAllowed(mainId: string): Promise<number | null> {
  const { features } = mainId === DEFAULT_BUSINESS_ID ? planFeatures(mainId, config.quote?.plan) : planFeatures(mainId);
  if (!features) return null;
  return (await features.has("branches")) ? features.limit("branches") : 1;
}

// The owners' and staff app (OWNER_APP, migration 0049). Its extra alert
// numbers get a copy of every alert the bot sends the owner.
const ownerApp = config.activeProduct === "quote" ? config.ownerApp : undefined;
async function alertNumbersFor(businessId: string): Promise<string[]> {
  if (!ownerApp) return [];
  const { data, error } = await supabase.from("quote_alert_numbers").select("wa_id").eq("business_id", businessId);
  if (error) throw new Error(`alert numbers failed: ${error.message}`);
  return (data ?? []).map((r) => r.wa_id as string);
}
const withAlerts = (bot: Product, businessId: string, ownerWaId: string | null | undefined): Product =>
  ownerApp ? withAlertCopies(bot, { ownerWaId: ownerWaId ?? undefined, numbers: () => alertNumbersFor(businessId) }) : bot;
async function copyAlerts(notes: Notice[], businessId: string, ownerWaId: string | null | undefined): Promise<Notice[]> {
  try {
    return copyOwnerNotices(notes, ownerWaId ?? undefined, await alertNumbersFor(businessId));
  } catch (err) {
    console.error("Could not copy alerts to the extra alert numbers:", err);
    return notes;
  }
}

// Voice notes answered with a voice note (Azure, or Google), for businesses that switch it on.
const speaker = !config.tts
  ? undefined
  : config.tts.provider === "azure"
    ? createAzureSpeaker({ apiKey: config.tts.apiKey, region: config.tts.region!, voices: config.tts.voices })
    : createGoogleSpeaker({ apiKey: config.tts.apiKey, voices: config.tts.voices });
const withVoice = (bot: Product, enabled: () => boolean, language?: Lang): Product =>
  speaker ? withVoiceReplies(bot, { speaker, enabled, language }) : bot;

let product: Product = echoProduct;
let mainQuoteBot: QuoteProduct | undefined;

/** A business's quote bot and the number it answers on (null = main number), for work that starts outside a chat. */
async function quoteBotFor(
  businessId: string,
): Promise<{ bot: QuoteProduct; fromNumberId: string | null; name: string; orderPrefix: string; ownerWaId: string | null; language: Lang } | null> {
  if (businessId === DEFAULT_BUSINESS_ID && mainQuoteBot && config.quote) {
    return {
      bot: mainQuoteBot,
      fromNumberId: null,
      name: config.quote.businessName,
      orderPrefix: config.quote.orderPrefix,
      ownerWaId: config.quote.ownerWaId ?? null,
      language: config.quote.language,
    };
  }
  if (!quoteBusinesses) return null;
  const business = await createSupabaseBusinesses(supabase).get(businessId);
  if (!business) return null;
  return {
    bot: businessBot(business, quoteBusinesses),
    fromNumberId: business.phoneNumberId,
    name: business.name,
    orderPrefix: business.orderPrefix,
    ownerWaId: business.ownerWaId,
    language: business.language ?? "en",
  };
}
if (config.activeProduct === "quote" && config.quote) {
  const orders = createSupabaseOrders(supabase, mainBusinessId);
  const mainFeatures = config.quote.plan ? planFeatures(DEFAULT_BUSINESS_ID, config.quote.plan) : {};
  const mainDispatch =
    delivery && trackingLinks
      ? createDispatch({
          businessName: config.quote.businessName,
          orderPrefix: config.quote.orderPrefix,
          ownerWaId: config.quote.ownerWaId,
          pickup: config.quote.businessDetails,
          store: createSupabaseDeliveryStore(supabase, DEFAULT_BUSINESS_ID),
          orders,
          links: trackingLinks,
          template: delivery.template,
          language: config.quote.language,
          currency: config.quote.currency,
          courier: courierFor(DEFAULT_BUSINESS_ID, config.quote.businessName, config.quote.orderPrefix, {
            on: config.quote.courierDelivery,
            ownerWaId: config.quote.ownerWaId,
            pickup: config.quote.businessDetails,
            currency: config.quote.currency,
          }),
        })
      : undefined;
  const quoteBot = createQuoteProduct({
    businessName: config.quote.businessName,
    orderPrefix: config.quote.orderPrefix,
    ownerWaId: config.quote.ownerWaId,
    businessDetails: config.quote.businessDetails,
    paymentDetails: config.quote.paymentDetails,
    branding: createSupabaseBranding(supabase, mainBusinessId),
    catalog: createSupabaseCatalog(supabase, mainBusinessId),
    orders,
    delivery: mainDispatch,
    language: config.quote.language,
    currency: config.quote.currency,
    about: cachedAbout(createSupabaseAbout(supabase, DEFAULT_BUSINESS_ID)),
    optOutOfFollowUps: optOutFor(DEFAULT_BUSINESS_ID),
    ordersLink: ordersLinkFor(DEFAULT_BUSINESS_ID),
    payLink: payLinkFor(
      DEFAULT_BUSINESS_ID,
      config.quote.businessName,
      config.quote.orderPrefix,
      { paystack: config.quote.paystackSubaccount, flutterwave: config.quote.flutterwaveSubaccount, currency: config.quote.currency },
      mainFeatures.features,
      mainDispatch,
    ),
    payProvider: config.quote.currency === "NGN" ? "Paystack" : "Flutterwave",
    walkIn: walkInFor(DEFAULT_BUSINESS_ID, config.quote.orderPrefix, mainFeatures.features),
    plan: config.quote.plan
      ? createPlanGate({
          code: config.quote.plan,
          // Business #1's row holds any plan it paid for in the chat.
          store: createSupabasePlanStore(supabase, DEFAULT_BUSINESS_ID),
          checkout: planCheckout(DEFAULT_BUSINESS_ID),
        })
      : undefined,
    // Business #1 has no plan_code to fall back on: no QUOTE_PLAN, no plan features.
    ...mainFeatures,
    botMessages: botMessagesFor([config.whatsapp.phoneNumberId, ""], mainFeatures.features),
    catalogue: catalogueFor(DEFAULT_BUSINESS_ID, mainFeatures.features, config.quote.currency),
    ai: createClaudeUnderstander({
      apiKey: config.quote.anthropicApiKey,
      model: config.quote.model,
      businessName: config.quote.businessName,
      description: config.quote.businessDescription,
      language: config.quote.language,
      currency: config.quote.currency,
    }),
  });
  mainQuoteBot = quoteBot;
  const mainLanguage = config.quote.language;
  const mainVoice = config.quote.voiceReplies;
  product = addBroadcasts(
    withAlerts(withVoice(quoteBot, () => mainVoice, mainLanguage), DEFAULT_BUSINESS_ID, config.quote.ownerWaId),
    DEFAULT_BUSINESS_ID,
    config.quote.businessName,
    config.quote.ownerWaId,
  );
}

// Other businesses on the quote bot each answer their own WhatsApp number.
function businessBot(business: QuoteBusiness, multi: NonNullable<typeof quoteBusinesses>): QuoteProduct {
  const orders = createSupabaseOrders(supabase, business.id);
  // A branch is billed, and counts AI replies, under its main business.
  const planId = business.branchOf ?? business.id;
  const features = planFeatures(planId);
  const dispatch =
    delivery && trackingLinks
      ? createDispatch({
          businessName: business.name,
          orderPrefix: business.orderPrefix,
          ownerWaId: business.ownerWaId ?? undefined,
          pickup: business.businessDetails ?? undefined,
          fromNumberId: business.phoneNumberId ?? undefined,
          store: createSupabaseDeliveryStore(supabase, business.id),
          orders,
          links: trackingLinks,
          template: delivery.template,
          language: business.language,
          currency: business.currency,
          courier: courierFor(business.id, business.name, business.orderPrefix, {
            on: business.courierDelivery === true,
            ownerWaId: business.ownerWaId,
            pickup: business.businessDetails,
            currency: business.currency,
          }),
        })
      : undefined;
  return createQuoteProduct({
    businessName: business.name,
    orderPrefix: business.orderPrefix,
    ownerWaId: business.ownerWaId ?? undefined,
    businessDetails: business.businessDetails ?? undefined,
    paymentDetails: business.paymentDetails ?? undefined,
    branding: createSupabaseBranding(supabase, business.id),
    catalog: createSupabaseCatalog(supabase, business.id),
    orders,
    delivery: dispatch,
    language: business.language,
    currency: business.currency,
    about: cachedAbout(createSupabaseAbout(supabase, business.id)),
    optOutOfFollowUps: optOutFor(business.id),
    ordersLink: ordersLinkFor(business.id),
    referral: referrals ? () => referralReply(referrals, planId, business.name) : undefined,
    payLink: payLinkFor(
      business.id,
      business.name,
      business.orderPrefix,
      { paystack: business.paystackSubaccount, flutterwave: business.flutterwaveSubaccount, currency: business.currency },
      features.features,
      dispatch,
    ),
    payProvider: business.currency && business.currency !== "NGN" ? "Flutterwave" : "Paystack",
    walkIn: walkInFor(business.id, business.orderPrefix, features.features),
    plan: createPlanGate({ store: createSupabasePlanStore(supabase, business.id), checkout: planCheckout(planId) }),
    ...features,
    botMessages: business.phoneNumberId ? botMessagesFor([business.phoneNumberId], features.features) : undefined,
    catalogue: catalogueFor(business.id, features.features, business.currency),
    ai: createClaudeUnderstander({
      apiKey: multi.anthropicApiKey,
      model: multi.model,
      businessName: business.name,
      description: business.description ?? undefined,
      language: business.language,
      currency: business.currency,
    }),
  });
}
if (quoteBusinesses) {
  product = createQuoteRouter({
    businesses: createSupabaseBusinesses(supabase),
    fallback: product,
    fallbackNumberIds: [config.whatsapp.phoneNumberId],
    build: (business) =>
      addBroadcasts(
        withAlerts(withVoice(businessBot(business, quoteBusinesses), () => business.voiceReplies === true, business.language), business.id, business.ownerWaId),
        business.id,
        business.name,
        business.ownerWaId ?? undefined,
      ),
  });
}

// Business owners sign up by chatting to the yarnOga quotes number (QUOTE_SIGNUP_PHONE_NUMBER_ID).
const chatSignup = config.quoteChatSignup;
if (chatSignup && quoteBusinesses) {
  const businesses = createSupabaseBusinesses(supabase);
  product = withChatSignup(product, {
    numberId: chatSignup.phoneNumberId,
    store: createSupabaseSignups(supabase),
    setup: createSupabaseSetup(supabase),
    drafter: createClaudeDrafter({ apiKey: quoteBusinesses.anthropicApiKey, model: quoteBusinesses.model }),
    alertWaId: chatSignup.alertWaId,
    // The owner's own bot with test orders kept in memory; its order alerts go to the owner.
    tryBot: async (businessId, ownerWaId) => {
      const business = await businesses.get(businessId);
      if (!business) return null;
      return createQuoteProduct({
        businessName: business.name,
        orderPrefix: business.orderPrefix,
        ownerWaId,
        businessDetails: business.businessDetails ?? undefined,
        paymentDetails: business.paymentDetails ?? undefined,
        catalog: createSupabaseCatalog(supabase, business.id),
        branding: readOnlyBranding(createSupabaseBranding(supabase, business.id)),
        orders: memoryOrderStore(),
        language: business.language,
        currency: business.currency,
        ai: createClaudeUnderstander({
          apiKey: quoteBusinesses.anthropicApiKey,
          model: quoteBusinesses.model,
          businessName: business.name,
          description: business.description ?? undefined,
          language: business.language,
          currency: business.currency,
        }),
      });
    },
  });
}

// Owners and staff send "app" to their business's number for a login link.
const appUsers = ownerApp ? createSupabaseUsers(supabase) : undefined;
if (ownerApp && appUsers) {
  const businesses = createSupabaseBusinesses(supabase);
  product = withAppLogin(product, {
    users: appUsers,
    publicUrl: ownerApp.publicUrl,
    async businessFor(numberId) {
      if (!numberId || numberId === config.whatsapp.phoneNumberId) {
        return config.quote ? { id: DEFAULT_BUSINESS_ID, ownerWaId: config.quote.ownerWaId ?? null } : null;
      }
      if (!quoteBusinesses) return null;
      const b = await businesses.findByPhoneNumberId(numberId);
      // A switched-off business can still log in, to set up before going live.
      return b ? { id: b.id, ownerWaId: b.ownerWaId } : null;
    },
  });
}

// The site reporter answers its own WhatsApp number (SITE_PHONE_NUMBER_ID).
const siteConfig = config.site;
const siteReporter = siteConfig
  ? createSiteReporter({
      store: createSupabaseSiteStore(supabase),
      ai: createClaudeSummariser({ apiKey: siteConfig.anthropicApiKey, model: siteConfig.model }),
      reportHour: siteConfig.reportHour,
    })
  : undefined;

// The lead qualifier answers its own WhatsApp number (LEADS_PHONE_NUMBER_ID).
const leadsConfig = config.leads;
const leadQualifier = leadsConfig
  ? createLeadQualifier({
      store: createSupabaseLeadStore(supabase),
      ai: createClaudeLeadUnderstander({
        apiKey: leadsConfig.anthropicApiKey,
        model: leadsConfig.model,
        businessName: leadsConfig.businessName,
      }),
      businessName: leadsConfig.businessName,
      agentWaIds: leadsConfig.agentWaIds,
    })
  : undefined;

const store = createSupabaseStore(supabase);
const whatsapp = createWhatsAppClient(config.whatsapp);

// Problems reach Jay: every logged error goes to Sentry and (at most every
// 30 minutes) to ALERT_WA_ID on WhatsApp and ALERT_EMAIL by email.
const alertConfig = config.alerts;
const alerter = createAlerter({
  whatsapp: alertConfig.waId
    ? (text) =>
        sendNotice(
          { store, whatsapp },
          {
            to: alertConfig.waId!,
            text,
            // Template values can't hold line breaks.
            template: alertConfig.template && { ...alertConfig.template, bodyParams: [text.replace(/\s*\n+\s*/g, " · ").slice(0, 900)] },
          },
        )
    : undefined,
  email: alertConfig.email ? resendEmail(alertConfig.email) : undefined,
});
const sentry = alertConfig.sentry
  ? createSentry({ ...alertConfig.sentry, release: process.env.RAILWAY_GIT_COMMIT_SHA })
  : null;
watchErrors({ sentry, alerter, onProcess: true });

// What /health/full and /status check, and the watchdog runs every 5 minutes.
const health: HealthDeps = {
  version: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
  startedAt: Date.now(),
  labels: { database: "Database (Supabase)", whatsapp: "WhatsApp Cloud API", ai: "AI replies (Anthropic)", messages: "Customer messages" },
  checks: {
    async database() {
      const { error } = await supabase.from("contacts").select("id", { head: true, count: "estimated" }).limit(1);
      if (error) throw new Error(error.message);
    },
    async whatsapp() {
      const res = await fetch(`https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${config.whatsapp.phoneNumberId}?fields=id`, {
        headers: { Authorization: `Bearer ${config.whatsapp.accessToken}` },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) throw new Error(`WhatsApp answered ${res.status}${res.status === 401 ? " (the access token has expired or been changed)" : ""}`);
    },
    ...(process.env.ANTHROPIC_API_KEY
      ? {
          async ai() {
            // Listing models is free: it only checks the key and that Anthropic answers.
            const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
              headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
              signal: AbortSignal.timeout(7000),
            });
            if (!res.ok) throw new Error(`Anthropic answered ${res.status}`);
          },
        }
      : {}),
    // Never fails: says when the last customer message came in.
    async messages() {
      const { data } = await supabase
        .from("messages")
        .select("created_at")
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return "none yet";
      const minutes = Math.round((Date.now() - new Date(data.created_at as string).getTime()) / 60_000);
      return `last one ${minutes < 60 ? `${minutes} minutes` : minutes < 2880 ? `${Math.round(minutes / 60)} hours` : `${Math.round(minutes / 1440)} days`} ago`;
    },
  },
};
const watchdog = createWatchdog({ ...health, alerter });
runEvery(5 * 60 * 1000, async () => {
  await watchdog();
});

// Paystack checkout links, when PAYSTACK_SECRET_KEY is set. Each product that
// sells something adds what happens once it's paid, and the WhatsApp number
// its messages about the payment come from.
const paidHandlers: Record<string, PaidHandler> = {};
const productNumbers: Record<string, string> = {};
const paystackConfig = config.paystack;
const flutterwaveConfig = config.flutterwave;
const paymentSite = paystackConfig ?? flutterwaveConfig;
const payments = paymentSite
  ? createPayments({
      paystack: paystackConfig ? createPaystackClient(paystackConfig) : undefined,
      flutterwave: flutterwaveConfig ? createFlutterwaveClient(flutterwaveConfig) : undefined,
      store: createSupabasePaymentStore(supabase),
      callbackUrl: `${paymentSite.publicUrl}/payments/done`,
      customerEmail: paymentSite.customerEmail,
      onPaid: paidHandlers,
      send: (product, note) => sendNotice({ store, whatsapp }, note, note.fromNumberId ?? productNumbers[product]),
    })
  : undefined;

// The flyer bot answers its own WhatsApp number (FLYER_PHONE_NUMBER_ID).
const flyerConfig = config.flyer;
const flyerBot = flyerConfig
  ? createFlyerBot({
      store: createSupabaseFlyerStore(supabase),
      wishes: createWishWriter({ apiKey: flyerConfig.anthropicApiKey, model: flyerConfig.model }),
      owners: flyerConfig.ownerWaIds,
      openSignup: flyerConfig.openSignup,
      brandName: flyerConfig.brandName,
      credit: flyerConfig.credit,
      sendHour: flyerConfig.sendHour,
      trial: TRIAL,
      payments,
      promos: payments ? createSupabasePromoAdmin(supabase) : undefined,
    })
  : undefined;
if (flyerBot && flyerConfig) {
  paidHandlers.flyer = flyerBot.planPaid;
  productNumbers.flyer = flyerConfig.phoneNumberId;
}

// Quote bot plan upgrades paid in the chat.
if (config.quote || quoteBusinesses) {
  const planPayments = createSupabasePlanPayments(supabase);
  const planPaid = createPlanPaidHandler({
    store: planPayments,
    mainBusinessId: DEFAULT_BUSINESS_ID,
    rewardReferral: referrals
      ? (code) => rewardReferrer({ code, store: referrals, plans: planPayments, mainBusinessId: DEFAULT_BUSINESS_ID })
      : undefined,
  });
  // An order paid by pay link: that business's bot marks it paid, and its messages come from the business's number.
  paidHandlers.quote = withOrderPayments(
    planPaid,
    async (businessId, orderNumber, feeKobo, courierKobo) => {
      const found = await quoteBotFor(businessId);
      if (!found) throw new Error(`Order paid for business ${businessId}, which isn't set up`);
      const notes = await copyAlerts(await found.bot.orderPaid(orderNumber, { how: "online", feeKobo, courierKobo }), businessId, found.ownerWaId);
      return notes.map((n) => ({ ...n, fromNumberId: found.fromNumberId ?? undefined }));
    },
    // The owner paid a courier fee by link ("courier KP-1001"): book the courier.
    async (businessId, orderNumber) => {
      const found = await quoteBotFor(businessId);
      if (!found) throw new Error(`Courier fee paid for business ${businessId}, which isn't set up`);
      const notes = await copyAlerts(await found.bot.courierPaid(orderNumber), businessId, found.ownerWaId);
      return notes.map((n) => ({ ...n, fromNumberId: found.fromNumberId ?? undefined }));
    },
  );
  productNumbers.quote = config.whatsapp.phoneNumberId;
}

// Our WhatsApp numbers as the staff inbox labels them, main number first.
const numbers = [
  { id: config.whatsapp.phoneNumberId, label: config.activeProduct === "quote" ? "Sales" : "Main" },
  ...(siteConfig ? [{ id: siteConfig.phoneNumberId, label: "Site reports" }] : []),
  ...(leadsConfig ? [{ id: leadsConfig.phoneNumberId, label: "Property leads" }] : []),
  ...(flyerConfig ? [{ id: flyerConfig.phoneNumberId, label: "Flyers" }] : []),
];

// The owners' and staff app: each logged-in person's business, put together
// from the same stores the bot uses.
const verifications = createSupabaseVerifications(supabase);
const complianceDeps: ComplianceDeps | undefined = config.compliance
  ? {
      password: config.compliance.password,
      store: verifications,
      registry: config.compliance.dojah ? createDojahRegistry(config.compliance.dojah) : undefined,
      // The decision goes to the owner from their business's own number.
      async notifyOwner(businessId, text) {
        const found = await quoteBotFor(businessId);
        if (!found?.ownerWaId) return;
        await sendNotice({ store, whatsapp }, { to: found.ownerWaId, text }, found.fromNumberId ?? undefined);
      },
    }
  : undefined;

const ownerAppDeps: OwnerAppDeps | undefined =
  ownerApp && appUsers
    ? {
        secret: config.whatsapp.appSecret,
        publicUrl: ownerApp.publicUrl,
        users: appUsers,
        support: { email: ownerApp.supportEmail, waNumber: ownerApp.supportWaId },
        inbox: { store: createSupabaseInboxStore(supabase), messages: store, whatsapp },
        health: () => runChecks(health),
        healthLabels: health.labels,
        verification: {
          store: verifications,
          // Jay hears about each business that sends its details.
          onSubmitted: (id, name) =>
            alerter.alert(`kyb:${id}`, "a business sent its verification", `${name} sent its details and documents for review.\n\n${config.compliance ? `Review it: ${ownerApp.publicUrl}/compliance/b/${id}` : "Switch on the compliance page (COMPLIANCE_PASSWORD) to review it."}`, { urgent: true }),
        },
        banks: paystackConfig ? createPaystackBanks(paystackConfig) : undefined,
        async business(id) {
          const businesses = createSupabaseBusinesses(supabase);
          const main = id === DEFAULT_BUSINESS_ID;
          if (main && !config.quote) return null;
          const row = main ? null : quoteBusinesses ? await businesses.get(id) : null;
          if (!main && (!row || !row.phoneNumberId)) return null;
          // A main business's numbers include its branches'.
          const branches = config.quoteBranches ? (await businesses.list()).filter((b) => b.branchOf === id) : [];
          const ids = [id, ...branches.map((b) => b.id)];
          const name = main ? config.quote!.businessName : row!.name;
          const orderPrefix = main ? config.quote!.orderPrefix : row!.orderPrefix;
          const numberId = main ? config.whatsapp.phoneNumberId : row!.phoneNumberId!;
          const features = main ? (config.quote!.plan ? planFeatures(id, config.quote!.plan).features : undefined) : planFeatures(row!.branchOf ?? id).features;
          const branding = createSupabaseBranding(supabase, id);
          const sentNumbers = main ? [numberId, ""] : [numberId];
          const language = main ? config.quote!.language : (row!.language ?? "en");
          const currency = main ? config.quote!.currency : (row!.currency ?? "NGN");
          return {
            id,
            name,
            orderPrefix,
            language,
            currency,
            voiceReplies: main ? config.quote!.voiceReplies : row!.voiceReplies === true,
            courier: {
              available: Boolean(config.shipbubble && config.paystack && delivery && currency === "NGN"),
              on: main ? config.quote!.courierDelivery : row!.courierDelivery === true,
              set: main
                ? undefined
                : async (on: boolean) => {
                    // updated_at makes the bot pick the change up straight away.
                    const { error } = await supabase.from("quote_businesses").update({ courier_delivery: on, updated_at: new Date().toISOString() }).eq("id", id);
                    if (error) throw new Error(`courier setting failed: ${error.message}`);
                  },
            },
            fromEnv: main,
            numberId,
            includeUnnumbered: main,
            features,
            board: createSupabaseBoardStore(supabase, ids, { withDelivery: Boolean(delivery) }),
            prices: createSupabasePrices(supabase, id),
            photos: config.quoteCatalogue ? createSupabaseCatalogue(supabase, id) : undefined,
            delivery: delivery
              ? createSupabaseDeliverySetup(supabase, id, trackingLinks ? (deliveryId) => trackingLinks.customer({ id: deliveryId }) : undefined)
              : undefined,
            data: createSupabaseBusinessData(supabase, {
              businessId: id,
              businessIds: ids,
              numberIds: [...sentNumbers, ...branches.map((b) => b.phoneNumberId).filter((n): n is string => Boolean(n))],
              orderPrefix,
            }),
            logo: () => branding.logo(),
            saveLogo: (data, mimeType) => branding.saveLogo(data, mimeType),
            async markPaid(orderNumber) {
              const found = await quoteBotFor(id);
              if (!found) return false;
              let notes: Notice[];
              try {
                notes = await found.bot.orderPaid(orderNumber, { how: "app" });
              } catch (err) {
                console.error(`Owner app: couldn't mark ${orderPrefix}-${orderNumber} paid:`, err);
                return false;
              }
              for (const note of await copyAlerts(notes, id, found.ownerWaId)) {
                try {
                  await sendNotice({ store, whatsapp }, note, found.fromNumberId ?? undefined);
                } catch (err) {
                  console.error(`Owner app: receipt or alert for ${orderPrefix}-${orderNumber} not sent:`, err);
                }
              }
              return notes.length > 0;
            },
            testBot: () =>
              createQuoteProduct({
                businessName: name,
                orderPrefix,
                ownerWaId: "test-owner",
                businessDetails: (main ? config.quote!.businessDetails : row!.businessDetails) ?? undefined,
                paymentDetails: (main ? config.quote!.paymentDetails : row!.paymentDetails) ?? undefined,
                catalog: createSupabaseCatalog(supabase, main ? mainBusinessId : id),
                branding: readOnlyBranding(branding),
                orders: memoryOrderStore(),
                language,
                currency,
                about: createSupabaseAbout(supabase, id),
                ai: createClaudeUnderstander({
                  apiKey: main ? config.quote!.anthropicApiKey : quoteBusinesses!.anthropicApiKey,
                  model: main ? config.quote!.model : quoteBusinesses!.model,
                  businessName: name,
                  description: (main ? config.quote!.businessDescription : row!.description) ?? undefined,
                  language,
                  currency,
                }),
              }),
            async botMessages() {
              if (!features) return null;
              const limit = await features.limit("bot_messages");
              const sent = await createSupabaseSentStore(supabase, sentNumbers).sent(lagosMonthKey(new Date()));
              return { sent, limit };
            },
            payLinks: {
              on: Boolean(
                config.quotePayLinks &&
                  (currency === "NGN"
                    ? config.paystack && (main ? config.quote!.paystackSubaccount : row!.paystackSubaccount)
                    : config.flutterwave && (main ? config.quote!.flutterwaveSubaccount : row!.flutterwaveSubaccount)),
              ),
              feeBasisPoints: async () =>
                features && (await features.has("transaction_fee")) ? ((await features.limit("transaction_fee")) ?? 0) : 0,
              feeCap: async () => (features ? features.limit(currency === "NGN" ? "transaction_fee_cap_ngn" : "transaction_fee_cap_cfa") : null),
            },
          };
        },
      }
    : undefined;

const app = createApp({
  verifyToken: config.whatsapp.verifyToken,
  appSecret: config.whatsapp.appSecret,
  store,
  whatsapp,
  transcriber: config.groq ? createGroqTranscriber(config.groq) : undefined,
  ownerReplyPauseMinutes: config.ownerReplyPauseMinutes,
  route: (msg) => {
    if (siteReporter && msg.businessNumberId === siteConfig?.phoneNumberId) return siteReporter;
    if (leadQualifier && msg.businessNumberId === leadsConfig?.phoneNumberId) return leadQualifier;
    if (flyerBot && msg.businessNumberId === flyerConfig?.phoneNumberId) return flyerBot;
    return product;
  },
}, config.dashboard
  ? {
      password: config.dashboard.password,
      stats: createSupabaseStats(supabase, [
        ...numbers,
        ...(chatSignup ? [{ id: chatSignup.phoneNumberId, label: "Quotes demo and sign-up" }] : []),
      ]),
      website: createSupabaseWebsiteStats(supabase),
      money: createSupabaseMoneyStore(supabase),
      socials: createSocials({
        meta: config.dashboard.meta && { ...config.dashboard.meta, graphApiVersion: config.whatsapp.graphApiVersion },
        youtube: config.dashboard.youtube,
        tiktok: config.dashboard.tiktok,
      }),
      tiktokApp: config.dashboard.tiktok,
    }
  : undefined, {
  store: createSupabaseVisitStore(supabase),
  // Reuses an existing server secret to scramble the daily visitor code.
  secret: config.whatsapp.appSecret,
}, config.generator
  ? {
      writer: createClaudeGeneratorWriter({
        apiKey: config.generator.anthropicApiKey,
        model: config.generator.model,
      }),
      origins: config.generator.origins,
      perVisitorDailyLimit: config.generator.perVisitorDailyLimit,
      dailyLimit: config.generator.dailyLimit,
    }
  : undefined, config.signup
  ? {
      app: {
        appId: config.signup.appId,
        appSecret: config.whatsapp.appSecret,
        graphApiVersion: config.whatsapp.graphApiVersion,
      },
      configId: config.signup.configId,
      store: createSupabaseConnectionStore(supabase),
      // A newly connected number becomes a switched-off quote business, so it
      // shows on /quote-setup and the bot stays quiet on it until it's set up.
      onConnected: quoteBusinesses
        ? async (c) => {
            try {
              await createSupabaseSetup(supabase).createBusiness({
                name: c.verifiedName ?? c.displayNumber ?? "New business",
                description: null,
                orderPrefix: "ORD",
                phoneNumberId: c.phoneNumberId,
                ownerWaId: null,
                businessDetails: null,
                paymentDetails: null,
                active: false,
              });
              return true;
            } catch (err) {
              if (err instanceof NumberTakenError) return false;
              throw err;
            }
          }
        : undefined,
    }
  : undefined, config.inbox
  ? {
      password: config.inbox.password,
      appSecret: config.whatsapp.appSecret,
      inbox: createSupabaseInboxStore(supabase),
      messages: store,
      whatsapp,
      numbers,
    }
  : undefined, payments ? { payments, secretKey: paystackConfig?.secretKey, flutterwaveHash: flutterwaveConfig?.secretHash } : undefined, config.quoteSetup
  ? {
      password: config.quoteSetup.password,
      businesses: createSupabaseBusinesses(supabase),
      setup: createSupabaseSetup(supabase),
      // Numbers that already answer for something else can't be given to a business.
      reservedNumberIds: [
        config.whatsapp.phoneNumberId,
        config.site?.phoneNumberId,
        config.leads?.phoneNumberId,
        config.flyer?.phoneNumberId,
      ].filter((id): id is string => Boolean(id)),
      multiBusinessOn: Boolean(quoteBusinesses),
      drafter: config.quoteSetup.aiDraft
        ? createClaudeDrafter({ apiKey: config.quoteSetup.aiDraft.anthropicApiKey, model: config.quoteSetup.aiDraft.model })
        : undefined,
      draftsPerDay: config.quoteSetup.aiDraft?.perDay,
      branches: config.quoteBranches ? { limit: numbersAllowed } : undefined,
      payLinks: config.quotePayLinks && Boolean(config.paystack),
    }
  : undefined, delivery
  ? {
      secret: config.whatsapp.appSecret,
      publicUrl: delivery.publicUrl,
      // Any business's delivery, looked up by the id in the signed link.
      store: createSupabaseDeliveryStore(supabase),
      template: delivery.template,
      shipbubbleKey: config.shipbubble?.apiKey,
      // Rider updates from the tracking page go out in the business's language.
      async language(d) {
        if (!d.fromNumberId) return config.quote?.language ?? "en";
        return (await createSupabaseBusinesses(supabase).findByPhoneNumberId(d.fromNumberId))?.language ?? "en";
      },
      send: async (notices, fromNumberId) => {
        for (const note of notices) {
          try {
            await sendNotice({ store, whatsapp }, note, fromNumberId ?? undefined);
          } catch (err) {
            console.error(`Failed to send a delivery update to ...${note.to.slice(-4)}:`, err);
          }
        }
      },
    }
  : undefined, orderBoard
  ? {
      secret: config.whatsapp.appSecret,
      async business(id) {
        const withDelivery = Boolean(delivery);
        const businesses = createSupabaseBusinesses(supabase);
        // A main business's board shows its branches' orders too.
        const ids = config.quoteBranches ? [id, ...(await businesses.list()).filter((b) => b.branchOf === id).map((b) => b.id)] : [id];
        if (id === DEFAULT_BUSINESS_ID && config.quote) {
          return {
            name: config.quote.businessName,
            orderPrefix: config.quote.orderPrefix,
            store: createSupabaseBoardStore(supabase, ids, { withDelivery }),
            features: config.quote.plan ? planFeatures(id, config.quote.plan).features : undefined,
          };
        }
        const business = quoteBusinesses ? await businesses.get(id) : null;
        if (!business) return null;
        return {
          name: business.name,
          orderPrefix: business.orderPrefix,
          store: createSupabaseBoardStore(supabase, ids, { withDelivery }),
          features: planFeatures(id).features,
        };
      },
    }
  : undefined, walkInConfig
  ? {
      secret: config.whatsapp.appSecret,
      async business(id) {
        const found = await quoteBotFor(id);
        if (!found) return null;
        return {
          name: found.name,
          orderPrefix: found.orderPrefix,
          store: createSupabaseWalkInStore(supabase, id),
          fromNumberId: found.fromNumberId,
          language: found.language,
          paidAtCounter: (orderNumber) => found.bot.orderPaid(orderNumber, { how: "counter" }),
        };
      },
      send: async (notices, fromNumberId) => {
        for (const note of notices) {
          try {
            await sendNotice({ store, whatsapp }, note, fromNumberId ?? undefined);
          } catch (err) {
            console.error(`Failed to send a walk-in update to ...${note.to.slice(-4)}:`, err);
          }
        }
      },
    }
  : undefined, { health, ownerApp: ownerAppDeps, compliance: complianceDeps });

// Every 5 minutes, send any daily site reports that are due.
if (siteReporter && siteConfig) {
  runEvery(5 * 60 * 1000, async () => {
    for (const report of await siteReporter.dueReports(new Date())) {
      try {
        await sendAndRecord({ store, whatsapp }, report.to, report.text, siteConfig.phoneNumberId);
      } catch (err) {
        console.error(`Failed to send daily site report to ...${report.to.slice(-4)}:`, err);
      }
    }
  });
}

// The owner test screen at /bot-test (BOT_TEST_PASSWORD): try a bot on common
// customer questions before it goes live. It never sends WhatsApp messages.
const botTest = loadBotTestConfig();
if (botTest.status === "weak") console.warn("Bot test screen is OFF: BOT_TEST_PASSWORD must be at least 12 characters");
if (botTest.status === "on") {
  // Typed with a slash at the end, the address still opens the screen.
  app.get("/bot-test/", (c) => c.redirect("/bot-test"));
  app.route(
    "/bot-test",
    createBotTest({
      password: botTest.password,
      dailyLimit: botTest.dailyLimit,
      bots: createTestBots(supabase, config),
      marks: createSupabaseMarkStore(supabase),
    }),
  );
  console.log("Bot test screen: on at /bot-test");
}

// Every 5 minutes, send any birthday flyers that are due to group admins.
// An admin who messaged the bot in the last day gets the flyer with its
// message and a forwarding tip. Anyone else gets the approved template (if
// set up), or the flyer waits until they next message the bot that day.
if (flyerBot && flyerConfig) {
  const deps = { store, whatsapp };
  const from = flyerConfig.phoneNumberId;
  const template = flyerConfig.template;
  runEvery(5 * 60 * 1000, () =>
    flyerBot.sendDueBirthdays(new Date(), {
      canReach: async (to) => template !== undefined || (await canMessageFreely(store, to)),
      send: async (d) => {
        const image = { data: d.flyer, mimeType: "image/jpeg" };
        if (await canMessageFreely(store, d.to)) {
          await sendImageAndRecord(deps, d.to, { ...image, caption: d.wish }, from);
          await sendAndRecord(deps, d.to, forwardTip([d.memberName], d.groupName, d.lang), from);
        } else if (template) {
          await sendTemplateAndRecord(
            deps,
            d.to,
            { ...template, headerImage: image, bodyParams: [d.memberName, d.groupName, d.wish] },
            from,
          );
        } else {
          throw new Error("admin hasn't messaged the bot in the last day and no template is set");
        }
      },
    }),
  );
}

// Every minute, send the next few messages of any confirmed broadcasts.
if (broadcastConfig && broadcastStore) {
  const pictures = new Map<number, OutgoingImage>();
  runEvery(60 * 1000, () =>
    sendDueBroadcasts({
      store: broadcastStore,
      perRun: broadcastConfig.perMinute,
      send: async (to, b) => {
        let template: OutgoingTemplate = { ...broadcastConfig.template, bodyParams: [b.businessName, b.body] };
        if (b.imageMediaId && broadcastConfig.imageTemplateName) {
          let image = pictures.get(b.id);
          if (!image) {
            // The owner's photo: downloaded once per broadcast.
            const file = await whatsapp.downloadMedia(b.imageMediaId);
            image = { data: new Uint8Array(await file.data.arrayBuffer()), mimeType: file.mimeType === "image/png" ? "image/png" : "image/jpeg" };
            pictures.set(b.id, image);
          }
          template = { ...template, name: broadcastConfig.imageTemplateName, headerImage: image };
        }
        const from = b.fromNumberId ?? undefined;
        const sent = await whatsapp.sendTemplate(to, template, from);
        try {
          const contactId = await store.upsertContact(to);
          await store.recordOutbound(contactId, {
            waMessageId: sent.waMessageId,
            type: "template",
            body: `[${template.name}] ${b.body}`,
            raw: sent.raw,
            businessNumberId: from,
          });
        } catch (err) {
          console.error("Broadcast sent but not saved to the chat history:", err);
        }
        return sent.waMessageId;
      },
      notifyOwner: async (b, tally) => {
        pictures.delete(b.id);
        try {
          await sendAndRecord({ store, whatsapp }, b.ownerWaId, finishedText(b, tally), b.fromNumberId ?? undefined);
        } catch (err) {
          // Most likely the owner hasn't messaged in the last day.
          console.error(`Broadcast ${b.id} finished but the owner couldn't be told:`, err);
        }
      },
    }),
  );
}

// Every 15 minutes, send quote reminders that are due (one per unanswered
// Payment reminders (QUOTE_PAY_REMINDERS): at most two per confirmed, unpaid
// order, inside WhatsApp's free 24-hour window, daytime only. A business can
// switch them off in the app (Settings > Customers who haven't paid).
const payReminders = config.activeProduct === "quote" && config.quotePayReminders ? createSupabasePayReminders(supabase) : undefined;
if (payReminders) {
  const deps = { store, whatsapp };
  runEvery(15 * 60 * 1000, async () => {
    // Business #1's orders carry its fixed id (migration 0020), with or without more businesses.
    const rows = await createSupabaseBusinesses(supabase).list();
    const mainOn = rows.find((b) => b.id === DEFAULT_BUSINESS_ID)?.payRemindersOn !== false;
    const ids = mainOn ? [DEFAULT_BUSINESS_ID] : [];
    if (quoteBusinesses) {
      for (const b of rows) {
        if (b.id !== DEFAULT_BUSINESS_ID && b.active && b.phoneNumberId && b.payRemindersOn !== false) ids.push(b.id);
      }
    }
    for (const businessId of ids) {
      try {
        const found = await quoteBotFor(businessId);
        if (!found) continue;
        const numberId = found.fromNumberId ?? config.whatsapp.phoneNumberId;
        await sendPayReminders(businessId, {
          store: payReminders,
          canMessageFreely: (waId) => canMessageFreely(store, waId),
          isPaused: async (contactId) => isPauseActive(await store.botPause(contactId, numberId), new Date()),
          optedOut: followUps ? (contactId) => followUps.optedOut(businessId, contactId) : undefined,
          remind: (orderNumber, n) => found.bot.paymentReminder(orderNumber, n),
          sendText: (to, text) => sendAndRecord(deps, to, text, found.fromNumberId ?? undefined),
        });
      } catch (err) {
        console.error(`Payment reminders failed for business ${businessId}:`, err);
      }
    }
  });
}

// quote, daytime only). Business #1 uses QUOTE_FOLLOW_UP_HOURS; other
// businesses can set their own hours in quote_businesses.follow_up_hours.
if (followUps && followUpConfig) {
  const deps = { store, whatsapp };
  const template = followUpConfig.template;
  runEvery(15 * 60 * 1000, async () => {
    const targets: FollowUpTarget[] = [];
    if (config.activeProduct === "quote" && config.quote) {
      targets.push({
        businessId: mainBusinessId,
        businessName: config.quote.businessName,
        orderPrefix: config.quote.orderPrefix,
        hours: followUpConfig.hours,
        phoneNumberId: config.whatsapp.phoneNumberId,
        language: config.quote.language,
        currency: config.quote.currency,
      });
    }
    if (quoteBusinesses) {
      const hours = await followUps.businessHours();
      for (const b of await createSupabaseBusinesses(supabase).list()) {
        if (b.id === DEFAULT_BUSINESS_ID || !b.active || !b.phoneNumberId) continue;
        targets.push({
          businessId: b.id,
          businessName: b.name,
          orderPrefix: b.orderPrefix,
          hours: hours.get(b.id) ?? followUpConfig.hours,
          phoneNumberId: b.phoneNumberId,
          language: b.language,
          currency: b.currency,
        });
      }
    }
    for (const target of targets) {
      try {
        await sendDueFollowUps(target, {
          store: followUps,
          lastInboundAt: (waId) => store.lastInboundAt(waId),
          canMessageFreely: (waId) => canMessageFreely(store, waId),
          isPaused: async (contactId, numberId) =>
            isPauseActive(await store.botPause(contactId, numberId ?? config.whatsapp.phoneNumberId), new Date()),
          // When plan tiers land, check the business's plan here, e.g.
          // allowed: (id) => createPlanFeatures({ store: createSupabaseFeatureStore(supabase, id) }).has("follow_ups"),
          sendText: (to, text, from) => sendAndRecord(deps, to, text, from),
          sendTemplate: template
            ? (to, params, from) => sendTemplateAndRecord(deps, to, { ...template, bodyParams: params }, from)
            : undefined,
        });
      } catch (err) {
        console.error(`Quote reminders failed for ${target.businessName}:`, err);
      }
    }
  });
}

serve({ fetch: app.fetch, port: config.port, hostname: "0.0.0.0" }, (info) => {
  console.log(
    `Server listening on port ${info.port} (product: ${product.name}, more quote businesses: ${quoteBusinesses ? "on" : "off"}, quote reminders: ${followUps ? "on" : "off"}, broadcasts: ${broadcastConfig ? "on" : "off"}, site reporter: ${siteReporter ? "on" : "off"}, lead qualifier: ${leadQualifier ? "on" : "off"}, flyers: ${flyerBot ? "on" : "off"}, voice notes: ${config.groq ? "on" : "off"}, dashboard: ${config.dashboard ? "on" : "off"}, reply generator: ${config.generator ? "on" : "off"}, sign-up page: ${config.signup ? "on" : "off"}, owner-reply pause: ${config.ownerReplyPauseMinutes} min, inbox: ${config.inbox ? "on" : "off"}, payments: ${paystackConfig ? (paystackConfig.secretKey.startsWith("sk_live_") ? "Paystack live" : "Paystack test") : "Paystack off"}, ${flutterwaveConfig ? (flutterwaveConfig.secretKey.startsWith("FLWSECK_TEST") ? "Flutterwave test" : "Flutterwave live") : "Flutterwave off"}, quote setup screen: ${config.quoteSetup ? "on" : "off"}, delivery: ${delivery ? "on" : "off"}, order board: ${orderBoard ? "on" : "off"}, walk-in orders: ${walkInConfig ? "on" : "off"}, photos and stock: ${config.quoteCatalogue ? "on" : "off"}, branches: ${config.quoteBranches ? "on" : "off"}, chat sign-up: ${chatSignup && quoteBusinesses ? "on" : "off"})`,
  );
});
