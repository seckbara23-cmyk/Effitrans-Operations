/**
 * TRACKING-06B — the rules governing how a live marker is DRAWN between two
 * recorded fixes. PURE (no DOM, no map, no I/O), so the truthfulness guarantees
 * are unit-testable instead of buried in a React effect.
 * ---------------------------------------------------------------------------
 * WHAT THIS IS. Presentation state only. The database remains the authority for
 * where a vehicle was observed: `tracking_position` rows are the facts, and the
 * two endpoints of every screen transition are two of those rows. Nothing here
 * is written anywhere, sent to any API, or offered as history — and nothing here
 * invents a coordinate that is claimed to have been observed.
 *
 * WHY A MODULE. Three of these rules are the difference between an honest map
 * and a lying one, and each deserves a test that does not need a WebGL canvas:
 *
 *   1. A HEADING IS ONLY EVER A RECORDED HEADING. `heading_degrees` comes from
 *      the device. On the 2026-09-27 road session only 4 of 12 fixes carried
 *      one, because Android reports none while stationary. Absence must never
 *      become 0° — that would draw a vehicle confidently facing north on the
 *      strength of no evidence at all. Nothing here derives a course from
 *      successive coordinates.
 *   2. A LONG HOP IS NOT MOVEMENT. Two fixes an hour and forty kilometres apart
 *      are not a journey the platform watched; gliding between them would
 *      animate a trip nobody observed, and would also send the marker racing
 *      across the map. Beyond a bounded gap the marker SNAPS.
 *   3. THE TRANSITION ALWAYS ENDS ON THE RECORDED POINT. Easing is a screen
 *      effect with a fixed, short duration; it never runs on past the last fix,
 *      never predicts, and never dead-reckons.
 */
import { haversineMeters } from "./geo";

/** How long a marker takes to glide between two consecutive recorded fixes. */
export const MARKER_EASE_MS = 1_200;

/**
 * Beyond this separation the marker snaps rather than glides.
 *
 * Positions are persisted at most every 60 s / 250 m, and the live map refreshes
 * every 30 s, so ordinary consecutive fixes sit well inside this bound. What
 * lies outside it is a signal gap — a phone whose screen was locked, a tunnel,
 * a mission resumed elsewhere — and a glide across that would be an animation of
 * travel the platform never saw.
 */
export const MARKER_SNAP_ABOVE_METERS = 2_000;

export type LatLng = { lat: number; lng: number };

/**
 * A recorded heading, or null. NEVER a derived one.
 *
 * Accepts only a finite number in [0, 360). `null`, `undefined`, NaN and
 * out-of-range values are all "unknown" — and unknown stays unknown, because the
 * alternative is a vehicle pointing north for no reason.
 */
export function recordedHeading(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v)) return null;
  if (v < 0 || v >= 360) return null;
  return v;
}

/**
 * The rotation to draw, given the new fix's heading and the last one recorded
 * for this mission.
 *
 * A vehicle that stops reporting a course has not turned to face north; it has
 * simply stopped telling us. Holding the last COURSE IT ACTUALLY REPORTED is
 * the smallest truthful answer, and `fromCurrentFix` lets the caller say so in
 * the accessible label rather than passing a stale bearing off as fresh.
 *
 * When nothing has ever been recorded for the mission, the answer is null and
 * the marker is drawn without an orientation claim.
 */
export function rotationFor(
  fixHeading: number | null | undefined,
  lastRecorded: number | null,
): { degrees: number | null; fromCurrentFix: boolean } {
  const fresh = recordedHeading(fixHeading);
  if (fresh !== null) return { degrees: fresh, fromCurrentFix: true };
  const held = recordedHeading(lastRecorded);
  return { degrees: held, fromCurrentFix: false };
}

/**
 * Should the marker glide from `from` to `to`, or snap?
 *
 * `from` is wherever the marker is currently DRAWN (which may be mid-glide);
 * `to` is the newly recorded fix. Identical points need no transition at all.
 */
export function shouldEase(
  from: LatLng | null,
  to: LatLng,
  opts: { reducedMotion?: boolean; snapAboveMeters?: number } = {},
): boolean {
  if (!from) return false; // first appearance: place it, do not fly it in
  if (opts.reducedMotion) return false;
  const metres = haversineMeters(from, to);
  if (metres === 0) return false;
  return metres <= (opts.snapAboveMeters ?? MARKER_SNAP_ABOVE_METERS);
}

/** easeInOutQuad on [0,1]. Starts and stops gently; exactly 0→0 and 1→1. */
export function easeInOutQuad(t: number): number {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
}

/**
 * The coordinate to DRAW at progress `t` between two recorded fixes.
 *
 * At t=1 it returns `to` EXACTLY — the transition lands on the recorded point
 * rather than near it. Straight-line easing in lat/lng: no road geometry, no
 * path reconstruction, no claim that the vehicle passed through any value this
 * returns. These are screen coordinates for one animation frame and are never
 * persisted, transmitted or shown as history.
 */
export function frameAt(from: LatLng, to: LatLng, t: number): LatLng {
  if (t >= 1) return { lat: to.lat, lng: to.lng };
  if (t <= 0) return { lat: from.lat, lng: from.lng };
  const s = easeInOutQuad(t);
  return { lat: from.lat + (to.lat - from.lat) * s, lng: from.lng + (to.lng - from.lng) * s };
}
