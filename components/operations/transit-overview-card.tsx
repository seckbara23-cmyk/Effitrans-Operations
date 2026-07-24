import { PlatformCard } from "@/components/logistics/platform-card";
import { StatCard } from "@/components/departments/stat-card";
import { CockpitSectionShell } from "./cockpit-section-shell";
import { CockpitEmptyState } from "./cockpit-states";
import type { CockpitTransit } from "@/lib/operations/types";
import type { PlatformCard as PlatformCardData } from "@/lib/logistics/reader";

/**
 * Centre d'Opérations — Transit widget (Phase 10.0C, Scope E).
 * Reuses the existing Command Center PlatformCard (transport:read) AND, sourced
 * INDEPENDENTLY, a customs slice (customs:read). Each part degrades on its own:
 *  - transport-only user → mode cards, customs card marked "non autorisé";
 *  - customs-only user   → no mode cards, but the authorized customs figures.
 * The UI never merges unauthorized data merely because the card says "Transit".
 */
const MODE_META: Record<PlatformCardData["mode"], { title: string; icon: string; href: string; cta: string }> = {
  road: { title: "Transport routier", icon: "🚚", href: "/transport", cta: "Ouvrir les opérations routières" },
  ocean: { title: "Lignes maritimes", icon: "🚢", href: "/shipping", cta: "Ouvrir Ocean Shipping" },
  air: { title: "Fret aérien", icon: "✈️", href: "/air", cta: "Ouvrir Air Cargo" },
  customs: { title: "Intelligence douanière", icon: "🛃", href: "/customs/intelligence", cta: "Ouvrir Customs Intelligence" },
};

export function TransitOverviewCard({ transit }: { transit: CockpitTransit }) {
  const cardByMode = new Map(transit.cards.map((c) => [c.mode, c]));

  return (
    <CockpitSectionShell
      title="Transit"
      subtitle={
        transit.headline
          ? `${transit.headline.movementsInProgress} mouvement(s) en cours · ${transit.headline.arrivingWithin7Days} arrivée(s) ≤ 7 j`
          : undefined
      }
      action={{ href: "/departments/transit", label: "Ouvrir Transit" }}
    >
      {transit.transportAuthorized ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {(["road", "ocean", "air", "customs"] as const).map((mode) => (
            <PlatformCard
              key={mode}
              card={cardByMode.get(mode) ?? null}
              title={MODE_META[mode].title}
              icon={MODE_META[mode].icon}
              href={MODE_META[mode].href}
              cta={MODE_META[mode].cta}
              unauthorized={mode === "customs" && !transit.customsAuthorized}
            />
          ))}
        </div>
      ) : transit.customs ? (
        // Customs-only viewer — authorized customs figures, no transport visibility.
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <StatCard label="Déclarations en cours" value={transit.customs.pending} tone="amber" href="/customs/intelligence" />
          <StatCard label="Mainlevées" value={transit.customs.released} tone="teal" href="/customs/intelligence" />
          <StatCard label="File d'inspection" value={transit.customs.inspection} tone="navy" href="/customs/intelligence" />
          <StatCard
            label="Dédouanement moyen"
            value={transit.customs.avgClearanceDays != null ? `${transit.customs.avgClearanceDays} j` : "—"}
            tone="slate"
            href="/customs/intelligence"
          />
        </div>
      ) : (
        <CockpitEmptyState message="Aucune donnée de transit accessible." />
      )}
    </CockpitSectionShell>
  );
}
