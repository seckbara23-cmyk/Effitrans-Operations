/**
 * Marketing email model + compiler (DBC-6). PURE, DETERMINISTIC.
 * ---------------------------------------------------------------------------
 * ONE engine → portable table-based, inline-CSS HTML compatible with Mailchimp / HubSpot /
 * Dynamics (via the merge-tag abstraction). Reuses the DBC-2 signature philosophy: tables
 * only, inline CSS, NO <style>/<script>/flex/grid/external CSS, everything escaped. NO
 * sending, tracking, or scheduling. The whistleblower URL is a button href only, never text.
 */
import { escapeHtml } from "@/lib/comms/render";
import { applyMergeTags, unsubscribeTag } from "./merge";
import type { EmailProvider, MarketingType } from "./registry";
import type { BrandProfile } from "@/lib/brand/server/service";

export type MarketingBrand = {
  companyName: string; green: string; anthracite: string; footer: string;
  compliance: { title: string; subtitle: string; buttonLabel: string; portalUrl: string } | null;
  sustainability: string;
};

export type MarketingModel = {
  type: MarketingType;
  brand: MarketingBrand;
  subject: string;
  preheader: string | null;
  headline: string;
  paragraphs: string[];
  cta: { label: string; url: string } | null;
  logoUrl: string | null;
  logoAlt: string;
};

export type MarketingReadiness = { ready: boolean; missing: string[] };
export function marketingReadiness(profile: BrandProfile): MarketingReadiness {
  const missing: string[] = [];
  if (!profile.colorGreen) missing.push("Couleur verte officielle");
  if (!profile.address) missing.push("Adresse de l'entreprise");
  if (!profile.whistleblowerUrl) missing.push("URL du portail de signalement");
  return { ready: missing.length === 0, missing };
}

export type MarketingInput = {
  type: MarketingType; subject: string; preheader?: string | null;
  headline: string; paragraphs: string[]; cta?: { label: string; url: string } | null;
};

export function buildMarketingModel(input: {
  marketing: MarketingInput; companyName: string; profile: BrandProfile; logoUrl: string | null; logoAlt: string;
}): MarketingModel {
  const p = input.profile;
  return {
    type: input.marketing.type,
    brand: {
      companyName: input.companyName, green: p.colorGreen ?? "#0F766E", anthracite: p.colorAnthracite ?? "#333F48",
      footer: p.compliance.footer_line,
      compliance: p.whistleblowerUrl ? { title: p.compliance.compliance_title, subtitle: p.compliance.compliance_subtitle, buttonLabel: p.compliance.compliance_button_label, portalUrl: p.whistleblowerUrl } : null,
      sustainability: p.compliance.sustainability_statement,
    },
    subject: input.marketing.subject,
    preheader: input.marketing.preheader ?? null,
    headline: input.marketing.headline,
    paragraphs: input.marketing.paragraphs,
    cta: input.marketing.cta ?? null,
    logoUrl: input.logoUrl,
    logoAlt: input.logoAlt,
  };
}

const FONT = "Arial, Helvetica, sans-serif";

/** Compile portable marketing HTML for a provider (merge tags translated). Deterministic. */
export function compileMarketingHtml(model: MarketingModel, provider: EmailProvider): string {
  const { brand } = model;
  const g = brand.green, a = brand.anthracite;
  const preheader = model.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(model.preheader)}</div>`
    : "";
  const logo = model.logoUrl
    ? `<img src="${escapeHtml(model.logoUrl)}" alt="${escapeHtml(model.logoAlt)}" height="36" style="display:block;border:0" />`
    : `<span style="color:#ffffff;font-weight:bold;font-size:18px">${escapeHtml(brand.companyName)}</span>`;

  const body = model.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:${a}">${escapeHtml(p)}</p>`)
    .join("");

  const cta = model.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px"><tr><td bgcolor="${g}" style="background-color:${g}"><a href="${escapeHtml(model.cta.url)}" style="display:inline-block;padding:11px 22px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;font-family:${FONT}">${escapeHtml(model.cta.label)}</a></td></tr></table>`
    : "";

  const compliance = brand.compliance
    ? `<tr><td style="padding:0 28px 14px"><div style="font-size:12px;font-weight:bold;color:${a}">${escapeHtml(brand.compliance.title)}</div><div style="font-size:11px;color:#6b7280;padding-bottom:6px">${escapeHtml(brand.compliance.subtitle)}</div><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${a}" style="background-color:${a}"><a href="${escapeHtml(brand.compliance.portalUrl)}" style="display:inline-block;padding:7px 14px;color:#fff;font-size:11px;font-weight:bold;text-decoration:none;font-family:${FONT}">${escapeHtml(brand.compliance.buttonLabel)}</a></td></tr></table></td></tr>`
    : "";

  // Greeting + unsubscribe use CANONICAL merge tags; applyMergeTags converts per provider.
  const html =
    `<!-- Effitrans marketing template · type=${model.type} -->` +
    preheader +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;font-family:${FONT}"><tr><td align="center" style="padding:20px 10px">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-collapse:collapse">` +
    `<tr><td style="background:${g};padding:16px 28px">${logo}</td></tr>` +
    `<tr><td style="padding:24px 28px 8px"><h1 style="margin:0 0 6px;font-size:22px;color:${g}">${escapeHtml(model.headline)}</h1></td></tr>` +
    `<tr><td style="padding:0 28px 8px;font-size:15px;color:${a}">Bonjour {{FIRST_NAME}},</td></tr>` +
    `<tr><td style="padding:0 28px 8px">${body}${cta}</td></tr>` +
    compliance +
    `<tr><td style="padding:12px 28px;border-top:1px solid #e2e8f0"><p style="margin:0;font-size:11px;font-weight:bold;color:${g}">${escapeHtml(brand.sustainability)}</p><p style="margin:4px 0 0;font-size:10px;color:#6b7280">${escapeHtml(brand.footer)}</p>` +
    `<p style="margin:8px 0 0;font-size:10px;color:#94a3b8">${escapeHtml(brand.companyName)} · <a href="{{UNSUBSCRIBE_URL}}" style="color:#94a3b8">Se désabonner</a></p></td></tr>` +
    `</table></td></tr></table>`;

  // Guarantee the unsubscribe tag is present for the provider (footer ownership).
  void unsubscribeTag;
  return applyMergeTags(html, provider);
}

export type MarketingHtmlIssue = "no_table" | "has_script" | "has_style_block" | "external_css" | "flexbox" | "grid" | "javascript_url";
export function validateMarketingHtml(html: string): { ok: true } | { ok: false; issues: MarketingHtmlIssue[] } {
  const l = html.toLowerCase();
  const issues: MarketingHtmlIssue[] = [];
  if (!l.includes("<table")) issues.push("no_table");
  if (l.includes("<script")) issues.push("has_script");
  if (l.includes("<style")) issues.push("has_style_block");
  if (l.includes("<link") || l.includes("@import")) issues.push("external_css");
  if (l.includes("display:flex") || l.includes("display: flex")) issues.push("flexbox");
  if (l.includes("display:grid") || l.includes("display: grid")) issues.push("grid");
  if (l.includes("javascript:")) issues.push("javascript_url");
  return issues.length ? { ok: false, issues } : { ok: true };
}
