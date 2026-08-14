/**
 * HR-B3 — the downloadable employee import template (.xlsx).
 * ---------------------------------------------------------------------------
 * The headers ARE the contract: they come from EMPLOYEE_TEMPLATE_COLUMNS, the
 * same definition the auto-mapper and the validator read, so a file made from
 * this template needs no manual correspondance at all. HR-B3A: the data sheet
 * holds headers ONLY (guidance lives in the « Instructions » sheet, dropdowns
 * and column formats guide entry) — see lib/hr/import-template-xlsx.ts.
 *
 * Gated exactly like the imports page: hr:manage. Deterministic bytes.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { buildEmployeeImportTemplate } from "@/lib/hr/import-template-xlsx";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Non autorisé", { status: 401 });
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:manage")) {
    return new NextResponse("hr:manage requis", { status: 403 });
  }

  const bytes = buildEmployeeImportTemplate();

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="modele-import-employes.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
