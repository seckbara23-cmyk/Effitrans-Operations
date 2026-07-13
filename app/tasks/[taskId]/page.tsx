import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Tâche" };

/**
 * RETIRED — Phase 5.0C (BLOCKER-3 from the Phase 5.0A audit).
 * ---------------------------------------------------------------------------
 * This route rendered `lib/tasks.ts`: a static, in-memory MOCK task dataset with
 * its own status vocabulary (todo/awaiting_client/awaiting_customs/…), unrelated
 * to the real `task` table. generateStaticParams() over that mock is what put
 * /tasks/TSK-2026-0001 and friends into the production build.
 *
 * It was ORPHANED: the real task list at /tasks reads the database via
 * lib/tasks/service.ts. Nothing in the live application linked to this detail
 * page — clicking a real task never reached it (its IDs are UUIDs, not TSK-…).
 *
 * Real work now has two homes: the dossier (/files/[id]) and, for the official
 * 26-step process, the department queues (/queues/[key]) and Mon travail.
 *
 * Kept as a data-free notice rather than deleted, for the same reason as the
 * customs route: the mock MODULE still backs unrouted components, and removing it
 * deserves its own change with route-impact tests.
 */
export default function RetiredTaskDetailPage() {
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Opérations"
        title="Tâche"
        subtitle="Les tâches se consultent dans la liste des tâches et dans le dossier."
      />
      <div className="surface flex flex-col items-center justify-center px-6 py-16 text-center">
        <h2 className="max-w-md text-lg font-semibold text-navy-900">
          Cette vue n&apos;existe plus
        </h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
          Cette page affichait des données de démonstration. Les tâches réelles se
          consultent dans la liste des tâches et dans le dossier concerné.
        </p>
        <Link
          href="/tasks"
          className="mt-6 rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-navy-800"
        >
          Voir les tâches
        </Link>
      </div>
    </div>
  );
}
