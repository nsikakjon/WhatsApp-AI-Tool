import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountFacts, Series } from "../../core/email/series.js";

// Site Reporter's emails to the client's owner and site manager (copy
// approved by Jay, marketing/email/EMAILS.md). Jay adds these contacts by
// hand when he sets a site up (docs/EMAILS.md); the account is the site's id.

export interface SiteEmailFacts extends AccountFacts {
  site: string;
  /** The number the team sends updates to; null when WhatsApp didn't say. */
  botNumber: string | null;
  team: string[];
}

export function siteEmails(facts: (siteId: string) => Promise<SiteEmailFacts | null>): Series<SiteEmailFacts> {
  const number = (f: SiteEmailFacts) => f.botNumber ?? "the Site Reporter number";
  const eyebrow = "Site reports";
  return {
    facts,
    emails: [
      {
        key: "S1",
        day: 0,
        content: (f, name) => ({
          eyebrow,
          subject: "Your site reports start today",
          preview: "Your team sends updates. You get the report.",
          hero: "site",
          blocks: [
            `Hi ${name},`,
            `*${f.site}* is now set up on yarnOga Site Reporter.`,
            "How it works:",
            {
              list: [
                `Your site team send updates to ${number(f)}: text, photos or voice notes, in English, Pidgin or any language they're comfortable with.`,
                "Every evening, the manager gets one clear report of the day: work done, materials, problems, photos.",
                `On the team: ${f.team.length ? f.team.join(", ") : "nobody yet"}. To add or remove someone, reply to this email.`,
              ],
            },
            "Nobody needs to install anything. If they can send a WhatsApp, they can send an update.",
          ],
        }),
      },
      {
        key: "S2",
        day: 2,
        content: (f, name) => ({
          eyebrow,
          subject: "Getting your team to send updates",
          preview: "A message for your foreman's WhatsApp.",
          blocks: [
            `Hi ${name},`,
            "Reports are only as good as the updates. Here's a message you can forward to your foreman and team:",
            { note: ["", `"From today, please send site updates to ${number(f)}. A photo of each task with one line about it is enough. Voice notes are fine. Send problems as soon as they happen, not at the end of the day."`] },
            "What helps most:",
            { list: ["One photo per task, not ten of the same wall", 'Say the problem in plain words: "cement finished", "rain stopped work at 2"', "Send as you go, so the report has the right times"] },
          ],
        }),
      },
      {
        key: "S3",
        day: 5,
        content: (f, name) => ({
          eyebrow,
          subject: "Ask for a report any time",
          preview: "Don't wait for the evening.",
          blocks: [
            `Hi ${name},`,
            `Managers can send *report* to ${number(f)} at any time and get today's report so far. Useful before a client call, or when you're deciding whether to drive to site.`,
          ],
        }),
      },
      {
        key: "S4",
        day: 14,
        content: (_f, name) => ({
          eyebrow,
          subject: "Adding a person or another site",
          preview: "Reply to this email and we'll set it up.",
          blocks: [
            `Hi ${name},`,
            "Two weeks in. If you'd like to add a new team member, move someone to another site, or start reporting on a second site, reply to this email with the names and WhatsApp numbers. We'll set it up, usually the same day.",
          ],
        }),
      },
    ],
  };
}

export function createSupabaseSiteEmailFacts(db: SupabaseClient, botNumber: () => Promise<string | null>): (siteId: string) => Promise<SiteEmailFacts | null> {
  return async (siteId) => {
    if (!/^[0-9a-f-]{36}$/.test(siteId)) return null;
    const { data: site, error } = await db.from("site_sites").select("name, active").eq("id", siteId).maybeSingle();
    if (error) throw new Error(`email facts: site lookup failed: ${error.message}`);
    if (!site) return null;
    const { data: members, error: membersError } = await db.from("site_members").select("name").eq("site_id", siteId).eq("active", true).order("name");
    if (membersError) throw new Error(`email facts: site team failed: ${membersError.message}`);
    return {
      live: site.active === true,
      stop: site.active !== true,
      site: site.name as string,
      botNumber: await botNumber(),
      team: ((members ?? []) as Array<{ name: string }>).map((m) => m.name),
    };
  };
}
