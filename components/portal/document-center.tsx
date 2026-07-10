import { t } from "@/lib/i18n";
import { groupDocuments, DOC_CATEGORY_ORDER, formatShortDate, type DocCategory } from "@/lib/portal/shipment-view";
import { PortalDocActions } from "./portal-doc-actions";
import type { PortalDocument } from "@/lib/portal/types";
import type { DocRequirement, DocReqState } from "@/lib/portal/tracking-derive";

const CATEGORY_ICON: Record<DocCategory, string> = { commercial: "🧾", transport: "🚚", customs: "🛃", finance: "💳" };

const REQ_STYLE: Record<DocReqState, string> = {
  requis: "bg-slate-100 text-slate-600",
  recu: "bg-sky-50 text-sky-700",
  en_verification: "bg-amber-50 text-amber-700",
  valide: "bg-emerald-50 text-emerald-700",
  a_remplacer: "bg-rose-50 text-rose-700",
};

/** Modern grouped document center + requirement checklist (Phase 3.3A D5). */
export function DocumentCenter({
  documents,
  requirements = [],
}: {
  documents: PortalDocument[];
  requirements?: DocRequirement[];
}) {
  const d = t.portal.premium.documents;
  const groups = groupDocuments(documents);
  const present = DOC_CATEGORY_ORDER.filter((cat) => groups[cat].length > 0);

  return (
    <section id="documents" className="scroll-mt-20 space-y-3">
      <h2 className="text-sm font-semibold text-navy-900">{d.title}</h2>

      {/* Required documents checklist (customer-safe states) */}
      {requirements.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
          <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5 text-sm font-semibold text-navy-900">{d.required}</div>
          <ul className="divide-y divide-slate-100">
            {requirements.map((r) => (
              <li key={r.code} className="flex items-center gap-2 px-4 py-2.5">
                <span className="truncate text-sm text-navy-900">{r.label}</span>
                <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${REQ_STYLE[r.state]}`}>
                  {d.states[r.state]}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Available shared documents, grouped */}
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
                      <p className="text-[11px] text-slate-400">{d.uploaded} {formatShortDate(doc.createdAt)}</p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">{d.available}</span>
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
