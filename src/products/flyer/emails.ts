import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailContent } from "../../core/email/layout.js";
import type { AccountFacts, Series } from "../../core/email/series.js";
import { formatNaira } from "../../core/money.js";
import { PLANS, type PlanId } from "./plans.js";

// yarnOga Flyers' welcome and tip emails to group admins (copy approved by
// Jay, marketing/email/EMAILS.md). Day 0 is when the admin gives their email;
// the series stops once the group is on a paid plan. Plan prices come from
// flyer_plans. F8 is a guide to a newer feature, sent to paid groups too.

/** The public yarnOga Flyers number, as on the website. */
export const FLYERS_NUMBER = "0704 385 7494";

export interface FlyerEmailFacts extends AccountFacts {
  group: string;
  members: number;
  /** Most members on the group's plan; null for no limit. */
  memberLimit: number | null;
  /** When its free trial ends, while it's on one. */
  trialEnds: Date | null;
  /** Monthly price and price a month paid yearly, in kobo. */
  prices: Partial<Record<PlanId, { monthly: number | null; yearly: number | null; from: number | null }>>;
}

export function flyerEmails(facts: (groupId: string) => Promise<FlyerEmailFacts | null>): Series<FlyerEmailFacts> {
  const email = (e: Omit<EmailContent, "eyebrow">): EmailContent => ({ eyebrow: "Birthday flyers", ...e });
  const price = (f: FlyerEmailFacts, id: PlanId, members: string) => {
    const p = f.prices[id];
    const label = PLANS.find((x) => x.id === id)!.label;
    if (!p?.monthly) return null;
    return `*${label}:* ${formatNaira(p.monthly)} a month${p.yearly ? `, or ${formatNaira(p.yearly)} a month paid yearly` : ""}. ${members}`;
  };

  return {
    facts,
    emails: [
      {
        key: "F1",
        day: 0,
        content: (f, name) =>
          email({
            subject: `${f.group}'s birthday flyers are set up`,
            preview: "Logo, members, design. Then the bot does the rest.",
            hero: "flyers",
            blocks: [
              `Hi ${name},`,
              `Thanks for setting up *${f.group}* on yarnOga Flyers. On each member's birthday morning, we'll send you their finished flyer on WhatsApp, ready to forward to the group.`,
              "Three things to do this week:",
              {
                steps: [
                  ["Add your group logo", `Send it to ${FLYERS_NUMBER} with the caption *logo*. Send it as a document to keep a see-through background.`],
                  ["Add your members", "One by one in the chat, or all at once from a spreadsheet (more in the next email)."],
                  ["Pick a design", "Send *design* to see them all, and *see 8* to see design 8 full size."],
                ],
              },
              "Send *upcoming* any time to see the birthdays in the next 30 days.",
              "If anything is unclear, reply to this email. A person reads every message.",
            ],
          }),
      },
      {
        key: "F2",
        day: 1,
        when: (f) => f.members < 10,
        content: (f, name) =>
          email({
            subject: "The fastest way to add your whole group",
            preview: "One spreadsheet, every member saved.",
            blocks: [
              `Hi ${name},`,
              `${f.group} has ${f.members} member${f.members === 1 ? "" : "s"} saved so far. If you have a list somewhere, you can add everyone in one go (on Standard and above, and during your free trial).`,
              "Make a spreadsheet with three columns:",
              { list: ["*Name*", "*Birthday* (for example 14 March, or 14/03)", "*Photo* (optional: a link to the photo, such as a Google Drive link)"] },
              "Then send it to the bot as a CSV file, or send a Google Sheets link. The bot tells you who was saved and which rows it couldn't read.",
              "No photos yet? Save the members anyway. Their flyer still works without one, and you can add photos later.",
              "A tip from group admins who've done this: put a Google Form in the group asking for name, birthday and a photo, then send us the sheet the form fills in.",
            ],
          }),
      },
      {
        key: "F3",
        day: 3,
        content: (_f, name) =>
          email({
            subject: "Good photos make good flyers",
            preview: "One clear face. We'll do the rest.",
            blocks: [
              `Hi ${name},`,
              "The photo makes the flyer. What works best:",
              { list: ["One person, face clearly visible, looking at the camera", "Not a group photo, and not a photo of a photo", "Daylight is better than a dark room"] },
              "You don't need to edit anything. We centre the face, crop it and brighten it for you.",
              "If a flyer comes out with the face too close or too far, use Edit photo on that member: you can make it brighter, warmer, black and white, remove the background, or rotate it.",
            ],
          }),
      },
      {
        key: "F8",
        day: 4,
        afterStop: true,
        content: (_f, name) =>
          email({
            subject: "Fix a name or date with one message",
            preview: "No need to start the flyer again.",
            blocks: [
              `Hi ${name},`,
              `If a flyer comes out with a mistake, send the fix to ${FLYERS_NUMBER} in plain words. The bot changes it and sends the flyer again:`,
              {
                list: [
                  "*change amadi nnadozie to Amadi Nnadozie*: a member's name",
                  "*change Ada's birthday to 3 May*: a member's date",
                  "*change group name to Unilag Class of 2011*: the group name, on every flyer from now on",
                  "*change 4pm to 5pm*: the words on the last event flyer",
                ],
              },
              "Names typed all in small letters get their capitals when they're saved, so *amadi nnadozie* becomes *Amadi Nnadozie*. A name typed with capitals is kept exactly as you typed it, for names like *McDonald* or *Bakare-Ojo*.",
              "If you'd rather chat in Pidgin, send *pidgin* and the bot answers you in Pidgin. Send *english* to switch back. The flyers themselves stay in English.",
            ],
          }),
      },
      {
        key: "F4",
        day: 5,
        content: (_f, name) =>
          email({
            subject: "Forwarding takes five seconds",
            preview: "Why the bot sends the flyer to you, not to the group.",
            blocks: [
              `Hi ${name},`,
              "On each birthday morning the flyer comes to you. Here's the quickest way to share it:",
              {
                steps: [
                  ["Forward it", "Long-press the flyer, tap Forward, pick the group, tap Send."],
                  ["Tag the birthday person", "In the group, type @ and pick their name, so they get tagged."],
                ],
              },
              "Why doesn't the bot post in the group itself? WhatsApp doesn't allow business accounts to join ordinary groups. So we do the design, the message and the timing, and you do the one tap that needs a person.",
              "Send *today* to see today's flyers again if you missed one.",
            ],
          }),
      },
      {
        key: "F7",
        day: 6,
        when: (f) => f.trialEnds !== null || (f.memberLimit !== null && f.members >= f.memberLimit - 2),
        content: (f, name) => {
          const org = f.prices.organisation?.from;
          return email({
            subject: `${f.group} is growing`,
            preview: "Here's what each plan covers.",
            blocks: [
              `Hi ${name},`,
              f.trialEnds
                ? `Your free Standard trial ends on ${f.trialEnds.toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "Africa/Lagos" })}. After that, ${f.group} moves to the Free plan unless you upgrade.`
                : `${f.group} has ${f.members} members, close to the ${f.memberLimit} on your plan.`,
              "Plans, per group:",
              {
                list: [
                  "*Free:* up to 10 members",
                  price(f, "standard", "Up to 50 members."),
                  price(f, "premium", "Up to 500 members."),
                  price(f, "deluxe", "No member limit."),
                  org ? `*Organisation:* from ${formatNaira(org)} a month, agreed per organisation. For churches, alumni bodies and companies with many groups.` : null,
                ].filter((line): line is string => line !== null),
              },
              `Send *upgrade standard*, *upgrade premium* or *upgrade deluxe* to ${FLYERS_NUMBER}, or *plans* to compare. For Organisation, reply to this email.`,
            ],
          });
        },
      },
      {
        key: "F5",
        day: 7,
        content: (_f, name) =>
          email({
            subject: "Not just birthdays",
            preview: "Any photo, your logo, a flyer in seconds.",
            blocks: [
              `Hi ${name},`,
              "The same bot makes flyers for anything your group does. Send it a photo with a caption, and you get back a flyer with your logo and that caption.",
              "Groups use it for:",
              { list: ["Monthly meetings and reunions", "Thanksgiving and church programmes", "Weddings and naming ceremonies of members", "Condolence messages", "Congratulations: new job, graduation, new baby"] },
              "Send the photo, type the caption, and forward the flyer to the group.",
            ],
          }),
      },
      {
        key: "F6",
        day: 10,
        content: (_f, name) =>
          email({
            subject: "Know another group admin?",
            preview: "A message you can paste, if you'd like to.",
            blocks: [
              `Hi ${name},`,
              "If your members like the flyers, other admins they know will too: their church group, their old school set, their office.",
              "Here's a message you can paste anywhere, if you'd like:",
              { note: ["", `"Our group birthday flyers come from yarnOga. Every birthday morning the admin gets the flyer on WhatsApp, ready to forward. Free for groups of up to 10. Send HI to ${FLYERS_NUMBER} to set up yours."`] },
              "Thank you for using it.",
            ],
          }),
      },
    ],
  };
}

