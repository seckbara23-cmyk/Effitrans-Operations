/**
 * Tenant branding resolution service (Phase 4.0B-3). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Resolves the safe, complete branding for ONE tenant by reading its organization
 * identity + tenant_branding row, then applying the pure merge (fallbacks). Used
 * by customer-facing outputs (PDF/email/portal/notifications) in Phase 4.0B-4.
 *
 * Reads go through the RLS-respecting server client where possible; tenant_branding
 * has a self-tenant SELECT policy. When called from a service-role context that
 * already knows the tenant, the tenant_id filter keeps the read tenant-scoped.
 */
import "server-only";
import { cache } from "react";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { PLATFORM_BRANDING } from "./platform";
import { mergeBranding } from "./resolve";
import type { OrgIdentity, TenantBranding } from "./types";

export const resolveTenantBranding = cache(async (tenantId: string): Promise<TenantBranding> => {
  const supabase = getServerSupabaseClient();
  const [{ data: org }, { data: row }] = await Promise.all([
    supabase.from("organization").select("name, trade_name, legal_name").eq("id", tenantId).maybeSingle(),
    supabase
      .from("tenant_branding")
      .select(
        "display_name, logo_url, portal_logo_url, primary_color, secondary_color, email_footer, pdf_header_text, invoice_footer_text, support_email, support_phone",
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
