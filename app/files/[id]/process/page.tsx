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
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { getProcessState } from "@/lib/process/engine/service";
import { getIntakeState, listEligibleOperationsOwners, type EligibleOwner, type IntakeState } from "@/lib/process/engine/intake-actions";
import { IntakePanel } from "@/components/process/intake-panel";
import { evaluateTransitHandoffReadiness } from "@/lib/process/intake";
import { getTransitState, listEligibleTransitAssignees, type TransitAssignee, type TransitState } from "@/lib/process/engine/transit-actions";
import { TransitPanel } from "@/components/process/transit-panel";
import { getFinanceState, type FinanceState } from "@/lib/finance/request-actions";
import { FinancePanel } from "@/components/process/finance-panel";
import { StepActions } from "@/components/process/step-actions";
import { evaluateStepAction } from "@/lib/process/step-eligibility";
import { queueForStep } from "@/lib/process/queues/registry";
import { custodyStateFor, maySendRoute, routeFor, type CustodyState, type RouteHandoffView } from "@/lib/process/handoff-routes";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";

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

/**
 * The badge says where the step actually stands, custody included. An AVAILABLE
 * step that Operations has not transmitted — or that Transit has not accepted —
 * used to read as raw « AVAILABLE » next to a sentence saying the transfer must
 * be received first. Same facts as `custodyRefusal`, so the badge and the action
 * row cannot disagree.
 */
const CUSTODY_BADGE: Record<string, { label: string; tone: string }> = {
  awaiting_transmission: { label: "À transmettre", tone: "bg-amber-50 text-amber-800 border-amber-200" },
  awaiting_reception: { label: "En attente de réception", tone: "bg-amber-50 text-amber-800 border-amber-200" },
};

