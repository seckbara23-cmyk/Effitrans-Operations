"use client";

/**
 * Customs panel embedded on a dossier (Phase 1.9). Client component — status +
 * workflow buttons, editable manual-reference metadata, and the missing-docs
 * warning. Invokes server-action proxies only.
 */
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { stepGateMessageFr } from "@/lib/process/control-gate";
import { nextStatuses } from "@/lib/customs/status";
import {
  changeCustomsStatus,
  createCustoms,
  deleteCustoms,
  recordCustomsAttachment,
  recordCustomsValidation,
  recordGaindeRegistration,
  recordReceivability,
  recordBaeReference,
  releaseCustoms,
  updateCustoms,
} from "@/lib/customs/actions";
import {
  isReceivabilityOutcome,
  reasonRequired,
  RECEIVABILITY_LABELS_FR,
  RECEIVABILITY_OUTCOMES,
  type ReceivabilityOutcome,
} from "@/lib/customs/receivability";
import { GovernedCustomsFields } from "./governed-fields";
import type { ActionResult, CustomsRecord, MissingCustomsDoc } from "@/lib/customs/types";

/**
 * Which control a failure belongs to. A closed union on purpose: a typo cannot
 * silently address a scope nothing renders, which would hide the message
 * entirely — the failure mode this whole change exists to end.
 */
type ErrorScope =
  | "create"
  | "workflow"
  | "gainde"
  | "attachment"
  | "validation"
  | "receivability"
  | "metadata";

type PanelError = { scope: ErrorScope; message: string };

/**
 * The message, rendered ONLY under the control that produced it.
 *
 * `role="alert"` is the accessibility half of this fix and the more serious one:
 * the panel had no aria-live, no role and no focus move, so a screen-reader user
 * got nothing at all when an action was refused.
 */
/**
 * Why an owned control is not actionable YET, in the process's own words.
 *
 * OPS-CUSTOMS-OWNERSHIP-01. The refusal already existed server-side and reached
 * the operator as « L'action a échoué. Veuillez réessayer. » — a sentence that
 * says nothing and invites a retry that cannot succeed. The Déclarant on the UAT
 * dossier was told exactly that when attaching GAINDE/ORBUS, because the
 * attachment belongs to step 11 and the dossier was on step 6.
 */
function GateHint({ reason }: { reason: string | null }) {
  if (!reason) return null;
  return <p className="mt-1 text-[11px] text-amber-700">{reason}</p>;
}

function ErrorLine({ error, scope }: { error: PanelError | null; scope: ErrorScope }) {
  if (!error || error.scope !== scope) return null;
  return <p role="alert" className="text-xs text-red-600">{error.message}</p>;
}

const STATUS_STYLE: Record<string, string> = {
  NOT_STARTED: "bg-slate-100 text-slate-600",
  DOCUMENTS_PENDING: "bg-slate-100 text-slate-600",
  DECLARATION_PREPARED: "bg-sky-50 text-sky-700",
  DECLARED: "bg-sky-50 text-sky-700",
  UNDER_REVIEW: "bg-amber-50 text-amber-700",
  INSPECTION: "bg-amber-50 text-amber-700",
  DUTIES_ASSESSED: "bg-amber-50 text-amber-700",
  RELEASED: "bg-teal-50 text-teal-700",
  BLOCKED: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-400 line-through",
};

/** Refusal reads as a warning, never as a failure of the dossier. */
const RECEIVABILITY_STYLE: Record<ReceivabilityOutcome, string> = {
  RECEVABLE: "bg-teal-50 text-teal-700",
  NON_RECEVABLE: "bg-red-50 text-red-700",
  SOUS_RESERVE: "bg-amber-50 text-amber-700",
};

/** MAYA-P1.11 — the two systems Effitrans named, and both together. */
const ATTACHMENT_SYSTEM_SETS: string[][] = [["GAINDE"], ["ORBUS"], ["GAINDE", "ORBUS"]];

const REGIMES = [
  "Mise à la consommation",
  "Exportation",
  "Transit",
  "Admission temporaire",
  "Entrepôt",
  "Réexportation",
];

