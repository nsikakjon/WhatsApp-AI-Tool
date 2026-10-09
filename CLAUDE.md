# CLAUDE.md

Guidance for Claude (and any developer) working on this codebase.

## Project overview

A WhatsApp AI platform for Nigerian businesses. Customers talk to a business on
WhatsApp (text or voice notes), and an AI assistant handles the conversation for
that business. Three products are built on one shared WhatsApp core:

1. **Quote and order bot**: gives customers price quotes, takes orders and collects
   payment. First client: **KahnPrints** (the owner's print shop).
2. **Construction site progress reporter**: site teams send updates (text, photos,
   voice notes) over WhatsApp, and the bot turns them into progress reports.
3. **Real estate lead qualifier**: chats with property enquiries, asks qualifying
   questions and hands promising leads to an agent.

The owner is not a developer, so explanations matter as much as the code.

## Stack

| Concern            | Choice                                   |
| ------------------ | ---------------------------------------- |
| Language / runtime | Node.js + TypeScript                     |
| Web server         | Hono                                     |
| Database & files   | Supabase (Postgres + Storage)            |
| Messaging          | Meta WhatsApp Cloud API                  |
| Voice notes        | Groq Whisper (speech to text)            |
| AI                 | Anthropic API, Claude Haiku              |
| Payments           | Paystack                                 |
| Hosting            | Railway                                  |

## Architecture

- **One WhatsApp core, separate product modules.** The core owns everything
  shared: receiving and verifying webhooks, sending messages, downloading media,
  transcribing voice notes, calling the AI, and routing each incoming message to
  the right product.
- Each product (quote/order bot, site reporter, lead qualifier) lives in its own
  module and talks to the core through a clear interface. Products do not import
  from each other. Adding a fourth product should not require changing the other
  three.

## Rules

These are non-negotiable.

1. **Secrets live in `.env` and are never committed.**
   - `.env` is in `.gitignore`.
   - Keep an up-to-date `.env.example` listing every variable with a placeholder
     value and a short comment. Update it in the same commit that adds a new
     variable.
   - Never hard-code keys, tokens or phone number IDs in code, tests or docs.

2. **Prices always come from the database, never from the AI.**
   - The AI may understand what the customer wants, but any price, total or
     discount shown to a customer or charged through Paystack is looked up and
     calculated in code from the database.
   - Never let a model-generated number reach a quote, invoice or payment.

3. **Money is stored in kobo as integers.**
   - ₦1 = 100 kobo. Use integer columns (e.g. `price_kobo bigint`) and integer
     arithmetic. No floats or decimals for money.
   - Convert to naira only when formatting text for display.

4. **Every webhook verifies its signature and is idempotent.**
   - WhatsApp: verify the `X-Hub-Signature-256` header against the app secret.
   - Paystack: verify the `x-paystack-signature` header against the secret key.
   - Reject requests that fail verification before doing any work.
   - Record each event's unique ID (WhatsApp message ID, Paystack reference/event)
     and skip duplicates, so a retried webhook never sends a second reply,
     creates a second order or marks a payment twice.

5. **Products are separate modules sharing one WhatsApp core** (see Architecture).

6. **Small commits, plain explanations for a non-developer.**
   - One focused change per commit, with a clear message.
   - When explaining work, say what changed and why in everyday language, avoid
     jargon (or explain it when unavoidable), and say what the owner needs to do,
     if anything (for example, add a new value to `.env` on Railway).
