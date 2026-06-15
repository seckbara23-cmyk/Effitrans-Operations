import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getTransportQueue } from "@/lib/transport/service";
import { TRANSPORT_STATUSES } from "@/lib/transport/status";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.transport.title };
export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  DELIVERED: "bg-teal-50 text-teal-700",
  POD_RECEIVED: "bg-teal-50 text-teal-700",
  BLOCKED: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-400",
};

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function TransportPage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  const header = <PageHeader meta="Opérations" title={t.transport.title} subtitle={t.transport.subtitle} />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.transport.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "transport:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.transport.forbidden}</Notice></div>;
  }

  const status = searchParams?.status;
  const rows = await getTransportQueue(status ? { status } : undefined);

  const pill = (label: string, value: string | undefined) => {
    const active = status === value;
    const href = value ? `/transport?status=${value}` : "/transport";
    return (
      <Link
        key={label}
        href={href}
        className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
          active ? "border-teal-500 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600 hover:border-teal-300"
        }`}
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
        {TRANSPORT_STATUSES.map((s) => pill(t.transport.statuses[s], s))}
      </div>

      {rows.length === 0 ? (
        <Notice>{t.transport.empty}</Notice>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{t.transport.columns.number}</th>
                <th className="px-4 py-3 font-semibold">{t.transport.columns.client}</th>
                <th className="px-4 py-3 font-semibold">{t.transport.columns.type}</th>
                <th className="px-4 py-3 font-semibold">{t.transport.columns.driver}</th>
                <th className="px-4 py-3 font-semibold">{t.transport.columns.vehicle}</th>
                <th className="px-4 py-3 font-semibold">{t.transport.columns.delivery}</th>
                <th className="px-4 py-3 font-semibold">{t.transport.columns.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <Link href={`/files/${r.fileId}`} className="tabular font-medium text-navy-900 hover:text-teal-700">
                      {r.fileNumber ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.clientName ?? t.common.none}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {r.fileType ? t.files.types[r.fileType as keyof typeof t.files.types] : "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r.driverName ?? "—"}</td>
                  <td className="px-4 py-3 tabular text-slate-600">{r.vehiclePlate ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{r.deliveryPlanned ? r.deliveryPlanned.slice(0, 10) : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {t.transport.statuses[r.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
