import type { MiddlewareHandler } from "hono";

// Pages with customer details and money on them (owner app, staff inbox,
// dashboard) tell the browser not to keep a copy, so pressing Back after
// logging out on a shared phone shows nothing. Switched on with SCREEN_SHIELD.
export const noSavedCopies: MiddlewareHandler = async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
  c.res.headers.set("Pragma", "no-cache");
};
