"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  documentStatus,
  documentStatusOrder,
  type DocumentStatus,
} from "@/lib/status";
import {
  documents,
  docTypeMeta,
  docTypeOrder,
  type DocType,
} from "@/lib/documents";
import { Badge } from "@/components/ui/badge";
import { DocTypeIcon } from "@/components/documents/doc-type-icon";
import { IconSearch, IconDocument, IconChevronRight } from "@/lib/icons";

type TypeFilter = DocType | "all";
type StatusFilter = DocumentStatus | "all";
type CustomerFilter = string | "all";
type LinkFilter = "all" | "shipment" | "customs" | "none";

const customers = Array.from(
  new Set(documents.map((d) => d.customer)),
).sort();

function KpiStrip() {
  const received = documents.filter(
    (d) => d.status === "received" || d.status === "validated",
  ).length;
  const missing = documents.filter((d) => d.status === "missing").length;
  const toValidate = documents.filter((d) => d.status === "to_validate").length;
  const expiring = documents.filter((d) => d.status === "expiring").length;

  const kpis = [
    { label: "Documents reçus", value: received, tone: "teal" as const },
    { label: "Documents manquants", value: missing, tone: "red" as const },
    { label: "En attente de validation", value: toValidate, tone: "navy" as const },
    { label: "Expirent bientôt", value: expiring, tone: "amber" as const },
  ];
  const accent: Record<string, string> = {
    teal: "text-teal-600",
    red: "text-red-600",
    navy: "text-navy-700",
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

export function DocumentsExplorer() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [customer, setCustomer] = useState<CustomerFilter>("all");
  const [link, setLink] = useState<LinkFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return documents.filter((d) => {
      if (type !== "all" && d.type !== type) return false;
      if (status !== "all" && d.status !== status) return false;
      if (customer !== "all" && d.customer !== customer) return false;
      if (link === "shipment" && !d.relatedShipment) return false;
      if (link === "customs" && !d.relatedCustomsFile) return false;
      if (link === "none" && (d.relatedShipment || d.relatedCustomsFile))
        return false;
      if (q) {
        const haystack = [
          d.name,
          d.reference,
          d.customer,
          d.relatedShipment ?? "",
          d.relatedCustomsFile ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [query, type, status, customer, link]);

  const hasFilters =
    query !== "" ||
    type !== "all" ||
    status !== "all" ||
    customer !== "all" ||
    link !== "all";

  function reset() {
    setQuery("");
    setType("all");
    setStatus("all");
    setCustomer("all");
    setLink("all");
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
              placeholder="Rechercher par document, référence, client ou dossier…"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-navy-900 placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Type de document"
              value={type}
              onChange={(e) => setType(e.target.value as TypeFilter)}
              className={selectClass}
            >
              <option value="all">Tous les types</option>
              {docTypeOrder.map((t) => (
                <option key={t} value={t}>
                  {docTypeMeta[t].label}
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
              {documentStatusOrder.map((s) => (
                <option key={s} value={s}>
                  {documentStatus[s].label}
                </option>
              ))}
            </select>

            <select
              aria-label="Client"
              value={customer}
              onChange={(e) => setCustomer(e.target.value as CustomerFilter)}
              className={selectClass}
            >
              <option value="all">Tous les clients</option>
              {customers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              aria-label="Dossier lié"
              value={link}
              onChange={(e) => setLink(e.target.value as LinkFilter)}
              className={selectClass}
            >
              <option value="all">Tous les rattachements</option>
              <option value="shipment">Avec expédition</option>
              <option value="customs">Avec dossier douane</option>
              <option value="none">Sans dossier lié</option>
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
          document{filtered.length > 1 ? "s" : ""} sur {documents.length}
        </p>
      </div>

      {/* Table */}
      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5 font-semibold">Document</th>
                <th className="px-5 py-2.5 font-semibold">Type</th>
                <th className="px-5 py-2.5 font-semibold">Client</th>
                <th className="px-5 py-2.5 font-semibold">Expédition</th>
                <th className="px-5 py-2.5 font-semibold">Dossier douane</th>
                <th className="px-5 py-2.5 font-semibold">Statut</th>
                <th className="px-5 py-2.5 font-semibold">Reçu le</th>
                <th className="px-5 py-2.5 font-semibold">Expiration</th>
                <th className="px-5 py-2.5 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((d) => {
                const st = documentStatus[d.status];
                return (
                  <tr
                    key={d.id}
                    className="group transition-colors hover:bg-sand-50"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sand-100 text-navy-600">
                          <DocTypeIcon type={d.type} className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <Link
                            href={`/documents/${d.id}`}
                            className="text-sm font-semibold text-navy-900 hover:text-teal-700"
                          >
                            {d.name}
                          </Link>
                          <div className="tabular text-[11px] text-slate-400">
                            {d.reference}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">
                      {docTypeMeta[d.type].label}
                    </td>
                    <td className="px-5 py-3 text-sm text-navy-800">
                      {d.customer}
                    </td>
                    <td className="px-5 py-3">
                      {d.relatedShipment ? (
                        <Link
                          href={`/shipments/${d.relatedShipment}`}
                          className="tabular text-sm text-navy-700 hover:text-teal-700"
                        >
                          {d.relatedShipment}
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {d.relatedCustomsFile ? (
                        <Link
                          href={`/customs/${d.relatedCustomsFile}`}
                          className="tabular text-sm text-navy-700 hover:text-teal-700"
                        >
                          {d.relatedCustomsFile}
                        </Link>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {d.receivedDate ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">
                      {d.expiryDate ?? "—"}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        href={`/documents/${d.id}`}
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
              <IconDocument className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-navy-800">
              Aucun document ne correspond aux filtres
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
