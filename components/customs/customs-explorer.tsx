"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  customsStatus,
  customsStatusOrder,
  priority as priorityMeta,
  type CustomsStatus,
  type Priority,
} from "@/lib/status";
import { customsFiles, missingDocsCount } from "@/lib/customs";
import { Badge } from "@/components/ui/badge";
import { AgentChip } from "@/components/ui/agent-chip";
import { IconSearch, IconStamp, IconChevronRight } from "@/lib/icons";

type StatusFilter = CustomsStatus | "all";
type OfficerFilter = string | "all";
type PriorityFilter = Priority | "all";

const officers = Array.from(new Set(customsFiles.map((f) => f.officer))).sort();

function KpiStrip() {
  const kpis = [
    {
      label: "Déclarations actives",
      value: customsFiles.filter((f) => f.status !== "cloture").length,
      tone: "navy" as const,
    },
    {
      label: "En attente de documents",
      value: customsFiles.filter((f) => f.status === "docs_a_completer").length,
      tone: "amber" as const,
    },
    {
      label: "En cours de liquidation",
      value: customsFiles.filter((f) => f.status === "en_liquidation").length,
      tone: "blue" as const,
    },
    {
      label: "BAE obtenus",
      value: customsFiles.filter((f) => f.baeRef).length,
      tone: "teal" as const,
    },
    {
      label: "Dossiers bloqués",
      value: customsFiles.filter((f) => f.status === "bloque").length,
      tone: "red" as const,
    },
  ];
  const accent: Record<string, string> = {
    navy: "text-navy-700",
    blue: "text-sky-600",
    amber: "text-amber-600",
    teal: "text-teal-600",
    red: "text-red-600",
  };
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
      {kpis.map((k) => (
        <div key={k.label} className="surface p-4">
          <p className="text-xs font-medium text-slate-500">{k.label}</p>
          <p className={`tabular mt-1.5 text-2xl font-bold ${accent[k.tone]}`}>
            {k.value}
          </p>
        </div>
      ))}
    </div>
  );
}

const selectClass =
  "h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-navy-800 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20";

export function CustomsExplorer() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [officer, setOfficer] = useState<OfficerFilter>("all");
  const [prio, setPrio] = useState<PriorityFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return customsFiles.filter((f) => {
      if (status !== "all" && f.status !== status) return false;
      if (officer !== "all" && f.officer !== officer) return false;
      if (prio !== "all" && f.priority !== prio) return false;
      if (
        q &&
        !f.reference.toLowerCase().includes(q) &&
        !f.declarationNumber.toLowerCase().includes(q) &&
        !f.relatedShipment.toLowerCase().includes(q) &&
        !f.customer.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [query, status, officer, prio]);

  const hasFilters =
    query !== "" || status !== "all" || officer !== "all" || prio !== "all";

  function reset() {
    setQuery("");
    setStatus("all");
    setOfficer("all");
    setPrio("all");
  }

  return (
    <div className="space-y-5">
      <KpiStrip />

      {/* Filter bar */}
      <div className="surface p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Rechercher par dossier, déclaration, expédition ou client…"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-navy-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Statut"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className={selectClass}
            >
              <option value="all">Tous les statuts</option>
              {customsStatusOrder.map((s) => (
                <option key={s} value={s}>
                  {customsStatus[s].label}
                </option>
              ))}
            </select>

            <select
              aria-label="Agent douane"
              value={officer}
              onChange={(e) => setOfficer(e.target.value as OfficerFilter)}
              className={selectClass}
            >
              <option value="all">Tous les agents</option>
              {officers.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>

            <select
              aria-label="Priorité"
              value={prio}
              onChange={(e) => setPrio(e.target.value as PriorityFilter)}
              className={selectClass}
            >
              <option value="all">Toutes priorités</option>
              {(["high", "medium", "low"] as Priority[]).map((p) => (
                <option key={p} value={p}>
                  {priorityMeta[p].label}
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
          dossier{filtered.length > 1 ? "s" : ""} sur {customsFiles.length}
        </p>
      </div>

      {/* Table */}
      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5 font-semibold">Référence dossier</th>
                <th className="px-5 py-2.5 font-semibold">Client</th>
                <th className="px-5 py-2.5 font-semibold">Déclaration</th>
                <th className="px-5 py-2.5 font-semibold">Bureau douane</th>
                <th className="px-5 py-2.5 font-semibold">Statut</th>
                <th className="px-5 py-2.5 font-semibold">Docs manquants</th>
                <th className="px-5 py-2.5 font-semibold">Agent douane</th>
                <th className="px-5 py-2.5 font-semibold">Priorité</th>
                <th className="px-5 py-2.5 font-semibold">Maj</th>
                <th className="px-5 py-2.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((f) => {
                const st = customsStatus[f.status];
                const pr = priorityMeta[f.priority];
                const missing = missingDocsCount(f);
                return (
                  <tr
                    key={f.reference}
                    className="group transition-colors hover:bg-sand-50"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/customs/${f.reference}`}
                        className="tabular text-sm font-semibold text-navy-900 hover:text-teal-700"
                      >
                        {f.reference}
                      </Link>
                      <div className="tabular text-[11px] text-slate-400">
                        {f.relatedShipment}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-navy-800">
                      {f.customer}
                    </td>
                    <td className="px-5 py-3">
                      <span className="tabular text-sm text-slate-600">
                        {f.declarationNumber}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">
                      {f.office}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      {missing > 0 ? (
                        <span className="tabular inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-red-50 px-2 text-xs font-semibold text-red-600 ring-1 ring-inset ring-red-200">
                          {missing}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <AgentChip name={f.officer} />
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={pr.tone} dot={false}>
                        {pr.label}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {f.lastUpdate}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/customs/${f.reference}`}
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
              <IconStamp className="h-6 w-6" />
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
