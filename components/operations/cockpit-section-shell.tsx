import Link from "next/link";

/**
 * Centre d'Opérations — section wrapper (Phase 10.0C). Presentational.
 * A consistent titled region with an optional drill-down link. Multiple cockpit
 * sections consume it, so the abstraction earns its place.
 */
export function CockpitSectionShell({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action && (
          <Link href={action.href} className="whitespace-nowrap text-xs font-medium text-teal-700 hover:underline">
            {action.label} →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
