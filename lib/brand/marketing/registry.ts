/**
 * Marketing email registry + providers (DBC-6). PURE.
 * ---------------------------------------------------------------------------
 * Template types + the ESP providers we emit portable HTML for. Two types are active;
 * others (and future ESPs) plug in without a new engine.
 */
export const MARKETING_TEMPLATE_TYPES = ["NEWSLETTER", "ANNOUNCEMENT", "PROMOTION", "CORPORATE_UPDATE", "EVENT_INVITATION"] as const;
export type MarketingType = (typeof MARKETING_TEMPLATE_TYPES)[number];
export const ACTIVE_MARKETING: MarketingType[] = ["ANNOUNCEMENT", "CORPORATE_UPDATE"];
export function isMarketingType(v: string): v is MarketingType {
  return (MARKETING_TEMPLATE_TYPES as readonly string[]).includes(v);
}
export const MARKETING_LABEL: Record<MarketingType, string> = {
  NEWSLETTER: "Newsletter", ANNOUNCEMENT: "Annonce", PROMOTION: "Promotion", CORPORATE_UPDATE: "Actualité corporate", EVENT_INVITATION: "Invitation événement",
};

export const EMAIL_PROVIDERS = ["generic", "mailchimp", "hubspot", "dynamics"] as const;
export type EmailProvider = (typeof EMAIL_PROVIDERS)[number];
export function isEmailProvider(v: string): v is EmailProvider {
  return (EMAIL_PROVIDERS as readonly string[]).includes(v);
}
export const PROVIDER_LABEL: Record<EmailProvider, string> = {
  generic: "Générique ({{TAG}})", mailchimp: "Mailchimp", hubspot: "HubSpot", dynamics: "Microsoft Dynamics",
};
