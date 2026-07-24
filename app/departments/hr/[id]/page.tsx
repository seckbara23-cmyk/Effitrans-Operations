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

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Management · Ressources humaines"
        title={fullName}
        subtitle={`${employee.employee_number} · ${deptLabel}${employee.job_title ? ` · ${employee.job_title}` : ""}`}
      />

      <Link href="/departments/hr" className="inline-block text-xs text-teal-700 hover:underline">← Registre du personnel</Link>

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
