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

export function reportBrand(b: TenantBranding): ReportBrand {
  return {
    header: b.pdfHeaderText ?? b.displayName.toUpperCase(),
    footer: `${b.displayName} — Document confidentiel`,
    displayName: b.displayName,
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
