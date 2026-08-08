import Link from "next/link";
import type { ThreadView as Thread } from "@/lib/ec/threads/service";
import { TRIAGE_STATUS_FR, TRIAGE_OUTCOME_FR, type TriageStatus, type TriageOutcome } from "@/lib/ec/triage/model";
import { labelFor } from "@/lib/unified-timeline/contract";

/**
 * EMP-2 — one conversation, oldest first.
 *
 * Read-only by construction: there is no form, no button and no action import
 * in this file. The messages are evidence, and the thread is a lens.
 *
 * The correlation BASIS is shown per message. A reader who wonders why a
 * message is in a conversation should be able to see the answer rather than
 * trust it, and a message linked only because it shares a `thread_key` is a
 * weaker claim than one linked by an explicit In-Reply-To.
 */
export type TriageFacts = {
  messageId: string;
  triageId: string;
  status: string;
  outcome: string | null;
  outcomeFileId: string | null;
  attachmentCount: number;
  mailboxAddress: string | null;
};

export type LedgerFacts = {
  messageId: string;
  entries: { id: string; eventType: string; occurredAt: string }[];
};

const BASIS_FR: Record<string, string> = {
  "message-id": "identifiant propre",
  "in-reply-to": "réponse explicite (In-Reply-To)",
  references: "chaîne de références (References)",
  synthetic: "aucun identifiant RFC — message isolé",
};

export function ThreadView({
  thread,
  triage,
  ledgers,
  seedRowId,
}: {
  thread: Thread;
  triage: TriageFacts[];
  ledgers: LedgerFacts[];
  seedRowId: string;
}) {
  const triageByMessage = new Map(triage.map((t) => [t.messageId, t]));
  const ledgerByMessage = new Map(ledgers.map((l) => [l.messageId, l.entries]));

  return (
    <div className="space-y-4">
      <section className="surface p-4">
        <dl className="grid gap-3 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">Identité de conversation</dt>
            <dd className="truncate font-mono text-[10px] text-slate-800" title={thread.threadId}>
              {thread.threadId}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Messages corrélés</dt>
            <dd className="font-medium text-slate-800">{thread.messages.length}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Méthode</dt>
            <dd className="text-slate-800">En-têtes RFC 5322 uniquement</dd>
          </div>
        </dl>
        <p className="mt-3 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
          L&apos;identité de conversation est <strong>calculée</strong>, jamais stockée : elle se
          déduit d&apos;en-têtes immuables, donc elle survit à un retraitement et à un changement de
          fournisseur sans qu&apos;aucun message historique ne soit réécrit. L&apos;objet,
          l&apos;expéditeur et la date ne participent jamais à la corrélation — deux courriers
          portant le même objet ne forment pas une conversation.
        </p>
        {thread.truncated ? (
          <p className="mt-2 text-[11px] text-amber-800" role="alert">
            La conversation dépasse la limite d&apos;expansion : cette vue est partielle et
            d&apos;autres messages peuvent en faire partie.
          </p>
        ) : null}
      </section>

      <ol className="space-y-3">
        {thread.messages.map((m, i) => {
          const t = triageByMessage.get(m.rowId);
          const events = ledgerByMessage.get(m.rowId) ?? [];
          const isSeed = m.rowId === seedRowId;
          return (
            <li
              key={m.rowId}
              className={`surface p-4 ${isSeed ? "ring-2 ring-teal-500/40" : ""}`}
              aria-current={isSeed ? "true" : undefined}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium text-navy-900">
                  <span className="mr-2 text-xs text-slate-400">{i + 1}.</span>
                  {m.subject ?? "(sans objet)"}
                </p>
                <time dateTime={m.receivedAt} className="tabular shrink-0 text-xs text-slate-400">
                  {new Date(m.receivedAt).toLocaleString("fr-FR")}
                </time>
              </div>

              <dl className="mt-2 grid gap-2 text-[11px] sm:grid-cols-2">
                <Row label="Expéditeur" value={m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress} />
                <Row label="Destinataires" value={m.toAddresses.join(", ") || "—"} />
                {m.ccAddresses.length > 0 ? <Row label="Copie" value={m.ccAddresses.join(", ")} /> : null}
                <Row label="Boîte" value={t?.mailboxAddress ?? "—"} />
                <Row label="Corrélé par" value={BASIS_FR[m.basis] ?? m.basis} />
                <Row label="Pièces jointes" value={t ? String(t.attachmentCount) : "—"} />
                <Row
                  label="Décision de tri"
                  value={
                    t
                      ? `${TRIAGE_STATUS_FR[t.status as TriageStatus] ?? t.status}${
                          t.outcome ? ` — ${TRIAGE_OUTCOME_FR[t.outcome as TriageOutcome] ?? t.outcome}` : ""
                        }`
                      : "—"
                  }
                />
                <Row label="Message-ID" value={m.messageId ?? "—"} mono />
              </dl>

              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                {t ? (
                  <Link href={`/mail/inbox/${t.triageId}`} className="text-teal-700 hover:underline">
                    Ouvrir le tri
                  </Link>
                ) : null}
                {t?.outcomeFileId ? (
                  <Link href={`/files/${t.outcomeFileId}`} className="text-teal-700 hover:underline">
                    Dossier rattaché
                  </Link>
                ) : null}
              </div>

              {events.length > 0 ? (
                <ul className="mt-3 space-y-1 border-t border-slate-100 pt-2">
                  {events.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-[11px]">
                      <span className="text-slate-700">{labelFor(e.eventType)}</span>
                      <time dateTime={e.occurredAt} className="tabular text-slate-400">
                        {new Date(e.occurredAt).toLocaleString("fr-FR")}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`truncate text-slate-800 ${mono ? "font-mono text-[10px]" : ""}`} title={value}>
        {value}
      </dd>
    </div>
  );
}
