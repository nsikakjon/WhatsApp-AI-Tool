import type { SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "../config.js";
import type { Product } from "../core/product.js";
import { createLeadQualifier } from "../products/leads/index.js";
import { createClaudeLeadUnderstander } from "../products/leads/understand.js";
import { createQuoteProduct } from "../products/quote/index.js";
import { createSupabaseBranding, createSupabaseCatalog } from "../products/quote/store.js";
import { createClaudeUnderstander } from "../products/quote/understand.js";
import type { TestBotId } from "./questions.js";
import { TEST_OWNER, memoryLeadStore, memoryOrderStore, readOnlyBranding } from "./sandbox.js";

// The bots the test screen can try: the same code and AI as the live bots,
// with the real price list, but quotes, orders and leads kept in memory. The
// owner and agents are pretend numbers, so the screen can show "the owner
// would be alerted" while nothing reaches a real person.

export type TestBots = Partial<Record<TestBotId, () => Product>>;

export function createTestBots(db: SupabaseClient, config: Pick<Config, "quote" | "leads">): TestBots {
  const bots: TestBots = {};

  const quote = config.quote;
  if (quote) {
    const catalog = createSupabaseCatalog(db);
    const branding = readOnlyBranding(createSupabaseBranding(db));
    const ai = createClaudeUnderstander({
      apiKey: quote.anthropicApiKey,
      model: quote.model,
      businessName: quote.businessName,
    });
    bots.quote = () =>
      createQuoteProduct({
        businessName: quote.businessName,
        orderPrefix: quote.orderPrefix,
        ownerWaId: TEST_OWNER,
        businessDetails: quote.businessDetails,
        paymentDetails: quote.paymentDetails,
        catalog,
        branding,
        orders: memoryOrderStore(),
        ai,
      });
  }

  const leads = config.leads;
  if (leads) {
    const ai = createClaudeLeadUnderstander({
      apiKey: leads.anthropicApiKey,
      model: leads.model,
      businessName: leads.businessName,
    });
    bots.leads = () =>
      createLeadQualifier({
        store: memoryLeadStore(),
        ai,
        businessName: leads.businessName,
        agentWaIds: [TEST_OWNER],
      });
  }

  return bots;
}
