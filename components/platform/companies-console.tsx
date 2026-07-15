"use client";

/**
 * Companies console table (Phase 6.0C). CLIENT — thin renderer over table.ts.
 * ---------------------------------------------------------------------------
 * Search / filter / sort / paginate are interactive, so this is a client component;
 * but it holds NO authorization and does NO fetching. It renders the already-safe,
 * already-bounded ConsoleRow[] the server read and passed in, and every operation is
 * the pure logic from lib/platform/console/table.ts. Nothing here can widen what the
 * server chose to expose.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import {
  queryConsole,
  type ConsoleRow,
  type ConsoleFilter,
  type SortKey,
  type SortDir,
} from "@/lib/platform/console/table";
import { lifecycleBadge, onboardingBadge, HEALTH_BADGES, TONE_CLASS } from "@/lib/platform/console/badges";
import { PLAN_KEYS } from "@/lib/platform/entitlements";
import { LIFECYCLE_STATUSES, ONBOARDING_STATUSES } from "@/lib/platform/company-metadata";

const PAGE_SIZE = 20;

function Badge({ label, tone }: { label: string; tone: keyof typeof TONE_CLASS }) {
  return (
    <span className={cn("inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium", TONE_CLASS[tone])}>
      {label}
    </span>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-200 focus:border-teal-400 focus:outline-none"
      >
        <option value="">{label}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-navy-950">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CompaniesConsole({ rows }: { rows: ConsoleRow[] }) {
  const [filter, setFilter] = useState<ConsoleFilter>({});
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(1);

  const result = useMemo(
    () => queryConsole(rows, { filter, sortKey, sortDir, page, pageSize: PAGE_SIZE }),
    [rows, filter, sortKey, sortDir, page],
  );

  function patch(p: Partial<ConsoleFilter>) {
    setFilter((f) => ({ ...f, ...p }));
    setPage(1);
  }
  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  const Th = ({ label, k }: { label: string; k?: SortKey }) => (
    <th scope="col" className="px-3 py-2.5 text-left font-semibold">
      {k ? (
        <button
          type="button"
          onClick={() => sortBy(k)}
          className="inline-flex items-center gap-1 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          aria-label={`Trier par ${label}`}
        >
          {label}
          {sortKey === k && <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span>}
        </button>
      ) : (
        label
      )}
    </th>
  );

  return (
    <div className="space-y-4">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={filter.search ?? ""}
          onChange={(e) => patch({ search: e.target.value })}
          placeholder="Rechercher (nom, slug, e-mail admin)"
          aria-label="Rechercher une entreprise"
          className="min-w-[16rem] flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-400/30"
        />
        <Select
          label="Statut"
          value={filter.status ?? ""}
          onChange={(v) => patch({ status: v || undefined })}
          options={LIFECYCLE_STATUSES.map((s) => ({ value: s, label: lifecycleBadge(s).label }))}
        />
        <Select
          label="Plan"
          value={filter.plan ?? ""}
          onChange={(v) => patch({ plan: v || undefined })}
          options={PLAN_KEYS.map((p) => ({ value: p, label: p }))}
        />
        <Select
          label="Onboarding"
          value={filter.onboarding ?? ""}
          onChange={(v) => patch({ onboarding: v || undefined })}
          options={ONBOARDING_STATUSES.map((s) => ({ value: s, label: onboardingBadge(s).label }))}
        />
        <Select
          label="Santé"
          value={filter.health ?? ""}
          onChange={(v) => patch({ health: (v || undefined) as ConsoleFilter["health"] })}
          options={(["healthy", "attention", "setup"] as const).map((h) => ({ value: h, label: HEALTH_BADGES[h].label }))}
        />
        <Select
          label="Déploiement"
          value={filter.rollout ?? ""}
          onChange={(v) => patch({ rollout: (v || undefined) as ConsoleFilter["rollout"] })}
          options={[
            { value: "live", label: "Actif" },
            { value: "off", label: "Inactif" },
          ]}
        />
      </div>

      <p className="text-xs text-slate-500">
        {result.total} entreprise(s){filter.search || Object.keys(filter).length > 1 ? " (filtré)" : ""}
      </p>

      {result.total === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-10 text-center text-slate-400">
          Aucune entreprise ne correspond à ces critères.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full divide-y divide-white/10 text-sm">
            <thead className="bg-white/5 text-[12px] uppercase tracking-wide text-slate-400">
              <tr>
                <Th label="Entreprise" k="company" />
                <Th label="Statut" k="status" />
                <Th label="Plan" k="plan" />
                <Th label="Essai" />
                <Th label="Onboarding" />
                <Th label="Utilisateurs" k="users" />
                <Th label="Déploiement" />
                <Th label="Santé" />
                <Th label="Créée" k="created" />
                <Th label="Activité" k="lastActivity" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {result.items.map((r) => {
                const c = r.company;
                const lc = lifecycleBadge(c.lifecycleStatus);
                const ob = onboardingBadge(c.onboardingStatus);
                const hb = HEALTH_BADGES[r.health.level];
                return (
                  <tr key={c.id} className="hover:bg-white/5">
                    <td className="px-3 py-2.5">
                      <Link href={`/platform/companies/${c.id}`} className="font-semibold text-white hover:text-teal-300">
                        {c.displayName}
                      </Link>
                      <span className="ml-2 font-mono text-[11px] text-slate-500">{c.slug ?? "—"}</span>
                    </td>
                    <td className="px-3 py-2.5"><Badge label={lc.label} tone={lc.tone} /></td>
                    <td className="px-3 py-2.5 text-slate-300">{c.planKey ?? "—"}</td>
                    <td className="px-3 py-2.5 text-slate-400">
                      {r.trial.onTrial
                        ? r.trial.expired
                          ? <span className="text-red-300">expiré</span>
                          : `${r.trial.daysLeft} j`
                        : "—"}
                    </td>
                    <td className="px-3 py-2.5"><Badge label={ob.label} tone={ob.tone} /></td>
                    <td className="px-3 py-2.5 text-slate-300 tabular">{c.userCount}</td>
                    <td className="px-3 py-2.5">
                      <Badge label={r.rolloutLive ? "Actif" : "Inactif"} tone={r.rolloutLive ? "green" : "slate"} />
                    </td>
                    <td className="px-3 py-2.5"><Badge label={hb.label} tone={hb.tone} /></td>
                    <td className="px-3 py-2.5 text-slate-400">{c.createdAt.slice(0, 10)}</td>
                    <td className="px-3 py-2.5 text-slate-400">{c.lastTenantLoginAt ? c.lastTenantLoginAt.slice(0, 10) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.totalPages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={result.page === 1}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-slate-200 hover:bg-white/5 disabled:opacity-40"
          >
            Précédent
          </button>
          <span className="text-slate-500">Page {result.page} / {result.totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(result.totalPages, p + 1))}
            disabled={result.page === result.totalPages}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-slate-200 hover:bg-white/5 disabled:opacity-40"
          >
            Suivant
          </button>
        </nav>
      )}
    </div>
  );
}
