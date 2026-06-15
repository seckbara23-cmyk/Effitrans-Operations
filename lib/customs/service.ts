/**
 * Customs reads (Phase 1.9). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Service-role admin client gated by assertPermission('customs:read') + dossier
 * visibility (isFileVisible / resolveFileScope). The customs_record RLS policy
 * (tenant + customs:read + can_read_file + not deleted) is the CI-tested
 * boundary. Soft-deleted rows excluded.
 */
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
  status: string;
  required: boolean;
  declaration_number: string | null;
  customs_office: string | null;
  regime: string | null;
  declaration_date: string | null;
  bae_reference: string | null;
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
  };
}

const RECORD_COLS =
  "id, file_id, status, required, declaration_number, customs_office, regime, declaration_date, bae_reference, release_date, inspection_status, external_ref, notes";

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
    (docs.data ?? []).filter((d) => d.status === "APPROVED").map((d) => d.type_code),
  );

  return gatingRows
    .filter((g) => requiredCodes.has(g.code) && !approved.has(g.code))
    .map((g) => ({ code: g.code, label: g.label_fr }));
}
