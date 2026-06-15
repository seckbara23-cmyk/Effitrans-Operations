import { listPortalDocuments } from "@/lib/portal/docs-service";
import { PortalDownloadButton } from "@/components/portal/portal-download-button";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PortalDocumentsPage() {
  const docs = await listPortalDocuments();
  const d = t.portal.documents;

  return (
    <div className="animate-fade-in space-y-5">
      <h1 className="text-xl font-bold text-navy-900">{d.title}</h1>

      {docs.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-600">{d.empty}</div>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{d.type}</th>
                <th className="px-4 py-3 font-semibold">{d.file}</th>
                <th className="px-4 py-3 font-semibold">{d.date}</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {docs.map((doc) => (
                <tr key={doc.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3 text-navy-900">{doc.typeLabel}{doc.title ? ` · ${doc.title}` : ""}</td>
                  <td className="px-4 py-3 tabular text-slate-600">{doc.fileNumber ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-600">{doc.createdAt.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-right"><PortalDownloadButton documentId={doc.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
