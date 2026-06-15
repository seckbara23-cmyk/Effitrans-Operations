"use client";

/**
 * One invoice with its lines, payments, and actions (Phase 1.11). Client only —
 * invokes server-action proxies. Draft = editable (lines, issue, delete);
 * issued = record/reverse payments, void.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { lineAmount } from "@/lib/finance/calc";
import {
  addInvoiceLine,
  deleteInvoice,
  deleteInvoiceLine,
  issueInvoice,
  recordPayment,
  rejectPayment,
  reversePayment,
  verifyPayment,
  voidInvoice,
} from "@/lib/finance/actions";
import { PAYMENT_METHODS } from "@/lib/finance/calc";
import { EmailTriggerButton } from "@/components/communications/email-trigger-button";
import { InvoiceIntents } from "./invoice-intents";
import type { ActionResult, InvoiceDetail, PaymentIntentView } from "@/lib/finance/types";
import type { ProviderName } from "@/lib/finance/payment-intent";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  ISSUED: "bg-sky-50 text-sky-700",
  PARTIALLY_PAID: "bg-amber-50 text-amber-700",
  PAID: "bg-teal-50 text-teal-700",
  VOID: "bg-slate-100 text-slate-400 line-through",
};

const VERIFY_STYLE: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  VERIFIED: "bg-teal-50 text-teal-700",
  REJECTED: "bg-slate-100 text-slate-400",
};

export function fmt(n: number, currency: string): string {
  return `${n.toLocaleString("fr-FR")} ${currency}`;
}

export function InvoiceCard({
  invoice,
  canUpdate,
  canIssueInvoice,
  canPayment,
  canVoidInvoice,
  canDelete,
  canEmail = false,
  intents = [],
  paymentsEnabled = false,
  usableProviders = [],
}: {
  invoice: InvoiceDetail;
  canUpdate: boolean;
  canIssueInvoice: boolean;
  canPayment: boolean;
  canVoidInvoice: boolean;
  canDelete: boolean;
  canEmail?: boolean;
  intents?: PaymentIntentView[];
  paymentsEnabled?: boolean;
  usableProviders?: ProviderName[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const f = t.finance;
  const isDraft = invoice.status === "DRAFT";
  const isPayable = invoice.status === "ISSUED" || invoice.status === "PARTIALLY_PAID";

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

  function onAddLine(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() =>
      addInvoiceLine(invoice.id, {
        description: String(fd.get("description") ?? ""),
        quantity: Number(fd.get("quantity") ?? 1),
        unitAmount: Number(fd.get("unitAmount") ?? 0),
        taxRate: Number(fd.get("taxRate") ?? 0),
      }),
    );
    e.currentTarget.reset();
  }

  function onPay(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    run(() =>
      recordPayment(invoice.id, {
        amount: Number(fd.get("amount") ?? 0),
        method: String(fd.get("method") ?? "CASH") as (typeof PAYMENT_METHODS)[number],
        reference: String(fd.get("reference") ?? ""),
        providerName: String(fd.get("providerName") ?? ""),
        providerReference: String(fd.get("providerReference") ?? ""),
      }),
    );
    e.currentTarget.reset();
  }

  return (
    <div className="surface space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular font-semibold text-navy-900">{invoice.invoiceNumber ?? f.invoices.draft}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[invoice.status]}`}>
          {f.statuses[invoice.status]}
        </span>
        {invoice.overdue && <span className="text-xs font-semibold text-red-600">{f.invoices.overdue}</span>}
        <span className="ml-auto text-xs text-slate-500">
          {f.invoices.total}: <span className="tabular font-medium text-navy-900">{fmt(invoice.total, invoice.currency)}</span>
          {" · "}
          {f.invoices.balance}: <span className="tabular font-medium text-navy-900">{fmt(invoice.balance, invoice.currency)}</span>
        </span>
      </div>

      {/* Lines */}
      {invoice.lines.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm">
          {invoice.lines.map((l) => (
            <li key={l.id} className="flex items-center gap-2 py-1.5">
              <span className="text-slate-700">{l.description}</span>
              <span className="text-xs text-slate-400">
                {l.quantity} × {fmt(l.unitAmount, invoice.currency)}
                {l.taxRate ? ` (+${l.taxRate}%)` : ""}
              </span>
              <span className="ml-auto tabular text-slate-600">{fmt(lineAmount(l), invoice.currency)}</span>
              {isDraft && canUpdate && (
                <button
                  onClick={() => run(() => deleteInvoiceLine(l.id))}
                  disabled={pending}
                  className="text-xs text-slate-400 hover:text-red-600"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Draft: add line + issue + delete */}
      {isDraft && canUpdate && (
        <form onSubmit={onAddLine} className="flex flex-wrap items-end gap-2">
          <input name="description" required placeholder={f.invoices.lineDescription} className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm" />
          <input name="quantity" type="number" step="0.01" defaultValue={1} className="w-16 rounded-md border border-slate-200 px-2 py-1 text-sm" aria-label={f.charges.quantity} />
          <input name="unitAmount" type="number" step="0.01" defaultValue={0} className="w-28 rounded-md border border-slate-200 px-2 py-1 text-sm" aria-label={f.charges.unitAmount} />
          <input name="taxRate" type="number" step="0.01" defaultValue={0} className="w-16 rounded-md border border-slate-200 px-2 py-1 text-sm" aria-label={f.charges.taxRate} />
          <button type="submit" disabled={pending} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50">
            {f.invoices.addLine}
          </button>
        </form>
      )}

      {/* Payments */}
      {invoice.payments.filter((p) => !p.reversed).length > 0 && (
        <ul className="divide-y divide-slate-100 text-xs">
          {invoice.payments.filter((p) => !p.reversed).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-1 text-slate-600">
              <span className="tabular">{fmt(p.amount, invoice.currency)}</span>
              <span>· {t.finance.methods[p.method]}</span>
              <span>· {p.paidAt}</span>
              {(p.reference || p.providerReference) && <span>· {p.reference ?? p.providerReference}</span>}
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${VERIFY_STYLE[p.verificationStatus]}`}>
                {f.verification[p.verificationStatus]}
              </span>
              {canVoidInvoice && p.verificationStatus === "PENDING" && (
                <>
                  <button onClick={() => run(() => verifyPayment(p.id))} disabled={pending} className="ml-auto text-teal-600 hover:text-teal-800">
                    {f.invoices.verify}
                  </button>
                  <button
                    onClick={() => {
                      const note = window.prompt(f.invoices.rejectPrompt) ?? "";
                      run(() => rejectPayment(p.id, note.trim() || null));
                    }}
                    disabled={pending}
                    className="text-slate-400 hover:text-red-600"
                  >
                    {f.invoices.reject}
                  </button>
                </>
              )}
              {canVoidInvoice && (
                <button onClick={() => run(() => reversePayment(p.id))} disabled={pending} className={`${p.verificationStatus === "PENDING" ? "" : "ml-auto"} text-slate-400 hover:text-red-600`}>
                  {f.invoices.reverse}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Record payment */}
      {isPayable && canPayment && (
        <form onSubmit={onPay} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2">
          <input name="amount" type="number" step="0.01" required placeholder={f.invoices.amount} className="w-28 rounded-md border border-slate-200 px-2 py-1 text-sm" />
          <select name="method" className="rounded-md border border-slate-200 px-2 py-1 text-sm">
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t.finance.methods[m]}
              </option>
            ))}
          </select>
          <input name="reference" placeholder={f.invoices.reference} className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
          <input name="providerName" placeholder={f.invoices.providerName} className="w-28 rounded-md border border-slate-200 px-2 py-1 text-sm" />
          <input name="providerReference" placeholder={f.invoices.providerReference} className="rounded-md border border-slate-200 px-2 py-1 text-sm" />
          <button type="submit" disabled={pending} className="rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50">
            {f.invoices.recordPayment}
          </button>
        </form>
      )}

      {/* Workflow actions */}
      <div className="flex flex-wrap items-center gap-2">
        {isDraft && canIssueInvoice && (
          <button
            onClick={() => {
              const due = window.prompt(f.invoices.issuePrompt) ?? "";
              run(() => issueInvoice(invoice.id, due.trim() || null));
            }}
            disabled={pending}
            className="rounded-md border border-navy-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {f.invoices.issue}
          </button>
        )}
        {isDraft && canDelete && (
          <button onClick={() => run(() => deleteInvoice(invoice.id))} disabled={pending} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50">
            {f.invoices.del}
          </button>
        )}
        {isPayable && canVoidInvoice && (
          <button onClick={() => run(() => voidInvoice(invoice.id))} disabled={pending} className="rounded-md border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50">
            {f.invoices.void}
          </button>
        )}
        {canEmail && invoice.status !== "DRAFT" && invoice.status !== "VOID" && (
          <EmailTriggerButton kind="invoice" id={invoice.id} label={t.communications.emailClient} />
        )}
      </div>

      {/* Online payment intents (1.15B) — dark unless PAYMENTS_ENABLED + provider configured */}
      <InvoiceIntents
        invoiceId={invoice.id}
        intents={intents}
        canPayment={canPayment}
        canVoidInvoice={canVoidInvoice}
        isPayable={isPayable}
        paymentsEnabled={paymentsEnabled}
        usableProviders={usableProviders}
      />

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
