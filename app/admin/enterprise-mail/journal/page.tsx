import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listCommunications } from "@/lib/comms/service";
import { CommunicationRow } from "@/components/mail/communication-row";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: "Journal technique des envois" };
export const dynamic = "force-dynamic";

/**
 * Administration → Enterprise Mail → Journal technique des envois.
 *
 * This surface used to BE `/mail` — the front door of the mail workspace was
 * the dispatch queue. EMP-IA-1 moved it here, because it answers an operator's
 * question, not an employee's: what is queued, what the provider accepted, what
 * failed, what was cancelled, what is being retried.
 *
 * IT IS NOT « Envoyés », AND THE TWO ARE DELIBERATELY NOT MERGED.
 *   Envoyés  — employee-facing. "The mail I sent", with its state.
 *   This     — operational. Queue mechanics, retries, provider errors.
 * They read the same `communication_message` rows; the difference is audience
 * and framing. There is no second store and no duplicated model.
 *
 * GATE: `communication:manage` — administrative authority, stricter than the
 * `communication:read` this page carried while it lived at /mail. That is a
 * deliberate NARROWING and the reason it is safe: every role that loses this
 * page keeps « Envoyés », which EMP-IA-1 widened to show queued, failed and
 * cancelled messages precisely so that moving this one takes nothing away.
 * No role gained anything, and no permission was created or widened.
 */
const STATUSES = ["QUEUED", "SENT", "FAILED", "CANCELLED"];

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function OutboundJournalPage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  const header = (
    <PageHeader
      meta="Administration · Enterprise Mail"
      title="Journal technique des envois"
      subtitle="File d'attente, acceptation par le fournisseur, échecs, annulations et relances."
    />
  );

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="space-y-6">{header}<Notice>{t.communications.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:manage")) notFound();

  const canSend = hasPermission(permissions, "communication:send");
  const status = searchParams?.status;
  const messages = await listCommunications(status ? { status } : undefined);
  const c = t.communications;

  const pill = (label: string, value: string | undefined) => {
    const active = status === value;
    return (
      <Link
        key={label}
        href={value ? `/admin/enterprise-mail/journal?status=${value}` : "/admin/enterprise-mail/journal"}
        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
          active
            ? "border-teal-500 bg-teal-50 text-teal-700"
            : "border-slate-200 bg-white text-slate-600 hover:border-teal-300"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="space-y-5">
      {header}

      {/* The distinction, stated where an operator will read it. */}
      <p className="surface p-4 text-[11px] text-slate-600">
        Ce journal est un outil d&apos;exploitation. Les utilisateurs consultent leurs propres
        messages sortants dans <span className="font-medium">Enterprise Mail → Envoyés</span>, avec
        leur état ; cette page ajoute la mécanique de file d&apos;attente, les relances et les
        erreurs du fournisseur.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {pill("Tous", undefined)}
        {STATUSES.map((s) => pill(c.status[s as keyof typeof c.status], s))}
      </div>

      {messages.length === 0 ? (
        <Notice>{c.empty}</Notice>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{c.columns.recipient}</th>
                <th className="px-4 py-3 font-semibold">{c.columns.template}</th>
                <th className="px-4 py-3 font-semibold">{c.columns.subject}</th>
                <th className="px-4 py-3 font-semibold">{c.columns.date}</th>
                <th className="px-4 py-3 font-semibold">{c.columns.status}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {messages.map((m) => (
                <CommunicationRow key={m.id} message={m} canSend={canSend} canManage />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
