import type { ConnectStaff, NumberQueueStore, NumberRequest } from "./numbers.js";

// An in-memory number queue for tests.

export function memoryQueue(staff: ConnectStaff[] = []) {
  const rows = new Map<string, NumberRequest>();
  const team = [...staff];
  const blank = (businessId: string): NumberRequest => ({
    businessId,
    businessName: "Glittering Gem",
    ownerWaId: "2348011111111",
    number: null,
    status: "no_number",
    assignedTo: null,
    phoneNumberId: null,
    pin: null,
    note: null,
    numberAt: null,
    liveAt: null,
    createdAt: new Date(0),
  });
  const store: NumberQueueStore = {
    list: async () => [...rows.values()],
    get: async (id) => (rows.has(id) ? { ...rows.get(id)! } : null),
    async open(id) {
      if (!rows.has(id)) rows.set(id, blank(id));
    },
    async setNumber(id, number, assignedTo) {
      if ([...rows.values()].some((r) => r.number === number && r.businessId !== id)) return false;
      rows.set(id, { ...(rows.get(id) ?? blank(id)), number, status: "new", assignedTo, numberAt: new Date() });
      return true;
    },
    async update(id, change) {
      rows.set(id, { ...rows.get(id)!, ...change });
    },
    staff: async () => team,
    async addStaff(name, waId) {
      team.push({ id: `s${team.length + 1}`, name, waId });
    },
    async removeStaff(id) {
      team.splice(team.findIndex((s) => s.id === id), 1);
    },
  };
  return { store, rows, team };
}
