import Link from "next/link";

/**
 * Commercial workspace layout (EC-3C). Follows the Phase-7.2C rule: every
 * frozen-sidebar workspace needs its OWN nested layout, or its sub-pages become
 * unreachable except by typing the URL. Routing/composition only — no data and
 * no auth; each page gates itself.
 */
export default function CommercialLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="animate-fade-in">
      <nav className="mb-4 flex flex-wrap items-center gap-3 text-sm" aria-label="Commercial">
        <Link href="/commercial" className="font-medium text-navy-900 hover:underline">
          Commercial
        </Link>
        <span className="text-slate-300">/</span>
        <Link href="/commercial/quotations/new" className="text-slate-600 hover:underline">
          Nouvelle demande
        </Link>
      </nav>
      {children}
    </div>
  );
}
