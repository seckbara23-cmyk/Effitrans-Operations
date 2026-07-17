"use client";

/**
 * Interactive Leaflet map for an ocean/air shipment (Phase 7.2B; 8.4 sync + honest labels).
 * Client-only (lazy-loaded via the loader's next/dynamic ssr:false). It is ONLY a renderer:
 * it consumes the 7.2A provider-neutral ShipmentMapProjection and contains NO domain logic
 * (no position resolution, no milestone rules). Marker styling makes confirmed / inferred /
 * manual / stale / planned visually distinct — shape + fill, not color alone. Popups show
 * SAFE operational fields only — never IDs, PII, credentials, or raw payloads.
 *
 * 8.4:
 *  - source/confidence render through the ONE French label map (sourceLabelFr) — raw enums
 *    never reach a customer;
 *  - every dated marker shows its AGE (« il y a 2 h ») next to the source — age language,
 *    never liveness language;
 *  - optional selection contract for map↔journal sync: markers expose a stable key
 *    (`label|occurredAt`), clicking calls onSelectMarker, and a selectedKey prop pans to +
 *    enlarges the matching marker. Both props optional — existing callers (portal,
 *    executive) are unchanged.
 */
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap } from "react-leaflet";
import type { ShipmentMapProjection, MapPoint, MapMarker } from "@/lib/shipping/intelligence/map-projection";
import { freshnessLabel, ageLabelFr } from "@/lib/shipping/intelligence/freshness";
import { sourceLabelFr, confidenceLabelFr } from "@/lib/shipping/intelligence/events";

// Default to OSM (approved). An operator may override the tile template via a build-time
// public env var for an approved provider — never a key, never a tracking-provider secret.
const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

const CONF_COLOR: Record<string, string> = { CONFIRMED: "#0d9488", INFERRED: "#d97706", MANUAL: "#0284c7", ESTIMATED: "#64748b" };
const KIND_COLOR: Record<string, string> = { origin: "#0b1a2b", destination: "#0d9488", port: "#64748b", milestone: "#94a3b8", current: "#0b1a2b" };

function dot(color: string, opts: { stale?: boolean; big?: boolean; selected?: boolean } = {}): L.DivIcon {
  const size = opts.selected ? 26 : opts.big ? 22 : 16;
  // Stale / non-confirmed positions render HOLLOW so they never look like a live GPS fix.
  const fill = opts.stale ? "#fff" : color;
  const border = opts.selected ? `3px solid #f59e0b` : opts.stale ? `2px dashed ${color}` : `2px solid #fff`;
  return L.divIcon({
    className: "",
    html: `<span style="display:block;height:${size}px;width:${size}px;border-radius:9999px;background:${fill};border:${border};box-shadow:0 1px 3px rgba(0,0,0,.3)"></span>`,
    iconSize: [size, size], iconAnchor: [size / 2, size / 2],
  });
}

function toLatLng(p: MapPoint): [number, number] { return [p.latitude, p.longitude]; }

/** Stable sync key shared with the journal — derivable on both sides, no contract change. */
export function markerKey(m: Pick<MapMarker, "label" | "occurredAt">): string {
  return `${m.label}|${m.occurredAt ?? ""}`;
}

/** Pans to the selected marker when the selection changes (map↔journal sync). */
function PanToSelected({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.panTo(target, { animate: true });
  }, [map, target]);
  return null;
}

