import Link from "next/link";
import { getPortalFileSummary } from "@/lib/portal/service";
import { listPortalDocuments, listPortalInvoices } from "@/lib/portal/docs-service";
import { PortalDownloadButton } from "@/components/portal/portal-download-button";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const fmtMoney = (n: number, c: string) => `${n.toLocaleString("fr-FR")} ${c}`;

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

  const [documents, invoices] = await Promise.all([
    listPortalDocuments(file.id),
    listPortalInvoices(file.id),
  ]);
  const di = t.portal.documents;
  const iv = t.portal.invoices;

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

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-navy-900">{di.title}</h2>
        {documents.length === 0 ? (
          <div className="surface p-4 text-sm text-slate-500">{di.empty}</div>
        ) : (
          <div className="surface divide-y divide-slate-100">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center gap-2 p-3 text-sm">
                <span className="text-navy-900">{doc.typeLabel}{doc.title ? ` · ${doc.title}` : ""}</span>
                <span className="ml-auto"><PortalDownloadButton documentId={doc.id} /></span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-navy-900">{iv.title}</h2>
        {invoices.length === 0 ? (
          <div className="surface p-4 text-sm text-slate-500">{iv.empty}</div>
        ) : (
          <div className="surface divide-y divide-slate-100">
            {invoices.map((inv) => (
              <Link key={inv.id} href={`/portal/invoices/${inv.id}`} className="flex items-center gap-2 p-3 text-sm hover:bg-slate-50">
                <span className="tabular font-medium text-teal-700">{inv.invoiceNumber ?? "—"}</span>
                <span className="text-slate-500">{iv.statuses[inv.status as keyof typeof iv.statuses] ?? inv.status}</span>
                <span className="ml-auto tabular text-slate-600">
                  {iv.balance}: {fmtMoney(inv.balance, inv.currency)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
