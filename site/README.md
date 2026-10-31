# Pages for yarnoga.com

yarnoga.com is hosted on Hostinger, not on Railway. Pages kept here are
uploaded there by hand.

## fr/index.html: the French homepage, with an FR / EN switch

A French translation of the English homepage with the same markup. It loads
the main site's own stylesheet, fonts, pictures and script (`/styles.css`,
`/img/...`, `/js/motion.js`), so it always looks exactly like yarnoga.com and
picks up any change to the main site's design by itself. **FR / EN** in the
top bar (and "Langue" in the footer) switch between `/fr/` and `/`.

The product pages it links to (Quotes, Flyers, Contact...) are still in
English; those links are marked as English for browsers and search engines.

To upload:

1. Hostinger > Websites > yarnoga.com > **File manager** > `public_html`.
2. Make a folder called `fr` (if it isn't there) and upload `index.html` into it,
   replacing the old one.
3. Open `https://yarnoga.com/fr/` and check, then press **EN**.

The English pages have the same **EN / FR** switch in their top bar, and the
switch's styles live in the main `styles.css`, so this page has no styles of
its own. The site zip in the project folder already includes `fr/index.html`.

If the main site's `styles.css` or `motion.js` version number changes (the
`?v=...` at the end), update it in `fr/index.html` too so browsers fetch the
new one.

The page describes the French bot, prices in FCFA, Mobile Money through
Flutterwave, French voice replies, the shop link, discount codes, staff roles
and the one-tap transfer screenshot confirm.

The page counts its visitors like the rest of the site (Dashboard > Website),
under the path `/fr/`.

## terms.html: the terms, with the pharmacy rule

The terms page from the site zip, with one paragraph added under **Fair use**:
pharmacies and chemists must keep prescription-only medicines off their price
lists, because Meta bans selling them on WhatsApp.

To upload: Hostinger > Websites > yarnoga.com > **File manager** >
`public_html`, upload `terms.html` and replace the old one. Then open
`https://yarnoga.com/terms.html` and check the date says 30 October 2026.

## Prices in other currencies

The Quotes and Flyers pricing sections have a currency picker: naira, cedi,
CFA franc, Kenyan shilling and US dollar. The prices are fixed (approved by jay
on 30 October 2026), not live exchange rates, and live in a small table at the
top of `js/currency.js` in the site zip. The page picks a first currency from
the visitor's time zone and remembers their choice. Without JavaScript it shows
naira. The picker's styles are in the main `styles.css` (version `20261030a`).
Picking another currency shows a line saying the bot's payment link comes in
that currency (docs/PAYMENTS.md, `PLAN_CURRENCIES`), and the terms page names
Paystack and Flutterwave under Plans and payment.
