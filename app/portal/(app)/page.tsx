import Link from "next/link";
import { requirePortalUser } from "@/lib/portal/auth";
import { getPortalShipments } from "@/lib/portal/shipments";
import { listClientNotifications, unreadClientNotificationCount } from "@/lib/customer-notify/service";
import { ShipmentsBoard } from "@/components/portal/shipments-board";
import { NotificationsFeed } from "@/components/portal/notifications-feed";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PortalDashboardPage() {
  const user = await requirePortalUser();
  const [shipments, notifications, unread] = await Promise.all([
    getPortalShipments(),
    listClientNotifications(5),
    unreadClientNotificationCount(),
  ]);
  const p = t.portal.premium;
  const nc = t.portal.notify.center;
  const active = shipments.filter((s) => s.status !== "CLOSED");

  return (
    <div className="animate-fade-in space-y-8">
      {/* Hero */}
      <div className="overflow-hidden rounded-2xl bg-gradient-to-br from-navy-900 via-navy-800 to-teal-800 px-5 py-6 text-white shadow-card sm:px-7">
        <p className="text-[11px] uppercase tracking-[0.14em] text-teal-200">{p.welcome}</p>
        <h1 className="mt-0.5 text-2xl font-bold sm:text-3xl">{user.clientName ?? user.email}</h1>
        <p className="mt-1 max-w-xl text-sm text-teal-100">{p.activeSubtitle}</p>
      </div>

      {/* Active shipments */}
      <section className="space-y-3">
        <h2 className="text-lg font-bold text-navy-900">{p.activeTitle}</h2>
        <ShipmentsBoard shipments={active} />
      </section>

      {/* Notifications */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-bold text-navy-900">
            {nc.title}
            {unread > 0 && <span className="rounded-full bg-teal-600 px-2 py-0.5 text-xs font-medium text-white">{unread}</span>}
          </h2>
          <Link href="/portal/notifications" className="text-sm font-medium text-teal-700 hover:underline">
            {nc.viewAll} →
          </Link>
        </div>
        <NotificationsFeed items={notifications} />
      </section>
    </div>
  );
}
