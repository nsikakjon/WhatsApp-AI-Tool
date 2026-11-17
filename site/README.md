# yarnoga.com

This folder is the whole website. yarnoga.com is hosted on Hostinger, not on
Railway. When a change to this folder is merged into `main`, GitHub uploads it
to Hostinger by itself (`.github/workflows/website.yml`), usually within two
minutes. Check progress under the repository's **Actions** tab > **Website**.

Only changed files are uploaded. A page deleted from this folder is deleted
from the live site too. Files that were never in this folder (WordPress,
`.htaccess`, old leftovers) are not touched, so delete those by hand.
`README.md` is not uploaded.

## One-time setup

1. Hostinger > Websites > yarnoga.com > **Files** > **FTP Accounts**. Create a
   new FTP account (for example `github`) with a long password, and leave the
   folder as `public_html` itself (empty, not a subfolder). Note the **FTP IP /
   hostname** shown on the same page and the full username (it looks like
   `u123456789.github`).
2. GitHub > this repository > **Settings** > **Secrets and variables** >
   **Actions** > **New repository secret**, three times:
   - `FTP_SERVER`: the FTP hostname or IP
   - `FTP_USERNAME`: the full FTP username
   - `FTP_PASSWORD`: its password
3. **Actions** > **Website** > **Run workflow** to publish the current site.

The first run uploads every file and replaces what is there. After that, the
workflow keeps a small list of what it uploaded in
`public_html/.ftp-deploy-sync-state.json`; leave that file in place.

## fr/index.html: the French homepage, with an FR / EN switch

A French translation of the English homepage with the same markup. It loads
the main site's own stylesheet, fonts, pictures and script (`/styles.css`,
`/img/...`, `/js/motion.js`), so it always looks exactly like yarnoga.com and
picks up any change to the main site's design by itself. **FR / EN** in the
top bar (and "Langue" in the footer) switch between `/fr/` and `/`.

The product pages it links to (Quotes, Flyers, Contact...) are still in
English; those links are marked as English for browsers and search engines.

The English pages have the same **EN / FR** switch in their top bar, and the
switch's styles live in the main `styles.css`, so this page has no styles of
its own.

If the main site's `styles.css` or `motion.js` version number changes (the
`?v=...` at the end), update it in `fr/index.html` too so browsers fetch the
new one.

The page describes the French bot, prices in FCFA, Mobile Money through
Flutterwave, French voice replies, the shop link, discount codes, staff roles
and the one-tap transfer screenshot confirm.

The page counts its visitors like the rest of the site (Dashboard > Website),
under the path `/fr/`.

## terms.html: the terms, with the pharmacy rule

The terms page, with one paragraph added under **Fair use**:
pharmacies and chemists must keep prescription-only medicines off their price
lists, because Meta bans selling them on WhatsApp.


## Prices in other currencies

The Quotes and Flyers pricing sections have a currency picker: naira, cedi,
CFA franc, Kenyan shilling and US dollar. The prices are fixed (approved by jay
on 30 October 2026), not live exchange rates, and live in a small table at the
top of `js/currency.js`. The page picks a first currency from
the visitor's time zone and remembers their choice. Without JavaScript it shows
naira. The picker's styles are in the main `styles.css` (version `20261030a`).
Picking another currency shows a line saying the bot's payment link comes in
that currency (docs/PAYMENTS.md, `PLAN_CURRENCIES`), and the terms page names
Paystack and Flutterwave under Plans and payment.
