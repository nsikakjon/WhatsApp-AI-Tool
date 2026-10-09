import { createHmac, timingSafeEqual } from "node:crypto";

// Meta signs every webhook with your app secret and sends the result in the
// X-Hub-Signature-256 header as "sha256=<hex>". We recompute it from the exact
// raw request body and compare. If it doesn't match, the request didn't come
// from Meta (or was tampered with) and must be rejected.
export function isValidSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;

  const received = Buffer.from(signatureHeader.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();

  // timingSafeEqual throws on length mismatch, so check that first.
  return received.length === expected.length && timingSafeEqual(received, expected);
}
