import Link from "next/link";
import { listDriverMissions, type DriverMission } from "@/lib/driver/service";
import { driverMobileTrackingEnabled } from "@/lib/tracking/config";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function healthClass(h: DriverMission["trackingHealth"]): string {
  if (h === "live") return "text-teal-700";
  if (h === "paused") return "text-amber-700";
  if (h === "stale" || h === "offline") return "text-red-600";
  return "text-slate-400";
}

export default async function DriverMissionsPage() {
  const missions = await listDriverMissions();
  const trackingOn = driverMobileTrackingEnabled();
  const d = t.driver;
  const statusLabel = d.status as Record<string, string>;
  const healthLabel = d.health as Record<string, string>;

  return (
    <div className="animate-fade-in space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-navy-900">{d.missions.title}</h1>
        <p className="text-xs text-slate-500">{d.missions.subtitle}</p>
      </div>

      {!trackingOn && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600">{d.tracking.disabled}</p>
      )}

      {missions.length === 0 ? (
        <p className="surface p-6 text-sm text-slate-500">{d.missions.empty}</p>
      ) : (
        <ul className="space-y-3">
          {missions.map((m) => (
            <li key={m.transportId}>
              <Link href={`/driver/missions/${m.transportId}`} className="surface block space-y-2 p-4 active:bg-slate-50">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-navy-900">{m.fileNumber ?? "—"}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {statusLabel[m.status] ?? m.status}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  {d.missions.client} : {m.clientName ?? "—"}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400">{d.missions.pickup}</span>
                    <div className="text-navy-800">{m.pickupLocation ?? "—"}</div>
                  </div>
                  <div>
                    <span className="text-slate-400">{d.missions.delivery}</span>
                    <div className="text-navy-800">{m.deliveryLocation ?? "—"}</div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] font-medium ${healthClass(m.trackingHealth)}`}>● {healthLabel[m.trackingHealth]}</span>
                  <span className="text-[11px] text-teal-700">{d.missions.open} →</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
