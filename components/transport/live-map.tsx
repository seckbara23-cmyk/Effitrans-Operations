"use client";

/**
 * TMS-2D — the Transport live map. A PERMANENT, 3D-capable command centre.
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT LEAFLET. The rest of the application maps with Leaflet, and
 * this surface did too. Leaflet cannot satisfy the ruling: its 1.9.4 source
 * contains ZERO occurrences of `pitch`, `bearing` or `WebGL` — it is a 2D
 * DOM/Canvas raster renderer with no camera. Tilting it would mean a CSS
 * transform, which is exactly the fake 3D the ruling forbids. So this ONE
 * surface uses MapLibre GL JS (BSD-3-Clause, free, no API key, no account);
 * the portal and shipping maps keep Leaflet and are untouched.
 *
 * WHAT THE 3D ACTUALLY IS, stated plainly. The camera is genuinely
 * three-dimensional: WebGL perspective, real `pitch` and `bearing`, and drag-
 * rotate — not a CSS illusion. The BASEMAP is the same OpenStreetMap raster
 * the repository already uses, draped on that tilted plane, so no new tile
 * vendor, key or licence enters the product. What that does NOT give is
 * terrain relief or extruded buildings: those need vector tiles plus a DEM
 * source, i.e. a new third-party provider. That upgrade is available and
 * reported — it is not claimed here.
 *
 * THE MAP IS ALWAYS RENDERED. It previously vanished whenever there were zero
 * recorded positions, which made Transport's control centre look broken on a
 * quiet morning. It now opens on Senegal — the whole country, because missions
 * run nationwide — and says that nothing is being tracked, over an otherwise
 * fully working map.
 *
 * ONLY OBSERVED GEOMETRY IS DRAWN, and a permanent map makes that matter more,
 * not less: a marker exists only where a position was actually recorded, a
 * line only through two or more recorded fixes in time order. No interpolation,
 * no road snapping, no invented vehicle, and no placeholder marker to make an
 * empty map look busy.
 *
 * THE CAMERA IS THE OPERATOR'S. Nothing ever yanks the view back to a mission
 * while someone is exploring: framing happens only when they ask for it.
 *
 * A SECOND BASEMAP — SATELLITE — AND WHAT IT DOES NOT CHANGE. The plan above
 * stays the default and the fallback. When the server hands this component a
 * satellite configuration (a prop — this file reads no environment and names
 * no vendor), a « Plan / Satellite » switch appears. Switching replaces the
 * raster style only: the camera keeps its pitch, bearing and position, the
 * markers are DOM overlays and stay put, and the observed-route layer is redrawn
 * on the new style from the same recorded fixes. If the imagery refuses to load
 * (credential, quota, outage) the map reverts to the plan by itself and says so.
 * Telemetry, GPS markers, headings, popups and the no-interpolation rule are
 * untouched: a basemap is scenery, never evidence.
 */
import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { LiveMission, LiveMissionPoint } from "@/lib/tracking/live-model";
import { canDrawRoute, SENEGAL_VIEW, MAP_LEGEND_FR } from "@/lib/tracking/live-model";
import {
  MARKER_EASE_MS,
  frameAt,
  rotationFor,
  shouldEase,
} from "@/lib/tracking/marker-motion";
import { MISSION_LEG_LABEL_FR } from "@/lib/tracking/types";
import {
  BASEMAP_LABEL_FR,
  buildSatelliteStyle,
  initialBasemap,
  isSatelliteSourceError,
  type BasemapKey,
  type SatelliteTiles,
} from "@/lib/tracking/basemaps";

