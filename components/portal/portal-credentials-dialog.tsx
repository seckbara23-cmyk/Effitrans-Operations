"use client";

/**
 * One-time portal credentials display (Phase 3.2B). Client component.
 * ---------------------------------------------------------------------------
 * Shown ONCE after a portal account is created or its password is reset. The
 * temporary password lives only in this component's props (server-action
 * response → memory) and is gone when the dialog closes. It is NEVER written to
 * localStorage, the URL, the DB, logs, audit or comms. Copy / print are local,
 * client-only conveniences.
 */
import { useState } from "react";
import { t } from "@/lib/i18n";

export function PortalCredentialsDialog({
  email,
  password,
  onClose,
}: {
  email: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const c = t.portal.admin.credentials;

  const asText = `${c.identifier}: ${email}\n${c.tempPassword}: ${password}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the admin can still read/print the values */
    }
  }

  function print() {
    const w = window.open("", "_blank", "width=420,height=360");
    if (!w) return;
    w.document.write(
      `<title>Effitrans — ${c.title}</title>` +
        `<div style="font-family:system-ui,sans-serif;padding:24px">` +
        `<h2 style="margin:0 0 12px">${c.title}</h2>` +
        `<p style="margin:0"><strong>${c.identifier} :</strong> ${email}</p>` +
        `<p style="margin:8px 0 0"><strong>${c.tempPassword} :</strong> <code>${password}</code></p>` +
        `<p style="margin:16px 0 0;color:#64748b">${c.warning}</p>` +
        `</div>`,
    );
    w.document.close();
    w.focus();
    w.print();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={c.title}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-base font-semibold text-navy-900">{c.title}</h2>

        <div className="mt-4 space-y-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.identifier}</p>
            <p className="mt-0.5 break-all font-mono text-sm text-navy-900">{email}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.tempPassword}</p>
            <p className="mt-0.5 break-all font-mono text-lg font-semibold text-navy-900">{password}</p>
          </div>
        </div>

        <p className="mt-4 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800">{c.warning}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copy}
            className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800"
          >
            {copied ? c.copied : c.copy}
          </button>
          <button
            type="button"
            onClick={print}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-navy-700 hover:bg-slate-50"
          >
            {c.print}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-navy-700 hover:bg-slate-50"
          >
            {c.close}
          </button>
        </div>
      </div>
    </div>
  );
}
