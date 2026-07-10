import { t } from "@/lib/i18n";
import { groupDocuments, DOC_CATEGORY_ORDER, formatShortDate, type DocCategory } from "@/lib/portal/shipment-view";
import { PortalDocActions } from "./portal-doc-actions";
import type { PortalDocument } from "@/lib/portal/types";

const CATEGORY_ICON: Record<DocCategory, string> = {
  commercial: "🧾",
  transport: "🚚",
  customs: "🛃",
  finance: "💳",
};

/** Modern grouped document center (Phase 3.3 D7). Reuses the portal document service. */
export function DocumentCenter({ documents }: { documents: PortalDocument[] }) {
  const d = t.portal.premium.documents;
  const groups = groupDocuments(documents);
  const present = DOC_CATEGORY_ORDER.filter((cat) => groups[cat].length > 0);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-navy-900">{d.title}</h2>
      {documents.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 p-8 text-center text-sm text-slate-500">
          {d.empty}
        </div>
      ) : (
        <div className="space-y-4">
          {present.map((cat) => (
            <div key={cat} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                <span aria-hidden>{CATEGORY_ICON[cat]}</span>
                <span className="text-sm font-semibold text-navy-900">{d.categories[cat]}</span>
                <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">
                  {groups[cat].length}
                </span>
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
                        {d.uploaded} {formatShortDate(doc.createdAt)}
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      {d.available}
                    </span>
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
