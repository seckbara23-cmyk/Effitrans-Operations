/**
 * Pure validation for operational-file inputs (Phase 1.2). No imports beyond
 * types — unit-testable.
 */
import type { FileInput, FileType, TransportMode } from "./types";

const FILE_TYPES: FileType[] = ["IMP", "EXP", "TRP", "HND"];
const MODES: TransportMode[] = ["SEA", "AIR", "ROAD", "MULTIMODAL"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns an error code, or null if valid. */
export function validateFile(input: FileInput): string | null {
  if (!input.type || !FILE_TYPES.includes(input.type)) return "invalid_type";
  if (!input.clientId || !UUID_RE.test(input.clientId)) return "client_required";

  const mode = input.shipment?.transportMode;
  if (mode && !MODES.includes(mode)) return "invalid_mode";

  return null;
}
