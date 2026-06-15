"use client";

/**
 * Verify / reject controls for one pending payment in the reconciliation view
 * (Phase 1.15A). Client only — invokes the finance server-action proxies. Gated
 * by the caller (finance:void). Reject = reverse + mark REJECTED.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { rejectPayment, verifyPayment } from "@/lib/finance/actions";
import type { ActionResult } from "@/lib/finance/types";

export function ReconciliationActions({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const f = t.finance;

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

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        onClick={() => run(() => verifyPayment(paymentId))}
        disabled={pending}
        className="rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50"
      >
        {f.invoices.verify}
      </button>
      <button
        onClick={() => {
          const note = window.prompt(f.invoices.rejectPrompt) ?? "";
          run(() => rejectPayment(paymentId, note.trim() || null));
        }}
        disabled={pending}
        className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
      >
        {f.invoices.reject}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
