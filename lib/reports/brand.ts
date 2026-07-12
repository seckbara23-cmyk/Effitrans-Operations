/**
 * Report/export branding helpers (Phase 4.0B-4). PURE — no I/O.
 * ---------------------------------------------------------------------------
 * Maps resolved TenantBranding into the report chrome (ReportBrand) and builds
 * tenant-slug export filenames. For the Effitrans tenant (slug "effitrans",
 * pdfHeaderText "EFFITRANS OPERATIONS", displayName "Effitrans Operations") these
 * reproduce today's output exactly.
 */
import type { TenantBranding } from "@/lib/branding/types";
import type { ReportBrand } from "./templates";
import type { RGB } from "./pdf";

/** `#rgb` / `#rrggbb` → normalized RGB, or undefined (→ report falls back). */
export function hexToRgb(hex: string | undefined | null): RGB | undefined {
  if (!hex) return undefined;
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return undefined;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function reportBrand(b: TenantBranding): ReportBrand {
  return {
    header: b.pdfHeaderText ?? b.displayName.toUpperCase(),
    footer: `${b.displayName} — Document confidentiel`,
    displayName: b.displayName,
    subtitle: b.tagline,
    primary: hexToRgb(b.primaryColor),
    accent: hexToRgb(b.secondaryColor),
  };
}

function slugOr(slug: string | null | undefined): string {
  return slug && slug.trim() ? slug.trim() : "export";
}

/** `<slug>-<base>.<ext>` — e.g. effitrans-executive.pdf */
export function exportFilename(slug: string | null | undefined, base: string, ext: string): string {
  return `${slugOr(slug)}-${base}.${ext}`;
}

/** Power BI pack filenames — `<slug>_powerbi_export.xlsx` / `<slug>_powerbi_csv.zip` */
export function powerbiFilename(slug: string | null | undefined, kind: "xlsx" | "zip"): string {
  return kind === "xlsx" ? `${slugOr(slug)}_powerbi_export.xlsx` : `${slugOr(slug)}_powerbi_csv.zip`;
}
