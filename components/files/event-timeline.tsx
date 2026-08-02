/**
 * Dossier business-event timeline (Phase WES-9L). Server component, read-only.
 * ---------------------------------------------------------------------------
 * Renders the canonical operational history of one dossier. Presentation only:
 * it has no actions, no forms and no links that mutate anything — the ledger
 * records history and authorizes nothing, and the UI says the same.
 *
 * It also does not pretend to be complete. WES-9 integrates the actions whose
 * writes are transactionally safe today; handoffs, expense visas and document
 * sharing are not among them. The footnote states that plainly rather than
 * letting an operator read an incomplete list as the whole story.
 */
import { readDossierTimeline, type TimelineEvent } from "@/lib/workflow/events/readers";
import type { EventDomain } from "@/lib/workflow/events/types";

const DOMAIN_TONE: Record<EventDomain, string> = {
  dossier: "bg-navy-900",
  document: "bg-sky-600",
  customs: "bg-amber-600",
  transport: "bg-teal-700",
  task: "bg-slate-400",
  handoff: "bg-slate-400",
  finance: "bg-emerald-700",
  policy: "bg-violet-600",
  ledger: "bg-slate-300",
  process: "bg-indigo-600",
  // EC-2: customer correspondence attached to this dossier — the communication
  // dimension of the shipment timeline.
  communication: "bg-rose-600",
  // EC-3B: the commercial provenance of this dossier.
  commercial: "bg-amber-700",
};

const METADATA_LABELS: Record<string, string> = {
  previous_status: "Depuis",
  new_status: "Vers",
  file_number: "N°",
  file_type: "Type",
  type_code: "Document",
  reference: "Référence",
  required: "Requis",
  priority: "Priorité",
  method: "Moyen",
  scope: "Portée",
  version: "Version",
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function MetadataChips({ metadata }: { metadata: TimelineEvent["metadata"] }) {
  const entries = Object.entries(metadata);
  if (entries.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {entries.map(([key, value]) => (
        <span
          key={key}
          className="rounded bg-sand-50 px-1.5 py-0.5 text-[11px] text-slate-600"
        >
          <span className="text-slate-400">{METADATA_LABELS[key] ?? key} </span>
          <span className="font-medium">{String(value)}</span>
        </span>
      ))}
    </div>
  );
}

export async function EventTimeline({ fileId }: { fileId: string }) {
  const events = await readDossierTimeline(fileId);

  return (
    <section className="surface overflow-hidden">
      <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-navy-900">
        Journal opérationnel
      </h2>

      {events.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">
          Aucun événement enregistré pour ce dossier.
        </p>
      ) : (
        <ol className="divide-y divide-slate-100">
          {events.map((event) => (
            <li key={event.id} className="flex gap-3 px-4 py-3">
              <span
                aria-hidden
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOMAIN_TONE[event.domain]}`}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="text-sm font-medium text-navy-900">{event.labelFr}</p>
                  <time
                    dateTime={event.occurredAt}
                    className="tabular shrink-0 text-xs text-slate-400"
                  >
                    {formatWhen(event.occurredAt)}
                  </time>
                </div>
                <p className="text-xs text-slate-500">
                  {/* NULL actor is shown honestly, never replaced by a guess. */}
                  {event.actorName ?? "Auteur non enregistré"}
                </p>
                <MetadataChips metadata={event.metadata} />
              </div>
            </li>
          ))}
        </ol>
      )}

      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
        Journal en lecture seule et inaltérable. Il couvre les actions dont
        l&apos;enregistrement est garanti par la base de données ; les transferts inter-services
        et les visas de dépense n&apos;y figurent pas encore.
      </p>
    </section>
  );
}
