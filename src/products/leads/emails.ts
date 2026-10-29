import type { AccountFacts, Series } from "../../core/email/series.js";

// The lead qualifier's emails to the realtor (copy approved by Jay,
// marketing/email/EMAILS.md). Jay adds these contacts by hand at hand-over
// (docs/EMAILS.md). The lead qualifier serves one business, from Railway
// settings, so there is nothing to look up in the database.

export interface LeadsEmailFacts extends AccountFacts {
  business: string;
  botNumber: string | null;
}

export function leadsEmails(facts: () => Promise<LeadsEmailFacts>): Series<LeadsEmailFacts> {
  const number = (f: LeadsEmailFacts) => f.botNumber ?? "your lead assistant's number";
  const eyebrow = "Property leads";
  return {
    facts: () => facts(),
    emails: [
      {
        key: "L1",
        day: 0,
        content: (f, name) => ({
          eyebrow,
          subject: "Your lead assistant is answering enquiries",
          preview: "Every enquiry gets the same questions. You call the hot ones.",
          hero: "property",
          blocks: [
            `Hi ${name},`,
            `${f.business}'s lead assistant is live on *${number(f)}*.`,
            "When someone asks about a property, it asks them, one or two at a time: buying or renting, what kind of property, which area, their budget, when they want to move, and how they'll pay. Voice notes work too.",
            "Each lead gets a score out of 100:",
            {
              list: [
                "*Hot* (70 or more): your agents get a WhatsApp alert with the answers and a tap-to-chat link.",
                "*Warm* (40 to 69) and *cold* (under 40): they get a summary and are told the team will send options.",
              ],
            },
            "Anyone can reply *agent* at any point to speak to a person, and your agents are alerted straight away.",
          ],
        }),
      },
      {
        key: "L2",
        day: 2,
        content: (f, name) => ({
          eyebrow,
          subject: "Put the number on every listing",
          preview: "More enquiries, and your agents only call the ready ones.",
          blocks: [
            `Hi ${name},`,
            `Because every enquiry gets the same questions, you can share ${number(f)} widely without your agents drowning in "how much?" chats.`,
            "Put it on:",
            { list: ["Every listing on property sites", "Instagram and TikTok bios and captions", `Sign boards and banners at the property ("WhatsApp ${number(f)}")`, "Printed flyers and the back of business cards"] },
          ],
        }),
      },
      {
        key: "L3",
        day: 4,
        content: (f, name) => ({
          eyebrow: "Tip for your ads",
          subject: "Click-to-WhatsApp ads for listings",
          preview: "Name the property in the first message.",
          hero: "chat",
          blocks: [
            `Hi ${name},`,
            "If you advertise listings on Facebook or Instagram, send people to WhatsApp, not a website.",
            {
              steps: [
                ["Choose the goal", "In Meta Ads Manager, choose *Engagement* (or Messages), and *WhatsApp* as where people go."],
                ["Pick your number", `Choose *${number(f)}*.`],
                ["Name the property in the first message", '"Hi, I\'m interested in the 3-bedroom in Lekki." Your agents see which ad the lead came from.'],
              ],
            },
            { note: ["Worth knowing:", "chats that start from these ads can be answered free for 72 hours. Judge each ad by how many hot leads it brings, not clicks."] },
          ],
        }),
      },
      {
        key: "L4",
        day: 7,
        content: (f, name) => ({
          eyebrow,
          subject: "Your 10 latest leads, any time",
          preview: "And what to do with warm ones.",
          blocks: [
            `Hi ${name},`,
            `Agents can send *leads* to ${number(f)} to see the 10 latest enquiries with their scores.`,
            'Warm leads are worth a message within a week. Many are waiting on a mortgage or a move date, and a short "we have new options in your area" brings them back.',
          ],
        }),
      },
      {
        key: "L5",
        day: 21,
        content: (_f, name) => ({
          eyebrow,
          subject: "What your lead assistant will never do",
          preview: "So your agents stay in charge of every promise.",
          blocks: [
            `Hi ${name},`,
            "Your assistant asks questions and passes leads on. It never:",
            { list: ["quotes a price", "says a property is available", "promises a viewing time"] },
            "Those always come from your agents, so nothing is promised that your team didn't agree to.",
            "If you'd like the questions changed for the kind of properties you sell, reply to this email.",
          ],
        }),
      },
    ],
  };
}