const LEG_COLOR: Record<string, string> = {
  OUTBOUND: "#0d9488",
  RETURN: "#0b1a2b",
  ENDED: "#94a3b8",
  NOT_STARTED: "#94a3b8",
};
const HEALTH_RING: Record<string, string> = {
  live: "#ffffff",
  stale: "#f59e0b",
  offline: "#dc2626",
  paused: "#94a3b8",
  completed: "#94a3b8",
  not_started: "#94a3b8",
};
const HEALTH_FR: Record<string, string> = {
  live: "En direct",
  stale: "Signal ancien",
  offline: "Signal perdu",
  paused: "Suivi en pause",
  completed: "Terminé",
  not_started: "Suivi non démarré",
};

/** The same OpenStreetMap raster the app already uses — no new vendor, no key. */
const OSM_RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: [
        "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
        "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

/**
 * One live marker's presentation state, held across refreshes.
 *
 * `drawn` is where the marker is currently RENDERED — mid-transition it is a
 * screen coordinate and nothing more. `fixAt` is the `recorded_at` of the fix it
 * is heading to, which is how a genuinely new fix is told from a re-render of
 * the same one. `heading` is the last course the DEVICE reported, never a
 * derived one.
 */
type MarkerEntry = {
  marker: maplibregl.Marker;
  el: HTMLElement;
  drawn: { lat: number; lng: number };
  fixAt: string | null;
  heading: number | null;
  raf: number | null;
};

/** Operators who asked their system for less motion get placement, not glides. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/**
 * A vehicle seen from above, nose UP so a rotation of 0° reads as due north.
 * Local inline SVG: this project carries no icon library, and the only mapping
 * dependency stays MapLibre. `currentColor` lets one glyph serve every leg.
 */
const CAR_GLYPH = `<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"
  style="display:block;color:#fff"><path fill="currentColor" d="M12 1.6 9.9 4.3c-.5.6-.8 1.4-.8 2.2v1.1l-3.6 1.6c-.5.2-.8.7-.8 1.2v1.5c0 .3.3.6.7.5l3.7-.8v3.9l-1.8 1.2c-.3.2-.5.5-.5.9v1.4c0 .4.4.7.8.6l3-.9h1.6l3 .9c.4.1.8-.2.8-.6v-1.4c0-.4-.2-.7-.5-.9l-1.8-1.2v-3.9l3.7.8c.4.1.7-.2.7-.5v-1.5c0-.5-.3-1-.8-1.2l-3.6-1.6V6.5c0-.8-.3-1.6-.8-2.2L12 1.6Z"/></svg>`;

/**
 * Marker element: colour AND shape AND an accessible label — never colour alone.
 *
 * TRACKING-06B — the live mission is a VEHICLE, not a dot. `paintMarker` keeps
 * the element itself reusable across refreshes so a marker is never destroyed
 * and rebuilt mid-transition (which is what made every new fix look like a
 * teleport). Shape still distinguishes the return leg, and the label still
 * states leg and signal in words.
 */
function markerElement(m: LiveMission, rotation: { degrees: number | null; fromCurrentFix: boolean }): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("role", "img");
  el.innerHTML = CAR_GLYPH;
  paintMarker(el, m, rotation);
  return el;
}

/** Restyle an EXISTING marker element in place for the mission's current state. */
function paintMarker(
  el: HTMLElement,
  m: LiveMission,
  rotation: { degrees: number | null; fromCurrentFix: boolean },
): void {
  const ring = HEALTH_RING[m.health] ?? "#fff";
  const fill = LEG_COLOR[m.leg] ?? "#94a3b8";
  const square = m.leg === "RETURN";
  // A restrained live treatment: a green halo only while the signal is genuinely
  // live. `stale` and `offline` keep their amber and red rings and get no glow,
  // so a vehicle nobody has heard from can never look healthy.
  const glow = m.health === "live" ? ",0 0 0 7px rgba(16,185,129,.28)" : "";
  const heading =
    rotation.degrees === null
      ? "cap inconnu"
      : `cap ${Math.round(rotation.degrees)}°${rotation.fromCurrentFix ? "" : " (dernier cap connu)"}`;
  el.setAttribute(
    "aria-label",
    `${m.vehicleLabel ?? "Véhicule non renseigné"} — ${MISSION_LEG_LABEL_FR[m.leg]} — ${HEALTH_FR[m.health] ?? m.health} — ${heading}`,
  );
  el.style.cssText = `display:flex;align-items:center;justify-content:center;height:26px;width:26px;border-radius:${square ? "6px" : "9999px"};background:${fill};box-shadow:0 0 0 3px ${ring}${glow},0 1px 3px rgba(0,0,0,.35);cursor:pointer`;
}

