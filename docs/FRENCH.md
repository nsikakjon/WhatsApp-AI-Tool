# French, CFA francs, Mobile Money and voice replies

This guide covers the bots for French-speaking Africa. Each section says what the feature does, then what to do to switch it on.

## 1. What changed

**Bots that speak French**
- Every fixed message the quote bot sends exists in English and French. That covers quotes, invoices, receipts, delivery, reminders, walk-in orders and the "something went wrong" reply.
- Customers always get the language they write in. A customer who writes in French gets French; one who writes in English or Pidgin gets English.
- Each business has a main language. It's used for the owner's messages, for invoices, and when a customer's language isn't clear (a bare "ok" or a number).
- The AI is told to reply in the customer's language. It still never sees or writes prices.

**The flyer bot in French**
- People who write in French get French from the first message, and the group they create is set to French.
- Admins can switch at any time by sending *français* or *english*.
- French admins can type their commands in French, for example *membres*, *ajouter Awa Diallo, 14 mars* or *couleur or*.
- Birthday wishes are written in French.
- The flyers say *Joyeux anniversaire* and use French months. A few designs use *Bonne fête*, as birthdays are wished across French-speaking Africa.

**CFA franc prices**
- A business can price in naira (NGN) or CFA francs: XOF for West Africa, XAF for Central Africa.
- CFA prices are whole francs and show as "5 000 FCFA".
- Prices still come only from the price list, worked out in code.

**Mobile Money through Flutterwave**
- CFA franc businesses get pay links on Flutterwave.
- Customers pay by MTN MoMo, Orange Money, Moov, Wave or card.
- The money goes to the business's Flutterwave subaccount.
- Naira businesses stay on Paystack.

**yarnOga's fee**
- The fee is 2.5% of each online payment, never more than ₦2,000.
- In CFA francs the cap is 800 FCFA. That's roughly ₦2,000, assuming about ₦2.5 to 1 franc.
- Both caps are in the database (`quote_plan_features`, rows `transaction_fee_cap_ngn` and `transaction_fee_cap_cfa`, in hundredths), so they can be changed without new code.
- The customer always pays just the order total. The fee comes out of the business's share.

**Voice replies**
- When a business switches this on, a customer who sends a voice note gets the text reply and the same words as a voice note, in their language.

## 2. What Jay needs to do

1. **Run two migrations in Supabase** (SQL Editor > New query > paste > Run), in this order:
   - `supabase/migrations/0051_languages_currencies.sql`
   - `supabase/migrations/0052_flutterwave.sql`

   Run both before deploying, because the flyer bot now reads the group's language.

2. **Flutterwave** (only when you're ready to take CFA payments):
   1. In Flutterwave go to Settings > API Keys and copy the **secret key** (FLWSECK-...).
   2. On Railway, add `FLUTTERWAVE_SECRET_KEY` with that key. Never paste the key anywhere else: not in chat, code or documents.
   3. Make up a long random phrase. Add it on Railway as `FLUTTERWAVE_SECRET_HASH`.
   4. In Flutterwave go to Settings > Webhooks:
      - set the **URL** to `https://<your Railway address>/webhooks/flutterwave`;
      - set the **Secret hash** to the same phrase as in step 3.
   5. `PUBLIC_URL` must already be set (it is, if Paystack works). `FLUTTERWAVE_CUSTOMER_EMAIL` is optional; the Paystack one is used when it's empty.
   6. Create a **subaccount** for each CFA business (Flutterwave > Subaccounts), with the owner's Mobile Money or bank account. Copy its ID (RS_...):
      - for the main number, put it in `QUOTE_FLUTTERWAVE_SUBACCOUNT`;
      - for other businesses, put it in the `flutterwave_subaccount` column of `quote_businesses` in Supabase.
   7. `QUOTE_PAY_LINKS=true` must be on (it already is for Paystack pay links).

3. **A French or CFA business:**
   - The owner chooses the language, currency and voice replies in the app, under **Settings > Language and currency**.
   - For the main number, use the Railway variables `QUOTE_LANGUAGE=fr`, `QUOTE_CURRENCY=XOF` (or XAF) and `QUOTE_VOICE_REPLIES=true`.
   - Changing the currency doesn't convert prices. Re-enter them in francs.

4. **Voice replies:**
   1. In the Google Cloud console, switch on the Text-to-Speech API.
   2. Make an API key (APIs & Services > Credentials). Limiting it to Text-to-Speech is a good idea.
   3. Add the key on Railway as `GOOGLE_TTS_API_KEY`.
   4. Each business then switches voice replies on in Settings.

   Google charges per character read, after a monthly free allowance; check its current pricing page. Long replies, like a whole price list, stay text only.

5. **The French website:**
   - `site/fr/index.html` uses the same styles, fonts and images as yarnoga.com.
   - Upload it to Hostinger as `public_html/fr/index.html`. See `site/README.md`.

## 3. How it stays safe

- **Prices:** every amount in a reply, invoice, voice note or pay link is worked out in code from the price list. A reply from the AI that mentions money in any currency (naira, FCFA, francs) is replaced before it's sent.
- **Webhooks:** a Flutterwave webhook without the secret hash is turned away before any work. For the rest, the bot asks Flutterwave itself whether the payment really went through, in the right currency and for the full amount. Each payment is acted on only once, however many times the webhook arrives.
- **Secrets:** all keys live only in Railway variables. `.env.example` lists them with empty values.
