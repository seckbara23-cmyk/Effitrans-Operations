import Link from "next/link";
import { t } from "@/lib/i18n";
import { formatShortDate } from "@/lib/portal/shipment-view";
import type { PortalInvoiceSummary } from "@/lib/portal/types";

const money = (n: number, c: string) => `${n.toLocaleString("fr-FR")} ${c}`;

const STATUS_STYLE: Record<string, string> = {
  ISSUED: "bg-sky-50 text-sky-700",
  PARTIALLY_PAID: "bg-amber-50 text-amber-700",
  PAID: "bg-emerald-50 text-emerald-700",
};

/** Modern invoice center (Phase 3.3 D8). Reuses the portal invoice service; no payment changes. */
export function InvoiceCenter({ invoices }: { invoices: PortalInvoiceSummary[] }) {
  const iv = t.portal.premium.invoices;
  const currency = invoices[0]?.currency ?? "XOF";
  const outstanding = invoices
    .filter((i) => i.status === "ISSUED" || i.status === "PARTIALLY_PAID")
    .reduce((s, i) => s + i.balance, 0);
  const paid = invoices.reduce((s, i) => s + i.paid, 0);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-navy-900">{iv.title}</h2>

      {invoices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-500">
          {iv.empty}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">{iv.outstanding}</p>
              <p className="tabular mt-1 text-xl font-bold text-rose-600">{money(outstanding, currency)}</p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">{iv.paid}</p>
              <p className="tabular mt-1 text-xl font-bold text-emerald-600">{money(paid, currency)}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
            <ul className="divide-y divide-slate-100">
              {invoices.map((inv) => (
                <li key={inv.id}>
                  <Link href={`/portal/invoices/${inv.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="tabular text-sm font-semibold text-navy-900">{inv.invoiceNumber ?? "—"}</p>
                      <p className="text-[11px] text-slate-400">
                        {iv.dueDate}: {formatShortDate(inv.dueDate)}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[inv.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {t.portal.invoices.statuses[inv.status as keyof typeof t.portal.invoices.statuses] ?? inv.status}
                    </span>
                    {inv.overdue && (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">{iv.overdue}</span>
                    )}
                    <span className="tabular ml-auto text-sm font-semibold text-navy-900">{money(inv.balance, inv.currency)}</span>
                    <span className="text-xs font-medium text-teal-700">{iv.download} →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
