import Link from "next/link";
import { getPortalFileSummary } from "@/lib/portal/service";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b border-slate-100 py-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-navy-900">{value}</span>
    </div>
  );
}

export default async function PortalFileDetailPage({ params }: { params: { id: string } }) {
  const f = t.portal.files;
  const file = await getPortalFileSummary(params.id);

  if (!file) {
    return (
      <div className="animate-fade-in space-y-4">
        <Link href="/portal/files" className="text-sm text-teal-700 hover:underline">← {f.back}</Link>
        <div className="surface p-6 text-sm text-slate-600">{f.notFound}</div>
      </div>
    );
  }

  const customs = file.customsStatus
    ? t.customs.statuses[file.customsStatus as keyof typeof t.customs.statuses] ?? file.customsStatus
    : f.notAvailable;
  const transport = file.transportStatus
    ? t.transport.statuses[file.transportStatus as keyof typeof t.transport.statuses] ?? file.transportStatus
    : f.notAvailable;

  return (
    <div className="animate-fade-in space-y-5">
      <Link href="/portal/files" className="text-sm text-teal-700 hover:underline">← {f.back}</Link>
      <h1 className="tabular text-xl font-bold text-navy-900">{file.fileNumber}</h1>

      <div className="surface p-4">
        <Row label={f.type} value={t.files.types[file.type as keyof typeof t.files.types] ?? file.type} />
        <Row label={f.status} value={t.files.statuses[file.status as keyof typeof t.files.statuses] ?? file.status} />
        <Row
          label={f.shipment}
          value={`${file.origin ?? "—"} → ${file.destination ?? "—"}${file.transportMode ? ` · ${t.files.modes[file.transportMode as keyof typeof t.files.modes] ?? file.transportMode}` : ""}`}
        />
        <Row label={f.customs} value={customs} />
        <Row label={f.transport} value={transport} />
      </div>
    </div>
  );
}
