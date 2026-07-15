"use server";

/**
 * Brand Center mutations (DBC-1). SERVER ACTIONS.
 * ---------------------------------------------------------------------------
 * Every action: (1) gates on an EXISTING permission, (2) scopes to the caller's tenant
 * (admin.tenantId — never client input), (3) validates via the pure model, (4) writes via
 * the service-role client, (5) audits SAFE metadata only. Closed result vocabularies;
 * never a raw Supabase/Storage/parser error.
 *
 * Assets: an upload constructs the path SERVER-SIDE, verifies the real PNG bytes, and — if
 * a published asset of the same kind exists — creates a NEW immutable version and RETIRES
 * the prior one (never overwrites its object, so already-sent signatures keep working).
 */
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPermission } from "@/lib/auth/require-permission";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import { reportError } from "@/lib/observability/report";
import {
  isValidHexColor,
} from "@/lib/branding/validate";
import {
  isAllowedFont, isHttpsUrl, isAssetKind, isSignatureVariant, normalizePhone, validateBrandText,
  type AssetKind,
} from "@/lib/brand/model";
import { buildAssetPath, isPngSignature, validateAssetUpload } from "@/lib/brand/assets";
import type { Database } from "@/lib/db/types";

type Tbl = Database["public"]["Tables"];
const PUBLIC_BUCKET = "brand-assets";
const REVAL = "/brand-center";

export type BrandResult = { ok: true } | { ok: false; error: string };
export type UploadResult = { ok: true; assetId: string } | { ok: false; error: string };

// ------------------------------------------------------------- profile ----

const COLOR_FIELDS = ["color_green", "color_gold", "color_anthracite"] as const;
const FONT_FIELDS = ["font_heading", "font_body", "font_email_fallback"] as const;
const HTTPS_FIELDS = ["website_url", "linkedin_url", "whistleblower_url"] as const;
const TEXT_FIELDS = [
  "slogan", "value_proposition", "address", "legal_identifiers",
  "compliance_title", "compliance_subtitle", "compliance_description", "compliance_button_label",
  "sustainability_statement", "environmental_print_statement", "footer_line",
] as const;

export type BrandProfileInput = Partial<Record<
  (typeof COLOR_FIELDS)[number] | (typeof FONT_FIELDS)[number] | (typeof HTTPS_FIELDS)[number] | (typeof TEXT_FIELDS)[number],
  string
>>;

