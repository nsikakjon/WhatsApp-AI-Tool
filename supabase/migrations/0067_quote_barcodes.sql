-- Barcodes on the price list, for scanning at the counter (QUOTE_BARCODES).
-- Run this once in Supabase: SQL Editor > New query > paste > Run
-- (after 0060). Running it again is safe.
--
-- Each price list option can carry the number printed under its barcode
-- (EAN-13 on most packaged goods, or a shop's own code). Scanning it on the
-- counter sale screen adds one of that option to the sale. The app checks
-- that a barcode is on only one option of the business.

alter table public.quote_variants
  add column if not exists barcode text check (barcode is null or barcode ~ '^[0-9A-Za-z./+-]{1,48}$');