function Badge({ state, custody }: { state: string; custody?: CustodyState }) {
  const c = state === "AVAILABLE" && custody ? CUSTODY_BADGE[custody] : undefined;
  if (c) {
    return (
      <span className={`rounded border px-2 py-0.5 text-xs font-medium ${c.tone}`}>{c.label}</span>
    );
  }
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
  if (!globalKillSwitch().enabled) notFound();

  const user = await requireUser();
  const tenantFlags = await getTenantProcessFlags(user.tenantId);
  if (!tenantFlags.enabled) notFound();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "process:read")) notFound();

  const state = await getProcessState(params.id);

  // Two facts the action rows need, read once and only when there is something
  // to render. Neither decides authority — `activateStep`/`submitStep` re-check
  // everything — they decide what the page may honestly OFFER and SAY.
  //
  //  * every step with an outstanding (SENT) handoff addressed to it. The read
  //    model exposes only the first such handoff, and offering work on a second
  //    one would reproduce exactly the "UI says ready, server refuses" defect.
  //  * the display name of whoever holds a claimed step, so an absent button is
  //    legible as « someone else has this » rather than as a broken page.
  const pendingHandoffTargets = new Set<string>();
  const handoffViews: RouteHandoffView[] = [];
  const assigneeNames = new Map<string, string>();
  if (state) {
    const admin = getAdminSupabaseClient();
    const claimedIds = [
      ...new Set(state.activeSteps.map((s) => s.assignedUserId).filter((v): v is string => !!v)),
    ];
    const [handoffRows, userRows] = await Promise.all([
      admin
        .from("process_handoff")
        .select("to_step_key, status")
        .eq("tenant_id", user.tenantId)
        .in("status", ["SENT", "RECEIVED"])
        .in("to_step_key", state.activeSteps.map((s) => s.stepKey)),
      claimedIds.length
        ? admin
            .from("app_user")
            .select("id, full_name, email")
            .eq("tenant_id", user.tenantId)
            .in("id", claimedIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
    ]);
    for (const h of (handoffRows.data ?? []) as { to_step_key: string; status: string }[]) {
      handoffViews.push({ toStepKey: h.to_step_key, status: h.status });
      if (h.status === "SENT") pendingHandoffTargets.add(h.to_step_key);
    }
    for (const u of (userRows.data ?? []) as { id: string; full_name: string | null; email: string }[]) {
      assigneeNames.set(u.id, u.full_name || u.email);
    }
  }

  // Phase 9.0C — the Operations intake panel. Only when the intake flag is on;
  // getIntakeState degrades to null (panel hidden) if the 9.0B structures are
  // absent from the database, so nothing here can break the inspector.
  let intake: IntakeState | null = null;
  let eligibleOwners: EligibleOwner[] = [];
  const canOpen = hasPermission(permissions, "process:manage") && hasPermission(permissions, "process:owner:assign");
  if (tenantFlags.intake) {
    intake = await getIntakeState(params.id);
    if (intake && canOpen && !intake.owner) eligibleOwners = await listEligibleOperationsOwners();
  }
  // ONE evaluator, both surfaces. The dossier page computes this identically —
  // a screen may never be more permissive than `handDossierToTransit`, and the
  // UAT that produced this wiring failed because this screen had no opinion at
  // all and simply offered the button.
  const handoffReadiness = intake
    ? evaluateTransitHandoffReadiness({
        hasInstance: intake.hasInstance,
        hasOwner: intake.owner !== null,
        openBlockers: intake.openBlockers,
        amOpeningDone: intake.amOpeningDone,
        steps: intake.steps,
      })
    : null;
  const intakePanel = intake ? (
    <IntakePanel
      fileId={params.id}
      state={intake}
      eligibleOwners={eligibleOwners}
      canOpen={canOpen}
      canHandoff={
        hasPermission(permissions, "process:handoff:send") &&
        maySendRoute(routeFor("am_dossier_opening", "coordinator_reception"), user.roles ?? [])
      }
      canManageBlockers={hasPermission(permissions, "process:blocker:manage")}
      handoffPrerequisites={handoffReadiness?.unmet ?? []}
      handoffFirstActionable={handoffReadiness?.firstActionable ?? null}
    />
  ) : null;

  // Phase 9.0D — the Transit execution panel. Same discipline as intake:
  // getTransitState degrades to null (panel hidden) when the 9.0B structures /
  // the process instance are absent, so nothing here can break the inspector.
  let transit: TransitState | null = null;
  let eligibleDeclarants: TransitAssignee[] = [];
  const canAssignTransit = hasPermission(permissions, "customs:assign");
  if (tenantFlags.transitExecution) {
    transit = await getTransitState(params.id);
    if (transit && canAssignTransit && !transit.declarant) {
      eligibleDeclarants = await listEligibleTransitAssignees("CUSTOMS_DECLARANT");
    }
  }
  const transitPanel = transit ? (
    <TransitPanel
      fileId={params.id}
      state={transit}
      eligibleDeclarants={eligibleDeclarants}
      canReceive={hasPermission(permissions, "process:handoff:receive")}
      canAssign={canAssignTransit}
      canRequestDecision={hasPermission(permissions, "process:decision:create")}
      canApproveDecision={hasPermission(permissions, "process:decision:approve")}
      canRecordBae={hasPermission(permissions, "customs:release")}
      canReleaseTransit={hasPermission(permissions, "customs:validate")}
      canDispatch={hasPermission(permissions, "process:team:manage")}
      canManageBlockers={hasPermission(permissions, "process:blocker:manage")}
    />
  ) : null;

  // Phase 9.0E — the Finance execution panel. Same discipline: getFinanceState
  // degrades to null (panel hidden) when the finance_request migration is
  // absent, so nothing here can break the inspector.
  let finance: FinanceState | null = null;
  if (tenantFlags.financeExecution) {
    finance = await getFinanceState(params.id);
  }
  const financePanel = finance ? (
    <FinancePanel
      fileId={params.id}
      state={finance}
      canRequest={hasPermission(permissions, "process:decision:create")}
      canReview={hasPermission(permissions, "finance:validate")}
      canDisburse={hasPermission(permissions, "finance:payment")}
      canAttach={hasPermission(permissions, "finance:update")}
      canVerify={hasPermission(permissions, "finance:void")}
      canBill={hasPermission(permissions, "finance:create")}
      canClear={hasPermission(permissions, "finance:validate")}
    />
  ) : null;

  // LEGACY DOSSIER (Deliverable 13). No process instance exists. We do NOT create
  // one as a side effect of rendering — initialization is an explicit, authorized
  // act, and no prior step is ever marked completed.
  if (!state) {
    const canInit = hasPermission(permissions, "process:manage");
    return (
      <main className="mx-auto max-w-4xl p-6">
        <Link href={`/files/${params.id}`} className="text-sm text-blue-600 hover:underline">
          ← Retour au dossier
        </Link>
        <h1 className="mt-2 text-lg font-semibold text-slate-900">Processus officiel Effitrans</h1>

        {/* Phase 9.0C — a dossier without an instance is exactly where opening starts. */}
        {intakePanel && <div className="mt-4">{intakePanel}</div>}

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-900">Processus officiel non initialisé</p>
          <p className="mt-1 text-sm text-slate-600">
            Ce dossier est antérieur au moteur de processus. Aucune étape officielle n&apos;a jamais été
            tracée pour lui : la plateforme n&apos;a pas capturé les réceptions, validations et transferts
            du processus officiel. Rien n&apos;est initialisé automatiquement, et aucune étape passée ne
            sera marquée comme terminée.
          </p>
          {canInit ? (
            <p className="mt-3 text-xs text-slate-500">
              Un rattachement manuel est possible (rapport de simulation d&apos;abord). Les étapes
              antérieures seront marquées <strong>non vérifiées</strong>, jamais terminées.
            </p>
          ) : (
            <p className="mt-3 text-xs text-slate-500">
              Vous n&apos;avez pas le droit d&apos;initialiser un processus sur ce dossier.
            </p>
          )}
        </div>
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

      {intakePanel}
      {transitPanel}
      {financePanel}

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
          {state.activeSteps.map((s) => {
            // ONE eligibility derivation, shared with /queues/[queueKey]. The
            // page never re-implements the conditions; it reads the same
            // function on the same facts, so the two surfaces cannot disagree.
            const queueKey = queueForStep(s.stepKey);
            const eligibility = evaluateStepAction(
              {
                stepKey: s.stepKey,
                state: s.state,
                assignedUserId: s.assignedUserId,
                // The engine refuses `handoff_reception_required` while a
                // handoff addressed to this step is still SENT, so the page must
                // not offer work before the receiving department accepts it.
                awaitingReception: pendingHandoffTargets.has(s.stepKey),
                blockedReason:
                  s.missingPrerequisites.length > 0
                    ? `Prérequis manquants : ${s.missingPrerequisites.join(", ")}`
                    : null,
              },
              { userId: user.id, permissions },
            );
            return (
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
                <div className="flex flex-col items-end gap-1">
                  <Badge state={s.state} custody={custodyStateFor(s.stepKey, handoffViews)} />
                  {queueKey && (
                    <StepActions
                      fileId={params.id}
                      queueKey={queueKey}
                      stepKey={s.stepKey}
                      eligibility={eligibility}
                      assigneeLabel={
                        s.assignedUserId
                          ? assigneeNames.get(s.assignedUserId) ?? "une autre personne"
                          : null
                      }
                    />
                  )}
                </div>
              </li>
            );
          })}
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
