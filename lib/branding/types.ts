/**
 * Tenant branding contract (Phase 4.0B-3). PURE types.
 * ---------------------------------------------------------------------------
 * The safe, resolved branding used by customer-facing outputs. Values are always
 * validated (safe colors/URLs, no HTML) and fall back to platform-safe defaults —
 * a tenant can never render another tenant's brand, and a missing brand never
 * renders "unbranded".
 */
export type TenantBranding = {
  displayName: string;
  legalName?: string;
  logoUrl?: string;
  portalLogoUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  emailFooter?: string;
  pdfHeaderText?: string;
  invoiceFooterText?: string;
  supportEmail?: string;
  supportPhone?: string;
};

/** Organization identity fields the resolver derives display/legal names from. */
export type OrgIdentity = {
  name: string;
  tradeName?: string | null;
  legalName?: string | null;
};

/** The tenant_branding row shape (all optional/nullable). */
export type TenantBrandingRow = {
  display_name?: string | null;
  logo_url?: string | null;
  portal_logo_url?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  email_footer?: string | null;
  pdf_header_text?: string | null;
  invoice_footer_text?: string | null;
  support_email?: string | null;
  support_phone?: string | null;
};
