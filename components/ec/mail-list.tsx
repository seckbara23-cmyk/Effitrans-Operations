import type { CommunicationMessage } from "@/lib/comms/types";
import { StatusBadge } from "@/components/ec/composer";

/**
 * Enterprise Mail — a list of outbound messages.
 *
 * Shared by Sent and Drafts so the two views cannot drift into describing the
 * same row differently. It renders what the reader returns and decides nothing:
 * no status is inferred, no delivery is implied, and the caller supplies the
 * honesty note appropriate to its filter.
 */
export function MailList({
  messages,
  emptyLabel,
  note,
}: {
  messages: CommunicationMessage[];
  emptyLabel: string;
  note?: string;
}) {
  return (
    <section className="surface overflow-hidden" aria-labelledby="mail-list-heading">
      <h2 id="mail-list-heading" className="sr-only">
        Messages
      </h2>

      {messages.length === 0 ? (
        <p className="p-6 text-sm text-slate-500">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {messages.map((m) => (
            <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-navy-900">{m.subject}</p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {m.recipientName ? `${m.recipientName} — ` : ""}
                  {m.recipientEmail}
                  {m.retryCount > 0 ? ` · ${m.retryCount} tentative(s)` : ""}
                </p>
                {/* A failure reason is operational text, shown to the operator
                    who can act on it. Provider secrets never reach this field. */}
                {m.lastError ? (
                  <p className="mt-0.5 text-[11px] text-amber-700">{m.lastError}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge status={m.status} />
                <time
                  dateTime={m.sentAt ?? m.createdAt}
                  className="tabular text-[11px] text-slate-400"
                >
                  {new Date(m.sentAt ?? m.createdAt).toLocaleString("fr-FR")}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}

      {note ? (
        <p className="border-t border-slate-100 px-4 py-3 text-[11px] text-slate-500">{note}</p>
      ) : null}
    </section>
  );
}
