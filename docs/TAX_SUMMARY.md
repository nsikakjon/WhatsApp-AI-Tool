# Tax summary

A page in the owner app (**Tax summary**, owners only) that adds up each
month's sales so the owner, or their accountant, has the figures ready for a
VAT return or the 1% presumptive tax. It is a set of plain sums, not tax
advice, and the page says so.

## What it shows

For each month of the chosen year (this year by default, with links to
earlier years):

| Column            | What it is                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Orders paid       | WhatsApp and shop orders marked paid (by pay link or by the owner), in the month they were paid. Includes delivery fees. |
| Counter sales     | Sales rung up at the counter. Cancelled sales are left out.                                  |
| Total sales       | The two added together.                                                                      |
| VAT inside (7.5%) | 3/43 of the total (7.5 of every 107.5), for a VAT-registered business whose prices include VAT. |
| 1% of sales       | The presumptive tax rate.                                                                    |

Quotes and unpaid orders never count. All sums are whole kobo; naira only
appears on screen and in the CSV.

It also shows the last 12 months' sales against three lines from the 2026
rules (Nigeria Tax Act 2025 and the Presumptive Tax Regulations 2026):

- **₦12 million**: up to this, with no fixed premises and no staff, the
  presumptive tax doesn't apply.
- **₦50 million**: the Act's small company line (fixed assets up to ₦250
  million, not professional services): 0% company tax and no VAT to charge.
- **₦100 million**: the figure some 2026 government guidance uses for the same
  line. The page tells the owner to confirm with NRS or their accountant.

If the rules change, the lines are the three `*_KOBO` numbers at the top of
`src/owner/sections/tax.ts`, and the wording sits in the same file.

**Download CSV** gives the same table for the year, for an accountant or a
spreadsheet.

Only businesses whose prices are in naira see the figures.

## Switching it on

1. In Railway, set `QUOTE_TAX_SUMMARY=true`.
2. That's all: no migration. Counter sales are included only when
   `QUOTE_COUNTER_SALES` is also on.
