/**
 * TRANSPORT-MAP-SATELLITE-01 — basemaps for the live map. PURE (no I/O).
 * ---------------------------------------------------------------------------
 * The Transport command centre has always drawn ONE basemap: the OpenStreetMap
 * raster, draped on MapLibre's real 3D camera. This module adds a second one —
 * satellite imagery — without the map component learning anything about tile
 * vendors, keys or environment variables.
 *
 * HOW THE PROVIDER REACHES THE BROWSER, stated plainly. Raster imagery is
 * fetched by the browser straight from the provider, so whatever credential
 * the tile URL carries is visible to the viewer's network tab — that is true of
 * every raster tile product on the market and no architecture hides it. What
 * CAN be controlled is (1) that the credential is never bundled into client
 * JavaScript, (2) that it is only ever rendered into the page for a signed-in
 * user who holds `transport:read`, and (3) that it is restricted at the
 * provider to this site's origin. (1) and (2) are what this module and the
 * server-only reader enforce; (3) is a provider-side setting and is documented
 * in `.env.example`.
 *
 * So the provider configuration is resolved on the SERVER from SERVER-ONLY
 * variables (not NEXT_PUBLIC_), validated here, and handed to the map as a
 * plain prop. The map component contains no `process.env`, no vendor name and
 * no key-shaped token — a guarantee the TMS-2 tests pin.
 *
 * DEFAULT IS PLAN, NOT SATELLITE, until two things are true: a provider is
 * configured AND the operator has flipped `TRANSPORT_SATELLITE_DEFAULT=true`.
 * An unconfigured environment is exactly what it was before this slice.
 *
 * LABELS. Imagery alone has no road names. A provider may ship a hybrid tile
 * (imagery with labels baked in) or a separate transparent labels layer; both
 * are supported — the second via `TRANSPORT_SATELLITE_LABELS_TILE_URL`, drawn
 * ABOVE the imagery.
 *
 * ATTRIBUTION IS MANDATORY. A satellite source with no attribution string is
 * treated as not configured: every imagery licence this project considered
 * requires on-map attribution, and a missing credit is a licence breach, not a
 * cosmetic gap.
 */
import type { StyleSpecification } from "maplibre-gl";

export type BasemapKey = "plan" | "satellite";

export const BASEMAP_LABEL_FR: Readonly<Record<BasemapKey, string>> = {
  plan: "Plan",
  satellite: "Satellite",
};

/** What the server hands the map when satellite imagery is configured. */
export type SatelliteTiles = {
  /** Raster tile template with {z} {x} {y} tokens (https only). */
  tiles: string;
  /** On-map credit required by the imagery licence. Never empty. */
  attribution: string;
  /** Optional transparent labels template drawn above the imagery. */
  labels: string | null;
  /** Open on satellite rather than plan. Only honoured when configured. */
  defaultOn: boolean;
};

export type SatelliteEnv = {
  TRANSPORT_SATELLITE_TILE_URL?: string;
  TRANSPORT_SATELLITE_ATTRIBUTION?: string;
  TRANSPORT_SATELLITE_LABELS_TILE_URL?: string;
  TRANSPORT_SATELLITE_DEFAULT?: string;
};

export const MAX_TILE_TEMPLATE_LENGTH = 2000;

/**
 * A usable raster template: https, the three XYZ tokens, no whitespace, a sane
 * length. `{z}/{y}/{x}` ordering (Esri's) is fine — MapLibre substitutes tokens
 * by name — so the check is on presence, not position.
 */
export function isValidTileTemplate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s.length === 0 || s.length > MAX_TILE_TEMPLATE_LENGTH) return false;
  if (s !== v) return false; // leading/trailing whitespace is a paste error
  if (/\s/.test(s)) return false;
  if (!/^https:\/\//i.test(s)) return false;
  return s.includes("{z}") && s.includes("{x}") && s.includes("{y}");
}

/**
 * Resolve the satellite configuration from raw env strings. Returns null —
 * "not configured" — for anything less than a valid template plus a credit.
 * A labels template that fails validation disables ONLY the labels.
 */
export function resolveSatelliteConfig(env: SatelliteEnv): SatelliteTiles | null {
  const tiles = env.TRANSPORT_SATELLITE_TILE_URL;
  if (!isValidTileTemplate(tiles)) return null;
  const attribution = (env.TRANSPORT_SATELLITE_ATTRIBUTION ?? "").trim();
  if (attribution.length === 0) return null;
  const labels = isValidTileTemplate(env.TRANSPORT_SATELLITE_LABELS_TILE_URL)
    ? env.TRANSPORT_SATELLITE_LABELS_TILE_URL
    : null;
  return {
    tiles,
    attribution,
    labels,
    defaultOn: env.TRANSPORT_SATELLITE_DEFAULT === "true",
  };
}

/** Which basemap the map opens on. Plan unless satellite is configured AND asked for. */
export function initialBasemap(satellite: SatelliteTiles | null | undefined): BasemapKey {
  return satellite?.defaultOn ? "satellite" : "plan";
}

export const SATELLITE_SOURCE_ID = "satellite";
export const SATELLITE_LABELS_SOURCE_ID = "satellite-labels";

/**
 * A MapLibre style for the imagery: one raster source (plus the optional labels
 * source above it). Raster only, so the camera, markers and the observed-route
 * layer behave exactly as they do on the plan basemap.
 */
export function buildSatelliteStyle(cfg: SatelliteTiles): StyleSpecification {
  const style: StyleSpecification = {
    version: 8,
    sources: {
      [SATELLITE_SOURCE_ID]: {
        type: "raster",
        tiles: [cfg.tiles],
        tileSize: 256,
        attribution: cfg.attribution,
      },
    },
    layers: [{ id: SATELLITE_SOURCE_ID, type: "raster", source: SATELLITE_SOURCE_ID }],
  };
  if (cfg.labels) {
    style.sources[SATELLITE_LABELS_SOURCE_ID] = {
      type: "raster",
      tiles: [cfg.labels],
      tileSize: 256,
    };
    style.layers.push({ id: SATELLITE_LABELS_SOURCE_ID, type: "raster", source: SATELLITE_LABELS_SOURCE_ID });
  }
  return style;
}

/** Is this map error about the imagery (as opposed to the plan tiles or anything else)? */
export function isSatelliteSourceError(evt: { sourceId?: unknown; error?: unknown }): boolean {
  const id = typeof evt.sourceId === "string" ? evt.sourceId : null;
  if (id === SATELLITE_SOURCE_ID || id === SATELLITE_LABELS_SOURCE_ID) return true;
  // Tile-load failures carry an HTTP status; auth/quota refusals are the ones
  // worth reverting on, and they only ever come from the keyed imagery source.
  const status = (evt.error as { status?: unknown } | undefined)?.status;
  return status === 401 || status === 403 || status === 429;
}