export async function updateBrandProfile(input: BrandProfileInput): Promise<BrandResult> {
  let admin;
  try {
    admin = await assertPermission("admin:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }

  const row: Record<string, string | null> = {};
  for (const f of COLOR_FIELDS) {
    if (input[f] === undefined) continue;
    const v = input[f]!.trim();
    if (v === "") { row[f] = null; continue; }
    if (!isValidHexColor(v)) return { ok: false, error: "invalid_color" };
    row[f] = v;
  }
  for (const f of FONT_FIELDS) {
    if (input[f] === undefined) continue;
    const v = input[f]!.trim();
    if (v === "") { row[f] = null; continue; }
    if (!isAllowedFont(v)) return { ok: false, error: "invalid_font" };
    row[f] = v;
  }
  for (const f of HTTPS_FIELDS) {
    if (input[f] === undefined) continue;
    const v = input[f]!.trim();
    if (v === "") { row[f] = null; continue; }
    if (!isHttpsUrl(v)) return { ok: false, error: "invalid_https_url" };
    row[f] = v;
  }
  for (const f of TEXT_FIELDS) {
    if (input[f] === undefined) continue;
    const r = validateBrandText(input[f]);
    if (r === "ERR") return { ok: false, error: "invalid_text" };
    row[f] = r;
  }

  const supabase = getAdminSupabaseClient();
  const { error } = await supabase
    .from("tenant_brand_profile")
    .upsert({ tenant_id: admin.tenantId, ...row, updated_by: admin.id }, { onConflict: "tenant_id" });
  if (error) { reportError(error, { scope: "action", event: "brand.profile" }); return { ok: false, error: "write_failed" }; }

  await writeAudit({
    action: AuditActions.BRAND_PROFILE_UPDATED,
    actorId: admin.id, tenantId: admin.tenantId, entity: "tenant_brand_profile", entityId: admin.tenantId,
    // Changed field NAMES only — never the values (esp. the whistleblower URL).
    after: { changedFields: Object.keys(row) },
  });
  revalidatePath(REVAL);
  return { ok: true };
}

// ------------------------------------------------------------- assets ----

export async function uploadBrandAsset(form: { kind: string; altText: string; title?: string; file: File }): Promise<UploadResult> {
  let admin;
  try {
    admin = await assertPermission("admin:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  if (!isAssetKind(form.kind)) return { ok: false, error: "invalid_kind" };
  const kind = form.kind as AssetKind;

  const buf = new Uint8Array(await form.file.arrayBuffer());
  const check = validateAssetUpload({
    kind, mime: form.file.type, filename: form.file.name, byteLength: buf.byteLength,
    signatureOk: isPngSignature(buf), altText: form.altText,
  });
  if (!check.ok) return { ok: false, error: check.error };

  const supabase = getAdminSupabaseClient();

  // The prior active version of this kind (to version + retire, never overwrite).
  const { data: prior } = await supabase
    .from("brand_asset")
    .select("id, version")
    .eq("tenant_id", admin.tenantId).eq("kind", kind).eq("status", "PUBLISHED")
    .order("version", { ascending: false }).limit(1).maybeSingle();
  const version = (prior?.version ?? 0) + 1;

  // Insert the registry row first to get the id, then upload to a server-built path.
  const { data: inserted, error: insErr } = await supabase
    .from("brand_asset")
    .insert({
      tenant_id: admin.tenantId, kind, title: form.title?.trim() || null, storage_path: "pending",
      version, mime: "image/png", bytes: buf.byteLength, alt_text: form.altText.trim(),
      status: "PUBLISHED", uploaded_by: admin.id,
    })
    .select("id").single();
  if (insErr || !inserted) { reportError(insErr, { scope: "action", event: "brand.asset.insert" }); return { ok: false, error: "write_failed" }; }

  const path = buildAssetPath({ tenantId: admin.tenantId, kind, assetId: inserted.id, version, filename: form.file.name });
  const up = await supabase.storage.from(PUBLIC_BUCKET).upload(path, buf, { contentType: "image/png", upsert: false });
  if (up.error) {
    // Compensate: remove the orphan registry row this call created.
    await supabase.from("brand_asset").delete().eq("id", inserted.id).eq("tenant_id", admin.tenantId);
    reportError(up.error, { scope: "action", event: "brand.asset.upload" });
    return { ok: false, error: "storage_failed" };
  }
  await supabase.from("brand_asset").update({ storage_path: path }).eq("id", inserted.id).eq("tenant_id", admin.tenantId);

  const replacing = Boolean(prior);
  if (prior) {
    await supabase.from("brand_asset").update({ status: "RETIRED", retired_at: new Date().toISOString() })
      .eq("id", prior.id).eq("tenant_id", admin.tenantId);
  }

  await writeAudit({
    action: replacing ? AuditActions.BRAND_ASSET_REPLACED : AuditActions.BRAND_ASSET_UPLOADED,
    actorId: admin.id, tenantId: admin.tenantId, entity: "brand_asset", entityId: inserted.id,
    after: { kind, version, bytes: buf.byteLength, mime: "image/png" }, // safe metadata; never the bytes
  });
  revalidatePath(REVAL);
  return { ok: true, assetId: inserted.id };
}

export async function retireBrandAsset(assetId: string): Promise<BrandResult> {
  let admin;
  try {
    admin = await assertPermission("admin:config:manage");
  } catch {
    return { ok: false, error: "forbidden" };
  }
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase
    .from("brand_asset").update({ status: "RETIRED", retired_at: new Date().toISOString() })
    .eq("id", assetId).eq("tenant_id", admin.tenantId).select("id, kind").maybeSingle();
  if (error) return { ok: false, error: "write_failed" };
  if (!data) return { ok: false, error: "not_found" };
  await writeAudit({ action: AuditActions.BRAND_ASSET_RETIRED, actorId: admin.id, tenantId: admin.tenantId, entity: "brand_asset", entityId: assetId, after: { kind: data.kind } });
  revalidatePath(REVAL);
  return { ok: true };
}

// ------------------------------------------------------------- memberships ----

export type MembershipInput = {
  organizationName: string; membershipId?: string; officialUrl?: string;
  status?: string; validFrom?: string | null; expiresAt?: string | null;
  displayOrder?: number; logoAssetId?: string | null; assetUseNotes?: string;
};

async function validateMembership(input: MembershipInput): Promise<Record<string, unknown> | { error: string }> {
  const name = validateBrandText(input.organizationName);
  if (name === "ERR" || name === null) return { error: "invalid_name" };
  const row: Record<string, unknown> = { organization_name: name };
  if (input.membershipId !== undefined) {
    const m = validateBrandText(input.membershipId);
    if (m === "ERR") return { error: "invalid_text" };
    row.membership_id = m;
  }
  if (input.officialUrl) { if (!isHttpsUrl(input.officialUrl)) return { error: "invalid_https_url" }; row.official_url = input.officialUrl.trim(); }
  if (input.status !== undefined) { if (input.status !== "active" && input.status !== "inactive") return { error: "invalid_status" }; row.status = input.status; }
  if (input.validFrom !== undefined) row.valid_from = input.validFrom || null;
  if (input.expiresAt !== undefined) row.expires_at = input.expiresAt || null;
  if (input.displayOrder !== undefined) row.display_order = Number.isFinite(input.displayOrder) ? input.displayOrder : 0;
  if (input.assetUseNotes !== undefined) { const n = validateBrandText(input.assetUseNotes); if (n === "ERR") return { error: "invalid_text" }; row.asset_use_notes = n; }
  return row;
}

export async function createMembership(input: MembershipInput): Promise<BrandResult> {
  let admin;
  try { admin = await assertPermission("admin:config:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const v = await validateMembership(input);
  if ("error" in v) return { ok: false, error: v.error as string };
  const supabase = getAdminSupabaseClient();

  // A linked logo asset MUST belong to the same tenant (cross-tenant reference guard).
  if (input.logoAssetId) {
    const { data: asset } = await supabase.from("brand_asset").select("id").eq("id", input.logoAssetId).eq("tenant_id", admin.tenantId).maybeSingle();
    if (!asset) return { ok: false, error: "invalid_asset" };
    v.logo_asset_id = input.logoAssetId;
  }

  const { data, error } = await supabase.from("tenant_membership_registry").insert({ tenant_id: admin.tenantId, updated_by: admin.id, ...v } as Tbl["tenant_membership_registry"]["Insert"]).select("id").single();
  if (error || !data) return { ok: false, error: "write_failed" };
  await writeAudit({ action: AuditActions.BRAND_MEMBERSHIP_CREATED, actorId: admin.id, tenantId: admin.tenantId, entity: "tenant_membership_registry", entityId: data.id, after: { organizationName: v.organization_name } });
  revalidatePath(REVAL);
  return { ok: true };
}

export async function updateMembership(id: string, input: MembershipInput): Promise<BrandResult> {
  let admin;
  try { admin = await assertPermission("admin:config:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const v = await validateMembership(input);
  if ("error" in v) return { ok: false, error: v.error as string };
  const supabase = getAdminSupabaseClient();
  if (input.logoAssetId) {
    const { data: asset } = await supabase.from("brand_asset").select("id").eq("id", input.logoAssetId).eq("tenant_id", admin.tenantId).maybeSingle();
    if (!asset) return { ok: false, error: "invalid_asset" };
    v.logo_asset_id = input.logoAssetId;
  }
  const { data, error } = await supabase.from("tenant_membership_registry").update({ ...v, updated_by: admin.id } as Tbl["tenant_membership_registry"]["Update"]).eq("id", id).eq("tenant_id", admin.tenantId).select("id").maybeSingle();
  if (error) return { ok: false, error: "write_failed" };
  if (!data) return { ok: false, error: "not_found" };
  await writeAudit({ action: AuditActions.BRAND_MEMBERSHIP_UPDATED, actorId: admin.id, tenantId: admin.tenantId, entity: "tenant_membership_registry", entityId: id, after: { changedFields: Object.keys(v) } });
  revalidatePath(REVAL);
  return { ok: true };
}

export async function retireMembership(id: string): Promise<BrandResult> {
  let admin;
  try { admin = await assertPermission("admin:config:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const supabase = getAdminSupabaseClient();
  const { data, error } = await supabase.from("tenant_membership_registry").update({ status: "inactive", updated_by: admin.id }).eq("id", id).eq("tenant_id", admin.tenantId).select("id").maybeSingle();
  if (error) return { ok: false, error: "write_failed" };
  if (!data) return { ok: false, error: "not_found" };
  await writeAudit({ action: AuditActions.BRAND_MEMBERSHIP_RETIRED, actorId: admin.id, tenantId: admin.tenantId, entity: "tenant_membership_registry", entityId: id, after: { status: "inactive" } });
  revalidatePath(REVAL);
  return { ok: true };
}

// ------------------------------------------------------------- workforce ----

export type WorkforceInput = {
  jobTitle?: string; phoneOffice?: string; phoneMobile?: string; whatsapp?: string;
  signatureVariant?: string; publicCardEnabled?: boolean;
};

export async function updateWorkforceProfile(userId: string, input: WorkforceInput): Promise<BrandResult> {
  let admin;
  try { admin = await assertPermission("admin:users:manage"); } catch { return { ok: false, error: "forbidden" }; }
  const supabase = getAdminSupabaseClient();

  // The target must be an active user of THIS tenant (no cross-tenant reference).
  const { data: target } = await supabase.from("app_user").select("id, tenant_id").eq("id", userId).maybeSingle();
  if (!target || target.tenant_id !== admin.tenantId) return { ok: false, error: "not_found" };

  const row: Record<string, unknown> = { user_id: userId, tenant_id: admin.tenantId, updated_by: admin.id };
  if (input.jobTitle !== undefined) { const t = validateBrandText(input.jobTitle); if (t === "ERR") return { ok: false, error: "invalid_text" }; row.job_title = t; }
  for (const [key, col] of [["phoneOffice", "phone_office"], ["phoneMobile", "phone_mobile"], ["whatsapp", "whatsapp"]] as const) {
    if (input[key] !== undefined) {
      const n = normalizePhone(input[key]);
      if (!n.ok) return { ok: false, error: "invalid_phone" };
      row[col] = n.value;
    }
  }
  if (input.signatureVariant !== undefined) { if (!isSignatureVariant(input.signatureVariant)) return { ok: false, error: "invalid_variant" }; row.signature_variant = input.signatureVariant; }
  if (input.publicCardEnabled !== undefined) {
    row.public_card_enabled = input.publicCardEnabled;
    if (input.publicCardEnabled) {
      // Unguessable, NOT derived from the user id; rotated on each enable. (No public
      // route exists until DBC-3.) The token is NEVER logged or audited.
      row.public_card_token = randomBytes(24).toString("base64url");
      row.token_rotated_at = new Date().toISOString();
    }
  }

  const { error } = await supabase.from("workforce_profile").upsert(row as Tbl["workforce_profile"]["Insert"], { onConflict: "user_id" });
  if (error) { reportError(error, { scope: "action", event: "brand.workforce" }); return { ok: false, error: "write_failed" }; }

  await writeAudit({
    action: AuditActions.BRAND_WORKFORCE_PROFILE_UPDATED,
    actorId: admin.id, tenantId: admin.tenantId, entity: "workforce_profile", entityId: userId,
    // Field NAMES only — never phone values or the card token.
    after: { changedFields: Object.keys(row).filter((k) => !["user_id", "tenant_id", "updated_by", "public_card_token", "token_rotated_at"].includes(k)) },
  });
  revalidatePath(REVAL);
  return { ok: true };
}