export function createSupabaseFlyerEmailFacts(db: SupabaseClient, opts: { now?: () => Date } = {}): (groupId: string) => Promise<FlyerEmailFacts | null> {
  const now = opts.now ?? (() => new Date());
  return async (groupId) => {
    const { data: g, error } = await db.from("flyer_groups").select("name, active, plan, plan_until, trial_flyers_left").eq("id", groupId).maybeSingle();
    if (error) throw new Error(`email facts: flyer group lookup failed: ${error.message}`);
    if (!g) return null;
    const [members, plans] = await Promise.all([
      db.from("flyer_members").select("id", { count: "exact", head: true }).eq("group_id", groupId),
      db.from("flyer_plans").select("*"),
    ]);
    if (members.error) throw new Error(`email facts: member count failed: ${members.error.message}`);
    if (plans.error) throw new Error(`email facts: flyer plans failed: ${plans.error.message}`);

    const until = g.plan_until ? new Date(g.plan_until as string) : null;
    const running = !until || until > now();
    const plan = (running ? (g.plan as PlanId) : "free") ?? "free";
    const onTrial = g.trial_flyers_left != null && running && plan !== "free";
    const kobo = (v: unknown) => (v == null ? null : Number(v));
    const prices: FlyerEmailFacts["prices"] = {};
    for (const r of (plans.data ?? []) as Array<Record<string, unknown>>) {
      prices[r.id as PlanId] = { monthly: kobo(r.monthly_price_kobo), yearly: kobo(r.monthly_price_paid_yearly_kobo), from: kobo(r.starting_price_kobo) };
    }
    return {
      live: g.active === true,
      stop: plan !== "free" && !onTrial,
      group: g.name as string,
      members: members.count ?? 0,
      memberLimit: PLANS.find((p) => p.id === plan)?.maxMembers ?? null,
      trialEnds: onTrial ? until : null,
      prices,
    };
  };
}
