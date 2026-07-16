/**
 * Shipping Line Platform — exception / alert CONTRACTS (Phase 7.2A). PURE.
 * ---------------------------------------------------------------------------
 * Derives in-app alerts from real shipment facts. No email/SMS/WhatsApp is sent in 7.2A —
 * this is the contract + in-app presentation layer only. `now` injected for determinism.
 */
import type { ShippingMilestone } from "./milestones";
import type { BookingStatus } from "./domain";
import { isStaleFreshness, type Freshness } from "./freshness";

export const SHIPPING_ALERT_CODES = [
  "BOOKING_NOT_CONFIRMED_BY_CUTOFF", "MISSED_DEPARTURE", "SIGNIFICANT_ETA_DELAY", "STALE_CARRIER_DATA",
  "VESSEL_ARRIVED", "CONTAINER_DISCHARGED", "CUSTOMS_BLOCKED", "CONTAINER_AVAILABLE", "GATE_OUT_RECORDED",
  "DELIVERY_OVERDUE", "UNKNOWN_PROVIDER_STATUS",
] as const;
export type ShippingAlertCode = (typeof SHIPPING_ALERT_CODES)[number];

export type AlertSeverity = "info" | "warning" | "critical";
export type ShippingAlert = { code: ShippingAlertCode; severity: AlertSeverity; message: string };

export type AlertShipmentRow = {
  milestone: ShippingMilestone;
  bookingStatus: BookingStatus | null;
  bookingCutoff: string | null;
  plannedDeparture: string | null;
  actualDeparture: string | null;
  plannedArrival: string | null;
  significantEtaChange: boolean;
  freshness: Freshness;
  customsBlocked: boolean;
  hasUnknownProviderStatus: boolean;
};

const DAY = 86_400_000;
const active = (m: ShippingMilestone) => m !== "COMPLETED" && m !== "CANCELLED" && m !== "DELIVERED" && m !== "EMPTY_RETURNED";

/** Derive the in-app alerts for one shipment. Deterministic; ordered most-severe first. */
export function deriveShipmentAlerts(r: AlertShipmentRow, nowIso: string): ShippingAlert[] {
  const now = new Date(nowIso).getTime();
  const out: ShippingAlert[] = [];
  const add = (code: ShippingAlertCode, severity: AlertSeverity, message: string) => out.push({ code, severity, message });

  if (r.customsBlocked) add("CUSTOMS_BLOCKED", "critical", "Blocage douane sur ce dossier.");
  if (r.milestone === "EXCEPTION") add("STALE_CARRIER_DATA", "critical", "Exception signalée sur l'expédition.");

  if (r.bookingStatus !== "CONFIRMED" && r.bookingStatus !== "CANCELLED" && r.bookingCutoff && new Date(r.bookingCutoff).getTime() < now) {
    add("BOOKING_NOT_CONFIRMED_BY_CUTOFF", "critical", "Réservation non confirmée avant la date limite.");
  }
  if (active(r.milestone) && r.plannedDeparture && !r.actualDeparture && new Date(r.plannedDeparture).getTime() < now) {
    add("MISSED_DEPARTURE", "warning", "Départ prévu dépassé sans départ effectif.");
  }
  if (active(r.milestone) && r.significantEtaChange) add("SIGNIFICANT_ETA_DELAY", "warning", "Changement d'ETA significatif.");
  if (active(r.milestone) && isStaleFreshness(r.freshness)) add("STALE_CARRIER_DATA", "warning", "Données de suivi anciennes.");
  if (active(r.milestone) && r.plannedArrival && new Date(r.plannedArrival).getTime() + DAY < now) {
    add("DELIVERY_OVERDUE", "warning", "Livraison en retard par rapport au plan.");
  }
  if (r.hasUnknownProviderStatus) add("UNKNOWN_PROVIDER_STATUS", "info", "Statut fournisseur non reconnu — non appliqué.");

  if (r.milestone === "VESSEL_ARRIVED") add("VESSEL_ARRIVED", "info", "Navire arrivé.");
  if (r.milestone === "DISCHARGED") add("CONTAINER_DISCHARGED", "info", "Conteneur déchargé.");
  if (r.milestone === "AVAILABLE_FOR_PICKUP") add("CONTAINER_AVAILABLE", "info", "Conteneur disponible à l'enlèvement.");
  if (r.milestone === "GATE_OUT") add("GATE_OUT_RECORDED", "info", "Sortie terminal enregistrée.");

  const rank: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
