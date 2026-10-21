# Owner test screen

A private page where you try your bot on the questions customers ask most,
before it goes live, and mark each answer **good** or **poor**.

It works for the **sales assistant** (quotes and orders, `ACTIVE_PRODUCT=quote`)
and the **property lead qualifier** (`LEADS_PHONE_NUMBER_ID`), whichever are
switched on. The flyer bot and site reporter follow fixed steps rather than
answering open questions, so they aren't on the screen.

## What it does and doesn't do

- Uses the same bot and AI as the live number, and the real price list, so the
  answers are what a customer would get.
- **Never sends WhatsApp messages.** Answers appear on the screen only. If the
  bot would alert you or your agents, the screen says so instead.
- **Never saves test quotes, orders or leads.** They are kept in memory and
  thrown away, so your order list and lead list stay clean.
- Each question is a brand-new chat with a pretend customer.
- Each answer is one AI call (a small cost), so there is a daily cap
  (`BOT_TEST_DAILY_LIMIT`, default 300).

## Switching it on

1. In Supabase, open **SQL Editor > New query**, paste
   `supabase/migrations/0022_bot_test_marks.sql`, and click **Run**. This makes
   the table that keeps your marks.
2. On Railway, add the variable `BOT_TEST_PASSWORD` with a password of at least
   12 characters. Railway redeploys by itself.
3. Open `https://<your-railway-url>/bot-test`. Your browser asks for a username
   and password: type anything as the username and the password from step 2.

To switch it off again, delete `BOT_TEST_PASSWORD` on Railway.

## Using it

If the sales assistant runs several businesses (`QUOTE_MULTI_BUSINESS`), pick
the business at the top first. Each one is tested with its own price list, and
a business that isn't switched on yet can be tested before it goes live. Marks
are kept separately for each business.

1. Check the questions in the box. The starter list has 20 common ones; change
   them or add your own, one per line, written the way your customers write
   (Pidgin is fine). Your list is remembered in that browser.
2. Click **Ask all questions** and wait while the answers come in.
3. Mark each answer **Good** or **Poor**. For a poor answer, you can type what it
   should have said. Marks are saved, and the newest mark for each question
   shows next time you open the page.

Poor answers are the list of things to fix before going live: share them in the
project and they can be turned into changes to the bot.
