import {
  CUSTOMER_SOURCE_LABEL_FR, CUSTOMER_UNPROVABLE_NOTICE,
  describeCustomerEntry, iconKeyFor, isUnconfirmed,
} from "@/lib/unified-timeline/presentation";
import type { UnifiedEntry } from "@/lib/unified-timeline/merged";
import { formatDayMonth } from "@/lib/portal/shipment-view";
import { t } from "@/lib/i18n";
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

/**
 * UT-5 — the customer's operational history.
 *
 * ABSORBED, not rebuilt. This component previously rendered `tracking.activity`,
 * which `buildTimeline` assembled from the dossier's creation date plus the
 * customer's own NOTIFICATION rows, de-duplicated by title. That was a record of
 * what we had emailed the customer, presented as a record of what had happened.
 * It was also derived from current module state, so it could not express the one
 * thing this programme insists on: when the platform does not know an order.
 *
 * It now renders the same projection as the internal timeline, narrowed by
 * `toClientSafe`. The customer sees FEWER entries than staff — never different
 * ones, and never a firmer sequence than the ledger can prove.
 */
export function DossierTimeline({ entries }: { entries: UnifiedEntry[] }) {
  const P = t.portal.progress;

  // Consecutive entries sharing a chronology group render as one block.
  const groups: UnifiedEntry[][] = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && last[0].chronologyGroup === e.chronologyGroup) last.push(e);
    else groups.push([e]);
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
      <h2 className="mb-4 text-sm font-semibold text-navy-900">{P.activityTitle}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">{t.portal.notify.center.empty}</p>
      ) : (
        <ol className="space-y-4">
          {groups.map((group) => (
            <li key={group[0].chronologyGroup}>
              {group.length > 1 ? (
                <div className="rounded-xl border-l-2 border-dashed border-amber-300 bg-amber-50/40 py-2 pl-3">
                  <p className="mb-2 text-xs text-amber-800">{CUSTOMER_UNPROVABLE_NOTICE}</p>
                  {/* No <ol> here: numbering simultaneous events would itself
                      assert the sequence we have just said we do not know. */}
                  <ul className="space-y-3">
                    {group.map((e) => (
                      <li key={e.entryId}><Entry entry={e} /></li>
                    ))}
                  </ul>
                </div>
              ) : (
                <Entry entry={group[0]} />
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Entry({ entry }: { entry: UnifiedEntry }) {
  const Icon = ICONS[iconKeyFor(entry)] ?? IconHistory;
  const isObservation = entry.plane === "observation";

  return (
    <article className="flex gap-3" aria-label={describeCustomerEntry(entry)}>
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2 ring-white",
          isObservation ? "bg-sand-100 text-amber-700" : "bg-teal-50 text-teal-700",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-xs font-medium text-slate-400">{formatDayMonth(entry.occurredAt)}</p>
        <p className="text-sm text-navy-900">{entry.label}</p>
        {/* The source is stated in words, never by colour alone: a carrier's
            report and a step Effitrans confirmed are not equally firm. */}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
          <span>{CUSTOMER_SOURCE_LABEL_FR[entry.plane]}</span>
          {entry.locationName ? (
            <>
              <span aria-hidden>·</span>
              <span>{entry.locationName}</span>
            </>
          ) : null}
          {isObservation && isUnconfirmed(entry.confidence) ? (
            <>
              <span aria-hidden>·</span>
              <span className="text-amber-700">Non confirmé</span>
            </>
          ) : null}
        </p>
      </div>
    </article>
  );
}
