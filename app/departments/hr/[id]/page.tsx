/**
 * Employee profile (Phase HR-1). SERVER.
 * ---------------------------------------------------------------------------
 * Server-gated on hr:read; lifecycle + account-link controls require hr:manage
 * (the client admin component's actions re-check server-side). Renders real
 * data only. No UUID is shown to the user; the matricule is the human key.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getEmployee } from "@/lib/hr/read";
import { linkableAccounts } from "@/lib/hr/read";
import { employeeStatusLabelFr, nextEmployeeStatuses, type EmployeeStatus } from "@/lib/hr/lifecycle";
import { departmentLabelFr, isCanonicalDepartment } from "@/lib/organization/departments";
import { EmployeeAdmin } from "@/components/hr/employee-admin";
import { AssignmentPanel } from "@/components/hr/assignment-panel";
import { listEmployeeAssignments, listOrgUnits, listPositions, listWorkLocations } from "@/lib/hr/organization";
import { getEmployeeTimeline, HR_EVENT_LABEL_FR, type HrEventKind } from "@/lib/hr/ledger";
import { listEmployees } from "@/lib/hr/read";
import { EmployeeFilePanel } from "@/components/hr/employee-file-panel";
import { listDocumentTypes, listEmployeeDocuments, listEmployeeContracts } from "@/lib/hr/employee-file";
import { listEmployeeCustody, listEquipment, listEquipmentTypes, getLiveOnboardingCase, ONBOARDING_STATUS_FR, RETURN_OUTCOME_FR } from "@/lib/hr/onboarding";
import { deriveEmployeePresence, listEntitlements, listLeaveRequests, withBalances, LEAVE_STATUS_FR } from "@/lib/hr/leave";
import { PRESENCE_LABEL_FR } from "@/lib/hr/leave/presence";
import { formatTenths } from "@/lib/hr/leave/balance";

export const metadata: Metadata = { title: "Employé" };
export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-sm text-navy-900">{value?.trim() ? value : "—"}</dd>
    </div>
  );
}

export default async function EmployeeProfilePage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:read")) notFound();
  const canManage = hasPermission(permissions, "hr:manage");

  const employee = await getEmployee(user.tenantId, params.id);
  if (!employee) notFound();

  const fullName = `${employee.preferred_name?.trim() || employee.first_name} ${employee.last_name}`;
  const deptLabel = isCanonicalDepartment(employee.department) ? departmentLabelFr(employee.department) : employee.department;
  const allowedTransitions = nextEmployeeStatuses(employee.status as EmployeeStatus);
  const accounts = canManage ? await linkableAccounts(user.tenantId) : [];

  // HR-2 — the workspace reads: assignment history, catalogs, timeline, managers.
  const [assignments, units, positions, locations, timeline, directory] = await Promise.all([
    listEmployeeAssignments(user.tenantId, employee.id),
    listOrgUnits(user.tenantId),
    listPositions(user.tenantId),
    listWorkLocations(user.tenantId),
    getEmployeeTimeline(user.tenantId, employee.id),
    listEmployees(user.tenantId),
  ]);
  const canSeeSensitive = hasPermission(permissions, "hr:sensitive:read");
  const [presence, entitlements, leaveRequests] = await Promise.all([
    deriveEmployeePresence(user.tenantId, employee.id, employee.status),
    listEntitlements(user.tenantId, employee.id),
    listLeaveRequests(user.tenantId, employee.id),
  ]);
  const balances = withBalances(entitlements);
  const [custody, allEquipment, eqTypes, liveCase] = await Promise.all([
    listEmployeeCustody(user.tenantId, employee.id),
    listEquipment(user.tenantId),
    listEquipmentTypes(user.tenantId),
    getLiveOnboardingCase(user.tenantId, employee.id),
  ]);
  const [docTypes, documents, contracts] = await Promise.all([
    listDocumentTypes(user.tenantId),
    listEmployeeDocuments(user.tenantId, employee.id, canSeeSensitive),
    listEmployeeContracts(user.tenantId, employee.id),
  ]);
  const managers = directory
    .filter((e) => e.status === "ACTIVE")
    .map((e) => ({ id: e.id, label: `${e.first_name} ${e.last_name} (${e.employee_number})` }));

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Management · Ressources humaines"
        title={fullName}
        subtitle={`${employee.employee_number} · ${deptLabel}${employee.job_title ? ` · ${employee.job_title}` : ""}`}
      />

      <Link href="/departments/hr/registre" className="inline-block text-xs text-teal-700 hover:underline">← Registre du personnel</Link>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="surface p-4">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">Emploi</h2>
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Matricule" value={employee.employee_number} />
            <Field label="Statut" value={employeeStatusLabelFr(employee.status)} />
            <Field label="Département" value={deptLabel} />
            <Field label="Fonction" value={employee.job_title} />
            <Field label="Type de contrat" value={employee.employment_type} />
            <Field label="Lieu de travail" value={employee.work_location} />
            <Field label="Responsable" value={employee.manager_name} />
            <Field label="Date d'embauche" value={employee.hire_date} />
            <Field label="Fin de période d'essai" value={employee.probation_end_date} />
            {employee.status === "TERMINATED" && <Field label="Date de départ" value={employee.termination_date} />}
            {employee.status === "TERMINATED" && <Field label="Motif de départ" value={employee.termination_reason} />}
          </dl>
        </section>

        <section className="surface p-4">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">Identité & contact</h2>
          <dl className="grid grid-cols-2 gap-3">
            <Field label="Prénom" value={employee.first_name} />
            <Field label="Nom" value={employee.last_name} />
            <Field label="Nom d'usage" value={employee.preferred_name} />
            <Field label="E-mail professionnel" value={employee.professional_email} />
            <Field label="E-mail personnel" value={employee.personal_email} />
            <Field label="Téléphone professionnel" value={employee.professional_phone} />
            <Field label="Téléphone personnel" value={employee.personal_phone} />
            <Field label="Contact d'urgence" value={employee.emergency_contact_name} />
            <Field label="Téléphone d'urgence" value={employee.emergency_contact_phone} />
          </dl>
        </section>
      </div>

      <section className="surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Compte de connexion</h2>
        {employee.linked_account_email ? (
          <p className="text-sm text-slate-600">
            Lié à <span className="font-medium text-navy-900">{employee.linked_account_email}</span>.
            La liaison n'accorde aucune permission ; les rôles se gèrent dans Administration.
          </p>
        ) : (
          <p className="text-sm text-slate-500">Aucun compte de connexion lié. Cet employé peut exister sans accès à la plateforme.</p>
        )}
      </section>

      <AssignmentPanel
        employeeId={employee.id}
        assignments={assignments}
        units={units}
        positions={positions}
        locations={locations}
        managers={managers}
        canManage={canManage}
      />

      {/* HR-2 — the Timeline: a projection of the append-only ledger. Never editable. */}
      <section className="surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Chronologie</h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-slate-500">Aucun événement enregistré.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {timeline.map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-center gap-2 text-slate-600">
                <span className="tabular text-xs text-slate-400">{ev.occurred_at.slice(0, 16).replace("T", " ")}</span>
                <strong className="text-navy-800">{HR_EVENT_LABEL_FR[ev.event_kind as HrEventKind] ?? ev.event_kind}</strong>
                {ev.event_kind === "status_changed" && typeof ev.payload === "object" && ev.payload && (
                  <span className="text-xs text-slate-400">{String((ev.payload as Record<string, unknown>).from)} → {String((ev.payload as Record<string, unknown>).to)}</span>
                )}
                {ev.event_kind === "assignment_changed" && typeof ev.payload === "object" && ev.payload && (
                  <span className="text-xs text-slate-400">{String((ev.payload as Record<string, unknown>).change_kind ?? "")}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* HR-3 — the Employee File: Documents + Contrats live. Notes stays dark. */}
      <EmployeeFilePanel
        employeeId={employee.id}
        documents={documents}
        contracts={contracts}
        docTypes={docTypes}
        canManage={canManage}
        currentUserId={user.id}
      />
      {/* HR-5 — congés : le statut de présence est DÉDUIT, jamais stocké. */}
      <section className="surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">
          Congés <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            {PRESENCE_LABEL_FR[presence]} (déduit)
          </span>
        </h2>
        {balances.length === 0 ? <p className="text-sm text-slate-500">Aucun droit à congé saisi.</p> : (
          <ul className="space-y-1 text-sm">
            {balances.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2">
                <span className="tabular text-xs text-slate-400">{b.period_start} → {b.period_end}</span>
                <span className="text-navy-900">Restant {formatTenths(b.balance.remainingTenths)}</span>
                <span className="text-xs text-slate-400">
                  (ouverture {formatTenths(b.opening_tenths)} + acquis {formatTenths(b.accrued_tenths)} − pris {formatTenths(b.taken_tenths)})
                </span>
                {b.balance.overdrawn && <span className="text-xs text-red-600">dépassement</span>}
              </li>
            ))}
          </ul>
        )}
        {leaveRequests.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2 text-sm text-slate-600">
            {leaveRequests.slice(0, 5).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <span className="tabular text-xs text-slate-400">{r.start_date} → {r.end_date}</span>
                <span className="tabular text-xs">{formatTenths(r.day_tenths)}</span>
                <span className="text-xs">{LEAVE_STATUS_FR[r.status] ?? r.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* HR-4 — équipements confiés (attribution depuis l'espace Équipements) */}
      <section className="surface p-4">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Équipements confiés</h2>
        {liveCase && (
          <p className="mb-2 text-sm text-slate-600">
            Intégration : <strong className="text-navy-800">{ONBOARDING_STATUS_FR[liveCase.status] ?? liveCase.status}</strong>
            {" · "}<Link href="/departments/hr/onboarding" className="text-teal-700 hover:underline">ouvrir le dossier</Link>
          </p>
        )}
        {custody.length === 0 ? <p className="text-sm text-slate-500">Aucun équipement confié.</p> : (
          <ul className="space-y-1 text-sm">
            {custody.map((c) => {
              const eq = allEquipment.find((e) => e.id === c.equipment_id);
              const type = eqTypes.find((t) => t.id === eq?.equipment_type_id);
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-teal-700">{eq?.asset_tag ?? "—"}</span>
                  <span className="text-navy-900">{type?.label_fr ?? "—"}</span>
                  <span className="tabular text-xs text-slate-400">
                    {c.assigned_on}{c.returned_on ? ` → ${c.returned_on}` : " → en cours"}
                  </span>
                  {c.return_outcome && <span className="text-xs text-slate-500">{RETURN_OUTCOME_FR[c.return_outcome] ?? c.return_outcome}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div aria-disabled="true" className="surface p-4 opacity-60">
        <p className="text-sm font-semibold text-slate-500">Notes</p>
        <p className="mt-1 text-xs text-slate-400">À venir — pas de socle ratifié</p>
      </div>

      {canManage && (
        <EmployeeAdmin
          employeeId={employee.id}
          status={employee.status}
          statusLabel={employeeStatusLabelFr(employee.status)}
          allowedTransitions={allowedTransitions as string[]}
          hasLinkedAccount={employee.linked_app_user_id !== null}
          accounts={accounts}
        />
      )}
    </div>
  );
}
