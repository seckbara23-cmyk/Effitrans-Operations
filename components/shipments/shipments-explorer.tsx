"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  shipmentStatus,
  shipmentStatusOrder,
  transportMode,
  type ShipmentStatus,
  type TransportMode,
} from "@/lib/status";
import { shipments } from "@/lib/shipments";
import { Badge } from "@/components/ui/badge";
import { ModeTag } from "@/components/ui/mode-tag";
import { AgentChip } from "@/components/ui/agent-chip";
import { IconSearch, IconContainer, IconChevronRight } from "@/lib/icons";

type ModeFilter = TransportMode | "all";
type StatusFilter = ShipmentStatus | "all";
type AgentFilter = string | "all";

const agents = Array.from(new Set(shipments.map((s) => s.agent))).sort();

function StatStrip() {
  const stats = [
    { label: "Dossiers actifs", value: shipments.filter((s) => s.status !== "delivered").length, tone: "navy" as const },
    { label: "Au port", value: shipments.filter((s) => s.status === "at_port").length, tone: "blue" as const },
    { label: "Douane en attente", value: shipments.filter((s) => s.status === "customs_pending").length, tone: "amber" as const },
    { label: "En retard", value: shipments.filter((s) => s.status === "delayed").length, tone: "red" as const },
  ];
  const accent: Record<string, string> = {
    navy: "text-navy-700",
    blue: "text-sky-600",
    amber: "text-amber-600",
    red: "text-red-600",
  };
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="surface p-4">
          <p className="text-xs font-medium text-slate-500">{s.label}</p>
          <p className={`tabular mt-1.5 text-2xl font-bold ${accent[s.tone]}`}>
            {s.value}
          </p>
        </div>
      ))}
    </div>
  );
}

const selectClass =
  "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-navy-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20";

export function ShipmentsExplorer() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<ModeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [agent, setAgent] = useState<AgentFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return shipments.filter((s) => {
      if (mode !== "all" && s.mode !== mode) return false;
      if (status !== "all" && s.status !== status) return false;
      if (agent !== "all" && s.agent !== agent) return false;
      if (
        q &&
        !s.reference.toLowerCase().includes(q) &&
        !s.customer.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [query, mode, status, agent]);

  const hasFilters =
    query !== "" || mode !== "all" || status !== "all" || agent !== "all";

  function reset() {
    setQuery("");
    setMode("all");
    setStatus("all");
    setAgent("all");
  }

  return (
    <div className="space-y-5">
      <StatStrip />

      {/* Filter bar */}
      <div className="surface p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher par référence ou client…"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-navy-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Mode de transport"
              value={mode}
              onChange={(e) => setMode(e.target.value as ModeFilter)}
              className={selectClass}
            >
              <option value="all">Tous les modes</option>
              {(["sea", "air", "road"] as TransportMode[]).map((m) => (
                <option key={m} value={m}>
                  {transportMode[m].label}
                </option>
              ))}
            </select>

            <select
              aria-label="Statut"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className={selectClass}
            >
              <option value="all">Tous les statuts</option>
              {shipmentStatusOrder.map((s) => (
                <option key={s} value={s}>
                  {shipmentStatus[s].label}
                </option>
              ))}
            </select>

            <select
              aria-label="Agent assigné"
              value={agent}
              onChange={(e) => setAgent(e.target.value as AgentFilter)}
              className={selectClass}
            >
              <option value="all">Tous les agents</option>
              {agents.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>

            {hasFilters && (
              <button
                onClick={reset}
                className="h-9 rounded-lg px-3 text-sm font-medium text-teal-700 hover:bg-teal-50"
              >
                Réinitialiser
              </button>
            )}
          </div>
        </div>
        <p className="mt-2.5 px-1 text-xs text-slate-500">
          <span className="tabular font-semibold text-navy-800">
            {filtered.length}
          </span>{" "}
          dossier{filtered.length > 1 ? "s" : ""} sur {shipments.length}
        </p>
      </div>

      {/* Table */}
      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5 font-semibold">Référence</th>
                <th className="px-5 py-2.5 font-semibold">Client</th>
                <th className="px-5 py-2.5 font-semibold">Mode</th>
                <th className="px-5 py-2.5 font-semibold">Origine</th>
                <th className="px-5 py-2.5 font-semibold">Destination</th>
                <th className="px-5 py-2.5 font-semibold">Statut</th>
                <th className="px-5 py-2.5 font-semibold">Agent</th>
                <th className="px-5 py-2.5 font-semibold">Maj</th>
                <th className="px-5 py-2.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((s) => {
                const st = shipmentStatus[s.status];
                return (
                  <tr key={s.reference} className="group transition-colors hover:bg-sand-50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/shipments/${s.reference}`}
                        className="tabular text-sm font-semibold text-navy-900 hover:text-teal-700"
                      >
                        {s.reference}
                      </Link>
                      <div className="tabular text-[11px] text-slate-400">
                        {s.transportRef}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-navy-800">{s.customer}</td>
                    <td className="px-5 py-3">
                      <ModeTag mode={s.mode} />
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">{s.origin}</td>
                    <td className="px-5 py-3 text-sm text-slate-600">{s.destination}</td>
                    <td className="px-5 py-3">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      <AgentChip name={s.agent} />
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{s.lastUpdate}</td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/shipments/${s.reference}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-navy-800 hover:bg-slate-50"
                      >
                        Voir
                        <IconChevronRight className="h-4 w-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-sand-100 text-slate-400">
              <IconContainer className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-navy-800">
              Aucun dossier ne correspond aux filtres
            </p>
            <button
              onClick={reset}
              className="mt-3 text-sm font-medium text-teal-700 hover:text-teal-800"
            >
              Réinitialiser les filtres
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
