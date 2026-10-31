import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { screenShield, shieldHtml } from "./shield.js";

const page = "<!doctype html><html><head><title>Orders</title></head><body><p>Total ₦12,500</p></body></html>";

describe("shieldHtml", () => {
  it("adds the styles to the head and the watermark and script before the body ends", () => {
    const html = shieldHtml(page, "Ada ···4567", new Date("2026-10-31T18:05:00Z"));
    expect(html).toMatch(/<style>[^<]*shield-away[^<]*<\/style><\/head>/);
    expect(html).toMatch(/id="shield-mark"[\s\S]*<script>[\s\S]*<\/script><\/body><\/html>$/);
    // Lagos is an hour ahead of UTC.
    expect(decodeURIComponent(html)).toContain("Ada ···4567 · 31 Oct 2026, 19:05");
  });

  it("escapes the viewer's name inside the watermark", () => {
    const html = decodeURIComponent(shieldHtml(page, "<b>Tolu</b>"));
    expect(html).not.toContain("<b>Tolu</b>");
    expect(html).toContain("&#60;b&#62;Tolu");
  });
});

describe("screenShield", () => {
  const app = new Hono<{ Variables: { who: string } }>();
  app.use("*", async (c, next) => {
    c.set("who", "Bisi");
    await next();
  });
  app.use("*", screenShield((c) => c.get("who" as never)));
  app.get("/page", (c) => {
    c.header("set-cookie", "s=1; Path=/");
    return c.html(page);
  });
  app.get("/export.csv", (c) => c.body("name,total\nAda,12500", 200, { "content-type": "text/csv" }));

  it("shields pages and keeps their cookies", async () => {
    const res = await app.request("/page");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBe("s=1; Path=/");
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("₦12,500");
    expect(decodeURIComponent(html)).toContain("Bisi · ");
  });

  it("leaves downloads as they are but still asks for no saved copy", async () => {
    const res = await app.request("/export.csv");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("name,total\nAda,12500");
  });
});
