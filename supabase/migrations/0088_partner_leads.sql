-- The partnerships list on the owner dashboard (/dashboard/partners).
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
-- Running it again is safe.
--
-- Each row is an event, fair or organiser we pitch an in-kind partnership to:
-- who to reach, what we offered, how far it has got, and when to follow up.

create table if not exists public.partner_leads (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  -- e.g. "Festival", "Market or fair", "Campus".
  kind text,
  event_date date,
  place text,
  -- Who to reach and how: a name, email, phone or social handle.
  contact text,
  offer text,
  status text not null default 'To contact'
    check (status in ('To contact', 'Sent', 'Replied', 'Meeting', 'Agreed', 'Declined', 'No reply')),
  sent_on date,
  follow_up_on date,
  link text,
  notes text
);

create index if not exists partner_leads_follow_up_on_idx on public.partner_leads (follow_up_on);

-- Only the app (service role) can read or write it.
alter table public.partner_leads enable row level security;

-- The leads found so far (14 Nov 2026), added only while the list is empty.
insert into public.partner_leads (name, kind, event_date, place, contact, offer, status, sent_on, follow_up_on, link, notes)
select v.name, v.kind, v.event_date::date, v.place, v.contact, v.offer, v.status, v.sent_on::date, v.follow_up_on::date, v.link, v.notes
from (values
  ('Festival of African Cuisine (Lagos)', 'Festival', '2026-12-19', 'Muson Garden, Onikan', 'info@africanfestivalcuisine.com · 0802 656 6794', 'Vendor shops, guest assistant, tickets, code FOODFEST26 (50%)', 'Sent', '2026-11-14', '2026-11-19', null, 'Emailed from useyarnoga@gmail.com. Eventbrite still says Sun 20 Dec at Muson Centre: confirm the date.'),
  ('Akwa Ibom Christmas Unplugged', 'Government', '2026-11-30', 'Unity Park, Uyo', 'Dr. Anieti Udofia, Commissioner for Culture & Tourism (Facebook Messenger)', 'Vendor shops, visitor assistant, tickets, code UNPLUGGED26 (50%)', 'To contact', null, '2026-11-16', null, 'Messenger intro first, then the PDF letter. Festival opens 30 Nov.'),
  ('Detty December Fest', 'Festival', '2026-12-18', 'Lagos', 'Partner form on dettydecfest.com (Brand partner); replies from info@dettydecfest.com', 'Vendor shops, food and drinks guide, code DETTYDEC26 (50%)', 'To contact', null, null, 'https://dettydecfest.com', 'Runs 18–30 Dec. Letter ready to send when they reply.'),
  ('TEDxUNIUYO', 'TEDx', '2026-11-28', 'University of Uyo', 'TEDxUNIUYO organising team', 'Event assistant, tickets, code TEDXUNIUYO (70%)', 'To contact', null, null, null, 'They approached us. Letter ready 13 Nov: change to Sent once delivered.'),
  ('VCITRADEFAIR 3.0 – Jara Exclusive', 'Market or fair', '2026-12-04', 'Ikorodu Fun Park, Itamaga', 'Vendors Connect International Media Ltd (Eventbrite organiser page)', null, 'To contact', null, null, 'https://www.eventbrite.com/e/vcitradefair-30-jara-exclusive-tickets-2004159851065', 'Three days of shopping. Vendor-focused organiser.'),
  ('The Luxury Resale Emporium (5th edition)', 'Market or fair', '2026-11-28', 'Ikoyi', 'Zeclutter! · IG @theluxuryresaleemporium_ / @zeclutter', null, 'To contact', null, null, 'https://www.eventbrite.com/e/the-luxury-resale-emporium-lre-2026-5th-edition-tickets-2003678557503', 'Runs 28–29 Nov. Resale and thrift sellers.'),
  ('The Amala and Palmwine Festival 2.0', 'Festival', '2026-12-13', 'The Stable, Surulere', 'Blackboyafrika (Eventbrite organiser page)', null, 'To contact', null, null, 'https://www.eventbrite.com/e/the-amala-and-palmwine-festival-20-tickets-2002313797469', 'Food vendors: reuse the Festival of African Cuisine letter.'),
  ('CONNEXA 2026', 'Campus', '2026-11-28', 'University of Lagos, Akoka', 'Zidepeople (Eventbrite organiser page)', null, 'To contact', null, null, 'https://www.eventbrite.com/e/connexa-2026-the-opportunity-playground-tickets-1993124747774', null),
  ('ASO OKE FEST 2026', 'Festival', '2026-12-04', 'J. Randle Centre, Onikan', null, null, 'To contact', null, null, 'https://www.eventbrite.com/e/aso-oke-fest-2026-tickets-2004472781047', 'Weavers and fashion artisans.'),
  ('The Muslim Entrepreneur', 'Conference', '2026-12-12', 'FCE (Technical) Akoka', 'Falah Conclave (Eventbrite organiser page)', null, 'To contact', null, null, 'https://www.eventbrite.com/e/the-muslim-entrepreneur-tickets-2003647765403', null),
  ('Ajah/Lekki Monthly Trade Fair', 'Market or fair', null, 'Ajah, Lagos', 'Facebook page "Ajah/Lekki Monthly Trade Fair"', null, 'To contact', null, null, 'https://www.facebook.com/AjahLekkiMontnlyTradeFair/', 'Last Fri–Sun of each month, if still running.'),
  ('Nigeria Female Entrepreneurs Conference', 'Conference', '2027-03-20', '13 Oki Lane, Lagos', 'Atlas Holdings (Eventbrite organiser page)', null, 'To contact', null, null, 'https://www.eventbrite.com/e/nigeria-female-entrepreneurs-conference-tickets-1980536375614', null),
  ('TEDxUNTH', 'TEDx', '2026-12-05', 'UNTH, Ituku-Ozalla, Enugu', 'Organiser on the TED event page', null, 'To contact', null, null, 'https://www.ted.com/tedx/events/70272', null),
  ('TEDxEBSU', 'TEDx', '2027-01-30', 'Ebonyi State University, Abakaliki', 'Organiser on the TED event page', null, 'To contact', null, null, 'https://www.ted.com/tedx/events/69862', null),
  ('Dutse-PE 4th Mega Trade Fair (Abuja)', 'Market or fair', '2026-12-03', 'Dutse-PE Model Market, Kubwa', null, null, 'To contact', null, null, 'https://www.eventbrite.com/e/dutse-pe-4th-mega-trade-fair-tickets-2002196047275', 'Runs 3–6 Dec.'),
  ('Made in Ghana Fair 2026', 'Market or fair', '2026-12-04', 'Kwame Nkrumah Memorial Park, Accra', null, null, 'To contact', null, null, 'https://www.eventbrite.co.uk/e/made-in-ghana-fair-2026-tickets-2002661818409', null),
  ('Accra Christmas Village 2026', 'Market or fair', '2026-12-21', 'Olympic Park, University of Ghana, Legon', 'accrachristmasvillage.com', null, 'To contact', null, null, 'https://accrachristmasvillage.com/', 'Runs 21–27 Dec, 60+ vendors.'),
  ('Bizarre Bazaar Christmas Festival (Nairobi)', 'Market or fair', '2026-12-11', 'KSTVET, Gigiri, Nairobi', 'bizbazevents.com', null, 'To contact', null, null, 'https://bizbazevents.com/eventpage', 'Runs 11–13 Dec, 200+ vendors.')
) as v(name, kind, event_date, place, contact, offer, status, sent_on, follow_up_on, link, notes)
where not exists (select 1 from public.partner_leads);
