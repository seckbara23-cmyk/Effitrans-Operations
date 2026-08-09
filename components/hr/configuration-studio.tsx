"use client";

/**
 * HR-1 — configuration studio (client). Renders ONLY for hr:config:manage
 * holders (the page gates); every action re-checks server-side. Four panels:
 * numbering + vocabularies (hr_configuration), organization units, positions,
 * work locations. Deliberately simple forms — the wizard is a permanent
 * workspace, not a stepper that disappears.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveHrConfiguration,
  activateHrConfiguration,
  createOrgUnit,
  setOrgUnitActive,
  createPosition,
  createWorkLocation,
} from "@/lib/hr/organization-actions";
import { UNIT_KINDS, UNIT_KIND_LABEL_FR, type UnitKind, type HrOrgUnit } from "@/lib/hr/org-tree";
import type { HrConfiguration, HrPosition, HrWorkLocation } from "@/lib/hr/organization";
// THE canonical department registry (Phase 9.0A) — reused, never re-declared:
// the platform correspondence select must offer exactly the platform's four
// departments, labeled, without this file keeping its own copy of the list.
import { CANONICAL_DEPARTMENTS } from "@/lib/organization/departments";

const ERR: Record<string, string> = {
  forbidden: "Action non autorisée (hr:config:manage requis).",
  name_required: "Le nom est obligatoire.",
  title_required: "L'intitulé est obligatoire.",
  invalid_kind: "Type d'unité invalide.",
  invalid_parent: "Rattachement invalide : l'ordre hiérarchique doit descendre (Direction → Département → Section → Équipe).",
  already_exists: "Cet élément existe déjà.",
  employment_kinds_required: "Au moins un type d'emploi est requis.",
  save_failed: "Échec de l'enregistrement. Réessayez.",
  not_found: "Introuvable.",
};

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="surface space-y-3 p-5">
      <div>
        <h2 className="text-sm font-semibold text-navy-900">{title}</h2>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

export function HrConfigurationStudio({
  config,
  units,
  positions,
  locations,
}: {
  config: HrConfiguration | null;
  units: HrOrgUnit[];
  positions: HrPosition[];
  locations: HrWorkLocation[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // --- configuration row state -------------------------------------------
  const [keepNumbers, setKeepNumbers] = useState(config?.employee_number_keep_existing ?? true);
  const [prefix, setPrefix] = useState(config?.employee_number_prefix ?? "");
  const [kinds, setKinds] = useState(((config?.employment_kinds as string[] | null) ?? ["EMPLOYEE"]).join(", "));
  const [reasons, setReasons] = useState(((config?.termination_reasons as string[] | null) ?? []).join(", "));

  // --- org unit form ------------------------------------------------------
  const [unitName, setUnitName] = useState("");
  const [unitKind, setUnitKind] = useState<UnitKind>("DEPARTMENT");
  const [unitParent, setUnitParent] = useState("");
  const [unitDept, setUnitDept] = useState("");

  const [positionTitle, setPositionTitle] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationCity, setLocationCity] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    setError(null);
    setNotice(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(ERR[res.error ?? ""] ?? ERR.save_failed);
      else {
        if (done) setNotice(done);
        router.refresh();
      }
    });
  };

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {notice && <p className="rounded-lg bg-teal-50 p-3 text-sm text-teal-800" role="status">{notice}</p>}

      <Panel
        title="Numérotation & vocabulaires"
        subtitle={`État : ${config?.status === "ACTIVE" ? "Active" : config ? "Brouillon" : "Non configurée"} · format ratifié : EMP-0001 (séquence continue, sans année ; préfixe par défaut EMP) · les matricules existants sont immuables.`}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={keepNumbers} onChange={(e) => setKeepNumbers(e.target.checked)} />
            Conserver la numérotation existante
          </label>
          <label className="block text-sm text-slate-600">
            Préfixe des matricules (optionnel)
            <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="EMP"
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
          <label className="block text-sm text-slate-600 sm:col-span-2">
            Types d'emploi (séparés par des virgules — vocabulaire HRQ-ID1)
            <input value={kinds} onChange={(e) => setKinds(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
          <label className="block text-sm text-slate-600 sm:col-span-2">
            Motifs de fin de contrat (séparés par des virgules — vocabulaire HRQ-D1)
            <input value={reasons} onChange={(e) => setReasons(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
          </label>
        </div>
        <div className="flex gap-2">
          <button disabled={pending}
            onClick={() => run(() => saveHrConfiguration({
              employeeNumberKeepExisting: keepNumbers,
              employeeNumberPrefix: prefix,
              employmentKinds: kinds.split(",").map((s) => s.trim()).filter(Boolean),
              terminationReasons: reasons.split(",").map((s) => s.trim()).filter(Boolean),
            }), "Configuration enregistrée.")}
            className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
            Enregistrer
          </button>
          {config && config.status !== "ACTIVE" && (
            <button disabled={pending}
              onClick={() => run(() => activateHrConfiguration(), "Configuration activée.")}
              className="rounded-lg border border-teal-300 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-50">
              Activer (Brouillon → Active)
            </button>
          )}
        </div>
      </Panel>

      <Panel title="Unités d'organisation" subtitle="Direction/Pôle → Département → Section → Équipe — l'ordre descend, la profondeur est bornée. Désactivation, jamais suppression.">
        <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          Structure de départ : les départements canoniques de la plateforme —{" "}
          {CANONICAL_DEPARTMENTS.map((d) => d.labelFr).join(", ")}. Créez une unité «
          Département » par département réel et liez sa correspondance plateforme.
          La correspondance est une métadonnée d&apos;organisation : elle n&apos;accorde
          jamais aucun droit d&apos;accès.
        </p>
        <div className="grid gap-2 sm:grid-cols-4">
          <input value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="Nom de l'unité"
            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
          <select value={unitKind} onChange={(e) => setUnitKind(e.target.value as UnitKind)}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm">
            {UNIT_KINDS.map((k) => <option key={k} value={k}>{UNIT_KIND_LABEL_FR[k]}</option>)}
          </select>
          <select value={unitParent} onChange={(e) => setUnitParent(e.target.value)}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm">
            <option value="">— Sans rattachement (racine) —</option>
            {units.filter((u) => u.is_active).map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({UNIT_KIND_LABEL_FR[u.unit_kind as UnitKind]})</option>
            ))}
          </select>
          <select value={unitDept} onChange={(e) => setUnitDept(e.target.value)}
            className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" title="Correspondance plateforme (optionnelle)">
            <option value="">— Sans correspondance plateforme —</option>
            {CANONICAL_DEPARTMENTS.map((d) => <option key={d.code} value={d.code}>{d.labelFr}</option>)}
          </select>
        </div>
        <button disabled={pending}
          onClick={() => run(() => createOrgUnit({
            name: unitName, unitKind, parentId: unitParent || null, canonicalDepartment: unitDept || null,
          }).then((r) => { if (r.ok) setUnitName(""); return r; }), "Unité créée.")}
          className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
          Ajouter l'unité
        </button>
        {units.length > 0 && (
          <ul className="divide-y divide-slate-100 text-sm">
            {units.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-2 py-1.5">
                <span className={u.is_active ? "text-navy-900" : "text-slate-400 line-through"}>
                  {u.name} <span className="text-xs text-slate-400">({UNIT_KIND_LABEL_FR[u.unit_kind as UnitKind]})</span>
                </span>
                <button disabled={pending} onClick={() => run(() => setOrgUnitActive(u.id, !u.is_active))}
                  className="text-xs text-teal-700 hover:underline">
                  {u.is_active ? "Désactiver" : "Réactiver"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Postes (intitulés de fonction)" subtitle="Un seul catalogue : le poste EST l'intitulé ; l'affectation par employé arrive en HR-2.">
        <div className="flex gap-2">
          <input value={positionTitle} onChange={(e) => setPositionTitle(e.target.value)} placeholder="Intitulé du poste"
            className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
          <button disabled={pending}
            onClick={() => run(() => createPosition({ title: positionTitle }).then((r) => { if (r.ok) setPositionTitle(""); return r; }), "Poste créé.")}
            className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
            Ajouter
          </button>
        </div>
        {positions.length > 0 && (
          <p className="text-xs text-slate-500">{positions.map((p) => p.title).join(" · ")}</p>
        )}
      </Panel>

      <Panel title="Sites de travail" subtitle="Le sens physique d'une « agence ». Le sens organisationnel est une unité Direction/Pôle.">
        <div className="flex gap-2">
          <input value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="Nom du site"
            className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
          <input value={locationCity} onChange={(e) => setLocationCity(e.target.value)} placeholder="Ville"
            className="w-40 rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
          <button disabled={pending}
            onClick={() => run(() => createWorkLocation({ name: locationName, city: locationCity }).then((r) => { if (r.ok) { setLocationName(""); setLocationCity(""); } return r; }), "Site créé.")}
            className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
            Ajouter
          </button>
        </div>
        {locations.length > 0 && (
          <p className="text-xs text-slate-500">{locations.map((l) => `${l.name}${l.city ? ` (${l.city})` : ""}`).join(" · ")}</p>
        )}
      </Panel>
    </div>
  );
}
