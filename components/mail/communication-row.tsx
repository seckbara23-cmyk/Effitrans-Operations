"use client";

/**
 * Communications log row with Send/Retry/Cancel (Phase 1.14). Client component.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { cancelMessage, retryMessage, sendMessage } from "@/lib/comms/actions";
import type { ActionResult, CommunicationMessage } from "@/lib/comms/types";

const STATUS_STYLE: Record<string, string> = {
  QUEUED: "bg-slate-100 text-slate-600",
  SENT: "bg-teal-50 text-teal-700",
  FAILED: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-400 line-through",
};

export function CommunicationRow({
  message,
  canSend,
  canManage,
}: {
  message: CommunicationMessage;
  canSend: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const c = t.communications;
  const open = message.status === "QUEUED" || message.status === "FAILED";

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        const map = c.errors as Record<string, string>;
        setError(map[res.error] ?? c.errors.generic);
        return;
      }
      router.refresh();
    });
  }

  return (
    <tr className="hover:bg-slate-50/60">
      <td className="px-4 py-3">
        <p className="text-navy-900">{message.recipientName || message.recipientEmail}</p>
        <p className="text-xs text-slate-400">{message.recipientEmail}</p>
      </td>
      <td className="px-4 py-3 text-slate-600">
        {c.templates[message.templateKey as keyof typeof c.templates] ?? message.templateKey}
      </td>
      <td className="px-4 py-3 text-slate-600">{message.subject}</td>
      <td className="px-4 py-3 text-slate-500">{message.createdAt.slice(0, 10)}</td>
      <td className="px-4 py-3">
        <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[message.status]}`}>
          {c.status[message.status]}
        </span>
        {message.lastError && <p className="mt-1 text-[11px] text-red-500">{message.lastError}</p>}
      </td>
      <td className="px-4 py-3 text-right">
        <span className="inline-flex gap-1">
          {open && message.status === "QUEUED" && canSend && (
            <button onClick={() => run(() => sendMessage(message.id))} disabled={pending} className="rounded-md border border-teal-200 px-2 py-1 text-xs font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-50">
              {c.send}
            </button>
          )}
          {message.status === "FAILED" && canManage && (
            <button onClick={() => run(() => retryMessage(message.id))} disabled={pending} className="rounded-md border border-amber-200 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50">
              {c.retry}
            </button>
          )}
          {open && canManage && (
            <button onClick={() => run(() => cancelMessage(message.id))} disabled={pending} className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50">
              {c.cancel}
            </button>
          )}
        </span>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </td>
    </tr>
  );
}
