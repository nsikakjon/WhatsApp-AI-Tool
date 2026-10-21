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
`supabase/migrations/0005_flyers.sql` > Run. Then do the same with
`supabase/migrations/0006_flyer_members_optional_photo.sql`, and then
`supabase/migrations/0007_flyer_plans.sql`, and
`supabase/migrations/0008_flyer_chat_state.sql`,
`supabase/migrations/0011_flyer_new_prices.sql`, and
`supabase/migrations/0014_flyer_trial.sql`.

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
| `FLYER_BRAND_NAME`      | the name you sell it under, e.g. `yarnOga Flyers`               |
| `FLYER_OPEN_SIGNUP`     | `true` so anyone can set up their own group (see "Selling it") |
| `FLYER_CREDIT`          | optional small print on flyers, e.g. `Made with yarnOga · wa.me/2348012345678` |

`ANTHROPIC_API_KEY` is already set for the quote bot and is reused to write
the birthday messages. Railway redeploys by itself. The deploy log should say
`flyers: on`.

## 4. Set up a group (on WhatsApp)

Message the flyer number (anything, e.g. "Hi") and the bot walks you
through it:

1. **Name**: it asks what the group is called. Reply with the name, e.g.
   `Unilag Class of 2010`. You're now that group's admin.
2. **Logo**: send the group's logo, or reply `skip`. Send it **as a
   document** (paperclip > Document) if it has a see-through background;
   photos lose it.
3. **Design**: it shows all the designs with your group's name on them.
   Reply with a number, or `skip`.
4. **Members**: it explains how to add them (next section).

Sending anything else part-way (for example `members`) leaves the guided
setup; `cancel` stops it. You can also skip straight to it with
`new group Unilag Class of 2010`.

To let someone else run the group:

```
add admin 08012345678
```

### More than one group

One WhatsApp number can run several groups. Send `groups` to see them,
numbered, with the current one marked, and `switch 2` (or `switch Unilag`) to
change. Everything you send after that (members, designs, event photos) is for
that group. Birthday flyers for every group arrive by themselves.

- **Owners** can set up any number of groups.
- **Everyone else** gets one group on the Free plan. Once their groups are on
  paid plans, they can send `new group` to add more. So an association with
  several chapters pays for each, or you put them on Deluxe or Organisation.
- Being added as an admin of someone else's group (`add admin`) doesn't count.

## 5. Add members

Send each member's photo with a caption like:

```
add Ada Okafor, 14 March
```

Dates can also be written `14/03` or `March 14`. The bot replies with a
preview of their birthday flyer. Sending the same name again replaces the
photo and birthday.

### Adding everyone at once from a spreadsheet

Make a sheet with three columns, **Name**, **Birthday** and **Photo**, one
member per row (a template is in `docs/templates/flyer-members.csv`). Then
either:

- **Google Sheets**: tap Share, set "Anyone with the link" to Viewer, copy the
  link and paste it into the chat with the bot, or
- **Excel or Google Sheets file**: File > Download > CSV, then send that file
  to the bot (paperclip > Document).

The bot replies with how many people it found, saves them, and messages you
a summary when it's done. Good to know:

- **Photo** is a link to each picture. Google Drive links work if the picture
  is shared as "Anyone with the link". A Google Form with a file-upload
  question gives you exactly this, so members can fill in their own details.
- Without a photo link, a member's flyer shows their initials until you send
  their photo captioned `photo Ada Okafor`.
- Birthdays can be `14/03`, `14/03/1990`, `14 March` or `1990-03-14`. The bot
  works out whether the sheet writes the day or the month first.
- Sending the same list again updates people instead of adding them twice.
- Column names can vary ("Full name", "Date of birth", "Upload your photo").


Other commands:

| Send                  | You get                                      |
| --------------------- | -------------------------------------------- |
| `members`             | everyone and their birthdays, next one first |
| `upcoming`            | birthdays in the next 30 days                |
| `today`               | today's birthday flyers, right now           |
| `flyer Ada`           | Ada's birthday flyer and a message           |
| `remove Ada Okafor`   | removes Ada                                  |
| photo captioned `photo Ada Okafor` | adds or changes Ada's photo     |
| `groups`, `switch …`  | lists your groups, changes group             |
| `help`                | the full list                                |

## 6. Choosing and changing the design

Admins can change how their group's flyers look, on WhatsApp:

| Send                                        | What happens                                  |
| ------------------------------------------- | --------------------------------------------- |
| `design`                                    | the first six designs on one picture, numbered, and a **Choose a design** button |
| tap **Choose a design**, then a design      | switches to it and shows a preview            |
| tap **More designs** (or send `designs page 2`) | the next six designs                      |
| `design 2` (or `design emerald`)            | switches to that design and shows a preview   |
| `see 8`                                     | design 8 full size with the group's name, without switching |
| `colour gold` (or a code like `#1a7f37`)    | changes the highlight colour; `colour reset` undoes it |
| a picture with the caption `background`     | uses it behind birthday flyers; `background off` undoes it |

