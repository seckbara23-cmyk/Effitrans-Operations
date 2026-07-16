/**
 * Air Cargo — exception / alert CONTRACTS (Phase 7.3A). PURE. In-app only (no email/SMS).
 * `now` injected. Missing optional data never fabricates an alert.
 */
import type { AirMilestone } from "./milestones";
import { isStaleFreshness, type Freshness } from "@/lib/shipping/intelligence/freshness";

export const AIR_ALERT_CODES = [
  "MISSED_DEPARTURE", "ARRIVAL_DELAYED", "CONNECTION_MISSED", "ULD_MISMATCH", "CARGO_MISMATCH",
  "CUSTOMS_WAITING", "UNKNOWN_MILESTONE", "STALE_TRACKING",
] as const;
export type AirAlertCode = (typeof AIR_ALERT_CODES)[number];
export type AlertSeverity = "info" | "warning" | "critical";
export type AirAlert = { code: AirAlertCode; severity: AlertSeverity; message: string };

export type AirAlertRow = {
  milestone: AirMilestone;
  scheduledDeparture: string | null;
  actualDeparture: string | null;
  scheduledArrival: string | null;
  estimatedArrival: string | null;
  freshness: Freshness;
  connectionMissed: boolean;
  uldMismatch: boolean;
  cargoMismatch: boolean;
  hasUnknownEvent: boolean;
};

const DAY = 86_400_000;
const active = (m: AirMilestone) => m !== "DELIVERED" && m !== "CANCELLED";

export function deriveAirAlerts(r: AirAlertRow, nowIso: string): AirAlert[] {
  const now = new Date(nowIso).getTime();
  const out: AirAlert[] = [];
  const add = (code: AirAlertCode, severity: AlertSeverity, message: string) => out.push({ code, severity, message });

  if (r.milestone === "EXCEPTION") add("STALE_TRACKING", "critical", "Exception signalée sur l'expédition aérienne.");
  if (r.connectionMissed) add("CONNECTION_MISSED", "critical", "Correspondance manquée.");
  if (r.uldMismatch) add("ULD_MISMATCH", "warning", "Incohérence ULD.");
  if (r.cargoMismatch) add("CARGO_MISMATCH", "warning", "Incohérence de fret.");
  if (active(r.milestone) && r.scheduledDeparture && !r.actualDeparture && new Date(r.scheduledDeparture).getTime() < now) add("MISSED_DEPARTURE", "warning", "Départ programmé dépassé sans décollage.");
  if (active(r.milestone) && r.scheduledArrival && r.estimatedArrival && new Date(r.estimatedArrival).getTime() - new Date(r.scheduledArrival).getTime() >= DAY) add("ARRIVAL_DELAYED", "warning", "Arrivée retardée (ETA).");
  if (active(r.milestone) && isStaleFreshness(r.freshness)) add("STALE_TRACKING", "warning", "Données de suivi anciennes.");
  if (r.milestone === "CUSTOMS") add("CUSTOMS_WAITING", "info", "En attente de dédouanement.");
  if (r.hasUnknownEvent) add("UNKNOWN_MILESTONE", "info", "Jalon fournisseur non reconnu — non appliqué.");

  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
