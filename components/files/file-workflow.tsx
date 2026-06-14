"use client";

/**
 * File status + transition control + history (Phase 1.2). Client component.
 * Invokes the transitionFile server-action proxy only.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { transitionFile } from "@/lib/files/actions";
import { nextStatuses } from "@/lib/files/status";
import type { FileDetail } from "@/lib/files/types";

export function FileWorkflow({ file, canUpdate }: { file: FileDetail; canUpdate: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const next = nextStatuses(file.status);

  function advance(to: string) {
    setError(null);
    startTransition(async () => {
      const res = await transitionFile(file.id, to);
      if (!res.ok) {
        const map = t.files.errors as Record<string, string>;
        setError(map[res.error] ?? t.files.errors.generic);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="surface space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <span className="text-slate-500">{t.files.columns.status}: </span>
          <strong className="text-navy-900">{t.files.statuses[file.status]}</strong>
        </div>
        {canUpdate && next.length > 0 && (
          <div className="flex gap-2">
            {next.map((to) => (
              <button
                key={to}
                onClick={() => advance(to)}
                disabled={pending}
                className="rounded-md bg-navy-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-800 disabled:opacity-50"
              >
                {t.files.actions.advance} → {t.files.statuses[to]}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{t.files.history}</p>
        {file.history.length === 0 ? (
          <p className="text-xs text-slate-400">{t.files.noHistory}</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {file.history.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-slate-600">
                <span className="tabular text-xs text-slate-400">{h.occurredAt}</span>
                <span>
                  {h.fromStatus ? t.files.statuses[h.fromStatus as FileDetail["status"]] : t.common.none}
                  {" → "}
                  <strong className="text-navy-800">{t.files.statuses[h.toStatus as FileDetail["status"]]}</strong>
                </span>
                <span className="text-xs text-slate-400">{h.actorEmail ?? ""}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