The `background` option is the easiest way to get a fully custom look: design
a 1080 × 1350 background in Canva (leave the middle and the bottom clear for
the photo and name), download it as a picture, and send it to the bot.

Designs 7 to 18 are ready-made designs that draw everything themselves, so
they ignore the colour and background settings:

- 7, **Gold stars and glitter**: prints the birthday message beside the photo,
  signed "with love," and the group's name.
- 8, **Evening gala**: the photo graded like an evening party, gold lettering,
  a round date seal and the birthday message at the bottom.
- 9, **Sunflowers**: warm orange with sunflowers, a silver "Birthday" and a
  name tag.
- 10, **White and gold**: a script "Birthday" title, a date seal and the
  birthday message beside the photo.
- 11, **Calendar**: the birthday circled on that month's calendar.
- 12, **Gold portrait**: gold and brown, a big "HAPPY BIRTHDAY", a date box
  and the person standing at the bottom right.
- 13, **Red and peach**: a red "Birth Day" title, a round date seal and the
  person standing in the middle.
- 14, **Black and gold rings**: the photo in a gold ring, with a date pill.
- 15, **White confetti**: a round photo on white with confetti and a script
  "Birthday".
- 16, **Big date, blue**: the day of the month huge behind the person, with
  heart bubbles and a round date badge.
- 17, **Polaroid note**: the photo as a taped polaroid and a "dear, Ada / Many
  more happy returns!" note.
- 18, **Orange balloons**: orange rings, balloons and a polaroid photo.

Long birthday messages shrink to fit; the full message is always in the
caption under the flyer too. Designs 8 to 11 live in
`src/products/flyer/designs4.ts`, and 12 to 18 in
`src/products/flyer/designs7.ts`.

### Cut-out photos

Designs 5, 6 and 8 to 13 and 16 cut the person out of their photo (the
background is removed), so they stand in front of the design the way they would
in a Canva or Photoshop flyer. This runs on our own server with a free model
(ISNet, open licence), so it costs nothing per photo.

- Each photo is cut out once, the first time a design needs it, and the cut-out
  is saved next to the photo in Supabase Storage. Later flyers reuse it.
- Replacing a member's photo, or removing the member, removes the cut-out too.
- If no person is found (a logo, a landscape) or the cut-out fails, the design
  uses the normal photo instead, so a flyer is always made.
- Clear photos of one person work best. Group photos are cut out as one block.
- Cutting out uses about 700MB of memory for a second or two, one photo at a
  time. The model is unloaded after two idle minutes. If Railway shows the
  service running out of memory, raise its memory limit in the service's
  settings.

Designs are shown six to a page so the list stays easy to browse however many
there are. Each design keeps its number on every page, so `design 14` always
means the same design. Designs the group's plan doesn't include are marked with
the plan that has them; admins can still look at them with `see`.

**Changing or adding designs for everyone**: the designs live in
`src/products/flyer/themes.ts`, one block per design with its colours and
layout ("circle" for a round photo, "full" for a big photo). Change a colour
code there, or copy a block to add a new design, and it goes live on the next
deploy. Ask Claude to do it if you prefer: "make design 3 blue and white".

## 7. Event flyers

Send any photo with the words you want on it as the caption, for example:

```
Homecoming 2026: Saturday 12 December, 4pm, Alumni Hall
```

You get the photo back with the logo in the corner and the caption across the
bottom, ready to forward.

## 8. Birthday mornings

From `FLYER_SEND_HOUR`, each admin gets the birthday flyer with a short
message as its caption, plus a reminder to forward and tag.

WhatsApp only lets a bot message someone who messaged it in the last 24 hours.
Admins who chat with the bot daily are fine. Otherwise there are two options:

- **Without a template**: the flyer waits, and arrives as soon as the admin
  sends the bot anything (even "hi") that day. `today` also works.
- **With a template (recommended)**: create one in WhatsApp Manager >
  Message templates > Create template:
  - Category: **Marketing** (Meta rejects this wording as Utility). Name: `birthday_flyer`. Language: English.
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

## Selling it

With `FLYER_OPEN_SIGNUP=true`, anyone who messages the flyer number gets a
short introduction and can set up one group of their own by sending
`new group <name>`. You get a WhatsApp message for every sign-up, so you can
follow up personally. Owners (`FLYER_OWNER_WA_IDS`) can set up any number of
groups, for example to set one up on a customer's behalf.

To bring people in:

- **A chat link**: `https://wa.me/<flyer number>?text=Hi` opens a chat with the
  bot. Put it in your WhatsApp status, Instagram bio and flyers, or turn it
  into a QR code.
