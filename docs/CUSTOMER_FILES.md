# Customer files and order details

Many businesses need more from a customer than "200 business cards": a print
shop needs the artwork, a tailor needs measurements, a cake maker needs the
name to pipe on the cake. With this switched on, the quote bot keeps all of it
with the order.

## What customers see

- **They send a file** (photo, PDF, or a design file like `.cdr`, `.ai`,
  `.psd`): the bot keeps a copy and says it's saved with their quote or order.
  With no quote yet, it asks what they'd like and how many, and the file goes
  on the quote it makes next.
- **Words under the file** ("200 cards with this logo") are answered like a
  normal message, so the quote comes straight back.
- **A customer whose order is waiting for payment** sends a picture or PDF and
  says nothing: the bot asks "Is this a payment receipt or a design or photo
  for your order?" with two buttons. Before, every picture was treated as a
  payment. A caption that says it's a payment ("paid", "transfer", "I don
  pay") goes straight to the owner as a payment check, as before.
- **They give details** (measurements, names, colours, a date) in a message or
  voice note: the bot saves them as the order's details and repeats them back,
  unless they look like money, which the bot never repeats.
- Files bigger than 50 MB can't be kept: the bot asks for a smaller copy or a
  Google Drive link.

## Asking before confirming

In the owner app, each product has **Ask the customer for**, for example
"Your artwork or logo" or "Measurements: chest, waist, length". When an order
has a product with this and the customer hasn't sent a file or details yet,
the bot asks for them once before confirming. If they reply YES again without
sending anything, the order is confirmed and the owner's alert says what's
still missing.

## What the owner sees

- **New-order alert**: the details, the list of files, and an **Open order**
  button to the order board.
- **A file or details sent after the order is confirmed**: an alert with the
  picture (for photos) and the **Open order** button.
- **Order board**: each order shows its details and its files to download.
- **Inbox**: photos show in the chat, other files as a download button.
- **Invoice and receipt**: an "Order details" box with what the customer asked
  for.

Files the customer sends while the owner is handling the chat (the bot is
quiet) are still kept, so they show in the inbox.

## Where files are kept

In the private `quote-files` storage bucket in Supabase, for 90 days, then
deleted automatically. WhatsApp itself only keeps a file for about 30 days.

## Switching it on

1. In Supabase, run `supabase/migrations/0085_quote_customer_files.sql`.
2. On Railway, add `QUOTE_CUSTOMER_FILES=true`.
