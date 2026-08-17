/**
 * HR-9C — HR report export. Route Handler (GET) — download.
 * ---------------------------------------------------------------------------
 * Gated by `hr:reports:read`, and DELIBERATELY NOT by `analytics:read`: the
 * platform's general report route is open to CEO, DAF, commercial and
 * recouvrement roles, and HR aggregates do not travel through that door
 * (RQ-9.1). The BUILDERS are reused — `toCsv` from the BI layer, the same one
 * the standard reports use — because a second CSV writer would be a second
 * definition of correctness, not a feature.
 *
 * Derived-only: the file contains exactly the figures the workspace displays,
 * including the privacy floor, which is applied HERE too — an export is a
 * disclosure, so it obeys the same rule as the screen (RQ-9.2).
 *
 * Every download is audited (`hr.report.export`).
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { buildHrReport, resolvePeriod, reportViewerTier, applyPrivacyFloor, MASKED_LABEL_FR } from "@/lib/hr/reporting";
import { CANONICAL_DEPARTMENTS } from "@/lib/organization/departments";
import { toCsv } from "@/lib/bi/aggregate";
import { writeAudit } from "@/lib/audit/log";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:reports:read")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const tier = reportViewerTier(permissions);

  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const period = resolvePeriod(url.searchParams.get("du"), url.searchParams.get("au"), today);
  const codes: string[] = CANONICAL_DEPARTMENTS.map((d) => d.code);
  const raw = url.searchParams.get("departement");
  const department = raw && codes.includes(raw) ? raw : null;

  const report = await buildHrReport(user.tenantId, period, department);
  const h = report.headline;

  const rows: (string | number | null)[][] = [
    ["Période", `${period.from} → ${period.to}`],
    ["Département", department ?? "Tous"],
    [],
    ["Effectifs (situation actuelle)", ""],
    ["Employés au registre", h.employeesTotal],
    ["Actifs", h.employeesActive],
    ["Suspendus", h.employeesSuspended],
    ["Sans compte de connexion", h.withoutAccount],
    [],
    ["Mouvements de la période", ""],
    ["Entrées", h.entriesInPeriod],
    ["Sorties", h.departuresInPeriod],
    ["Congés approuvés (chevauchant la période)", h.leaveApprovedInPeriod],
    [],
    ["Charge opérationnelle (situation actuelle)", ""],
    ["Congés à décider", h.leavePendingNow],
    ["En congé aujourd'hui", h.onLeaveToday],
    ["Intégrations en cours", h.onboardingActive],
    ["Départs en cours", h.offboardingActive],
    ["Étapes de clôture à terminer", h.offboardingStepsPending],
    ["Matériel à restituer (départs)", h.equipmentOutstanding],
    ["Restitutions attendues", h.equipmentAwaitingReturn],
    ["Contrats expirant bientôt", h.contractsExpiringSoon ?? "indisponible"],
    ["Documents expirant bientôt", h.documentsExpiringSoon ?? "indisponible"],
  ];

  // The same floor as the screen: a masked group is named and its count withheld.
  for (const [title, breakdown] of [
    ["Par statut", report.byStatus], ["Par département", report.byDepartment],
    ["Par unité d'organisation", report.byOrgUnit],
  ] as const) {
    rows.push([], [title, ""]);
    for (const r of applyPrivacyFloor(breakdown, tier)) {
      rows.push([r.label, r.masked ? MASKED_LABEL_FR : r.count]);
    }
  }
  rows.push([], ["Note", "Aucun taux de rotation n'est calculé : la méthode n'est pas arrêtée."]);

  const csv = toCsv(["Indicateur", "Valeur"], rows);
  await writeAudit({
    action: "hr.report.export", actorId: user.id, tenantId: user.tenantId,
    entity: "hr_report", after: { from: period.from, to: period.to, department, format: "csv", tier },
  });

  const name = `rapport-rh_${period.from}_${period.to}${department ? `_${department}` : ""}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
