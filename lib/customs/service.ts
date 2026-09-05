/**
 * Customs reads (Phase 1.9). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Service-role admin client gated by assertPermission('customs:read') + dossier
 * visibility (isFileVisible / resolveFileScope). The customs_record RLS policy
 * (tenant + customs:read + can_read_file + not deleted) is the CI-tested
 * boundary. Soft-deleted rows excluded.
 */
import { isVerified } from "@/lib/documents/doctrine";
import "server-only";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { isFileVisible, resolveFileScope } from "@/lib/authz/visibility";
import { requiredCustomsDocCodes } from "./gates";
import type {
  CustomsQueueItem,
  CustomsRecord,
  CustomsStatus,
  InspectionStatus,
  MissingCustomsDoc,
} from "./types";

type RecordRow = {
  id: string;
  file_id: string;
  reviewed_at: string | null;
  reviewer: { email: string | null } | null;
  gainde_registered_at: string | null;
  attachment_completed_at: string | null;
  attachment_systems: string[] | null;
  attachment_recorder: { email: string | null } | null;
  gainde_registrar: { email: string | null } | null;
  provider_code: string | null;
  provider_synced_at: string | null;
  receivability_status: string | null;
  receivability_at: string | null;
  receivability_note: string | null;
  status: string;
  required: boolean;
  declaration_number: string | null;
  sh_position_count: number | null;
  declaration_type: string | null;
  dpi_regime: string | null;
  exemption_title_origin: string | null;
  tariff_classification_origin: string | null;
  customs_office: string | null;
  regime: string | null;
  declaration_date: string | null;
  bae_reference: string | null;
  bae_recorded_at: string | null;
  release_approval_status: string | null;
  release_approval_note: string | null;
  release_date: string | null;
  inspection_status: string;
  external_ref: string | null;
  notes: string | null;
};

function toRecord(r: RecordRow): CustomsRecord {
  return {
    id: r.id,
    fileId: r.file_id,
    status: r.status as CustomsStatus,
    required: r.required,
    declarationNumber: r.declaration_number,
    customsOffice: r.customs_office,
    regime: r.regime,
    declarationDate: r.declaration_date,
    baeReference: r.bae_reference,
    releaseDate: r.release_date,
    inspectionStatus: r.inspection_status as InspectionStatus,
    externalRef: r.external_ref,
    notes: r.notes,
    // D4 — governed elements; null = not yet captured, never a default.
    shPositionCount: r.sh_position_count ?? null,
    declarationType: r.declaration_type ?? null,
    dpiRegime: r.dpi_regime ?? null,
    exemptionTitleOrigin: r.exemption_title_origin ?? null,
    tariffClassificationOrigin: r.tariff_classification_origin ?? null,
    // MAYA-P0.7-A — QC N°3. Null means NOT YET ASSESSED, which is deliberately
    // distinct from every recorded outcome: an unassessed file is neither
    // receivable nor refused, and quality reporting must tell the three apart.
    // TRANSIT-CUSTODY-05 — recorded ≠ verified ≠ released; the workspace needs
    // all three to say which act is outstanding and whose it is.
    releaseApprovalStatus: r.release_approval_status ?? null,
    releaseApprovalNote: r.release_approval_note ?? null,
    baeRecordedAt: r.bae_recorded_at ?? null,
    receivabilityStatus: r.receivability_status ?? null,
    receivabilityAt: r.receivability_at ?? null,
    receivabilityNote: r.receivability_note ?? null,
    // MAYA-P0.7-D — PROVENANCE, not status. `provider_code` says WHO drives the
    // declaration ('manual' or 'GAINDE'); it is read so QC4 can state how a
    // customs reference was obtained instead of implying a live integration.
    providerCode: r.provider_code ?? "manual",
    providerSyncedAt: r.provider_synced_at ?? null,
    // MAYA-P0.8-A — the Chef de Transit validation. Null = not yet validated;
    // it is deliberately NOT a status, so it cannot be confused with the
    // customs lifecycle.
    reviewedAt: r.reviewed_at ?? null,
    reviewedByEmail: r.reviewer?.email ?? null,
    // MAYA-P1.1 — CEO step 8. Null = not registered; never a claim of provider
    // synchronisation, which `providerCode` alone reports.
    gaindeRegisteredAt: r.gainde_registered_at ?? null,
    attachmentCompletedAt: r.attachment_completed_at ?? null,
    attachmentCompletedByEmail: r.attachment_recorder?.email ?? null,
    attachmentSystems: r.attachment_systems ?? [],
    gaindeRegisteredByEmail: r.gainde_registrar?.email ?? null,
  };
}

