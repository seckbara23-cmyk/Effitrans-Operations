"use client";

/**
 * Calendrier de travail — the HR-maintained non-worked days.
 *
 * AUTHORITY IS NOT IN THIS COMPONENT. `canManage` only decides whether the form
 * is drawn; `addCalendarDay` and `removeCalendarDay` each assert `hr:manage`
 * server-side, and `hr_calendar_day` has no RLS write policy at all, so those
 * actions are the boundary. A management user reading Gestion de la Performance
 * sees the calendar and cannot change it — which is the D3 ruling: HR owns the
 * calendar, and reading performance confers nothing.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addCalendarDay, removeCalendarDay, type CalendarDayRow } from "@/lib/hr/calendar-actions";

const KIND_LABEL: Record<string, string> = {
  PUBLIC_HOLIDAY: "Jour férié",
  COMPANY_CLOSURE: "Fermeture Effitrans",
};
const KIND_STYLE: Record<string, string> = {
  PUBLIC_HOLIDAY: "bg-sky-50 text-sky-700",
  COMPANY_CLOSURE: "bg-violet-50 text-violet-700",
};

/** Refusals, in the operator's language. */
const MESSAGES: Record<string, string> = {
  forbidden: "Seules les RH peuvent modifier le calendrier de travail.",
  invalid_day: "Date invalide.",
  invalid_kind: "Type de jour invalide.",
  label_required: "Un intitulé est obligatoire : un jour non travaillé doit dire pourquoi.",
  day_exists: "Ce jour est déjà inscrit au calendrier — un jour ne porte qu'une seule décision.",
  not_found: "Cette entrée n'existe plus.",
};
const say = (code: string) => MESSAGES[code] ?? "Action refusée.";

export function CalendarEditor({
  year,
  days,
  canManage,
}: {
  year: number;
  days: CalendarDayRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(say(res.error ?? ""));
      else router.refresh();
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    run(async () => {
      const res = await addCalendarDay({
        day: String(fd.get("day") ?? ""),
        kind: String(fd.get("kind") ?? "PUBLIC_HOLIDAY") as "PUBLIC_HOLIDAY" | "COMPANY_CLOSURE",
        label: String(fd.get("label") ?? ""),
      });
      if (res.ok) form.reset();
      return res;
    });
  }

  return (
    <div className="space-y-4">
      {canManage ? (
        <form onSubmit={onSubmit} className="surface grid grid-cols-1 gap-3 p-4 sm:grid-cols-4">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Date
            <input
              type="date"
              name="day"
              required
              defaultValue={`${year}-01-01`}
              className="rounded-md border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Type
            <select name="kind" className="rounded-md border border-slate-200 px-2 py-1 text-sm">
              <option value="PUBLIC_HOLIDAY">Jour férié</option>
              <option value="COMPANY_CLOSURE">Fermeture Effitrans</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-slate-600 sm:col-span-2">
            Intitulé
            <input
              name="label"
              required
              placeholder="Fête de l'Indépendance"
              className="rounded-md border border-slate-200 px-2 py-1 text-sm"
            />
          </label>
          <div className="sm:col-span-4">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
            >
              {pending ? "Enregistrement…" : "Ajouter au calendrier"}
            </button>
          </div>
        </form>
      ) : (
        <p className="surface p-4 text-xs text-slate-500">
          Lecture seule. Le calendrier de travail est maintenu par les Ressources humaines.
        </p>
      )}

      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}

      {days.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-500">
          Aucun jour non travaillé enregistré pour {year}. Tant que le calendrier est vide, les
          délais et les jours travaillés ne retirent que les samedis et dimanches.
        </div>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Intitulé</th>
                {canManage ? <th className="px-4 py-3" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {days.map((d) => (
                <tr key={d.id}>
                  <td className="px-4 py-3 font-mono text-xs text-navy-900">{d.day}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${KIND_STYLE[d.kind]}`}>
                      {KIND_LABEL[d.kind]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{d.label}</td>
                  {canManage ? (
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => run(() => removeCalendarDay(d.id))}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      >
                        Retirer
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
