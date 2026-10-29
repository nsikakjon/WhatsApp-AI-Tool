# Free WhatsApp reply generator (yarnoga.com)

A free tool on the website: a visitor describes their business in a sentence or
two and gets either

- **WhatsApp Business messages**: a greeting message, an away message and five
  quick replies, ready to paste into the WhatsApp Business app, or
- **an AI assistant prompt**: instructions they could give an AI that answers
  their customers.

Under the answer, the page invites them to let yarnOga run a real assistant for
them. It is a way to bring people to the site and start conversations.

## How it works

The page on yarnoga.com (`reply-generator.html`) sends the description to this
app at `/tools/reply-generator`. The app asks Claude to write the text and sends
it back. The tool never touches the WhatsApp bots or the database.

The AI is told never to make up prices, phone numbers, addresses or opening
hours. It leaves blanks like `[price]` for the business owner to fill in.

## Keeping the cost under control

- It is **off** until you switch it on.
- Only the yarnoga.com website can use it.
- Each visitor gets 5 answers a day, and all visitors together get 200 a day.
  You can change both numbers. The counts start again at midnight (Lagos time)
  and also when the app restarts.

## Switching it on (Railway)

1. Open the app on Railway, then the **Variables** tab.
2. Add `REPLY_GENERATOR_ENABLED` with the value `true`.
   `ANTHROPIC_API_KEY` is already there for the bots and is reused.
3. Optional: `REPLY_GENERATOR_VISITOR_LIMIT` (default 5) and
   `REPLY_GENERATOR_DAILY_LIMIT` (default 200).
4. Wait for Railway to redeploy, then open
   `https://app.yarnoga.com/tools/reply-generator`
   in a browser. It should show `{"ok":true}`.
5. Upload the website files (including `reply-generator.html`) to Hostinger.

To switch it off again, set `REPLY_GENERATOR_ENABLED` to `false`. The page then
tells visitors the tool is resting and points them to email instead.
