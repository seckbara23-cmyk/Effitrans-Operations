"use client";

/**
 * TMS-2 — the Transport live map. Client-only (lazy via next/dynamic ssr:false),
 * on the Leaflet + OpenStreetMap stack this repository already uses for the
 * portal shipment map. No paid vendor, no API key, no credential in client code.
 *
 * ONLY OBSERVED GEOMETRY IS DRAWN. A marker exists where a position was
 * actually recorded; the polyline connects recorded fixes in time order and
 * nothing else — no road snapping, no interpolation, no straight line invented
 * between two points the vehicle was never seen travelling between. A mission
 * with no fix yet has no marker, and says so in the list instead.
 */
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Polyline, Tooltip } from "react-leaflet";
import type { LiveMission, LiveMissionPoint } from "@/lib/tracking/live-service";
import { MISSION_LEG_LABEL_FR } from "@/lib/tracking/types";

/** Leg colour: outbound teal, return navy. Health tints the ring, not the dot. */
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

function missionIcon(leg: string, health: string): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;height:20px;width:20px;border-radius:9999px;background:${LEG_COLOR[leg] ?? "#94a3b8"};box-shadow:0 0 0 3px ${HEALTH_RING[health] ?? "#fff"},0 1px 3px rgba(0,0,0,.35)"></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

function returnIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;height:14px;width:14px;border-radius:3px;background:#fff;border:2px solid #0b1a2b"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

export function TransportLiveMap({
  missions,
  route,
}: {
  missions: LiveMission[];
  /** Observed positions for one focused mission, oldest first. */
  route?: LiveMissionPoint[];
}) {
  const located = missions.filter(
    (m): m is LiveMission & { lastPosition: LiveMissionPoint } => m.lastPosition != null,
  );
  const returnPoints = missions.filter(
    (m): m is LiveMission & { returnPoint: { lat: number; lng: number } } => m.returnPoint != null,
  );

  const all: [number, number][] = [
    ...located.map((m) => [m.lastPosition.lat, m.lastPosition.lng] as [number, number]),
    ...returnPoints.map((m) => [m.returnPoint.lat, m.returnPoint.lng] as [number, number]),
    ...(route ?? []).map((p) => [p.lat, p.lng] as [number, number]),
  ];

  // Nothing observed yet: say so rather than showing an empty world map that
  // implies a fleet sitting at (0,0).
  if (all.length === 0) {
    return (
      <div className="surface p-6 text-sm text-slate-500">
        Aucune position enregistrée pour l&apos;instant. La carte s&apos;affichera dès qu&apos;un
        chauffeur aura démarré le suivi et transmis une première position.
      </div>
    );
  }

  const bounds = L.latLngBounds(all);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [40, 40] }}
        scrollWheelZoom
        className="h-[380px] w-full sm:h-[520px]"
        attributionControl
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />

        {/* The observed route — recorded fixes only, in time order. */}
        {route && route.length >= 2 && (
          <Polyline
            positions={route.map((p) => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: "#0d9488", weight: 3 }}
          />
        )}

        {returnPoints.map((m) => (
          <Marker key={`ret-${m.transportId}`} position={[m.returnPoint.lat, m.returnPoint.lng]} icon={returnIcon()}>
            <Tooltip direction="top" offset={[0, -8]}>
              Point de retour — {m.returnLocation ?? m.fileNumber}
            </Tooltip>
          </Marker>
        ))}

        {located.map((m) => (
          <Marker
            key={m.transportId}
            position={[m.lastPosition.lat, m.lastPosition.lng]}
            icon={missionIcon(m.leg, m.health)}
          >
            <Tooltip direction="top" offset={[0, -10]}>
              <span className="font-medium">
                {m.vehicleLabel ?? "Véhicule non renseigné"}
                {m.driverName ? ` — ${m.driverName}` : ""}
              </span>
              <br />
              {m.fileNumber} · {MISSION_LEG_LABEL_FR[m.leg]}
            </Tooltip>
          </Marker>
        ))}
      </MapContainer>
      <p className="border-t border-slate-100 px-5 py-2 text-center text-[11px] text-slate-400">
        Positions réellement enregistrées par l&apos;application chauffeur. Aucun trajet n&apos;est
        reconstitué ni interpolé.
      </p>
    </div>
  );
}
