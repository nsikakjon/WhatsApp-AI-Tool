import type { Member, MonthlyStore, OpenMonth } from "./monthly.js";

/** Behaves like the tables and quote_monthly_paid in migration 0067. */
export function memoryMonthlyStore(first: Partial<Member> | null = {}) {
  const months: Array<OpenMonth & { memberId: string; status: "open" | "paid" }> = [];
  const plans = [{ id: "p1", name: "Gym membership", priceKobo: 1_500_000, active: true }];
  const people: Member[] = [];
  const add = (m: Partial<Member>) => {
    const row: Member = {
      id: `00000000-0000-0000-0000-${String(people.length + 1).padStart(12, "0")}`,
      planId: "p1",
      planName: "Gym membership",
      name: "Ada",
      waId: "2348011111111",
      payDay: 5,
      nextDue: "2026-11-05",
      status: "active",
      card: null,
      lastPaidAt: null,
      open: null,
      ...m,
    };
    people.push(row);
    return row;
  };
  if (first) add(first);
  const withOpen = (m: Member): Member => ({ ...m, open: months.find((x) => x.memberId === m.id && x.status === "open") ?? null });
  const store: MonthlyStore = {
    plans: async () => plans,
    async addPlan(name, priceKobo) {
      plans.push({ id: `p${plans.length + 1}`, name, priceKobo, active: true });
    },
    async setPlanActive(id, active) {
      plans.find((p) => p.id === id)!.active = active;
    },
    members: async () => people.map(withOpen),
    member: async (id) => {
      const m = people.find((x) => x.id === id);
      return m ? withOpen(m) : null;
    },
    addMember: async (m) => add({ ...m, planName: plans.find((p) => p.id === m.planId)!.name }).id,
    async cancel(id) {
      const m = people.find((x) => x.id === id && x.status === "active");
      if (m) m.status = "cancelled";
      return Boolean(m);
    },
    async forgetCard(id) {
      people.find((x) => x.id === id)!.card = null;
    },
    async openDue(today) {
      for (const m of people) {
        if (m.status !== "active" || m.nextDue > today || months.some((x) => x.memberId === m.id && x.period === m.nextDue)) continue;
        const price = plans.find((p) => p.id === m.planId)!.priceKobo;
        months.push({ id: `c${months.length + 1}`, memberId: m.id, period: m.nextDue, amountKobo: price, linkUrl: null, notices: 0, cardTriedAt: null, ownerToldAt: null, status: "open" });
      }
    },
    async claimCard(id) {
      const c = months.find((x) => x.id === id)!;
      if (c.cardTriedAt) return false;
      c.cardTriedAt = new Date();
      return true;
    },
    async saveLink(id, url) {
      months.find((x) => x.id === id)!.linkUrl = url;
    },
    async claimNotice(id, n) {
      const c = months.find((x) => x.id === id)!;
      if (c.status !== "open" || c.notices !== n - 1) return false;
      c.notices = n;
      return true;
    },
    async claimOwnerTold(id) {
      const c = months.find((x) => x.id === id)!;
      if (c.ownerToldAt) return false;
      c.ownerToldAt = new Date();
      return true;
    },
    async month(id) {
      const c = months.find((x) => x.id === id);
      const m = c && people.find((x) => x.id === c.memberId);
      return c && m ? { member: withOpen(m), period: c.period, amountKobo: c.amountKobo } : null;
    },
    async paid(id, _ref, nextDue, card) {
      const c = months.find((x) => x.id === id)!;
      if (c.status === "paid") return false;
      c.status = "paid";
      const m = people.find((x) => x.id === c.memberId)!;
      if (nextDue > m.nextDue) m.nextDue = nextDue;
      m.lastPaidAt = new Date();
      if (card) m.card = card;
      return true;
    },
  };
  return { store, months, people, member: people[0]! };
}
