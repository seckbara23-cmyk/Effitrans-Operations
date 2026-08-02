"use client";

/**
 * EC-3C — the quotation detail workspace.
 *
 * DO NOT EXPOSE ACTIONS USERS CANNOT PERFORM. Every panel below is rendered
 * from a capability computed by `lib/commercial/queues.ts`, which mirrors the
 * gate in the server action and, for validation, the database CHECK. The UI is
 * the third statement of each rule and the only one that is not load-bearing:
 * if it ever disagrees with the action, the action wins and the user sees an
 * error rather than a silent success.
 *
 * MONEY IS ENTERED AS TEXT AND PARSED TO INTEGER MINOR UNITS by the server
 * action. No float arithmetic happens here — the preview totals are computed
 * with the same integer helpers the PDF and the server use.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setQuotationLines, submitQuotation, validateQuotation, sendQuotation,
  recordCustomerDecision, reviseQuotation, cancelQuotation,
} from "@/lib/commercial/actions";
import { emailQuotationToCustomer, quotationArtifactUrl } from "@/lib/commercial/send";
// Pure modules only — a client component must never reach into service.ts,
// which is `server-only`. `model` holds the vocabulary, `money` the integer
// arithmetic the server and the PDF also use.
import { ACCEPTANCE_KINDS, ACCEPTANCE_KIND_FR, type AcceptanceKind } from "@/lib/commercial/model";
import {
  parseQuantityMilli, parseAmountMinor, parseRateBp,
  quotationTotals, formatAmountMinor,
} from "@/lib/commercial/money";

type Caps = {
  editLines: boolean; submit: boolean; validate: boolean; send: boolean;
  recordDecision: boolean; revise: boolean; cancel: boolean;
};

type LineDraft = { description: string; quantity: string; unitAmount: string; taxRate: string };

export function QuotationStudio({
  quotationId, currency, caps, initialLines, validationBlocked, hasArtifact,
}: {
  quotationId: string;
  currency: string;
  caps: Caps;
  initialLines: LineDraft[];
  validationBlocked: string | null;
  hasArtifact: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lines, setLines] = useState<LineDraft[]>(
    initialLines.length > 0 ? initialLines : [{ description: "", quantity: "1", unitAmount: "", taxRate: "0" }],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setError(null); setMessage(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) { setError(ERRORS[r.error ?? ""] ?? "Opération refusée."); return; }
      setMessage(okText);
      router.refresh();
    });
  }

  // Preview totals — integer minor units, same helpers as the server and the PDF.
  const preview = quotationTotals(
    lines.map((l) => ({
      quantityMilli: parseQuantityMilli(l.quantity) ?? 0,
      unitAmountMinor: parseAmountMinor(l.unitAmount) ?? 0,
      taxRateBp: parseRateBp(l.taxRate) ?? 0,
    })),
  );

  return (
    <div className="space-y-5">
      {message ? <p className="surface p-3 text-sm text-teal-800">{message}</p> : null}
      {error ? <p className="surface p-3 text-sm text-rose-700">{error}</p> : null}

      {caps.editLines ? (
        <section className="surface p-5">
          <h2 className="mb-3 text-base font-semibold text-navy-900">Lignes de la cotation</h2>
          <div className="space-y-3">
            {lines.map((l, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-12">
                <input
                  className="field sm:col-span-6" placeholder="Désignation"
                  value={l.description}
                  onChange={(e) => setLines(upd(lines, i, { description: e.target.value }))}
                />
                <input
                  className="field sm:col-span-2" placeholder="Qté" inputMode="decimal"
                  value={l.quantity}
                  onChange={(e) => setLines(upd(lines, i, { quantity: e.target.value }))}
                />
                <input
                  className="field sm:col-span-2" placeholder="P.U." inputMode="decimal"
                  value={l.unitAmount}
                  onChange={(e) => setLines(upd(lines, i, { unitAmount: e.target.value }))}
                />
                {/* Tax is CONFIGURATION, entered per line. No rate is defaulted,
                    suggested or cascaded: the platform encodes no tax rule. */}
                <input
                  className="field sm:col-span-2" placeholder="TVA %" inputMode="decimal"
                  value={l.taxRate}
                  onChange={(e) => setLines(upd(lines, i, { taxRate: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className="text-sm text-navy-900 hover:underline"
              onClick={() => setLines([...lines, { description: "", quantity: "1", unitAmount: "", taxRate: "0" }])}>
              + Ajouter une ligne
            </button>
            {lines.length > 1 ? (
              <button type="button" className="text-sm text-slate-500 hover:underline"
                onClick={() => setLines(lines.slice(0, -1))}>
                Retirer la dernière
              </button>
            ) : null}
          </div>

          <dl className="mt-4 space-y-1 text-sm">
            <Row label="Total HT" value={formatAmountMinor(preview.subtotalMinor, currency)} />
            {!preview.taxFree ? (
              <Row label="Taxes" value={formatAmountMinor(preview.taxMinor, currency)} />
            ) : null}
            <Row label="Total" value={formatAmountMinor(preview.totalMinor, currency)} strong />
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={pending}
              className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-40"
              onClick={() => run(() => setQuotationLines(quotationId, lines), "Lignes enregistrées.")}>
              Enregistrer le brouillon
            </button>
            {caps.submit ? (
              <button type="button" disabled={pending}
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40"
                onClick={() => run(() => submitQuotation(quotationId), "Soumise pour validation interne.")}>
                Soumettre pour validation
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Internal validation — OPS_SUPERVISOR only, and never on your own work. */}
      {caps.validate ? <ValidationPanel quotationId={quotationId} pending={pending} run={run} /> : null}

      {validationBlocked ? (
        <section className="surface p-5 text-sm text-amber-800">{validationBlocked}</section>
      ) : null}

      {caps.send ? (
        <section className="surface p-5">
          <h2 className="mb-2 text-base font-semibold text-navy-900">Envoi au client</h2>
          <p className="mb-3 text-sm text-slate-600">
            L&apos;envoi fige la cotation, lui attribue son numéro et génère le PDF officiel.
          </p>
          <button type="button" disabled={pending}
            className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-40"
            onClick={() => run(() => sendQuotation(quotationId), "Cotation envoyée (figée et numérotée).")}>
            Envoyer la cotation
          </button>
        </section>
      ) : null}

      {hasArtifact ? (
        <section className="surface p-5">
          <h2 className="mb-2 text-base font-semibold text-navy-900">Document officiel</h2>
          <p className="mb-3 text-sm text-slate-600">
            Le PDF est généré une seule fois et conservé avec son empreinte SHA-256 : le
            client, la messagerie et cet écran ouvrent exactement le même document.
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={pending}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-navy-900 hover:bg-slate-200 disabled:opacity-40"
              onClick={() => start(async () => {
                const url = await quotationArtifactUrl(quotationId);
                if (url) window.open(url, "_blank", "noopener");
                else setError("Document indisponible.");
              })}>
              Ouvrir le PDF
            </button>
            {caps.send ? (
              <button type="button" disabled={pending}
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40"
                onClick={() => run(() => emailQuotationToCustomer(quotationId), "Cotation transmise au client par e-mail.")}>
                Transmettre par e-mail
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      {caps.recordDecision ? <DecisionPanel quotationId={quotationId} pending={pending} run={run} /> : null}

      {(caps.revise || caps.cancel) ? (
        <section className="surface p-5">
          <h2 className="mb-3 text-base font-semibold text-navy-900">Révision et annulation</h2>
          <div className="flex flex-wrap gap-2">
            {caps.revise ? (
              <button type="button" disabled={pending}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-navy-900 hover:bg-slate-200 disabled:opacity-40"
                onClick={() => run(() => reviseQuotation(quotationId), "Nouvelle version créée ; la précédente reste consultable.")}>
                Créer une révision
              </button>
            ) : null}
            {caps.cancel ? <CancelButton quotationId={quotationId} pending={pending} run={run} /> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ValidationPanel({
  quotationId, pending, run,
}: {
  quotationId: string; pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <section className="surface p-5">
      <h2 className="mb-2 text-base font-semibold text-navy-900">Validation interne</h2>
      <p className="mb-3 text-sm text-slate-600">
        Validation managériale avant envoi. Vous ne pouvez pas valider une cotation que
        vous avez préparée.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <button type="button" disabled={pending}
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40"
          onClick={() => run(() => validateQuotation({ quotationId, decision: "VALIDATED" }), "Cotation validée.")}>
          Valider
        </button>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-navy-900">Motif du refus</span>
          <input className="field" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Obligatoire pour refuser" />
        </label>
        <button type="button" disabled={pending || !reason.trim()}
          className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-800 disabled:opacity-40"
          onClick={() => run(
            () => validateQuotation({ quotationId, decision: "REJECTED", reasonCode: reason }),
            "Cotation renvoyée pour correction.",
          )}>
          Refuser
        </button>
      </div>
    </section>
  );
}

function DecisionPanel({
  quotationId, pending, run,
}: {
  quotationId: string; pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => void;
}) {
  const [kind, setKind] = useState<AcceptanceKind>("SIGNED_QUOTATION");
  const [on, setOn] = useState("");
  const [reason, setReason] = useState("");
  return (
    <section className="surface p-5">
      <h2 className="mb-2 text-base font-semibold text-navy-900">Réponse du client</h2>
      {/* ACCEPTANCE IS NEVER INFERRED. A human records it and states the evidence. */}
      <p className="mb-3 text-sm text-slate-600">
        L&apos;acceptation n&apos;est jamais déduite d&apos;un e-mail reçu : elle est
        enregistrée par une personne, avec la preuve correspondante.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-navy-900">Preuve</span>
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value as AcceptanceKind)}>
            {ACCEPTANCE_KINDS.map((k) => (
              <option key={k} value={k}>{ACCEPTANCE_KIND_FR[k]}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-navy-900">Date</span>
          <input type="date" className="field" value={on} onChange={(e) => setOn(e.target.value)} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <button type="button" disabled={pending || !on}
          className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40"
          onClick={() => run(
            () => recordCustomerDecision({
              quotationId, decision: "ACCEPTED", acceptance: { kind, on }, on,
            }),
            "Acceptation enregistrée.",
          )}>
          Enregistrer l&apos;acceptation
        </button>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-navy-900">Motif du refus client</span>
          <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="button" disabled={pending}
          className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-medium text-navy-900 hover:bg-slate-300 disabled:opacity-40"
          onClick={() => run(
            () => recordCustomerDecision({ quotationId, decision: "DECLINED", reasonCode: reason || null }),
            "Refus du client enregistré.",
          )}>
          Enregistrer un refus
        </button>
      </div>
    </section>
  );
}

function CancelButton({
  quotationId, pending, run,
}: {
  quotationId: string; pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <span className="flex flex-wrap items-end gap-2">
      <label className="text-sm">
        <span className="mb-1 block font-medium text-navy-900">Motif d&apos;annulation</span>
        <input className="field" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button type="button" disabled={pending || !reason.trim()}
        className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-800 disabled:opacity-40"
        onClick={() => run(() => cancelQuotation(quotationId, reason), "Cotation annulée.")}>
        Annuler la cotation
      </button>
    </span>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-slate-600">{label}</dt>
      <dd className={strong ? "font-semibold text-navy-900" : "text-navy-900"}>{value}</dd>
    </div>
  );
}

function upd(lines: LineDraft[], i: number, patch: Partial<LineDraft>): LineDraft[] {
  return lines.map((l, k) => (k === i ? { ...l, ...patch } : l));
}

/** Server error codes → French. Anything unmapped falls back to a neutral refusal. */
const ERRORS: Record<string, string> = {
  forbidden: "Vous n'avez pas l'autorisation requise.",
  forbidden_send: "Vous n'avez pas l'autorisation d'envoyer une cotation.",
  forbidden_approve: "Vous n'avez pas l'autorisation d'enregistrer la réponse du client.",
  forbidden_validate: "Vous n'avez pas l'autorisation de valider une cotation.",
  reason_required: "Le motif est obligatoire pour refuser.",
  acceptance_required: "La preuve d'acceptation est obligatoire.",
  invalid_kind: "Type de preuve invalide.",
  invalid_date: "Date invalide.",
  no_lines: "Ajoutez au moins une ligne.",
  description_required: "Chaque ligne doit porter une désignation.",
  not_sent: "La cotation n'a pas encore été envoyée.",
  no_recipient: "Aucune adresse e-mail n'est enregistrée pour ce client.",
  email_not_configured: "L'envoi d'e-mails n'est pas configuré.",
  artifact_unavailable: "Le PDF officiel n'est pas disponible.",
  // The structural maker-checker, surfaced verbatim rather than as a generic error.
  QT606: "Vous avez préparé cette cotation : sa validation revient à une autre personne.",
  QT610: "Une cotation envoyée est figée : créez une révision.",
  QT612: "Les lignes d'une cotation envoyée ne peuvent plus être modifiées.",
};
