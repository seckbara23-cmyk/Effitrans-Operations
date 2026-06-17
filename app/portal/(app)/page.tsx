import Link from "next/link";
import { requirePortalUser } from "@/lib/portal/auth";
import { getPortalDashboard, listPortalFiles } from "@/lib/portal/service";
import { listPortalInvoices } from "@/lib/portal/docs-service";
import { portalShipmentCards } from "@/lib/portal/progress-map";
import { listClientNotifications, unreadClientNotificationCount } from "@/lib/customer-notify/service";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = t.files.statuses;

export default async function PortalDashboardPage() {
  const user = await requirePortalUser();
  const [data, files, invoices, notifications, unread] = await Promise.all([
    getPortalDashboard(user.clientName),
    listPortalFiles(),
    listPortalInvoices(),
    listClientNotifications(3),
    unreadClientNotificationCount(),
  ]);
  const p = t.portal.dashboard;
  const nc = t.portal.notify.center;
  const cards = portalShipmentCards(
    files.map((f) => ({ status: f.status, transportStatus: f.transportStatus })),
    invoices.map((i) => ({ status: i.status, balance: i.balance })),
  );

  return (
    <div className="animate-fade-in space-y-6">
      <div>
        <p className="text-sm text-slate-500">{p.welcome}</p>
        <h1 className="text-2xl font-bold text-navy-900">{user.clientName ?? user.email}</h1>
      </div>

      {/* My shipments (Phase 2.4 D7) */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-navy-900">{p.shipments.title}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            [p.shipments.active, cards.active, "text-navy-900"],
            [p.shipments.inTransit, cards.inTransit, "text-amber-700"],
            [p.shipments.delivered, cards.delivered, "text-teal-700"],
            [p.shipments.awaitingPayment, cards.awaitingPayment, "text-red-600"],
          ] as const).map(([label, value, tone]) => (
            <div key={label} className="surface p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
              <p className={`mt-2 tabular text-2xl font-bold ${tone}`}>{value}</p>
            </div>
          ))}
        </div>
      </section>

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

      {/* Notifications widget (Phase 2.5) */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-navy-900">
          {nc.title}
          {unread > 0 && <span className="ml-2 rounded-full bg-teal-600 px-2 py-0.5 text-xs font-medium text-white">{unread}</span>}
        </h2>
        {notifications.length === 0 ? (
          <div className="surface p-4 text-sm text-slate-500">{nc.empty}</div>
        ) : (
          <div className="surface divide-y divide-slate-100">
            {notifications.map((n) => (
              <div key={n.id} className={`p-3 text-sm ${n.readAt ? "" : "bg-teal-50/40"}`}>
                <span className={n.readAt ? "text-navy-800" : "font-semibold text-navy-900"}>{n.title}</span>
              </div>
            ))}
          </div>
        )}
        <Link href="/portal/notifications" className="mt-2 inline-block text-sm font-medium text-teal-700 hover:underline">
          {nc.viewAll} →
        </Link>
      </section>

      <Link href="/portal/files" className="inline-block text-sm font-medium text-teal-700 hover:underline">
        {p.viewFiles} →
      </Link>
    </div>
  );
}
