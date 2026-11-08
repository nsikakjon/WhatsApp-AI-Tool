import { Hono } from "hono";
import { readFile as fsReadFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve, sep } from "node:path";
import { guardedBasicAuth } from "../core/security/guard.js";

// Oko: Jay's farm and land app at /farm/ (FARM_PASSWORD).
//
// A phone app for cocoa, oil palm and cassava fields in southern Nigeria
// (crop calendar, weather and pest alerts, scouting, harvest and cost
// records) and for surveying land (GPS beacons, area, DXF drawings for
// architects, a drive-to pin). The app itself is plain files in /farm-app;
// this module only hands them out behind a password. Everything typed into
// the app is saved on the phone, not on this server, so nothing here touches
// the database, WhatsApp or the other products.

export interface FarmDeps {
  password: string;
  /** Where the app's files are. Defaults to /farm-app at the top of the project. */
  dir?: string;
  /** For tests. */
  readFile?: (path: string) => Promise<Uint8Array>;
}

export const FARM_DIR = fileURLToPath(new URL("../../farm-app/", import.meta.url));

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/manifest+json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
};

// Phones fetch the install icon, the manifest and the offline helper without
// sending the password, so these open without it. They hold no data.
const OPEN = new Set(["manifest.json", "icon.svg", "icon-192.png", "icon-512.png", "sw.js"]);

/** The file a request asks for, or null if it isn't one the app has. */
export function farmFile(path: string): string | null {
  const rel = path === "" || path === "/" ? "index.html" : path.replace(/^\/+/, "");
  if (!/^[a-z0-9][a-z0-9._/-]*$/i.test(rel) || rel.includes("..") || rel.includes("//")) return null;
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  return ext in TYPES ? rel : null;
}

export function createFarm(deps: FarmDeps) {
  const app = new Hono();
  const dir = resolve(deps.dir ?? FARM_DIR);
  const read = deps.readFile ?? ((p: string) => fsReadFile(p));
  const auth = guardedBasicAuth({ password: deps.password, realm: "yarnOga farm" });

  app.use("*", async (c, next) => {
    const rel = farmFile(relPath(c.req.path));
    if (rel && OPEN.has(rel)) return next();
    return auth(c, next);
  });

  const serve = async (rel: string | null) => {
    if (!rel) return new Response("Not found", { status: 404 });
    const full = resolve(join(dir, rel));
    if (!full.startsWith(dir + sep)) return new Response("Not found", { status: 404 });
    try {
      const body = await read(full);
      const ext = rel.split(".").pop()!.toLowerCase();
      return new Response(new Uint8Array(body), {
        headers: {
          "Content-Type": TYPES[ext]!,
          // Check for a newer version each time; the phone keeps its own copy for offline use.
          "Cache-Control": "no-cache",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "no-referrer",
          // GPS, camera (for photos) and nothing else.
          "Permissions-Policy": "geolocation=(self), camera=(self), microphone=()",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  };

  app.get("/", () => serve("index.html"));
  app.get("/*", (c) => serve(farmFile(relPath(c.req.path))));
  return app;
}

/** The part of the address after /farm/. */
function relPath(path: string): string {
  return path.replace(/^\/farm(\/|$)/, "/").replace(/^\/+/, "");
}
