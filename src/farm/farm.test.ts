import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createFarm, farmFile, FARM_DIR } from "./index.js";

const auth = { Authorization: `Basic ${btoa("jay:farm-password-123")}` };
const app = () => createFarm({ password: "farm-password-123" });

describe("farm app", () => {
  it("needs the password for the app itself", async () => {
    expect((await app().request("/")).status).toBe(401);
    expect((await app().request("/js/app.js")).status).toBe(401);
    const res = await app().request("/", { headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("js/app.js");
  });

  it("serves the app's files with the right types", async () => {
    const js = await app().request("/js/crops.js", { headers: auth });
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(await js.text()).toContain("cocoa");
    expect((await app().request("/css/app.css", { headers: auth })).headers.get("content-type")).toContain("text/css");
  });

  it("lets phones fetch the icon, manifest and offline helper without the password", async () => {
    for (const f of ["/manifest.json", "/icon-192.png", "/sw.js"]) expect((await app().request(f)).status).toBe(200);
  });

  it("only hands out the app's own files", async () => {
    expect(farmFile("../.env")).toBeNull();
    expect(farmFile("js/../../package.json")).toBeNull();
    expect(farmFile(".env")).toBeNull();
    expect(farmFile("notes.txt")).toBeNull();
    expect(farmFile("")).toBe("index.html");
    expect((await app().request("/..%2F.env", { headers: auth })).status).toBe(404);
    expect((await app().request("/missing.js", { headers: auth })).status).toBe(404);
  });

  it("every file the page and offline helper load is there", () => {
    const html = readFileSync(`${FARM_DIR}index.html`, "utf8");
    const sw = readFileSync(`${FARM_DIR}sw.js`, "utf8");
    const local = [...html.matchAll(/(?:src|href)="([^":]+)"/g)].map((m) => m[1]!);
    const cached = JSON.parse(sw.match(/const FILES=(\[[^\]]+\])/)![1]!) as string[];
    for (const f of [...local, ...cached].filter((f) => f !== "./")) expect(farmFile(f), f).not.toBeNull();
    for (const f of [...local, ...cached].filter((f) => f !== "./")) expect(() => readFileSync(`${FARM_DIR}${f}`)).not.toThrow();
  });
});
