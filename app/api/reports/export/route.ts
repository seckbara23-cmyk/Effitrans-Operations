/**
 * Report export route (Phase 3.0 + 3.0B). Route Handler (GET) — download.
 * ---------------------------------------------------------------------------
 * Gated by analytics:read (tenant-scoped via the BI/Control Tower services);
 * finance figures stay additionally gated by finance:read inside those services.
 * Derived-only. Formats:
 *   - CSV / XLSX / PDF for the 5 standard reports (revenue|clients|operations|sla|finance)
 *   - type=executive&format=pdf         -> Executive Summary PDF
 *   - type=powerbi&format=xlsx          -> effitrans_powerbi_export.xlsx (multi-sheet)
 *   - type=powerbi&format=csv|zip       -> Power BI CSV package (.zip of RFC-4180 CSVs)
 * Every export is recorded in the existing audit log (report.export.*). Reuses
 * the pure report-table + PDF + workbook + CSV builders — no new aggregation.
 */
import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { getServerSupabaseClient } from "@/lib/supabase/server";
import { resolveTenantBranding } from "@/lib/branding/service";
import { reportBrand, exportFilename, powerbiFilename } from "@/lib/reports/brand";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getBusinessIntelligence } from "@/lib/bi/service";
import { getControlTower } from "@/lib/control-tower/service";
import { getAnalytics } from "@/lib/analytics/service";
import { revenueReport, clientsReport, operationsReport, financeReport, slaReport, type ReportTable, type ReportType } from "@/lib/bi/reports";
import { toCsv } from "@/lib/bi/aggregate";
import { toXlsx } from "@/lib/bi/xlsx";
import { buildReportPdf } from "@/lib/reports/report-pdf";
import { buildExecutivePdf } from "@/lib/reports/executive-pdf";
import { buildPowerBiDatasets, toPowerBiWorkbook, toPowerBiCsvZip } from "@/lib/reports/powerbi";
import type { ReportMeta } from "@/lib/reports/templates";
import { writeAudit } from "@/lib/audit/log";
import { AuditActions } from "@/lib/audit/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES: ReportType[] = ["revenue", "clients", "operations", "sla", "finance"];
const XLSX_CT = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function download(body: Uint8Array | string, contentType: string, filename: string): NextResponse {
  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

function dateRangeLabel(from: string | null, to: string | null): string {
  if (from && to) return `Du ${from} au ${to}`;
  if (from) return `À partir du ${from}`;
  if (to) return `Jusqu'au ${to}`;
  return "Toutes périodes";
}

/** Best-effort audit — never fail a download because the log write failed. */
async function recordExport(
  action: string,
  user: CurrentUser,
  report: string,
  from: string | null,
  to: string | null,
): Promise<void> {
  try {
    await writeAudit({
      action,
      actorId: user.id,
      tenantId: user.tenantId,
      entity: "report",
      entityId: report,
      after: { report, from: from ?? null, to: to ?? null },
    });
  } catch {
    /* best-effort */
  }
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "analytics:read")) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const typeParam = url.searchParams.get("type") ?? "revenue";
  const format = url.searchParams.get("format") ?? "csv";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  // Tenant-resolved branding + slug for the report chrome + export filenames
  // (Effitrans backfill reproduces today's "EFFITRANS OPERATIONS" / "effitrans-*").
  const branding = await resolveTenantBranding(user.tenantId);
  const { data: orgRow } = await getServerSupabaseClient()
    .from("organization")
    .select("slug")
    .eq("id", user.tenantId)
    .maybeSingle();
  const slug = orgRow?.slug ?? null;

  const meta: ReportMeta = {
    title: "",
    dateRange: dateRangeLabel(from, to),
    generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    generatedBy: user.email,
    brand: reportBrand(branding),
  };

  // ---- Power BI export pack (Deliverables 3 & 4) -----------------------------
  if (typeParam === "powerbi") {
    const [bi, ct, analytics] = await Promise.all([
      getBusinessIntelligence(permissions, { from, to }),
      getControlTower(permissions, { includeDossiers: true }),
      getAnalytics(hasPermission(permissions, "finance:read")),
    ]);
    const datasets = buildPowerBiDatasets({ bi, ct, analytics });
    await recordExport(AuditActions.REPORT_EXPORT_POWERBI, user, "powerbi", from, to);
    if (format === "csv" || format === "zip") {
      return download(toPowerBiCsvZip(datasets), "application/zip", powerbiFilename(slug, "zip"));
    }
    return download(toPowerBiWorkbook(datasets), XLSX_CT, powerbiFilename(slug, "xlsx"));
  }

  // ---- Executive Summary PDF (Deliverable 2) ---------------------------------
  if (typeParam === "executive") {
    const [bi, ct] = await Promise.all([
      getBusinessIntelligence(permissions, { from, to }),
      getControlTower(permissions),
    ]);
    meta.title = "Rapport exécutif";
    const pdf = buildExecutivePdf({ bi, ct, meta });
    await recordExport(AuditActions.REPORT_EXPORT_PDF, user, "executive", from, to);
    return download(pdf, "application/pdf", exportFilename(slug, "executive", "pdf"));
  }

  // ---- Standard reports (CSV / XLSX / PDF) ------------------------------------
  const type: ReportType = (TYPES as string[]).includes(typeParam) ? (typeParam as ReportType) : "revenue";
  const TITLE: Record<ReportType, string> = {
    revenue: "Rapport Revenus",
    clients: "Rapport Clients",
    operations: "Rapport Opérations",
    sla: "Rapport SLA",
    finance: "Rapport Finance",
  };
  meta.title = TITLE[type];

  if (format === "pdf") {
    const [bi, ct] = await Promise.all([
      getBusinessIntelligence(permissions, { from, to }),
      getControlTower(permissions),
    ]);
    const pdf = buildReportPdf(type, { bi, ct, meta });
    await recordExport(AuditActions.REPORT_EXPORT_PDF, user, type, from, to);
    return download(pdf, "application/pdf", exportFilename(slug, type, "pdf"));
  }

  // CSV / XLSX — the existing tabular exports (unchanged output).
  let table: ReportTable;
  if (type === "sla") {
    const ct = await getControlTower(permissions);
    table = slaReport(ct.slaByDept);
  } else {
    const bi = await getBusinessIntelligence(permissions, { from, to });
    table =
      type === "clients" ? clientsReport(bi) : type === "operations" ? operationsReport(bi) : type === "finance" ? financeReport(bi) : revenueReport(bi);
  }

  if (format === "xlsx") {
    await recordExport(AuditActions.REPORT_EXPORT_XLSX, user, type, from, to);
    return download(toXlsx(table.headers, table.rows), XLSX_CT, exportFilename(slug, type, "xlsx"));
  }
  await recordExport(AuditActions.REPORT_EXPORT_CSV, user, type, from, to);
  return download(toCsv(table.headers, table.rows), "text/csv; charset=utf-8", exportFilename(slug, type, "csv"));
}
