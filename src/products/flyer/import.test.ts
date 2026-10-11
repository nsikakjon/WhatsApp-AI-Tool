import { describe, expect, it } from "vitest";
import {
  fetchPicture,
  fetchSheet,
  guessDayFirst,
  isSafeUrl,
  parseCsv,
  photoDownloadUrl,
  rowsFromTable,
  sheetCsvUrl,
} from "./import.js";

describe("reading a member list", () => {
  it("reads quoted cells, commas inside quotes and Windows line ends", () => {
    expect(parseCsv('Name,Birthday\r\n"Okafor, Ada",14 March\r\n\r\nTunde,1/1\r\n')).toEqual([
      ["Name", "Birthday"],
      ["Okafor, Ada", "14 March"],
      ["Tunde", "1/1"],
    ]);
    expect(parseCsv("Name;Birthday\nAda;14/03")).toEqual([["Name", "Birthday"], ["Ada", "14/03"]]);
  });

  it("finds columns by their headings, in any order, with Google Form style names", () => {
    const rows = rowsFromTable(
      parseCsv(
        "Timestamp,Upload your photo,Full name,Date of birth\n" +
          "x,https://drive.google.com/open?id=abc,Ada Okafor,14/03/1990\n" +
          "x,,Tunde Bakare,25/12/1988\n" +
          "x,,Bola,sometime",
      ),
    );
    expect(rows).toEqual([
      { line: 2, name: "Ada Okafor", birthday: { month: 3, day: 14 }, birthdayText: "14/03/1990", photoUrl: "https://drive.google.com/open?id=abc" },
      { line: 3, name: "Tunde Bakare", birthday: { month: 12, day: 25 }, birthdayText: "25/12/1988", photoUrl: undefined },
      { line: 4, name: "Bola", birthday: null, birthdayText: "sometime", photoUrl: undefined },
    ]);
  });

  it("reads lists with no headings as name, birthday, photo", () => {
    expect(rowsFromTable(parseCsv("Ada,14 March,https://x.com/a.jpg"))[0]).toMatchObject({
      line: 1,
      name: "Ada",
      birthday: { month: 3, day: 14 },
      photoUrl: "https://x.com/a.jpg",
    });
  });

  it("spots month-first dates from US-style sheets, and reads 1990-03-14", () => {
    expect(guessDayFirst(["3/14/1990", "4/2/1985"])).toBe(false);
    expect(guessDayFirst(["14/3/1990", "4/2/1985"])).toBe(true);
    expect(guessDayFirst(["4/2/1985"])).toBe(true);
    const rows = rowsFromTable(parseCsv("Name,Birthday\nA,3/14/1990\nB,4/2/1985\nC,1990-07-09"));
    expect(rows.map((r) => r.birthday)).toEqual([{ month: 3, day: 14 }, { month: 4, day: 2 }, { month: 7, day: 9 }]);
  });
});

describe("links", () => {
  it("turns a Google Sheets link into its CSV download", () => {
    expect(sheetCsvUrl("https://docs.google.com/spreadsheets/d/AbC-1_x/edit#gid=42")).toBe(
      "https://docs.google.com/spreadsheets/d/AbC-1_x/export?format=csv&gid=42",
    );
    expect(sheetCsvUrl("https://example.com")).toBeNull();
  });

  it("turns Google Drive share links into downloads", () => {
    const direct = "https://drive.google.com/uc?export=download&id=F1";
    expect(photoDownloadUrl("https://drive.google.com/file/d/F1/view?usp=sharing")).toBe(direct);
    expect(photoDownloadUrl("https://drive.google.com/open?id=F1")).toBe(direct);
    expect(photoDownloadUrl("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
  });

  it("only fetches public https links", () => {
    expect(isSafeUrl("https://drive.google.com/x")).toBe(true);
    for (const bad of ["http://example.com/a.jpg", "https://localhost/a", "https://169.254.169.254/latest", "https://[::1]/a", "https://intranet/a", "https://u:p@example.com/a", "ftp://x.com"]) {
      expect(isSafeUrl(bad)).toBe(false);
    }
  });
});

describe("downloads", () => {
  const respond = (body: BodyInit, headers: Record<string, string>, status = 200) => new Response(body, { status, headers });

  it("follows Google's redirects to the photo, and rejects non-pictures", async () => {
    const seen: string[] = [];
    const fake = (async (url: string) => {
      seen.push(url);
      if (url.startsWith("https://drive.google.com")) return respond("", { location: "https://drive.usercontent.google.com/d/F1" }, 303);
      return respond(new Uint8Array([1, 2, 3]), { "content-type": "image/jpeg" });
    }) as unknown as typeof fetch;
    const pic = await fetchPicture("https://drive.google.com/open?id=F1", fake);
    expect(pic).toEqual({ data: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" });
    expect(seen).toEqual(["https://drive.google.com/uc?export=download&id=F1", "https://drive.usercontent.google.com/d/F1"]);

    const html = (async () => respond("<html>", { "content-type": "text/html" })) as unknown as typeof fetch;
    await expect(fetchPicture("https://example.com/a", html)).rejects.toThrow("isn't a picture");
  });

  it("won't follow a redirect to an internal address", async () => {
    const fake = (async () => respond("", { location: "http://169.254.169.254/" }, 302)) as unknown as typeof fetch;
    await expect(fetchPicture("https://example.com/a.jpg", fake)).rejects.toThrow("public https link");
  });

  it("explains how to share a private sheet", async () => {
    const login = (async () => respond("<html>login</html>", { "content-type": "text/html" })) as unknown as typeof fetch;
    await expect(fetchSheet("https://docs.google.com/spreadsheets/d/X/edit", login)).rejects.toThrow("Anyone with the link");
    const ok = (async () => respond("Name,Birthday\nAda,14/03", { "content-type": "text/csv" })) as unknown as typeof fetch;
    expect(await fetchSheet("https://docs.google.com/spreadsheets/d/X/edit", ok)).toContain("Ada");
  });
});
