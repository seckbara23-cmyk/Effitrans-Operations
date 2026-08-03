"use server";
/**
 * EC-3D — conversion of an ACCEPTED quotation into an operational dossier.
 * SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * COMMERCIAL NEVER OWNS OPERATIONS. This module writes to **no** dossier table.
 * It calls `createFile()` — the Operations-owned contract in lib/files/actions —
 * which mints the number through `next_file_number()`, validates, audits and
 * revalidates exactly as it does for a dossier opened by hand. Then it calls
 * `quotation_record_conversion`, which RECORDS the link and emits the keystone
 * event. Neither step inserts into `operational_file` from here.
 *
 * WHO MAY DO THIS. Conversion needs two authorities that no single ROLE holds:
 *
 *   * `file:create` — because creating a dossier is an Operations act, and
 *     `createFile` enforces it. This is not re-implemented or bypassed.
 *   * `quotation:create` OR `quotation:validate` — because you cannot convert a
 *     quotation you are not allowed to read (DEC-C32).
 *
 * Permissions union across roles, so a person holding BOTH a commercial role and
 * an Operations role can convert with **no new permission and no new grant**.
 * That is a seat-assignment decision, recorded as an activation dependency —
 * deliberately NOT solved by granting Commercial an Operations authority, which
 * would make Commercial own Operations.
 *
 * AFTER CONVERSION the dossier belongs to Operations. It is created in DRAFT and
 * is opened by Operations' own `openDossierWorkflow`, which is where the process
 * instance, the owner assignment and the « Dossier reçu » customer milestone
 * live. This module deliberately does NOT call it: publishing `file_opened` from
 * here would duplicate a notification Operations already owns, and driving the
 * process would be Commercial modifying the Operations workflow.
 */
import "server-only";
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { createFile } from "@/lib/files/actions";
import type { FileType, Priority } from "@/lib/files/types";
import { assertCommercialRead } from "./service";
import { mapRpcError } from "./errors";

export type ConvertResult =
  | { ok: true; fileId: string; fileNumber?: string }
  | { ok: false; error: string; detail?: string };

export type ConvertInput = {
  quotationId: string;
  type: FileType;
  priority?: Priority | null;
};

export async function convertQuotationToDossier(input: ConvertInput): Promise<ConvertResult> {
  // Gate 1 — the OPERATIONS authority. Asserted here so the refusal is explicit
  // and French-mappable, and enforced a second time inside createFile.
  let user;
  try { user = await assertPermission("file:create"); }
  catch { return { ok: false, error: "forbidden_create_file" }; }

  // Gate 2 — the COMMERCIAL read. The admin client below bypasses RLS, so this
  // is what stops a dossier-creating seat from converting a quotation it may
  // not see, and it verifies the tenant is the caller's own.
  try { await assertCommercialRead(user.tenantId); }
  catch { return { ok: false, error: "forbidden_commercial_read" }; }

  const s = getAdminSupabaseClient();
  const { data: q } = await s.from("quotation")
    .select("id, client_id, status, quotation_number, converted_file_id")
    .eq("id", input.quotationId).eq("tenant_id", user.tenantId).maybeSingle();
  if (!q) return { ok: false, error: "not_found" };

  // The database refuses this too (QT616). Checked here so the user gets a
  // sentence instead of an error code, never INSTEAD of the database check.
  if (q.status !== "ACCEPTED") return { ok: false, error: "not_accepted" };
  if (q.converted_file_id) return { ok: false, error: "already_converted" };
  if (!q.client_id) return { ok: false, error: "no_client" };

  // ---- THE Operations contract. Not a copy of it. --------------------------
  const created = await createFile({
    type: input.type,
    clientId: q.client_id,
    priority: input.priority ?? null,
  });
  if (!created.ok) {
    return { ok: false, error: "dossier_creation_refused", detail: created.error };
  }
  if (!created.id) return { ok: false, error: "dossier_creation_refused" };

  // ---- Record the link + emit the keystone event ---------------------------
  // If this fails the dossier still exists and belongs to Operations; it is not
  // silently deleted. Commercial does not get to un-create an Operations row,
  // and the failure is reported so the link can be recorded deliberately.
  const { error } = await s.rpc("quotation_record_conversion", {
    p_tenant: user.tenantId, p_quotation: input.quotationId,
    p_actor: user.id, p_file: created.id,
  });
  if (error) {
    await writeAudit({
      action: "commercial.quotation.conversion_link_failed", actorId: user.id,
      tenantId: user.tenantId, entity: "quotation", entityId: input.quotationId,
      after: { file_id: created.id, error: error.message },
    });
    return { ok: false, error: "conversion_not_recorded", detail: mapRpcError(error).error };
  }

  await writeAudit({
    action: "commercial.quotation.converted", actorId: user.id, tenantId: user.tenantId,
    entity: "quotation", entityId: input.quotationId,
    after: { file_id: created.id, quotation_number: q.quotation_number },
  });

  revalidatePath("/commercial");
  revalidatePath(`/commercial/quotations/${input.quotationId}`);
  return { ok: true, fileId: created.id };
}
