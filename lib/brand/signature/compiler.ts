/**
 * Signature compiler (DBC-2). PURE, DETERMINISTIC — no I/O, no DOM, no Date/random.
 * ---------------------------------------------------------------------------
 * Turns a resolved SignatureModel into email-client-safe HTML and plain text. HARD RULES
 * (Outlook Desktop = Word renderer): table layout only, inline CSS only, NO <style>, NO
 * JavaScript, NO flex/grid/position, NO VML (flat buttons via a bgcolor <td>). Every
 * dynamic value is HTML-escaped; the whistleblower URL appears ONLY as a button href,
 * never as visible text. Images carry alt text, explicit width/height, display:block.
 *
 * Same input → same output, byte for byte. React may render this string in a preview, but
 * the string produced HERE is the artifact that is downloaded/copied — React never
 * generates the production HTML.
 */
import { escapeHtml } from "@/lib/comms/render";
import type { SignatureModel } from "./model";

const FONT = "Calibri,'Segoe UI',Arial,Helvetica,sans-serif";
const GRAY = "#6b7280";

function digits(v: string): string {
  return v.replace(/[^0-9]/g, "");
}

/** A visible link (escaped href + text). Used for tel/mailto/https contacts only. */
function link(href: string, text: string, color: string): string {
  return `<a href="${escapeHtml(href)}" style="color:${color};text-decoration:none">${escapeHtml(text)}</a>`;
}

