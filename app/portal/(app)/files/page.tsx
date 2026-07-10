import { getPortalShipments } from "@/lib/portal/shipments";
import { ShipmentsBoard } from "@/components/portal/shipments-board";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PortalFilesPage() {
  const shipments = await getPortalShipments();
  const f = t.portal.files;

  return (
    <div className="animate-fade-in space-y-5">
      <div>
        <h1 className="text-xl font-bold text-navy-900">{f.title}</h1>
        <p className="text-sm text-slate-500">{t.portal.premium.activeSubtitle}</p>
      </div>
      <ShipmentsBoard shipments={shipments} />
    </div>
  );
}
