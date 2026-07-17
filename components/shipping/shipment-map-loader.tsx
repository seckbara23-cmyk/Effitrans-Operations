"use client";

/**
 * Lazy loader for the shipment map (Phase 7.2B). Keeps Leaflet OUT of the server bundle and
 * off pages that don't render a map: the map chunk loads only client-side, on demand.
 */
import dynamic from "next/dynamic";
import type { ShipmentMapProjection } from "@/lib/shipping/intelligence/map-projection";

const ShipmentMap = dynamic(() => import("./shipment-map"), {
  ssr: false,
  loading: () => <div className="surface p-4 text-sm text-slate-400">Chargement de la carte…</div>,
});

export function ShipmentMapLoader({
  projection,
  selectedKey,
  onSelectMarker,
}: {
  projection: ShipmentMapProjection;
  /** 8.4 sync (optional) — forwarded to the map. Existing callers omit both. */
  selectedKey?: string | null;
  onSelectMarker?: (key: string) => void;
}) {
  return <ShipmentMap projection={projection} selectedKey={selectedKey} onSelectMarker={onSelectMarker} />;
}
