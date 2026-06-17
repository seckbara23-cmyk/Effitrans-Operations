/**
 * Department workspace shared types (Phase 2.0). Client + server safe.
 * ---------------------------------------------------------------------------
 * Department workspaces are FILTERED VIEWS over existing records — no new
 * business tables. These types describe the queue rows the views render.
 */
import type { CustomsStatus } from "@/lib/customs/types";
import type { TransportStatus } from "@/lib/transport/types";
import type { InvoiceStatus } from "@/lib/finance/types";

/** One dossier row in the Documentation queue (derived from documents). */
export type DocDossierRow = {
  fileId: string;
  fileNumber: string | null;
  clientName: string | null;
  fileType: string;
  priority: string;
  pending: number;
  verified: number;
  missing: number;
};

export type { CustomsStatus, TransportStatus, InvoiceStatus };
