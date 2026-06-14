/**
 * Dashboard "recent dossiers" table (Phase 1.5). Presentational — real
 * operational_file rows passed in by the page (file:read). Hidden when empty.
 */
import Link from "next/link";
import { t } from "@/lib/i18n";
import type { RecentDossier } from "@/lib/files/types";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-500",
  OPENED: "bg-sky-50 text-sky-700",
  IN_PROGRESS: "bg-amber-50 text-amber-700",
  DELIVERED: "bg-teal-50 text-teal-700",
  CLOSED: "bg-navy-50 text-navy-700",
};
const PRIORITY_STYLE: Record<string, string> = {
  low: "bg-slate-100 text-slate-500",
  normal: "bg-sky-50 text-sky-700",
  high: "bg-amber-50 text-amber-700",
  critical: "bg-red-50 text-red-700",
};

export function DashboardRecentFiles({ files }: { files: RecentDossier[] }) {
  if (files.length === 0) return null;
  const o = t.dashboard.overview.recent;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy-900">{o.title}</h2>
        <Link href="/files" className="text-xs font-medium text-teal-700 hover:underline">
          {t.dashboard.panels.viewAll}
        </Link>
      </div>
      <div className="surface overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">{t.files.columns.number}</th>
              <th className="px-4 py-3 font-semibold">{t.files.columns.client}</th>
              <th className="px-4 py-3 font-semibold">{t.files.columns.type}</th>
              <th className="px-4 py-3 font-semibold">{t.dashboard.columns.origin}</th>
              <th className="px-4 py-3 font-semibold">{t.dashboard.columns.destination}</th>
              <th className="px-4 py-3 font-semibold">{t.files.columns.priority}</th>
              <th className="px-4 py-3 font-semibold">{t.files.columns.status}</th>
              <th className="px-4 py-3 font-semibold">{t.dashboard.columns.assignedTo}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {files.map((f) => (
              <tr key={f.id} className="hover:bg-slate-50/60">
                <td className="px-4 py-3">
                  <Link href={`/files/${f.id}`} className="tabular font-medium text-navy-900 hover:text-teal-700">
                    {f.fileNumber}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{f.clientName ?? t.common.none}</td>
                <td className="px-4 py-3 text-slate-600">{t.files.types[f.type]}</td>
                <td className="px-4 py-3 text-slate-600">{f.origin ?? t.common.none}</td>
                <td className="px-4 py-3 text-slate-600">{f.destination ?? t.common.none}</td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_STYLE[f.priority] ?? "bg-slate-100 text-slate-500"}`}>
                    {t.files.priorities[f.priority]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[f.status] ?? "bg-slate-100 text-slate-500"}`}>
                    {t.files.statuses[f.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600">{f.ownerEmail ?? t.common.none}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
