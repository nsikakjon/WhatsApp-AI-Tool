import { describe, expect, it } from "vitest";
import { createDoorScreens } from "./door.js";
import { createTicketLinks } from "./links.js";
import { BUSINESS, links, memoryTickets, SECRET } from "./testing.js";

async function setup() {
  const mem = memoryTickets();
  mem.addOrder("o1", 214);
  const [vip, regular] = await mem.store.issue("o1", [
    { seat: 1, name: "Element House: VIP", code: "4827" },
    { seat: 2, name: "Element House: Regular", code: "1190" },
  ]);
  const app = createDoorScreens({
    secret: SECRET,
    business: async (id) => (id === BUSINESS ? { name: "Element House", orderPrefix: "EH", store: mem.store } : null),
  });
  return { app, vip: vip!, regular: regular!, ...mem };
}

const path = (url: string) => new URL(url).pathname;
const check = (app: Awaited<ReturnType<typeof setup>>["app"], code: string) =>
  app.request(`${path(links.door(BUSINESS))}/check`, {
    method: "POST",
    body: new URLSearchParams({ code }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

describe("door screen", () => {
  it("refuses a made-up door link", async () => {
    const { app } = await setup();
    const real = path(links.door(BUSINESS));
    expect((await app.request(real.replace(/.$/, real.endsWith("A") ? "B" : "A"))).status).toBe(404);
    const page = await (await app.request(real)).text();
    expect(page).toContain("Element House: VIP");
    expect(page).toContain("0 in of 1 sold");
  });

  it("lets a scanned ticket in once, then shows when it was used", async () => {
    const { app, vip } = await setup();
    const first = await check(app, links.ticket(BUSINESS, vip.id));
    expect(first.headers.get("location")).toMatch(/\/ticket\/.+\?in=1$/);
    expect(await (await app.request(first.headers.get("location")!)).text()).toContain("Let them in");

    const second = await check(app, links.ticket(BUSINESS, vip.id));
    expect(second.headers.get("location")).not.toContain("in=1");
    expect(await (await app.request(second.headers.get("location")!)).text()).toContain("Already used at");
    expect(await (await app.request(path(links.door(BUSINESS)))).text()).toContain("1 in of 1 sold");
  });

  it("takes a typed order number and code", async () => {
    const { app, regular } = await setup();
    const res = await check(app, "EH-214 1190");
    expect(res.headers.get("location")).toContain(`/ticket/${regular.id}?in=1`);
    expect(decodeURIComponent((await check(app, "214 0000")).headers.get("location")!)).toContain("No ticket matches");
  });

  it("turns away a QR code that isn't this business's ticket", async () => {
    const { app, vip } = await setup();
    const forged = createTicketLinks("another-secret", "https://bot.example.com").ticket(BUSINESS, vip.id);
    expect(decodeURIComponent((await check(app, forged)).headers.get("location")!)).toContain("Not a ticket for this event");
  });

  it("shows a guest whether their ticket is still valid", async () => {
    const { app, vip, store } = await setup();
    expect(await (await app.request(path(links.ticket(BUSINESS, vip.id)))).text()).toContain("Valid for one entry");
    await store.checkIn(vip.id);
    expect(await (await app.request(path(links.ticket(BUSINESS, vip.id)))).text()).toContain("Used at");
  });
});
