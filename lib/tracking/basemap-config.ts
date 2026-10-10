/**
 * TRANSPORT-MAP-SATELLITE-01 — server-only reader for the satellite basemap.
 * ---------------------------------------------------------------------------
 * Same idiom as ./config.ts: static literal env access so Next inlines nothing
 * into a client bundle, resolution through the pure module, DARK BY DEFAULT.
 * These variables are deliberately NOT NEXT_PUBLIC_: the browser receives the
 * resolved configuration only as a prop rendered for a signed-in viewer of the
 * Transport live map, never from the bundle.
 */
import "server-only";
import { resolveSatelliteConfig, type SatelliteTiles } from "./basemaps";

export function getSatelliteTiles(): SatelliteTiles | null {
  return resolveSatelliteConfig({
    TRANSPORT_SATELLITE_TILE_URL: process.env.TRANSPORT_SATELLITE_TILE_URL,
    TRANSPORT_SATELLITE_ATTRIBUTION: process.env.TRANSPORT_SATELLITE_ATTRIBUTION,
    TRANSPORT_SATELLITE_LABELS_TILE_URL: process.env.TRANSPORT_SATELLITE_LABELS_TILE_URL,
    TRANSPORT_SATELLITE_DEFAULT: process.env.TRANSPORT_SATELLITE_DEFAULT,
    TRANSPORT_SATELLITE_TILE_SIZE: process.env.TRANSPORT_SATELLITE_TILE_SIZE,
  });
}
