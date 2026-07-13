/**
 * Coordinator process tower (Phase 5.0C) — a SECTION of the existing Control
 * Tower at /dashboard, not a competing dashboard.
 */
import Link from "next/link";
import type { ProcessTower, TowerBucket } from "@/lib/process/queues/control-tower";

function Group({ title, buckets }: { title: string; buckets: TowerBucket[] }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h3>
      <ul className="space-y-1">
        {buckets.map((b) => (
          <li key={b.key}>
            <Link
              href={b.href}
              className={`flex items-center justify-between rounded border px-2.5 py-1.5 text-sm transition hover:bg-slate-50 ${
                b.count > 0 ? "border-slate-200 text-slate-700" : "border-slate-100 text-slate-400"
              }`}
            >
              <span>{b.labelFr}</span>
              <span
                className={`tabular rounded px-1.5 text-xs font-semibold ${
                  b.count > 0 ? "bg-navy-50 text-navy-800" : "text-slate-300"
                }`}
              >
                {b.count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProcessTowerSection({ tower }: { tower: ProcessTower }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-navy-900">
          Tour de contrôle — Processus officiel Effitrans
        </h2>
        <p className="text-xs text-slate-500">
          Vue Coordinateur : réceptions, chaîne douane, convergence parallèle, après-livraison.
        </p>
      </header>
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Group title="Intake et transferts" buckets={tower.intake} />
        <Group title="Progression douane" buckets={tower.customs} />
        <Group title="Convergence parallèle" buckets={tower.parallel} />
        <Group title="Après livraison" buckets={tower.postDelivery} />
      </div>
    </section>
  );
}
