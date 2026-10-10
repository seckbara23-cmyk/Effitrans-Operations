/**
 * TRANSPORT-MAP-SATELLITE-01 — a satellite basemap for /transport/suivi.
 * ---------------------------------------------------------------------------
 * What must hold:
 *   * unconfigured = unchanged: no switch, plan basemap, no new network host;
 *   * the map component reads no environment and names no vendor — the
 *     provider arrives as a validated prop from the server;
 *   * satellite is the default only when configured AND explicitly asked for;
 *   * attribution is mandatory: no credit, no imagery;
 *   * the plan is the fallback, and imagery failure reverts to it by itself;
 *   * nothing about tracking changed: markers, headings, route, refresh,
 *     service, driver actions, schema.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BASEMAP_LABEL_FR,
  buildSatelliteStyle,
  initialBasemap,
  isSatelliteSourceError,
  isValidTileTemplate,
  parseTileSize,
  resolveSatelliteConfig,
  MAX_TILE_TEMPLATE_LENGTH,
  SATELLITE_LABELS_SOURCE_ID,
  SATELLITE_SOURCE_ID,
} from "@/lib/tracking/basemaps";
import { MIGRATION_COUNT } from "@/lib/platform/ops/build-info";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const mapRaw = read("components/transport/live-map.tsx");
const mapUi = strip(mapRaw);
const page = read("app/transport/suivi/page.tsx");
const pure = read("lib/tracking/basemaps.ts");
const reader = read("lib/tracking/basemap-config.ts");
const envExample = read(".env.example");

const ESRI = "https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=abc";
const HYBRID = "https://api.example-tiles.test/maps/hybrid/256/{z}/{x}/{y}.jpg?key=abc";
const LABELS = "https://tiles.example.test/labels/{z}/{x}/{y}.png";
const ESRI_HYBRID = "https://static-map-tiles-api.arcgis.com/arcgis/rest/services/static-basemap-tiles-service/v1/open/hybrid/detail/static/tile/{z}/{y}/{x}?token=abc";

describe("SATELLITE-01 — a tile template is accepted only when it is usable", () => {
  it("01 — https with the three tokens, in either order", () => {
    expect(isValidTileTemplate(HYBRID)).toBe(true);
    expect(isValidTileTemplate(ESRI)).toBe(true);
  });

  it("02 — http, a missing token, whitespace, emptiness and non-strings are refused", () => {
    expect(isValidTileTemplate("http://tiles.test/{z}/{x}/{y}.png")).toBe(false);
    expect(isValidTileTemplate("https://tiles.test/{z}/{x}.png")).toBe(false);
    expect(isValidTileTemplate("https://tiles.test/{z}/{x}/{y}.png ")).toBe(false);
    expect(isValidTileTemplate("https://tiles.test/{z}/{x}/ {y}.png")).toBe(false);
    expect(isValidTileTemplate("")).toBe(false);
    expect(isValidTileTemplate(undefined)).toBe(false);
    expect(isValidTileTemplate(42)).toBe(false);
  });

  it("03 — an absurdly long template is refused", () => {
    const long = `https://tiles.test/${"a".repeat(MAX_TILE_TEMPLATE_LENGTH)}/{z}/{x}/{y}`;
    expect(isValidTileTemplate(long)).toBe(false);
  });
});

describe("SATELLITE-01 — resolution is dark by default and licence-first", () => {
  it("04 — nothing set means not configured", () => {
    expect(resolveSatelliteConfig({})).toBeNull();
  });

  it("05 — a template WITHOUT attribution is not configured: licence before pixels", () => {
    expect(resolveSatelliteConfig({ TRANSPORT_SATELLITE_TILE_URL: HYBRID })).toBeNull();
    expect(resolveSatelliteConfig({ TRANSPORT_SATELLITE_TILE_URL: HYBRID, TRANSPORT_SATELLITE_ATTRIBUTION: "   " })).toBeNull();
  });

  it("06 — an invalid template is not configured even with attribution", () => {
    expect(
      resolveSatelliteConfig({ TRANSPORT_SATELLITE_TILE_URL: "http://x/{z}/{x}/{y}", TRANSPORT_SATELLITE_ATTRIBUTION: "c" }),
    ).toBeNull();
  });

  it("07 — template + attribution configures imagery, plan-first", () => {
    const cfg = resolveSatelliteConfig({ TRANSPORT_SATELLITE_TILE_URL: HYBRID, TRANSPORT_SATELLITE_ATTRIBUTION: " © Provider " });
    expect(cfg).toEqual({ tiles: HYBRID, attribution: "© Provider", labels: null, tileSize: 256, defaultOn: false });
    expect(initialBasemap(cfg)).toBe("plan");
  });

  it("08 — labels are optional, and an invalid labels template disables only the labels", () => {
    const good = resolveSatelliteConfig({
      TRANSPORT_SATELLITE_TILE_URL: ESRI,
      TRANSPORT_SATELLITE_ATTRIBUTION: "Esri",
      TRANSPORT_SATELLITE_LABELS_TILE_URL: LABELS,
    });
    expect(good?.labels).toBe(LABELS);
    const bad = resolveSatelliteConfig({
      TRANSPORT_SATELLITE_TILE_URL: ESRI,
      TRANSPORT_SATELLITE_ATTRIBUTION: "Esri",
      TRANSPORT_SATELLITE_LABELS_TILE_URL: "ftp://nope/{z}/{x}/{y}",
    });
    expect(bad).not.toBeNull();
    expect(bad?.labels).toBeNull();
  });

  it("09 — satellite opens by default ONLY with the literal 'true', and only when configured", () => {
    const base = { TRANSPORT_SATELLITE_TILE_URL: HYBRID, TRANSPORT_SATELLITE_ATTRIBUTION: "c" };
    expect(initialBasemap(resolveSatelliteConfig({ ...base, TRANSPORT_SATELLITE_DEFAULT: "true" }))).toBe("satellite");
    expect(initialBasemap(resolveSatelliteConfig({ ...base, TRANSPORT_SATELLITE_DEFAULT: "yes" }))).toBe("plan");
    expect(initialBasemap(resolveSatelliteConfig({ ...base, TRANSPORT_SATELLITE_DEFAULT: "TRUE" }))).toBe("plan");
    // Asking for satellite with nothing configured is simply ignored.
    expect(initialBasemap(resolveSatelliteConfig({ TRANSPORT_SATELLITE_DEFAULT: "true" }))).toBe("plan");
    expect(initialBasemap(null)).toBe("plan");
    expect(initialBasemap(undefined)).toBe("plan");
  });
});

describe("SATELLITE-01 — the style is raster-only, imagery below labels, credited", () => {
  it("10 — one raster source and layer, carrying the attribution", () => {
    const s = buildSatelliteStyle({ tiles: HYBRID, attribution: "© Provider", labels: null, tileSize: 256, defaultOn: false });
    expect(s.version).toBe(8);
    expect(Object.keys(s.sources)).toEqual([SATELLITE_SOURCE_ID]);
    const src = s.sources[SATELLITE_SOURCE_ID] as { type: string; tiles: string[]; tileSize: number; attribution: string };
    expect(src.type).toBe("raster");
    expect(src.tiles).toEqual([HYBRID]);
    expect(src.tileSize).toBe(256);
    expect(src.attribution).toBe("© Provider");
    expect(s.layers.map((l) => l.id)).toEqual([SATELLITE_SOURCE_ID]);
  });

  it("11 — a labels template adds a second raster layer ABOVE the imagery", () => {
    const s = buildSatelliteStyle({ tiles: ESRI, attribution: "Esri", labels: HYBRID, tileSize: 256, defaultOn: false });
    expect(Object.keys(s.sources)).toEqual([SATELLITE_SOURCE_ID, SATELLITE_LABELS_SOURCE_ID]);
    expect(s.layers.map((l) => l.id)).toEqual([SATELLITE_SOURCE_ID, SATELLITE_LABELS_SOURCE_ID]);
    expect(s.layers.every((l) => l.type === "raster")).toBe(true);
  });

  it("12 — the French labels are the two words on the switch", () => {
    expect(BASEMAP_LABEL_FR).toEqual({ plan: "Plan", satellite: "Satellite" });
  });
});

describe("SATELLITE-01 — only an imagery failure triggers the fallback", () => {
  it("13 — errors from the satellite sources, or auth/quota statuses, count", () => {
    expect(isSatelliteSourceError({ sourceId: SATELLITE_SOURCE_ID })).toBe(true);
    expect(isSatelliteSourceError({ sourceId: SATELLITE_LABELS_SOURCE_ID })).toBe(true);
    for (const status of [401, 403, 429]) expect(isSatelliteSourceError({ error: { status } })).toBe(true);
  });

  it("14 — a plan-tile hiccup, a 404, or a shapeless error does NOT", () => {
    expect(isSatelliteSourceError({ sourceId: "osm" })).toBe(false);
    expect(isSatelliteSourceError({ error: { status: 404 } })).toBe(false);
    expect(isSatelliteSourceError({ error: new Error("boom") })).toBe(false);
    expect(isSatelliteSourceError({})).toBe(false);
  });
});

describe("SATELLITE-01 — the map component stays free of environment and vendors", () => {
  it("15 — no process.env, no key-shaped token, no vendor name — comments included", () => {
    // The same guard the TMS-2 suites apply, on the RAW file.
    expect(mapRaw).not.toMatch(/api[_-]?key|accessToken|mapbox|maptiler|VITE_|process\.env/i);
  });

  it("16 — the plan basemap is still the OpenStreetMap raster, inline", () => {
    expect(mapUi).toContain("tile.openstreetmap.org");
    expect(mapUi).toContain("OSM_RASTER_STYLE");
  });

  it("17 — the provider arrives as a prop, validated on the server", () => {
    expect(mapUi).toContain("satellite?: SatelliteTiles | null");
    expect(mapUi).toContain("initialBasemap(satellite)");
    expect(page).toContain("satellite={getSatelliteTiles()}");
    expect(page).toContain('from "@/lib/tracking/basemap-config"');
  });

  it("18 — the reader is server-only and the variables are not public", () => {
    expect(reader).toContain('import "server-only"');
    expect(strip(reader)).not.toContain("NEXT_PUBLIC_");
    for (const v of [
      "TRANSPORT_SATELLITE_TILE_URL",
      "TRANSPORT_SATELLITE_ATTRIBUTION",
      "TRANSPORT_SATELLITE_LABELS_TILE_URL",
      "TRANSPORT_SATELLITE_DEFAULT",
      "TRANSPORT_SATELLITE_TILE_SIZE",
    ]) {
      expect(reader, v).toContain(`process.env.${v}`);
      expect(envExample, v).toMatch(new RegExp(`^${v}=`, "m"));
    }
    expect(envExample).toContain("SERVER ONLY (not NEXT_PUBLIC_)");
  });

  it("19 — the pure module reads no environment either", () => {
    expect(strip(pure)).not.toContain("process.env");
  });
});

describe("SATELLITE-01 — the switch, the swap and the fallback", () => {
  it("20 — the switch is drawn only when imagery is configured", () => {
    expect(mapUi).toContain("{satellite && (");
    expect(mapUi).toContain('aria-label="Fond de carte"');
    expect(mapUi).toContain("aria-pressed={basemap === k}");
    expect(mapUi).toContain("BASEMAP_LABEL_FR[k]");
  });

  it("21 — switching swaps the style without a diff, keeps the camera and re-adds the route", () => {
    expect(mapUi).toContain("function switchBasemap(next: BasemapKey)");
    expect(mapUi).toContain("{ diff: false }");
    // The route effect re-runs after a style load; the camera is never reset.
    expect(mapUi).toContain("[route, ready, styleEpoch]");
    expect(mapUi).toContain('map.on("style.load"');
    const start = mapUi.indexOf("function switchBasemap");
    const swap = mapUi.slice(start, mapUi.indexOf("function flyToSenegal", start));
    expect(swap).not.toMatch(/fitBounds|flyTo|jumpTo|setPitch|setBearing/);
  });

  it("22 — satellite can only be chosen when configured; the plan is always available", () => {
    expect(mapUi).toContain('if (next === "satellite" && !cfg) return;');
  });

  it("23 — an imagery failure reverts to the plan and says so", () => {
    expect(mapUi).toContain('map.on("error"');
    expect(mapUi).toContain("isSatelliteSourceError(");
    expect(mapUi).toContain("map.setStyle(OSM_RASTER_STYLE, { diff: false })");
    expect(mapUi).toContain("Imagerie satellite indisponible");
    expect(mapUi).toContain('role="status"');
  });

  it("24 — the opening basemap is computed once from the prop, not re-derived per refresh", () => {
    expect(mapUi).toContain("useState<BasemapKey>(() => initialBasemap(satellite))");
  });
});

describe("SATELLITE-01 — nothing about tracking changed", () => {
  it("25 — markers, headings, popups, route and empty state keep their pinned shapes", () => {
    for (const s of [
      "for (const m of located)",
      "reg.get(m.transportId)",
      "reg.set(m.transportId,",
      "m.lastPosition != null",
      "canDrawRoute(route ?? [])",
      "(route ?? []).map((p) => [p.lng, p.lat])",
      "Aucune mission suivie actuellement.",
      "absolute inset-0",
      "webglFailed",
      "map.remove()",
      "pitch: SENEGAL_VIEW.pitch",
      "bearing: SENEGAL_VIEW.bearing",
    ]) {
      expect(mapUi, s).toContain(s);
    }
    for (const fake of ["interpolat", "snapToRoad", "directions", "getRoute("]) {
      expect(mapUi.toLowerCase(), fake).not.toContain(fake.toLowerCase());
    }
  });

  it("26 — the tracking service, driver actions and motion rules do not know basemaps exist", () => {
    for (const f of ["lib/tracking/live-service.ts", "lib/driver/actions.ts", "lib/tracking/marker-motion.ts", "lib/tracking/live-model.ts"]) {
      expect(read(f), f).not.toContain("basemaps");
    }
  });

  it("27 — no migration, no schema, no policy: the ledger is exactly where it was", () => {
    const files = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql") && !f.endsWith(".verify.sql"));
    expect(files).toHaveLength(151);
    expect(MIGRATION_COUNT).toBe(151);
  });

  it("28 — the refresh mechanism is untouched", () => {
    expect(read("components/transport/live-refresh.tsx")).toContain("LIVE_REFRESH_MS = 30_000");
  });
});

describe("ESRI-COMPAT-02 — the tile size is explicit: 256 or 512, nothing else", () => {
  const base = { TRANSPORT_SATELLITE_TILE_URL: HYBRID, TRANSPORT_SATELLITE_ATTRIBUTION: "c" };

  it("29 — unset or empty means 256, so every earlier configuration is unchanged", () => {
    expect(resolveSatelliteConfig(base)?.tileSize).toBe(256);
    expect(resolveSatelliteConfig({ ...base, TRANSPORT_SATELLITE_TILE_SIZE: "" })?.tileSize).toBe(256);
    expect(parseTileSize(undefined)).toBe(256);
    expect(parseTileSize("")).toBe(256);
  });

  it("30 — exactly '256' or '512' are accepted", () => {
    expect(resolveSatelliteConfig({ ...base, TRANSPORT_SATELLITE_TILE_SIZE: "256" })?.tileSize).toBe(256);
    expect(resolveSatelliteConfig({ ...base, TRANSPORT_SATELLITE_TILE_SIZE: "512" })?.tileSize).toBe(512);
  });

  it("31 — anything else disables satellite rather than drawing at the wrong scale", () => {
    for (const bad of ["1024", "128", "abc", " 512", "512 ", "512px", "0", "256.0", "0512"]) {
      expect(resolveSatelliteConfig({ ...base, TRANSPORT_SATELLITE_TILE_SIZE: bad }), JSON.stringify(bad)).toBeNull();
      expect(parseTileSize(bad), JSON.stringify(bad)).toBeNull();
    }
    // Strings only — this value comes from the environment, never from code.
    expect(parseTileSize(512)).toBeNull();
  });

  it("32 — the style declares the configured size on the imagery AND the labels source", () => {
    const hybrid = buildSatelliteStyle({ tiles: ESRI_HYBRID, attribution: "Esri", labels: LABELS, tileSize: 512, defaultOn: false });
    const sizes = Object.values(hybrid.sources).map((src) => (src as { tileSize?: number }).tileSize);
    expect(sizes).toEqual([512, 512]);
    const classic = buildSatelliteStyle({ tiles: HYBRID, attribution: "c", labels: null, tileSize: 256, defaultOn: false });
    expect((classic.sources[SATELLITE_SOURCE_ID] as { tileSize?: number }).tileSize).toBe(256);
  });

  it("33 — the server reader passes the variable through, and .env.example documents it", () => {
    expect(strip(reader)).toContain("process.env.TRANSPORT_SATELLITE_TILE_SIZE");
    expect(envExample).toMatch(/^TRANSPORT_SATELLITE_TILE_SIZE=/m);
  });

  it("34 — the documented Esri configuration is the verified one: hybrid static tiles at 512, no phantom labels service", () => {
    expect(envExample).toContain("static-basemap-tiles-service/v1/open/hybrid/detail/static/tile/{z}/{y}/{x}");
    expect(envExample).toContain("TRANSPORT_SATELLITE_TILE_SIZE=512");
    expect(envExample).not.toContain("World_Boundaries_and_Places");
    expect(envExample).toContain('Powered by <a href="https://www.esri.com/">Esri</a>');
    // The lenient imagery-only endpoint stays documented, labelled as a smoke test.
    expect(envExample).toContain("World_Imagery/MapServer/tile/{z}/{y}/{x}");
    expect(envExample).toContain("SMOKE TEST ONLY");
    expect(read("docs/transport/transport-map-satellite-01.md")).toContain("open/hybrid/detail");
  });

  it("35 — the attribution control is no longer forced closed: full on wide maps, a toggle on narrow ones", () => {
    expect(mapUi).not.toContain("compact: true");
    expect(mapUi).toContain("attributionControl: {}");
  });
});
