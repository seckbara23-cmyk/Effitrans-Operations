/**
 * Branding resolution (Phase 4.0B-3). PURE — no I/O, unit-testable.
 * ---------------------------------------------------------------------------
 * Merge one tenant's organization identity + optional tenant_branding row into a
 * safe, complete TenantBranding. Only ever reads the SINGLE tenant's data passed
 * in — no cross-tenant leakage is structurally possible. Invalid values fall back
 * to platform-safe defaults; a missing brand still renders a sensible name.
 */
import { PLATFORM_BRANDING } from "./platform";
import { isSafeUrl, isValidHexColor, safeText } from "./validate";
import type { OrgIdentity, TenantBranding, TenantBrandingRow } from "./types";

export function mergeBranding(org: OrgIdentity, row?: TenantBrandingRow | null): TenantBranding {
  const displayName =
    safeText(row?.display_name) ??
    safeText(org.tradeName) ??
    safeText(org.name) ??
    PLATFORM_BRANDING.displayName;

  const legalName = safeText(org.legalName) ?? safeText(org.name);

  return {
    displayName,
    legalName,
    logoUrl: isSafeUrl(row?.logo_url) ? row!.logo_url! : undefined,
    portalLogoUrl: isSafeUrl(row?.portal_logo_url) ? row!.portal_logo_url! : undefined,
    primaryColor: isValidHexColor(row?.primary_color) ? row!.primary_color! : PLATFORM_BRANDING.primaryColor,
    secondaryColor: isValidHexColor(row?.secondary_color) ? row!.secondary_color! : PLATFORM_BRANDING.secondaryColor,
    emailFooter: safeText(row?.email_footer) ?? displayName,
    pdfHeaderText: safeText(row?.pdf_header_text) ?? displayName.toUpperCase(),
    invoiceFooterText: safeText(row?.invoice_footer_text),
    supportEmail: safeText(row?.support_email),
    supportPhone: safeText(row?.support_phone),
  };
}
