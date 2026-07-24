/**
 * Operational File aggregation — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Phase 1.5. Turns a flat list of dossier rows into the dashboard overview
 * (KPI counts + status / mode breakdowns). No DB, no I/O — unit-tested in
 * isolation; the service fetches tenant-scoped rows and calls aggregateFiles.
 */
import type { FileStatus, TransportMode } from "./types";
import { FILE_STATUSES, isActiveFileStatus, isFileStatus } from "./status";

/** Minimal projection needed for the overview (status + priority + shipment). */
export type AggregateRow = {
  status: string;
  priority: string;
  transportMode: string | null;
  eta: string | null;
};

export type FileOverview = {
  active: number; // DEC-B43: not in a terminal state (CLOSED / CANCELLED)
  opened: number;
  inProgress: number;
  delivered: number;
  closed: number;
  highPriority: number; // high or critical
  overdueShipments: number; // eta passed, not delivered and not terminal
  byStatus: Record<FileStatus, number>;
  byMode: Record<TransportMode | "none", number>;
};

const MODES: TransportMode[] = ["SEA", "AIR", "ROAD", "MULTIMODAL"];

function shipmentOverdue(row: AggregateRow, now: Date): boolean {
  if (!row.eta) return false;
  // DELIVERED and terminal (CLOSED/CANCELLED) dossiers are never "overdue" work.
  if (row.status === "DELIVERED" || (isFileStatus(row.status) && !isActiveFileStatus(row.status))) return false;
  return new Date(row.eta).getTime() < now.getTime();
}

export function aggregateFiles(rows: AggregateRow[], now: Date): FileOverview {
  const byStatus = Object.fromEntries(FILE_STATUSES.map((s) => [s, 0])) as Record<FileStatus, number>;
  const byMode = { SEA: 0, AIR: 0, ROAD: 0, MULTIMODAL: 0, none: 0 } as Record<
    TransportMode | "none",
    number
  >;

  let active = 0;
  let highPriority = 0;
  let overdueShipments = 0;

  for (const r of rows) {
    if (r.status in byStatus) byStatus[r.status as FileStatus] += 1;
    // DEC-B43 — the ONE active-dossier predicate (unknown legacy statuses count as active).
    if (!isFileStatus(r.status) || isActiveFileStatus(r.status)) active += 1;
    const mode = r.transportMode && MODES.includes(r.transportMode as TransportMode)
      ? (r.transportMode as TransportMode)
      : "none";
    byMode[mode] += 1;
    if (r.priority === "high" || r.priority === "critical") highPriority += 1;
    if (shipmentOverdue(r, now)) overdueShipments += 1;
  }

  return {
    active,
    opened: byStatus.OPENED,
    inProgress: byStatus.IN_PROGRESS,
    delivered: byStatus.DELIVERED,
    closed: byStatus.CLOSED,
    highPriority,
    overdueShipments,
    byStatus,
    byMode,
  };
}
