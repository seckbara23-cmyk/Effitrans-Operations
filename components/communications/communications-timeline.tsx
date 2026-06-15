/**
 * Read-only communications timeline (Phase 1.14). Server-safe, presentational.
 * Used on the dossier page and the client detail page.
 */
import { t } from "@/lib/i18n";
import type { CommunicationMessage } from "@/lib/comms/types";

const STATUS_STYLE: Record<string, string> = {
  QUEUED: "bg-slate-100 text-slate-600",
  SENT: "bg-teal-50 text-teal-700",
  FAILED: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-400",
};

export function CommunicationsTimeline({ messages }: { messages: CommunicationMessage[] }) {
  const c = t.communications;
  if (messages.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-navy-900">{c.timeline}</h2>
      <div className="surface divide-y divide-slate-100">
        {messages.map((m) => (
          <div key={m.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
            <span className="text-navy-900">{c.templates[m.templateKey as keyof typeof c.templates] ?? m.templateKey}</span>
            <span className="text-xs text-slate-500">{m.recipientEmail}</span>
            <span className="text-xs text-slate-400">{m.createdAt.slice(0, 10)}</span>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[m.status]}`}>
              {c.status[m.status]}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
