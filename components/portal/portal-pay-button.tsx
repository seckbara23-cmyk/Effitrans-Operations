"use client";

/**
 * Portal "Pay online" button (Phase 1.15B). Client only. SHIPS DISABLED:
 * online payments are dark until PAYMENTS_ENABLED + a configured provider
 * (DEC-B24 Q2 — staff links first). When enabled, it creates a payment intent
 * for the client's own invoice and redirects to the provider checkout. It never
 * records money — a trusted provider webhook does.
 */
import { useState, useTransition } from "react";
import { t } from "@/lib/i18n";
import { createPortalPaymentIntent } from "@/lib/finance/intent-actions";
import type { ProviderName } from "@/lib/finance/payment-intent";

export function PortalPayButton({
  invoiceId,
  enabled,
  providers,
}: {
  invoiceId: string;
  enabled: boolean;
  providers: ProviderName[];
}) {
  const i = t.portal.invoices;
  const I = t.finance.intents;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Default production state: disabled placeholder (flag off / no provider).
  if (!enabled || providers.length === 0) {
    return (
      <button
        type="button"
        disabled
        title={i.paySoon}
        className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-400"
      >
        {i.paySoon}
      </button>
    );
  }

  function pay(provider: ProviderName) {
    setError(null);
    startTransition(async () => {
      const res = await createPortalPaymentIntent(invoiceId, provider);
      if (res.ok && res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      setError(i.payError);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {providers.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => pay(p)}
          disabled={pending}
          className="rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-100 disabled:opacity-50"
        >
          {pending ? i.paying : `${i.payOnline} · ${I.providers[p]}`}
        </button>
      ))}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
