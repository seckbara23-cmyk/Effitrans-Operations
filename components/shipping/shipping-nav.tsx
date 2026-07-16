"use client";

/**
 * Ocean Shipping workspace navigation (Phase 7.2C). Client component (usePathname for the
 * active tab). Renders a breadcrumb (Transport › Lignes maritimes › Section) + a tab bar
 * across every implemented /shipping route. This is the discoverability layer: the base
 * sidebar is a frozen five-section contract, so the Shipping workspace needs its own local
 * navigation. Pure composition — no business logic, no new backend.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = { href: string; label: string; exact?: boolean };
export const SHIPPING_TABS: Tab[] = [
  { href: "/shipping", label: "Tableau de bord", exact: true },
  { href: "/shipping/shipments", label: "Expéditions" },
  { href: "/shipping/containers", label: "Conteneurs" },
  { href: "/shipping/vessels", label: "Navires" },
  { href: "/shipping/voyages", label: "Voyages" },
  { href: "/shipping/ports", label: "Ports" },
  { href: "/shipping/carriers", label: "Transporteurs" },
  { href: "/shipping/alerts", label: "Alertes" },
];

export function ShippingNav() {
  const pathname = usePathname();
  const isActive = (t: Tab) => (t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`));
  const current = [...SHIPPING_TABS].reverse().find(isActive) ?? SHIPPING_TABS[0];

  return (
    <div className="mb-4 space-y-2">
      <nav className="flex flex-wrap items-center gap-1 text-xs text-slate-500" aria-label="Fil d'Ariane">
        <Link href="/departments/transport" className="hover:text-teal-700">Transport</Link>
        <span aria-hidden>›</span>
        <Link href="/shipping" className="hover:text-teal-700">Lignes maritimes</Link>
        {current.href !== "/shipping" && (<><span aria-hidden>›</span><span className="font-medium text-navy-700">{current.label}</span></>)}
      </nav>
      <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-2">
        {SHIPPING_TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={isActive(t) ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${isActive(t) ? "bg-navy-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
