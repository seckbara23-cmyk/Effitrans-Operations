"use client";

/**
 * Manual "send email" trigger button (Phase 1.14). Client — server-action proxy.
 * Used at the trigger points (invoice issued / document shared / portal invite).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { emailDocumentShared, emailInvoiceIssued, emailPortalInvite } from "@/lib/comms/actions";

export function EmailTriggerButton({
  kind,
  id,
  label,
}: {
  kind: "invoice" | "document" | "invite";
  id: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function run() {
    setError(null);
    start(async () => {
      const fn = kind === "invoice" ? emailInvoiceIssued : kind === "document" ? emailDocumentShared : emailPortalInvite;
      const res = await fn(id);
      if (!res.ok) {
        const map = t.communications.errors as Record<string, string>;
        setError(map[res.error] ?? t.communications.errors.generic);
        return;
      }
      setDone(true);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={run}
        disabled={pending || done}
        className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {pending ? t.communications.sending : done ? `✓ ${label}` : label}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
