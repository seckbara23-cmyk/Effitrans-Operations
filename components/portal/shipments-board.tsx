"use client";

/**
 * Active shipments board with client-side search (Phase 3.3 D1 + D9).
 * Filters the already-loaded shipment cards — no extra queries, reuses the
 * existing portal shipment service output.
 */
import { useMemo, useState } from "react";
import { t } from "@/lib/i18n";
import { ShipmentCard } from "./shipment-card";
import type { PortalShipmentCard } from "@/lib/portal/types";

const IconSearch = () => (
  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="9" cy="9" r="6" /><path d="M14 14l4 4" strokeLinecap="round" />
  </svg>
);

export function ShipmentsBoard({ shipments }: { shipments: PortalShipmentCard[] }) {
  const [q, setQ] = useState("");
  const sr = t.portal.premium.search;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return shipments;
    return shipments.filter((s) => {
      const haystack = [
        s.fileNumber,
        s.reference,
        s.origin,
        s.destination,
        s.status,
        t.files.statuses[s.status as keyof typeof t.files.statuses],
        t.files.types[s.type as keyof typeof t.files.types],
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [q, shipments]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-lg">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <IconSearch />
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={sr.placeholder}
          className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-3 text-sm text-navy-900 shadow-sm placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
        />
      </div>

      {q.trim() && <p className="text-xs text-slate-500">{filtered.length} {sr.results}</p>}

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white/50 p-10 text-center text-sm text-slate-500">
          {q.trim() ? sr.noResults : t.portal.premium.empty}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => (
            <ShipmentCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}
