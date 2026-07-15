"use server";

/**
 * Signature generation (DBC-2). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * The ONLY producer of production signature HTML/text. Gated by admin:users:manage (an
 * administrative capability — reused, no new permission), scoped to the caller's tenant.
 * Resolves the Brand Center core (readBrandCore) + the employee, checks readiness, and — if
 * ready — runs the deterministic PURE compiler. React never generates the artifact; it only
 * displays what this returns. Audits safe metadata only (never the HTML/text/URLs/phones).
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { readBrandCore } from "./service";
import { isSignatureVariant, type SignatureVariant } from "@/lib/brand/model";
import { buildSignatureModel, signatureReadiness, type SignatureEmployee } from "@/lib/brand/signature/model";
import { compileSignatureHtml, compileSignatureText } from "@/lib/brand/signature/compiler";
import { validateSignatureHtml } from "@/lib/brand/signature/validate";

export type SignatureResult =
  | { ok: true; ready: true; variant: SignatureVariant; html: string; text: string }
  | { ok: true; ready: false; missing: string[] }
  | { ok: false; error: "forbidden" | "not_found" | "compile_failed" };

async function loadEmployee(supabase: ReturnType<typeof getAdminSupabaseClient>, tenantId: string, userId: string): Promise<SignatureEmployee | null> {
  const { data: u } = await supabase.from("app_user").select("id, tenant_id, name, email").eq("id", userId).maybeSingle();
  if (!u || u.tenant_id !== tenantId) return null;
  const { data: w } = await supabase.from("workforce_profile").select("job_title, phone_office, phone_mobile, whatsapp, signature_variant").eq("user_id", userId).maybeSingle();
  const variant = w?.signature_variant && isSignatureVariant(w.signature_variant) ? (w.signature_variant as SignatureVariant) : "CORPORATE";
  return {
    name: u.name ?? u.email, email: u.email, title: w?.job_title ?? null, variant,
    phoneOffice: w?.phone_office ?? null, phoneMobile: w?.phone_mobile ?? null, whatsapp: w?.whatsapp ?? null,
  };
}

/** Compile (or refuse) an employee's signature. `intent` distinguishes preview from generate for audit. */
export async function compileEmployeeSignature(userId: string, intent: "preview" | "generate"): Promise<SignatureResult> {
  let admin;
  try { admin = await assertPermission("admin:users:manage"); } catch { return { ok: false, error: "forbidden" }; }

  const supabase = getAdminSupabaseClient();
  const employee = await loadEmployee(supabase, admin.tenantId, userId);
  if (!employee) return { ok: false, error: "not_found" };

  const core = await readBrandCore(admin.tenantId);
  const readiness = signatureReadiness(core.profile, core.assets, employee);
  if (!readiness.ready) return { ok: true, ready: false, missing: readiness.missing };

  const model = buildSignatureModel({ companyName: core.displayName, profile: core.profile, assets: core.assets, memberships: core.memberships, employee });
  const html = compileSignatureHtml(model);
  const text = compileSignatureText(model);

  // Defense: the compiler is trusted, but never emit HTML that fails the safety contract.
  if (!validateSignatureHtml(html).ok) return { ok: false, error: "compile_failed" };

  await writeAudit({
    action: intent === "generate" ? AuditActions.BRAND_SIGNATURE_GENERATED : AuditActions.BRAND_SIGNATURE_PREVIEWED,
    actorId: admin.id, tenantId: admin.tenantId, entity: "workforce_profile", entityId: userId,
    after: { variant: employee.variant }, // safe metadata; never the compiled output
  });

  return { ok: true, ready: true, variant: employee.variant, html, text };
}

/** Record a download/copy of an already-generated signature. Audit only — no output stored. */
export async function recordSignatureEvent(userId: string, event: "downloaded" | "copied", format: "html" | "text"): Promise<{ ok: boolean }> {
  let admin;
  try { admin = await assertPermission("admin:users:manage"); } catch { return { ok: false }; }
  const supabase = getAdminSupabaseClient();
  const { data: u } = await supabase.from("app_user").select("id, tenant_id").eq("id", userId).maybeSingle();
  if (!u || u.tenant_id !== admin.tenantId) return { ok: false };

  await writeAudit({
    action: event === "downloaded" ? AuditActions.BRAND_SIGNATURE_DOWNLOADED : AuditActions.BRAND_SIGNATURE_COPIED,
    actorId: admin.id, tenantId: admin.tenantId, entity: "workforce_profile", entityId: userId,
    after: { format }, // format only — never the content
  });
  return { ok: true };
}
