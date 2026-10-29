// What each person on a business's team can do in the owner app. The owner
// adds staff in Settings > Team and picks one of these roles for each.
//
//   owner    everything
//   manager  runs the shop day to day: everything except Settings, Export
//            and Verify business (bank accounts, alert numbers, the team)
//   cashier  chats and orders: Inbox, Orders (can mark paid), Customers and
//            the price list to read. No takings, totals or settings.
//   rider    the order board and deliveries only, to see what's going out
//
// Each order on the board keeps its price for everyone (it's what the
// customer was quoted and has to pay). "Money" means the business's takings:
// paid in this month, amounts owed, column totals and what each customer has
// spent.

export const ROLES = ["owner", "manager", "cashier", "rider"] as const;
export type Role = (typeof ROLES)[number];

/** The roles an owner can give someone they add. */
export const STAFF_ROLES = ["manager", "cashier", "rider"] as const satisfies readonly Role[];
export type StaffRole = (typeof STAFF_ROLES)[number];

export type Permission =
  | "money" // takings, owed amounts, totals, customer spend, plan usage
  | "inbox" // read and answer customer chats
  | "take_payment" // mark an order paid (the customer gets a receipt)
  | "customers" // the customer list
  | "see_prices" // the price list, read only
  | "edit_prices" // add and change products, prices and stock
  | "tools"; // test the bot (each test is an AI cost) and QR posters

const GRANTS: Record<Role, ReadonlySet<Permission>> = {
  owner: new Set<Permission>(["money", "inbox", "take_payment", "customers", "see_prices", "edit_prices", "tools"]),
  manager: new Set<Permission>(["money", "inbox", "take_payment", "customers", "see_prices", "edit_prices", "tools"]),
  cashier: new Set<Permission>(["inbox", "take_payment", "customers", "see_prices"]),
  rider: new Set<Permission>([]),
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role].has(permission);
}

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", manager: "Manager", cashier: "Cashier", rider: "Rider" };

/** One line each, for the Team section. */
export const ROLE_HELP: Record<StaffRole, string> = {
  manager: "everything except Settings, Export and Verify business",
  cashier: "Inbox, Orders (can mark paid), Customers and the price list to read; no takings or totals",
  rider: "the order board and deliveries; no chats, takings or prices (to send them jobs, add them under Riders & delivery too)",
};

/** A role read from the database. Rows from before migration 0058 say "staff", which is today's manager. */
export function toRole(value: string): Role {
  if (value === "staff") return "manager";
  return (ROLES as readonly string[]).includes(value) ? (value as Role) : "rider";
}

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}
