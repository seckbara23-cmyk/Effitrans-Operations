/**
 * TMS-2D — the always-on 3D Senegal command centre.
 * ---------------------------------------------------------------------------
 * The map is the furniture; the telemetry is what changes. It renders whether
 * or not anything is being tracked, it opens on the whole country because
 * missions run nationwide, and it is genuinely three-dimensional — WebGL pitch
 * and bearing, not a CSS transform.
 *
 * What must never drift:
 *   * the map renders with zero missions, and invents nothing to fill it;
 *   * geometry is OBSERVED only — 0 fixes no marker, 1 fix no line, 2+ a line;
 *   * the default camera is a VIEWPORT, never a business location;
 *   * the camera belongs to the operator: telemetry never yanks it;
 *   * every TMS-2 authority, privacy and non-authority guarantee still holds.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  mapViewFor,
  canDrawRoute,
  SENEGAL_VIEW,
  FALLBACK_MAP_VIEW,
  SENEGAL_CONTEXT_CITIES,
  MAP_LEGEND_FR,
  summarizeLiveMissions,
  type LiveMission,
  type LiveMissionPoint,
} from "@/lib/tracking/live-model";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const mapRaw = read("components/transport/live-map.tsx");
const mapUi = strip(mapRaw);
const model = read("lib/tracking/live-model.ts");
const service = strip(read("lib/tracking/live-service.ts"));
const page = read("app/transport/suivi/page.tsx");
const refreshRaw = read("components/transport/live-refresh.tsx");
const refresh = strip(refreshRaw);

const at = (lat: number, lng: number, when = "2026-09-03T10:00:00Z"): LiveMissionPoint => ({ lat, lng, at: when });
const mission = (over: Partial<LiveMission> = {}): LiveMission => ({
  transportId: "t1", fileId: "f1", fileNumber: "EFT-IMP-2026-00001",
  vehicleLabel: "AA460MV", driverName: "Mamadou Diop", transportStatus: "IN_TRANSIT",
  sessionStatus: "ACTIVE", leg: "OUTBOUND", health: "live",
  lastPosition: at(14.7, -17.45), pickupLocation: "Port de Dakar", deliveryLocation: "Thiès",
  returnLocation: null, returnPoint: null, returnStartedAt: null,
  ...over,
});

// ═══════════ 1–5, 16 — the map is permanent ════════════════════════════════

describe("TMS-2D — the map renders whether or not anything is tracked", () => {
  it("there is NO early return that hides the map when nothing is observed", () => {
    // The defect: `if (all.length === 0) return <div>…</div>` replaced the map
    // with a sentence, so a quiet morning looked like a broken page.
    expect(mapUi).not.toMatch(/if\s*\(\s*all\.length === 0\s*\)/);
    expect(mapUi).not.toContain("La carte s'affichera");
    expect(mapUi).not.toContain("Aucune position enregistrée");
  });

  it("the map container is rendered unconditionally, outside any mission check", () => {
    const container = mapUi.indexOf('<div ref={containerRef}');
    const emptyState = mapUi.indexOf("{missions.length === 0 && (");
    expect(container).toBeGreaterThan(-1);
    expect(emptyState).toBeGreaterThan(-1);
    // The container precedes the empty state and is not nested inside it.
    expect(container).toBeLessThan(emptyState);
  });

  it("the empty state is an OVERLAY carrying the ratified sentence", () => {
    expect(mapUi).toContain("absolute inset-0");
    expect(mapUi).toContain("Aucune mission suivie actuellement.");
  });

  it("zero missions produce no marker and no route", () => {
    expect(mapViewFor([], []).kind).toBe("fallback");
    expect(canDrawRoute([])).toBe(false);
    // Markers are derived strictly from missions that have a position.
    expect(mapUi).toContain("m.lastPosition != null");
  });

  it("the page no longer gates the map on having missions", () => {
    const mapAt = page.indexOf("<TransportLiveMap");
    const listGate = page.indexOf("{missions.length === 0 ? (");
    expect(mapAt).toBeGreaterThan(-1);
    expect(listGate).toBeGreaterThan(-1);
    expect(mapAt, "the map must precede — and sit outside — the list's conditional").toBeLessThan(listGate);
  });

  it("nothing fabricates a marker to fill an empty map", () => {
    for (const forbidden of ["placeholder", "demoMission", "sampleMarker", "Math.random"]) {
      expect(mapUi, forbidden).not.toContain(forbidden);
    }
  });
});

// ═══════════ 3A — genuinely 3D, and honest about what that means ═══════════

describe("TMS-2D — the 3D is real WebGL, not a CSS illusion", () => {
  it("Leaflet is not used on this surface, and the reason is recorded", () => {
    expect(mapUi).not.toContain("react-leaflet");
    expect(mapUi).not.toContain('from "leaflet"');
    expect(mapRaw).toContain("ZERO occurrences of `pitch`, `bearing` or `WebGL`");
  });

  it("the engine is MapLibre GL — free, BSD-3-Clause, no key", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies["maplibre-gl"], "maplibre-gl must be a dependency").toBeTruthy();
    const lic = JSON.parse(read("node_modules/maplibre-gl/package.json")).license;
    expect(lic).toBe("BSD-3-Clause");
    expect(mapUi).toContain("maplibre-gl");
  });

  it("pitch and bearing are set on the real camera", () => {
    expect(mapUi).toContain("pitch: SENEGAL_VIEW.pitch");
    expect(mapUi).toContain("bearing: SENEGAL_VIEW.bearing");
    expect(SENEGAL_VIEW.pitch).toBeGreaterThan(0);
    expect(mapUi).toContain("visualizePitch: true");
    expect(mapUi).toContain("maxPitch");
  });

  it("3D is NOT faked with CSS transforms", () => {
    for (const fake of ["perspective(", "rotateX(", "rotate3d", "transform-style", "preserve-3d"]) {
      expect(mapUi, fake).not.toContain(fake);
    }
  });

  it("no new tile vendor, no API key, no credential in client code", () => {
    expect(mapUi).toContain("tile.openstreetmap.org");
    expect(mapUi).not.toMatch(/api[_-]?key|accessToken|mapbox|maptiler|process\.env/i);
  });

  it("a browser without WebGL is told honestly, not shown a broken canvas", () => {
    expect(mapUi).toContain("webglFailed");
    expect(mapUi).toContain("nécessite WebGL");
  });

  it("the map cleans itself up on unmount", () => {
    expect(mapUi).toContain("map.remove()");
    expect(mapUi).toContain("markersRef.current.forEach");
  });

  it("only this surface changed — the portal and shipping maps keep Leaflet", () => {
    expect(read("components/portal/leaflet-map.tsx")).toContain("react-leaflet");
    expect(read("components/shipping/shipment-map.tsx")).toContain("react-leaflet");
  });
});

// ═══════════ 3A — Senegal, nationwide ══════════════════════════════════════

describe("TMS-2D — the workspace is Senegal, not Dakar", () => {
  it("the default view frames the whole country", () => {
    const [w, s, e, n] = SENEGAL_VIEW.bounds;
    expect(w).toBeLessThan(-17); // Atlantic coast
    expect(e).toBeGreaterThan(-12); // eastern border
    expect(s).toBeLessThan(12.5); // Casamance
    expect(n).toBeGreaterThan(16.5); // northern border
    // …and it is a country view, not a city zoom.
    expect(SENEGAL_VIEW.zoom).toBeLessThan(8);
  });

  it("the map frames those bounds on load and offers a way back", () => {
    expect(mapUi).toContain("fitBounds(SENEGAL_VIEW.bounds");
    expect(mapUi).toContain("Recentrer sur le Sénégal");
  });

  it("the default view is a CAMERA, never a business fact", () => {
    expect(model).toContain("A camera position, NOT a business fact");
    expect(model).toContain("a return point (TMS2-R1 is still open)");
    // Nothing outside the map layer may read it.
    expect(service).not.toContain("SENEGAL_VIEW");
    expect(service).not.toContain("FALLBACK_MAP_VIEW");
    expect(strip(read("lib/driver/actions.ts"))).not.toContain("SENEGAL_VIEW");
  });

  it("the context cities are context — never seeded missions or markers", () => {
    expect([...SENEGAL_CONTEXT_CITIES]).toContain("Ziguinchor");
    expect([...SENEGAL_CONTEXT_CITIES]).toContain("Tambacounda");
    // The map never positions anything from that list.
    expect(mapUi).not.toContain("SENEGAL_CONTEXT_CITIES");
    for (const city of SENEGAL_CONTEXT_CITIES) {
      expect(mapUi, `${city} must not be a coordinate in the map layer`).not.toContain(`"${city}"`);
    }
  });

  it("FALLBACK_MAP_VIEW and SENEGAL_VIEW are one source, not two", () => {
    expect(FALLBACK_MAP_VIEW).toBe(SENEGAL_VIEW);
  });
});

// ═══════════ 6–8, 11 — observed geometry only ══════════════════════════════

describe("TMS-2D — geometry comes only from what was observed", () => {
  it("one fix gives a marker and never a line; two or more may give a line", () => {
    expect(canDrawRoute([at(14.7, -17.45)])).toBe(false);
    expect(canDrawRoute([at(14.7, -17.45), at(14.75, -17.4)])).toBe(true);
    expect(mapUi).toContain("canDrawRoute(route ?? [])");
  });

  it("the view frames observed points when any exist", () => {
    const v = mapViewFor([mission()], []);
    expect(v.kind).toBe("observed");
    if (v.kind === "observed") expect(v.points).toEqual([{ lat: 14.7, lng: -17.45 }]);
  });

  it("several active missions produce several markers", () => {
    const many = [mission(), mission({ transportId: "t2", lastPosition: at(14.9, -16.9) }), mission({ transportId: "t3", lastPosition: at(12.6, -16.3) })];
    const v = mapViewFor(many, []);
    expect(v.kind === "observed" && v.points).toHaveLength(3);
    expect(summarizeLiveMissions(many).tracked).toBe(3);
    expect(mapUi).toContain("located.map((m) =>");
  });

  it("a mission with no fix contributes no marker", () => {
    const v = mapViewFor([mission({ lastPosition: null })], []);
    expect(v.kind).toBe("fallback");
  });

  it("the route is drawn from recorded fixes in order — nothing is inferred", () => {
    expect(mapUi).toContain('type: "LineString"');
    expect(mapUi).toContain("(route ?? []).map((p) => [p.lng, p.lat])");
    for (const fake of ["interpolat", "snapToRoad", "directions", "getRoute("]) {
      expect(mapUi.toLowerCase(), fake).not.toContain(fake.toLowerCase());
    }
    expect(mapRaw).toContain("No interpolation,");
  });
});

// ═══════════ 5, 6 — marker meaning ═════════════════════════════════════════

describe("TMS-2D — a marker says what is true about its mission", () => {
  it("the popup exposes the existing mission facts and the dossier link", () => {
    for (const label of ["Chauffeur", "Dossier", "Phase", "Signal", "Dernière position", "Enlèvement", "Destination", "Point de retour"]) {
      expect(mapUi, label).toContain(label);
    }
    expect(mapUi).toContain("Ouvrir la mission");
  });

  it("absent facts are omitted, never invented", () => {
    // `line()` renders nothing when the value is null.
    expect(mapUi).toContain("value ? `<div>");
  });

  it("status is conveyed by shape AND text, not colour alone", () => {
    expect(mapUi).toContain('el.setAttribute("role", "img")');
    expect(mapUi).toContain('aria-label');
    expect(mapUi).toContain("const square = m.leg === \"RETURN\";");
    const shapes = MAP_LEGEND_FR.map((l) => l.shape);
    expect(new Set(shapes).size, "legend shapes must be distinguishable").toBeGreaterThan(1);
    for (const l of MAP_LEGEND_FR) expect(l.labelFr.length).toBeGreaterThan(0);
  });

  it("the legend names the four ruled states", () => {
    const labels = MAP_LEGEND_FR.map((l) => l.labelFr);
    for (const s of ["En livraison", "En retour", "Signal ancien", "Signal perdu"]) {
      expect(labels, s).toContain(s);
    }
  });

  it("a degraded signal can never be labelled live", () => {
    // A probe that relabels `stale`/`offline` as "En direct" would lie to the
    // operator about a truck nobody has heard from. Distinct wording per state.
    const health = mapUi.slice(mapUi.indexOf("const HEALTH_FR"));
    const record = health.slice(0, health.indexOf("};"));
    expect(record).toMatch(/live:\s*"En direct"/);
    expect(record).toMatch(/stale:\s*"Signal ancien"/);
    expect(record).toMatch(/offline:\s*"Signal perdu"/);
    const labels = [...record.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(labels).size, "each signal state needs its own words").toBe(labels.length);
    for (const l of MAP_LEGEND_FR) {
      if (l.key === "stale" || l.key === "offline") expect(record, l.key).toContain(l.labelFr);
    }
  });

  it("popup content is escaped — mission text is data, not markup", () => {
    expect(mapUi).toContain("escapeHtml");
    expect(mapUi).toContain("encodeURIComponent(m.fileId)");
  });
});

// ═══════════ camera ownership ══════════════════════════════════════════════

describe("TMS-2D — the camera belongs to the operator", () => {
  it("a telemetry refresh never moves the view", () => {
    const markerEffect = mapUi.slice(mapUi.indexOf("markersRef.current = located.map"));
    const body = markerEffect.slice(0, markerEffect.indexOf("}, [located, ready]);"));
    // Both the direct calls and any indirect helper: a probe inserting
    // `frameMissionsInternal(map, located)` into this effect must fail here.
    expect(body).not.toMatch(/fitBounds|flyTo|easeTo|jumpTo|setCenter|setZoom|setPitch|setBearing/);
    expect(body).not.toMatch(/\b\w*(?:frame|recenter|camera|zoom|fly|fit)\w*\s*\(/i);
    expect(mapRaw).toContain("must never yank the view away");
  });

  it("framing happens only when the operator asks", () => {
    expect(mapUi).toContain("function flyToSenegal()");
    expect(mapUi).toContain("function frameMissions()");
    expect(mapUi).toContain("Cadrer les missions");
    expect(mapUi).toContain("disabled={located.length === 0}");
  });

  it("the map is created once and not rebuilt by data changes", () => {
    expect(mapUi).toContain("if (mapRef.current || !containerRef.current) return;");
    expect(mapUi).toContain("}, []);");
  });
});

// ═══════════ 10, 11 — refresh and load ═════════════════════════════════════

describe("TMS-2D — live without new infrastructure, and bounded", () => {
  it("refresh reuses the repository's polling idiom, not a new socket", () => {
    expect(refresh).toContain("router.refresh()");
    expect(refresh).toContain("setInterval");
    expect(refresh).toContain("clearInterval");
    expect(refresh).not.toMatch(/WebSocket|realtime|subscribe\(/i);
    expect(page).toContain("<LiveRefresh />");
  });

  it("a hidden tab is not polled, and the operator can pause", () => {
    expect(refresh).toContain('document.visibilityState === "hidden"');
    expect(refresh).toContain("Suspendre");
    expect(refresh).toContain("Actualiser maintenant");
  });

  it("the latest position per mission is fetched by exact instant, not by scanning history", () => {
    expect(service).toContain("lastInstants");
    expect(service).toContain('.in("recorded_at", lastInstants)');
    // The old global newest-N scan is gone. Scoped to listLiveMissions and
    // written whitespace-tolerantly on purpose: a literal newline inside an
    // expected string never matches on a CRLF checkout, and a ban that
    // cannot match proves nothing. getObservedRoute keeps its own
    // order+limit legitimately, so the ban must not reach it.
    const listFn = service.slice(
      service.indexOf("export async function listLiveMissions"),
      service.indexOf("export async function countSessionsEndedToday"),
    );
    expect(listFn).toContain('.in("recorded_at", lastInstants)');
    expect(listFn).not.toMatch(/order\(\s*"recorded_at"/);
    expect(listFn).not.toMatch(/\.limit\(/);
  });

  it("route history is explicitly capped", () => {
    expect(service).toContain("MAX_ROUTE_POINTS");
    expect(service).toContain(".limit(limit)");
  });

  it("the map ships only to this page — dynamic, client-only", () => {
    expect(page).toContain('ssr: false');
    expect(page).toContain('import("@/components/transport/live-map")');
  });
});

// ═══════════ 12–14, 17, 18 — the TMS-2 guarantees still hold ══════════════

describe("TMS-2D — every TMS-2 guarantee survives", () => {
  it("the map remains gated on transport:read, which DRIVER does not hold", () => {
    expect(service).toContain('assertPermission("transport:read")');
    expect(service).not.toContain('assertPermission("tracking:read")');
    expect(page).toContain('hasPermission(permissions, "transport:read")');
  });

  it("every read model query stays tenant-scoped", () => {
    const chains = service.split(".from(").slice(1);
    expect(chains.length).toBeGreaterThan(0);
    for (const c of chains) {
      expect(c.slice(0, 400), `untenanted: ${c.slice(0, 40)}`).toContain('.eq("tenant_id", user.tenantId)');
    }
  });

  it("the map layer performs no writes and no workflow act", () => {
    for (const forbidden of [".update(", ".insert(", ".delete(", "submitStep", "transitionFile", "POD", "closure"]) {
      expect(mapUi, forbidden).not.toContain(forbidden);
    }
  });

  it("no provider field is required anywhere in the live map", () => {
    for (const forbidden of ["tracking_url", "trackingUrl", "provider", "externalReference"]) {
      expect(mapUi, forbidden).not.toContain(forbidden);
    }
  });

  it("the external provider link stays demoted and optional", () => {
    const external = read("components/transport/mission-tracking.tsx");
    expect(external).toContain("Suivi externe (optionnel)");
    expect(external).toContain("<details");
    expect(page).not.toContain("MissionTracking");
  });

  it("the governance note still tells the operator GPS decides nothing", () => {
    expect(page).toContain("Il ne déclenche jamais un enlèvement, une");
    expect(page).toContain("clôture de dossier");
  });

  it("no migration was added for TMS-2D", () => {
    const migrations = readFileSync;
    void migrations;
    const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
    const files = require("node:fs").readdirSync(dir).filter((f: string) => f.endsWith(".sql")).sort();
    // TMS-2D added none of its own; the newest on disk now belongs to a later
    // slice (H-9's OPS_SUPERVISOR grant), which is what this must track.
    expect(files.at(-1)).toBe("20260929000001_ops_supervisor_file_update.sql");
    expect(files).toContain("20260928000001_mission_return_leg.sql");
  });

  it("the map layer is read-only — a GPS fix can trigger no write", () => {
    expect(mapUi).not.toMatch(/\bfetch\s*\(/);
    expect(mapUi).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/i);
    expect(mapUi).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
    expect(mapUi).not.toMatch(/submitStep|startMission|completeMission|advanceStep|markDelivered/);
    expect(mapUi).not.toMatch(/from\s+["']@\/(lib|app)\/actions/);
    expect(mapUi).not.toMatch(/["']use server["']/);
  });

  it("00009 is named nowhere in the slice", () => {
    for (const f of [mapRaw, model, page, refresh]) {
      expect(f).not.toMatch(/EFT-IMP-2026-00009|00009/);
    }
  });
});
