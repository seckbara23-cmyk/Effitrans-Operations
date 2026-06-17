/**
 * Report export route (Phase 3.0). Route Handler (GET) — CSV / XLSX download.
 * ---------------------------------------------------------------------------
 * Gated by analytics:read (tenant-scoped via the BI/control-tower services).
 * Derived-only; no PDF this phase. Reuses the pure report-table builders +
 * the dependency-free CSV / XLSX writers.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getBusinessIntelligence } from "@/lib/bi/service";
import { getControlTower } from "@/lib/control-tower/service";
import { revenueReport, clientsReport, operationsReport, financeReport, slaReport, type ReportTable, type ReportType } from "@/lib/bi/reports";
import { toCsv } from "@/lib/bi/aggregate";
import { toXlsx } from "@/lib/bi/xlsx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TYPES: ReportType[] = ["revenue", "clients", "operations", "sla", "finance"];

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "analytics:read")) return new NextResponse("Forbidden", { status: 403 });

  const url = new URL(req.url);
  const typeParam = url.searchParams.get("type") ?? "revenue";
  const type: ReportType = (TYPES as string[]).includes(typeParam) ? (typeParam as ReportType) : "revenue";
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  let table: ReportTable;
  if (type === "sla") {
    const ct = await getControlTower(permissions);
    table = slaReport(ct.slaByDept);
  } else {
    const bi = await getBusinessIntelligence(permissions, { from, to });
    table =
      type === "clients" ? clientsReport(bi) : type === "operations" ? operationsReport(bi) : type === "finance" ? financeReport(bi) : revenueReport(bi);
  }

  const filename = `effitrans-${type}.${format}`;
  if (format === "xlsx") {
    const buf = toXlsx(table.headers, table.rows);
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }
  return new NextResponse(toCsv(table.headers, table.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
