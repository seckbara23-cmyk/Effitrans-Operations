"use client";

/**
 * Searchable download center (Phase 3.3B F10). A thin client wrapper over the
 * EXISTING portal document data + grouping (lib/portal/shipment-view) and the
 * EXISTING signed-URL download action (via PortalDocActions). Adds only a client
 * -side search + grouped display across ALL of the client's shared documents —
 * no new data source, no new download path. Shows only documents the RLS portal
 * policy already returned (approved + shared + own client).
 */
import { useMemo, useState } from "react";
import { groupDocuments, DOC_CATEGORY_ORDER, formatShortDate, type DocCategory } from "@/lib/portal/shipment-view";
import { PortalDocActions } from "./portal-doc-actions";
import type { PortalDocument } from "@/lib/portal/types";
import { t } from "@/lib/i18n";

const CATEGORY_ICON: Record<DocCategory, string> = { commercial: "🧾", transport: "🚚", customs: "🛃", finance: "💳" };

export function DownloadCenter({ documents }: { documents: PortalDocument[] }) {
  const d = t.portal.premium.documents;
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((doc) =>
      [doc.typeLabel, doc.title, doc.fileNumber].filter(Boolean).some((v) => v!.toLowerCase().includes(q)),
    );
  }, [documents, query]);

  const groups = groupDocuments(filtered);
  const present = DOC_CATEGORY_ORDER.filter((cat) => groups[cat].length > 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-navy-900">{d.title}</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{filtered.length} {d.count}</span>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={d.search}
        className="block w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-navy-900 placeholder:text-slate-400 shadow-sm focus:border-teal-300 focus:outline-none"
      />

      {documents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-500">{d.empty}</div>
      ) : present.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-500">{d.noResults}</div>
      ) : (
        <div className="space-y-4">
          {present.map((cat) => (
            <div key={cat} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                <span aria-hidden>{CATEGORY_ICON[cat]}</span>
                <span className="text-sm font-semibold text-navy-900">{d.categories[cat]}</span>
                <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">{groups[cat].length}</span>
              </div>
              <ul className="divide-y divide-slate-100">
                {groups[cat].map((doc) => (
                  <li key={doc.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-navy-900">
                        {doc.typeLabel}
                        {doc.title ? ` · ${doc.title}` : ""}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {doc.fileNumber ? `${doc.fileNumber} · ` : ""}{d.uploaded} {formatShortDate(doc.createdAt)}
                      </p>
                    </div>
                    <PortalDocActions documentId={doc.id} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
