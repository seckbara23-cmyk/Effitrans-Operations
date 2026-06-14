/**
 * Operational File search / filter / sort — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Phase 1.4. No DB, no I/O — the single source of truth for the dossier work
 * queue logic so it can be unit-tested in isolation. The service fetches the
 * tenant's rows (RLS/permission-scoped) and runs these over them. Search is
 * case-insensitive substring (ILIKE-style); no full-text search this phase.
 */
import type { FileSortKey, FileFilterCriteria } from "./types";

/** Flat, searchable projection of an operational_file (+ client + shipment). */
export type FileSearchRow = {
  id: string;
  fileNumber: string;
  type: string;
  status: string;
  priority: string;
  createdAt: string;
  accountManagerId: string | null;
  clientId: string | null;
  clientName: string | null;
  origin: string | null;
  destination: string | null;
  blAwbRef: string | null;
  containerRef: string | null;
  transportMode: string | null;
  eta: string | null;
};

/** The six fields the search box matches against (ILIKE / substring). */
export function matchesSearch(row: FileSearchRow, rawTerm: string | undefined): boolean {
  const term = (rawTerm ?? "").trim().toLowerCase();
  if (!term) return true;
  return [
    row.fileNumber,
    row.clientName,
    row.origin,
    row.destination,
    row.blAwbRef,
    row.containerRef,
  ].some((v) => (v ?? "").toLowerCase().includes(term));
}

/** Active = anything not yet closed (used by KPIs + the "active" sense). */
export function isActiveFile(status: string): boolean {
  return status !== "CLOSED";
}

/** A file is "overdue" when its ETA has passed but it isn't delivered/closed. */
export function isOverdue(row: FileSearchRow, now: Date): boolean {
  if (!row.eta) return false;
  if (row.status === "DELIVERED" || row.status === "CLOSED") return false;
  return new Date(row.eta).getTime() < now.getTime();
}

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
const STATUS_ORDER: Record<string, number> = {
  DRAFT: 0,
  OPENED: 1,
  IN_PROGRESS: 2,
  DELIVERED: 3,
  CLOSED: 4,
};

/**
 * Apply every structured filter + free-text search. `now` is injected so the
 * "overdue" branch stays pure/testable. Returns a new array.
 */
export function applyFileFilters(
  rows: FileSearchRow[],
  c: FileFilterCriteria,
  now: Date,
): FileSearchRow[] {
  return rows.filter((r) => {
    if (c.status && r.status !== c.status) return false;
    if (c.type && r.type !== c.type) return false;
    if (c.priority && r.priority !== c.priority) return false;
    if (c.clientId && r.clientId !== c.clientId) return false;
    if (c.transportMode && r.transportMode !== c.transportMode) return false;
    if (c.mine && (!c.currentUserId || r.accountManagerId !== c.currentUserId)) return false;
    if (c.overdue && !isOverdue(r, now)) return false;
    if (!matchesSearch(r, c.search)) return false;
    return true;
  });
}

/** Sort a copy of `rows` by the requested key (default: newest first). */
export function sortFiles(rows: FileSearchRow[], sort: FileSortKey | undefined): FileSearchRow[] {
  const s = [...rows];
  switch (sort) {
    case "oldest":
      return s.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case "number":
      return s.sort((a, b) => a.fileNumber.localeCompare(b.fileNumber));
    case "client":
      return s.sort((a, b) => (a.clientName ?? "").localeCompare(b.clientName ?? ""));
    case "priority":
      return s.sort(
        (a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9),
      );
    case "status":
      return s.sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
    case "newest":
    default:
      return s.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export const FILE_SORT_KEYS: FileSortKey[] = [
  "newest",
  "oldest",
  "number",
  "client",
  "priority",
  "status",
];
