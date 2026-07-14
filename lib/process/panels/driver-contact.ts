/**
 * Driver contact privacy + tracking freshness (Phase 5.0D-5). PURE.
 * ---------------------------------------------------------------------------
 * Deliberately separate from the server-only transport panel so the privacy rule
 * is unit-testable in isolation — a rule this important should not be reachable
 * only through a database read.
 *
 * THE RULE: a driver's PERSONAL phone number is never the customer-safe contact.
 * By default the customer sees the tenant's BUSINESS number. A tenant may opt in
 * to sharing the driver's number, but that seam is off everywhere and cannot be
 * enabled by accident.
 */

export type DriverContactPolicy = "business" | "masked" | "driver_direct";

export type DriverContact = {
  policy: DriverContactPolicy;
  /** What a CUSTOMER may be shown. Never a personal number under the default. */
  customerSafeContact: string | null;
  /** True only when the tenant has explicitly opted in to sharing it. */
  exposesPersonalNumber: boolean;
};

/**
 * Resolve the customer-safe contact.
 *
 * The driver's personal phone is returned ONLY when `tenantAllowsDriverDirect` is
 * exactly `true` — a configuration seam management must consciously enable.
 * Absent that opt-in the personal number does not leave this function, and we do
 * NOT fall back to it when no business number exists: a missing contact is better
 * than a leaked one.
 */
export function resolveDriverContact(input: {
  businessPhone: string | null;
  driverPhone: string | null;
  tenantAllowsDriverDirect?: boolean;
}): DriverContact {
  if (input.tenantAllowsDriverDirect === true && input.driverPhone) {
    return {
      policy: "driver_direct",
      customerSafeContact: input.driverPhone,
      exposesPersonalNumber: true,
    };
  }
  if (input.businessPhone) {
    return { policy: "business", customerSafeContact: input.businessPhone, exposesPersonalNumber: false };
  }
  return { policy: "masked", customerSafeContact: null, exposesPersonalNumber: false };
}

export type TrackingFreshness = "live" | "stale" | "offline" | "none";

/** Position freshness from the last GPS point. Reuses the existing thresholds. */
export function trackingFreshness(lastPositionAt: string | null, now: number): TrackingFreshness {
  if (!lastPositionAt) return "none";
  const ageSeconds = (now - new Date(lastPositionAt).getTime()) / 1000;
  if (ageSeconds <= 180) return "live";
  if (ageSeconds <= 900) return "stale";
  return "offline";
}
