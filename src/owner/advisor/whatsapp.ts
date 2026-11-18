import type { Product } from "../../core/product.js";
import { welcomeAsk } from "../../products/quote/welcome.js";
import { lockToPlan } from "../plan-locks.js";
import type { LoginBusiness } from "../whatsapp.js";
import type { AppBusiness } from "../types.js";
import { advisorTexts, answerText, ask, isQuestion, QUESTIONS } from "./index.js";

// The business advisor on WhatsApp. The owner sends "advice" to their bot and
// gets the five questions as a tappable list; a tap ("advice shop") gets the
// answer. Only the owner's own number is answered: anyone else's "advice"
// goes to the bot as usual. It wraps the quote bot without changing it.

export const ADVICE_COMMAND = /^\s*(advice|advise|advisor|adviser|business advice|business advisor|conseil|conseils)\s*[.!?]?\s*$/i;
const ADVICE_PICK = /^\s*advice\s+([a-z]+)\s*$/i;

export function withAdvisor(
  bot: Product,
  opts: {
    /** The business answering on this number, and its owner (as for "app"). */
    businessFor(numberId: string | undefined, from: string): Promise<LoginBusiness | null>;
    business(id: string): Promise<AppBusiness | null>;
    now?: () => Date;
    log?: Pick<Console, "info" | "error">;
  },
): Product {
  const log = opts.log ?? console;

  /** The owner's business with the advisor switched on, or null when this isn't the owner. */
  async function ownersBusiness(numberId: string | undefined, from: string): Promise<AppBusiness | null> {
    const found = await opts.businessFor(numberId, from);
    if (!found?.ownerWaId || found.ownerWaId !== from) return null;
    const biz = await opts.business(found.id);
    return biz?.advisor ? biz : null;
  }

  return {
    name: bot.name,
    async handle(msg, ctx) {
      const text = msg.type === "text" ? (msg.text ?? "") : "";
      const pick = text.match(ADVICE_PICK)?.[1]?.toLowerCase();
      const asked = ADVICE_COMMAND.test(text) || isQuestion(pick);
      const menu = /^\s*menu\s*$/i.test(text) || welcomeAsk(text) === "help";
      if (!asked && !menu) return bot.handle(msg, ctx);

      let biz: AppBusiness | null = null;
      try {
        biz = await ownersBusiness(msg.businessNumberId, msg.from);
      } catch (err) {
        log.error("Business advisor: couldn't find the business:", err);
      }
      if (!biz) return bot.handle(msg, ctx);
      const onPlan = (await lockToPlan(biz)).advisor;
      const fr = biz.language === "fr";

      // The owner's command list gets an "advice" line.
      if (menu) {
        const reply = await bot.handle(msg, ctx);
        if (!onPlan || !reply?.text.includes("• *app*")) return reply;
        const line = fr ? "• *advice* : des questions sur votre boutique, avec vos propres ventes" : "• *advice*: questions about your shop, answered from your own sales";
        return { ...reply, text: reply.text.replace("• *app*", `${line}\n• *app*`) };
      }

      if (!onPlan) {
        return { text: fr ? "Le conseiller d'entreprise est inclus à partir de la formule Pro. Envoyez *plan* pour changer de formule." : "The business advisor comes with Pro and above. Send *plan* to upgrade." };
      }
      if (!isQuestion(pick)) {
        const t = advisorTexts(biz.language);
        return {
          text: "",
          list: {
            body: fr ? "Que voulez-vous savoir sur votre boutique ? Les réponses viennent de vos propres ventes." : "What would you like to know about your shop? Answers come from your own sales.",
            button: fr ? "Poser une question" : "Ask a question",
            rows: QUESTIONS.map((q) => ({ id: `advice ${q}`, title: t.title[q], description: t.hint[q] })),
          },
        };
      }
      try {
        const { answer, left } = await ask(biz, biz.advisor!, pick, opts.now?.() ?? new Date(), log);
        log.info(`Business advisor: ${biz.name} asked "${pick}" on WhatsApp`);
        return { text: answerText(biz, answer, left) };
      } catch (err) {
        log.error(`Business advisor: "${pick}" for ${biz.name} failed:`, err);
        return { text: fr ? "Je n'ai pas pu lire vos chiffres pour le moment. Réessayez dans quelques minutes." : "I couldn't read your figures just now. Please try again in a few minutes." };
      }
    },
  };
}
