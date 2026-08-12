/**
 * Operational File search / filter / sort — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Phase 1.4. No DB, no I/O — the single source of truth for the dossier work
 * queue logic so it can be unit-tested in isolation. The service fetches the
 * tenant's rows (RLS/permission-scoped) and runs these over them. Search is
 * case-insensitive substring (ILIKE-style); no full-text search this phase.
 */
import type { FileSortKey, FileFilterCriteria } from "./types";
import { isActiveFileStatus, isFileStatus } from "./status";

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
  /**
   * MAYA-P0.6-C — the identifiers staff actually have in front of them.
   *
   * Every one of these is supplied by the reader, which decides what the
   * viewer is allowed to be matched against. That is deliberate: the
   * permission decision belongs to the query, not to this pure function.
   * `declarationNumber` is null for a viewer without `customs:read` because
   * it was NEVER READ — not because it is filtered out here.
   */
  legacyReference: string | null;
  clientReference: string | null;
  vesselOrFlight: string | null;
  /** Container numbers from the child table, already batched by the reader. */
  containerNumbers: string[];
  /** Customs-sensitive: present only for a `customs:read` viewer. */
  declarationNumber: string | null;
  /** The derived MAYA-compatible name; null when it cannot be derived in full. */
  mayaLabel: string | null;
};

/**
 * The fields the search box matches against (substring, case-insensitive).
 *
 * MAYA-P0.6-C widened this from six to the identifiers staff actually quote.
 * Two properties hold:
 *
 *   * every value is TREATED AS OPAQUE TEXT. The MAYA legacy reference in
 *     particular is matched as a string and never parsed, split or normalised
 *     to infer a type, year or sequence — Q125 proved several incompatible
 *     shapes coexist, so any parsing rule would be wrong for some of them.
 *   * restricted values are absent rather than hidden. `declarationNumber` is
 *     null unless the reader was allowed to fetch it, so an ungated viewer
 *     cannot match one, and their result count is identical to what it was
 *     before this field existed.
 */
export function matchesSearch(row: FileSearchRow, rawTerm: string | undefined): boolean {
  const term = (rawTerm ?? "").trim().toLowerCase();
  if (!term) return true;
  const scalar = [
    row.fileNumber,
    row.clientName,
    row.origin,
    row.destination,
    row.blAwbRef,
    row.containerRef,
    row.legacyReference,
    row.clientReference,
    row.vesselOrFlight,
    row.declarationNumber,
    row.mayaLabel,
  ].some((v) => (v ?? "").toLowerCase().includes(term));
  if (scalar) return true;
  return row.containerNumbers.some((c) => c.toLowerCase().includes(term));
}

/** Active = not in a terminal state (DEC-B43 — delegates to THE canonical predicate). */
export function isActiveFile(status: string): boolean {
  return !isFileStatus(status) || isActiveFileStatus(status);
}

/** A file is "overdue" when its ETA has passed but it isn't delivered or terminal. */
export function isOverdue(row: FileSearchRow, now: Date): boolean {
  if (!row.eta) return false;
  if (row.status === "DELIVERED" || !isActiveFile(row.status)) return false;
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
