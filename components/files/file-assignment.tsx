"use client";

/**
 * Dossier assignment control (Phase 3.2A). Client component.
 * ---------------------------------------------------------------------------
 * Shows the current responsible staff member and — for users holding file:assign
 * — a picker to (re)assign or unassign. Invokes the assignFile server action;
 * all authorization + tenant/active-staff validation happen server-side.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { assignFile } from "@/lib/files/actions";
import type { StaffOption } from "@/lib/files/types";

export function FileAssignment({
  fileId,
  currentAssigneeId,
  currentAssigneeLabel,
  staff,
  canAssign,
}: {
  fileId: string;
  currentAssigneeId: string | null;
  currentAssigneeLabel: string | null;
  staff: StaffOption[];
  canAssign: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string>(currentAssigneeId ?? "");
  const [error, setError] = useState<string | null>(null);
  const a = t.files.assignment;

  function submit(next: string | null) {
    setError(null);
    startTransition(async () => {
      const res = await assignFile(fileId, next);
      if (!res.ok) {
        const map = t.files.errors as Record<string, string>;
        setError(map[res.error] ?? t.files.errors.generic);
        return;
      }
      router.refresh();
    });
  }

  const changed = (selected || null) !== (currentAssigneeId ?? null);

  return (
    <div className="surface space-y-3 p-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{a.title}</p>
        <p className="text-xs text-slate-500">{a.subtitle}</p>
      </div>

      <p className="text-sm">
        <span className="text-slate-500">{a.assignee}: </span>
        <strong className="text-navy-900">{currentAssigneeLabel ?? a.unassigned}</strong>
      </p>

      {canAssign && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={pending || staff.length === 0}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20 disabled:opacity-50"
            >
              <option value="">{a.select}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => submit(selected || null)}
              disabled={pending || !changed || selected === ""}
              className="rounded-md bg-navy-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-800 disabled:opacity-50"
            >
              {pending ? a.saving : currentAssigneeId ? a.change : a.assign}
            </button>
            {currentAssigneeId && (
              <button
                onClick={() => {
                  setSelected("");
                  submit(null);
                }}
                disabled={pending}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {a.unassign}
              </button>
            )}
          </div>
          {staff.length === 0 && <p className="text-xs text-slate-400">{a.noStaff}</p>}
        </>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}
