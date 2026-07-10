/**
 * Portal map points + GPS seam (Phase 3.3A — Deliverables 9 & 10) — PURE. No I/O.
 * ---------------------------------------------------------------------------
 * Builds the geographic points for the shipment map from a VETTED location
 * registry only. Free-text locations are matched against the registry — never
 * silently geocoded — so no coordinates are ever invented. When endpoints do not
 * resolve, the map component falls back to the non-geographic route diagram.
 *
 * FUTURE GPS PATH (no live polling / workers / table this phase): a live vehicle
 * position would arrive as a `TrackingPosition` and be appended as the "current"
 * point. Sources, in order of future integration:
 *   1. driver mobile location (driver app posts lat/lng)  → source "driver_mobile"
 *   2. vehicle GPS device / telematics                    → source "gps_provider"
 *   3. manual dispatcher update (last-known position)     → source "manual"
 * When a persisted transport position becomes available, resolve it here and mark
 * it the current point; the component contract (MapPoint[]) does not change.
 */

/** Future real-time position shape (interface seam only — not persisted yet). */
export type TrackingPosition = {
  latitude: number;
  longitude: number;
  recordedAt: string;
  source: "manual" | "driver_mobile" | "gps_provider";
  accuracyMeters?: number;
};

export type LatLng = { lat: number; lng: number };

/**
 * Vetted registry of known West-Africa logistics locations. Coordinates are
 * curated (ports, airports, capitals on Effitrans corridors), NOT geocoded from
 * user text. Matching is by normalized-substring against these aliases.
 */
type RegistryEntry = { key: string; label: string; aliases: string[]; coord: LatLng };
const REGISTRY: RegistryEntry[] = [
  { key: "dakar_port", label: "Port de Dakar", aliases: ["port de dakar", "dakar port", "pad"], coord: { lat: 14.6796, lng: -17.4249 } },
  { key: "dakar", label: "Dakar", aliases: ["dakar"], coord: { lat: 14.7167, lng: -17.4677 } },
  { key: "aibd", label: "AIBD", aliases: ["aibd", "aeroport", "aéroport", "blaise diagne", "diass"], coord: { lat: 14.6708, lng: -17.0733 } },
  { key: "bamako", label: "Bamako", aliases: ["bamako", "mali"], coord: { lat: 12.6392, lng: -8.0029 } },
  { key: "conakry", label: "Conakry", aliases: ["conakry", "guinee", "guinée"], coord: { lat: 9.6412, lng: -13.5784 } },
  { key: "nouakchott", label: "Nouakchott", aliases: ["nouakchott", "mauritanie"], coord: { lat: 18.0858, lng: -15.9785 } },
  { key: "abidjan", label: "Abidjan", aliases: ["abidjan", "cote d'ivoire", "côte d'ivoire", "ivoire"], coord: { lat: 5.3599, lng: -4.0083 } },
  { key: "ouagadougou", label: "Ouagadougou", aliases: ["ouagadougou", "ouaga", "burkina"], coord: { lat: 12.3714, lng: -1.5197 } },
  { key: "banjul", label: "Banjul", aliases: ["banjul", "gambie"], coord: { lat: 13.4549, lng: -16.579 } },
  { key: "bissau", label: "Bissau", aliases: ["bissau", "guinee-bissau", "guinée-bissau"], coord: { lat: 11.8817, lng: -15.6178 } },
  { key: "kaolack", label: "Kaolack", aliases: ["kaolack"], coord: { lat: 14.182, lng: -16.2533 } },
  { key: "touba", label: "Touba", aliases: ["touba"], coord: { lat: 14.85, lng: -15.8833 } },
  { key: "thies", label: "Thiès", aliases: ["thies", "thiès"], coord: { lat: 14.7833, lng: -16.9667 } },
  { key: "ziguinchor", label: "Ziguinchor", aliases: ["ziguinchor", "casamance"], coord: { lat: 12.5833, lng: -16.2719 } },
  { key: "saint_louis", label: "Saint-Louis", aliases: ["saint-louis", "saint louis"], coord: { lat: 16.0179, lng: -16.4896 } },
];

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Match free text to a vetted registry entry, or null (never geocode blindly). */
export function resolveLocation(text: string | null | undefined): (LatLng & { label: string }) | null {
  const n = normalize(text ?? "");
  if (!n) return null;
  // Longest-alias-first so "port de dakar" wins over "dakar".
  const candidates = REGISTRY.flatMap((e) => e.aliases.map((a) => ({ e, a })));
  candidates.sort((x, y) => y.a.length - x.a.length);
  for (const { e, a } of candidates) {
    if (n.includes(a)) return { lat: e.coord.lat, lng: e.coord.lng, label: e.label };
  }
  return null;
}

export type MapPointState = "completed" | "current" | "pending";
export type MapPoint = { label: string; coord: LatLng | null; state: MapPointState };

/**
 * Build the ordered route points with completed/current/pending states. Only the
 * two endpoints (origin, destination) are geographic; if neither resolves the
 * caller shows the diagram. `progressPercent` places the "current" marker.
 */
export function buildMapPoints(input: {
  origin: string | null;
  destination: string | null;
  progressPercent: number;
  livePosition?: TrackingPosition | null;
}): { points: MapPoint[]; hasGeo: boolean } {
  const o = resolveLocation(input.origin);
  const d = resolveLocation(input.destination);

  const points: MapPoint[] = [
    { label: o?.label ?? input.origin ?? "Origine", coord: o ? { lat: o.lat, lng: o.lng } : null, state: input.progressPercent > 0 ? "completed" : "current" },
    { label: d?.label ?? input.destination ?? "Destination", coord: d ? { lat: d.lat, lng: d.lng } : null, state: input.progressPercent >= 100 ? "completed" : "pending" },
  ];

  // A grounded live position (future GPS) becomes the current in-between point.
  if (input.livePosition) {
    points.splice(1, 0, {
      label: "Position actuelle",
      coord: { lat: input.livePosition.latitude, lng: input.livePosition.longitude },
      state: "current",
    });
  }

  const hasGeo = Boolean(o && d);
  return { points, hasGeo };
}
