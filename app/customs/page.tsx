import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getCustomsQueue } from "@/lib/customs/service";
import { CUSTOMS_STATUSES } from "@/lib/customs/status";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.customs.title };
export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  RELEASED: "bg-teal-50 text-teal-700",
  BLOCKED: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-400",
};

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function CustomsPage({
  searchParams,
}: {
  searchParams?: { status?: string };
}) {
  const header = <PageHeader meta="Opérations" title={t.customs.title} subtitle={t.customs.subtitle} />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.customs.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "customs:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.customs.forbidden}</Notice></div>;
  }

  const status = searchParams?.status;
  const rows = await getCustomsQueue(status ? { status } : undefined);

  const pill = (label: string, value: string | undefined) => {
    const active = status === value;
    const href = value ? `/customs?status=${value}` : "/customs";
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
        {CUSTOMS_STATUSES.map((s) => pill(t.customs.statuses[s], s))}
      </div>

      {rows.length === 0 ? (
        <Notice>{t.customs.empty}</Notice>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{t.customs.columns.number}</th>
                <th className="px-4 py-3 font-semibold">{t.customs.columns.client}</th>
                <th className="px-4 py-3 font-semibold">{t.customs.columns.type}</th>
                <th className="px-4 py-3 font-semibold">{t.customs.columns.declaration}</th>
                <th className="px-4 py-3 font-semibold">{t.customs.columns.office}</th>
                <th className="px-4 py-3 font-semibold">{t.customs.columns.bae}</th>
                <th className="px-4 py-3 font-semibold">{t.customs.columns.status}</th>
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
                  <td className="px-4 py-3 tabular text-slate-600">{r.declarationNumber ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{r.customsOffice ?? "—"}</td>
                  <td className="px-4 py-3 tabular text-slate-600">{r.baeReference ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {t.customs.statuses[r.status]}
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
