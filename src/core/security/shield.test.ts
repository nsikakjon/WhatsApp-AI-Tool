import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { noSavedCopies } from "./shield.js";

describe("noSavedCopies", () => {
  const app = new Hono();
  app.use("*", noSavedCopies);
  app.get("/page", (c) => {
    c.header("set-cookie", "s=1; Path=/");
    return c.html("<p>Total ₦12,500</p>");
  });

  it("asks the browser to keep no copy and leaves the page as it is", async () => {
    const res = await app.request("/page");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBe("s=1; Path=/");
    expect(await res.text()).toBe("<p>Total ₦12,500</p>");
  });
});
