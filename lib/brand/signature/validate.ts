/**
 * Compiled-signature validation (DBC-2). PURE.
 * ---------------------------------------------------------------------------
 * Asserts a compiled signature HTML string is email-client-safe. Used by tests and as a
 * defensive check before a signature is offered for download. It does not claim any client
 * renders it pixel-perfect — it enforces the structural constraints that make broad
 * compatibility POSSIBLE (tables, inline CSS, no script, no modern layout, safe links).
 */
export type SignatureHtmlIssue =
  | "no_table" | "has_script" | "has_style_block" | "external_css" | "flexbox" | "grid"
  | "positioned" | "javascript_url" | "has_vml";

export function validateSignatureHtml(html: string): { ok: true } | { ok: false; issues: SignatureHtmlIssue[] } {
  const issues: SignatureHtmlIssue[] = [];
  const lower = html.toLowerCase();
  if (!lower.includes("<table")) issues.push("no_table");
  if (lower.includes("<script")) issues.push("has_script");
  if (lower.includes("<style")) issues.push("has_style_block");
  if (lower.includes("<link") || lower.includes("@import")) issues.push("external_css");
  if (lower.includes("display:flex") || lower.includes("display: flex")) issues.push("flexbox");
  if (lower.includes("display:grid") || lower.includes("display: grid")) issues.push("grid");
  if (/position\s*:\s*(absolute|fixed|relative)/.test(lower)) issues.push("positioned");
  if (lower.includes("javascript:")) issues.push("javascript_url");
  if (lower.includes("<v:") || lower.includes("vml")) issues.push("has_vml");
  return issues.length === 0 ? { ok: true } : { ok: false, issues };
}
