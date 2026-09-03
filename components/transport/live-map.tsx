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
 */
import "maplibre-gl/dist/maplibre-gl.css";
import maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import type { LiveMission, LiveMissionPoint } from "@/lib/tracking/live-model";
import { canDrawRoute, SENEGAL_VIEW, MAP_LEGEND_FR } from "@/lib/tracking/live-model";
import { MISSION_LEG_LABEL_FR } from "@/lib/tracking/types";

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

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/** Marker element: colour AND shape AND an accessible label — never colour alone. */
function markerElement(m: LiveMission): HTMLElement {
  const el = document.createElement("div");
  const ring = HEALTH_RING[m.health] ?? "#fff";
  const fill = LEG_COLOR[m.leg] ?? "#94a3b8";
  const square = m.leg === "RETURN";
  el.setAttribute("role", "img");
  el.setAttribute(
    "aria-label",
    `${m.vehicleLabel ?? "Véhicule non renseigné"} — ${MISSION_LEG_LABEL_FR[m.leg]} — ${HEALTH_FR[m.health] ?? m.health}`,
  );
  el.style.cssText = `height:20px;width:20px;border-radius:${square ? "4px" : "9999px"};background:${fill};box-shadow:0 0 0 3px ${ring},0 1px 3px rgba(0,0,0,.35);cursor:pointer`;
  return el;
}

function popupHtml(m: LiveMission): string {
  const line = (label: string, value: string | null) =>
    value ? `<div><span style="color:#64748b">${label} :</span> ${escapeHtml(value)}</div>` : "";
  const when = m.lastPosition
    ? new Date(m.lastPosition.at).toLocaleString("fr-FR")
    : null;
  return `
    <div style="font-size:12px;line-height:1.5;min-width:210px">
      <div style="font-weight:600;color:#0b1a2b">${escapeHtml(m.vehicleLabel ?? "Véhicule non renseigné")}</div>
      ${line("Chauffeur", m.driverName)}
      ${line("Dossier", m.fileNumber)}
      ${line("Phase", MISSION_LEG_LABEL_FR[m.leg])}
      ${line("Signal", HEALTH_FR[m.health] ?? m.health)}
      ${line("Dernière position", when)}
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
}: {
  missions: LiveMission[];
  /** Observed positions for one focused mission, oldest first. */
  route?: LiveMissionPoint[];
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [webglFailed, setWebglFailed] = useState(false);

  const located = missions.filter(
    (m): m is LiveMission & { lastPosition: LiveMissionPoint } => m.lastPosition != null,
  );

  // ---- create once; never recreated by a telemetry refresh -----------------
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: OSM_RASTER_STYLE,
        center: [SENEGAL_VIEW.lng, SENEGAL_VIEW.lat],
        zoom: SENEGAL_VIEW.zoom,
        pitch: SENEGAL_VIEW.pitch,     // genuine WebGL pitch
        bearing: SENEGAL_VIEW.bearing, // genuine WebGL bearing
        attributionControl: { compact: true },
        maxPitch: 75,
      });
    } catch {
      // A machine without WebGL gets an honest message, not a broken canvas.
      setWebglFailed(true);
      return;
    }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
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
      markersRef.current.forEach((mk) => mk.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- markers follow telemetry; the camera does NOT ----------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markersRef.current.forEach((mk) => mk.remove());
    markersRef.current = located.map((m) =>
      new maplibregl.Marker({ element: markerElement(m) })
        .setLngLat([m.lastPosition.lng, m.lastPosition.lat])
        .setPopup(new maplibregl.Popup({ offset: 14, closeButton: true }).setHTML(popupHtml(m)))
        .addTo(map),
    );
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
  }, [route, ready]);

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
        <span className="flex gap-2">
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

      <p className="border-t border-slate-100 px-5 py-2 text-center text-[11px] text-slate-400">
        Positions réellement enregistrées par l&apos;application chauffeur. Aucun trajet n&apos;est
        reconstitué ni interpolé.
      </p>
    </div>
  );
}
