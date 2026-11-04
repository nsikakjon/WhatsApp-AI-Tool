# Marketing Messages API

Meta has two ways to send a WhatsApp **Marketing** template:

- the normal Cloud API, which the bot uses for everything, and
- the **Marketing Messages API**, for marketing templates only. Meta picks
  the best moment and the people most likely to read it, and says this gets
  more messages delivered. Same number, same templates.

With the switch on, the bot sends **broadcasts** and **quote follow-ups**
through the Marketing Messages API, for numbers whose WhatsApp account has
signed up for it. Replies to customers, owner alerts, receipts and every other
message stay on the normal Cloud API.

## What you need to do

1. **Accept Meta's terms** (free, takes a minute). Someone with full control of
   the business portfolio does one of these:
   - App Dashboard > WhatsApp > Quickstart > "Improve ROI with Marketing
     Messages API", or
   - WhatsApp Manager > Overview > Alerts, then the Marketing Messages API alert.
2. **Make sure the WhatsApp account has a payment method.** Meta only marks an
   account ready once the terms are accepted *and* a valid payment method is
   attached.
3. On Railway, set `MARKETING_MESSAGES_API=true`.

A client with their own WhatsApp account (connected on /signup) accepts the
terms in their own business portfolio. Until they do, their broadcasts simply
go the normal way.

## How the bot decides

- Before a marketing send, the bot asks Meta for the account's
  `marketing_messages_onboarding_status` (once an hour per account). Only
  `ONBOARDED` uses the Marketing Messages API; anything else sends the normal way.
- The bot learns which account a number belongs to from Meta's webhooks, so
  right after a restart a number's first marketing messages may go the normal
  way until someone messages that number.
- If Meta turns a message down on the Marketing Messages API (for example a
  follow-up template that is still in the Utility category), the same message
  is sent the normal way at once and that template skips the Marketing
  Messages API for an hour. The customer gets exactly one message.

## Things to know

- Meta uses delivery, read and click data from these messages to improve
  delivery. That can be switched off per account in WhatsApp Manager.
- Turning the switch off puts every message back on the normal Cloud API.