function popupHtml(m: LiveMission): string {
  const line = (label: string, value: string | null) =>
    value ? `<div><span style="color:#64748b">${label} :</span> ${escapeHtml(value)}</div>` : "";
  const when = m.lastPosition
    ? new Date(m.lastPosition.at).toLocaleString("fr-FR")
    : null;
  // TRACKING-06B — two more facts from the SAME recorded fix (TRACKING-06A read
  // them). `line()` omits a null, so an absent reading stays absent: it is never
  // rendered as 0 km/h or as perfect accuracy, and neither is derived.
  const speed =
    m.lastPosition?.speedKph != null ? `${m.lastPosition.speedKph.toFixed(1)} km/h` : null;
  const accuracy =
    m.lastPosition?.accuracyMeters != null ? `± ${Math.round(m.lastPosition.accuracyMeters)} m` : null;
  return `
    <div style="font-size:12px;line-height:1.5;min-width:210px">
      <div style="font-weight:600;color:#0b1a2b">${escapeHtml(m.vehicleLabel ?? "Véhicule non renseigné")}</div>
      ${line("Chauffeur", m.driverName)}
      ${line("Dossier", m.fileNumber)}
      ${line("Phase", MISSION_LEG_LABEL_FR[m.leg])}
      ${line("Signal", HEALTH_FR[m.health] ?? m.health)}
      ${line("Dernière position", when)}
      ${line("Vitesse relevée", speed)}
      ${line("Précision", accuracy)}
      ${line("Enlèvement", m.pickupLocation)}
      ${line("Destination", m.deliveryLocation)}
      ${line("Point de retour", m.returnLocation)}
      <a href="/files/${encodeURIComponent(m.fileId)}#transport"
         style="display:inline-block;margin-top:6px;color:#0f766e;text-decoration:underline">Ouvrir la mission →</a>
    </div>`;
}

