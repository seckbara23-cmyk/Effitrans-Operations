/**
 * Real dashboard KPI band (Phase 1.4) — replaces the mock counters with live
 * operational_file counts. Server component; renders nothing if the user lacks
 * file:read or Supabase is unconfigured, so the rest of the dashboard still
 * loads. Numbers come from getFileKpis (tenant-scoped, permission-gated).
 */
import Link from "next/link";
import { getFileKpis } from "@/lib/files/service";
import { t } from "@/lib/i18n";

type Card = { key: string; label: string; value: number; href: string; accent: string };

export async function DashboardFileKpis() {
  let kpis;
  try {
    kpis = await getFileKpis();
  } catch {
    return null; // no file:read / unconfigured — fall through to the rest of the page
  }

  const k = t.files.kpis;
  const cards: Card[] = [
    { key: "active", label: k.active, value: kpis.active, href: "/files", accent: "text-teal-700" },
    { key: "delivered", label: k.delivered, value: kpis.delivered, href: "/files?status=DELIVERED", accent: "text-sky-700" },
    { key: "closed", label: k.closed, value: kpis.closed, href: "/files?status=CLOSED", accent: "text-navy-700" },
    { key: "highPriority", label: k.highPriority, value: kpis.highPriority, href: "/files?priority=high", accent: "text-amber-700" },
    { key: "import", label: k.import, value: kpis.import, href: "/files?type=IMP", accent: "text-slate-700" },
    { key: "export", label: k.export, value: kpis.export, href: "/files?type=EXP", accent: "text-slate-700" },
  ];

  return (
    <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
      {cards.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          className="surface group p-4 transition hover:border-teal-300 hover:shadow-card"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.label}</p>
          <p className={`mt-2 text-2xl font-bold tabular ${c.accent}`}>{c.value}</p>
        </Link>
      ))}
    </section>
  );
}
