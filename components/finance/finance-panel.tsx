"use client";

/**
 * Finance panel on a dossier (Phase 1.11). Client only. Charges + invoices +
 * warnings. Visible only to finance-role users (gated server-side). Finance
 * never blocks dossier closure — warnings only.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { lineAmount } from "@/lib/finance/calc";
import { createCharge, createInvoice, deleteCharge } from "@/lib/finance/actions";
import { InvoiceCard, fmt } from "./invoice-card";
import type { ActionResult, FinanceForFile } from "@/lib/finance/types";

export function FinancePanel({
  fileId,
  finance,
  canCreate,
  canUpdate,
  canIssueInvoice,
  canPayment,
  canVoidInvoice,
  canDelete,
}: {
  fileId: string;
  finance: FinanceForFile;
  canCreate: boolean;
  canUpdate: boolean;
  canIssueInvoice: boolean;
  canPayment: boolean;
  canVoidInvoice: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const f = t.finance;
  const currency = "XOF";

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        const map = f.errors as Record<string, string>;
        setError(map[res.error] ?? f.errors.generic);
        return;
      }
      router.refresh();
    });
  }

  function onAddCharge(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() =>
      createCharge(fileId, {
        description: String(fd.get("description") ?? ""),
        quantity: Number(fd.get("quantity") ?? 1),
        unitAmount: Number(fd.get("unitAmount") ?? 0),
        taxRate: Number(fd.get("taxRate") ?? 0),
      }),
    );
    e.currentTarget.reset();
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy-900">{f.panelTitle}</h2>
      </div>

      {/* Warnings (finance never blocks closure) */}
      {(!finance.hasIssued || finance.outstanding > 0) && (
        <div className="space-y-1">
          {!finance.hasIssued && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{f.warnings.noInvoice}</div>
          )}
          {finance.outstanding > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              {f.warnings.outstanding.replace("{amount}", fmt(finance.outstanding, currency))}
            </div>
          )}
        </div>
      )}

      {/* Charges */}
      <div className="surface space-y-2 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{f.charges.title}</p>
        {finance.charges.length === 0 ? (
          <p className="text-xs text-slate-400">{f.charges.empty}</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {finance.charges.map((c) => (
              <li key={c.id} className="flex items-center gap-2 py-1.5">
                <span className="text-slate-700">{c.description}</span>
                <span className="text-xs text-slate-400">
                  {c.quantity} × {fmt(c.unitAmount, c.currency)}
                  {c.taxRate ? ` (+${c.taxRate}%)` : ""}
                </span>
                <span className="ml-auto tabular text-slate-600">{fmt(lineAmount(c), c.currency)}</span>
                {canDelete && (
                  <button onClick={() => run(() => deleteCharge(c.id))} disabled={pending} className="text-xs text-slate-400 hover:text-red-600">
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canCreate && (
          <form onSubmit={onAddCharge} className="flex flex-wrap items-end gap-2">
            <input name="description" required placeholder={f.charges.description} className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm" />
            <input name="quantity" type="number" step="0.01" defaultValue={1} className="w-16 rounded-md border border-slate-200 px-2 py-1 text-sm" aria-label={f.charges.quantity} />
            <input name="unitAmount" type="number" step="0.01" defaultValue={0} className="w-28 rounded-md border border-slate-200 px-2 py-1 text-sm" aria-label={f.charges.unitAmount} />
            <input name="taxRate" type="number" step="0.01" defaultValue={0} className="w-16 rounded-md border border-slate-200 px-2 py-1 text-sm" aria-label={f.charges.taxRate} />
            <button type="submit" disabled={pending} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50">
              {f.charges.add}
            </button>
          </form>
        )}
      </div>

      {/* Invoices */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{f.invoices.title}</p>
          {canCreate && (
            <button onClick={() => run(() => createInvoice(fileId))} disabled={pending} className="rounded-md border border-navy-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50">
              {f.invoices.create}
            </button>
          )}
        </div>
        {finance.invoices.length === 0 ? (
          <div className="surface p-3 text-sm text-slate-400">{f.invoices.empty}</div>
        ) : (
          finance.invoices.map((inv) => (
            <InvoiceCard
              key={inv.id}
              invoice={inv}
              canUpdate={canUpdate}
              canIssueInvoice={canIssueInvoice}
              canPayment={canPayment}
              canVoidInvoice={canVoidInvoice}
              canDelete={canDelete}
            />
          ))
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </section>
  );
}
