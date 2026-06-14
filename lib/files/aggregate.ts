/**
 * Operational File aggregation — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Phase 1.5. Turns a flat list of dossier rows into the dashboard overview
 * (KPI counts + status / mode breakdowns). No DB, no I/O — unit-tested in
 * isolation; the service fetches tenant-scoped rows and calls aggregateFiles.
 */
import type { FileStatus, TransportMode } from "./types";

/** Minimal projection needed for the overview (status + priority + shipment). */
export type AggregateRow = {
  status: string;
  priority: string;
  transportMode: string | null;
  eta: string | null;
};

export type FileOverview = {
  active: number; // not closed
  opened: number;
  inProgress: number;
  delivered: number;
  closed: number;
  highPriority: number; // high or critical
  overdueShipments: number; // eta passed, not delivered/closed
  byStatus: Record<FileStatus, number>;
  byMode: Record<TransportMode | "none", number>;
};

const STATUSES: FileStatus[] = ["DRAFT", "OPENED", "IN_PROGRESS", "DELIVERED", "CLOSED"];
const MODES: TransportMode[] = ["SEA", "AIR", "ROAD", "MULTIMODAL"];

function shipmentOverdue(row: AggregateRow, now: Date): boolean {
  if (!row.eta) return false;
  if (row.status === "DELIVERED" || row.status === "CLOSED") return false;
  return new Date(row.eta).getTime() < now.getTime();
}

export function aggregateFiles(rows: AggregateRow[], now: Date): FileOverview {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<FileStatus, number>;
  const byMode = { SEA: 0, AIR: 0, ROAD: 0, MULTIMODAL: 0, none: 0 } as Record<
    TransportMode | "none",
    number
  >;

  let highPriority = 0;
  let overdueShipments = 0;

  for (const r of rows) {
    if (r.status in byStatus) byStatus[r.status as FileStatus] += 1;
    const mode = r.transportMode && MODES.includes(r.transportMode as TransportMode)
      ? (r.transportMode as TransportMode)
      : "none";
    byMode[mode] += 1;
    if (r.priority === "high" || r.priority === "critical") highPriority += 1;
    if (shipmentOverdue(r, now)) overdueShipments += 1;
  }

  return {
    active: rows.length - byStatus.CLOSED,
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
