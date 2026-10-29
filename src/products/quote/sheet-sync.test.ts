import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "../../core/whatsapp/types.js";
import { preview } from "./chat-signup.js";
import type { PriceListItem } from "./pricelist.js";
import { checkDueSheets, createSheetSync, type SheetStore } from "./sheet-sync.js";

const LINK = "https://docs.google.com/spreadsheets/d/abc/edit";
const MUGS: PriceListItem = { product: "Mugs", option: "Standard", minQuantity: 1, tiers: [{ minQuantity: 1, unitPriceKobo: 350000 }] };

function setUp(sheetCsv: string, current: PriceListItem[] = [MUGS], url: string | null = LINK) {
  const state = { url, pending: null as string | null, checked: 0 };
  const saved: PriceListItem[][] = [];
  const store: SheetStore = {
    sheet: async () => ({ url: state.url, pendingCsv: state.pending }),
    setSheet: async (_id, u) => void (state.url = u),
    setPending: async (_id, csv) => void (state.pending = csv),
    dueForCheck: async () => [{ id: "b2", ownerWaId: "2348011111111", phoneNumberId: "num-b2", active: true }],
    checked: async () => void state.checked++,
  };
  let sheet = sheetCsv;
  const sync = createSheetSync({
    store,
    setup: { priceList: async () => current, replacePriceList: async (_id, items) => void saved.push(items) },
    fetchSheet: async () => sheet,
    preview,
  });
  return { sync, store, state, saved, setSheet: (csv: string) => (sheet = csv) };
}

const msg = (text: string): IncomingMessage => ({ waMessageId: "w", from: "2348011111111", type: "text", text, timestamp: 0, raw: {} });

describe("Google Sheet price lists", () => {
  it("says when the sheet matches the saved list", async () => {
    const { sync, state } = setUp("Product,Price\nMugs,3500\n");
    expect((await sync.ownerCommand("b2", msg("refresh")))?.text).toMatch(/already match/);
    expect(state.checked).toBe(1);
  });

  it("shows changes and only saves them on update prices", async () => {
    const { sync, saved, state } = setUp("Product,Price,Colour\nMugs,4000,white\nCaps,2000,\n");
    const reply = await sync.ownerCommand("b2", msg("Refresh"));
    expect(reply?.text).toMatch(/has changes \(1 new, 1 changed\)/);
    expect(reply?.text).toContain("• Mugs: ₦4,000 each");
    expect(saved).toHaveLength(0);

    expect((await sync.ownerCommand("b2", msg("update prices")))?.text).toMatch(/now has 2 items/);
    expect(saved[0]).toMatchObject([{ product: "Mugs", details: "Colour: white" }, { product: "Caps" }]);
    expect(state.pending).toBeNull();
    expect((await sync.ownerCommand("b2", msg("update prices")))?.text).toMatch(/no new prices waiting/);
  });

  it("keeps the current prices when the sheet has problems", async () => {
    const { sync, state } = setUp("Product,Price\nMugs,lots\n");
    expect((await sync.ownerCommand("b2", msg("refresh")))?.text).toMatch(/rows I can't read, so I've kept your current prices/);
    expect(state.pending).toBeNull();
  });

  it("remembers a sheet link the owner sends, and forgets it on stop sync", async () => {
    const { sync, state } = setUp("Product,Price\nMugs,3500\n", [MUGS], null);
    expect((await sync.ownerCommand("b2", msg("refresh")))?.text).toMatch(/Send me the link/);
    expect((await sync.ownerCommand("b2", msg(LINK)))?.text).toMatch(/check this Google Sheet .* every day[\s\S]*already match/);
    expect(state.url).toBe(LINK);
    await sync.ownerCommand("b2", msg("stop sync"));
    expect(state.url).toBeNull();
  });

  it("leaves other messages to the bot", async () => {
    const { sync } = setUp("Product,Price\nMugs,3500\n");
    expect(await sync.ownerCommand("b2", msg("20 mugs please"))).toBeNull();
  });

  it("tells the owner once about new changes on the daily check", async () => {
    const { sync, store, setSheet } = setUp("Product,Price\nMugs,4000\n");
    const sent: Array<{ to: string; text: string; from?: string }> = [];
    const run = () => checkDueSheets({ sync, store, now: new Date(), notify: async (to, text, from) => void sent.push({ to, text, from }) });
    await run();
    await run();
    expect(sent).toEqual([{ to: "2348011111111", text: expect.stringMatching(/has changes \(1 changed\)/), from: "num-b2" }]);
    setSheet("Product,Price\nMugs,4500\n");
    await run();
    expect(sent).toHaveLength(2);
  });
});
