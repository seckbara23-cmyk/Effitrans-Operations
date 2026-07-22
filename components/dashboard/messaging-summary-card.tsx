import Link from "next/link";
import type { MessagingDashboardSummary } from "@/lib/messaging/dashboard";

/**
 * Messaging Center summary card (Phase 8.7) — derived counts only, no invented
 * SLA metric (not enough real response-time history to claim one honestly yet).
 * Rendered only for messaging:manage holders, same convention as AdminPresenceCard.
 */
export function MessagingSummaryCard({ summary }: { summary: MessagingDashboardSummary }) {
  const cells: { label: string; value: number; tone: string }[] = [
    { label: "Demandes ouvertes", value: summary.openRequests, tone: "text-navy-900" },
    { label: "En attente d'Effitrans", value: summary.waitingEffitrans, tone: "text-amber-700" },
    { label: "En attente du client", value: summary.waitingCustomer, tone: "text-navy-900" },
    { label: "Urgentes", value: summary.urgentOpen, tone: summary.urgentOpen > 0 ? "text-red-700" : "text-navy-900" },
  ];
  return (
    <section className="surface p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy-900">Demandes clients (Messagerie)</h2>
        <Link href="/messages" className="text-xs font-medium text-teal-700 hover:underline">
          Ouvrir la messagerie →
        </Link>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label} className="rounded-lg border border-slate-100 bg-sand-50/40 p-3">
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className={`mt-1 tabular text-2xl font-bold ${c.tone}`}>{c.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
