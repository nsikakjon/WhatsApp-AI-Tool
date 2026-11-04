# Numbers to connect

Until Meta approves App Review and Tech Provider, a business that signs up by
chat can't connect its own WhatsApp. Instead it gets a new SIM just for its
bot, and yarnOga staff add that number to our WhatsApp account by hand. This
switch makes the bot collect those numbers and gives staff one page to work
through them.

## What the business owner sees

After they reply YES to their price list, the sign-up chat ends with:

> Last step: a WhatsApp number just for your bot, so your customers can reach it.
> 1. Get a new SIM (any network) and put it in any phone that can get SMS.
> 2. Don't install WhatsApp on that SIM.
> 3. Send the new number here, for example _0803 123 4567_.

They can send the number straight away or days later. The bot checks it looks
like a phone number, isn't the number they're chatting from, and isn't already
used by another business. They can send a different number until it has been
registered, and **number** shows the steps (or the number we have) again.

When the business goes live, the owner gets a WhatsApp message from the
sign-up number with their bot's number and a link to try it.

## What staff see

`/quote-setup/numbers` (the setup screen's password, any username):

- **To do**: numbers that came in and aren't live yet, with status, who has it
  and how long it has waited.
- **Waiting for the owner's number**: signed up, no number sent yet. Chase these.
- **Live**: the last 30 connected.
- **Who connects numbers**: add a name and WhatsApp number for each person.

Each new number goes to the person with the fewest still to do, and they get a
WhatsApp message with a link to its page. The yarnOga sign-up alert number
(`QUOTE_SIGNUP_ALERT_WA_ID`) gets a copy saying who it went to. You can change
who has it on the business's page; the new person is messaged too.

Each business's page has three steps:

1. **Add the number in WhatsApp Manager** (yarnOga's WhatsApp account > Add
   phone number), with the business name as display name. Call or message the
   owner to read the code Meta sends to the SIM. Press **Done**.
2. **Register it**: paste the Phone number ID. The page checks it belongs to
   the owner's number, then registers it with a new 6-digit PIN using the bot's
   own access token, so staff never need the token. The PIN is shown on the
   page; WhatsApp asks for it if the number is ever moved. If someone already
   registered it by hand, tick the box to skip that.
3. **Switch it on**: sets the Phone number ID on the business, switches it on,
   and tells the owner. Customers get answers within a minute.

The **Note** box is for anything holding a number up ("code not arriving, try
voice call tomorrow"), and shows on the list.

## Switching it on (Railway)

1. Run `supabase/migrations/0071_quote_number_queue.sql` in Supabase. It also
   puts businesses that already signed up by chat, with no number yet, on the
   queue.
2. Set `QUOTE_NUMBER_QUEUE=true`. It needs `QUOTE_SIGNUP_PHONE_NUMBER_ID`,
   `QUOTE_MULTI_BUSINESS=true` and `QUOTE_SETUP_PASSWORD`. `PUBLIC_URL` puts a
   link to each page in staff messages.
3. Optional but recommended: set `QUOTE_NUMBERS_PASSWORD` (12+ characters).
   Give staff this one: it opens only the numbers pages, not the businesses or
   price lists, and they can't change the staff list. You keep using
   `QUOTE_SETUP_PASSWORD`.
4. Open `/quote-setup/numbers` and add the people who connect numbers. Each of
   them should send **hi** to the sign-up number once.

Staff can bookmark `https://app.yarnoga.com/quote-setup/numbers`, and each
WhatsApp alert links straight to that business's page. You also have a
**Numbers to connect** link at the top of the analytics dashboard.

## Messages outside the 24 hours

WhatsApp only delivers ordinary messages to someone who messaged that number
in the last 24 hours. Staff alerts and the "you're live" message come from the
sign-up number, so until the owner alert template (`OWNER_ALERT_TEMPLATE_NAME`)
is set up, someone who hasn't messaged it in a day won't get them. The queue
page always shows everything, so check it daily either way.
