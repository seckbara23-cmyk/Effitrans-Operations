import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Dossier douane" };

/**
 * RETIRED — Phase 5.0C (BLOCKER-3 from the Phase 5.0A audit).
 * ---------------------------------------------------------------------------
 * This route rendered `lib/customs.ts`: a static, in-memory MOCK dataset with its
 * own French status vocabulary, disconnected from Supabase. It also ran
 * generateStaticParams() over that mock, baking fake customs IDs into every
 * production build.
 *
 * It was ORPHANED: the real customs list at /customs reads the database and links
 * to /files/[id]. Nothing in the live application linked here — the only inbound
 * links came from other unrouted mock components.
 *
 * Customs now lives inside the dossier (the real `customs_record` on /files/[id]),
 * and the official customs chain (steps 4-13) is driven by the Phase 5.0B process
 * engine and surfaced through the Transit / Déclarant / Terrain douane queues.
 *
 * Kept as a data-free notice rather than deleted, so an old bookmark lands
 * somewhere honest instead of on fabricated data. The mock MODULE (lib/customs.ts)
 * is not removed here: it still backs several unrouted components, and deleting it
 * belongs in a dedicated cleanup with route-impact tests rather than being
 * smuggled into this phase.
 */
export default function RetiredCustomsDetailPage() {
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Douane"
        title="Dossier douane"
        subtitle="Le suivi douane est géré au sein de chaque dossier."
      />
      <div className="surface flex flex-col items-center justify-center px-6 py-16 text-center">
        <h2 className="max-w-md text-lg font-semibold text-navy-900">
          Cette vue n&apos;existe plus
        </h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
          Le dossier de dédouanement se consulte directement dans le dossier
          opérationnel concerné. La chaîne douane officielle (étapes 4 à 13) est
          suivie par le moteur de processus.
        </p>
        <Link
          href="/files"
          className="mt-6 rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-800"
        >
          Voir les dossiers
        </Link>
      </div>
    </div>
  );
}
