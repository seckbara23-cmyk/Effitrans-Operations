/**
 * CEO-ALIGNMENT WP1-B1 — « Informations à compléter » for the dossier OPENING.
 * ---------------------------------------------------------------------------
 * A SERVER component that decides nothing: it draws what
 * `openingAdvisories()` (lib/files/opening.ts) returns. Today that is at most
 * one line — a missing PO client on an import dossier — in the same register
 * the work summary uses for non-blocking requirements.
 *
 * Deliberately NOT inside `DossierWorkSummary`: that component draws the ONE
 * work model the header, the cards and the queue share (OPS-UAT-CONVERGENCE-01
 * §12/§13). A dossier fact is not step evidence, and keeping it out of that
 * model is exactly what keeps it non-blocking everywhere.
 */
import type { OpeningAdvisory } from "@/lib/files/opening";

export function OpeningAdvisories({ items }: { items: readonly OpeningAdvisory[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Informations à compléter — ouverture du dossier
      </p>
      <ul className="mt-1 space-y-0.5">
        {items.map((a) => (
          <li key={a.key} className="text-[11px] text-slate-600">
            {a.messageFr}
          </li>
        ))}
      </ul>
    </div>
  );
}