const RECORD_COLS =
  "id, file_id, status, required, declaration_number, sh_position_count, declaration_type, dpi_regime, exemption_title_origin, tariff_classification_origin, customs_office, regime, declaration_date, bae_reference, bae_recorded_at, release_approval_status, release_approval_note, release_date, inspection_status, external_ref, notes, receivability_status, receivability_at, receivability_note, provider_code, provider_synced_at, reviewed_at, reviewer:reviewed_by(email), gainde_registered_at, gainde_registrar:gainde_registered_by(email), attachment_completed_at, attachment_systems, attachment_recorder:attachment_completed_by(email)";

/** The (single) customs record for a dossier, or null. */
export async function getCustomsRecord(fileId: string): Promise<CustomsRecord | null> {
  const user = await assertPermission("customs:read");
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return null;

  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("customs_record")
    .select(RECORD_COLS)
    .eq("tenant_id", user.tenantId)
    .eq("file_id", fileId)
    .is("deleted_at", null)
    .maybeSingle<RecordRow>();
  if (error) throw new Error(`[customs] read failed: ${error.message}`);
  return data ? toRecord(data) : null;
}

/** Visibility-scoped customs queue (optionally filtered by status). */
export async function getCustomsQueue(opts?: { status?: string }): Promise<CustomsQueueItem[]> {
  const user = await assertPermission("customs:read");
  const scope = await resolveFileScope(user.id, user.tenantId, "file:read:all");
  if (!scope.all && scope.ids.length === 0) return [];

  const supabase = getAdminSupabaseClient();
  let query = supabase
    .from("customs_record")
    .select(
      "id, file_id, status, declaration_number, customs_office, bae_reference, file:file_id(file_number, type, client:client_id(name))",
    )
    .eq("tenant_id", user.tenantId)
    .is("deleted_at", null);
  if (!scope.all) query = query.in("file_id", scope.ids);
  if (opts?.status) query = query.eq("status", opts.status);

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .returns<
      {
        id: string;
        file_id: string;
        status: string;
        declaration_number: string | null;
        customs_office: string | null;
        bae_reference: string | null;
        file: { file_number: string; type: string; client: { name: string } | null } | null;
      }[]
    >();
  if (error) throw new Error(`[customs] queue failed: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id,
    fileId: r.file_id,
    fileNumber: r.file?.file_number ?? null,
    fileType: r.file?.type ?? null,
    clientName: r.file?.client?.name ?? null,
    status: r.status as CustomsStatus,
    declarationNumber: r.declaration_number,
    customsOffice: r.customs_office,
    baeReference: r.bae_reference,
  }));
}

/**
 * Customs-prerequisite document types with no APPROVED instance on the dossier
 * (applies the BL/AWB-by-mode rule). Drives the DECLARED gate + the warning.
 */
export async function getMissingCustomsDocuments(fileId: string): Promise<MissingCustomsDoc[]> {
  const user = await assertPermission("customs:read");
  if (!(await isFileVisible(user.id, user.tenantId, fileId))) return [];

  const supabase = getAdminSupabaseClient();
  const [gating, shipment, docs] = await Promise.all([
    supabase.from("document_type").select("code, label_fr").eq("active", true).eq("gates_customs", true),
    supabase.from("shipment").select("transport_mode").eq("file_id", fileId).maybeSingle(),
    supabase
      .from("document")
      .select("type_code, status")
      .eq("tenant_id", user.tenantId)
      .eq("file_id", fileId)
      .is("deleted_at", null),
  ]);

  const gatingRows = gating.data ?? [];
  const mode = (shipment.data?.transport_mode as string | null) ?? null;
  const requiredCodes = new Set(
    requiredCustomsDocCodes(gatingRows.map((g) => g.code), mode),
  );
  const approved = new Set(
    // UAT-2A — canonical doctrine.
    (docs.data ?? []).filter((d) => isVerified(d.status as string)).map((d) => d.type_code),
  );

  return gatingRows
    .filter((g) => requiredCodes.has(g.code) && !approved.has(g.code))
    .map((g) => ({ code: g.code, label: g.label_fr }));
}
