import Link from "next/link";
import { requirePortalUser } from "@/lib/portal/auth";
import { getPortalDashboard } from "@/lib/portal/service";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = t.files.statuses;

export default async function PortalDashboardPage() {
  const user = await requirePortalUser();
  const data = await getPortalDashboard(user.clientName);
  const p = t.portal.dashboard;

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <p className="text-sm text-slate-500">{p.welcome}</p>
        <h1 className="text-2xl font-bold text-navy-900">{user.clientName ?? user.email}</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="surface p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{p.total}</p>
          <p className="mt-2 text-2xl font-bold tabular text-teal-700">{data.total}</p>
        </div>
        {Object.entries(data.byStatus).map(([status, count]) => (
          <div key={status} className="surface p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              {STATUS_LABEL[status] ?? status}
            </p>
            <p className="mt-2 text-2xl font-bold tabular text-navy-900">{count}</p>
          </div>
        ))}
      </div>

      <Link href="/portal/files" className="inline-block text-sm font-medium text-teal-700 hover:underline">
        {p.viewFiles} →
      </Link>
    </div>
  );
}
