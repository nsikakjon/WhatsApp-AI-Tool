import { describe, expect, it } from "vitest";
import { createNumberCollector, nextStaff, phoneFromText, type ConnectStaff, type NumberRequest } from "./numbers.js";
import { memoryQueue } from "./numbers-testing.js";

const OWNER = { businessId: "biz-1", businessName: "Glittering Gem", ownerWaId: "2348011111111" };
const TOLU = { id: "s1", name: "Tolu", waId: "2348022222222" };
const ADA = { id: "s2", name: "Ada", waId: "2348033333333" };

describe("reading a phone number from a message", () => {
  it("takes Nigerian numbers written the local or international way", () => {
    expect(phoneFromText("0803 123 4567")).toBe("2348031234567");
    expect(phoneFromText("+234 803-123-4567")).toBe("2348031234567");
    expect(phoneFromText("2347012345678")).toBe("2347012345678");
  });

  it("takes other countries with their code", () => {
    expect(phoneFromText("+233 24 123 4567")).toBe("233241234567");
  });

  it("ignores what isn't a phone number", () => {
    expect(phoneFromText("try")).toBeNull();
    expect(phoneFromText("20 cupcakes")).toBeNull();
    expect(phoneFromText("0803 123")).toBeNull();
    expect(phoneFromText("234803123")).toBeNull();
  });
});

describe("sharing out numbers", () => {
  it("gives the next one to whoever has the fewest still to do", () => {
    const busy = { ...memoryQueueRow(), assignedTo: "s1", status: "added" as const };
    const done = { ...memoryQueueRow(), assignedTo: "s2", status: "live" as const };
    expect(nextStaff([TOLU, ADA], [busy, done])?.name).toBe("Ada");
    expect(nextStaff([], [busy])).toBeNull();
  });
});

function memoryQueueRow(): NumberRequest {
  return { businessId: "x", businessName: "x", ownerWaId: null, number: null, status: "new", assignedTo: null, phoneNumberId: null, pin: null, note: null, numberAt: null, liveAt: null, createdAt: new Date(0) };
}

describe("collecting the new SIM's number in the chat", () => {
  const setUp = (staff: ConnectStaff[] = [TOLU]) => {
    const q = memoryQueue(staff);
    const numbers = createNumberCollector({ store: q.store, alertWaId: "2348099999999", publicUrl: "https://app.yarnoga.com" });
    return { q, numbers, say: (text: string) => numbers.received(OWNER, text) };
  };

  it("saves the number, assigns it and tells that person and yarnOga", async () => {
    const { q, numbers, say } = setUp();
    await numbers.opened("biz-1");
    const reply = await say("0803 123 4567");
    expect(reply?.text).toMatch(/We've got \*0803 123 4567\*.*keep WhatsApp off it/s);
    expect(q.rows.get("biz-1")).toMatchObject({ number: "2348031234567", status: "new", assignedTo: "s1" });
    expect(reply?.notify?.map((n) => n.to)).toEqual(["2348022222222", "2348099999999"]);
    expect(reply?.notify?.[0]?.text).toContain("https://app.yarnoga.com/quote-setup/numbers/biz-1");
    expect(reply?.notify?.[1]?.text).toContain("Assigned to Tolu.");
  });

  it("says so when nobody is there to assign it to", async () => {
    const { numbers, say } = setUp([]);
    await numbers.opened("biz-1");
    const reply = await say("08031234567");
    expect(reply?.notify).toHaveLength(1);
    expect(reply?.notify?.[0]?.text).toContain("Nobody is assigned");
  });

  it("refuses the number they're chatting from", async () => {
    const { q, numbers, say } = setUp();
    await numbers.opened("biz-1");
    expect((await say("08011111111"))?.text).toMatch(/number you're chatting from/);
    expect(q.rows.get("biz-1")?.number).toBeNull();
  });

  it("refuses a number another business gave", async () => {
    const { q, numbers, say } = setUp();
    await numbers.opened("biz-1");
    await q.store.setNumber("biz-2", "2348031234567", null);
    expect((await say("08031234567"))?.text).toMatch(/already connected to another business/);
  });

  it("lets the owner change the number until it's registered, keeping who it's assigned to", async () => {
    const { q, numbers, say } = setUp([TOLU, ADA]);
    await numbers.opened("biz-1");
    await say("08031234567");
    expect((await say("number"))?.text).toMatch(/We have \*0803 123 4567\*/);
    await say("08035555555");
    expect(q.rows.get("biz-1")).toMatchObject({ number: "2348035555555", assignedTo: "s1" });
    await q.store.update("biz-1", { status: "registered" });
    expect(await say("08036666666")).toBeNull();
  });

  it("leaves other messages, and businesses not on the queue, to the bot", async () => {
    const { numbers, say } = setUp();
    expect(await say("08031234567")).toBeNull();
    await numbers.opened("biz-1");
    expect(await say("try")).toBeNull();
    expect((await say("number"))?.text).toMatch(/fresh SIM/);
  });
});
