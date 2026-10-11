/**
 * UAT-TRANSPORT-POD-FIX-01 — what a driver may record, and why not. PURE.
 * ---------------------------------------------------------------------------
 * The 2026-10-10 UAT lost a real delivery to two silent rules. This module
 * states both of them once, in one place, so the server actions, the ingest
 * endpoint, the read model and the screen all answer the same way — and so the
 * refusal can be EXPLAINED to the driver instead of failing generically.
 *
 * ===========================================================================
 * 1. WHICH SESSION STATES ARE "STILL THIS MISSION"
 * ===========================================================================
 * `RETURNING` was added when the return leg shipped (TMS-2): the client keeps
 * its GPS watch open, the fleet keeps the vehicle engaged, the live map keeps
 * the mission on screen. Two paths never learned the word, and both of them
 * belong to the driver:
 *
 *   * the position ingest accepted ACTIVE only, so every fix recorded after
 *     « Démarrer le retour » was refused with 409 — which the control tower
 *     then displayed as a lost signal;
 *   * every driver write (event, evidence, delivery) demanded ACTIVE|PAUSED,
 *     so the delivery the driver was trying to confirm could not be recorded.
 *
 * So a live session is ACTIVE, PAUSED or RETURNING — and positions flow in
 * ACTIVE and RETURNING only. PAUSED is EXCLUDED FROM POSITIONS DELIBERATELY:
 * the driver who suspends sharing has withdrawn consent for that interval, and
 * the client stops watching. Pausing hides the vehicle; it does not void the
 * paperwork, which is why a paused mission may still record evidence.
 *
 * ===========================================================================
 * 2. WHY A DELIVERY MAY BE REFUSED, SAID PLAINLY
 * ===========================================================================
 * `canTransition` in lib/transport/status remains the ONLY authority on what
 * the transport record may become: this module never grants a transition, it
 * only names the reason one is unavailable. Chiefly the reason found in the
 * UAT — the official pickup (step 15, staff-held) was never recorded, so the
 * record sat at DRIVER_ASSIGNED and `DRIVER_ASSIGNED → DELIVERED` is not a
 * legal edge. The driver saw « Transition non autorisée. » and could do
 * nothing with that sentence. Now the screen says the office has not confirmed
 * the pickup yet, which is actionable: she calls the coordinator.
 *
 * The driver's own « Enlèvement confirmé » stays what it always was — a
 * tracking event, evidence of what she observed, not a workflow transition.
 * Changing that is an authority decision and is NOT taken here (see
 * docs/transport/driver-pickup-authority-decision.md).
 */
import { canTransition } from "@/lib/transport/status";
import type { TransportStatus } from "@/lib/transport/types";
import type { TrackingSessionStatus } from "@/lib/tracking/types";

/** Session states that still belong to a running mission (driver may record). */
export const LIVE_SESSION_STATUSES: readonly TrackingSessionStatus[] = ["ACTIVE", "PAUSED", "RETURNING"];

/** Session states whose GPS the platform accepts. PAUSED excluded by consent. */
export const POSITION_SESSION_STATUSES: readonly TrackingSessionStatus[] = ["ACTIVE", "RETURNING"];

export function isLiveSession(status: TrackingSessionStatus | string | null | undefined): boolean {
  return typeof status === "string" && (LIVE_SESSION_STATUSES as readonly string[]).includes(status);
}

/** May this session's GPS batches be stored? (ingest authority) */
export function acceptsPositions(status: TrackingSessionStatus | string | null | undefined): boolean {
  return typeof status === "string" && (POSITION_SESSION_STATUSES as readonly string[]).includes(status);
}

/**
 * Why there is no session to record against — told apart so the driver learns
 * whether to START the mission or to call the office about a finished one.
 * `latest` is the newest session for the transport, whatever its state.
 */
export type SessionBlock = "no_session" | "session_completed";

export function sessionBlock(latest: TrackingSessionStatus | string | null | undefined): SessionBlock | null {
  if (latest == null || latest === "") return "no_session";
  if (isLiveSession(latest)) return null;
  // COMPLETED or CANCELLED: the mission's tracking is over. A correction is the
  // office's to make; a driver re-opening it silently would rewrite history.
  return "session_completed";
}

/**
 * Why the assigned driver cannot confirm delivery right now, or null when she
 * can. Derived FROM `canTransition`, never beside it: a future edit to the
 * state machine changes this answer automatically.
 */
export type DeliveryBlock =
  | "pickup_not_recorded"
  | "already_delivered"
  | "mission_cancelled"
  | "invalid_transition";

/** Transport states that precede the office's official pickup (step 15). */
const BEFORE_OFFICIAL_PICKUP: readonly TransportStatus[] = ["NOT_STARTED", "PLANNED", "DRIVER_ASSIGNED"];

export function deliveryBlock(status: TransportStatus | string | null | undefined): DeliveryBlock | null {
  if (typeof status !== "string") return "invalid_transition";
  if (canTransition(status as TransportStatus, "DELIVERED")) return null;
  if ((BEFORE_OFFICIAL_PICKUP as readonly string[]).includes(status)) return "pickup_not_recorded";
  if (status === "DELIVERED" || status === "POD_RECEIVED") return "already_delivered";
  if (status === "CANCELLED") return "mission_cancelled";
  return "invalid_transition";
}
