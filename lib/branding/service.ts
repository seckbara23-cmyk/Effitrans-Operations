/**
 * Tenant branding resolution service (Phase 4.0B-3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Resolves the safe, complete branding for ONE tenant by reading its organization
 * identity + tenant_branding row, then applying the pure merge (fallbacks). Used
 * by customer-facing outputs (PDF/email/portal/notifications) in Phase 4.0B-4.
 *
 * Uses the service-role client scoped to the caller's OWN tenantId (always
 * derived from the authenticated user — getCurrentUser / getCurrentPortalUser /
 * requirePlatformUser — never from request input). This works for EVERY identity
 * class: portal users have no app_user, so an RLS read of their tenant's branding
 * would resolve nothing and wrongly fall back — the service-role read avoids that
 * while staying scoped to the one tenant. The tenant_branding read carries an
 * explicit tenant_id filter (tenant-scope guard compliant).
 */
import "server-only";
import { cache } from "react";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { PLATFORM_BRANDING } from "./platform";
import { mergeBranding } from "./resolve";
import type { OrgIdentity, TenantBranding } from "./types";

export const resolveTenantBranding = cache(async (tenantId: string): Promise<TenantBranding> => {
  const supabase = getAdminSupabaseClient();
  const [{ data: org }, { data: row }] = await Promise.all([
    supabase.from("organization").select("name, trade_name, legal_name").eq("id", tenantId).maybeSingle(),
    supabase
      .from("tenant_branding")
      .select(
        "display_name, logo_url, portal_logo_url, primary_color, secondary_color, email_footer, pdf_header_text, invoice_footer_text, support_email, support_phone, tagline",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const identity: OrgIdentity = {
    name: org?.name ?? PLATFORM_BRANDING.displayName,
    tradeName: org?.trade_name ?? null,
    legalName: org?.legal_name ?? null,
  };
  return mergeBranding(identity, row);
});
