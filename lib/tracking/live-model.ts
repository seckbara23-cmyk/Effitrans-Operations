/**
 * TMS-2 — the live-map read model and its KPIs. PURE (no I/O, no auth), so
 * every rule is unit-testable without a React server environment.
 *
 * Kept apart from live-service.ts on purpose: that module resolves permissions
 * and talks to the database, and importing it into a test drags the whole auth
 * chain along. The shapes and the arithmetic belong here; the queries there.
 */
import type { TrackingHealth } from "./health";
import type { MissionLeg, TrackingSessionStatus } from "./types";

export type LiveMissionPoint = { lat: number; lng: number; at: string };

export type LiveMission = {
  transportId: string;
  fileId: string;
  fileNumber: string;
  /** Free-text plate for an external vehicle; the fleet registration when bound. */
  vehicleLabel: string | null;
  driverName: string | null;
  transportStatus: string;
  sessionStatus: TrackingSessionStatus;
  leg: MissionLeg;
  health: TrackingHealth;
  lastPosition: LiveMissionPoint | null;
  pickupLocation: string | null;
  deliveryLocation: string | null;
  /** Point A. Null when the business has not defined one (see TMS2-R1). */
  returnLocation: string | null;
  returnPoint: { lat: number; lng: number } | null;
  returnStartedAt: string | null;
};

export type LiveTrackingKpis = {
  tracked: number;
  outbound: number;
  returning: number;
  staleOrOffline: number;
  endedToday: number;
};

/**
 * KPIs derived from the live set — PURE over the rows above, so nothing is
 * fabricated when no tracking exists: an empty fleet yields zeros, not blanks
 * and not invented activity.
 */
export function summarizeLiveMissions(missions: readonly LiveMission[], endedToday = 0): LiveTrackingKpis {
  return {
    tracked: missions.length,
    outbound: missions.filter((m) => m.leg === "OUTBOUND").length,
    returning: missions.filter((m) => m.leg === "RETURN").length,
    staleOrOffline: missions.filter((m) => m.health === "stale" || m.health === "offline").length,
    endedToday,
  };
}
