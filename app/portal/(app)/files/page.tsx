import Link from "next/link";
import { listPortalFiles } from "@/lib/portal/service";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-500",
  OPENED: "bg-sky-50 text-sky-700",
  IN_PROGRESS: "bg-amber-50 text-amber-700",
  DELIVERED: "bg-teal-50 text-teal-700",
  CLOSED: "bg-navy-50 text-navy-700",
};

export default async function PortalFilesPage() {
  const files = await listPortalFiles();
  const f = t.portal.files;

  return (
    <div className="animate-fade-in space-y-5">
      <h1 className="text-xl font-bold text-navy-900">{f.title}</h1>

      {files.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-600">{f.empty}</div>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{f.number}</th>
                <th className="px-4 py-3 font-semibold">{f.type}</th>
                <th className="px-4 py-3 font-semibold">{f.route}</th>
                <th className="px-4 py-3 font-semibold">{f.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {files.map((file) => (
                <tr key={file.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <Link href={`/portal/files/${file.id}`} className="tabular font-medium text-teal-700 hover:underline">
                      {file.fileNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {t.files.types[file.type as keyof typeof t.files.types] ?? file.type}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {file.origin ?? "—"} → {file.destination ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[file.status] ?? "bg-slate-100 text-slate-500"}`}>
                      {t.files.statuses[file.status as keyof typeof t.files.statuses] ?? file.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
