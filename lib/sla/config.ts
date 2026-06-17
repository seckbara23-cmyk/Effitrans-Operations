/**
 * SLA thresholds (Phase 2.3) — code-based constants, PURE. No DB configuration.
 * ---------------------------------------------------------------------------
 * Per-department warning/critical thresholds in HOURS. `archive` is
 * informational only (no SLA). A visibility layer — no escalation/notifications.
 */
export type SlaDept = "documentation" | "customs" | "transport" | "finance" | "archive";

export type SlaThreshold = { warningHours: number; criticalHours: number } | null; // null = informational

const H = 1;
const D = 24;

export const SLA_THRESHOLDS: Record<SlaDept, SlaThreshold> = {
  documentation: { warningHours: 48 * H, criticalHours: 96 * H }, // 48h / 96h
  customs: { warningHours: 72 * H, criticalHours: 144 * H }, // 72h / 144h
  transport: { warningHours: 24 * H, criticalHours: 72 * H }, // 24h / 72h
  finance: { warningHours: 7 * D, criticalHours: 30 * D }, // 7d / 30d
  archive: null, // informational only
};
