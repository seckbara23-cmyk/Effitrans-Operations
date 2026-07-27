/**
 * Dossier ownership & assignment panel (Phase WES-3K). Server component.
 * ---------------------------------------------------------------------------
 * Shows the FOUR canonical concepts SEPARATELY. The audit found the platform
 * presenting one ambiguous « Responsable du dossier » that could mean the
 * account manager, the coordinator, the legacy `assigned_to_user_id` holder or
 * whoever happened to hold the current task — the "three-headed ownership"
 * finding from 9.0A, still visible in the UI.
 *
 *   Responsable commercial   the client relationship
 *   Responsable opérationnel end-to-end coordination and closure
 *   Département responsable  who must act NOW (from the WES-2 projection)
 *   Tâche en cours           the current work, and who holds it
 *
 * Read-only. Assignment happens through the actions, which re-assert authority
 * server-side; nothing here is a permission check.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readAssignmentHistory, getOperationalOwnerId } from "@/lib/workflow/access/service";
import { explainAccessFr, type DossierAccess } from "@/lib/workflow/access/resolver";
import { canonicalDepartmentForLifecycle } from "@/lib/workflow/access/departments";
import { departmentLabelFr } from "@/lib/organization/departments";
import type { Department } from "@/lib/files/lifecycle";

const REASON_LABELS_FR: Record<string, string> = {
  INITIAL: "Affectation initiale",
  REASSIGNMENT: "Réaffectation",
  SUPERVISOR_INTERVENTION: "Intervention de l'encadrement",
  WORKLOAD_BALANCING: "Équilibrage de charge",
  ABSENCE: "Absence",
  ESCALATION: "Escalade",
  CORRECTION: "Correction",
  UNASSIGNMENT: "Retrait d'affectation",
  GOVERNANCE: "Décision d'administration",
};

const SUBJECT_LABELS_FR: Record<string, string> = {
  TASK: "Tâche",
  STEP: "Étape",
  OPERATIONAL_OWNER: "Responsable opérationnel",
  COMMERCIAL_OWNER: "Responsable commercial",
};

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-sm font-medium text-navy-900">{value}</dd>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

export async function OwnershipPanel({
  fileId,
  access,
  responsibleDepartment,
  currentTaskTitle,
  currentTaskAssigneeLabel,
}: {
  fileId: string;
  access: DossierAccess;
  responsibleDepartment: Department | null;
  currentTaskTitle: string | null;
  /** Display label only — the panel never needs the assignee's identity. */
  currentTaskAssigneeLabel: string | null;
}) {
  const user = await getCurrentUser();
  if (!user || !access.canViewSummary) return null;

  // The two owner ids are read here rather than threaded through the page:
  // `FileDetail` exposes neither, and widening it would put ownership back on
  // the dossier row — the shape WES-3 is separating.
  const admin = getAdminSupabaseClient();
  const [{ data: fileRow }, operationalOwnerId] = await Promise.all([
    admin
      .from("operational_file")
      .select("account_manager_id, coordinator_id")
      .eq("id", fileId)
      .eq("tenant_id", user.tenantId)
      .maybeSingle<{ account_manager_id: string | null; coordinator_id: string | null }>(),
    getOperationalOwnerId(fileId),
  ]);
  const commercialOwnerId = fileRow?.account_manager_id ?? fileRow?.coordinator_id ?? null;

  // Names for the handful of people this panel mentions. Tenant-scoped: the
  // admin client bypasses RLS.
  const ids = Array.from(
    new Set([commercialOwnerId, operationalOwnerId].filter(Boolean)),
  ) as string[];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data } = await admin
      .from("app_user")
      .select("id, name, email")
      .eq("tenant_id", user.tenantId)
      .in("id", ids);
    for (const row of data ?? []) {
      names.set(row.id as string, (row.name as string | null) ?? (row.email as string));
    }
  }
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? "—") : "Non désigné");

  const history = await readAssignmentHistory(fileId, 12);

  return (
    <section className="surface space-y-4 p-4">
      <h2 className="text-sm font-semibold text-navy-900">Responsabilités</h2>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Responsable commercial"
          value={nameOf(commercialOwnerId)}
          hint="Relation client"
        />
        <Field
          label="Responsable opérationnel"
          value={nameOf(operationalOwnerId)}
          hint="Coordination et clôture"
        />
        <Field
          label="Département responsable"
          value={
            responsibleDepartment
              ? departmentLabelFr(canonicalDepartmentForLifecycle(responsibleDepartment))
              : "—"
          }
          hint="Qui doit agir maintenant"
        />
        <Field
          label="Tâche en cours"
          value={currentTaskTitle ?? "Aucune"}
          hint={
            currentTaskTitle
              ? currentTaskAssigneeLabel
                ? `Affectée à ${currentTaskAssigneeLabel}`
                : "Non affectée — visible dans la file du département"
              : undefined
          }
        />
      </dl>

      {/* Assignment history — append-only, so this is the whole story. */}
      {history.length > 0 && access.canViewHistoricalDepartmentDetail && (
        <div className="border-t border-slate-100 pt-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Historique des affectations
          </h3>
          <ul className="space-y-1">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <time dateTime={h.createdAt} className="tabular shrink-0 text-slate-400">
                  {new Date(h.createdAt).toLocaleDateString("fr-FR")}
                </time>
                <span className="text-slate-500">
                  {SUBJECT_LABELS_FR[h.subjectType] ?? h.subjectType}
                </span>
                <span className="font-medium text-navy-900">
                  {h.previousUserId ? nameOf(h.previousUserId) : "—"} →{" "}
                  {h.newUserId ? nameOf(h.newUserId) : "non affectée"}
                </span>
                {h.reasonCode && (
                  <span className="rounded bg-sand-50 px-1.5 py-0.5 text-[11px] text-slate-600">
                    {REASON_LABELS_FR[h.reasonCode] ?? h.reasonCode}
                  </span>
                )}
                {h.provenance === "LEGACY_IMPORT" && (
                  <span className="text-[11px] text-amber-700">(reprise historique)</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Why this dossier is visible. Reasons only — never permission codes. */}
      <div className="border-t border-slate-100 pt-3">
        <p className="text-[11px] text-slate-400">
          Visible parce que&nbsp;: {explainAccessFr(access).join(" · ") || "—"}
        </p>
      </div>
    </section>
  );
}
