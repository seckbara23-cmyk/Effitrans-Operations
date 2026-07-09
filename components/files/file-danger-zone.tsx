"use client";

/**
 * Dossier cancel / delete controls (Phase 3.2A). Client component.
 * ---------------------------------------------------------------------------
 * Rendered only for users holding file:delete. Cancel is a soft state change
 * (always offered while the dossier is non-terminal); Delete is a hard delete
 * that the server action permits only for an empty dossier — otherwise it returns
 * "has_operations" and this surfaces the "clôturer/annuler" guidance. Both
 * actions require an explicit inline confirmation.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { cancelFile, deleteFile } from "@/lib/files/actions";

type Mode = null | "cancel" | "delete";

export function FileDangerZone({
  fileId,
  canManage,
  cancellable,
}: {
  fileId: string;
  canManage: boolean;
  cancellable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const d = t.files.danger;

  if (!canManage) return null;

  function open(next: Mode) {
    setError(null);
    setReason("");
    setMode(next);
  }

  function run() {
    setError(null);
    startTransition(async () => {
      const res = mode === "delete" ? await deleteFile(fileId, reason) : await cancelFile(fileId, reason);
      if (!res.ok) {
        const map = t.files.errors as Record<string, string>;
        setError(map[res.error] ?? t.files.errors.generic);
        return;
      }
      if (mode === "delete") {
        // The dossier no longer exists — leave the (now-404) detail page.
        router.push("/files");
        router.refresh();
        return;
      }
      setMode(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50/40 p-5">
      <div className="space-y-1">
        <p className="text-xs font-bold uppercase tracking-wide text-red-700">{d.title}</p>
        <p className="text-xs text-slate-500">{d.subtitle}</p>
      </div>

      {mode === null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {cancellable && (
            <button
              onClick={() => open("cancel")}
              className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50"
            >
              {d.cancel}
            </button>
          )}
          <button
            onClick={() => open("delete")}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
          >
            {d.delete}
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-navy-900">
            {mode === "delete" ? d.deleteConfirm : d.cancelConfirm}
          </p>
          <div>
            <label className="mb-1 block text-xs text-slate-500">{d.reasonLabel}</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              placeholder={d.reasonPlaceholder}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={run}
              disabled={pending}
              className={`rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
                mode === "delete" ? "bg-red-700 hover:bg-red-800" : "bg-amber-700 hover:bg-amber-800"
              }`}
            >
              {pending ? d.working : mode === "delete" ? d.delete : d.cancel}
            </button>
            <button
              onClick={() => {
                setMode(null);
                setReason("");
                setError(null);
              }}
              disabled={pending}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {d.dismiss}
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
