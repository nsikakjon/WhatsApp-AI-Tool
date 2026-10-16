# Staff inbox

A web page where you and your staff can see every WhatsApp chat the bots are
having, read a conversation, reply yourselves, and take a chat over from the bot.

## What it does

- **Chat list** at `https://<your-railway-address>/inbox`: every customer, newest
  first, with a tag showing which number they wrote to (Sales, Flyers, Site
  reports, Property leads). It refreshes itself every 30 seconds.
- **A chat**: the whole conversation. Customer messages are on the left; the
  bot's and staff replies are on the right (staff replies in blue, labelled
  "Staff"). It checks for new messages every 20 seconds unless you're typing.
- **Take over**: the bot stops answering that customer on that number until
  someone presses **Hand back to bot**. Other chats are not affected.
- **Reply**: type and press Send. The message goes out from the same number the
  customer wrote to, and the chat is taken over automatically, so the bot doesn't
  answer on top of you.
- If you also reply from the WhatsApp Business app (coexistence, see
  [COEXISTENCE.md](COEXISTENCE.md)), the chat page shows that the bot is quiet
  for a while, with buttons to take over for good or hand back now.

WhatsApp only delivers ordinary replies within 24 hours of the customer's last
message. After that the reply box is replaced by a note; you can reply once they
write again.

## Switching it on

1. **Supabase**: SQL Editor > New query, paste and run each of these files from
   `supabase/migrations/` (skip any you've already run):
   - `0014_owner_reply_pause.sql` (the per-chat pause the bot checks)
   - `0015_inbox.sql` (records which number each message went through)

   The bots keep working if you forget, but the inbox page needs both, and
   messages saved before 0015 runs aren't tagged with their number.
2. **Railway** > your service > Variables: add `INBOX_PASSWORD` with a long
   password (at least 12 characters). Staff all use this one password.
3. Open `https://<your-railway-address>/inbox` and log in.

To switch the inbox off, delete `INBOX_PASSWORD`. To log everyone out (for
example when someone leaves), change it.

## Safety

- The page is only reachable after logging in. A login lasts 30 days on that
  browser.
- After 5 wrong passwords from one place, that place must wait 15 minutes.
- Pages aren't stored by the browser and can't be shown inside another website.
- Customer phone numbers are visible to anyone with the password, so share it
  only with staff who need it.

## Good to know

- Chats from before this update show under the main number, because older
  messages weren't tagged with a number.
- Photos, voice notes and documents show as a label (e.g. "📷 Photo"); voice notes
  the bot transcribed show their text. Viewing the actual photo isn't built yet.
- Everyone shares one password, so the inbox can't yet tell which staff member
  replied. Separate staff logins would be a later step if it's sold as a paid
  add-on.
