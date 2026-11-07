// Spam (adult, betting, crypto, lottery or "claim your reward" offers) and
// requests for money or airtime. Both the yarnOga number and every business's
// bot answer these with a short fixed no, so the AI never plays along.

const BEGGING =
  "(send|give|dash|borrow|lend|loan) me (some |small )?(money|cash|airtime|data|recharge card|something|1k|2k|5k|10k)|(send|give|dash|borrow|lend|loan) me$|dash me" +
  "|help me (with )?(some |small )?(money|cash|transport fare|transport|airtime|data|food|school fees|rent|hospital bill)|(help|assist) me financially" +
  "|i need (some |small )?(money|cash|financial help|financial assistance|financial support)";
const SCAM =
  "porn|porno|xxx|nudes|sex (chat|video|videos)|hook ?up|onlyfans" +
  "|betting|bet9ja|sportybet|1xbet|betking|sure odds|booking code" +
  "|crypto|bitcoin|btc|usdt|forex|binary options|double your money|investment (plan|platform)" +
  "|lottery|jackpot|(you|u) (have |ve )?(just )?won (a |an |the )?(prize|reward|cash|money|jackpot|gift|phone|iphone|\\d)|claim (your |the )?(reward|prize|gift|bonus|winnings)";

const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const asked = (pattern: string) => new RegExp(`(^|\\b)(${pattern})(\\b|$)`);
const SPAM_RE = asked(SCAM);
const BEGGING_RE = asked(BEGGING);

export type Decline = "spam" | "begging";

/** Whether a customer's message is spam or a request for money, or null when it's neither. */
export function declineKind(text: string): Decline | null {
  const words = plain(text);
  if (SPAM_RE.test(words)) return "spam";
  if (BEGGING_RE.test(words)) return "begging";
  return null;
}
