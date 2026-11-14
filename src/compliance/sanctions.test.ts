import { describe, expect, it, vi } from "vitest";
import { createScreener, parseSdnList, parseUnList, screenMatch } from "./sanctions.js";

const UN = `<?xml version="1.0" encoding="UTF-8"?>
<CONSOLIDATED_LIST><INDIVIDUALS><INDIVIDUAL><DATAID>1</DATAID><FIRST_NAME>ABUBAKAR</FIRST_NAME><SECOND_NAME>MOHAMMED</SECOND_NAME><THIRD_NAME>SHEKAU</THIRD_NAME>
<REFERENCE_NUMBER>QDi.322</REFERENCE_NUMBER><INDIVIDUAL_ALIAS><QUALITY>Good</QUALITY><ALIAS_NAME>Abu Muhammed Abubakar bin Muhammad</ALIAS_NAME></INDIVIDUAL_ALIAS></INDIVIDUAL></INDIVIDUALS>
<ENTITIES><ENTITY><FIRST_NAME>JAMA&apos;ATU AHLIS SUNNA LIDDA&apos;AWATI WAL-JIHAD</FIRST_NAME><REFERENCE_NUMBER>QDe.138</REFERENCE_NUMBER><ENTITY_ALIAS><ALIAS_NAME>Boko Haram</ALIAS_NAME></ENTITY_ALIAS></ENTITY></ENTITIES></CONSOLIDATED_LIST>`;

const SDN = `36,"AEROCARIBBEAN AIRLINES","-0- ","CUBA","-0- ","-0- ","-0- ","-0- ","-0- ","-0- ","-0- ","-0- "
2674,"SHEKAU, Abubakar","individual","SDGT","-0- ","-0- ","-0- ","-0- ","-0- ","-0- ","-0- ","DOB 1965; a.k.a. ""Imam"""
`;

describe("the sanctions lists", () => {
  it("reads every name and alias on the UN list", () => {
    expect(parseUnList(UN)).toEqual([
      { list: "UN", name: "ABUBAKAR MOHAMMED SHEKAU", ref: "QDi.322" },
      { list: "UN", name: "Abu Muhammed Abubakar bin Muhammad", ref: "QDi.322" },
      { list: "UN", name: "JAMA'ATU AHLIS SUNNA LIDDA'AWATI WAL-JIHAD", ref: "QDe.138" },
      { list: "UN", name: "Boko Haram", ref: "QDe.138" },
    ]);
  });

  it("reads the SDN list, turning individuals' names round", () => {
    expect(parseSdnList(SDN)).toEqual([
      { list: "OFAC", name: "AEROCARIBBEAN AIRLINES", ref: "36" },
      { list: "OFAC", name: "Abubakar SHEKAU", ref: "2674" },
    ]);
  });

  it("matches whole names in any order, and one-word names only exactly", () => {
    expect(screenMatch("Abubakar Shekau", "ABUBAKAR MOHAMMED SHEKAU")).toBe(true);
    expect(screenMatch("Abubakar Bello", "ABUBAKAR MOHAMMED SHEKAU")).toBe(false);
    expect(screenMatch("Haram Foods", "Boko Haram")).toBe(false);
    expect(screenMatch("Abubakar", "ABUBAKAR MOHAMMED SHEKAU")).toBe(false);
  });
});

describe("screening", () => {
  it("screens our names against both lists, downloading them once a day", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => new Response(String(url).includes("un.org") ? UN : SDN));
    let now = 0;
    const screener = createScreener({ fetch: fetch as unknown as typeof globalThis.fetch, now: () => now });
    const result = await screener.screen(["Kahn Prints", "Abubakar Shekau", null, "Abubakar Shekau"]);
    expect(result.names).toEqual(["Kahn Prints", "Abubakar Shekau"]);
    expect(result.lists).toEqual(["UN", "OFAC"]);
    expect(result.hits.map((h) => `${h.list} ${h.ref}`)).toEqual(["UN QDi.322", "OFAC 2674"]);
    expect(result.error).toBeUndefined();

    await screener.screen(["Ada Okafor"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    now = 86_400_001;
    expect((await screener.screen(["Ada Okafor"])).hits).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("says so when a list can't be loaded", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => (String(url).includes("un.org") ? new Response("", { status: 503 }) : new Response(SDN)));
    const result = await createScreener({ fetch: fetch as unknown as typeof globalThis.fetch, log: { warn() {} } }).screen(["Ada Okafor"]);
    expect(result.lists).toEqual(["OFAC"]);
    expect(result.error).toContain("Not every list");
  });
});