export function TransportLiveMap({
  missions,
  route,
  satellite = null,
}: {
  missions: LiveMission[];
  /** Observed positions for one focused mission, oldest first. */
  route?: LiveMissionPoint[];
  /**
   * Satellite imagery, resolved and validated on the SERVER. null = not
   * configured: no switch is drawn and the map is the plan it has always been.
   */
  satellite?: SatelliteTiles | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, MarkerEntry>>(new Map());
  const [ready, setReady] = useState(false);
  const [webglFailed, setWebglFailed] = useState(false);

  // ---- basemap choice -------------------------------------------------------
  // Opens on the plan unless imagery is configured AND asked for as default.
  // Held in a ref as well so map event handlers (registered once) read the
  // current choice rather than a stale closure.
  const satelliteRef = useRef<SatelliteTiles | null>(satellite);
  satelliteRef.current = satellite;
  const [basemap, setBasemap] = useState<BasemapKey>(() => initialBasemap(satellite));
  const basemapRef = useRef<BasemapKey>(basemap);
  // Bumped every time a style finishes loading, so style layers (the observed
  // route) are re-added after a swap; DOM markers need nothing.
  const [styleEpoch, setStyleEpoch] = useState(0);
  const [styleBusy, setStyleBusy] = useState(false);
  const [imageryUnavailable, setImageryUnavailable] = useState(false);

  const located = missions.filter(
    (m): m is LiveMission & { lastPosition: LiveMissionPoint } => m.lastPosition != null,
  );

  // ---- create once; never recreated by a telemetry refresh -----------------
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    let map: maplibregl.Map;
    try {
      const cfg = satelliteRef.current;
      map = new maplibregl.Map({
        container: containerRef.current,
        style: basemapRef.current === "satellite" && cfg ? buildSatelliteStyle(cfg) : OSM_RASTER_STYLE,
        center: [SENEGAL_VIEW.lng, SENEGAL_VIEW.lat],
        zoom: SENEGAL_VIEW.zoom,
        pitch: SENEGAL_VIEW.pitch,     // genuine WebGL pitch
        bearing: SENEGAL_VIEW.bearing, // genuine WebGL bearing
        // Responsive attribution: the full credit on maps at least 640 px wide,
        // an accessible toggle below that. Imagery licences require the credit
        // to be readable, not merely present behind a closed button.
        attributionControl: {},
        maxPitch: 75,
      });
    } catch {
      // A machine without WebGL gets an honest message, not a broken canvas.
      setWebglFailed(true);
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    // Fires for the first style and after every swap.
    map.on("style.load", () => {
      setStyleBusy(false);
      setStyleEpoch((n) => n + 1);
    });
    // Imagery that cannot be fetched (refused credential, quota, outage) must
    // never leave the operator staring at a blank canvas: fall back to the plan
    // and say so. Plan-tile hiccups are not the imagery's and are left alone.
    map.on("error", (evt) => {
      const imagery =
        basemapRef.current === "satellite" &&
        isSatelliteSourceError(evt as unknown as { sourceId?: unknown; error?: unknown });
      if (!imagery) {
        // A registered listener silences the library's own console report, so
        // every other error is reported here exactly as it was before.
        console.error(evt.error);
        return;
      }
      basemapRef.current = "plan";
      setBasemap("plan");
      setImageryUnavailable(true);
      setStyleBusy(true);
      map.setStyle(OSM_RASTER_STYLE, { diff: false });
    });
    map.on("load", () => {
      // Frame the country on first paint; from here the camera is the user's.
      map.fitBounds(SENEGAL_VIEW.bounds as unknown as [number, number, number, number], {
        padding: 40,
        pitch: SENEGAL_VIEW.pitch,
        bearing: SENEGAL_VIEW.bearing,
        duration: 0,
      });
      setReady(true);
    });
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((e) => {
        if (e.raf !== null) cancelAnimationFrame(e.raf);
        e.marker.remove();
      });
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- markers follow telemetry; the camera does NOT ----------------------
  //
  // TRACKING-06B. This used to remove every marker and build new ones on each
  // refresh, so a new fix arrived as a teleport — and any open popup closed with
  // it. Markers are now KEYED BY MISSION and survive refreshes: an existing one
  // is restyled in place and GLIDES to the newly recorded fix.
  //
  // The glide is presentation. Its two endpoints are the fix the marker is drawn
  // at and the fix just recorded; no frame is persisted, transmitted, or offered
  // as history, and the transition always finishes exactly on the recorded point.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const reg = markersRef.current;
    const seen = new Set<string>();

    for (const m of located) {
      seen.add(m.transportId);
      const p = m.lastPosition;
      const entry = reg.get(m.transportId);
      const rotation = rotationFor(p.headingDegrees, entry?.heading ?? null);

      if (!entry) {
        // First appearance: PLACE it, never fly it in from nowhere.
        const el = markerElement(m, rotation);
        const marker = new maplibregl.Marker({ element: el, rotationAlignment: "map" })
          .setLngLat([p.lng, p.lat])
          .setPopup(new maplibregl.Popup({ offset: 16, closeButton: true }).setHTML(popupHtml(m)))
          .addTo(map);
        if (rotation.degrees !== null) marker.setRotation(rotation.degrees);
        reg.set(m.transportId, {
          marker,
          el,
          drawn: { lat: p.lat, lng: p.lng },
          fixAt: p.at,
          heading: rotation.fromCurrentFix ? rotation.degrees : (rotation.degrees ?? null),
          raf: null,
        });
        continue;
      }

      paintMarker(entry.el, m, rotation);
      entry.marker.getPopup()?.setHTML(popupHtml(m));
      // A recorded course rotates the vehicle. Its ABSENCE changes nothing: the
      // last course the device actually reported is held, and a mission that has
      // never reported one is drawn with no orientation claim at all.
      if (rotation.fromCurrentFix && rotation.degrees !== null) {
        entry.heading = rotation.degrees;
        entry.marker.setRotation(rotation.degrees);
      }

      if (p.at === entry.fixAt) continue; // same recorded fix: nothing moved
      entry.fixAt = p.at;
      const to = { lat: p.lat, lng: p.lng };

      if (entry.raf !== null) cancelAnimationFrame(entry.raf);
      entry.raf = null;

      if (!shouldEase(entry.drawn, to, { reducedMotion: prefersReducedMotion() })) {
        // A gap too large to have been watched, or motion the operator has asked
        // to be spared: place the marker on the fact and do not animate a
        // journey nobody observed.
        entry.drawn = to;
        entry.marker.setLngLat([to.lng, to.lat]);
        continue;
      }

      const from = { ...entry.drawn };
      const t0 = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / MARKER_EASE_MS);
        const at = frameAt(from, to, t);
        entry.drawn = at;
        entry.marker.setLngLat([at.lng, at.lat]);
        if (t < 1) {
          entry.raf = requestAnimationFrame(step);
          return;
        }
        // Land on the recorded point itself, then stop. Nothing continues.
        entry.raf = null;
        entry.drawn = to;
        entry.marker.setLngLat([to.lng, to.lat]);
      };
      entry.raf = requestAnimationFrame(step);
    }

    // Missions that left the open set take their markers with them.
    for (const [id, entry] of reg) {
      if (seen.has(id)) continue;
      if (entry.raf !== null) cancelAnimationFrame(entry.raf);
      entry.marker.remove();
      reg.delete(id);
    }
    // Deliberately no fitBounds here: a refresh must never yank the view away
    // from an operator who is exploring the map.
  }, [located, ready]);

  // ---- the observed route: 2+ recorded fixes, or nothing ------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const id = "observed-route";
    const draw = canDrawRoute(route ?? []);
    const data = {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: draw ? (route ?? []).map((p) => [p.lng, p.lat]) : [],
      },
    };
    const existing = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data);
      return;
    }
    if (!draw) return;
    map.addSource(id, { type: "geojson", data });
    map.addLayer({
      id,
      type: "line",
      source: id,
      paint: { "line-color": "#0d9488", "line-width": 3 },
    });
    // `styleEpoch`: a basemap swap drops every style layer, so the route is
    // re-added — from the same recorded fixes — once the new style has loaded.
  }, [route, ready, styleEpoch]);

  // ---- basemap: Plan ⇄ Satellite -------------------------------------------
  // `setStyle` replaces sources and layers but keeps the camera (pitch,
  // bearing, position) and the DOM markers. Nothing here reads telemetry, and
  // the 30 s refresh never touches this choice: the component instance — and
  // this state — survive a server re-render.
  function switchBasemap(next: BasemapKey) {
    const map = mapRef.current;
    const cfg = satelliteRef.current;
    if (!map || next === basemapRef.current) return;
    if (next === "satellite" && !cfg) return;
    basemapRef.current = next;
    setBasemap(next);
    setImageryUnavailable(false);
    setStyleBusy(true);
    map.setStyle(next === "satellite" && cfg ? buildSatelliteStyle(cfg) : OSM_RASTER_STYLE, { diff: false });
  }

  function flyToSenegal() {
    mapRef.current?.fitBounds(SENEGAL_VIEW.bounds as unknown as [number, number, number, number], {
      padding: 40,
      pitch: SENEGAL_VIEW.pitch,
      bearing: SENEGAL_VIEW.bearing,
    });
  }

  function frameMissions() {
    const map = mapRef.current;
    if (!map || located.length === 0) return;
    const b = new maplibregl.LngLatBounds();
    for (const m of located) b.extend([m.lastPosition.lng, m.lastPosition.lat]);
    map.fitBounds(b, { padding: 80, maxZoom: 13 });
  }

  if (webglFailed) {
    return (
      <div className="surface p-6 text-sm text-slate-600">
        La carte 3D nécessite WebGL, que ce navigateur ne fournit pas. Les missions suivies restent
        listées ci-dessous.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
        <span className="text-xs text-slate-500">
          Carte opérationnelle — Sénégal. Inclinaison et rotation disponibles (clic droit ou Ctrl + glisser).
        </span>
        <span className="flex flex-wrap items-center gap-2">
          {/* Drawn only when imagery is configured — an unconfigured map is unchanged. */}
          {satellite && (
            <span
              role="group"
              aria-label="Fond de carte"
              className="inline-flex overflow-hidden rounded border border-slate-200 text-[11px]"
            >
              {(["plan", "satellite"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={basemap === k}
                  disabled={styleBusy}
                  onClick={() => switchBasemap(k)}
                  className={`px-2 py-1 ${
                    basemap === k ? "bg-navy-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                  } disabled:opacity-60`}
                >
                  {BASEMAP_LABEL_FR[k]}
                </button>
              ))}
            </span>
          )}
          <button
            type="button"
            onClick={flyToSenegal}
            className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:border-teal-300"
          >
            Recentrer sur le Sénégal
          </button>
          <button
            type="button"
            onClick={frameMissions}
            disabled={located.length === 0}
            className="rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:border-teal-300 disabled:opacity-40"
          >
            Cadrer les missions
          </button>
        </span>
      </div>

      {imageryUnavailable && (
        <p
          role="status"
          className="border-b border-amber-100 bg-amber-50 px-4 py-1.5 text-[11px] text-amber-800"
        >
          Imagerie satellite indisponible (accès refusé, quota ou service) — retour automatique au plan.
        </p>
      )}

      <div className="relative">
        <div ref={containerRef} className="h-[380px] w-full sm:h-[520px]" />

        {/* EMPTY STATE — over the map, never instead of it. No fake marker. */}
        {missions.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center p-4">
            <div className="pointer-events-auto rounded-xl border border-slate-200 bg-white/95 px-4 py-3 text-center shadow-card">
              <p className="text-sm font-medium text-navy-900">Aucune mission suivie actuellement.</p>
              <p className="mt-1 text-xs text-slate-500">{SENEGAL_VIEW.labelFr}</p>
            </div>
          </div>
        )}
      </div>

      {/* Legend — text and shape, so it never depends on colour alone. */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 px-5 py-2 text-[11px] text-slate-500">
        {MAP_LEGEND_FR.map((l) => (
          <li key={l.key} className="flex items-center gap-1.5">
            <span aria-hidden="true">•</span>
            <span className="text-slate-600">{l.labelFr}</span>
            <span className="text-slate-400">({l.shape})</span>
          </li>
        ))}
      </ul>

      {/* TRACKING-06B — the marker now GLIDES between two received positions, so
          the notice says in as many words which part is evidence and which part
          is presentation. The recorded positions remain the authority; the
          movement drawn between them is an animation and is never persisted,
          reconstructed, or counted as an observed GPS position. */}
      <p className="border-t border-slate-100 px-5 py-2 text-center text-[11px] text-slate-400">
        Les positions affichées sont réellement enregistrées par l&apos;application chauffeur. Le
        déplacement visuel du véhicule entre deux positions reçues est une animation
        d&apos;affichage ; aucun trajet intermédiaire n&apos;est enregistré, reconstitué ou considéré
        comme une position GPS observée.
      </p>
    </div>
  );
}