export function CustomsPanel({
  fileId,
  record,
  missing,
  canCreate,
  canUpdate,
  canRelease,
  canDelete,
  canValidate,
  canRegisterGainde,
  canAttach,
  gates,
  canCorrect,
  canRevalidate,
  awaitingRevalidation,
}: {
  fileId: string;
  record: CustomsRecord | null;
  missing: MissingCustomsDoc[];
  canCreate: boolean;
  canUpdate: boolean;
  canRelease: boolean;
  canDelete: boolean;
  canValidate: boolean;
  canRegisterGainde: boolean;
  canAttach: boolean;
  /**
   * OPS-CUSTOMS-OWNERSHIP-01 — the SERVER's verdict per control. The panel does
   * not re-derive authority from permissions; it renders what the actions would
   * decide, so a drawn control and a refused request cannot disagree.
   */
  gates: Record<string, { allowed: boolean; reasonCode: string | null; reasonFr: string | null; isOwner: boolean }>;
  /** D4 — may open the governed correction door on certified data. */
  canCorrect: boolean;
  /** D4 — may recertify after a correction (never one's own). */
  canRevalidate: boolean;
  /** D4 — corrected and not yet recertified. */
  awaitingRevalidation: boolean;
}) {
  /**
   * Is this control DRAWN for this viewer? Permission says the role has
   * business with it at all; ownership says this particular work is theirs.
   * A Chef de Transit reading a Déclarant's preparation gets the data and no
   * buttons — the controls would never be theirs, so drawing them is noise.
   */
  const owns = (controlId: string) => gates[controlId]?.isOwner ?? true;
  /** Enabled only when the server would allow it right now. */
  const gateOpen = (controlId: string) => gates[controlId]?.allowed ?? true;
  /** The exact process reason, for a control drawn but not yet actionable. */
  const gateReason = (controlId: string) => gates[controlId]?.reasonFr ?? null;

  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // SCOPED, not global. One `error` string served nine actions and was rendered
  // once, at the very bottom of the panel — immediately below the metadata form's
  // save button. That made the placement correct for exactly ONE action and, for
  // the other eight, put the message beside an UNRELATED control: a refusal from
  // « → Déclaré » read as "saving the metadata failed". The panel simply grew
  // past its own error line as each phase appended a section above it.
  const [error, setError] = useState<PanelError | null>(null);
  // Race guard. `startTransition` is not cancellable, so a slow action's rejection
  // could land after the user had moved on and attach itself to a newer
  // interaction. Every run takes a ticket; a stale result is discarded rather
  // than shown under the wrong control.
  const runSeq = useRef(0);
  const c = t.customs;

  function run(fn: () => Promise<ActionResult>, scope: ErrorScope) {
    const seq = ++runSeq.current;
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (seq !== runSeq.current) return; // superseded — never speak for a newer action
      if (!res.ok) {
        const map = c.errors as Record<string, string>;
        // OPS-CUSTOMS-OWNERSHIP-01 — a process-gate refusal explains itself.
        // These codes had no entry here, so every one of them degraded to
        // « L'action a échoué », telling the operator nothing about a decision
        // the platform could state precisely. Resolved through the gate's own
        // vocabulary so the hint before the click and the message after it are
        // the same sentence.
        const message = stepGateMessageFr(res.error) ?? map[res.error] ?? c.errors.generic;
        setError({ scope, message });
        return;
      }
      router.refresh();
    });
  }

  const header = (
    <div className="flex items-center justify-between">
      <h2 className="text-sm font-semibold text-navy-900">{c.panelTitle}</h2>
    </div>
  );

  if (!record) {
    return (
      <section className="space-y-3">
        {header}
        <div className="surface flex items-center justify-between p-4 text-sm text-slate-500">
          <span>{c.empty}</span>
          {canCreate && owns("customs.create") && (
            <button
              onClick={() => run(() => createCustoms(fileId), "create")}
              disabled={pending || !gateOpen("customs.create")}
              className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
            >
              {c.start}
            </button>
          )}
        </div>
        <ErrorLine error={error} scope="create" />
      </section>
    );
  }

  const targets = nextStatuses(record.status);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() =>
      updateCustoms(record!.id, {
        declarationNumber: String(fd.get("declarationNumber") ?? ""),
        customsOffice: String(fd.get("customsOffice") ?? ""),
        regime: String(fd.get("regime") ?? ""),
        declarationDate: String(fd.get("declarationDate") ?? "") || null,
        inspectionStatus: fd.get("inspectionStatus") as CustomsRecord["inspectionStatus"],
        externalRef: String(fd.get("externalRef") ?? ""),
        notes: String(fd.get("notes") ?? ""),
        required: fd.get("required") === "on",
      }),
      "metadata",
    );
  }

  return (
    <section className="space-y-3">
      {header}

      <div className="surface space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[record.status]}`}>
            {c.statuses[record.status]}
          </span>
          <span className="text-xs text-slate-500">
            {record.required ? c.required : c.optional}
          </span>
          {record.baeReference && (
            <span className="ml-auto text-xs text-teal-700">
              {c.fields.bae}: <span className="tabular font-medium">{record.baeReference}</span>
            </span>
          )}
        </div>

        {missing.length > 0 && record.status !== "RELEASED" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
            <span className="font-semibold">{c.missingTitle}:</span> {missing.map((m) => m.label).join(", ")}
          </div>
        )}

        {record.baeReference && record.status !== "RELEASED" && (
          <p className={record.releaseApprovalStatus === "REJECTED" ? "text-xs text-rose-700" : "text-xs text-amber-700"}>
            {record.releaseApprovalStatus === "REJECTED"
              ? `${c.baeRejected}${record.releaseApprovalNote ? ` ${record.releaseApprovalNote}` : ""}`
              : c.baePendingVerification}
          </p>
        )}

        {/* Workflow actions */}
        {/* UI-9 — this block mixes two different owners: the status ladder
            belongs to the Déclarant's step 6, the BAE/mainlevée belongs to the
            field agent's step 13. Scoping the whole block on `customs.status`
            hid the BAE button from the only role that may press it, because
            step 6 is by then completed and assigned to somebody else. Each
            control is now drawn on ITS OWN verdict. */}
        {((canUpdate && owns("customs.status")) ||
          (canRelease && owns("customs.bae")) ||
          canDelete) && targets.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {targets.map((s) => {
              if (s === "RELEASED") {
                // TRANSIT-CUSTODY-05 — one button, two different acts, never
                // conflated. Until the Chef de Transit has verified the
                // mainlevée this control RECORDS it and opens that
                // verification; the release itself is refused server-side, so
                // offering it here would only produce a failure.
                const verified = record.releaseApprovalStatus === "APPROVED";
                const releaseControl = verified ? "customs.release" : "customs.bae";
                return canRelease && owns("customs.bae") ? (
                  <button
                    key={s}
                    onClick={() => {
                      if (verified) {
                        const bae = window.prompt(c.baePrompt);
                        if (bae && bae.trim()) run(() => releaseCustoms(record.id, bae.trim()), "workflow");
                        return;
                      }
                      const bae = window.prompt(c.baeRecordPrompt, record.baeReference ?? "");
                      if (bae && bae.trim()) run(() => recordBaeReference(record.id, bae.trim()), "workflow");
                    }}
                    disabled={pending || !gateOpen(releaseControl)}
                    className="rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
                  >
                    {verified ? c.release : c.recordBae}
                  </button>
                ) : null;
              }
              if (!canUpdate || !owns("customs.status")) return null;
              const label = s === "BLOCKED" ? c.block : s === "CANCELLED" ? c.cancel : `→ ${c.statuses[s]}`;
              return (
                <button
                  key={s}
                  onClick={() => run(() => changeCustomsStatus(record.id, s), "workflow")}
                  disabled={pending || !gateOpen("customs.status")}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {label}
                </button>
              );
            })}
            {canDelete && (
              <button
                onClick={() => run(() => deleteCustoms(record.id), "workflow")}
                disabled={pending}
                className="ml-auto rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              >
                {c.cancel}
              </button>
            )}
          </div>
        )}
        {canUpdate && owns("customs.status") && <GateHint reason={gateReason("customs.status")} />}
        {canRelease && owns("customs.bae") && <GateHint reason={gateReason("customs.bae")} />}
        <ErrorLine error={error} scope="workflow" />

        {/* MAYA-P1.1 — CEO step 8 : enregistrement GAINDE par la Finance.
            A FINANCE act, gated on customs:register — the narrow capability the
            permission catalog already names for it. It is a typed record, never
            a synchronisation: the hint says so, and QC4 keeps reporting the
            provenance as manual. */}
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-navy-900">{c.gainde.title}</h3>
            {record.gaindeRegisteredAt ? (
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                {c.gainde.registeredOn} {new Date(record.gaindeRegisteredAt).toLocaleDateString("fr-FR")}
                {record.gaindeRegisteredByEmail ? ` ${c.gainde.by} ${record.gaindeRegisteredByEmail}` : ""}
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {c.gainde.notRegistered}
              </span>
            )}
          </div>
          {record.externalRef && (
            <p className="mt-1 text-[11px] text-slate-600">
              {c.fields.externalRef} : <span className="tabular font-medium">{record.externalRef}</span>
            </p>
          )}
          {canRegisterGainde && owns("customs.gainde_registration") && (
            <button
              onClick={() => {
                const ref = window.prompt(c.gainde.prompt, record.externalRef ?? "");
                if (ref && ref.trim()) run(() => recordGaindeRegistration(record.id, ref.trim()), "gainde");
              }}
              disabled={pending || !gateOpen("customs.gainde_registration")}
              className="mt-2 rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
            >
              {c.gainde.action}
            </button>
          )}
          {/* UI-6 — this control alone ignored its own step gate and offered no
              explanation: the Finance officer could press it on a dossier the
              process had not brought to step 9, and read « L'action a échoué ».
              Its attachment sibling has behaved correctly since P1.11. */}
          {canRegisterGainde && owns("customs.gainde_registration") && (
            <GateHint reason={gateReason("customs.gainde_registration")} />
          )}
          <p className="mt-2 text-[11px] text-slate-400">{c.gainde.hint}</p>
          <ErrorLine error={error} scope="gainde" />
        </div>

        {/* MAYA-P1.11 — CEO step 9 : rattachement par le Déclarant.
            Effitrans a ratifié l'acte : le Déclarant scanne et rattache
            lui-même les documents dans GAINDE / ORBUS, sans synchronisation
            automatique. On enregistre qu'il l'a fait — jamais qu'on l'a
            vérifié. Réenregistrer est la voie de reprise prévue après un rejet
            à la recevabilité, donc rien ne l'interdit. */}
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-navy-900">{c.attachment.title}</h3>
            {record.attachmentCompletedAt ? (
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                {c.attachment.doneOn} {new Date(record.attachmentCompletedAt).toLocaleDateString("fr-FR")}
                {record.attachmentCompletedByEmail ? ` ${c.attachment.by} ${record.attachmentCompletedByEmail}` : ""}
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {c.attachment.notDone}
              </span>
            )}
          </div>
          {record.attachmentSystems.length > 0 && (
            <p className="mt-1 text-[11px] text-slate-600">
              {c.attachment.systems} : <span className="font-medium">{record.attachmentSystems.join(" · ")}</span>
            </p>
          )}
          {canAttach && owns("customs.attachment") && (
            <div className="mt-2 flex flex-wrap gap-2">
              {ATTACHMENT_SYSTEM_SETS.map((set) => (
                <button
                  key={set.join("+")}
                  onClick={() => run(() => recordCustomsAttachment(record.id, set), "attachment")}
                  disabled={pending || !gateOpen("customs.attachment")}
                  className="rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
                >
                  {record.attachmentCompletedAt ? `${c.attachment.action} — ` : ""}{set.join(" + ")}
                </button>
              ))}
            </div>
          )}
          {canAttach && owns("customs.attachment") && <GateHint reason={gateReason("customs.attachment")} />}
          <p className="mt-2 text-[11px] text-slate-400">{c.attachment.hint}</p>
          <ErrorLine error={error} scope="attachment" />
        </div>

        {/* MAYA-P0.8-A (PG-1) — validation Chef de Transit.
            A CHECKER control, distinct from preparation. The action is offered
            only to a holder of customs:validate, and the SERVER and the
            DATABASE both refuse a preparer validating their own record — the
            button is never the security boundary. */}
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-navy-900">{c.validation.title}</h3>
            {record.reviewedAt ? (
              <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                {c.validation.validatedOn} {new Date(record.reviewedAt).toLocaleDateString("fr-FR")}
                {record.reviewedByEmail ? ` ${c.validation.by} ${record.reviewedByEmail}` : ""}
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {c.validation.notValidated}
              </span>
            )}
          </div>
          {canValidate && owns("customs.validation") && !record.reviewedAt && (
            <button
              onClick={() => run(() => recordCustomsValidation(record.id), "validation")}
              disabled={pending || !gateOpen("customs.validation")}
              className="mt-2 rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
            >
              {c.validation.action}
            </button>
          )}
          {canValidate && owns("customs.validation") && !record.reviewedAt && (
            <GateHint reason={gateReason("customs.validation")} />
          )}
          <p className="mt-2 text-[11px] text-slate-400">{c.validation.hint}</p>
          <ErrorLine error={error} scope="validation" />
        </div>

        {/* MAYA-P0.7-A — Contrôle Qualité N°3 : recevabilité.
            A RECORDED DECISION, not a gate. Nothing on this dossier behaves
            differently because of what is chosen here; the control exists so
            that the declarant's judgement is attributable and dated. The
            criteria are deliberately absent — the Quality Manual names the
            control, not the checklist. */}
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-navy-900">{c.receivability.title}</h3>
            {record.receivabilityStatus && isReceivabilityOutcome(record.receivabilityStatus) ? (
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RECEIVABILITY_STYLE[record.receivabilityStatus]}`}>
                {RECEIVABILITY_LABELS_FR[record.receivabilityStatus]}
              </span>
            ) : (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {c.receivability.notAssessed}
              </span>
            )}
          </div>
          {record.receivabilityAt && (
            <p className="mt-1 text-[11px] text-slate-500">
              {c.receivability.decidedOn} {new Date(record.receivabilityAt).toLocaleDateString("fr-FR")}
              {record.receivabilityNote ? ` — ${record.receivabilityNote}` : ""}
            </p>
          )}
          {/* UI-4 — recevabilité is Contrôle Qualité N°3, the DÉCLARANT's own
              judgement. It was drawn for every `customs:update` holder, so a
              Chef de Transit was offered the maker decision he is supposed to
              be checking. Ownership decides whether it is drawn; the step gate
              decides whether it is pressable. */}
          {canUpdate && owns("customs.receivability") && (
            <div className="mt-2 flex flex-wrap gap-2">
              {RECEIVABILITY_OUTCOMES.map((o) => (
                <button
                  key={o}
                  onClick={() => {
                    // A reason is mandatory for everything but a clean
                    // acceptance; an empty prompt aborts rather than recording
                    // a refusal nobody can explain.
                    if (reasonRequired(o)) {
                      const reason = window.prompt(c.receivability.reasonPrompt);
                      if (!reason || !reason.trim()) return;
                      run(() => recordReceivability(record.id, o, reason.trim()), "receivability");
                      return;
                    }
                    run(() => recordReceivability(record.id, o, null), "receivability");
                  }}
                  disabled={pending || !gateOpen("customs.receivability")}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {RECEIVABILITY_LABELS_FR[o]}
                </button>
              ))}
            </div>
          )}
          {canUpdate && owns("customs.receivability") && (
            <GateHint reason={gateReason("customs.receivability")} />
          )}
          <p className="mt-2 text-[11px] text-slate-400">{c.receivability.hint}</p>
          <ErrorLine error={error} scope="receivability" />
        </div>

        {/* D4 — the five governed elements, their certification state and the
            correction door. Above the free-text metadata deliberately: these
            are the facts a chef de transit certifies, not references anyone may
            retype. */}
        {/* UI-2 / UI-5 — the five governed elements are the Déclarant's entry
            and the Chef de Transit's certification target. Editing them was
            offered to any `customs:update` holder, which meant the checker
            could rewrite the very facts he then certified. With ownership
            withheld the component falls to its own read-only rendering, which
            is exactly what UI-5 asks for: the Chef reads them, he does not
            retype them. */}
        <GovernedCustomsFields
          record={record}
          canUpdate={canUpdate && owns("customs.update")}
          canCorrect={canCorrect}
          canRevalidate={canRevalidate}
          awaitingRevalidation={awaitingRevalidation}
        />

        {/* Editable manual-reference metadata */}
        {/* UI-3 / UI-5 — the declaration metadata is step-6 maker data. It was
            editable by every `customs:update` holder; it is now editable only
            by the owner of step 6, and READABLE by everyone the panel is drawn
            for. Hiding it from the Chef instead of freezing it would have taken
            away the information he needs in order to validate at step 7. */}
        {canUpdate && owns("customs.update") ? (
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label={c.fields.declarationNumber} name="declarationNumber" defaultValue={record.declarationNumber} />
            <Field label={c.fields.customsOffice} name="customsOffice" defaultValue={record.customsOffice} />
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              {c.fields.regime}
              <input
                name="regime"
                list="customs-regimes"
                defaultValue={record.regime ?? ""}
                className="rounded-md border border-slate-200 px-2 py-1 text-sm"
              />
              <datalist id="customs-regimes">
                {REGIMES.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </label>
            <Field label={c.fields.declarationDate} name="declarationDate" type="date" defaultValue={record.declarationDate} />
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              {c.fields.inspection}
              <select
                name="inspectionStatus"
                defaultValue={record.inspectionStatus}
                className="rounded-md border border-slate-200 px-2 py-1 text-sm"
              >
                {(["NOT_REQUIRED", "PENDING", "PASSED", "FAILED"] as const).map((s) => (
                  <option key={s} value={s}>
                    {c.inspection[s]}
                  </option>
                ))}
              </select>
            </label>
            <Field label={c.fields.externalRef} name="externalRef" defaultValue={record.externalRef} />
            <label className="flex flex-col gap-1 text-xs text-slate-600 sm:col-span-2">
              {c.fields.notes}
              <textarea
                name="notes"
                defaultValue={record.notes ?? ""}
                rows={2}
                className="rounded-md border border-slate-200 px-2 py-1 text-sm"
              />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" name="required" defaultChecked={record.required} />
              {c.required}
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={pending || !gateOpen("customs.update")}
                className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
              >
                {pending ? c.saving : c.save}
              </button>
            </div>
          </form>
        ) : (
          <ReadOnlyMetadata record={record} />
        )}

        <ErrorLine error={error} scope="metadata" />
      </div>
    </section>
  );
}

/**
 * UI-5 — the declaration metadata as a READER sees it.
 *
 * Everyone the panel is drawn for already sees the status, the BAE reference,
 * the GAINDE reference, the attachment systems, the recevabilité verdict and the
 * validation state. Withholding the declaration number and the bureau from the
 * Chef de Transit would leave him certifying facts the screen refused to show
 * him — so the maker's form becomes the checker's summary rather than
 * disappearing. Nothing here is actionable, and « — » says "not captured"
 * rather than rendering an empty row that reads as a broken page.
 */
function ReadOnlyMetadata({ record }: { record: CustomsRecord }) {
  const c = t.customs;
  const rows: [string, string | null][] = [
    [c.fields.declarationNumber, record.declarationNumber],
    [c.fields.customsOffice, record.customsOffice],
    [c.fields.regime, record.regime],
    [c.fields.declarationDate, record.declarationDate],
    [c.fields.inspection, c.inspection[record.inspectionStatus]],
    [c.fields.externalRef, record.externalRef],
    [c.fields.notes, record.notes],
  ];
  return (
    <dl className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3 border-b border-slate-100 py-1 text-xs">
          <dt className="shrink-0 text-slate-500">{label}</dt>
          <dd className="text-right font-medium text-navy-900">
            {value && value.trim() ? value : "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue: string | null;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-600">
      {label}
      <input
        type={type}
        name={name}
        defaultValue={defaultValue ?? ""}
        className="rounded-md border border-slate-200 px-2 py-1 text-sm"
      />
    </label>
  );
}
