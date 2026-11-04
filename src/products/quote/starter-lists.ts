// Starter price lists for common Nigerian trades, offered at chat sign-up once
// we know what the business does, so a new owner edits a list instead of
// facing a blank page. The prices are written here by us, from what such
// businesses commonly charge; they only reach customers after the owner has
// seen the list, changed what they want and replied YES. Prices are in naira
// as typed on a price list; readPriceList turns them into kobo.

interface StarterRow {
  product: string;
  option?: string;
  price: number;
  min?: number;
  /** Bulk price starting at this quantity. */
  from?: number;
}

interface Starter {
  /** "a barber", for "Here's a starter price list for a barber". */
  trade: string;
  match: RegExp;
  rows: StarterRow[];
}

// First match wins, so specific trades come before general ones.
const STARTERS: Starter[] = [
  {
    trade: "a barber",
    match: /barb|hair\s*cut|cut(ting)?\s+hair|low\s*cut/,
    rows: [
      { product: "Low cut", price: 1200 },
      { product: "Skin cut", price: 1500 },
      { product: "Fade", option: "punk or taper", price: 2000 },
      { product: "Beard trim and shape", price: 1000 },
      { product: "Haircut and beard", price: 2500 },
      { product: "Hair dye", option: "black", price: 2500 },
      { product: "Children's haircut", price: 1000 },
      { product: "Home service", option: "within the area", price: 5000 },
    ],
  },
  {
    trade: "a hair salon",
    match: /salon|braid|weav|stylist|hairdress|cornrow|knotless|wig\s*install/,
    rows: [
      { product: "Knotless braids", option: "medium, hair not included", price: 25000 },
      { product: "Box braids", option: "medium, hair not included", price: 20000 },
      { product: "Cornrows", option: "all back", price: 5000 },
      { product: "Ghana weaving", price: 8000 },
      { product: "Wig installation", option: "frontal", price: 15000 },
      { product: "Relaxer and set", price: 8000 },
      { product: "Wash and set", price: 5000 },
    ],
  },
  {
    trade: "a nail studio",
    match: /nail|manicure|pedicure/,
    rows: [
      { product: "Gel polish", option: "hands", price: 5000 },
      { product: "Acrylic nails", option: "full set", price: 12000 },
      { product: "Manicure", price: 4000 },
      { product: "Pedicure", price: 6000 },
      { product: "Press-on nails", option: "set of 24", price: 4000 },
    ],
  },
  {
    trade: "a makeup artist",
    match: /make\s*-?up|\bmua\b|gele/,
    rows: [
      { product: "Soft glam", price: 15000 },
      { product: "Soft glam and gele", price: 20000 },
      { product: "Gele tying", price: 5000 },
      { product: "Bridal makeup", option: "with gele", price: 80000 },
      { product: "Bridal trial", price: 20000 },
    ],
  },
  {
    trade: "a tailor",
    match: /tailor|sew|fashion\s*design|aso\s*-?ebi|native\s*wear|kaftan|agbada|bespoke/,
    rows: [
      { product: "Senator or kaftan", option: "sewing only", price: 25000 },
      { product: "Agbada", option: "3 pieces, sewing only", price: 60000 },
      { product: "Ankara gown", option: "sewing only", price: 18000 },
      { product: "Aso ebi gown", option: "sewing only", price: 35000 },
      { product: "Trousers", option: "sewing only", price: 10000 },
      { product: "Adjustment", price: 3000 },
    ],
  },
  {
    trade: "a small chops business",
    match: /small\s*chops?|puff[\s-]*puff|samosa|finger\s*food/,
    rows: [
      { product: "Small chops pack", option: "puff-puff, samosa, spring roll, chicken", price: 3500, min: 10 },
      { product: "Puff-puff", option: "bowl of 50", price: 5000 },
      { product: "Peppered chicken", option: "per piece", price: 2500 },
      { product: "Peppered gizzard", option: "per plate", price: 3000 },
    ],
  },
  {
    trade: "a cake and pastry business",
    match: /cake|bak(e|ing|ery)|pastr|cupcake|bread/,
    rows: [
      { product: "Birthday cake", option: "8 inch, 2 layers", price: 35000 },
      { product: "Birthday cake", option: "10 inch, 2 layers", price: 50000 },
      { product: "Cupcakes", option: "box of 6", price: 6000 },
      { product: "Banana bread", option: "loaf", price: 4000 },
      { product: "Meat pie", price: 1000, min: 10 },
    ],
  },
  {
    trade: "a drinks business",
    match: /zobo|smoothie|juice|parfait|tiger\s*nut|kunu|chapman/,
    rows: [
      { product: "Zobo", option: "50cl", price: 1000 },
      { product: "Zobo", option: "1 litre", price: 1800 },
      { product: "Tigernut drink", option: "50cl", price: 1500 },
      { product: "Smoothie", option: "50cl", price: 3000 },
      { product: "Parfait", option: "medium cup", price: 3500 },
    ],
  },
  {
    trade: "a food business",
    match: /\bfood\b|restaurant|kitchen|cater|buka|jollof|eatery|chef|amala|soup/,
    rows: [
      { product: "Jollof rice and chicken", price: 4500 },
      { product: "Fried rice and chicken", price: 4500 },
      { product: "Amala, ewedu and assorted meat", price: 4000 },
      { product: "Pounded yam and egusi with beef", price: 4500 },
      { product: "Party jollof rice", option: "cooler, about 50 plates", price: 150000 },
      { product: "Soft drink", option: "50cl", price: 600 },
    ],
  },
  {
    trade: "a printing business",
    match: /print|branding|flyer|banner|signage/,
    rows: [
      { product: "Flyers", option: "A5, full colour, one side", price: 60, min: 100 },
      { product: "Flyers", option: "A5, full colour, one side", price: 45, min: 100, from: 1000 },
      { product: "Business cards", option: "pack of 100", price: 6000 },
      { product: "Branded T-shirts", option: "one-colour print", price: 5000, min: 10 },
      { product: "Branded T-shirts", option: "one-colour print", price: 4200, min: 10, from: 50 },
      { product: "Roll-up banner", price: 25000 },
      { product: "Branded mugs", price: 3500, min: 6 },
    ],
  },
  {
    trade: "a laundry",
    match: /laundr|dry\s*clean|wash\s*(and|&)\s*iron/,
    rows: [
      { product: "Shirt", option: "wash and iron", price: 700 },
      { product: "Trousers", option: "wash and iron", price: 700 },
      { product: "Native wear", option: "2 pieces", price: 1500 },
      { product: "Suit", option: "2 pieces, dry clean", price: 3500 },
      { product: "Bedsheet set", price: 1500 },
      { product: "Duvet", price: 5000 },
    ],
  },
  {
    trade: "a car wash",
    match: /car\s*wash|detailing/,
    rows: [
      { product: "Car wash", option: "saloon car", price: 3000 },
      { product: "Car wash", option: "SUV", price: 4000 },
      { product: "Engine wash", price: 2000 },
      { product: "Interior and exterior detailing", price: 15000 },
    ],
  },
  {
    trade: "a phone repairer",
    match: /(phone|gadget)s?\s*(repair|fix|technician)|repair(ing)?\s*(of\s*)?phones?|screen\s*replace/,
    rows: [
      { product: "Screen replacement", option: "Android, mid-range", price: 30000 },
      { product: "Battery replacement", option: "Android", price: 15000 },
      { product: "Charging port repair", price: 8000 },
      { product: "Software flashing", price: 5000 },
    ],
  },
  {
    trade: "a photographer",
    match: /photograph|photo\s*studio|\bshoots?\b|videograph/,
    rows: [
      { product: "Studio shoot", option: "3 edited pictures", price: 15000 },
      { product: "Birthday shoot", option: "outdoor, 10 edited pictures", price: 30000 },
      { product: "Event coverage", option: "half day", price: 100000 },
      { product: "Passport photos", option: "4 copies", price: 2000 },
    ],
  },
  {
    trade: "an event rentals and decor business",
    match: /decor|event\s*rental|canop|chairs?\s*(and|&)\s*tables?|party\s*rental/,
    rows: [
      { product: "Chair rental", option: "plastic", price: 300, min: 50 },
      { product: "Table rental", option: "with cover", price: 2000 },
      { product: "Canopy rental", option: "20 seats", price: 10000 },
      { product: "Hall decoration", option: "basic", price: 150000 },
    ],
  },
  {
    trade: "a cleaning business",
    match: /clean|fumigat/,
    rows: [
      { product: "Deep cleaning", option: "2-bedroom flat", price: 40000 },
      { product: "Post-construction cleaning", option: "3-bedroom flat", price: 100000 },
      { product: "Fumigation", option: "2-bedroom flat", price: 30000 },
      { product: "Sofa cleaning", option: "per seat", price: 5000 },
    ],
  },
];

export interface StarterList {
  trade: string;
  /** In the setup screen's CSV format, the same as a typed or uploaded list. */
  csv: string;
}

/** A starter price list for the business, judged from its name and what it sells, or null when none fits. */
export function starterList(businessName: string | null, description: string | null): StarterList | null {
  const about = `${businessName ?? ""} ${description ?? ""}`.toLowerCase();
  const starter = STARTERS.find((s) => s.match.test(about));
  if (!starter) return null;
  const quote = (v: string) => (/[",]/.test(v) ? `"${v}"` : v);
  const rows = starter.rows.map((r) =>
    [r.product, r.option ?? "Standard", r.min ? String(r.min) : "", r.from ? String(r.from) : "", String(r.price)].map(quote).join(","),
  );
  return { trade: starter.trade, csv: ["Product,Option,Minimum order,From quantity,Price (naira)", ...rows].join("\n") + "\n" };
}
