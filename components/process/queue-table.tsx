/**
 * Queue table (Phase 5.0C) — server component, presentation only.
 * ---------------------------------------------------------------------------
 * Answers, for every row, the eleven questions the official process demands:
 * quel dossier, quel client, quelle étape officielle, qui l'a transmis, depuis
 * quand, qui doit agir, quelle action, quel blocage, quel destinataire, la
 * branche parallèle est-elle bloquée, le SLA est-il configuré.
 *
 * It renders. It decides nothing — every value is computed by the queue service
 * from the engine.
 */
import Link from "next/link";
import type { QueueItem } from "@/lib/process/queues/service";
import { QueueRowActions } from "./queue-row-actions";
import type { QueueDef } from "@/lib/process/queues/registry";

const LEVEL_TONE: Record<string, string> = {
  critical: "bg-red-50 text-red-700 border-red-200",
  high: "bg-amber-50 text-amber-700 border-amber-200",
  normal: "bg-slate-50 text-slate-600 border-slate-200",
  low: "bg-slate-50 text-slate-400 border-slate-200",
};

const STATE_TONE: Record<string, string> = {
  ACTIVE: "bg-blue-50 text-blue-700",
  SUBMITTED: "bg-amber-50 text-amber-700",
  AVAILABLE: "bg-slate-50 text-slate-700",
  BLOCKED: "bg-red-50 text-red-700",
  REJECTED: "bg-red-50 text-red-700",
};

function age(hours: number): string {
  if (hours < 1) return "< 1 h";
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} j`;
}

export function QueueTable({ items, queue }: { items: QueueItem[]; queue: QueueDef }) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center">
        <p className="text-sm text-slate-500">Aucun dossier dans cette file.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2.5">Dossier / Client</th>
            <th className="px-4 py-2.5">Étape officielle</th>
            <th className="px-4 py-2.5">Transmis par / Depuis</th>
            <th className="px-4 py-2.5">Blocage</th>
            <th className="px-4 py-2.5">Priorité</th>
            <th className="px-4 py-2.5 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((i) => (
            <tr key={i.executionId} className="align-top hover:bg-slate-50/60">
              <td className="px-4 py-3">
                <Link href={`/files/${i.fileId}`} className="font-medium tabular text-navy-900 hover:text-teal-700">
                  {i.fileNumber}
                </Link>
                <div className="text-xs text-slate-500">{i.clientName}</div>
                {i.compatibility === "mapped" && (
                  <span className="mt-1 inline-block rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">
                    Rattaché a posteriori
                  </span>
                )}
              </td>

              <td className="px-4 py-3">
                <div className="font-medium text-slate-900">
                  {i.stepNumber ? `${i.stepNumber}. ` : ""}
                  {i.stepLabel}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATE_TONE[i.state] ?? "bg-slate-50 text-slate-500"}`}>
                    {i.state}
                  </span>
                  {i.isCorrection && (
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                      Correction
                    </span>
                  )}
                  {i.branches.waitingOnOtherBranch && (
                    <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                      Attente branche parallèle
                    </span>
                  )}
                </div>
                {i.nextRecipient && (
                  <div className="mt-1 text-[11px] text-slate-400">→ {i.nextRecipient}</div>
                )}
              </td>

              <td className="px-4 py-3">
                {i.handoffSentAt ? (
                  <>
                    <div className="text-xs text-slate-700">
                      {i.received ? "Réceptionné" : "En attente de réception"}
                    </div>
                    <div className="text-xs text-slate-500">{age(i.ageHours)}</div>
                  </>
                ) : (
                  <div className="text-xs text-slate-500">{age(i.ageHours)}</div>
                )}
                <div className="mt-1 text-[11px] text-slate-400">{i.sla.label}</div>
              </td>

              <td className="px-4 py-3">
                {i.blockerSummary ? (
                  <span className="text-xs text-red-600">{i.blockerSummary}</span>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                )}
                {i.missingEvidenceCount > 0 && (
                  <div className="text-[11px] text-slate-500">
                    {i.missingEvidenceCount} preuve(s) manquante(s)
                  </div>
                )}
              </td>

              <td className="px-4 py-3">
                <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${LEVEL_TONE[i.priority.level]}`}>
                  {i.priority.level}
                </span>
                {/* The priority is never a black box: show why. */}
                <ul className="mt-1 space-y-0.5">
                  {i.priority.reasons.slice(0, 2).map((r) => (
                    <li key={r.code} className="text-[11px] text-slate-500">
                      {r.labelFr}
                    </li>
                  ))}
                </ul>
              </td>

              <td className="px-4 py-3 text-right">
                <QueueRowActions item={i} queue={queue} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
