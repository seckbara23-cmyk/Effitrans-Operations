import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";

export const metadata: Metadata = { title: "Documents" };

/**
 * Legacy prototype route (Phase 1.17B). The old global "Documents" page rendered
 * hard-coded mock data. There is no real global document view: documents are
 * managed inside each dossier (/files/[id]) and surfaced to clients via the
 * portal. Removed from the sidebar; this page is a clear, data-free notice for
 * any old link/bookmark.
 */
export default function DocumentsPage() {
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Opérations"
        title="Documents"
        subtitle="Les documents sont gérés au sein de chaque dossier."
      />
      <div className="surface flex flex-col items-center justify-center px-6 py-16 text-center">
        <h2 className="max-w-md text-lg font-semibold text-navy-900">
          Aucune vue documentaire globale
        </h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
          Les pièces et documents sont consultés et gérés directement dans le
          dossier concerné, et partagés avec le client via le portail.
        </p>
        <Link
          href="/files"
          className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-navy-800 hover:bg-slate-50"
        >
          Ouvrir les dossiers
        </Link>
      </div>
    </div>
  );
}
