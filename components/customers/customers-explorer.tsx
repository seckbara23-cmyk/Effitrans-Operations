"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { customerStatus, type CustomerStatus } from "@/lib/status";
import {
  customers,
  primaryContact,
  openShipmentsFor,
  openCustomsFor,
  SECTORS,
  CUSTOMER_TYPES,
  type Sector,
  type CustomerType,
} from "@/lib/customers";
import { Badge } from "@/components/ui/badge";
import { AgentChip } from "@/components/ui/agent-chip";
import { IconSearch, IconUsers, IconChevronRight } from "@/lib/icons";

type SectorFilter = Sector | "all";
type TypeFilter = CustomerType | "all";
type ManagerFilter = string | "all";

/** Pre-compute the derived operational figures once per customer. */
const rows = customers.map((c) => {
  const openShip = openShipmentsFor(c.name).length;
  const openCust = openCustomsFor(c.name).length;
  return { customer: c, openShip, openCust, contact: primaryContact(c) };
});

const managers = Array.from(
  new Set(customers.map((c) => c.accountManager)),
).sort();

function KpiStrip() {
  const activeClients = customers.filter((c) => c.status === "active").length;
  const openFiles = rows.reduce((n, r) => n + r.openShip + r.openCust, 0);
  const lateFiles = customers.reduce((n, c) => {
    const ship = openShipmentsFor(c.name).filter(
      (s) => s.status === "delayed",
    ).length;
    const cust = openCustomsFor(c.name).filter(
      (f) => f.status === "bloque",
    ).length;
    return n + ship + cust;
  }, 0);
  const missingDocs = customers.reduce(
    (n, c) => n + c.documents.filter((d) => d.status === "missing").length,
    0,
  );

  const kpis = [
    { label: "Clients actifs", value: activeClients, tone: "navy" as const },
    { label: "Dossiers ouverts", value: openFiles, tone: "teal" as const },
    { label: "Dossiers en retard", value: lateFiles, tone: "red" as const },
    {
      label: "Documents clients manquants",
      value: missingDocs,
      tone: "amber" as const,
    },
  ];
  const accent: Record<string, string> = {
    navy: "text-navy-700",
    teal: "text-teal-600",
    red: "text-red-600",
    amber: "text-amber-600",
  };
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
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

export function CustomersExplorer() {
  const [query, setQuery] = useState("");
  const [sector, setSector] = useState<SectorFilter>("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [manager, setManager] = useState<ManagerFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(({ customer: c }) => {
      if (sector !== "all" && c.sector !== sector) return false;
      if (type !== "all" && c.type !== type) return false;
      if (manager !== "all" && c.accountManager !== manager) return false;
      if (q) {
        const haystack = [
          c.name,
          c.legalName,
          c.tradeName,
          c.ninea,
          ...c.contacts.map((ct) => ct.name),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [query, sector, type, manager]);

  const hasFilters =
    query !== "" || sector !== "all" || type !== "all" || manager !== "all";

  function reset() {
    setQuery("");
    setSector("all");
    setType("all");
    setManager("all");
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
              placeholder="Rechercher par société, contact ou NINEA…"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-navy-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Secteur"
              value={sector}
              onChange={(e) => setSector(e.target.value as SectorFilter)}
              className={selectClass}
            >
              <option value="all">Tous les secteurs</option>
              {SECTORS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            <select
              aria-label="Type de client"
              value={type}
              onChange={(e) => setType(e.target.value as TypeFilter)}
              className={selectClass}
            >
              <option value="all">Tous les types</option>
              {CUSTOMER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <select
              aria-label="Chargé de compte"
              value={manager}
              onChange={(e) => setManager(e.target.value as ManagerFilter)}
              className={selectClass}
            >
              <option value="all">Tous les chargés</option>
              {managers.map((m) => (
                <option key={m} value={m}>
                  {m}
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
          client{filtered.length > 1 ? "s" : ""} sur {customers.length}
        </p>
      </div>

      {/* Table */}
      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5 font-semibold">Client</th>
                <th className="px-5 py-2.5 font-semibold">NINEA</th>
                <th className="px-5 py-2.5 font-semibold">Secteur</th>
                <th className="px-5 py-2.5 font-semibold">Contact principal</th>
                <th className="px-5 py-2.5 font-semibold">Téléphone</th>
                <th className="px-5 py-2.5 text-center font-semibold">Exp.</th>
                <th className="px-5 py-2.5 text-center font-semibold">Douane</th>
                <th className="px-5 py-2.5 font-semibold">Chargé de compte</th>
                <th className="px-5 py-2.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map(({ customer: c, openShip, openCust, contact }) => {
                const cs = customerStatus[c.status];
                return (
                  <tr
                    key={c.id}
                    className="group transition-colors hover:bg-sand-50"
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/customers/${c.id}`}
                        className="text-sm font-semibold text-navy-900 hover:text-teal-700"
                      >
                        {c.name}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <Badge tone={cs.tone} dot={false}>
                          {cs.label}
                        </Badge>
                        <span className="text-[11px] text-slate-400">
                          {c.type}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="tabular text-sm text-slate-600">
                        {c.ninea}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">
                      {c.sector}
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-sm text-navy-800">{contact.name}</p>
                      <p className="text-[11px] text-slate-400">{contact.role}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className="tabular text-sm text-slate-600">
                        {c.phone}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center">
                      <CountPill value={openShip} tone="navy" />
                    </td>
                    <td className="px-5 py-3 text-center">
                      <CountPill value={openCust} tone="teal" />
                    </td>
                    <td className="px-5 py-3">
                      <AgentChip name={c.accountManager} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/customers/${c.id}`}
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
              <IconUsers className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-navy-800">
              Aucun client ne correspond aux filtres
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

function CountPill({
  value,
  tone,
}: {
  value: number;
  tone: "navy" | "teal";
}) {
  if (value === 0) {
    return <span className="text-xs text-slate-300">—</span>;
  }
  const cls =
    tone === "navy"
      ? "bg-navy-50 text-navy-700 ring-navy-200"
      : "bg-teal-50 text-teal-700 ring-teal-200";
  return (
    <span
      className={`tabular inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-semibold ring-1 ring-inset ${cls}`}
    >
      {value}
    </span>
  );
}
