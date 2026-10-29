# Welcome and setup-tip emails

yarnOga's own emails to **our** customers: quote business owners, flyer group admins, and the Site Reporter and lead qualifier clients. Never to a business's customers.

Everything is off until you switch it on (`EMAILS_ENABLED=true`).

## What it does

**Asking for an email.** We only ask once, right after something has worked, and people can always say no:

| Where | When |
| --- | --- |
| Quote bot sign-up by chat | Straight after they reply YES and their business is created |
| yarnOga Flyers | When an admin saves their group's third member (English-speaking groups; the emails are in English) |
| /signup page | After the number connects: an email box and a tick box for tips |
| Owner app | Settings > Your email: an email box and a tick box for tips |

In WhatsApp they answer with their email address, or *skip*. A mistyped address like `@gamil.com` is checked with them first.

**Two kinds of agreement, kept apart** (Nigeria Data Protection Act). An address typed in the owner app or on /signup is for receipts and account messages. Tips only go out to people who said yes to tips: by sending their email after the WhatsApp question, or by ticking the box. For each person we keep when they agreed, where, and the exact words they saw (`email_contacts`).

**The series.** The copy Jay approved (marketing/email/EMAILS.md), in the approved look (dark header with the logo, Pexels photo on the first email, lime button, dark footer, signed Nsikak John):

- Quote bot: 10 emails over 28 days. Day 0 is when the business goes live on its own number, so a business still waiting to be connected gets nothing yet.
- Flyers: 7 emails over 10 days, from the day the admin gives their email.
- Site Reporter: 4 emails, lead qualifier: 5 emails (contacts added by hand, see below).

Every 15 minutes the bot sends what's due: at most one email a day per person, between 8am and 8pm Lagos time (the welcome goes straight away), and at most `EMAILS_PER_DAY` in total. An email for a step they've already done is skipped ("Your bot can only quote what's on your list" only goes to a business with fewer than 5 items). The series stops when the business or group moves to a paid plan. Plan prices in the emails come from the database.

**Stopping.** Every email has an Unsubscribe link that works in one click, plus the header Gmail and Yahoo use for their own Unsubscribe button. The page lets them back in if they tapped by mistake. Sending *stop emails* to any yarnOga number also unsubscribes.

## Switching it on

### 1. Run the migration

Supabase > SQL Editor > New query: paste `supabase/migrations/0057_emails.sql` and Run. Running it again is safe.

### 2. Set up the sending address in Resend (about 15 minutes)

The emails come from **hello@updates.yarnoga.com**, shown as "Nsikak John at yarnOga". Using `updates.` keeps a bad week of sending away from support@yarnoga.com and the main domain.

1. Log in at resend.com (the same account the alerts use). Domains > Add domain > type `updates.yarnoga.com` > Add.
2. Resend shows 3 or 4 records (an MX record and TXT records for SPF and DKIM). Leave that page open.
3. In Hostinger: Domains > yarnoga.com > DNS / Nameservers > Manage DNS records. Add each record from Resend **exactly** as shown: same type, same name (for example `send.updates` or `resend._domainkey.updates`), same value, same priority for the MX one.
4. Add one more record that Gmail and Yahoo ask for:
   - Type: TXT
   - Name: `_dmarc.updates`
   - Value: `v=DMARC1; p=none;`
5. Back in Resend, press Verify. It can take from a few minutes to a few hours. Wait until it says **Verified**.

Replies go to support@yarnoga.com (the Hostinger mailbox), so a person sees them.

### 3. Add the settings on Railway

| Variable | Value |
| --- | --- |
| `EMAILS_ENABLED` | `true` |
| `RESEND_API_KEY` | already there if alerts are on; otherwise from resend.com > API Keys |
| `EMAIL_FROM` | leave empty for `Nsikak John at yarnOga <hello@updates.yarnoga.com>` |
| `EMAIL_REPLY_TO` | leave empty for support@yarnoga.com |
| `EMAILS_PER_DAY` | leave empty for 90 (Resend's free plan allows 100 a day) |

`PUBLIC_URL` (or `OWNER_APP_URL`) must be the address the app is on, `https://app.yarnoga.com`: the emails' pictures and unsubscribe page live there.

### 4. Check it

Sign up a test business by chat on the quotes number from your own phone, answer the email question with your own address, and connect a number to it. The welcome email arrives within 15 minutes of the business going live. Check that the pictures show, then tap Unsubscribe at the bottom and see the page.

## Site Reporter and lead qualifier clients

These are set up by hand, so add the person when you hand over. In Supabase > SQL Editor, change the parts in capitals:

```sql
-- Site Reporter: the account is the site's id (Table editor > site_sites).
insert into public.email_contacts (product, account_id, wa_id, first_name, email, tips_at, tips_source, tips_wording)
values ('site', 'SITE-ID', '234XXXXXXXXXX', 'FIRST NAME', 'NAME@EXAMPLE.COM', now(), 'hand-over by Jay', 'Agreed to setup tips by email at hand-over');

-- Lead qualifier: the account can be any short name for the client.
insert into public.email_contacts (product, account_id, wa_id, first_name, email, tips_at, tips_source, tips_wording)
values ('leads', 'CLIENT-NAME', '234XXXXXXXXXX', 'FIRST NAME', 'NAME@EXAMPLE.COM', now(), 'hand-over by Jay', 'Agreed to setup tips by email at hand-over');
```

Only add people who said yes.

## Costs

Resend's free plan: 3,000 emails a month, 100 a day. At today's sign-ups that's enough. Move to Resend Pro (US$20 a month, about ₦31,000) when we pass about 90 a day; then raise `EMAILS_PER_DAY`.

## Not built yet

- Asking for an email at the moment of upgrading. Paystack receipts already go to the payer when we have their email for receipts; otherwise they still go to `PAYSTACK_CUSTOMER_EMAIL`.
- The "thank you for upgrading" emails (P1, P2 in EMAILS.md).
- The website "Get the free setup guide" box.
