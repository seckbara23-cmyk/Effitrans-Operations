"use client";

/**
 * Internal tracking timeline + manual update form (Phase 3.4B). Client component.
 * ---------------------------------------------------------------------------
 * Shows the dossier's tracking events (staff view — may include internal notes)
 * and lets an operator record a MANUAL update. Manual updates are labeled
 * "Mise à jour manuelle par Effitrans" and are evidence only — they never change
 * the transport lifecycle. Rendered only when TRACKING_ENABLED (the parent page
 * gates on the flag) and the manual form only when the user has tracking:write.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { recordManualTrackingEvent } from "@/lib/tracking/actions";
import { MANUAL_UPDATE_KINDS, isCustomerSafeByDefault } from "@/lib/tracking/events";
import type { TrackingActionResult, TrackingEventEntry, TrackingEventType } from "@/lib/tracking/types";

function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

export function TrackingTimeline({
  fileId,
  events,
  canWrite,
}: {
  fileId: string;
  events: TrackingEventEntry[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TrackingEventType>(MANUAL_UPDATE_KINDS[0]);
  const tk = t.transport.tracking;
  const typeLabels = tk.types as Record<string, string>;

  function run(fn: () => Promise<TrackingActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        const map = tk.errors as Record<string, string>;
        setError(map[res.error] ?? tk.errors.generic);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() =>
      recordManualTrackingEvent(fileId, {
        type: String(fd.get("type") ?? ""),
        customerMessage: String(fd.get("customerMessage") ?? "") || null,
        internalNote: String(fd.get("internalNote") ?? "") || null,
        occurredAt: String(fd.get("occurredAt") ?? "") || null,
        customerVisible: fd.get("customerVisible") === "on",
      }),
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy-900">{tk.title}</h2>
        {canWrite && (
          <button
            onClick={() => { setOpen((v) => !v); setError(null); }}
            className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50"
          >
            {open ? tk.cancel : tk.add}
          </button>
        )}
      </div>

      <div className="surface space-y-3 p-4">
        <p className="text-xs text-slate-500">{tk.subtitle}</p>

        {canWrite && open && (
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-100 p-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              {tk.form.type}
              <select
                name="type"
                value={type}
                onChange={(e) => setType(e.target.value as TrackingEventType)}
                className="rounded-md border border-slate-200 px-2 py-1 text-sm"
              >
                {MANUAL_UPDATE_KINDS.map((k) => (
                  <option key={k} value={k}>{typeLabels[k] ?? k}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600">
              {tk.form.occurredAt}
              <input type="datetime-local" name="occurredAt" className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 sm:col-span-2">
              {tk.form.customerMessage}
              <input type="text" name="customerMessage" className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-slate-600 sm:col-span-2">
              {tk.form.internalNote}
              <input type="text" name="internalNote" className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-600 sm:col-span-2">
              <input type="checkbox" name="customerVisible" defaultChecked={isCustomerSafeByDefault(type)} />
              {tk.form.customerVisible}
            </label>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
              >
                {tk.form.submit}
              </button>
            </div>
          </form>
        )}

        {events.length === 0 ? (
          <p className="text-sm text-slate-500">{tk.empty}</p>
        ) : (
          <ol className="space-y-2">
            {events.map((ev) => (
              <li key={ev.id} className="flex flex-col gap-1 border-l-2 border-slate-200 pl-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-navy-800">{typeLabels[ev.type] ?? ev.type}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${ev.customerVisible ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-500"}`}>
                    {ev.customerVisible ? tk.customerVisibleTag : tk.internalTag}
                  </span>
                  <span className="ml-auto text-xs text-slate-400">{fmt(ev.occurredAt)}</span>
                </div>
                {ev.source === "manual" && <span className="text-[10px] uppercase tracking-wide text-slate-400">{tk.manualBadge}</span>}
                {ev.customerMessage && <p className="text-xs text-slate-600">{ev.customerMessage}</p>}
                {ev.internalNote && <p className="text-xs italic text-slate-400">{ev.internalNote}</p>}
              </li>
            ))}
          </ol>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </section>
  );
}
