"use client";

/**
 * Operational File directory (Phase 1.2). Client component (links only).
 */
import Link from "next/link";
import { t } from "@/lib/i18n";
import type { FileListItem } from "@/lib/files/types";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-500",
  OPENED: "bg-sky-50 text-sky-700",
  IN_PROGRESS: "bg-amber-50 text-amber-700",
  DELIVERED: "bg-teal-50 text-teal-700",
  CLOSED: "bg-navy-50 text-navy-700",
  CANCELLED: "bg-rose-50 text-rose-700",
};

const PRIORITY_STYLE: Record<string, string> = {
  low: "bg-slate-100 text-slate-500",
  normal: "bg-sky-50 text-sky-700",
  high: "bg-amber-50 text-amber-700",
  critical: "bg-red-50 text-red-700",
};

export function FilesTable({ files, canCreate }: { files: FileListItem[]; canCreate: boolean }) {
  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          <Link href="/files/new" className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800">
            {t.files.new}
          </Link>
        </div>
      )}

      {files.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-600">{t.files.empty}</div>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{t.files.columns.number}</th>
                <th className="px-4 py-3 font-semibold">{t.files.columns.type}</th>
                <th className="px-4 py-3 font-semibold">{t.files.columns.client}</th>
                <th className="px-4 py-3 font-semibold">{t.files.columns.mode}</th>
                <th className="px-4 py-3 font-semibold">{t.files.columns.priority}</th>
                <th className="px-4 py-3 font-semibold">{t.files.columns.status}</th>
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
                  <td className="px-4 py-3 text-slate-600">{t.files.types[f.type]}</td>
                  <td className="px-4 py-3 text-slate-600">{f.clientName ?? t.common.none}</td>
                  <td className="px-4 py-3 text-slate-600">{f.transportMode ? t.files.modes[f.transportMode] : t.common.none}</td>
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
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
