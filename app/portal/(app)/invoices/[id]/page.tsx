import Link from "next/link";
import { requirePortalUser } from "@/lib/portal/auth";
import { getPortalInvoice, auditPortalInvoiceView } from "@/lib/portal/docs-service";
import { lineAmount } from "@/lib/finance/calc";
import { PortalPrintButton } from "@/components/portal/portal-print-button";
import { PortalPayButton } from "@/components/portal/portal-pay-button";
import { paymentsEnabled, usableProviders } from "@/lib/finance/providers/config";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const fmt = (n: number, c: string) => `${n.toLocaleString("fr-FR")} ${c}`;

export default async function PortalInvoiceDetailPage({ params }: { params: { id: string } }) {
  const i = t.portal.invoices;
  const user = await requirePortalUser();
  const inv = await getPortalInvoice(params.id);

  if (!inv) {
    return (
      <div className="animate-fade-in space-y-4">
        <Link href="/portal/invoices" className="text-sm text-teal-700 hover:underline">← {i.back}</Link>
        <div className="surface p-6 text-sm text-slate-600">{i.notFound}</div>
      </div>
    );
  }

  // Audit the view (portal actor). Best-effort — never blocks the render.
  await auditPortalInvoiceView(user.id, user.tenantId, inv.id);
  const c = inv.currency;

  return (
    <div className="animate-fade-in space-y-5">
      <div className="flex items-center justify-between print:hidden">
        <Link href="/portal/invoices" className="text-sm text-teal-700 hover:underline">← {i.back}</Link>
        <PortalPrintButton />
      </div>

      <div className="surface space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">{user.clientName}</p>
            <h1 className="tabular text-xl font-bold text-navy-900">{inv.invoiceNumber}</h1>
          </div>
          <div className="text-right text-sm text-slate-600">
            <p>{i.issueDate}: {inv.issueDate ?? "—"}</p>
            <p>{i.dueDate}: {inv.dueDate ?? "—"}{inv.overdue ? ` · ${i.overdue}` : ""}</p>
            <p>{i.status}: {i.statuses[inv.status as keyof typeof i.statuses] ?? inv.status}</p>
          </div>
        </div>

        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 font-semibold">{i.description}</th>
              <th className="py-2 text-right font-semibold">{i.qty}</th>
              <th className="py-2 text-right font-semibold">{i.unit}</th>
              <th className="py-2 text-right font-semibold">{i.total}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inv.lines.map((l, idx) => (
              <tr key={idx}>
                <td className="py-2 text-slate-700">{l.description}{l.taxRate ? ` (+${l.taxRate}%)` : ""}</td>
                <td className="py-2 text-right tabular text-slate-600">{l.quantity}</td>
                <td className="py-2 text-right tabular text-slate-600">{fmt(l.unitAmount, c)}</td>
                <td className="py-2 text-right tabular text-slate-600">{fmt(lineAmount(l), c)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
          <Row label={i.subtotal} value={fmt(inv.subtotal, c)} />
          <Row label={i.tax} value={fmt(inv.tax, c)} />
          <Row label={i.total} value={fmt(inv.total, c)} bold />
          <Row label={i.paid} value={fmt(inv.paid, c)} />
          <Row label={i.balance} value={fmt(inv.balance, c)} bold />
        </div>

        {inv.balance > 0 && (inv.status === "ISSUED" || inv.status === "PARTIALLY_PAID") && (
          <div className="flex justify-end">
            <PortalPayButton invoiceId={inv.id} enabled={paymentsEnabled()} providers={usableProviders()} />
          </div>
        )}

        {inv.payments.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{i.payments}</p>
            <ul className="text-sm text-slate-600">
              {inv.payments.map((p, idx) => (
                <li key={idx} className="flex gap-2">
                  <span className="tabular">{fmt(p.amount, c)}</span>
                  <span>· {i.methods[p.method as keyof typeof i.methods] ?? p.method}</span>
                  <span>· {p.paidAt}</span>
                  {p.reference && <span>· {p.reference}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`tabular ${bold ? "font-bold text-navy-900" : "text-slate-700"}`}>{value}</span>
    </div>
  );
}
