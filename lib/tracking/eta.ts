/**
 * Real-time ETA (Phase 3.4, ETA v2) — PURE. No AI, no fabrication.
 * ---------------------------------------------------------------------------
 * Extends the conservative portal ETA v1 (lib/portal/eta.ts) with a real-time
 * layer. It reuses v1's grounded date ladder (delivered → scheduled → transport
 * ETA → operational estimate → unknown) and adjusts CONFIDENCE from live-
 * position freshness:
 *   - a single GPS point NEVER yields high confidence (capped at medium);
 *   - a STALE position DEGRADES confidence and switches the basis to
 *     "last_known_position";
 *   - a position alone (no scheduled/ETA date) does NOT invent a date — the ETA
 *     stays "unavailable" (there is no route/speed engine this phase).
 * Output matches the RealtimeEta contract in the phase brief.
 */
import { derivePortalEta, type EtaConfidence } from "@/lib/portal/eta";
import type { PortalStageKey } from "@/lib/portal/progress-map";
import { classifyFreshness, DEFAULT_FRESHNESS_THRESHOLDS, type FreshnessThresholds } from "./position";

export type RealtimeEtaBasis =
  | "scheduled"
  | "transport_eta"
  | "live_position"
  | "last_known_position"
  | "operational_estimate"
  | "unavailable";

export type RealtimeEta = {
  estimatedArrival: string | null;
  confidence: EtaConfidence;
  confidencePercent: number;
  basis: RealtimeEtaBasis;
  lastCalculatedAt: string;
  delayMinutes?: number;
};

export type RealtimeEtaInput = {
  deliveredActual: string | null;
  scheduledDelivery: string | null;
  transportEta: string | null;
  pickupActual: string | null;
  currentStageKey: PortalStageKey | null;
  /** recorded_at of the latest known position, or null if none. */
  livePositionAt: string | null;
  now: Date;
  freshness?: FreshnessThresholds;
};

const CONF_PCT: Record<EtaConfidence, number> = { high: 90, medium: 70, low: 40 };
const ORDER: EtaConfidence[] = ["low", "medium", "high"];

/** Lower of two confidences (a single GPS fix can't push confidence up). */
function capAt(conf: EtaConfidence, max: EtaConfidence): EtaConfidence {
  return ORDER.indexOf(conf) <= ORDER.indexOf(max) ? conf : max;
}
/** One step down (stale tracking reduces confidence). */
function degrade(conf: EtaConfidence): EtaConfidence {
  const i = ORDER.indexOf(conf);
  return ORDER[Math.max(0, i - 1)];
}

function minutesPast(iso: string, now: Date): number {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  const diff = now.getTime() - t;
  return diff > 0 ? Math.floor(diff / 60_000) : 0;
}

export function deriveRealtimeEta(input: RealtimeEtaInput): RealtimeEta {
  const lastCalculatedAt = input.now.toISOString();
  const base = derivePortalEta({
    deliveredActual: input.deliveredActual,
    scheduledDelivery: input.scheduledDelivery,
    transportEta: input.transportEta,
    pickupActual: input.pickupActual,
    currentStageKey: input.currentStageKey,
    now: input.now,
  });

  // Delivered: arrival is an actual, not an estimate. No delay, no live overlay.
  if (base.basis === "delivered") {
    return {
      estimatedArrival: base.estimatedDate,
      confidence: "high",
      confidencePercent: CONF_PCT.high,
      basis: "scheduled",
      lastCalculatedAt,
      delayMinutes: 0,
    };
  }

  const baseBasis: RealtimeEtaBasis =
    base.basis === "scheduled_delivery"
      ? "scheduled"
      : base.basis === "transport_eta"
        ? "transport_eta"
        : base.basis === "operational_estimate"
          ? "operational_estimate"
          : "unavailable";

  // No grounded date => never fabricate one, even with a live position.
  if (!base.estimatedDate) {
    return {
      estimatedArrival: null,
      confidence: "low",
      confidencePercent: 0,
      basis: "unavailable",
      lastCalculatedAt,
    };
  }

  let confidence = base.confidence;
  let basis: RealtimeEtaBasis = baseBasis;

  if (input.livePositionAt) {
    const freshness = classifyFreshness(input.livePositionAt, input.now, input.freshness ?? DEFAULT_FRESHNESS_THRESHOLDS);
    if (freshness === "live" || freshness === "recent") {
      basis = "live_position";
      confidence = capAt(confidence, "medium"); // one point can't claim high
    } else if (freshness === "stale") {
      basis = "last_known_position";
      confidence = degrade(confidence);
    }
    // freshness === "none" shouldn't happen (livePositionAt present) — leave base.
  }

  return {
    estimatedArrival: base.estimatedDate,
    confidence,
    confidencePercent: CONF_PCT[confidence],
    basis,
    lastCalculatedAt,
    delayMinutes: minutesPast(base.estimatedDate, input.now),
  };
}
