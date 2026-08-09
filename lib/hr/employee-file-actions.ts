"use server";

/**
 * HR-3 — Employee File actions. Gate hr:manage (verification maker-checker:
 * verifier <> preparer, DB CHECK + named pre-check). Ledger emission mandatory
 * with compensation (ADR-HR2-01). Files: private bucket only, sha-256 recorded,
 * soft delete only — no hard delete action exists in this module.
 */
import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { emitHrEvent } from "./ledger";
import { getHrConfiguration } from "./organization";

export type HrActionResult = { ok: true; id?: string; url?: string } | { ok: false; error: string };
const BUCKET = "hr-documents";

export async function uploadEmployeeDocument(formData: FormData): Promise<HrActionResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const employeeId = String(formData.get("employeeId") ?? "");
  const typeId = String(formData.get("documentTypeId") ?? "");
  const expiry = String(formData.get("expiryDate") ?? "").trim() || null;
  const file = formData.get("file") as File | null;
  if (!employeeId || !typeId || !file || file.size === 0) return { ok: false, error: "invalid_input" };
  if (file.size > 15 * 1024 * 1024) return { ok: false, error: "too_large" };

  const s = getAdminSupabaseClient();
  const { data: emp } = await s.from("employee").select("id").eq("id", employeeId).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!emp) return { ok: false, error: "not_found" };
  const { data: type } = await s.from("hr_document_type").select("id").eq("id", typeId).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!type) return { ok: false, error: "invalid_type" };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha = createHash("sha256").update(bytes).digest("hex");
  const path = `${admin.tenantId}/${employeeId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
  const { error: upErr } = await s.storage.from(BUCKET).upload(path, bytes, { contentType: file.type || "application/octet-stream" });
  if (upErr) return { ok: false, error: "upload_failed" };

  const { data: row, error: insErr } = await s.from("hr_document").insert({
    tenant_id: admin.tenantId, employee_id: employeeId, document_type_id: typeId,
    title: file.name, storage_path: path, mime_type: file.type || null,
    size_bytes: file.size, content_sha256: sha, expiry_date: expiry, uploaded_by: admin.id,
  }).select("id").single();
  if (insErr || !row) { await s.storage.from(BUCKET).remove([path]); return { ok: false, error: "save_failed" }; }

  const emitted = await emitHrEvent({ tenantId: admin.tenantId, employeeId, kind: "document_added", actorId: admin.id,
    payload: { document_type_id: typeId, expiry_date: expiry } });
  if (!emitted) { // compensate fully
    await s.from("hr_document").delete().eq("id", row.id).eq("tenant_id", admin.tenantId);
    await s.storage.from(BUCKET).remove([path]);
    return { ok: false, error: "event_failed" };
  }
  await writeAudit({ action: "hr.document.added", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_document", entityId: row.id, after: { employee_id: employeeId, type_id: typeId, sha256: sha } });
  revalidatePath(`/departments/hr/${employeeId}`);
  return { ok: true, id: row.id };
}

/** Short-TTL signed URL, server-minted; the bucket has no public access. */
export async function getEmployeeDocumentUrl(documentId: string): Promise<HrActionResult> {
  let admin;
  try { admin = await assertPermission("hr:read"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data: doc } = await s.from("hr_document").select("id, storage_path, document_type_id")
    .eq("id", documentId).eq("tenant_id", admin.tenantId).is("deleted_at", null).maybeSingle();
  if (!doc) return { ok: false, error: "not_found" };
  // HR-A1 (guard finding): tenant-scoped, and FAIL CLOSED. The type id is a
  // NOT NULL FK from the tenant-verified document row, so a missing result
  // here can only mean a cross-tenant reference — refuse rather than treat
  // the document as non-C3 and mint the URL anyway.
  const { data: type } = await s.from("hr_document_type").select("data_class")
    .eq("id", doc.document_type_id).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!type) return { ok: false, error: "not_found" };
  if (type.data_class === "C3") {
    try { await assertPermission("hr:sensitive:read"); } catch { return { ok: false, error: "forbidden" }; }
  }
  const { data, error } = await s.storage.from(BUCKET).createSignedUrl(doc.storage_path, 60);
  if (error || !data) return { ok: false, error: "url_failed" };
  await writeAudit({ action: "hr.document.accessed", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_document", entityId: doc.id });
  return { ok: true, url: data.signedUrl };
}

/** Soft delete — the row and the bytes remain; only visibility ends. */
export async function deleteEmployeeDocument(documentId: string): Promise<HrActionResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data: doc } = await s.from("hr_document").select("id, employee_id")
    .eq("id", documentId).eq("tenant_id", admin.tenantId).is("deleted_at", null).maybeSingle();
  if (!doc) return { ok: false, error: "not_found" };
  const { error } = await s.from("hr_document").update({ deleted_at: new Date().toISOString() })
    .eq("id", documentId).eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: "save_failed" };
  await writeAudit({ action: "hr.document.deleted", actorId: admin.id, tenantId: admin.tenantId,
    entity: "hr_document", entityId: documentId });
  revalidatePath(`/departments/hr/${doc.employee_id}`);
  return { ok: true, id: documentId };
}

export async function createEmployeeContract(input: {
  employeeId: string; contractKind: string; startDate: string;
  endDate?: string | null; probationEnd?: string | null; documentId?: string | null;
}): Promise<HrActionResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return { ok: false, error: "invalid_date" };
  const s = getAdminSupabaseClient();
  const { data: emp } = await s.from("employee").select("id").eq("id", input.employeeId).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!emp) return { ok: false, error: "not_found" };
  // Kind must come from the configuration vocabulary (HRQ-ID1 seed).
  const cfg = await getHrConfiguration(admin.tenantId);
  const kinds = (cfg?.employment_kinds as string[] | null) ?? ["EMPLOYEE"];
  const kind = input.contractKind.trim().toUpperCase();
  if (!kinds.map((k) => k.toUpperCase()).includes(kind) && !["CDI", "CDD", "STAGE"].includes(kind)) {
    return { ok: false, error: "invalid_kind" };
  }
  const { data: row, error } = await s.from("employment_contract").insert({
    tenant_id: admin.tenantId, employee_id: input.employeeId, contract_kind: kind,
    start_date: input.startDate, end_date: input.endDate || null,
    probation_end: input.probationEnd || null, document_id: input.documentId || null,
    prepared_by: admin.id,
  }).select("id").single();
  if (error || !row) return { ok: false, error: "save_failed" };

  const emitted = await emitHrEvent({ tenantId: admin.tenantId, employeeId: input.employeeId,
    kind: "contract_added", actorId: admin.id,
    payload: { contract_kind: kind, start_date: input.startDate, end_date: input.endDate ?? null } });
  if (!emitted) {
    await s.from("employment_contract").delete().eq("id", row.id).eq("tenant_id", admin.tenantId);
    return { ok: false, error: "event_failed" };
  }
  await writeAudit({ action: "hr.contract.added", actorId: admin.id, tenantId: admin.tenantId,
    entity: "employment_contract", entityId: row.id, after: { employee_id: input.employeeId, kind } });
  revalidatePath(`/departments/hr/${input.employeeId}`);
  return { ok: true, id: row.id };
}

/** Maker-checker: the verifier must differ from the preparer (DB CHECK backs this). */
export async function verifyEmployeeContract(contractId: string): Promise<HrActionResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data: c } = await s.from("employment_contract").select("id, employee_id, status, prepared_by")
    .eq("id", contractId).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!c) return { ok: false, error: "not_found" };
  if (c.status !== "DRAFT") return { ok: false, error: "wrong_status" };
  if (c.prepared_by === admin.id) return { ok: false, error: "same_actor" };
  const { error } = await s.from("employment_contract")
    .update({ status: "VERIFIED", verified_by: admin.id, verified_at: new Date().toISOString() })
    .eq("id", contractId).eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: error.message.includes("contract_verifier_differs") ? "same_actor" : "save_failed" };

  const emitted = await emitHrEvent({ tenantId: admin.tenantId, employeeId: c.employee_id,
    kind: "contract_verified", actorId: admin.id, payload: { contract_id: contractId } });
  if (!emitted) {
    await s.from("employment_contract").update({ status: "DRAFT", verified_by: null, verified_at: null })
      .eq("id", contractId).eq("tenant_id", admin.tenantId);
    return { ok: false, error: "event_failed" };
  }
  await writeAudit({ action: "hr.contract.verified", actorId: admin.id, tenantId: admin.tenantId,
    entity: "employment_contract", entityId: contractId });
  revalidatePath(`/departments/hr/${c.employee_id}`);
  return { ok: true, id: contractId };
}

export async function endEmployeeContract(contractId: string): Promise<HrActionResult> {
  let admin;
  try { admin = await assertPermission("hr:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const s = getAdminSupabaseClient();
  const { data: c } = await s.from("employment_contract").select("id, employee_id, status")
    .eq("id", contractId).eq("tenant_id", admin.tenantId).maybeSingle();
  if (!c) return { ok: false, error: "not_found" };
  if (c.status === "ENDED") return { ok: true, id: contractId };
  const { error } = await s.from("employment_contract")
    .update({ status: "ENDED", ended_at: new Date().toISOString() })
    .eq("id", contractId).eq("tenant_id", admin.tenantId);
  if (error) return { ok: false, error: "save_failed" };
  const emitted = await emitHrEvent({ tenantId: admin.tenantId, employeeId: c.employee_id,
    kind: "contract_ended", actorId: admin.id, payload: { contract_id: contractId } });
  if (!emitted) {
    await s.from("employment_contract").update({ status: c.status, ended_at: null })
      .eq("id", contractId).eq("tenant_id", admin.tenantId);
    return { ok: false, error: "event_failed" };
  }
  await writeAudit({ action: "hr.contract.ended", actorId: admin.id, tenantId: admin.tenantId,
    entity: "employment_contract", entityId: contractId });
  revalidatePath(`/departments/hr/${c.employee_id}`);
  return { ok: true, id: contractId };
}
