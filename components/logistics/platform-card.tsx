import Link from "next/link";
import type { PlatformCard as PlatformCardData } from "@/lib/logistics/reader";

/**
 * Logistics Command Center — platform overview card (Phase 7.3C). Server component, purely
 * presentational. The derived state uses the existing application status colours; an
 * unavailable/empty module reads "Aucune donnée opérationnelle" — never "Normal".
 */
const STATE: Record<string, { label: string; cls: string }> = {
  normal: { label: "Normal", cls: "bg-teal-50 text-teal-700" },
  attention: { label: "Attention", cls: "bg-amber-50 text-amber-700" },
  critical: { label: "Critique", cls: "bg-red-50 text-red-700" },
  no_data: { label: "Aucune donnée opérationnelle", cls: "bg-slate-100 text-slate-500" },
};

export function PlatformCard({ card, title, icon, href, cta, unauthorized }: {
  card: PlatformCardData | null;
  title: string;
  icon: string;
  href: string;
  cta: string;
  unauthorized?: boolean;
}) {
  const state = card ? STATE[card.state] : STATE.no_data;
  return (
    <div className="surface flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-navy-900"><span aria-hidden>{icon}</span>{title}</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${state.cls}`}>{state.label}</span>
      </div>
      {unauthorized ? (
        <p className="text-xs text-slate-500">Accès non autorisé à ce module.</p>
      ) : !card || !card.available || card.kpis.length === 0 ? (
        <p className="text-xs text-slate-500">Aucune donnée opérationnelle pour le moment.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          {card.kpis.map((k) => (
            <div key={k.label} className="flex flex-col">
              <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k.label}</dt>
              <dd className="tabular font-semibold text-navy-800">{k.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {!unauthorized && (
        <Link href={href} className="mt-auto inline-block rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-teal-700 hover:border-teal-300">{cta} →</Link>
      )}
    </div>
  );
}
