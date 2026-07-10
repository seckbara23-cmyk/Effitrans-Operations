"use client";

/**
 * Shipment map (Phase 3.3A D9). Decides between the interactive Leaflet map
 * (only when grounded coordinates exist) and the non-geographic route diagram.
 * The Leaflet bundle is lazy-loaded (ssr:false) with the diagram as the static
 * loading fallback — so map code never ships on pages that don't render a map.
 */
import dynamic from "next/dynamic";
import { RouteDiagram } from "./route-diagram";
import type { MapPoint } from "@/lib/portal/map-points";
import type { MapPhase } from "@/lib/portal/shipment-view";

const LeafletMap = dynamic(() => import("./leaflet-map").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

function MapSkeleton() {
  return <div className="h-[360px] animate-pulse rounded-2xl border border-slate-200 bg-slate-100" aria-hidden />;
}

export function ShipmentMap({ points, hasGeo, phase }: { points: MapPoint[]; hasGeo: boolean; phase: MapPhase }) {
  if (!hasGeo) return <RouteDiagram phase={phase} />;
  return <LeafletMap points={points} />;
}
