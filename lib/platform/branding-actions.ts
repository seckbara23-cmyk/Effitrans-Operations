"use server";

/**
 * Platform tenant-branding editor (Phase 6.0E-1). SERVER ACTIONS — platform admins only.
 * ---------------------------------------------------------------------------
 * The ONLY writer of the editable tenant_branding columns. Reuses the SAME table and
 * validators that resolveTenantBranding reads at render time (lib/branding), so the
 * platform preview and the tenant runtime consume one persisted source — there is no
 * platform-only branding representation.
 *
 *   - gated by platform:companies:update (the closest valid platform company-management
 *     permission; no dedicated branding permission exists). A tenant admin has no
 *     platform identity, so a tenant can never edit branding through this path;
 *   - the target tenant is validated server-side; tenantId is an argument, never a
 *     spoofable actor/tenant claim from the browser;
 *   - writes ONLY the editable columns (upsert leaves logo_url / portal_logo_url and any
 *     future columns untouched) — logo upload is deferred (no public storage bucket);
 *   - audits platform.branding.updated with the CHANGED FIELD NAMES only, never values
 *     (a footer or support line is tenant content, not for the platform audit log);
 *   - flips organization.branding_complete so the onboarding checklist reflects reality.
 *
 * The service role stays server-side; the client invokes this proxy and never sees it.
 */
import { revalidatePath } from "next/cache";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { assertPlatformPermission, PlatformAuthError } from "./auth";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";
import {
  EDITABLE_BRANDING_FIELDS,
  validateBrandingDraft,
  changedBrandingFields,
  type BrandingDraft,
  type EditableBrandingField,
  type BrandingFieldError,
} from "@/lib/branding/edit";
import type { TenantBrandingRow } from "@/lib/branding/types";

const BRANDING_SELECT = EDITABLE_BRANDING_FIELDS.join(", ");

export type BrandingUpdateResult =
  | { ok: true; changed: EditableBrandingField[] }
  | { ok: false; error: "unauthorized" | "not_found" | "validation" | "write_failed"; fieldErrors?: Partial<Record<EditableBrandingField, BrandingFieldError>> };

/**
 * The RAW persisted editable row for the editor's initial values (NOT the merged,
 * fallback-filled render form — the admin must see what is actually stored vs. empty).
 * Gated by the platform read permission. Returns null when no branding row exists yet.
 */
export async function getTenantBrandingRow(tenantId: string): Promise<TenantBrandingRow | null> {
  await assertPlatformPermission("platform:companies:read");
  const admin = getAdminSupabaseClient();
  const { data } = await admin
    .from("tenant_branding")
    .select(BRANDING_SELECT)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return (data ?? null) as TenantBrandingRow | null;
}

/** Persist the editable branding for one tenant. Platform-gated, validated, audited. */
export async function updateTenantBranding(
  tenantId: string,
  draft: BrandingDraft,
): Promise<BrandingUpdateResult> {
  let actor;
  try {
    actor = await assertPlatformPermission("platform:companies:update");
  } catch (e) {
    if (e instanceof PlatformAuthError) return { ok: false, error: "unauthorized" };
    throw e;
  }
  if (!tenantId) return { ok: false, error: "not_found" };

  const validation = validateBrandingDraft(draft);
  if (!validation.ok) return { ok: false, error: "validation", fieldErrors: validation.errors };

  const admin = getAdminSupabaseClient();

  // The tenant must exist (and let us read its current branding for the change diff).
  const [{ data: org }, { data: current }] = await Promise.all([
    admin.from("organization").select("id").eq("id", tenantId).maybeSingle(),
    admin.from("tenant_branding").select(BRANDING_SELECT).eq("tenant_id", tenantId).maybeSingle(),
  ]);
  if (!org) return { ok: false, error: "not_found" };

  const changed = changedBrandingFields(validation.row, (current ?? null) as TenantBrandingRow | null);

  // Upsert ONLY the editable columns. On an existing row, unlisted columns (logo_url,
  // portal_logo_url) are not in the SET clause, so they are preserved.
  const { error: upErr } = await admin
    .from("tenant_branding")
    .upsert({ tenant_id: tenantId, ...validation.row }, { onConflict: "tenant_id" });
  if (upErr) return { ok: false, error: "write_failed" };

  // "Branding reviewed" is a real onboarding signal — a platform admin configured it.
  await admin.from("organization").update({ branding_complete: true }).eq("id", tenantId);

  await writeAudit({
    action: AuditActions.PLATFORM_BRANDING_UPDATED,
    tenantId,
    platformActorId: actor.id,
    entity: "tenant_branding",
    entityId: tenantId,
    // FIELD NAMES ONLY — never the before/after values.
    after: { changedFields: changed },
  });

  revalidatePath(`/platform/companies/${tenantId}`);
  return { ok: true, changed };
}
