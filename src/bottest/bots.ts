import type { SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "../config.js";
import type { Product } from "../core/product.js";
import { createLeadQualifier } from "../products/leads/index.js";
import { createClaudeLeadUnderstander } from "../products/leads/understand.js";
import { createQuoteProduct } from "../products/quote/index.js";
import {
  createSupabaseBranding,
  createSupabaseBusinesses,
  createSupabaseCatalog,
  DEFAULT_BUSINESS_ID,
  type BusinessStore,
  type QuoteBusiness,
} from "../products/quote/store.js";
import { createClaudeUnderstander } from "../products/quote/understand.js";
import type { TestBotId } from "./questions.js";
import { TEST_OWNER, memoryLeadStore, memoryOrderStore, readOnlyBranding } from "./sandbox.js";

// The bots the test screen can try: the same code and AI as the live bots,
// with the real price list, but quotes, orders and leads kept in memory. The
// owner and agents are pretend numbers, so the screen can show "the owner
// would be alerted" while nothing reaches a real person.

/** A business the owner can pick on the screen (quote bot with several businesses). */
export interface TestBusiness {
  id: string;
  name: string;
  /** False for a business that isn't switched on yet: testing it first is the point. */
  live: boolean;
}

export interface TestBots {
  /** Makes a fresh bot. `business` is a business id for the quote bot; ignored by the others. */
  make: Partial<Record<TestBotId, (business?: string) => Promise<Product>>>;
  /** The businesses to choose from, when the quote bot runs several. */
  businesses?: () => Promise<TestBusiness[]>;
}

export function createTestBots(
  db: SupabaseClient,
  config: Pick<Config, "quote" | "leads" | "quoteBusinesses">,
  /** Tests swap in their own list of businesses. */
  businessStore?: BusinessStore,
): TestBots {
  const bots: TestBots = { make: {} };
  const multi = config.quoteBusinesses;
  const store = multi ? (businessStore ?? createSupabaseBusinesses(db)) : undefined;

  /** Business #1 from Railway settings, as the main number answers. */
  const main = config.quote;
  const mainBot = main
    ? (() => {
        const businessId = multi ? DEFAULT_BUSINESS_ID : undefined;
        const catalog = createSupabaseCatalog(db, businessId);
        const branding = readOnlyBranding(createSupabaseBranding(db, businessId));
        const ai = createClaudeUnderstander({
          apiKey: main.anthropicApiKey,
          model: main.model,
          businessName: main.businessName,
          description: main.businessDescription,
        });
        return () =>
          createQuoteProduct({
            businessName: main.businessName,
            orderPrefix: main.orderPrefix,
            ownerWaId: TEST_OWNER,
            businessDetails: main.businessDetails,
            paymentDetails: main.paymentDetails,
            catalog,
            branding,
            orders: memoryOrderStore(),
            ai,
          });
      })()
    : undefined;

  /** Any business from the quote_businesses table, set up the way the router sets it up. */
  const businessBot = (business: QuoteBusiness, apiKey: string, model: string) =>
    createQuoteProduct({
      businessName: business.name,
      orderPrefix: business.orderPrefix,
      ownerWaId: TEST_OWNER,
      businessDetails: business.businessDetails ?? undefined,
      paymentDetails: business.paymentDetails ?? undefined,
      catalog: createSupabaseCatalog(db, business.id),
      branding: readOnlyBranding(createSupabaseBranding(db, business.id)),
      orders: memoryOrderStore(),
      ai: createClaudeUnderstander({
        apiKey,
        model,
        businessName: business.name,
        description: business.description ?? undefined,
      }),
    });

  if (mainBot || (multi && store)) {
    bots.make.quote = async (businessId) => {
      if (multi && store && businessId && !(mainBot && businessId === DEFAULT_BUSINESS_ID)) {
        const business = await store.get(businessId);
        if (!business) throw new UnknownBusinessError();
        return businessBot(business, multi.anthropicApiKey, multi.model);
      }
      if (!mainBot) throw new UnknownBusinessError();
      return mainBot();
    };
  }
  if (multi && store) {
    bots.businesses = async () =>
      (await store.list()).map((b) => ({
        id: b.id,
        // Business #1's name comes from Railway settings, as on the main number.
        name: b.id === DEFAULT_BUSINESS_ID && main ? main.businessName : b.name,
        live: b.active,
      }));
  }

  const leads = config.leads;
  if (leads) {
    const ai = createClaudeLeadUnderstander({
      apiKey: leads.anthropicApiKey,
      model: leads.model,
      businessName: leads.businessName,
    });
    bots.make.leads = async () =>
      createLeadQualifier({
        store: memoryLeadStore(),
        ai,
        businessName: leads.businessName,
        agentWaIds: [TEST_OWNER],
      });
  }

  return bots;
}

/** The chosen business doesn't exist (any more). */
export class UnknownBusinessError extends Error {
  constructor() {
    super("unknown business");
  }
}
