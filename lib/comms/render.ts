/**
 * Email rendering (Phase 1.14) — PURE, client + server safe.
 * ---------------------------------------------------------------------------
 * Interpolates {{var}} into a template. HTML body values are HTML-ESCAPED to
 * prevent injection; subject + text are plain. The HTML body is wrapped in
 * Effitrans branding. Fully unit-tested. The rendered output is what gets
 * stored + sent (auditability).
 */
import { TEMPLATES, type TemplateKey } from "./templates";

export type RenderedEmail = { subject: string; html: string; text: string };
export type TemplateVars = Record<string, string | number | null | undefined>;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function interpolate(template: string, vars: TemplateVars, escape: boolean): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const raw = vars[key];
    const str = raw == null ? "" : String(raw);
    return escape ? escapeHtml(str) : str;
  });
}

function brandWrap(bodyHtml: string): string {
  return (
    `<div style="font-family:system-ui,Arial,sans-serif;color:#0f172a;max-width:600px;margin:0 auto">` +
    `<div style="background:#0b1f3a;color:#fff;padding:16px 20px;font-weight:700">Effitrans — Transit & Logistique</div>` +
    `<div style="padding:20px">${bodyHtml}</div>` +
    `<div style="padding:12px 20px;color:#64748b;font-size:12px;border-top:1px solid #e2e8f0">Effitrans Operations · Dakar, Sénégal</div>` +
    `</div>`
  );
}

export function renderTemplate(key: TemplateKey, vars: TemplateVars): RenderedEmail {
  const tpl = TEMPLATES[key];
  return {
    subject: interpolate(tpl.subject, vars, false),
    html: brandWrap(interpolate(tpl.html, vars, true)),
    text: interpolate(tpl.text, vars, false),
  };
}
