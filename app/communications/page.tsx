import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listCommunications } from "@/lib/comms/service";
import { CommunicationRow } from "@/components/communications/communication-row";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.communications.title };
export const dynamic = "force-dynamic";

const STATUSES = ["QUEUED", "SENT", "FAILED", "CANCELLED"];

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function CommunicationsPage({ searchParams }: { searchParams?: { status?: string } }) {
  const header = <PageHeader meta="Administration" title={t.communications.title} subtitle={t.communications.subtitle} />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.communications.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "communication:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.communications.forbidden}</Notice></div>;
  }

  const canSend = hasPermission(permissions, "communication:send");
  const canManage = hasPermission(permissions, "communication:manage");
  const status = searchParams?.status;
  const messages = await listCommunications(status ? { status } : undefined);
  const c = t.communications;

  const pill = (label: string, value: string | undefined) => {
    const active = status === value;
    return (
      <Link
        key={label}
        href={value ? `/communications?status=${value}` : "/communications"}
        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${active ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600 hover:border-teal-300"}`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="animate-fade-in space-y-5">
      {header}
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
                <CommunicationRow key={m.id} message={m} canSend={canSend} canManage={canManage} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
