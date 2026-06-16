import Link from "next/link";
import { t } from "@/lib/i18n";

/**
 * Global 404 (Phase 1.17A). Renders inside the staff app chrome (AppShell)
 * with a friendly message + a route back to the operations centre, replacing
 * Next.js's bare default for unknown routes.
 */
export default function NotFound() {
  return (
    <div className="animate-fade-in">
      <div className="surface flex flex-col items-center justify-center px-6 py-16 text-center">
        <span className="eyebrow mb-2">404</span>
        <h1 className="max-w-md text-lg font-semibold text-navy-900">
          Page introuvable
        </h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-slate-500">
          La page demandée n&apos;existe pas ou a été déplacée.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-navy-800 hover:bg-slate-50"
        >
          {t.common.backToDashboard}
        </Link>
      </div>
    </div>
  );
}
