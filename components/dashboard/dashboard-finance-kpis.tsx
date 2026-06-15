/**
 * Dashboard finance KPI strip (Phase 1.11). Server component — renders nothing
 * unless the user holds finance:read (money is finance-role gated). Deep-links
 * into the filtered /finance queue.
 */
import Link from "next/link";
import { getFinanceKpis } from "@/lib/finance/service";
import { t } from "@/lib/i18n";

export async function DashboardFinanceKpis() {
  let kpis;
  try {
    kpis = await getFinanceKpis();
  } catch {
    return null; // no finance:read / unconfigured — hide
  }

  const k = t.finance.kpi;
  const cards = [
    { key: "outstanding", label: k.outstanding, value: `${kpis.outstanding.toLocaleString("fr-FR")} XOF`, href: "/finance", accent: "text-navy-700" },
    { key: "overdue", label: k.overdue, value: String(kpis.overdueCount), href: "/finance", accent: "text-red-700" },
    { key: "issued", label: k.issued, value: String(kpis.issuedCount), href: "/finance?status=ISSUED", accent: "text-sky-700" },
    { key: "draft", label: k.draft, value: String(kpis.draftCount), href: "/finance?status=DRAFT", accent: "text-slate-700" },
  ];

  return (
    <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {cards.map((c) => (
        <Link key={c.key} href={c.href} className="surface p-4 transition hover:border-teal-300 hover:shadow-card">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.label}</p>
          <p className={`mt-2 text-xl font-bold tabular ${c.accent}`}>{c.value}</p>
        </Link>
      ))}
    </section>
  );
}
