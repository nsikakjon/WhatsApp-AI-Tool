# Business verification (KYB) and the compliance page

So yarnOga knows every business it works for, each owner sends their
registration details and documents from the app, and Jay reviews them.

## What the owner does

In the app (owners only): **Verify business** in the menu. Until they're
verified, the dashboard shows a reminder.

1. **Your business**: registered company (RC number), registered business
   name (BN number) or not registered yet; the registered name, the number,
   TIN (optional), address, the director's or owner's name, email (optional).
2. **Documents** (PDF, PNG or JPG, up to 5 MB each):

   | | Company | Business name | Not registered |
   |---|---|---|---|
   | Certificate | required | required | |
   | CAC status report | required | | |
   | ID of a director or the owner | required | required | required |
   | Proof of address (last 3 months) | required | required | required |
   | Memorandum and Articles, operating licence, others | optional | optional | optional |

3. **Send for review**: only possible once everything required is there.
   After that the details are locked until Jay asks for more or rejects.

Jay gets a WhatsApp and email alert for each business that sends its details
(the same alert settings as docs/MONITORING.md).

Files only check out as real PDFs or pictures (not just named like one). They
are kept in a private Supabase Storage bucket (`kyb-documents`) and only ever
opened through the server, by the owner in the app or by Jay on the
compliance page. No BVN or NIN numbers are stored, only the uploaded ID.

## What Jay does

Open `https://<your-railway-url>/compliance` (the browser asks for a
password: type anything as the username and `COMPLIANCE_PASSWORD`).

- The list puts **Waiting for review** first, with counts for every status.
- **Review** shows the details, every document (opens in a new tab), what's
  missing, and the history of submissions and decisions.
- **CAC register**:
  - **Search CAC yourself (free)** opens the official public search at
    search.cac.gov.ng: type the RC or BN number shown on the page.
  - **Check with CAC (Dojah)**, when Dojah is set up, fetches the company's
    registered name, status, registration date, address and directors, and
    says whether the name matches what the owner typed.
- **Decision**: Approve, Ask for more, or Reject. Asking for more and
  rejecting need a note, which the owner gets on WhatsApp from their
  business's own number (if they've written to it in the last day; otherwise
  they see it in the app).

What to check: the names on the certificate, the CAC register and the ID
match; the documents are clear and not edited; the address is real.

## Switching it on

1. **Supabase**: run `supabase/migrations/0050_business_verification.sql`
   (it also makes the private `kyb-documents` storage bucket).
2. **Railway**: `COMPLIANCE_PASSWORD` (at least 12 characters). The owner app
   (`OWNER_APP=true`) must be on too: that's where owners send their details.

## Automatic CAC checks (optional): Dojah

There's no free official CAC API. Dojah is a Nigerian verification company
with a free test sandbox and pay-as-you-go live checks (roughly $0.04 to
$0.06 each at the time of writing; the exact CAC price shows in your Dojah
dashboard). A check only runs when Jay presses the button, so there's no
surprise bill.

1. Sign up at [dojah.io](https://dojah.io) and create an app.
2. On Railway set `DOJAH_APP_ID`, `DOJAH_SECRET_KEY` and `DOJAH_SANDBOX=true`
   to try it with test data (RC numbers 1261103 or 14320749 work there).
3. When happy, switch the keys to the live ones, set `DOJAH_SANDBOX=false`,
   and fund the Dojah wallet. An empty wallet shows as a clear message on the
   page, not an error.

Other providers (Prembly, Youverify, Smile ID) also do CAC checks; Dojah was
picked because it has a free sandbox and pay-per-check pricing with no
minimum. Swapping provider means a new `Registry` in `src/compliance/registry.ts`.
