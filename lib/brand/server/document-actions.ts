"use server";

/**
 * Corporate document generation (DBC-4). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * The single entry point for every branded document. Gated by admin:config:manage (reused),
 * tenant-scoped. Resolves branding ONCE from the Brand Center (readBrandCore) and, if
 * configured, the employee signature block (from the authoritative identity — never
 * duplicated), builds the shared model, and renders to PDF (reused engine) or DOCX (OOXML).
 * Refuses when brand completeness is insufficient. Audits SAFE metadata only — never the
 * body, customer data, prices, line items, or the generated file.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { readBrandCore } from "./service";
import { buildDocumentModel, documentReadiness, isDocumentType, type DocumentInput, type DocSignature } from "@/lib/brand/document/model";
import { renderDocumentPdf } from "@/lib/brand/document/pdf";
import { renderDocumentDocx } from "@/lib/brand/document/docx";

export type DocFormat = "pdf" | "docx";
export type DocGenResult =
  | { ok: true; ready: true; base64: string; filename: string; mime: string }
  | { ok: true; ready: false; missing: string[] }
  | { ok: false; error: "forbidden" | "invalid" };

function safe(part: string): string {
  return (part.replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").slice(0, 40) || "document");
}

async function resolveSignature(supabase: ReturnType<typeof getAdminSupabaseClient>, tenantId: string, userId: string): Promise<DocSignature> {
  const { data: u } = await supabase.from("app_user").select("id, tenant_id, name, email").eq("id", userId).maybeSingle();
  if (!u || u.tenant_id !== tenantId) return null;
  const { data: w } = await supabase.from("workforce_profile").select("job_title, phone_office, phone_mobile").eq("user_id", userId).maybeSingle();
  return { name: u.name ?? u.email, title: w?.job_title ?? null, email: u.email, phone: w?.phone_mobile ?? w?.phone_office ?? null };
}

export async function generateCorporateDocument(args: {
  input: DocumentInput;
  format: DocFormat;
  intent: "preview" | "generate";
  signatureUserId?: string | null;
  complianceEnabled?: boolean;
}): Promise<DocGenResult> {
  let admin;
  try { admin = await assertPermission("admin:config:manage"); } catch { return { ok: false, error: "forbidden" }; }

  const { input } = args;
  if (!isDocumentType(input.type) || !input.title?.trim() || !input.date?.trim()) return { ok: false, error: "invalid" };

  const supabase = getAdminSupabaseClient();
  const core = await readBrandCore(admin.tenantId);
  const readiness = documentReadiness(core.profile);
  if (!readiness.ready) return { ok: true, ready: false, missing: readiness.missing };

  const signature = args.signatureUserId ? await resolveSignature(supabase, admin.tenantId, args.signatureUserId) : null;

  const model = buildDocumentModel({
    doc: input,
    companyName: core.displayName,
    profile: core.profile,
    memberships: core.memberships,
    signature,
    complianceEnabled: args.complianceEnabled ?? true,
  });

  const bytes = args.format === "pdf" ? renderDocumentPdf(model) : renderDocumentDocx(model);
  const mime = args.format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const filename = `${safe(input.type.toLowerCase())}-${safe(input.number || input.date)}.${args.format}`;

  await writeAudit({
    action: args.intent === "generate" ? AuditActions.BRAND_DOCUMENT_GENERATED : AuditActions.BRAND_DOCUMENT_PREVIEWED,
    actorId: admin.id, tenantId: admin.tenantId, entity: "brand_document", entityId: input.type,
    // safe metadata; never the document content, prices, or line items
    after: { type: input.type, format: args.format },
  });

  return { ok: true, ready: true, base64: Buffer.from(bytes).toString("base64"), filename, mime };
}

/** Record a download of an already-generated document. Audit only. */
export async function recordDocumentDownload(type: string, format: DocFormat): Promise<{ ok: boolean }> {
  let admin;
  try { admin = await assertPermission("admin:config:manage"); } catch { return { ok: false }; }
  await writeAudit({
    action: AuditActions.BRAND_DOCUMENT_DOWNLOADED,
    actorId: admin.id, tenantId: admin.tenantId, entity: "brand_document", entityId: type,
    after: { type, format },
  });
  return { ok: true };
}
