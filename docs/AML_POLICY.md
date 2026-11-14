# yarnOga anti-money-laundering policy

How yarnOga keeps shops' payments from being used to launder money or fund
terrorism, written against the Money Laundering (Prevention and Prohibition)
Act 2022 ("the Act"). This is our working policy, not legal advice: have a
lawyer confirm the points marked **To confirm**.

Owner of this policy and compliance officer: the founder (jay). Reviewed every
year in November, and whenever the products or the law change.

## Where yarnOga sits

- Shops' customers pay by Paystack (naira) or Flutterwave (other currencies).
  The money settles straight to each shop's own bank through its subaccount,
  so yarnOga doesn't hold it. Paystack and Flutterwave are the licensed
  financial institutions and file their own reports.
- One exception: the **payout balance** (rider and staff payouts). Shops add
  money to a balance held in yarnOga's Paystack account and it's paid out by
  transfer. This is the part of yarnOga closest to a money service business.
- Refunds and chargebacks come back to yarnOga's Paystack account, so Paystack
  holds yarnOga responsible for the shops it brings on.
- Many of our shops are themselves "designated non-financial businesses"
  under s.30 (supermarkets, hotels and hospitality, real estate, car dealers,
  jewellers, consultants) with their own duties, such as registering with the
  Special Control Unit Against Money Laundering (SCUML). That's theirs to do.

**To confirm** with a lawyer: whether yarnOga itself must register with SCUML
or the NFIU, and whether the payout balance needs a licence or a change
(for example paying out from the shop's own account instead).

## 1. Knowing the shop (s.4)

Every shop that wants bigger online payments verifies its business in the
owner app (More > Verify business):

- type of business, registered name, RC or BN number, address, TIN
- the director's or owner's name and ID, proof of address, CAC certificate
  (and status report for companies)
- whether anyone who owns or runs it holds or has held a senior public office
  (politically exposed person, s.4(7))

On submission, yarnOga screens the business, its owner and its bank account
name against the UN Security Council list (which Nigeria follows) and the US
Treasury SDN list. jay reviews on the compliance page: documents, the CAC
register (Dojah or the free CAC search), screening matches and the bank
account, then approves, asks for more or rejects. Each approval screens again.

**Beneficial owner (s.4(1)(c))**: for a company, the people the CAC register
lists as directors and shareholders. The ID must belong to one of them.

**Bank account**: Paystack checks every invoice account with the bank, and
the bank's name for it (backed by the account holder's BVN) must match the
verified business or owner. If it doesn't, the shop keeps the unverified
limits. This is how we check identity against official records without a
paid identity service.

**Politically exposed persons (s.4(8)-(9))**: a "yes" doesn't stop a shop, but
before approving jay asks where the business's money comes from, records the
answer in the note, and watches its payments more closely.

## 2. Limits until verified

| | Not verified | Verified |
| --- | --- | --- |
| One pay-link payment | ₦200,000 | no yarnOga limit |
| Pay links in a month (orders, tickets, monthly payments) | ₦1,000,000 | no yarnOga limit |
| Adding to the payout balance in a month | ₦200,000 | no yarnOga limit |

Other currencies: about the same (100 and 500 times the fee cap). Paystack's
and Flutterwave's own limits always apply. Over a limit, the invoice goes with
the shop's bank details instead of a link and the owner is told to verify.

## 3. Watching payments (s.4(3), s.7(1))

After every order or monthly payment, the shop's last five weeks are checked.
jay gets an urgent alert (WhatsApp and email), at most once a day per kind,
and it's kept in the shop's history on the compliance page:

- **Big payment**: one payment of ₦5m or more (the s.11 reporting line for
  individuals).
- **Just under the limit**: three or more payments of ₦180,000 to ₦200,000 in a
  week from an unverified shop (splitting, s.2(2)).
- **Same payer**: one customer paying five or more times in a day.
- **Sudden jump**: ₦500,000 or more in a week and five times the shop's usual
  week, or a new shop taking that much in its first week.

## 4. When something looks wrong (s.7)

1. Look at the shop's orders and the alert. Does it fit what the shop sells
   and its usual sales?
2. If not, **pause its payments** on the compliance page (Payments > Pause).
   Pay links, monthly payment links and payouts stop at once; orders still come
   in and the shop can take cash or transfers. The note to the owner should be
   neutral ("We're reviewing some recent payments"). Don't tell the shop you
   suspect money laundering.
3. **Within 24 hours** (s.7(2)), write down what you saw and why, and report it
   to Paystack (or Flutterwave) compliance, who report to the NFIU. If the
   lawyer confirms yarnOga must report directly, file it on the NFIU's goAML
   portal too.
4. Keep the shop paused until it's resolved. A confirmed sanctions match is
   never approved or resumed.

## 5. Records (s.8)

Kept for at least **5 years** after the shop leaves yarnOga, and available to
the authorities on request (s.9):

- verification details, documents and decisions (Supabase tables
  `quote_business_verifications`, `quote_business_documents`,
  `quote_verification_events` and the `kyb-documents` storage bucket)
- every payment (`payments`) and order (`quote_orders`)
- alerts, screenings, pauses and the notes on them (`quote_verification_events`)

A business is never deleted, only switched off. Since migration 0087 the
database refuses to delete a business that has verification records.

## 6. Training and review (s.10)

- Anyone who reviews verifications reads this policy first and once a year.
- Every November: review this policy, the limits and the alert rules, and the
  verified shops with the most payments.

## Switching it on

1. Supabase: run `supabase/migrations/0087_aml_controls.sql`.
2. Railway: `AML_CONTROLS=true` (and `COMPLIANCE_PASSWORD` for the
   compliance page, if not already set).
