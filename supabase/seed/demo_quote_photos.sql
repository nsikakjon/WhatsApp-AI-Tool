-- Product photos for the yarnOga Demo Shop: real photos from Pexels (free
-- licence), so customers trying the demo get pictures with their quote.
--
-- Run this in Supabase (SQL Editor > New query > paste > Run) after
-- demo_quote_business.sql and migration 0037_quote_catalogue_photos_stock.sql.
-- It is safe to run again. Photos are only sent while QUOTE_CATALOGUE=true.
--
-- Credits (Pexels pages):
--   Branded T-shirts        https://www.pexels.com/photo/white-t-shirt-on-white-surface-12039633/
--   Branded mugs            https://www.pexels.com/photo/a-white-ceramic-mug-on-a-white-surface-11075707/
--   Branded bottled water   https://www.pexels.com/photo/close-up-photo-of-water-bottles-11860562/
--   Cupcakes                https://www.pexels.com/photo/cupcakes-decorated-with-red-and-pink-icing-and-sprinkles-8874015/
--   Souvenir bags           https://www.pexels.com/photo/paper-bag-1748867/
--   Custom celebration cakes https://www.pexels.com/photo/birthday-cake-1684039/

update public.quote_products p
set photo_path = 'https://images.pexels.com/photos/' || v.photo || '/pexels-photo-' || v.photo || '.jpeg?auto=compress&cs=tinysrgb&w=1200',
    updated_at = now()
from (
  values
    ('t-shirts', '12039633'),
    ('mugs', '11075707'),
    ('water', '11860562'),
    ('cupcakes', '8874015'),
    ('souvenir-bags', '1748867'),
    ('custom-cakes', '1684039')
) as v(slug, photo)
where p.business_id = '00000000-0000-0000-0000-000000000002' and p.slug = v.slug;
