"use client";

/**
 * Period selection. A plain GET form — the period lives in the URL, so a
 * management view is linkable, bookmarkable and reproducible by whoever it is
 * sent to. No client state, and no client clock: `today` arrives from the
 * server so the default anchor is business time.
 */
import { useState } from "react";
import type { PerformancePeriod } from "@/lib/performance/period";

export function PeriodPicker({ current, today }: { current: PerformancePeriod; today: string }) {
  const [kind, setKind] = useState(current.kind);

  return (
    <form method="get" className="surface flex flex-wrap items-end gap-3 p-4">
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        Période
        <select
          name="type"
          value={kind}
          onChange={(e) => setKind(e.target.value as PerformancePeriod["kind"])}
          className="rounded-md border border-slate-200 px-2 py-1 text-sm"
        >
          <option value="MONTH">Mois</option>
          <option value="QUARTER">Trimestre</option>
          <option value="YEAR">Année</option>
          <option value="CUSTOM">Période personnalisée</option>
        </select>
      </label>

      {kind === "CUSTOM" ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Du
            <input
              type="date"
              name="from"
              defaultValue={current.startISO}
              className="rounded-md border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Au
            <input
              type="date"
              name="to"
              defaultValue={current.endISO}
              className="rounded-md border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Date de référence
          <input
            type="date"
            name="anchor"
            defaultValue={current.startISO > today ? today : current.startISO}
            className="rounded-md border border-slate-200 px-2 py-1 text-sm"
          />
        </label>
      )}

      <button
        type="submit"
        className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800"
      >
        Appliquer
      </button>
    </form>
  );
}
