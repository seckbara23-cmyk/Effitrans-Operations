/**
 * Shipping Line Platform — dashboard aggregate CONTRACTS (Phase 7.2A). PURE.
 * ---------------------------------------------------------------------------
 * Reusable aggregates over a lightweight shipment row. Contracts only — no UI. Every value
 * is derived from real fields; nothing is fabricated. `now` injected for determinism.
 */
import type { ShippingMilestone } from "./milestones";
import type { BookingStatus } from "./domain";
import { isStaleFreshness, type Freshness } from "./freshness";

const DAY = 86_400_000;

export type DashboardShipmentRow = {
  milestone: ShippingMilestone;
  bookingStatus: BookingStatus | null;
  plannedArrival: string | null;
  estimatedArrival: string | null;
  plannedDeparture: string | null;
  actualDeparture: string | null;
  freshness: Freshness;
  significantEtaChange: boolean;
  containersLoaded: number;
  containersAtTransshipment: number;
  containersAwaitingCustoms: number;
};

export type ShippingDashboard = {
  total: number;
  inTransit: number;
  bookingsAwaitingConfirmation: number;
  containersLoaded: number;
  containersAtTransshipment: number;
  vesselsArrivingWithin7Days: number;
  delayed: number;
  etaChanges: number;
  staleTracking: number;
  exceptions: number;
  containersAwaitingCustoms: number;
  delivered: number;
};

const IN_TRANSIT: ShippingMilestone[] = ["VESSEL_DEPARTED", "IN_TRANSIT", "TRANSSHIPMENT_ARRIVED", "TRANSSHIPMENT_DEPARTED"];
const DELIVERED_SET: ShippingMilestone[] = ["DELIVERED", "EMPTY_RETURNED", "COMPLETED"];

function isDelayed(r: DashboardShipmentRow, now: number): boolean {
  if (DELIVERED_SET.includes(r.milestone) || r.milestone === "CANCELLED") return false;
  if (r.plannedArrival && r.estimatedArrival) {
    if (new Date(r.estimatedArrival).getTime() - new Date(r.plannedArrival).getTime() >= DAY) return true;
  }
  if (r.plannedArrival && new Date(r.plannedArrival).getTime() < now) return true; // overdue vs plan
  return false;
}

function arrivingWithin7Days(r: DashboardShipmentRow, now: number): boolean {
  if (DELIVERED_SET.includes(r.milestone) || r.milestone === "VESSEL_ARRIVED") return false;
  const eta = r.estimatedArrival ? new Date(r.estimatedArrival).getTime() : null;
  return eta != null && eta >= now && eta <= now + 7 * DAY;
}

export function buildShippingDashboard(rows: DashboardShipmentRow[], nowIso: string): ShippingDashboard {
  const now = new Date(nowIso).getTime();
  const d: ShippingDashboard = {
    total: rows.length, inTransit: 0, bookingsAwaitingConfirmation: 0, containersLoaded: 0,
    containersAtTransshipment: 0, vesselsArrivingWithin7Days: 0, delayed: 0, etaChanges: 0,
    staleTracking: 0, exceptions: 0, containersAwaitingCustoms: 0, delivered: 0,
  };
  for (const r of rows) {
    if (IN_TRANSIT.includes(r.milestone)) d.inTransit++;
    if ((r.milestone === "BOOKING_CREATED" || r.bookingStatus === "REQUESTED" || r.bookingStatus === "DRAFT") && r.bookingStatus !== "CONFIRMED") d.bookingsAwaitingConfirmation++;
    d.containersLoaded += r.containersLoaded;
    d.containersAtTransshipment += r.containersAtTransshipment;
    d.containersAwaitingCustoms += r.containersAwaitingCustoms;
    if (arrivingWithin7Days(r, now)) d.vesselsArrivingWithin7Days++;
    if (isDelayed(r, now)) d.delayed++;
    if (r.significantEtaChange) d.etaChanges++;
    if (isStaleFreshness(r.freshness) && !DELIVERED_SET.includes(r.milestone)) d.staleTracking++;
    if (r.milestone === "EXCEPTION") d.exceptions++;
    if (DELIVERED_SET.includes(r.milestone)) d.delivered++;
  }
  return d;
}
