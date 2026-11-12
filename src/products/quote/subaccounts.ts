// Each shop's Paystack subaccount, made automatically from the bank account
// the owner put on invoices in the owner app. Pay links pay out to it, so
// nobody has to make one by hand in the Paystack dashboard.
import type { SupabaseClient } from "@supabase/supabase-js";

export interface SubaccountMaker {
  createSubaccount(p: {
    businessName: string;
    bankCode: string;
    accountNumber: string;
  }): Promise<string>;
}

/**
 * The shop's subaccount code: the saved one, or a new one made from its invoice
 * bank account (and saved). Null when the shop has no invoice bank account Paystack knows.
 */
export function createSubaccounts(
  db: SupabaseClient,
  paystack: SubaccountMaker,
) {
  async function get(businessId: string): Promise<string | null> {
    const { data: biz, error } = await db
      .from("quote_businesses")
      .select("name, paystack_subaccount")
      .eq("id", businessId)
      .maybeSingle();
    if (error) throw new Error(`subaccount lookup failed: ${error.message}`);
    if (biz?.paystack_subaccount) return biz.paystack_subaccount as string;
    const { data: bank, error: bankError } = await db
      .from("quote_bank_accounts")
      .select("bank_code, account_number")
      .eq("business_id", businessId)
      .eq("is_primary", true)
      .maybeSingle();
    if (bankError)
      throw new Error(`invoice bank lookup failed: ${bankError.message}`);
    if (!biz || !bank?.bank_code) return null;
    const code = await paystack.createSubaccount({
      businessName: biz.name as string,
      bankCode: bank.bank_code as string,
      accountNumber: bank.account_number as string,
    });
    // Only if still empty, so two orders at once keep the same subaccount.
    const { error: saveError } = await db
      .from("quote_businesses")
      .update({ paystack_subaccount: code })
      .eq("id", businessId)
      .is("paystack_subaccount", null);
    if (saveError)
      throw new Error(`saving the subaccount failed: ${saveError.message}`);
    return code;
  }

  /** Drops a saved code Paystack refused, so the next link makes a fresh one. False when there's no bank account to make it from. */
  async function forget(businessId: string): Promise<boolean> {
    const { data, error } = await db
      .from("quote_bank_accounts")
      .select("bank_code")
      .eq("business_id", businessId)
      .eq("is_primary", true)
      .maybeSingle();
    if (error) throw new Error(`invoice bank lookup failed: ${error.message}`);
    if (!data?.bank_code) return false;
    const { error: clearError } = await db
      .from("quote_businesses")
      .update({ paystack_subaccount: null })
      .eq("id", businessId);
    if (clearError)
      throw new Error(`clearing the subaccount failed: ${clearError.message}`);
    return true;
  }

  return { get, forget };
}
