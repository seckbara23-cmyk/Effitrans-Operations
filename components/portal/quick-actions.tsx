import Link from "next/link";
import { t } from "@/lib/i18n";

/**
 * Safe quick links (Phase 3.3A D12; contact updated in 3.3B). Navigation only —
 * Contact now routes to the in-portal contact center (#contact), replacing the
 * mailto: hand-off so every message is captured, routed and audited internally.
 */
export function QuickActions({ fileId, contactEmail: _contactEmail }: { fileId: string; contactEmail: string | null }) {
  const q = t.portal.premium.quick;
  const items: { label: string; href: string; icon: string }[] = [
    { label: q.documents, href: `/portal/files/${fileId}#documents`, icon: "📄" },
    { label: q.invoices, href: `/portal/files/${fileId}#invoices`, icon: "💳" },
    { label: q.notifications, href: "/portal/notifications", icon: "🔔" },
    { label: q.contact, href: `/portal/files/${fileId}#contact`, icon: "✉️" },
  ];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
      <p className="mb-3 text-sm font-semibold text-navy-900">{q.title}</p>
      <div className="grid grid-cols-2 gap-2">
        {items.map((it) => (
          <Link
            key={it.label}
            href={it.href}
            className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-medium text-navy-700 transition hover:border-teal-300 hover:bg-teal-50"
          >
            <span aria-hidden>{it.icon}</span>
            {it.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
