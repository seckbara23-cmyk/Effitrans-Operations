/**
 * "Parcours des dossiers" (Phase 5.0E-3, Deliverables 4 + 5).
 * ---------------------------------------------------------------------------
 * Where is every dossier in the official process, and who holds it?
 *
 * NOT a role queue. A queue answers "what is waiting on me"; this answers "what is
 * happening". It is the Coordinator's map, and the only staff surface that shows a
 * dossier nobody in the room is personally working on.
 *
 * Reading this page initializes NOTHING. Legacy dossiers appear, honestly labelled
 * "Non initialisé".
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { getJourneys, type JourneyFilter, type JourneyRow } from "@/lib/process/journeys/service";
import { JOURNEY_MILESTONES } from "@/lib/process/journeys/milestones";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Parcours des dossiers" };

const FILTERS: { key: JourneyFilter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "blocked", label: "Bloqués" },
  { key: "awaiting_reception", label: "À réceptionner" },
  { key: "customs_branch", label: "Branche douane" },
  { key: "transport_branch", label: "Branche transport" },
  { key: "pickup_ready", label: "Prêts à enlever" },
  { key: "delivered", label: "Livrés" },
  { key: "billing", label: "Facturation" },
  { key: "collections", label: "Recouvrement" },
  { key: "closed", label: "Clôturés" },
  { key: "uninitialized", label: "Non initialisés" },
];

const MILESTONE_TONE: Record<string, string> = {
  completed: "bg-emerald-500",
  active: "bg-blue-500",
  blocked: "bg-red-500",
  rejected: "bg-amber-500",
  pending: "bg-slate-200",
};

const MILESTONE_TITLE: Record<string, string> = {
  completed: "Terminé",
  active: "En cours",
  blocked: "Bloqué",
  rejected: "Rejeté — correction en cours",
  pending: "Pas encore atteint",
};

/** The compact 15-milestone strip. Derived from the canonical registry. */
function JourneyStrip({ row }: { row: JourneyRow }) {
  if (!row.initialized) {
    return (
      <div className="flex h-2 items-center gap-0.5">
        {JOURNEY_MILESTONES.map((m) => (
          <span
            key={m.key}
            title={`${m.labelFr} — dossier non initialisé`}
            className="h-2 flex-1 rounded-sm bg-slate-100"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-2 items-center gap-0.5" role="img" aria-label="Progression du parcours officiel">
      {row.milestones.map((m) => (
        <span
          key={m.key}
          title={`${m.labelFr} — ${MILESTONE_TITLE[m.state]}${m.branch ? ` (branche ${m.branch === "customs" ? "douane" : "transport"})` : ""}`}
          className={cn("h-2 flex-1 rounded-sm", MILESTONE_TONE[m.state])}
        />
      ))}
    </div>
  );
}

function Row({ row }: { row: JourneyRow }) {
  return (
    <li className="border-b border-slate-100 py-3 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <Link
              href={`/files/${row.fileId}`}
              className="tabular text-sm font-semibold text-navy-900 hover:text-teal-700"
            >
              {row.fileNumber}
            </Link>
            <span className="truncate text-xs text-slate-500">{row.clientName}</span>

            {!row.initialized && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600">
                Non initialisé
              </span>
            )}
            {row.postDelivery.closed && (
              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-700">
                Clôturé
              </span>
            )}
            {row.awaitingReception && (
              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700">
                À réceptionner
              </span>
            )}
            {row.branches.activeBranch === "customs" && (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                branche douane
              </span>
            )}
            {row.branches.activeBranch === "transport" && (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                branche transport
              </span>
            )}
            {row.branches.activeBranch === "both" && (
              <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                douane + transport
              </span>
            )}
          </div>

          <p className="mt-0.5 truncate text-xs text-slate-600">
            {row.initialized && row.currentStepNumber
              ? `Étape ${row.currentStepNumber} · ${row.currentStepLabel}`
              : row.nextAction}
            {row.phaseLabel && <span className="text-slate-400"> · {row.phaseLabel}</span>}
          </p>

          <p className="truncate text-xs text-slate-500">
            {row.responsibleRoleLabel ?? "Aucun responsable"}
            {row.ownerName && <span className="text-slate-400"> · {row.ownerName}</span>}
            {row.blocker && <span className="ml-1 text-red-600">· {row.blocker}</span>}
          </p>

          <div className="mt-2 max-w-md">
            <JourneyStrip row={row} />
          </div>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-xs text-slate-400">{row.ageDays} j</p>
          {row.priority !== "normal" && (
            <p className="text-[11px] font-semibold uppercase text-amber-700">{row.priority}</p>
          )}
          {row.initialized && (
            <Link
              href={`/files/${row.fileId}/process`}
              className="mt-1 inline-block rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
            >
              Détail
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

export default async function JourneysPage({
  searchParams,
}: {
  searchParams?: { filter?: string; q?: string; page?: string };
}) {
  // Kill switch first (no query), then the TENANT gate.
  if (!globalKillSwitch().workspaces) notFound();

  const user = await requireUser();
  if (!(await getTenantProcessFlags(user.tenantId)).workspaces) notFound();

  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "process:read")) notFound();

  const filter = (FILTERS.find((f) => f.key === searchParams?.filter)?.key ?? "all") as JourneyFilter;
  const search = searchParams?.q ?? "";
  const page = Math.max(1, Number(searchParams?.page ?? 1) || 1);

  const result = await getJourneys({
    tenantId: user.tenantId,
    userId: user.id,
    permissions,
    filter,
    search,
    page,
    pageSize: 25,
  });

  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ filter, ...(search ? { q: search } : {}), ...over });
    return `/journeys?${p.toString()}`;
  };

  return (
    <main className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-navy-900">Parcours des dossiers</h1>
        <p className="text-sm text-slate-600">
          Où en est chaque dossier dans le processus officiel · {result.total} dossier(s)
        </p>
      </header>

      {result.capped && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Plus de 500 dossiers correspondent. Seuls les 500 plus récents sont analysés — affinez la
          recherche pour couvrir le reste. (Nous préférons le dire plutôt que présenter une liste
          tronquée comme si elle était complète.)
        </div>
      )}

      <form method="get" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="filter" value={filter} />
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Numéro de dossier ou client"
          className="w-64 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
        />
        <button
          type="submit"
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-navy-700 hover:bg-slate-50"
        >
          Rechercher
        </button>
      </form>

      <nav className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2" aria-label="Filtres">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/journeys?filter=${f.key}${search ? `&q=${encodeURIComponent(search)}` : ""}`}
            aria-current={f.key === filter ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500",
              f.key === filter
                ? "bg-navy-900 text-white"
                : "text-slate-600 hover:bg-slate-100 hover:text-navy-900",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {/* The legend for the 15-milestone strip. */}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
        <span className="font-medium text-slate-600">Parcours officiel :</span>
        {(["completed", "active", "blocked", "rejected", "pending"] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className={cn("h-2 w-4 rounded-sm", MILESTONE_TONE[s])} />
            {MILESTONE_TITLE[s]}
          </span>
        ))}
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4">
        {result.rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">Aucun dossier pour ce filtre.</p>
        ) : (
          <ul>
            {result.rows.map((r) => (
              <Row key={r.fileId} row={r} />
            ))}
          </ul>
        )}
      </section>

      {pages > 1 && (
        <nav className="flex items-center justify-between text-sm" aria-label="Pagination">
          <Link
            href={qs({ page: String(Math.max(1, page - 1)) })}
            aria-disabled={page === 1}
            className={cn(
              "rounded-lg border border-slate-200 px-3 py-1.5",
              page === 1 ? "pointer-events-none opacity-40" : "hover:bg-slate-50",
            )}
          >
            Précédent
          </Link>
          <span className="text-slate-500">
            Page {page} / {pages}
          </span>
          <Link
            href={qs({ page: String(Math.min(pages, page + 1)) })}
            aria-disabled={page === pages}
            className={cn(
              "rounded-lg border border-slate-200 px-3 py-1.5",
              page === pages ? "pointer-events-none opacity-40" : "hover:bg-slate-50",
            )}
          >
            Suivant
          </Link>
        </nav>
      )}
    </main>
  );
}
