import Link from "next/link";
import type { CaptureEvidence } from "@/lib/ec/mailboxes/service";
import { CAPTURE_OUTCOME_FR } from "@/lib/ec/mailboxes/service";
import { labelFor } from "@/lib/unified-timeline/contract";

/**
 * EMP-1 — what the platform can PROVE about one captured message.
 *
 * Three things, deliberately kept apart because they answer different
 * questions and have different authorities behind them:
 *
 *   1. ROUTING — how the message arrived, from EC-1's immutable webhook journal;
 *   2. INTEGRITY — the envelope's hash and size, so the evidence is checkable;
 *   3. HISTORY — the correspondence events the ledger recorded.
 *
 * The history is read from the Decision Plane through RLS, not assembled here.
 * That matters: a triager who cannot read the dossier a message was attached to
 * will not see the attach event, because visibility follows the subject. The
 * panel says so rather than presenting a short list as a complete one.
 *
 * Nothing on this page can modify anything. The capture is evidence.
 */
export type LedgerEntry = { id: string; eventType: string; occurredAt: string };

export function MessageEvidence({
  evidence,
  ledger,
  linkedFileId,
  linkedFileLabel,
}: {
  evidence: CaptureEvidence | null;
  ledger: LedgerEntry[];
  linkedFileId: string | null;
  linkedFileLabel: string | null;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="surface p-4" aria-labelledby="emp1-routing">
        <h2 id="emp1-routing" className="mb-3 text-sm font-semibold text-navy-900">
          Réception et intégrité
        </h2>
        {!evidence ? (
          <p className="text-sm text-slate-500">Preuve de capture indisponible.</p>
        ) : (
          <>
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              <Fact label="Fournisseur" value={evidence.provider} />
              <Fact label="Statut de capture" value={CAPTURE_OUTCOME_FR[evidence.captureStatus] ?? evidence.captureStatus} />
              <Fact label="Capturé le" value={new Date(evidence.capturedAt).toLocaleString("fr-FR")} />
              <Fact label="Taille du message" value={`${Math.round(evidence.rawSizeBytes / 1024)} Ko`} />
              <Fact label="Identifiant fournisseur" value={evidence.providerEventId} mono />
              <Fact label="Empreinte SHA-256" value={evidence.rawSha256} mono />
            </dl>

            {/* Quarantine history. A message readable here was never quarantined
                — the capture constraint makes the two mutually exclusive — so
                this states the fact instead of showing an empty section. */}
            <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
              {evidence.quarantineReason
                ? `Motif de quarantaine : ${evidence.quarantineReason}.`
                : "Ce message a été routé vers une boîte du tenant ; il n'a jamais été mis en quarantaine."}
            </p>

            <h3 className="mt-4 text-xs font-semibold text-navy-900">Livraisons webhook</h3>
            {evidence.deliveries.length === 0 ? (
              <p className="mt-1 text-[11px] text-slate-500">Aucune livraison enregistrée.</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {evidence.deliveries.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-slate-600">
                    <span className="tabular text-slate-400">
                      {new Date(d.receivedAt).toLocaleString("fr-FR")}
                    </span>
                    <span className="font-medium text-slate-700">
                      {CAPTURE_OUTCOME_FR[d.outcome] ?? d.outcome}
                    </span>
                    <span className={d.signatureValid ? "text-teal-700" : "text-red-700"}>
                      {d.signatureValid ? "signature valide" : "signature invalide"}
                    </span>
                    {d.detail ? <span className="text-slate-500">· {d.detail}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section className="surface p-4" aria-labelledby="emp1-history">
        <h2 id="emp1-history" className="mb-3 text-sm font-semibold text-navy-900">
          Historique enregistré
        </h2>

        {linkedFileId ? (
          <p className="mb-3 text-xs">
            <span className="text-slate-500">Dossier rattaché : </span>
            <Link href={`/files/${linkedFileId}`} className="text-teal-700 hover:underline">
              {linkedFileLabel ?? "Ouvrir le dossier"}
            </Link>
          </p>
        ) : null}

        {ledger.length === 0 ? (
          <p className="text-sm text-slate-500">
            Aucun évènement enregistré pour cette correspondance.
          </p>
        ) : (
          <ol className="space-y-2">
            {ledger.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm text-navy-900">{labelFor(e.eventType)}</span>
                <time dateTime={e.occurredAt} className="tabular text-[11px] text-slate-400">
                  {new Date(e.occurredAt).toLocaleString("fr-FR")}
                </time>
              </li>
            ))}
          </ol>
        )}

        <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
          La visibilité d&apos;un évènement suit son sujet : un évènement rattaché à un dossier
          n&apos;apparaît ici que si vous êtes autorisé à consulter ce dossier. Cette liste peut donc
          être plus courte que l&apos;historique réel.
        </p>
      </section>
    </div>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`truncate text-slate-800 ${mono ? "font-mono text-[10px]" : ""}`} title={value}>
        {value}
      </dd>
    </div>
  );
}
