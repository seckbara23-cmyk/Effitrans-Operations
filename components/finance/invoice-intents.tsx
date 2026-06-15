"use client";

/**
 * Online payment intents for one invoice (Phase 1.15B). Client only — invokes
 * the intent server-action proxies. Staff (finance:payment) generate + send a
 * payment link; finance:void cancels an open intent. Creating an intent never
 * records money — a trusted provider webhook does. Hidden entirely unless online
 * payments are enabled AND a provider is configured (default: dark).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { cancelPaymentIntent, createPaymentLink, sendPaymentLink } from "@/lib/finance/intent-actions";
import type { ActionResult, PaymentIntentView } from "@/lib/finance/types";
import type { ProviderName } from "@/lib/finance/payment-intent";

const INTENT_STYLE: Record<string, string> = {
  CREATED: "bg-slate-100 text-slate-600",
  PENDING: "bg-amber-50 text-amber-700",
  PROCESSING: "bg-sky-50 text-sky-700",
  SUCCEEDED: "bg-teal-50 text-teal-700",
  FAILED: "bg-red-50 text-red-700",
  EXPIRED: "bg-slate-100 text-slate-400",
  CANCELLED: "bg-slate-100 text-slate-400 line-through",
};

export function InvoiceIntents({
  invoiceId,
  intents,
  canPayment,
  canVoidInvoice,
  isPayable,
  paymentsEnabled,
  usableProviders,
}: {
  invoiceId: string;
  intents: PaymentIntentView[];
  canPayment: boolean;
  canVoidInvoice: boolean;
  isPayable: boolean;
  paymentsEnabled: boolean;
  usableProviders: ProviderName[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const I = t.finance.intents;

  // Feature is dark unless enabled + a provider is configured. Nothing renders
  // (no intents history either) so the invoice card is unchanged in production.
  if (!paymentsEnabled || usableProviders.length === 0) {
    if (intents.length === 0) return null;
  }

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        const map = t.finance.errors as Record<string, string>;
        setError(map[res.error] ?? t.finance.errors.generic);
        return;
      }
      router.refresh();
    });
  }

  const open = intents.filter((i) => i.status === "PENDING" || i.status === "PROCESSING");
  const canGenerate = isPayable && canPayment && paymentsEnabled && usableProviders.length > 0 && open.length === 0;

  return (
    <div className="space-y-2 border-t border-slate-100 pt-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{I.title}</p>

      {intents.length > 0 && (
        <ul className="divide-y divide-slate-100 text-xs">
          {intents.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-2 py-1 text-slate-600">
              <span>{I.providers[i.provider]}</span>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${INTENT_STYLE[i.status]}`}>
                {I.statuses[i.status]}
              </span>
              {i.expiresAt && (i.status === "PENDING" || i.status === "PROCESSING") && (
                <span className="text-[10px] text-slate-400">{I.expires}: {i.expiresAt.slice(0, 16).replace("T", " ")}</span>
              )}
              {i.lastError && i.status === "FAILED" && <span className="text-[10px] text-red-500">{i.lastError}</span>}
              {i.checkoutUrl && (i.status === "PENDING" || i.status === "PROCESSING") && (
                <a href={i.checkoutUrl} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline">
                  {I.payNow}
                </a>
              )}
              {canPayment && (i.status === "PENDING" || i.status === "PROCESSING") && (
                <button onClick={() => run(() => sendPaymentLink(i.id))} disabled={pending} className="text-navy-600 hover:underline">
                  {I.sendLink}
                </button>
              )}
              {canVoidInvoice && (i.status === "CREATED" || i.status === "PENDING" || i.status === "PROCESSING") && (
                <button onClick={() => run(() => cancelPaymentIntent(i.id))} disabled={pending} className="ml-auto text-slate-400 hover:text-red-600">
                  {I.cancel}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canGenerate && (
        <div className="flex flex-wrap items-center gap-2">
          {usableProviders.map((p) => (
            <button
              key={p}
              onClick={() => run(() => createPaymentLink(invoiceId, p))}
              disabled={pending}
              className="rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
            >
              {I.generateLink} · {I.providers[p]}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
