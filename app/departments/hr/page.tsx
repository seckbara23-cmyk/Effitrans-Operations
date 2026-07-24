/**
 * Ressources humaines — Employee Registry (Phase HR-1). SERVER.
 * ---------------------------------------------------------------------------
 * A MANAGEMENT surface (not an operational department). Server-gated on hr:read;
 * the "Nouvel employé" affordance and all mutations require hr:manage. Renders
 * ONLY real data (no fabricated rows). Reads are tenant-scoped in lib/hr/read.
 *
 * SYSTEM_ADMIN holds no hr:* by default (DEC-B25): without hr:read this page is
 * notFound() and the RLS policy returns zero employee rows regardless.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/departments/stat-card";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { employeeStats, listEmployees, type EmployeeFilters } from "@/lib/hr/read";
import { employeeStatusLabelFr, EMPLOYEE_STATUSES } from "@/lib/hr/lifecycle";
import { CANONICAL_DEPARTMENTS, departmentLabelFr, isCanonicalDepartment } from "@/lib/organization/departments";
import { EmployeeCreateForm } from "@/components/hr/employee-create-form";

export const metadata: Metadata = { title: "Ressources humaines" };
export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "navy" | "teal" | "amber" | "red" | "slate"> = {
  DRAFT: "slate",
  ACTIVE: "teal",
  SUSPENDED: "amber",
  TERMINATED: "red",
  ARCHIVED: "slate",
};

function StatusBadge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "slate";
  const cls: Record<string, string> = {
    teal: "bg-teal-50 text-teal-700",
    amber: "bg-amber-50 text-amber-700",
    red: "bg-red-50 text-red-700",
    slate: "bg-slate-100 text-slate-500",
    navy: "bg-navy-50 text-navy-700",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls[tone]}`}>
      {employeeStatusLabelFr(status)}
    </span>
  );
}

export default async function HrRegistryPage({
  searchParams,
}: {
  searchParams?: { status?: string; department?: string };
}) {
  const header = <PageHeader meta="Management" title="Ressources humaines" subtitle="Registre du personnel — identité, département, fonction, statut d'emploi et liaison de compte." />;

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:read")) notFound();
  const canManage = hasPermission(permissions, "hr:manage");

  const filters: EmployeeFilters = {};
  if (searchParams?.status && (EMPLOYEE_STATUSES as readonly string[]).includes(searchParams.status)) {
    filters.status = searchParams.status;
  }
  if (searchParams?.department && isCanonicalDepartment(searchParams.department)) {
    filters.department = searchParams.department;
  }

  const [stats, rows] = await Promise.all([employeeStats(user.tenantId), listEmployees(user.tenantId, filters)]);

  const filterHref = (patch: Partial<EmployeeFilters>) => {
    const sp = new URLSearchParams();
    const status = patch.status ?? filters.status;
    const department = patch.department ?? filters.department;
    if (status) sp.set("status", status);
    if (department) sp.set("department", department);
    const qs = sp.toString();
    return qs ? `/departments/hr?${qs}` : "/departments/hr";
  };

  return (
    <div className="animate-fade-in space-y-6">
      {header}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Actifs" value={stats.active} tone="teal" />
        <StatCard label="Suspendus" value={stats.suspended} tone="amber" />
        <StatCard label="Sans compte" value={stats.withoutAccount} tone="navy" />
        <StatCard label="Nouveaux ce mois" value={stats.newThisMonth} tone="slate" />
      </div>

      {canManage && <EmployeeCreateForm />}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-400">Statut :</span>
        <Link href={filterHref({ status: undefined })} className={`rounded px-2 py-1 ${!filters.status ? "bg-navy-700 text-white" : "bg-slate-100 text-slate-600"}`}>Tous</Link>
        {EMPLOYEE_STATUSES.map((s) => (
          <Link key={s} href={filterHref({ status: filters.status === s ? undefined : s })} className={`rounded px-2 py-1 ${filters.status === s ? "bg-navy-700 text-white" : "bg-slate-100 text-slate-600"}`}>
            {employeeStatusLabelFr(s)}
          </Link>
        ))}
        <span className="ml-3 text-slate-400">Département :</span>
        <Link href={filterHref({ department: undefined })} className={`rounded px-2 py-1 ${!filters.department ? "bg-navy-700 text-white" : "bg-slate-100 text-slate-600"}`}>Tous</Link>
        {CANONICAL_DEPARTMENTS.map((d) => (
          <Link key={d.code} href={filterHref({ department: filters.department === d.code ? undefined : d.code })} className={`rounded px-2 py-1 ${filters.department === d.code ? "bg-navy-700 text-white" : "bg-slate-100 text-slate-600"}`}>
            {d.labelFr}
          </Link>
        ))}
      </div>

      {/* Directory */}
      <div className="surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            Aucun employé enregistré{filters.status || filters.department ? " pour ce filtre" : ""}.
            {canManage && !filters.status && !filters.department ? " Utilisez « Nouvel employé » pour créer le premier enregistrement." : ""}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-500">
                  <th className="px-4 py-2 font-medium">Matricule</th>
                  <th className="px-4 py-2 font-medium">Nom</th>
                  <th className="px-4 py-2 font-medium">Département</th>
                  <th className="px-4 py-2 font-medium">Fonction</th>
                  <th className="px-4 py-2 font-medium">Statut</th>
                  <th className="px-4 py-2 font-medium">Compte</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link href={`/departments/hr/${r.id}`} className="font-mono text-xs text-teal-700 hover:underline">{r.employee_number}</Link>
                    </td>
                    <td className="px-4 py-2 text-navy-900">
                      <Link href={`/departments/hr/${r.id}`} className="hover:underline">
                        {r.preferred_name?.trim() || r.first_name} {r.last_name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-slate-600">{isCanonicalDepartment(r.department) ? departmentLabelFr(r.department) : r.department}</td>
                    <td className="px-4 py-2 text-slate-600">{r.job_title || "—"}</td>
                    <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-2 text-center">{r.has_account ? <span className="text-teal-600" title="Compte lié">✓</span> : <span className="text-slate-300" title="Sans compte">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400">
        Un employé peut exister sans compte de connexion. La liaison d'un compte n'accorde aucune permission ;
        un départ n'entraîne jamais la révocation automatique de l'accès (action distincte via Administration).
      </p>
    </div>
  );
}
