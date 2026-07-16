/**
 * Air Cargo — dashboard aggregate CONTRACTS (Phase 7.3A). PURE. Reuses the freshness engine.
 * Every value is derived from real fields; nothing fabricated. `now` injected.
 */
import type { AirMilestone } from "./milestones";
import { isStaleFreshness, type Freshness } from "@/lib/shipping/intelligence/freshness";

const DAY = 86_400_000;

export type AirDashboardRow = {
  milestone: AirMilestone;
  scheduledDeparture: string | null;
  actualDeparture: string | null;
  scheduledArrival: string | null;
  actualArrival: string | null;
  plannedArrival: string | null;
  estimatedArrival: string | null;
  freshness: Freshness;
  significantEtaChange: boolean;
};

export type AirDashboard = {
  total: number; flightsToday: number; awaitingLoading: number; inFlight: number; transferred: number;
  arriving: number; delayed: number; customs: number; released: number; exceptions: number;
  etaChanges: number; staleTracking: number; delivered: number; averageTransitDays: number | null;
};

const AWAITING: AirMilestone[] = ["ACCEPTED", "SECURITY", "READY_FOR_FLIGHT", "LOADED"];
const RELEASED_SET: AirMilestone[] = ["RELEASED", "DELIVERED"];
const DONE: AirMilestone[] = ["DELIVERED", "CANCELLED"];

function delayed(r: AirDashboardRow, now: number): boolean {
  if (DONE.includes(r.milestone)) return false;
  if (r.scheduledArrival && r.estimatedArrival && new Date(r.estimatedArrival).getTime() - new Date(r.scheduledArrival).getTime() >= DAY) return true;
  if (r.scheduledArrival && !r.actualArrival && new Date(r.scheduledArrival).getTime() < now) return true;
  return false;
}

export function buildAirDashboard(rows: AirDashboardRow[], nowIso: string): AirDashboard {
  const now = new Date(nowIso).getTime();
  const today = nowIso.slice(0, 10);
  const d: AirDashboard = { total: rows.length, flightsToday: 0, awaitingLoading: 0, inFlight: 0, transferred: 0, arriving: 0, delayed: 0, customs: 0, released: 0, exceptions: 0, etaChanges: 0, staleTracking: 0, delivered: 0, averageTransitDays: null };
  const transit: number[] = [];
  for (const r of rows) {
    if (r.scheduledDeparture?.slice(0, 10) === today) d.flightsToday++;
    if (AWAITING.includes(r.milestone)) d.awaitingLoading++;
    if (r.milestone === "DEPARTED") d.inFlight++;
    if (r.milestone === "TRANSFER") d.transferred++;
    if (!DONE.includes(r.milestone) && r.milestone !== "ARRIVED" && r.estimatedArrival && new Date(r.estimatedArrival).getTime() >= now && new Date(r.estimatedArrival).getTime() <= now + 7 * DAY) d.arriving++;
    if (delayed(r, now)) d.delayed++;
    if (r.milestone === "CUSTOMS") d.customs++;
    if (RELEASED_SET.includes(r.milestone)) d.released++;
    if (r.milestone === "EXCEPTION") d.exceptions++;
    if (r.significantEtaChange) d.etaChanges++;
    if (isStaleFreshness(r.freshness) && !DONE.includes(r.milestone)) d.staleTracking++;
    if (r.milestone === "DELIVERED") d.delivered++;
    if (r.actualDeparture && r.actualArrival) { const t = (new Date(r.actualArrival).getTime() - new Date(r.actualDeparture).getTime()) / DAY; if (t >= 0) transit.push(t); }
  }
  if (transit.length) d.averageTransitDays = Math.round((transit.reduce((s, x) => s + x, 0) / transit.length) * 10) / 10;
  return d;
}
