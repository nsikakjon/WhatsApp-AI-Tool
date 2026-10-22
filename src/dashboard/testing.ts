// Sample numbers shared by the dashboard tests.
import { lagosDays, summariseFlyerPlans, summariseOrders, type DashboardStats } from "./stats.js";

export const NOW = new Date("2026-10-16T08:00:00Z");

export function sampleStats(): DashboardStats {
  return {
    generatedAt: NOW,
    whatsapp: {
      contacts: 42,
      newContacts7: 5,
      newContacts30: 12,
      inbound7: 70,
      inbound30: 300,
      outbound30: 310,
      voiceNotes30: 9,
      dailyInbound: lagosDays(NOW, 30).map((d, i) => ({ date: d.date, count: i % 4 })),
      sentThisMonth: [
        { label: "Flyers", sent: 1240, ownAccount: false },
        { label: "Ada Prints", sent: 300, ownAccount: true },
      ],
    },
    flyers: summariseFlyerPlans(
      { groups: 3, newGroups30: 2, members: 55, birthdayFlyersAll: 20, birthdayFlyers30: 6 },
      [
        { plan: "free", plan_until: null },
        { plan: "standard", plan_until: "2026-12-01T00:00:00Z" },
        { plan: "organisation", plan_until: null },
      ],
      [
        { id: "free", monthly_price_kobo: 0, sort_order: 0 },
        { id: "standard", monthly_price_kobo: 450000, sort_order: 1 },
        { id: "organisation", monthly_price_kobo: null, sort_order: 4 },
      ],
      NOW,
    ),
    quotes: summariseOrders([{ status: "paid", total_kobo: 1250000, paid_at: "2026-10-10T00:00:00Z" }], NOW),
    site: { sites: 1, members: 4, updates7: 8, updates30: 30, photos30: 12, voiceNotes30: 3, reports30: 14 },
    leads: { total: 7, new30: 3, hot: 1, warm: 2, cold: 4, handedOff: 1 },
  };
}

