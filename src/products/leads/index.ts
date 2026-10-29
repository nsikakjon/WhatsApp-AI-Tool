import type { Product, Reply } from "../../core/product.js";
import {
  EMPTY_DETAILS,
  QUESTIONS,
  describeDetails,
  isComplete,
  missingFields,
  scoreLead,
  temperatureLabel,
  type LeadDetails,
} from "./qualify.js";
import type { Lead, LeadStore, LeadUpdate } from "./store.js";
import type { LeadUnderstander, Understanding } from "./understand.js";
import { isPhoneNumber, showWaId } from "../../core/whatsapp/ids.js";

// The real estate lead qualifier.
//
// 1. Someone messages the leads number about a property. The bot asks what
//    they want: buy or rent, property type, area, budget, timeline, and how
//    they'll pay. Typed messages and voice notes both work.
// 2. Each answer is saved and the lead gets a score out of 100 (worked out in
//    code, see qualify.ts): hot, warm or cold.
// 3. Agents get a WhatsApp alert the moment a lead turns hot (all questions
//    answered and a high score) or asks to speak to someone. Each lead alerts
//    once; after that, anything else they send is passed on to the agents.
// 4. Agents can text "leads" to see the latest enquiries.

export interface LeadQualifierOptions {
  store: LeadStore;
  ai: LeadUnderstander;
  businessName: string;
  /** WhatsApp numbers of the agents who get hot-lead alerts. */
  agentWaIds: string[];
  log?: Pick<Console, "info" | "error">;
}

const LEADS_LIST_SIZE = 10;

export function createLeadQualifier(opts: LeadQualifierOptions): Product {
  const log = opts.log ?? console;
  const agents = new Set(opts.agentWaIds);

  return {
    name: "leads",

    async handle(msg, ctx): Promise<Reply | null> {
      const command = msg.type === "text" ? msg.text?.trim().toLowerCase() : undefined;
      if (agents.has(msg.from) && command === "leads") {
        return { text: formatLeadList(await opts.store.recentLeads(LEADS_LIST_SIZE)) };
      }

      if (msg.type === "audio" && !msg.text) {
        return { text: "Sorry, I couldn't make out that voice note. Could you type your message instead?" };
      }
      const text = msg.type === "text" || msg.type === "audio" ? msg.text?.trim() : msg.caption?.trim();
      if (!text) {
        return { text: "I can read text messages and voice notes. Please tell me what kind of property you're looking for." };
      }

      const existing = await opts.store.findLead(msg.from);
      const known: LeadDetails = existing ? pickDetails(existing) : { ...EMPTY_DETAILS };
      if (!known.name && msg.contactName) known.name = msg.contactName;
      const handedOff = existing?.alertedAt != null;

      let understood: Understanding | null = null;
      try {
        understood = await opts.ai.understand({ text, history: ctx.history, known, missing: missingFields(known), handedOff });
      } catch (err) {
        log.error(`Lead AI failed for message ${msg.waMessageId}:`, err);
      }

      const details = understood ? merge(known, understood.details) : known;
      const wantsAgent = (existing?.wantsAgent ?? false) || (understood?.wantsAgent ?? false);
      const { score, temperature } = scoreLead(details, wantsAgent);
      const complete = isComplete(details);
      const update: LeadUpdate = {
        ...details,
        wantsAgent,
        score,
        temperature,
        status: handedOff ? "handed_off" : complete ? "qualified" : "qualifying",
      };
      const lead = await opts.store.saveLead(msg.from, update);

      // Already with an agent: pass the message on, and keep chatting.
      if (handedOff) {
        return {
          text: understood?.message || "Thanks, I've passed that on to the agent handling your enquiry.",
          notify: opts.agentWaIds.map((to) => ({ to, text: `💬 ${who(lead)} wrote:\n"${text}"\n${chatLink(lead.waId)}` })),
        };
      }

      if ((temperature === "hot" && complete) || wantsAgent) {
        if (await opts.store.claimAlert(lead.id)) {
          log.info(`Lead ...${lead.waId.slice(-4)} handed to agents (${temperature}, score ${score})`);
          return {
            text: handoffMessage(lead, opts.businessName),
            notify: opts.agentWaIds.map((to) => ({ to, text: agentAlert(lead) })),
          };
        }
      }

      if (complete && existing?.status !== "qualified") {
        return { text: summaryMessage(lead, opts.businessName) };
      }

      return { text: understood?.message || nextQuestion(details) };
    },
  };
}

function pickDetails(l: Lead): LeadDetails {
  return {
    name: l.name,
    purpose: l.purpose,
    propertyType: l.propertyType,
    location: l.location,
    budgetKobo: l.budgetKobo,
    timeline: l.timeline,
    financing: l.financing,
  };
}

/** New answers replace old ones; anything not mentioned this time is kept. */
function merge(known: LeadDetails, found: LeadDetails): LeadDetails {
  const out = { ...known };
  for (const key of Object.keys(found) as Array<keyof LeadDetails>) {
    if (found[key] !== null) (out as Record<string, unknown>)[key] = found[key];
  }
  return out;
}

function nextQuestion(d: LeadDetails): string {
  const field = missingFields(d)[0];
  return QUESTIONS.find((q) => q.field === field)?.ask ?? "Thanks! Is there anything else you'd like the agent to know?";
}

function who(l: Lead): string {
  return `${l.name ?? "A lead"} (${showWaId(l.waId)})`;
}

function chatLink(waId: string): string {
  return isPhoneNumber(waId) ? `Chat: https://wa.me/${waId}` : "They hid their number, so reply through the bot's WhatsApp number.";
}

export function agentAlert(l: Lead): string {
  const lines = [
    `${temperatureLabel(l.temperature)} lead, score ${l.score}/100`,
    `Name: ${l.name ?? "not given"}`,
    `WhatsApp: +${l.waId}`,
    ...describeDetails(l),
  ];
  if (l.wantsAgent) lines.push("Asked to speak to an agent / book a viewing");
  const missing = missingFields(l);
  if (missing.length) lines.push(`Not answered yet: ${missing.join(", ")}`);
  lines.push(chatLink(l.waId));
  return lines.join("\n");
}

function handoffMessage(l: Lead, businessName: string): string {
  const thanks = l.name ? `Thank you, ${l.name}!` : "Thank you!";
  const summary = describeDetails(l);
  return [
    `${thanks} An agent from ${businessName} will contact you shortly on this number.`,
    ...(summary.length ? ["", "Here's what I've noted:", ...summary.map((s) => `• ${s}`)] : []),
  ].join("\n");
}

function summaryMessage(l: Lead, businessName: string): string {
  return [
    `Thank you${l.name ? `, ${l.name}` : ""}! Here's what I've noted:`,
    ...describeDetails(l).map((s) => `• ${s}`),
    "",
    `The ${businessName} team will send you options that match. If anything above is wrong, just tell me. Reply "agent" any time to speak to someone.`,
  ].join("\n");
}

export function formatLeadList(leads: Lead[]): string {
  if (!leads.length) return "No leads yet.";
  const rows = leads.map((l, i) => {
    const what = [l.purpose, l.propertyType, l.location].filter(Boolean).join(", ") || "no details yet";
    return `${i + 1}. ${temperatureLabel(l.temperature)} ${l.score}/100 · ${l.name ?? "No name"} (+${l.waId})\n   ${what}`;
  });
  return [`*Latest ${leads.length} leads*`, ...rows].join("\n");
}
