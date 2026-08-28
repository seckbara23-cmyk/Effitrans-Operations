"use client";

/**
 * Draft a report for the period currently displayed.
 *
 * The period is passed through from the server-resolved view, so the report a
 * user creates covers exactly what they were looking at — no second period
 * selection to disagree with the first.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createReport } from "@/lib/performance/report-actions";
import { sayReport } from "@/lib/performance/report-types";
import type { PerformancePeriod } from "@/lib/performance/period";

export function CreateReportForm({ period }: { period: PerformancePeriod }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(`Rapport de Performance — ${period.label}`);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createReport({
        title,
        periodType: period.kind,
        anchor: period.startISO,
        from: period.startISO,
        to: period.endISO,
      });
      if (!res.ok) setError(sayReport(res.error));
      else router.push(`/performance/rapports/${res.id}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2 border-b border-slate-100 pb-4">
      <label className="flex min-w-[18rem] flex-1 flex-col gap-1 text-xs text-slate-600">
        Titre du rapport
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="rounded-md border border-slate-200 px-2 py-1 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending || title.trim() === ""}
        className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
      >
        {pending ? "Création…" : "Préparer un rapport"}
      </button>
      {error ? (
        <p role="alert" className="w-full text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </form>
  );
}
