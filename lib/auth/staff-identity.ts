/**
 * Narrow staff-identity resolution (Phase 5.0E — driver-override fix). PURE, edge-safe.
 * ---------------------------------------------------------------------------
 * ONE source of truth for "which surface does this staff session belong to". DRIVER and
 * COURIER are NARROW identities — a driver's mobile app, a coursier's deposit runs — but
 * only when that is ALL the user is. A user who also holds SYSTEM_ADMIN (or any other
 * operational role) is STAFF, and the highest-privilege workspace must win.
 *
 * THE BUG THIS FIXES. Three separate call sites decided "driver" from
 * `roles.includes("DRIVER")` — first-match-wins. A user created with every role
 * (SYSTEM_ADMIN … DRIVER) was therefore routed to /driver, because merely HOLDING the
 * driver role short-circuited every other identity. Membership is not identity. A narrow
 * identity is defined by the ABSENCE of any operational role, never the presence of the
 * narrow one — the same rule isCourierOnly already used for couriers.
 *
 * No I/O here so the rule is importable from the edge middleware, server actions, the
 * navigation builder and tests without pulling in a client.
 */

/** The oversight roles — the top of the workspace-priority order. */
export const OVERSIGHT_ROLES = ["COORDINATOR", "OPS_SUPERVISOR", "SYSTEM_ADMIN"] as const;

/**
 * Every tenant role that means "this person does operational work in the app". Holding
 * ANY of these makes a user STAFF — it is what a narrow identity must NOT have. Ordered
 * roughly by privilege (oversight first) for readability; membership, not order, is what
 * matters here.
 */
export const OPERATIONAL_ROLES = [
  ...OVERSIGHT_ROLES,
  "ACCOUNT_MANAGER",
  "QUOTATION_MANAGER",
  "CHIEF_OF_TRANSIT",
  "CUSTOMS_DECLARANT",
  "CUSTOMS_FINANCE_OFFICER",
  "CUSTOMS_FIELD_AGENT",
  "TRANSPORT_OFFICER",
  "PICKUP_AGENT",
  "BILLING_OFFICER",
  "FINANCE_OFFICER",
  "ADMINISTRATIVE_OFFICER",
  "COLLECTIONS_OFFICER",
  "DOCUMENTATION_OFFICER",
  "WAREHOUSE_COORDINATOR",
  "COMPLIANCE_HSSE",
] as const;

function hasOperationalRole(roles: Set<string>): boolean {
  return (OPERATIONAL_ROLES as readonly string[]).some((r) => roles.has(r));
}

/**
 * Is this a DRIVER and nothing else? A driver's whole surface is the mobile mission app.
 * They get routed there ONLY when driver is all they are — a SYSTEM_ADMIN who also drives
 * is an admin. The test is the absence of any operational role, never the presence of
 * DRIVER.
 */
export function isDriverOnly(roleCodes: string[]): boolean {
  const roles = new Set(roleCodes);
  if (!roles.has("DRIVER")) return false;
  return !hasOperationalRole(roles);
}

/** Is this a COURIER and nothing else? (Phase 5.0E-3.) Same rule as isDriverOnly. */
export function isCourierOnly(roleCodes: string[]): boolean {
  const roles = new Set(roleCodes);
  if (!roles.has("COURIER")) return false;
  return !hasOperationalRole(roles);
}

/**
 * The narrow surface this staff session should be routed to, or null when the user is
 * full staff. DRIVER wins over COURIER for the rare dual mobile identity (the driver app
 * is the more complete surface); either loses to any operational role.
 */
export function narrowStaffIdentity(roleCodes: string[]): "driver" | "courier" | null {
  if (isDriverOnly(roleCodes)) return "driver";
  if (isCourierOnly(roleCodes)) return "courier";
  return null;
}
