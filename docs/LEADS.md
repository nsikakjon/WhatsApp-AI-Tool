# Real estate lead qualifier: setup

The lead qualifier answers its **own** WhatsApp number. The other numbers
(KahnPrints quote bot, site reporter) keep doing what they do.

## What it does

1. Someone messages the number about a property, typed or as a voice note.
2. The bot asks, one or two at a time: buy or rent, what kind of property,
   which area, budget, when they want to move or buy, and how they'll pay.
3. Each lead gets a score out of 100, worked out in code from their answers:

   | Answer                          | Points |
   | ------------------------------- | ------ |
   | When: now / 1-3 months / 3-6 months / later / just looking | 30 / 20 / 10 / 5 / 0 |
   | Paying by: cash / mortgage approved / payment plan / needs mortgage / unsure | 25 / 20 / 10 / 5 / 0 |
   | Gave a budget                   | 20     |
   | Gave an area                    | 10     |
   | Gave a property type            | 10     |
   | Asked for an agent or a viewing | 5      |

   70 or more is 🔥 **hot**, 40 to 69 is 🟠 **warm**, below 40 is 🔵 **cold**.
4. Agents get a WhatsApp alert, with the lead's answers and a tap-to-chat
   link, when a lead **answers everything and is hot**, or **asks to speak to
   someone** at any point. Each lead alerts once. Anything they send after
   that is passed on to the agents.
5. Warm and cold leads who answer everything get a summary and are told the
   team will send options. They can reply "agent" any time to be handed over.
6. Agents can text `leads` to the number to see the 10 latest enquiries.

The bot never quotes prices, never says a property is available, and never
promises a viewing time. It says an agent will confirm.

## 1. Create the table (Supabase)

Supabase > SQL Editor > New query > paste the whole of
`supabase/migrations/0010_leads.sql` > Run.

Every lead is then visible in Table Editor > `lead_leads`.

## 2. Get a number and its Phone number ID (Meta)

For testing, Meta's free test number works (add the phones you'll test from
to its "To" list). For real use, add a new number to the WhatsApp Business
Account: Meta dashboard > WhatsApp Manager > Phone numbers > Add phone number.
A number that is already on the normal WhatsApp or WhatsApp Business app must
be deleted from that app first.

Copy the number's **Phone number ID** (a long number, not the phone number).

## 3. Add the settings (Railway)

Service > Variables > add:

| Variable                | Value                                                   |
| ----------------------- | ------------------------------------------------------- |
| `LEADS_PHONE_NUMBER_ID` | the Phone number ID from step 2                         |
| `LEADS_AGENT_WA_IDS`    | agents' WhatsApp numbers, comma separated, e.g. `2348012345678,2348098765432` |
| `LEADS_BUSINESS_NAME`   | the name the bot uses, e.g. `Acme Homes`                |

`ANTHROPIC_API_KEY` is already set and is reused. Railway redeploys by itself.
The deploy log should say `lead qualifier: on`.

## 4. Test it

1. From a phone that isn't an agent's, message the number: "Hi, I'm looking
   for a 3 bedroom flat in Lekki". The bot asks about the rest.
2. Answer: budget "60 million", "I want to buy now", "cash". The agent phone
   gets a 🔥 HOT alert and you get "An agent will contact you shortly".
3. From the agent phone, text `leads`. You see the test lead.
4. To test from an agent's own phone, that works too: only the word `leads`
   is treated as an agent command; anything else is handled like an enquiry.

## If something doesn't work

- **No reply at all**: re-run `subscribed_apps` on the number's WhatsApp
  Business Account (see the gotchas in `docs/META_SETUP.md`).
- **Agents don't get the alert**: WhatsApp only delivers a bot's message if
  that person messaged the number in the last 24 hours. Agents should text
  `leads` to the number once a day for now. A WhatsApp message template will
  fix this for good later.
