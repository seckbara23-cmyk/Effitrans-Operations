/**
 * Shipping Line Platform — ETA with provenance (Phase 7.2A). PURE.
 * ---------------------------------------------------------------------------
 * An ETA is only as trustworthy as its source. We store the value WITH its provenance and
 * never present a system estimate as a carrier-confirmed ETA. No predictor is built in
 * 7.2A. Significant changes are detected so the console/alerts can surface real slippage.
 */
export const ETA_SOURCES = ["CARRIER", "PORT", "AIS_DERIVED", "MANUAL", "SYSTEM_ESTIMATE"] as const;
export type EtaSource = (typeof ETA_SOURCES)[number];

export const ETA_CONFIDENCES = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;
export type EtaConfidence = (typeof ETA_CONFIDENCES)[number];

export type ShipmentEta = {
  value: string; // ISO timestamp
  source: EtaSource;
  calculatedAt: string;
  confidence: EtaConfidence;
  previousValue?: string | null;
};

/** Default confidence by source when a provider does not state one. Carrier-stated is
 *  HIGH; a system estimate is never higher than LOW. */
export function defaultEtaConfidence(source: EtaSource): EtaConfidence {
  switch (source) {
    case "CARRIER": return "HIGH";
    case "PORT": return "MEDIUM";
    case "AIS_DERIVED": return "MEDIUM";
    case "MANUAL": return "MEDIUM";
    case "SYSTEM_ESTIMATE": return "LOW";
    default: return "UNKNOWN";
  }
}

/** True only for a carrier-stated ETA — the UI uses this to avoid labelling estimates as confirmed. */
export function isCarrierConfirmedEta(eta: ShipmentEta | null | undefined): boolean {
  return !!eta && eta.source === "CARRIER";
}

/** Apply a new ETA, preserving the prior value as history. Pure. */
export function applyEta(current: ShipmentEta | null, next: { value: string; source: EtaSource; calculatedAt: string; confidence?: EtaConfidence }): ShipmentEta {
  return {
    value: next.value,
    source: next.source,
    calculatedAt: next.calculatedAt,
    confidence: next.confidence ?? defaultEtaConfidence(next.source),
    previousValue: current?.value ?? null,
  };
}

export type EtaChange = { changed: boolean; significant: boolean; deltaHours: number; direction: "earlier" | "later" | "none" };

/**
 * Compare two ETA instants. A change is "significant" when it moves by at least
 * `thresholdHours` (default 24h) — the console/alerts surface those, not every minor drift.
 */
export function detectEtaChange(previous: string | null | undefined, next: string | null | undefined, thresholdHours = 24): EtaChange {
  if (!previous || !next) return { changed: !!next && !previous, significant: false, deltaHours: 0, direction: "none" };
  const p = new Date(previous).getTime();
  const n = new Date(next).getTime();
  if (!Number.isFinite(p) || !Number.isFinite(n)) return { changed: false, significant: false, deltaHours: 0, direction: "none" };
  const deltaHours = (n - p) / 3_600_000;
  const abs = Math.abs(deltaHours);
  return {
    changed: abs > 0,
    significant: abs >= thresholdHours,
    deltaHours: Math.round(deltaHours * 10) / 10,
    direction: deltaHours > 0 ? "later" : deltaHours < 0 ? "earlier" : "none",
  };
}
