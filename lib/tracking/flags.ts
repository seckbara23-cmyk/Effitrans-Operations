/**
 * Real-time tracking feature flags (Phase 3.4) — PURE, unit-testable.
 * ---------------------------------------------------------------------------
 * DARK BY DEFAULT. The master flag gates everything; each sub-capability ALSO
 * requires the master flag on (a sub-flag alone is inert). Kept free of process
 * .env access so the resolution rules can be tested with plain inputs — the
 * server-only reader wiring lives in ./config. Same idiom as
 * lib/portal/admin-actions.ts (passwordEmailAllowed) + lib/finance/providers.
 */
export type TrackingFlagEnv = {
  TRACKING_ENABLED?: string;
  DRIVER_MOBILE_TRACKING_ENABLED?: string;
  PORTAL_LIVE_TRACKING_ENABLED?: string;
  TRACKING_REALTIME_ENABLED?: string;
  TRACKING_GEOFENCE_ENABLED?: string;
};

export type TrackingFlags = {
  /** Master switch — manual ops tracking updates. Off => the whole layer is dark. */
  enabled: boolean;
  /** Driver mobile location sharing (requires master). */
  driverMobile: boolean;
  /** Customer-facing live position / map in the portal (requires master). */
  portalLive: boolean;
  /** Supabase Realtime push instead of periodic refresh (requires master). */
  realtime: boolean;
  /** Geofence arrival-event generation (requires master). */
  geofence: boolean;
};

const on = (v: string | undefined): boolean => v === "true";

export function resolveTrackingFlags(env: TrackingFlagEnv): TrackingFlags {
  const enabled = on(env.TRACKING_ENABLED);
  return {
    enabled,
    // A sub-capability is only live when the master flag is also on.
    driverMobile: enabled && on(env.DRIVER_MOBILE_TRACKING_ENABLED),
    portalLive: enabled && on(env.PORTAL_LIVE_TRACKING_ENABLED),
    realtime: enabled && on(env.TRACKING_REALTIME_ENABLED),
    geofence: enabled && on(env.TRACKING_GEOFENCE_ENABLED),
  };
}
