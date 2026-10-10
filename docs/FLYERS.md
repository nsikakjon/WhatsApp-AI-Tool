# Birthday and event flyers: setup and use

The flyer bot answers its **own** WhatsApp number. Group admins (for example,
whoever runs an alumni or friends group) chat with it to:

- save members with a photo and birthday,
- set the group's logo,
- turn any photo into a branded event flyer (logo plus caption).

On each member's birthday morning the bot sends the admins a finished
birthday flyer with a short message, ready to forward to the group.

## Why the bot doesn't post in the group itself

Meta's official WhatsApp API can only post in groups the bot creates itself,
capped at 8 members, and only for blue-badge (Official Business) accounts. It
can't join an existing alumni or friends group. So the bot does all the work
and an admin forwards the flyer, which takes a few seconds:

1. Long-press the flyer > Forward > pick the group > Send.
2. In the group, type `@` and pick the birthday person's name to tag them.

## 1. Create the tables (Supabase)

Supabase > SQL Editor > New query > paste the whole of
`supabase/migrations/0005_flyers.sql` > Run.

This also creates a private storage bucket called `flyer-photos`, where
member photos and logos are saved (Supabase > Storage).

## 2. Pick a WhatsApp number

The flyer bot needs a number that no other product uses:

- **For testing**: Meta's free test number, as long as the site reporter isn't
  using it. Add every phone that will message it to the "To" list
  (Manage phone number list), up to 5.
- **For real use**: a spare SIM that isn't on WhatsApp, added to the
  Kahn Prints WhatsApp Business Account (WhatsApp Manager > Phone numbers >
  Add phone number), with a display name such as "Birthday Flyers".
  Then run `subscribed_apps` on that account again (see `docs/META_SETUP.md`).

Copy the number's **Phone number ID** (a long number, not the phone number).

## 3. Add the settings (Railway)

Service > Variables > add:

| Variable                | Value                                                        |
| ----------------------- | ------------------------------------------------------------ |
| `FLYER_PHONE_NUMBER_ID` | the Phone number ID from step 2                              |
| `FLYER_OWNER_WA_IDS`    | your WhatsApp number, e.g. `2348024777076` (comma-separate several) |
| `FLYER_SEND_HOUR`       | `8` (8am Lagos time), or another hour                        |

`ANTHROPIC_API_KEY` is already set for the quote bot and is reused to write
the birthday messages. Railway redeploys by itself. The deploy log should say
`flyers: on`.

## 4. Set up a group (on WhatsApp)

From an owner phone, message the flyer number:

```
new group Unilag Class of 2010
```

You're now that group's admin. To let someone else run it:

```
add admin 08012345678
```

Then send the group's logo with the caption `logo`. Send it **as a document**
(paperclip > Document) if it has a see-through background; photos lose it.

## 5. Add members

Send each member's photo with a caption like:

```
add Ada Okafor, 14 March
```

Dates can also be written `14/03` or `March 14`. The bot replies with a
preview of their birthday flyer. Sending the same name again replaces the
photo and birthday.

Other commands:

| Send                  | You get                                      |
| --------------------- | -------------------------------------------- |
| `members`             | everyone and their birthdays, next one first |
| `upcoming`            | birthdays in the next 30 days                |
| `today`               | today's birthday flyers, right now           |
| `flyer Ada`           | Ada's birthday flyer and a message           |
| `remove Ada Okafor`   | removes Ada                                  |
| `groups`, `switch …`  | lists your groups, changes group             |
| `help`                | the full list                                |

## 6. Event flyers

Send any photo with the words you want on it as the caption, for example:

```
Homecoming 2026: Saturday 12 December, 4pm, Alumni Hall
```

You get the photo back with the logo in the corner and the caption across the
bottom, ready to forward.

## 7. Birthday mornings

From `FLYER_SEND_HOUR`, each admin gets the birthday flyer with a short
message as its caption, plus a reminder to forward and tag.

WhatsApp only lets a bot message someone who messaged it in the last 24 hours.
Admins who chat with the bot daily are fine. Otherwise there are two options:

- **Without a template**: the flyer waits, and arrives as soon as the admin
  sends the bot anything (even "hi") that day. `today` also works.
- **With a template (recommended)**: create one in WhatsApp Manager >
  Message templates > Create template:
  - Category: **Utility**. Name: `birthday_flyer`. Language: English.
  - Header: **Image** (upload any sample flyer as the example).
  - Body:
    ```
    Your birthday flyer for {{1}} ({{2}}) is ready. Suggested message: {{3}} Forward the flyer to the group and tag them.
    ```
  - Examples for the variables: `Ada Okafor`, `Unilag Class of 2010`,
    `Happy birthday Ada! 🎉`.

  Once Meta approves it, add `FLYER_TEMPLATE_NAME=birthday_flyer` on Railway.
  Admins then get the flyer every birthday morning whether or not they've
  messaged recently. Meta charges a small fee per template message.

## If something doesn't work

- **No reply at all**: re-run `subscribed_apps` for the account that holds the
  flyer number (see the gotchas in `docs/META_SETUP.md`).
- **"Hello! This number makes ... flyers" to everything**: your number isn't
  an admin of any group yet. Owners send `new group <name>`; others need an
  admin to send `add admin <their number>`.
- **A birthday flyer didn't arrive**: check the admin messaged the bot that day,
  or set up the template above. Railway logs show "Birthday flyer for … sent"
  when it goes out.
