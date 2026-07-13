/**
 * Official process inspector (Phase 5.0B, Deliverable 15) — DIAGNOSTIC ONLY.
 * ---------------------------------------------------------------------------
 * The minimal staff view needed to TEST the engine. A separate route, not a tab
 * on the dossier page, so that with the flag off nothing about the existing UI
 * changes — the route simply 404s and /files/[id] is byte-for-byte what it was.
 *
 * This is NOT a department queue and NOT a workspace. Those are Phase 5.0C.
 */
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getProcessFlags } from "@/lib/process/config";
import { getProcessState } from "@/lib/process/engine/service";

export const dynamic = "force-dynamic";

const STATE_TONE: Record<string, string> = {
  COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  APPROVED: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ACTIVE: "bg-blue-50 text-blue-700 border-blue-200",
  SUBMITTED: "bg-amber-50 text-amber-700 border-amber-200",
  AVAILABLE: "bg-slate-50 text-slate-700 border-slate-200",
  BLOCKED: "bg-red-50 text-red-700 border-red-200",
  REJECTED: "bg-red-50 text-red-700 border-red-200",
  UNVERIFIED_HISTORICAL: "bg-orange-50 text-orange-700 border-orange-200",
  PENDING: "bg-slate-50 text-slate-500 border-slate-200",
};

function Badge({ state }: { state: string }) {
  return (
    <span className={`rounded border px-2 py-0.5 text-xs font-medium ${STATE_TONE[state] ?? STATE_TONE.PENDING}`}>
      {state}
    </span>
  );
}

function Gate({ title, gate }: { title: string; gate: { ready: boolean; requirements: { key: string; labelFr: string; satisfied: boolean; notApplicable: boolean; detail?: string }[] } }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${gate.ready ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {gate.ready ? "Ouvert" : "Bloqué"}
        </span>
      </div>
      <ul className="space-y-1.5">
        {gate.requirements.map((r) => (
          <li key={r.key} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5">
              {r.notApplicable ? "—" : r.satisfied ? "✅" : "❌"}
            </span>
            <span className={r.notApplicable ? "text-slate-400" : "text-slate-700"}>
              {r.labelFr}
              {r.notApplicable && <span className="ml-1 text-xs">(non applicable)</span>}
              {r.detail && <span className="ml-1 text-xs text-red-600">({r.detail})</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function ProcessInspectorPage({ params }: { params: { id: string } }) {
  // Dark by default: with the flag off this route does not exist.
  if (!getProcessFlags().enabled) notFound();

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "process:read")) notFound();

  const state = await getProcessState(params.id);
  if (!state) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-lg font-semibold text-slate-900">Processus officiel Effitrans</h1>
        <p className="mt-2 text-sm text-slate-600">
          Aucune instance de processus pour ce dossier. Le moteur est actif mais le dossier n&apos;a pas
          encore été initialisé.
        </p>
        <Link href={`/files/${params.id}`} className="mt-4 inline-block text-sm text-blue-600 hover:underline">
          ← Retour au dossier
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <header>
        <Link href={`/files/${params.id}`} className="text-sm text-blue-600 hover:underline">
          ← Retour au dossier
        </Link>
        <h1 className="mt-2 text-lg font-semibold text-slate-900">Processus officiel Effitrans</h1>
        <p className="text-sm text-slate-600">
          {state.processVersion} · statut <strong>{state.status}</strong> · phase{" "}
          <strong>{state.currentPhase ?? "—"}</strong> · source{" "}
          <strong>{state.compatibilitySource}</strong> ({state.compatibilityConfidence})
        </p>
      </header>

      {state.unverifiedSteps.length > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
          <strong>{state.unverifiedSteps.length} étape(s) non vérifiée(s).</strong> Ce dossier a été
          rattaché au processus officiel a posteriori : la plateforme n&apos;a jamais capturé la preuve de
          ces étapes. Elles ne valent pas achèvement et n&apos;autorisent aucune clôture.
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Étapes actives</h2>
        {state.activeSteps.length === 0 && <p className="text-sm text-slate-500">Aucune étape active.</p>}
        <ul className="space-y-2">
          {state.activeSteps.map((s) => (
            <li key={s.stepKey} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2 last:border-0">
              <div>
                <div className="text-sm font-medium text-slate-900">
                  {s.stepNumber ? `${s.stepNumber}. ` : ""}
                  {s.labelFr}
                </div>
                <div className="text-xs text-slate-500">
                  {s.department} · {s.role} · SLA : {s.sla.label}
                </div>
                {s.missingPrerequisites.length > 0 && (
                  <div className="text-xs text-red-600">
                    Prérequis manquants : {s.missingPrerequisites.join(", ")}
                  </div>
                )}
              </div>
              <Badge state={s.state} />
            </li>
          ))}
        </ul>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Branche douane</h2>
          <p className="text-xs text-slate-600">
            {state.branches.customs.completed.length} terminée(s) ·{" "}
            {state.branches.customs.active.length} active(s) ·{" "}
            {state.branches.customs.blocked.length} bloquée(s)
          </p>
          <p className="mt-1 text-xs font-medium text-slate-700">
            {state.branches.customs.complete ? "Branche terminée" : "En cours"}
          </p>
        </section>
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Branche préparation transport</h2>
          <p className="text-xs text-slate-600">
            {state.branches.transportReadiness.completed.length} terminée(s) ·{" "}
            {state.branches.transportReadiness.active.length} active(s) ·{" "}
            {state.branches.transportReadiness.blocked.length} bloquée(s)
          </p>
          <p className="mt-1 text-xs font-medium text-slate-700">
            {state.branches.transportReadiness.complete ? "Branche terminée" : "En cours"}
          </p>
        </section>
      </div>

      <Gate title="Convergence enlèvement" gate={state.pickupReadiness} />
      <Gate title="Prêt à facturer" gate={state.billingReadiness} />
      <Gate title="Prêt à clôturer" gate={state.closureReadiness} />

      {state.correctionState.length > 0 && (
        <section className="rounded-lg border border-red-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Boucle de correction</h2>
          <ul className="space-y-1 text-sm">
            {state.correctionState.map((c) => (
              <li key={c.stepKey} className="text-slate-700">
                <strong>{c.stepKey}</strong> — motif du rejet : {c.reason ?? "—"}
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.pendingHandoff && (
        <section className="rounded-lg border border-amber-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-900">Transfert en attente de réception</h2>
          <p className="text-sm text-slate-700">
            {state.pendingHandoff.fromStepKey} → {state.pendingHandoff.toStepKey}
          </p>
        </section>
      )}
    </main>
  );
}
