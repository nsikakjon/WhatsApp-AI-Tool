import { normaliseWaId } from "../owner/auth.js";
import { esc, pageShell } from "./page.js";
import type { Partner } from "./partners.js";

// Owner app logins for an event partner's team, made from their package on
// /dashboard/partners. Each organiser gets their own one-time link, opens the
// app as an "Event organiser" (src/owner/roles.ts: chats, orders, ticket
// buyers and ticket money; no settings, bank details or plan), and can set a
// password there or send "app" on WhatsApp for a new link later.

/** Hours a link made here stays usable: long enough to send it and for them to open it. */
export const ORGANISER_LINK_HOURS = 24;

export interface Organiser {
  name: string | null;
  waId: string;
  /** "owner" for the shop's owner, who already has the full app. */
  role: string;
  lastLoginAt: string | null;
}

export interface OrganiserLogin {
  /** The one-time login link. */
  url: string;
  /** True when the number is the shop owner's, who gets their usual full login. */
  owner: boolean;
}

export interface OrganiserInput {
  name: string;
  waId: string;
}

export function parseOrganiserForm(form: Record<string, unknown>): OrganiserInput | { problem: string } {
  const name = typeof form.name === "string" ? form.name.trim().slice(0, 60) : "";
  if (!name) return { problem: "Type the organiser's name." };
  const waId = normaliseWaId(typeof form.number === "string" ? form.number : "");
  if (!waId) return { problem: "Type the organiser's WhatsApp number, e.g. 0803 123 4567." };
  return { name, waId };
}

export function renderOrganisers(p: Partner, team: Organiser[] | "error" | undefined): string {
  if (team === undefined) return "";
  const list =
    team === "error"
      ? `<p class="problem">Couldn't load their logins. If 0091_organiser_role.sql hasn't been run in Supabase yet, run it.</p>`
      : team.length
        ? `<ul class="links">${team
            .map(
              (t) =>
                `<li><span>${esc(t.name ?? "No name")} · +${esc(t.waId)}${t.role === "owner" ? " (shop owner, full app)" : ""}</span><span class="small">${t.lastLoginAt ? `Last in ${esc(t.lastLoginAt.slice(0, 10))}` : "Not logged in yet"}</span></li>`,
            )
            .join("")}</ul>`
        : "";
  return `<form class="entry" method="post" action="/dashboard/partners/${p.id}/organisers">
<h3>Organiser logins</h3>
<p class="small wide-all">Each person on their team gets their own login to the yarnOga app: chats, orders, ticket buyers and ticket money, but no settings, bank details or plan. The link works once, within ${ORGANISER_LINK_HOURS} hours.</p>
<label>Name <input name="name" required maxlength="60" placeholder="e.g. Ime Udo" autocomplete="off"></label>
<label>WhatsApp number <input name="number" required inputmode="tel" maxlength="40" placeholder="e.g. 0803 123 4567" autocomplete="off"></label>
<div class="buttons"><button type="submit">Make login link</button></div>
${list}
</form>`;
}

/** The page shown once after making a link: the link to copy, and a button to send it from your own WhatsApp. */
export function renderOrganiserLink(p: Partner, who: OrganiserInput, login: OrganiserLogin, door?: string): string {
  const message = [
    `Hi ${who.name}, here's your login to the ${p.name} yarnOga app: ${login.url}`,
    "",
    `It works once, within ${ORGANISER_LINK_HOURS} hours, so please don't forward it. Once you're in, set a password under Settings to log in any time.`,
    ...(door ? ["", `Door check-in screen, for the team at the entrance: ${door}`] : []),
  ].join("\n");
  const body = `<section>
<h2>Login for ${esc(who.name)}</h2>
<p class="intro">${
    login.owner
      ? `+${esc(who.waId)} is the shop owner's number, so this is their usual full login.`
      : `${esc(who.name)} (+${esc(who.waId)}) can now open the app as an event organiser.`
  } Send them the link below. It's shown only once.</p>
<pre class="preview">${esc(message)}</pre>
<div class="buttons">
<a class="button" href="https://wa.me/${esc(who.waId)}?text=${encodeURIComponent(message)}" target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>
<button type="button" onclick="navigator.clipboard.writeText(document.querySelector('.preview').textContent).then(()=>{this.textContent='Copied'})">Copy message</button>
</div>
</section>`;
  return pageShell({
    title: `${p.name} organiser login`,
    crumb: "Partnerships",
    heading: "yarn<b>Oga</b> organiser login",
    nav: `<a href="/dashboard/partners#package-${p.id}">Back to partnerships</a>`,
    body,
    css: `.preview { white-space:pre-wrap; overflow-wrap:anywhere; font-family:inherit; font-size:15px; line-height:1.5; background:var(--surface2); border:1px solid var(--line); border-radius:12px; padding:14px; }
.buttons { display:flex; flex-wrap:wrap; gap:10px; margin-top:14px; }
.buttons .button, .buttons button { font:600 15px/1 inherit; font-family:inherit; padding:12px 16px; border-radius:10px; border:1px solid var(--line2); background:var(--surface3); color:var(--text); text-decoration:none; cursor:pointer; }
.buttons .button { background:var(--lime); color:var(--limeink); border-color:var(--lime); }`,
  });
}