function contactLine(model: SignatureModel): string {
  const e = model.employee;
  const c = model.colors.anthracite;
  const parts: string[] = [];
  if (e.phoneOffice) parts.push(`Tél. ${link(`tel:${digits(e.phoneOffice)}`, e.phoneOffice, c)}`);
  if (e.phoneMobile) parts.push(`Mob. ${link(`tel:${digits(e.phoneMobile)}`, e.phoneMobile, c)}`);
  if (e.whatsapp) parts.push(`WhatsApp ${link(`https://wa.me/${digits(e.whatsapp)}`, e.whatsapp, c)}`);
  return parts.join(" &nbsp;·&nbsp; ");
}

function webLine(model: SignatureModel): string {
  const c = model.colors.anthracite;
  const parts: string[] = [];
  parts.push(link(`mailto:${model.employee.email}`, model.employee.email, c));
  if (model.company.website) parts.push(link(model.company.website, model.company.website.replace(/^https?:\/\//, ""), c));
  return parts.join(" &nbsp;·&nbsp; ");
}

function membershipsRow(model: SignatureModel): string {
  if (model.memberships.length === 0) return "";
  const cells = model.memberships
    .map((m) =>
      m.logoUrl
        ? `<td style="padding:0 10px 0 0;vertical-align:middle"><img src="${escapeHtml(m.logoUrl)}" alt="${escapeHtml(m.logoAlt)}" height="24" style="display:block;border:0" /></td>`
        : `<td style="padding:0 10px 0 0;vertical-align:middle;font-size:11px;color:${GRAY}">${escapeHtml(m.name)}</td>`,
    )
    .join("");
  return `<tr><td style="padding-top:10px"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>${cells}</tr></table></td></tr>`;
}

function complianceBlock(model: SignatureModel): string {
  const green = model.colors.green;
  // Flat button: a bgcolor <td> + <a>. No VML, no border-radius reliance (Outlook flat).
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td bgcolor="${green}" style="background-color:${green}"><a href="${escapeHtml(model.compliance.portalUrl)}" style="display:inline-block;padding:7px 14px;color:#ffffff;font-size:12px;font-weight:bold;text-decoration:none;font-family:${FONT}">${escapeHtml(model.compliance.buttonLabel)}</a></td></tr></table>`;
  return `<tr><td style="padding-top:12px"><div style="font-size:12px;font-weight:bold;color:${model.colors.anthracite}">${escapeHtml(model.compliance.title)}</div><div style="font-size:11px;color:${GRAY};padding-bottom:6px">${escapeHtml(model.compliance.subtitle)}</div>${button}</td></tr>`;
}

/** Compile the signature to deterministic, Outlook-safe HTML. */
export function compileSignatureHtml(model: SignatureModel): string {
  const { colors, company, employee } = model;
  const full = model.variant === "EXECUTIVE" || model.variant === "MANAGEMENT";

  const logoCell = model.logoUrl
    ? `<td style="padding:0 16px 0 0;vertical-align:top"><img src="${escapeHtml(model.logoUrl)}" alt="${escapeHtml(model.logoAlt)}" height="48" style="display:block;border:0" /></td>`
    : "";

  const slogan = company.slogan ? `<div style="font-size:12px;font-style:italic;color:${GRAY}">${escapeHtml(company.slogan)}</div>` : "";
  const valueProp = full && company.valueProposition
    ? `<tr><td style="padding-top:8px;font-size:12px;color:${colors.anthracite}">${escapeHtml(company.valueProposition)}</td></tr>`
    : "";
  const addressLine = company.address ? `<div style="font-size:11px;color:${GRAY};padding-top:2px">${escapeHtml(company.address)}</div>` : "";

  const rows: string[] = [];
  rows.push(
    `<tr><td style="padding:0"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>${logoCell}<td style="vertical-align:top">` +
      `<div style="font-size:16px;font-weight:bold;color:${colors.green}">${escapeHtml(employee.name)}</div>` +
      `<div style="font-size:13px;font-weight:bold;color:${colors.anthracite}">${escapeHtml(employee.title)}</div>` +
      `<div style="font-size:13px;color:${colors.anthracite}">${escapeHtml(company.name)}</div>${slogan}` +
      `</td></tr></table></td></tr>`,
  );
  rows.push(`<tr><td style="padding-top:8px;border-top:2px solid ${colors.green};font-size:12px;color:${colors.anthracite}">${contactLine(model)}</td></tr>`);
  rows.push(`<tr><td style="padding-top:2px;font-size:12px">${webLine(model)}${addressLine}</td></tr>`);
  if (valueProp) rows.push(valueProp);
  if (full) rows.push(membershipsRow(model));
  if (full) rows.push(complianceBlock(model));
  // Sustainability (text + minimal — no large illustration).
  rows.push(`<tr><td style="padding-top:12px;font-size:11px;color:${colors.green};font-weight:bold">${escapeHtml(model.sustainability)}</td></tr>`);
  rows.push(`<tr><td style="padding-top:6px;font-size:10px;color:${GRAY}">${escapeHtml(company.footer)}</td></tr>`);
  rows.push(`<tr><td style="padding-top:2px;font-size:10px;color:${GRAY}">${escapeHtml(model.environmentalPrint)}</td></tr>`);

  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:${FONT};line-height:1.4;color:${colors.anthracite};max-width:600px;width:100%">` +
    rows.join("") +
    `</table>`
  );
}

/** Compile the SAME model to readable plain text — no HTML, no raw compliance URL. */
export function compileSignatureText(model: SignatureModel): string {
  const e = model.employee;
  const lines: string[] = [];
  lines.push(e.name);
  lines.push(e.title);
  lines.push(model.company.name);
  if (model.company.slogan) lines.push(model.company.slogan);
  lines.push("");
  if (e.phoneOffice) lines.push(`Tél. : ${e.phoneOffice}`);
  if (e.phoneMobile) lines.push(`Mobile : ${e.phoneMobile}`);
  if (e.whatsapp) lines.push(`WhatsApp : ${e.whatsapp}`);
  lines.push(`E-mail : ${e.email}`);
  if (model.company.website) lines.push(`Web : ${model.company.website}`);
  if (model.company.address) lines.push(model.company.address);
  const full = model.variant === "EXECUTIVE" || model.variant === "MANAGEMENT";
  if (full && model.company.valueProposition) { lines.push(""); lines.push(model.company.valueProposition); }
  if (full && model.memberships.length) { lines.push(""); lines.push(`Réseaux : ${model.memberships.map((m) => m.name).join(", ")}`); }
  lines.push("");
  lines.push(model.sustainability);
  // Whistleblower represented as a LABEL — never the raw URL.
  if (full) lines.push(model.compliance.subtitle);
  lines.push(model.company.footer);
  lines.push(model.environmentalPrint);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