export default function ShipmentMap({
  projection,
  selectedKey = null,
  onSelectMarker,
}: {
  projection: ShipmentMapProjection;
  /** 8.4 sync (optional): the journal-selected marker key to focus. */
  selectedKey?: string | null;
  /** 8.4 sync (optional): marker click → journal highlight. */
  onSelectMarker?: (key: string) => void;
}) {
  const all: [number, number][] = [];
  const collect = (p?: MapPoint | null) => { if (p) all.push(toLatLng(p)); };
  collect(projection.origin); collect(projection.destination);
  projection.plannedRoute.forEach(collect);
  projection.actualTrack.forEach(collect);
  projection.milestones.forEach((m) => all.push([m.latitude, m.longitude]));
  if (projection.currentPosition) all.push([projection.currentPosition.latitude, projection.currentPosition.longitude]);

  if (all.length === 0) {
    return <div className="surface p-4 text-sm text-slate-500">Carte indisponible : aucune coordonnée cartographiable.</div>;
  }
  const bounds = L.latLngBounds(all);

  const plannedLine: [number, number][] = projection.plannedRoute.length >= 2
    ? projection.plannedRoute.map(toLatLng)
    : projection.origin && projection.destination ? [toLatLng(projection.origin), toLatLng(projection.destination)] : [];
  const actualLine = projection.actualTrack.map(toLatLng);

  const cur = projection.currentPosition;
  const stale = !!cur && (cur.freshness === "STALE" || cur.freshness === "VERY_STALE" || cur.freshness === "UNKNOWN");
  const nowIso = new Date().toISOString();

  const selectedTarget: [number, number] | null = (() => {
    if (!selectedKey) return null;
    if (cur && markerKey(cur) === selectedKey) return [cur.latitude, cur.longitude];
    const hit = projection.milestones.find((m) => markerKey(m) === selectedKey);
    return hit ? [hit.latitude, hit.longitude] : null;
  })();

  const popup = (m: MapMarker) => {
    const age = ageLabelFr(m.occurredAt, nowIso);
    return (
      <Tooltip direction="top" offset={[0, -10]}>
        <div className="text-xs">
          <div className="font-semibold">{m.label}</div>
          {m.source && <div>Source : {sourceLabelFr(m.source)}</div>}
          {m.confidence && <div>Confiance : {confidenceLabelFr(m.confidence)}</div>}
          {m.freshness && <div>Fraîcheur : {freshnessLabel(m.freshness)}{age ? ` · ${age}` : ""}</div>}
          {m.occurredAt && <div>{m.occurredAt.slice(0, 16).replace("T", " ")}</div>}
        </div>
      </Tooltip>
    );
  };

  const clickable = (key: string) =>
    onSelectMarker ? { eventHandlers: { click: () => onSelectMarker(key) } } : {};

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <MapContainer bounds={bounds} boundsOptions={{ padding: [32, 32] }} scrollWheelZoom={false} className="h-[260px] w-full sm:h-[340px]" attributionControl>
        <TileLayer url={TILE_URL} attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' />
        <PanToSelected target={selectedTarget} />
        {/* Planned route: dashed. Actual track: solid. Never confused visually. */}
        {plannedLine.length >= 2 && <Polyline positions={plannedLine} pathOptions={{ color: "#94a3b8", weight: 3, dashArray: "6 8" }} />}
        {actualLine.length >= 2 && <Polyline positions={actualLine} pathOptions={{ color: "#0d9488", weight: 3 }} />}
        {projection.origin && <Marker position={toLatLng(projection.origin)} icon={dot(KIND_COLOR.origin)}><Tooltip direction="top">{projection.origin.label ?? "Origine"}</Tooltip></Marker>}
        {projection.destination && <Marker position={toLatLng(projection.destination)} icon={dot(KIND_COLOR.destination)}><Tooltip direction="top">{projection.destination.label ?? "Destination"}</Tooltip></Marker>}
        {projection.milestones.map((m, i) => {
          const key = markerKey(m);
          return (
            <Marker
              key={`m${i}`}
              position={[m.latitude, m.longitude]}
              icon={dot(KIND_COLOR.milestone, { selected: selectedKey === key })}
              {...clickable(key)}
            >
              {popup(m)}
            </Marker>
          );
        })}
        {cur && (
          <Marker
            position={[cur.latitude, cur.longitude]}
            icon={dot(CONF_COLOR[cur.confidence ?? "ESTIMATED"] ?? "#64748b", { stale, big: true, selected: selectedKey === markerKey(cur) })}
            {...clickable(markerKey(cur))}
          >
            {popup(cur)}
          </Marker>
        )}
      </MapContainer>
      {projection.warnings.length > 0 && (
        <ul className="border-t border-slate-100 px-4 py-2 text-xs text-amber-700">{projection.warnings.map((w) => <li key={w}>⚠ {w}</li>)}</ul>
      )}
    </div>
  );
}
