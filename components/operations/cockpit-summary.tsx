import { StatCard } from "@/components/departments/stat-card";
import type { CockpitSummaryIndicator } from "@/lib/operations/types";

/**
 * Centre d'Opérations — operational summary band (Phase 10.0C, Scope B).
 * Renders the curated headline indicators the composition layer produced. NO
 * aggregation here — the list arrives ready (permission-shaped, counts only).
 * Urgent indicators get an amber/red tone from the projection, plus an assistive
 * "prioritaire" marker so the signal is not colour-only (Scope L).
 */
export function CockpitSummaryCards({ indicators }: { indicators: CockpitSummaryIndicator[] }) {
  if (indicators.length === 0) return null;
  return (
    <section aria-label="Résumé opérationnel" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-7">
      {indicators.map((i) => (
        <StatCard
          key={i.key}
          label={i.urgent ? `${i.label} · prioritaire` : i.label}
          value={i.value}
          tone={i.tone}
          href={i.href}
        />
      ))}
    </section>
  );
}
