# Pages for yarnoga.com

yarnoga.com is hosted on Hostinger, not on Railway. Pages kept here are
uploaded there by hand.

## fr/index.html: French landing page (flyers + quote bot) with an EN switch

The page opens in French. The **FR / EN** switch at the top swaps every text on
the page without reloading; the choice is remembered on that phone or
computer, and `?lang=en` in the address opens it in English.

Before uploading:

1. Open `fr/index.html` and find `SITE_CONFIG` near the bottom. Put in the
   WhatsApp numbers the buttons should open, digits with the country code:
   `quotes` (the demo and sign-up number) and `flyers` (the flyer bot number).
   Left empty, the buttons open an email to support instead.

To upload:

1. Hostinger > Websites > yarnoga.com > **File manager**.
2. Open `public_html`, make a folder called `fr`, and upload `index.html` into it.
3. Open `https://yarnoga.com/fr/` to check, and press **EN** to check the English.
4. Add a link to it from the English home page, e.g. "Français" in the menu.

The page counts its visitors like the rest of the site (Dashboard > Website),
under the path `/fr/`.
