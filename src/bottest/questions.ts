// The starting questions on the owner test screen: what customers ask most.
// The owner can edit the list on the screen before running it.

export type TestBotId = "quote" | "leads";

export const BOT_LABELS: Record<TestBotId, string> = {
  quote: "Sales assistant (quotes and orders)",
  leads: "Property lead qualifier",
};

export const DEFAULT_QUESTIONS: Record<TestBotId, string[]> = {
  quote: [
    "Hello, good afternoon",
    "How much is 100 A5 flyers?",
    "I need 500 business cards",
    "Do you print banners? How much for a 6 by 3 feet banner?",
    "What's your price list?",
    "Can I get 50 A4 flyers?",
    "I want 5 flyers",
    "How much for 1000 flyers, both sides?",
    "Do you do DTF printing on t-shirts?",
    "Price for 200 stickers",
    "Can you design the flyer for me too?",
    "How long does printing take?",
    "Do you deliver to Lekki?",
    "Where is your shop?",
    "Can I pay on delivery?",
    "Give me a discount abeg",
    "I need 100 flyers and 200 business cards",
    "Do you print wedding invitation cards?",
    "Can I speak to a human?",
    "Abeg how much be flyer?",
  ],
  leads: [
    "Hello, I saw your post about a property",
    "I'm looking for a 3 bedroom flat to rent in Lekki",
    "How much is the duplex in Ajah?",
    "I want to buy land in Ibeju-Lekki",
    "My budget is 5 million naira a year",
    "Do you have anything in Yaba for students?",
    "Is the property still available?",
    "Can I come for inspection on Saturday?",
    "I want to move in next month",
    "I'll pay cash",
    "Do you accept installment payment?",
    "Is there an agency fee?",
    "Is the title C of O?",
    "I'm just looking for now",
    "I want a shop to rent in Ikeja",
    "Send me pictures of the house",
    "Can I speak to an agent?",
    "What areas do you cover?",
    "I'm in the UK, can I buy from abroad?",
    "Abeg wetin be the last price?",
  ],
};

/** Longest question the screen accepts. */
export const MAX_QUESTION = 500;
