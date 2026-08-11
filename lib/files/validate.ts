/**
 * Pure validation for operational-file inputs (Phase 1.2). No imports beyond
 * types — unit-testable.
 */
import type { FileInput, FileType, TransportMode } from "./types";
import { isCargoForm } from "./taxonomy";

const FILE_TYPES: FileType[] = ["IMP", "EXP", "TRP", "HND"];
const MODES: TransportMode[] = ["SEA", "AIR", "ROAD", "MULTIMODAL"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A quantity is optional; when given it must be a non-negative finite number. */
function invalidAmount(v: number | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  return !Number.isFinite(v) || v < 0;
}

/** Returns an error code, or null if valid. */
export function validateFile(input: FileInput): string | null {
  if (!input.type || !FILE_TYPES.includes(input.type)) return "invalid_type";
  if (!input.clientId || !UUID_RE.test(input.clientId)) return "client_required";

  const mode = input.shipment?.transportMode;
  if (mode && !MODES.includes(mode)) return "invalid_mode";

  // MAYA-P0.5-B — dossier facts. Every one is OPTIONAL: absence is always
  // valid, and none of these can block a dossier from being created.
  const s = input.shipment;
  if (s?.cargoForm && !isCargoForm(s.cargoForm)) return "invalid_cargo_form";
  if (
    invalidAmount(s?.quantity) || invalidAmount(s?.netWeightKg) ||
    invalidAmount(s?.grossWeightKg) || invalidAmount(s?.volumeM3) ||
    invalidAmount(s?.packageCount)
  ) {
    return "invalid_cargo_amount";
  }
  if (s?.packageCount !== null && s?.packageCount !== undefined && !Number.isInteger(s.packageCount)) {
    return "invalid_cargo_amount";
  }
  if (s?.warehouseEntryDate && !DATE_RE.test(s.warehouseEntryDate)) return "invalid_date";
  if (input.processingDueDate && !DATE_RE.test(input.processingDueDate)) return "invalid_date";
  // A parent is a dossier id; the database proves tenant, self-parent and
  // cycle — this only rejects a malformed value before the round trip.
  if (input.parentFileId && !UUID_RE.test(input.parentFileId)) return "invalid_parent";

  return null;
}
