/**
 * Queue filters (Phase 5.0C, Deliverable 11) — plain links, no client state.
 * ---------------------------------------------------------------------------
 * Filtering and pagination happen SERVER-side. The browser never receives the
 * full dossier set, so a filter is a URL, not a client-side array scan.
 */
import Link from "next/link";

const chip =
  "rounded-full border px-3 py-1 text-xs font-medium transition hover:bg-slate-50";

export function QueueFilters({ queueKey }: { queueKey: string }) {
  const base = `/queues/${queueKey}`;
  const filters: { label: string; href: string }[] = [
    { label: "Tous", href: base },
    { label: "Non réceptionnés", href: `${base}?unreceived=1` },
    { label: "Bloqués", href: `${base}?blocked=1` },
    { label: "Non affectés", href: `${base}?unassigned=1` },
    { label: "Rejetés / correction", href: `${base}?rejected=1` },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((f) => (
        <Link key={f.label} href={f.href} className={`${chip} border-slate-200 text-slate-600`}>
          {f.label}
        </Link>
      ))}
      <form action={base} className="ml-auto">
        <input
          type="search"
          name="q"
          placeholder="Dossier ou client…"
          className="w-56 rounded border border-slate-200 px-3 py-1.5 text-xs focus:border-teal-400 focus:outline-none"
        />
      </form>
    </div>
  );
}
