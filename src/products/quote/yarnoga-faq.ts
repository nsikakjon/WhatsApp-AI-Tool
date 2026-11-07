// Answers to questions about yarnOga itself on the quotes number: who we are,
// what we do, whether it's a bot, what it costs. Written in code, not by the
// AI, so the bot never makes up facts about the company or lets slip anything
// private (the founder's number, costs, the tools behind it, bank or
// registration details). Questions about the demo shop's products still go to
// the shop.

const WHO =
  "who (are|r) (you|u|una|you guys)|who (is|s) (this|dis|speaking)|who be (this|dis|you)|who (una|you|u) be|who (am i|i dey) (talking|chatting|speaking|talk|chat) (to|with)" +
  "|what (is|s) (this|yarnoga|yarn oga)|whats (this|yarnoga)|what (company|business|firm) is (this|dis)" +
  "|what (does|do) (your|ur|the|una) (company|firm|business|organisation|organization) do|what (do|does) (you|u|una|yarnoga) do" +
  "|wetin (una|you|u|yarnoga) dey do|tell me (more )?about (you|yourself|yourselves|yarnoga|your company|this company)";
const BOT = "(are|r) (you|u) (a |an )?(bot|robot|human|real person|real|person|machine|ai)|is (this|dis) (a |an )?(bot|robot|human|real person|machine|ai)|(am i|i dey) (talking|chatting|talk|chat) (to|with) (a |an )?(bot|robot|human|person|machine|ai)";
const OWNER = "who (owns|runs|built|made|created|founded|started|is behind|dey behind) (you|this|yarnoga|the company|this company|una)|who (is|s) (the|your|ur) (owner|founder|ceo|md|boss)";
const WHERE = "where (are|r|is) (you|u|una|yarnoga|your office|your company)( guys)? (located|based|from|situated)?|where (is|s) (your|ur) (office|company|location)|wey una dey|where una dey";
const COST =
  "how much (is|does) (yarnoga|this bot|the bot|this service|your service|it cost)|how much (do|does) (you|yarnoga) charge|how much (to|does it cost to) (use|start|sign up|join|get)" +
  "|is (it|this|yarnoga|the bot|sign ?up) free|(what are )?(your|ur) (plans|pricing|subscription|fees?|charges)";
const HOW = "how (does|do) (it|this|yarnoga|the bot|una) work|how (do|can) i (get|start|sign up|use|join|start using)( it| this| yarnoga| a bot| my own bot)?|how to (get started|sign up|join|start|get my own bot)";
const SAFE = "is (this|it|yarnoga|una) (legit|legitimate|real|safe|genuine|a scam|scam)|(are|r) (you|u|una) (legit|legitimate|real|genuine|a scam|scammers?)";
const OFFER =
  "(are|r) (you|u|una) (interested|intrested)|would (you|u|una) be (interested|intrested)|(you|u|una) (dey|go) (interested|intrested)" +
  "|i have (a|an) (business )?(proposal|offer|deal)|business (proposal|offer)|can we (partner|collaborate|work together)|(want|like) to (partner|collaborate) with (you|u|una|yarnoga)";
const PRIVATE =
  "(owner|founder|ceo|md|boss|oga)( s|s)? (phone |whatsapp |personal )?(number|line|contact|phone)" +
  "|(what|which) (ai|model|api|server|database|tech|technology|software|tools?|platform) (do|does|are) (you|u|yarnoga|una|it) (use|using|run on|built on|built with)" +
  "|are you (chat ?gpt|gpt|gemini|meta ai|claude)|what are you built (on|with)";

const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const asked = (pattern: string) => new RegExp(`(^|\\b)(${pattern})(\\b|$)`);

const ANSWERS: Array<[RegExp, string]> = [
  [
    asked(PRIVATE),
    "Sorry, I can't share that here. Ask me anything else about yarnOga, or send *sign up* to get your own assistant.",
  ],
  [
    asked(OWNER),
    "yarnOga is run by YarnOga Africa Ventures, a Nigerian company. We build WhatsApp assistants that help businesses sell and serve their customers.",
  ],
  [
    asked(SAFE),
    "Yes. yarnOga is a registered Nigerian business, YarnOga Africa Ventures. We never ask for your bank PIN, OTP or passwords in chat.",
  ],
  [
    asked(BOT),
    "I'm an AI assistant, not a person. When a business uses yarnOga, the assistant answers with the business's own prices, and the owner or staff can take over any chat at any time.",
  ],
  [
    asked(WHERE),
    "We're a Nigerian company based in Lagos. Everything works on WhatsApp and online, so a business anywhere can use yarnOga from a phone.",
  ],
  [
    asked(COST),
    "It's free to start, and no card is needed. Paid plans add more orders, AI replies and features as your business grows. You can see every plan on yarnoga.com.",
  ],
  [
    asked(HOW),
    "Send *sign up*, tell me your business name and your prices (typed, a voice note or a photo of your price list), and I set up your assistant here in about 5 minutes. " +
      "It then answers your customers on WhatsApp, sends quotes and invoices, and takes orders and payments.",
  ],
  [
    asked(OFFER),
    "No, thank you. You're chatting with the yarnOga quote bot, an AI assistant that answers customers, sends quotes and takes orders for businesses on WhatsApp.",
  ],
  [
    asked(WHO),
    "I'm yarnOga, a WhatsApp assistant for businesses, run by YarnOga Africa Ventures. We give a business an assistant that answers its customers, sends quotes and invoices, takes orders and payments, and keeps every order in one place.",
  ],
];

/** The fixed answer to a question about yarnOga, or null when the message isn't one. */
export function yarnOgaAnswer(text: string): string | null {
  const words = plain(text);
  if (!words || words.length > 120) return null;
  return ANSWERS.find(([pattern]) => pattern.test(words))?.[1] ?? null;
}
