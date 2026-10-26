import type { EntityType, RegistryResult } from "./store.js";

// Checks a business against the CAC register (Nigeria's Corporate Affairs
// Commission) through Dojah (dojah.io). There's no free official CAC API, so
// this is optional and only runs when Jay presses "Check with CAC" on the
// compliance page: each live check costs a little from the Dojah wallet. The
// sandbox (DOJAH_SANDBOX=true) is free and returns test data.
//
// Without Dojah, the compliance page links to the free public search at
// search.cac.gov.ng to check by hand.

export interface Registry {
  check(rcNumber: string, type: EntityType, typedName: string | null): Promise<RegistryResult>;
}

/** "Kahn Prints Ltd." and "KAHNPRINTS LIMITED" are the same name. */
export function sameBusinessName(a: string, b: string): boolean {
  const clean = (s: string) =>
    s
      .toUpperCase()
      .replace(/&/g, " AND ")
      .replace(/\b(LIMITED|LTD|PLC|NIGERIA|NIG|ENTERPRISES?|VENTURES?|GLOBAL|SERVICES?|COMPANY|CO|INTERNATIONAL|INTL)\b/g, " ")
      .replace(/[^A-Z0-9]/g, "");
  const x = clean(a);
  const y = clean(b);
  return x.length > 0 && x === y;
}

/** "RC 1234567", "rc-1234567" or "BN 3456789" -> "1234567". */
export function cleanRcNumber(text: string): string | null {
  const digits = text.replace(/^\s*(rc|bn|it)[\s:.-]*/i, "").replace(/\D/g, "");
  return /^\d{4,9}$/.test(digits) ? digits : null;
}

const DOJAH_TYPES: Record<EntityType, string | null> = { company: "COMPANY", business_name: "BUSINESS_NAME", individual: null };

export function createDojahRegistry(opts: { appId: string; secretKey: string; sandbox?: boolean; fetch?: typeof fetch }): Registry {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.sandbox ? "https://sandbox.dojah.io" : "https://api.dojah.io";
  return {
    async check(rcNumber, type, typedName) {
      const provider = opts.sandbox ? "Dojah (sandbox: test data)" : "Dojah";
      const empty = { found: false, name: null, status: null, type: null, registeredOn: null, address: null, people: [], nameMatches: null, provider };
      const companyType = DOJAH_TYPES[type];
      if (!companyType) return { ...empty, error: "Individuals aren't on the CAC register." };
      const params = new URLSearchParams({ rc_number: rcNumber, company_type: companyType });
      const res = await doFetch(`${base}/api/v1/kyc/cac/advance?${params}`, {
        headers: { Authorization: opts.secretKey, AppId: opts.appId },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 404) return { ...empty, error: "No company with that number on the CAC register." };
      if (res.status === 402) return { ...empty, error: "The Dojah wallet is empty. Top it up at dojah.io." };
      if (res.status === 401) return { ...empty, error: "Dojah refused the keys. Check DOJAH_APP_ID and DOJAH_SECRET_KEY on Railway." };
      if (!res.ok) return { ...empty, error: `Dojah answered ${res.status}. Try again later.` };
      const body = (await res.json().catch(() => ({}))) as { entity?: Record<string, unknown> };
      const e = body.entity;
      if (!e) return { ...empty, error: "Dojah sent back no company." };
      const text = (k: string) => (typeof e[k] === "string" && e[k] ? (e[k] as string) : null);
      const name = text("company_name");
      const affiliates = Array.isArray(e.affiliates) ? (e.affiliates as Array<Record<string, unknown>>) : [];
      return {
        found: true,
        name,
        status: text("status"),
        type: text("type_of_company"),
        registeredOn: text("date_of_registration")?.slice(0, 10) ?? null,
        address: [text("address"), text("city"), text("state")].filter(Boolean).join(", ") || null,
        people: affiliates
          .slice(0, 12)
          .map((a) => `${[a.first_name, a.last_name].filter((x) => typeof x === "string").join(" ")}${typeof a.affiliate_type === "string" ? ` (${a.affiliate_type.toLowerCase()})` : ""}`)
          .filter((p) => p.trim().length > 0),
        nameMatches: name && typedName ? sameBusinessName(name, typedName) : null,
        provider,
      };
    },
  };
}
