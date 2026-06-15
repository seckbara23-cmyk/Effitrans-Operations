/**
 * Transport execution state machine (Phase 1.10) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Forward flow with BLOCKED (pause/resume) and CANCELLED (abort). PICKED_UP can
 * jump straight to DELIVERED for short hauls. POD_RECEIVED and CANCELLED are
 * terminal. Mirrors the customs/task/file pattern (unit-tested).
 */
import type { TransportStatus } from "./types";

export const TRANSPORT_STATUSES: TransportStatus[] = [
  "NOT_STARTED",
  "PLANNED",
  "DRIVER_ASSIGNED",
  "PICKED_UP",
  "IN_TRANSIT",
  "DELIVERED",
  "POD_RECEIVED",
  "BLOCKED",
  "CANCELLED",
];

const ALLOWED: Record<TransportStatus, TransportStatus[]> = {
  NOT_STARTED: ["PLANNED", "CANCELLED"],
  PLANNED: ["DRIVER_ASSIGNED", "BLOCKED", "CANCELLED"],
  DRIVER_ASSIGNED: ["PICKED_UP", "BLOCKED", "CANCELLED"],
  PICKED_UP: ["IN_TRANSIT", "DELIVERED", "BLOCKED", "CANCELLED"],
  IN_TRANSIT: ["DELIVERED", "BLOCKED", "CANCELLED"],
  DELIVERED: ["POD_RECEIVED", "BLOCKED", "CANCELLED"],
  POD_RECEIVED: [],
  BLOCKED: ["PLANNED", "DRIVER_ASSIGNED", "PICKED_UP", "IN_TRANSIT", "DELIVERED", "CANCELLED"],
  CANCELLED: [],
};

export function isTransportStatus(v: string): v is TransportStatus {
  return (TRANSPORT_STATUSES as string[]).includes(v);
}

export function nextStatuses(from: TransportStatus): TransportStatus[] {
  return ALLOWED[from] ?? [];
}

export function canTransition(from: TransportStatus, to: TransportStatus): boolean {
  return nextStatuses(from).includes(to);
}

export function isTerminal(status: TransportStatus): boolean {
  return status === "POD_RECEIVED" || status === "CANCELLED";
}
