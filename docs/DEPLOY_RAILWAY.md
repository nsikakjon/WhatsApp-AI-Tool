# Deploying to Railway (and setting up Supabase)

This gets the server running on the internet at a public web address, which
Meta needs so it can deliver WhatsApp messages to it. Do the Supabase part
first, because the server needs the database details to start.

You'll need: a GitHub account (with this code in a repository), a Supabase
account, and a Railway account. All have free tiers that are enough for Phase 0.

---

## Part 1: Supabase (the database)

1. Go to <https://supabase.com>, sign in, and click **New project**.
   - Name: anything, e.g. `whatsapp-platform`.
   - Database password: click **Generate**, and save it in your password manager.
   - Region: pick the one closest to Nigeria that's offered (e.g. **West EU (London)**
     or **Central EU (Frankfurt)**).
2. Wait a minute or two for the project to finish setting up.
3. Create the tables:
   - In the left sidebar, open **SQL Editor**, then **New query**.
   - Open `supabase/migrations/0001_contacts_and_messages.sql` from this repository,
     copy all of it, paste it into the editor and click **Run**.
   - You should see "Success. No rows returned".
   - Open **Table Editor** in the sidebar: you should now see `contacts` and `messages`.
4. Copy two values you'll need for Railway (sidebar: **Project Settings**):
   - **Project URL** (under **Data API** or **API**): looks like
     `https://abcdefgh.supabase.co`. This is `SUPABASE_URL`.
   - **service_role** key (under **API Keys**; you may need to click **Reveal**).
     This is `SUPABASE_SERVICE_ROLE_KEY`.
     Treat it like a master password: it can read and change everything. Only
     ever paste it into Railway or your local `.env`, never anywhere public.

---

## Part 2: Railway (the server)

1. Go to <https://railway.com>, sign in with GitHub.
2. Click **New Project** > **Deploy from GitHub repo**, and pick this repository.
   (If Railway can't see it, click **Configure GitHub App** and give it access.)
3. Railway starts building straight away. The first build will **crash**, because
   it doesn't have the settings yet. That's expected.
4. Click on the service (the box with the repository's name), open the
   **Variables** tab, and click **Raw Editor**. Paste this, then replace each
   placeholder with the real value:

   ```
   WHATSAPP_VERIFY_TOKEN=make-up-a-long-random-string
   WHATSAPP_APP_SECRET=from-meta
   WHATSAPP_ACCESS_TOKEN=from-meta
   WHATSAPP_PHONE_NUMBER_ID=from-meta
   WHATSAPP_GRAPH_API_VERSION=v23.0
   SUPABASE_URL=from-supabase
   SUPABASE_SERVICE_ROLE_KEY=from-supabase
   ```

   - `WHATSAPP_VERIFY_TOKEN`: invent this yourself. Any long random string,
     e.g. from a password generator. You'll type the same value into Meta later.
   - The other three `WHATSAPP_` values come from the Meta setup guide
     ([META_SETUP.md](META_SETUP.md), steps 3 and 4).
   - Don't add `PORT`: Railway sets it automatically.

   Click **Update Variables**, then **Deploy** when Railway asks. It rebuilds
   with the new settings.
5. Give the server a public address: open the service's **Settings** tab, find
   **Networking** > **Public Networking**, and click **Generate Domain**. If it
   asks for a port, leave the one it suggests. You'll get something like
   `https://whatsapp-platform-production.up.railway.app`.
6. Check it's alive: open `https://<your-domain>/health` in a browser. You
   should see `{"ok":true}`.

Your webhook URL for Meta is then:

```
https://<your-domain>/webhooks/whatsapp
```

### Seeing what the server is doing

Open the service, then **Deployments** > the latest deployment > **View logs**
(or the **Logs** tab). Useful lines you'll see:

| Log line | Meaning |
| --- | --- |
| `Server listening on port ...` | Started fine. |
| `Missing required environment variable: X` | A variable from step 4 is missing or misspelled. |
| `WhatsApp webhook verified` | Meta's webhook check passed. |
| `WhatsApp webhook verification failed` | The verify token in Meta doesn't match `WHATSAPP_VERIFY_TOKEN`. |
| `Rejected WhatsApp webhook with invalid signature` | `WHATSAPP_APP_SECRET` is wrong. |
| `WhatsApp send failed (401)` | Access token is wrong or has expired. |
| `Skipping duplicate message` | Meta re-sent a message we already answered. Normal. |

### Changing a setting later

Edit it in the **Variables** tab. Railway redeploys automatically with the new value.

### Deploying code changes

Every push to the repository's main branch redeploys automatically.

---

## Running it on your own computer (optional)

Only needed if you want to try changes before pushing. Needs Node.js 20 or newer.

```bash
npm install
cp .env.example .env   # then fill in the real values in .env
npm run dev            # starts the server on http://localhost:3000
npm test               # runs the automated checks
```

Meta can't reach `localhost`, so real WhatsApp messages only arrive at the
Railway deployment.
