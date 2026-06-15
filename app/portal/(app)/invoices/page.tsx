import Link from "next/link";
import { listPortalInvoices } from "@/lib/portal/docs-service";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  ISSUED: "bg-sky-50 text-sky-700",
  PARTIALLY_PAID: "bg-amber-50 text-amber-700",
  PAID: "bg-teal-50 text-teal-700",
};

const fmt = (n: number, c: string) => `${n.toLocaleString("fr-FR")} ${c}`;

export default async function PortalInvoicesPage() {
  const invoices = await listPortalInvoices();
  const i = t.portal.invoices;

  return (
    <div className="animate-fade-in space-y-5">
      <h1 className="text-xl font-bold text-navy-900">{i.title}</h1>

      {invoices.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-600">{i.empty}</div>
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{i.number}</th>
                <th className="px-4 py-3 font-semibold">{i.file}</th>
                <th className="px-4 py-3 font-semibold">{i.total}</th>
                <th className="px-4 py-3 font-semibold">{i.balance}</th>
                <th className="px-4 py-3 font-semibold">{i.dueDate}</th>
                <th className="px-4 py-3 font-semibold">{i.status}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <Link href={`/portal/invoices/${inv.id}`} className="tabular font-medium text-teal-700 hover:underline">
                      {inv.invoiceNumber ?? "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 tabular text-slate-600">{inv.fileNumber ?? "—"}</td>
                  <td className="px-4 py-3 tabular text-slate-600">{fmt(inv.total, inv.currency)}</td>
                  <td className="px-4 py-3 tabular text-slate-600">{fmt(inv.balance, inv.currency)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {inv.dueDate ?? "—"}
                    {inv.overdue && <span className="ml-1 text-xs font-semibold text-red-600">{i.overdue}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[inv.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {i.statuses[inv.status as keyof typeof i.statuses] ?? inv.status}
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
