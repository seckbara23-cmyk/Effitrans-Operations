/**
 * Tracking feature-flag reader (Phase 3.4). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Reads the tracking env flags (static literal access so Next inlines correctly)
 * and resolves them through the pure gate in ./flags. Server-only: these are NOT
 * NEXT_PUBLIC_ (the browser learns tracking availability from server-rendered
 * props / API responses, never from a bundled secret). DARK BY DEFAULT — with
 * TRACKING_ENABLED unset every getter returns false and the lifecycle portal is
 * unchanged.
 */
import "server-only";
import { resolveTrackingFlags, type TrackingFlags } from "./flags";

export function getTrackingFlags(): TrackingFlags {
  return resolveTrackingFlags({
    TRACKING_ENABLED: process.env.TRACKING_ENABLED,
    DRIVER_MOBILE_TRACKING_ENABLED: process.env.DRIVER_MOBILE_TRACKING_ENABLED,
    PORTAL_LIVE_TRACKING_ENABLED: process.env.PORTAL_LIVE_TRACKING_ENABLED,
    TRACKING_REALTIME_ENABLED: process.env.TRACKING_REALTIME_ENABLED,
    TRACKING_GEOFENCE_ENABLED: process.env.TRACKING_GEOFENCE_ENABLED,
  });
}

/** Master switch — with this off the whole tracking layer is dark. */
export function trackingEnabled(): boolean {
  return getTrackingFlags().enabled;
}
export function driverMobileTrackingEnabled(): boolean {
  return getTrackingFlags().driverMobile;
}
export function portalLiveTrackingEnabled(): boolean {
  return getTrackingFlags().portalLive;
}
export function trackingRealtimeEnabled(): boolean {
  return getTrackingFlags().realtime;
}
export function trackingGeofenceEnabled(): boolean {
  return getTrackingFlags().geofence;
}
