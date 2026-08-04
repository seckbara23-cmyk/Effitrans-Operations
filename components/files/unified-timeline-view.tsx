"use client";

/**
 * UT-4 — the Unified Operational Timeline (client).
 *
 * It answers one question: **what has happened to this dossier, in what
 * PROVABLE order, and from which source?** Everything below serves that, and
 * the hardest part is the third word: where order is not provable, the UI must
 * say so rather than draw a line between two entries.
 *
 * It renders what the reader gives it and decides nothing about history —
 * ordering, grouping and provability all arrive settled.
 */
import { useCallback, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { loadTimelinePage } from "@/lib/unified-timeline/actions";
import {
  TIMELINE_FILTERS, FILTER_LABEL_FR, PLANE_LABEL_FR, NATURE_LABEL_FR,
  ORIGIN_LABEL_FR, CONFIDENCE_LABEL_FR, FRESHNESS_LABEL_FR,
  describeEntry, iconKeyFor, linkFor, UNPROVABLE_GROUP_NOTICE,
  type TimelineFilter,
} from "@/lib/unified-timeline/presentation";
import type { UnifiedEntry } from "@/lib/unified-timeline/merged";
import {
  IconHistory, IconRoute, IconQuote, IconMessage, IconDocument,
  IconFinance, IconStamp, IconTruck, IconTask,
} from "@/lib/icons";
import { cn } from "@/lib/cn";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  history: IconHistory, route: IconRoute, quote: IconQuote, message: IconMessage,
  document: IconDocument, finance: IconFinance, stamp: IconStamp,
  truck: IconTruck, task: IconTask,
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

export type TimelineViewProps = {
  dossierId: string;
  initialEntries: UnifiedEntry[];
  initialCursor: string | null;
  permissions: string[];
  /**
   * TRUE when the tenant has recorded HISTORICAL_EVENTS_NOT_BACKFILLED. When it
   * is false the timeline says so: an empty early period is NOT evidence of a
   * quiet period, and the UI must not let it read as one.
   */
  hasLedgerBoundary: boolean;
};

export function UnifiedTimelineView({
  dossierId, initialEntries, initialCursor, permissions, hasLedgerBoundary,
}: TimelineViewProps) {
  const [entries, setEntries] = useState(initialEntries);
  const [cursor, setCursor] = useState(initialCursor);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);

  const applyFilter = useCallback((next: TimelineFilter) => {
    setFilter(next);
    setFailed(false);
    start(async () => {
      const page = await loadTimelinePage({ dossierId, filter: next });
      setEntries(page.entries);
      setCursor(page.nextCursor);
    });
  }, [dossierId]);

  const loadMore = useCallback(() => {
    if (!cursor) return;
    setFailed(false);
    start(async () => {
      const page = await loadTimelinePage({ dossierId, cursor, filter });
      // Append, never re-sort: the previous page's order is already settled and
      // re-sorting on the client could reorder what the reader decided.
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.entryId));
        return [...prev, ...page.entries.filter((e) => !seen.has(e.entryId))];
      });
      setCursor(page.nextCursor);
      if (page.entries.length === 0 && page.nextCursor === null) setFailed(false);
    });
  }, [cursor, dossierId, filter]);

  /** Consecutive entries sharing a chronology group render as one block. */
  const groups = useMemo(() => {
    const out: UnifiedEntry[][] = [];
    for (const e of entries) {
      const last = out[out.length - 1];
      if (last && last[0].chronologyGroup === e.chronologyGroup) last.push(e);
      else out.push([e]);
    }
    return out;
  }, [entries]);

  return (
    <section className="surface overflow-hidden" aria-labelledby="ut-timeline-heading">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <h2 id="ut-timeline-heading" className="text-sm font-semibold text-navy-900">
          Journal opérationnel unifié
        </h2>
        <p className="text-[11px] text-slate-400">
          {entries.length} évènement{entries.length > 1 ? "s" : ""} affiché
          {entries.length > 1 ? "s" : ""}
        </p>
      </div>

      {/* Filters. They narrow what is SHOWN, never what is true. */}
      <div
        role="group"
        aria-label="Filtrer le journal par domaine"
        className="flex flex-wrap gap-1.5 border-b border-slate-100 px-4 py-2"
      >
        {TIMELINE_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => applyFilter(f)}
            aria-pressed={filter === f}
            disabled={pending}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50",
              filter === f
                ? "bg-navy-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200",
            )}
          >
            {FILTER_LABEL_FR[f]}
          </button>
        ))}
      </div>

      {entries.length === 0 ? (
        <EmptyTimeline filter={filter} pending={pending} />
      ) : (
        <ol className="divide-y divide-slate-100">
          {groups.map((group) => (
            <li key={group[0].chronologyGroup}>
              {group.length > 1 ? (
                <ChronologyGroup entries={group} permissions={permissions} />
              ) : (
                <Entry entry={group[0]} permissions={permissions} />
              )}
            </li>
          ))}
        </ol>
      )}

      <div className="border-t border-slate-100 px-4 py-3">
        {cursor ? (
          <button
            type="button"
            onClick={loadMore}
            disabled={pending}
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-navy-900 hover:bg-slate-200 disabled:opacity-50"
          >
            {pending ? "Chargement…" : "Charger les évènements plus anciens"}
          </button>
        ) : (
          <p className="text-[11px] text-slate-400" role="status">
            {hasLedgerBoundary
              ? "Début du journal enregistré pour ce client."
              : // The honest statement when no boundary marker exists.
                "Fin des évènements enregistrés. L'absence d'évènement plus ancien ne signifie pas qu'il ne s'est rien passé : le journal ne couvre que la période où son enregistrement était garanti."}
          </p>
        )}
        {failed ? (
          <p className="mt-2 text-[11px] text-amber-700" role="alert">
            Une partie du journal n&apos;a pas pu être chargée. Ce qui est affiché reste exact.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Entries stamped at the same instant whose relative order was never recorded.
 *
 * Rendered as a bracketed block with an explicit sentence, and deliberately
 * WITHOUT the ordered-list numbering or connector the single entries use —
 * any visual that reads as "first, then" would be the invented sequence the
 * whole architecture exists to prevent.
 */
function ChronologyGroup({
  entries, permissions,
}: {
  entries: UnifiedEntry[];
  permissions: string[];
}) {
  return (
    <div className="border-l-2 border-dashed border-amber-300 bg-amber-50/30">
      <p className="px-4 pt-3 text-[11px] text-amber-800">{UNPROVABLE_GROUP_NOTICE}</p>
      <ul className="divide-y divide-amber-100/60">
        {entries.map((e) => (
          <li key={e.entryId}>
            <Entry entry={e} permissions={permissions} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Entry({ entry, permissions }: { entry: UnifiedEntry; permissions: string[] }) {
  const Icon = ICONS[iconKeyFor(entry)] ?? IconHistory;
  const link = linkFor(entry, permissions);
  const isObservation = entry.plane === "observation";

  return (
    <article className="flex gap-3 px-4 py-3" aria-label={describeEntry(entry)}>
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          isObservation ? "bg-sand-100 text-amber-700" : "bg-navy-50 text-navy-900",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p
            className={cn(
              "text-sm text-navy-900",
              // Decision entries carry more emphasis than observations: a
              // committed decision and a carrier's report are not equally firm.
              isObservation ? "font-normal" : "font-semibold",
            )}
          >
            {entry.label}
          </p>
          <time dateTime={entry.occurredAt} className="tabular shrink-0 text-xs text-slate-400">
            {formatWhen(entry.occurredAt)}
          </time>
        </div>

        {/* Every badge below repeats in text what the styling suggests, so no
            meaning depends on colour. */}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
          <Badge>{PLANE_LABEL_FR[entry.plane]}</Badge>
          <span>{NATURE_LABEL_FR[entry.nature]}</span>
          <span aria-hidden>·</span>
          <span>{ORIGIN_LABEL_FR[entry.origin]}</span>
          {/* A missing actor is stated, never hidden. The old component said
              "Auteur non enregistré" for both cases; they are different facts:
              no actorId means the domain records none (already conveyed by
              "Automatique"), while an actorId we could not resolve to a name is
              a directory limit and says so. */}
          {entry.actorName ? (
            <>
              <span aria-hidden>·</span>
              <span>{entry.actorName}</span>
            </>
          ) : entry.actorId ? (
            <>
              <span aria-hidden>·</span>
              <span>Auteur non identifié</span>
            </>
          ) : entry.plane === "decision" ? (
            <>
              <span aria-hidden>·</span>
              <span>Auteur non enregistré</span>
            </>
          ) : null}
          {entry.observationSource ? (
            <>
              <span aria-hidden>·</span>
              <span>{entry.observationSource}</span>
            </>
          ) : null}
          {entry.confidence ? (
            <Badge tone="amber">
              {CONFIDENCE_LABEL_FR[entry.confidence] ?? entry.confidence}
            </Badge>
          ) : null}
          {entry.freshness ? (
            <span>{FRESHNESS_LABEL_FR[entry.freshness] ?? entry.freshness}</span>
          ) : null}
          {entry.locationName ? (
            <>
              <span aria-hidden>·</span>
              <span>{entry.locationName}</span>
            </>
          ) : null}
          {entry.clientSafe ? <Badge tone="teal">Visible client</Badge> : null}
        </p>

        {link ? (
          <Link
            href={link.href}
            className="mt-1 inline-block text-xs text-teal-700 hover:underline"
          >
            {link.label}
          </Link>
        ) : null}
      </div>
    </article>
  );
}

function Badge({
  children, tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "amber" | "teal";
}) {
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium",
        tone === "amber" && "bg-amber-100 text-amber-800",
        tone === "teal" && "bg-teal-50 text-teal-700",
        tone === "slate" && "bg-slate-100 text-slate-700",
      )}
    >
      {children}
    </span>
  );
}

function EmptyTimeline({ filter, pending }: { filter: TimelineFilter; pending: boolean }) {
  if (pending) {
    return (
      <div className="space-y-2 p-4" role="status" aria-live="polite">
        <span className="sr-only">Chargement du journal</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }
  return (
    <p className="p-6 text-center text-sm text-slate-500">
      {filter === "all"
        ? "Aucun évènement enregistré pour ce dossier."
        : filter === "tracking"
          ? "Aucune observation de suivi pour ce dossier."
          : `Aucun évènement ne correspond au filtre « ${FILTER_LABEL_FR[filter]} ».`}
    </p>
  );
}
