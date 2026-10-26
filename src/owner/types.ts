import type { Context } from "hono";
import type { InboxStore } from "../core/inbox/store.js";
import type { MessageStore } from "../core/db/store.js";
import type { HealthReport } from "../core/health.js";
import type { Product } from "../core/product.js";
import type { WhatsAppClient } from "../core/whatsapp/client.js";
import type { BoardStore } from "../products/quote/board.js";
import type { PlanFeatures } from "../products/quote/features.js";
import type { AppUser, BusinessData, DeliverySetupStore, PriceStore } from "./store.js";

/** One quote business as the app sees it. Built by the server for whoever is logged in. */
export interface AppBusiness {
  id: string;
  name: string;
  orderPrefix: string;
  /** Business #1 on the main number: its name and details come from Railway variables, not the app. */
  fromEnv: boolean;
  /** The WhatsApp Phone number ID its chats are on. */
  numberId: string;
  /** The main number also has old messages saved without a number. */
  includeUnnumbered: boolean;
  features?: PlanFeatures;
  board: BoardStore;
  prices: PriceStore;
  /** Product photos (QUOTE_CATALOGUE); without it the photo box is hidden. */
  photos?: {
    savePhoto(productId: string, data: Uint8Array, mimeType: string): Promise<void>;
    photo(path: string): Promise<{ data: Uint8Array; mimeType: string } | null>;
  };
  /** Riders and zones (QUOTE_DELIVERY); without it the page explains how to switch delivery on. */
  delivery?: DeliverySetupStore;
  data: BusinessData;
  logo(): Promise<Uint8Array | null>;
  saveLogo(data: Uint8Array, mimeType: string): Promise<void>;
  /** Marks an order paid and sends the customer's receipt, like "paid KP-1001" on WhatsApp. */
  markPaid?(orderNumber: number): Promise<boolean>;
  /** The business's own bot with test orders kept in memory, for "Test your bot". */
  testBot?(): Product;
  /** Bot messages sent this month and the plan's allowance (null = no cap). */
  botMessages?(): Promise<{ sent: number; limit: number | null } | null>;
  /** Pay links (Paystack) on its invoices, and yarnOga's fee on them in hundredths of a percent. */
  payLinks?: { on: boolean; feeBasisPoints(): Promise<number> };
}

/** Banks from Paystack, to pick from and check account names. Optional. */
export interface BankDirectory {
  banks(): Promise<Array<{ name: string; code: string }>>;
  /** The account's name as the bank has it, or null when the number isn't found. */
  resolve(accountNumber: string, bankCode: string): Promise<string | null>;
}

export interface OwnerAppDeps {
  /** Signs login cookies. The WhatsApp app secret is used, like the other signed links. */
  secret: string;
  /** e.g. https://app.yarnoga.com, used in links. */
  publicUrl: string;
  users: import("./store.js").UserStore;
  business(id: string): Promise<AppBusiness | null>;
  inbox?: { store: InboxStore; messages: MessageStore; whatsapp: WhatsAppClient };
  health?: () => Promise<HealthReport>;
  healthLabels?: Record<string, string>;
  banks?: BankDirectory;
  support: { email: string; waNumber?: string };
  /** Test questions each business may ask a day (each is a small AI cost). Default 60. */
  botTestsPerDay?: number;
  now?: () => Date;
  log?: Pick<Console, "info" | "warn" | "error">;
}

export type Env = { Variables: { user: AppUser; biz: AppBusiness; others: Array<{ userId: string; name: string }> } };
export type AppContext = Context<Env>;
