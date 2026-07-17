"use client";

/**
 * Tracking journey coordinator (Phase 8.4 §H) — CLIENT. The ONE island that binds the map and
 * the immutable journal to a SINGLE selection state, so they can never drift.
 *
 * Both sides derive the same stable `markerKey` (label|occurredAt) from the SAME normalized
 * inputs the server already produced:
 *   - map markers come from the 7.2A ShipmentMapProjection (milestones labeled via
 *     milestoneLabel(eventType));
 *   - journal rows are the immutable timeline events; a row that HAS coordinates computes the
 *     identical key (milestoneLabel + occurredAt) and becomes selectable.
 *
 * There is NO second event history: the journal stays the immutable list; this component only
 * adds a shared highlight. Events WITHOUT coordinates remain fully visible in the journal —
 * they simply aren't clickable-to-map. Clicking a marker highlights its row; clicking a
 * coordinate-bearing row pans the map to it. Read-only; no mutation.
 */
import { useState } from "react";
import { ShipmentMapLoader } from "./shipment-map-loader";
import { markerKey } from "./shipment-map";
import type { ShipmentMapProjection } from "@/lib/shipping/intelligence/map-projection";
import { sourceLabelFr, confidenceLabelFr } from "@/lib/shipping/intelligence/events";
import { freshnessLabel } from "@/lib/shipping/intelligence/freshness";

/** A journal row as the page already has it, plus its map coordinates when present. */
export type JourneyEvent = {
  fingerprint: string;
  label: string; // milestoneLabel(eventType) — matches the map marker label
  occurredAt: string;
  source: string;
  confidence: string;
  locationName: string | null;
  hasCoordinates: boolean;
};

const CONF_STYLE: Record<string, string> = {
  CONFIRMED: "bg-teal-50 text-teal-700",
  INFERRED: "bg-amber-50 text-amber-700",
  MANUAL: "bg-sky-50 text-sky-700",
  ESTIMATED: "bg-slate-100 text-slate-500",
};

export function TrackingJourney({
  projection,
  events,
  currentFreshnessLabel,
}: {
  projection: ShipmentMapProjection;
  /** newest-last; rendered newest-first here (matches the existing page order). */
  events: JourneyEvent[];
  /** optional current-position freshness label for the header line. */
  currentFreshnessLabel?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <ShipmentMapLoader projection={projection} selectedKey={selected} onSelectMarker={setSelected} />

      <div className="surface p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-navy-900">Journal (immuable)</h2>
          {currentFreshnessLabel && <span className="text-xs text-slate-400">Position : {currentFreshnessLabel}</span>}
        </div>
        {events.length === 0 ? (
          <p className="text-xs text-slate-500">Aucun évènement.</p>
        ) : (
          <ol className="space-y-1.5">
            {[...events].reverse().map((e, i) => {
              const key = e.hasCoordinates ? markerKey({ label: e.label, occurredAt: e.occurredAt }) : null;
              const isSelected = key != null && key === selected;
              const clickable = key != null;
              return (
                <li
                  key={`${e.fingerprint}-${i}`}
                  className={`flex items-start gap-3 rounded-lg px-2 py-1.5 text-sm ${isSelected ? "bg-amber-50 ring-1 ring-amber-300" : ""} ${clickable ? "cursor-pointer hover:bg-slate-50" : ""}`}
                  onClick={clickable ? () => setSelected(isSelected ? null : key) : undefined}
                  {...(clickable
                    ? {
                        role: "button",
                        tabIndex: 0,
                        "aria-pressed": isSelected,
                        onKeyDown: (ev: React.KeyboardEvent) => {
                          if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            setSelected(isSelected ? null : key);
                          }
                        },
                      }
                    : {})}
                >
                  <span className="tabular mt-0.5 w-28 shrink-0 text-xs text-slate-400">{e.occurredAt.slice(0, 16).replace("T", " ")}</span>
                  <span className="flex-1">
                    <span className="font-medium text-navy-800">{e.label}</span>
                    {clickable && <span className="ml-1 text-[10px] text-teal-600" aria-hidden>◉</span>}
                    <span className="ml-2 text-xs text-slate-500">
                      <span className={`rounded px-1.5 py-0.5 ${CONF_STYLE[e.confidence] ?? "bg-slate-100 text-slate-500"}`}>{confidenceLabelFr(e.confidence)}</span>
                      <span className="ml-1">{sourceLabelFr(e.source)}</span>
                      {e.locationName ? ` · ${e.locationName}` : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400">
          Les évènements avec coordonnées (◉) sont liés à la carte. Journal immuable — source affichée sur chaque ligne.
        </p>
      </div>
    </div>
  );
}

export { freshnessLabel };
