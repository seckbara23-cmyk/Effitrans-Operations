"use client";

/**
 * Client directory table (Phase 1.1). Client component.
 * Invokes server-action proxies only (archive/restore); no server-only imports.
 */
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { t } from "@/lib/i18n";
import { archiveClient, restoreClient } from "@/lib/clients/actions";
import type { ActionResult, ClientListItem } from "@/lib/clients/types";

export function ClientsTable({
  clients,
  canCreate,
  canDelete,
  includeArchived,
}: {
  clients: ClientListItem[];
  canCreate: boolean;
  canDelete: boolean;
  includeArchived: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        const map = t.clients.errors as Record<string, string>;
        setError(map[res.error] ?? t.clients.errors.generic);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href={includeArchived ? "/clients" : "/clients?archived=1"}
          className="text-sm font-medium text-teal-700 hover:underline"
        >
          {includeArchived ? t.clients.status.active : t.clients.showArchived}
        </Link>
        {canCreate && (
          <Link
            href="/clients/new"
            className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800"
          >
            {t.clients.new}
          </Link>
        )}
      </div>

      {error && (
        <div className="surface border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      {clients.length === 0 ? (
        <div className="surface p-6 text-sm text-slate-600">{t.clients.empty}</div>
      ) : (
        <div className="surface overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-sand-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">{t.clients.columns.name}</th>
                <th className="px-4 py-3 font-semibold">{t.clients.columns.ninea}</th>
                <th className="px-4 py-3 font-semibold">{t.clients.columns.segment}</th>
                <th className="px-4 py-3 font-semibold">{t.clients.columns.contact}</th>
                <th className="px-4 py-3 font-semibold">{t.clients.columns.status}</th>
                <th className="px-4 py-3 font-semibold">{t.clients.columns.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {clients.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <Link href={`/clients/${c.id}`} className="font-medium text-navy-900 hover:text-teal-700">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 tabular text-slate-600">{c.ninea ?? t.common.none}</td>
                  <td className="px-4 py-3 text-slate-600">{c.segment ?? t.common.none}</td>
                  <td className="px-4 py-3 text-slate-600">{c.email ?? c.phone ?? t.common.none}</td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        c.status === "active"
                          ? "inline-block rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700"
                          : "inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500"
                      }
                    >
                      {c.status === "active" ? t.clients.status.active : t.clients.status.archived}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {canDelete &&
                      (c.status === "active" ? (
                        <button
                          onClick={() => run(() => archiveClient(c.id))}
                          disabled={pending}
                          className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {t.clients.actions.archive}
                        </button>
                      ) : (
                        <button
                          onClick={() => run(() => restoreClient(c.id))}
                          disabled={pending}
                          className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-navy-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {t.clients.actions.restore}
                        </button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
