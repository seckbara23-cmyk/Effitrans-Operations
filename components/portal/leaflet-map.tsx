"use client";

/**
 * Interactive Leaflet + OpenStreetMap shipment map (Phase 3.3A D9). Client-only
 * (lazy-loaded via next/dynamic ssr:false) so no map code ships on pages without
 * a map. Renders ONLY grounded registry coordinates — never invented positions.
 * Custom divIcons avoid Leaflet's default marker-image bundler gotcha.
 */
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Polyline, Tooltip } from "react-leaflet";
import { t } from "@/lib/i18n";
import type { MapPoint, MapPointState } from "@/lib/portal/map-points";

const COLOR: Record<MapPointState, string> = { completed: "#0d9488", current: "#0b1a2b", pending: "#94a3b8" };

function markerIcon(state: MapPointState): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;height:20px;width:20px;border-radius:9999px;background:${COLOR[state]};box-shadow:0 0 0 3px #fff,0 1px 3px rgba(0,0,0,.3)"></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

export function LeafletMap({ points }: { points: MapPoint[] }) {
  const m = t.portal.premium.map;
  const geo = points.filter((p): p is MapPoint & { coord: NonNullable<MapPoint["coord"]> } => p.coord != null);
  const positions = geo.map((p) => [p.coord.lat, p.coord.lng] as [number, number]);
  const bounds = L.latLngBounds(positions);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <div className="border-b border-slate-100 px-5 py-2.5 text-[11px] uppercase tracking-wide text-slate-500">{m.title}</div>
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [32, 32] }}
        scrollWheelZoom={false}
        style={{ height: "300px", width: "100%" }}
        attributionControl
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        {positions.length >= 2 && <Polyline positions={positions} pathOptions={{ color: "#0d9488", weight: 3, dashArray: "6 8" }} />}
        {geo.map((p, i) => (
          <Marker key={i} position={[p.coord.lat, p.coord.lng]} icon={markerIcon(p.state)}>
            <Tooltip direction="top" offset={[0, -8]}>{p.label}</Tooltip>
          </Marker>
        ))}
      </MapContainer>
      <p className="border-t border-slate-100 px-5 py-2 text-center text-[11px] text-slate-400">{m.geoNote}</p>
    </div>
  );
}
