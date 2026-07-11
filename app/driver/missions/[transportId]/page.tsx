import Link from "next/link";
import { getDriverMission } from "@/lib/driver/service";
import { driverMobileTrackingEnabled } from "@/lib/tracking/config";
import { MissionTracker } from "@/components/driver/mission-tracker";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? "—" : dt.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

export default async function DriverMissionDetailPage({ params }: { params: { transportId: string } }) {
  const d = t.driver;
  const mission = await getDriverMission(params.transportId);

  if (!mission) {
    return (
      <div className="animate-fade-in space-y-4">
        <Link href="/driver" className="text-sm text-teal-700">{d.detail.backToList}</Link>
        <p className="surface p-6 text-sm text-slate-500">{d.errors.not_found}</p>
      </div>
    );
  }

  const trackingOn = driverMobileTrackingEnabled();
  const statusLabel = d.status as Record<string, string>;
  const healthLabel = d.health as Record<string, string>;
  const eventType = t.transport.tracking.types as Record<string, string>;

  return (
    <div className="animate-fade-in space-y-4">
      <Link href="/driver" className="text-sm text-teal-700">{d.detail.backToList}</Link>

      <div className="surface space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-semibold text-navy-900">{mission.fileNumber ?? "—"}</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
            {statusLabel[mission.status] ?? mission.status}
          </span>
        </div>
        <div className="text-xs text-slate-500">
          {d.missions.client} : {mission.clientName ?? "—"} · {healthLabel[mission.trackingHealth]}
        </div>
        <div className="grid grid-cols-1 gap-2 text-sm">
          <Field label={d.detail.pickupInstr} value={mission.pickupLocation} sub={`${d.missions.plannedPickup} : ${fmt(mission.pickupPlanned)}`} />
          <Field label={d.detail.deliveryInstr} value={mission.deliveryLocation} sub={`${d.missions.plannedDelivery} : ${fmt(mission.deliveryPlanned)}`} />
          <div className="text-xs text-slate-500">
            {d.missions.vehicle} : {mission.vehiclePlate ?? "—"}
          </div>
        </div>
      </div>

      <MissionTracker
        transportId={mission.transportId}
        initialSessionId={mission.sessionId}
        initialSessionStatus={mission.sessionStatus}
        trackingEnabled={trackingOn}
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-navy-900">{d.detail.events}</h2>
        <div className="surface p-4">
          {mission.events.length === 0 ? (
            <p className="text-sm text-slate-500">{d.detail.noEvents}</p>
          ) : (
            <ol className="space-y-2">
              {mission.events.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 border-l-2 border-slate-200 pl-3 text-xs">
                  <span className="font-medium text-navy-800">{eventType[e.type] ?? e.type}</span>
                  <span className="text-slate-400">{fmt(e.occurredAt)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({ label, value, sub }: { label: string; value: string | null; sub: string }) {
  return (
    <div>
      <span className="text-xs uppercase tracking-wide text-slate-400">{label}</span>
      <div className="text-navy-800">{value ?? "—"}</div>
      <div className="text-[11px] text-slate-400">{sub}</div>
    </div>
  );
}
