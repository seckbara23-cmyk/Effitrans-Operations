import { requirePortalUser } from "@/lib/portal/auth";
import { listClientNotifications } from "@/lib/customer-notify/service";
import { getNotificationPrefs } from "@/lib/customer-notify/actions";
import { PortalNotifications } from "@/components/portal/portal-notifications";
import { NotificationPrefs } from "@/components/portal/notification-prefs";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PortalNotificationsPage() {
  await requirePortalUser();
  const [items, prefs] = await Promise.all([listClientNotifications(), getNotificationPrefs()]);

  return (
    <div className="animate-fade-in space-y-6">
      <h1 className="text-2xl font-bold text-navy-900">{t.portal.notify.center.title}</h1>
      <PortalNotifications items={items} />
      {prefs && <NotificationPrefs initial={prefs} />}
    </div>
  );
}
