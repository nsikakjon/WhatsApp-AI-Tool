import { describe, expect, it } from "vitest";
import { connectSignedUpBusiness } from "./connect.js";
import { memoryQueue } from "./numbers-testing.js";
import { NumberTakenError, type QuoteBusiness } from "./store.js";

const OWNER = "2348011111111";

function setUp(taken = false) {
  const business = { id: "biz-1", name: "Mama Cakes", ownerWaId: OWNER, phoneNumberId: null, active: false, updatedAt: new Date(0) } as unknown as QuoteBusiness;
  const updates: Array<Partial<QuoteBusiness>> = [];
  const q = memoryQueue();
  const deps = {
    businesses: { get: async (id: string) => (id === "biz-1" ? business : null) },
    setup: {
      async updateBusiness(_id: string, s: Partial<QuoteBusiness>) {
        if (taken) throw new NumberTakenError("taken");
        updates.push(s);
        return business;
      },
    },
    queue: q.store,
    log: { error() {} },
  };
  return { deps, updates, q };
}

describe("connecting a chat sign-up's number with Facebook", () => {
  it("puts the number on the business, switches it on and tells the owner and the team", async () => {
    const { deps, updates, q } = setUp();
    await q.store.open("biz-1");
    const result = await connectSignedUpBusiness(deps, "biz-1", { phoneNumberId: "555", displayNumber: "+234 803 123 4567", coexistence: true }, "2348099999999");
    expect(updates[0]).toMatchObject({ phoneNumberId: "555", active: true });
    expect(q.rows.get("biz-1")).toMatchObject({ number: "2348031234567", status: "live", phoneNumberId: "555" });
    expect(result.kind).toBe("live");
    if (result.kind !== "live") return;
    expect(result.notify[0]).toMatchObject({ to: OWNER });
    expect(result.notify[0]!.text).toContain("is live on WhatsApp at *0803 123 4567*");
    expect(result.notify[1]!.text).toContain("stays in the WhatsApp Business app");
  });

  it("warns when the owner connected the number they signed up from", async () => {
    const { deps } = setUp();
    const result = await connectSignedUpBusiness(deps, "biz-1", { phoneNumberId: "555", displayNumber: "+234 801 111 1111", coexistence: true }, "2348099999999");
    if (result.kind !== "live") throw new Error(result.kind);
    expect(result.notify[0]!.text).toContain("Order alerts can't come to the same number");
    expect(result.notify[1]!.text).toContain("order alerts can't reach them");
  });

  it("refuses a number another business uses", async () => {
    const { deps } = setUp(true);
    expect(await connectSignedUpBusiness(deps, "biz-1", { phoneNumberId: "555", coexistence: false })).toEqual({ kind: "taken" });
  });
});