- **Every flyer is an advert**: set `FLYER_CREDIT`, e.g.
  `Made with yarnOga · wa.me/2348012345678`. On Free and Standard groups it's
  printed at the bottom of each flyer, and also added under the birthday
  message that goes with it. WhatsApp keeps that message when the admin
  forwards the flyer, and turns `wa.me/...` into a link anyone in the group
  can tap to start chatting with the bot, where the guided setup takes over.
  (The text printed on the picture can't be tapped, but people can type it.)

## Support

Anyone can send `support` (or "talk to a person"). The bot asks what they need,
then forwards their message to every owner number with their name, number,
group and plan. To answer, send the bot:

```
reply 2348012345678 Thanks, that's fixed now.
```

They get it from the bot as "yarnOga Flyers support: ...". It only arrives if
they messaged in the last 24 hours (WhatsApp's rule), which is normally the
case since they just wrote in.
- **Charging**: see "Plans" below.

## Plans

Every new group starts with a **free Standard trial**: all Standard features
for 7 days or 30 finished flyers, whichever comes first, with no card needed. Then it carries on
for free on the **Free** plan unless the admin upgrades. Paid plans unlock more:

| Plan     | Members   | Admins    | Monthly  | Paid yearly (per month) | Includes                                                     |
| -------- | --------- | --------- | -------- | ----------------------- | ------------------------------------------------------------ |
| Free     | 10        | 1         | free     |                         | 2 designs (1 and 4), logo, birthday flyers, "Made with" line |
| Standard | 50        | 2         | ₦4,500   | ₦2,500                  | all designs, colours, spreadsheet import, event flyers       |
| Premium  | 500       | 5         | ₦8,000   | ₦6,500                  | everything in Standard, own background, no "Made with" line  |
| Deluxe   | unlimited | unlimited | ₦10,000  | ₦8,500                  | everything, for associations with several groups or chapters |
| Organisation | unlimited | unlimited | from ₦73,000 | agreed per organisation | everything in Deluxe, for large associations, set up for you |

Deluxe was added on 14 October 2026 (migration `0011_flyer_new_prices.sql`);
Organisation is agreed per organisation, from ₦73,000 a month (migration
`0035_flyer_organisation_from_price.sql`, 21 October 2026); it has no payment
link, so requests go to the owners. Groups already over a new member limit keep everyone they have; they just
can't add more until they upgrade.

Anyone can send `plans` to see them with prices, and `plan` to see their
group's plan, member count and end date. When an admin tries something their
plan doesn't include, the bot says which plan has it.

**Getting paid through Paystack:** once payments are set up (see
[PAYMENTS.md](PAYMENTS.md)), `upgrade standard` replies with a Paystack link,
and the group switches over by itself as soon as it's paid. Admins can pay for
up to 12 months at once (`upgrade premium 3 months`); `upgrade deluxe 1 year`
charges the paid-yearly price.

**Getting paid by hand** (when Paystack isn't set up, or for Organisation):

1. The admin sends `upgrade standard` (or `upgrade premium`). You get a
   WhatsApp message with their number, group and plan.
2. Send them your bank details and collect the money.
3. Once paid, send the bot (from your owner number):
   ```
   set plan standard 1 month for Unilag Class of 2010
   ```
   Use `3 months` or `1 year` for longer. Renewing before the end adds the
   time on top. `set plan free for <group>` moves a group back to Free.

When a paid plan runs out, the group quietly drops back to Free: nothing is
deleted, birthday flyers keep going out for everyone, but the paid extras
(colours, own background, more designs) switch off and the "Made with" line
comes back until they renew.

**The free trial**: finished flyers are event flyers, `flyer Ada`, `today`,
and the birthday-morning flyers. Previews (when a member is added, or a design
or colour is changed) don't count. With 5 or fewer left, the bot tells the
admin how many remain, and it says so when the last one is used. `plan` shows
the trial's end date and flyers left. Each person gets one free group, and a
group on its trial counts as that group. When an owner sends `set plan ...`,
the trial ends and the paid time starts that day. Groups made before the trial
existed are not given one. To change the length, the number of flyers or the
plan it tries, edit `TRIAL` in `src/products/flyer/plans.ts`, or ask Claude.

**Changing prices**: Supabase > Table Editor > `flyer_plans`. Prices are in
**kobo** (₦1 = 100 kobo), so ₦4,500 is `450000`. `monthly_price_kobo` is the
month-by-month price; `monthly_price_paid_yearly_kobo` is the price per month
for someone paying a year at once (leave it empty for no yearly offer). Leave
`monthly_price_kobo` empty for "price on request". The change shows up straight
away, no deploy needed.

**Changing what a plan includes** (member limits, designs and so on): edit
`src/products/flyer/plans.ts`, or ask Claude, e.g. "let Free have 30 members".

## If something doesn't work

- **No reply at all**: re-run `subscribed_apps` for the account that holds the
  flyer number (see the gotchas in `docs/META_SETUP.md`).
- **"Hello! This number makes ... flyers" to everything**: your number isn't
  an admin of any group yet. Owners send `new group <name>`; others need an
  admin to send `add admin <their number>`.
- **A birthday flyer didn't arrive**: check the admin messaged the bot that day,
  or set up the template above. Railway logs show "Birthday flyer for … sent"
  when it goes out.
