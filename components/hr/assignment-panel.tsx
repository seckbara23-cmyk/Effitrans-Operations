"use client";

/**
 * HR-2 — the Affectation panel: current placement, append-and-close change
 * form (hr:manage only), and the full history. History rows are read-only —
 * there is no edit or delete control, by design.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setEmployeeAssignment, type AssignmentChangeKind } from "@/lib/hr/assignment-actions";
import { UNIT_KIND_LABEL_FR, type HrOrgUnit, type UnitKind } from "@/lib/hr/org-tree";
import type { Database } from "@/lib/db/types";

type Tbl = Database["public"]["Tables"];
type Assignment = Tbl["employee_assignment"]["Row"];
type Position = Tbl["hr_position"]["Row"];
type Location = Tbl["hr_work_location"]["Row"];

const CHANGE_KINDS: { value: AssignmentChangeKind; label: string }[] = [
  { value: "PROMOTION", label: "Promotion" },
  { value: "TRANSFER", label: "Mutation / Transfert" },
  { value: "CHANGE", label: "Changement" },
];

const ERR: Record<string, string> = {
  forbidden: "Action non autorisée (hr:manage requis).",
  own_manager: "Un employé ne peut pas être son propre responsable.",
  invalid_kind: "Motif invalide.",
  not_found: "Employé introuvable.",
  employee_archived: "Employé archivé — restaurez-le d'abord.",
  event_failed: "L'événement de journal n'a pas pu être écrit — l'affectation a été annulée.",
  save_failed: "Échec de l'enregistrement.",
  // HR-A2 — server-side target validation (tenant + active); the selects only
  // OFFER legitimate targets, but the server is the authority.
  invalid_unit: "L'unité indiquée est introuvable.",
  inactive_unit: "L'unité indiquée est désactivée — réactivez-la ou choisissez-en une autre.",
  invalid_position: "Le poste indiqué est introuvable.",
  inactive_position: "Le poste indiqué est désactivé.",
  invalid_location: "Le site indiqué est introuvable.",
  inactive_location: "Le site indiqué est désactivé.",
  invalid_manager: "Le responsable indiqué est introuvable.",
};

export function AssignmentPanel({
  employeeId,
  assignments,
  units,
  positions,
  locations,
  managers,
  canManage,
}: {
  employeeId: string;
  assignments: Assignment[];
  units: HrOrgUnit[];
  positions: Position[];
  locations: Location[];
  managers: { id: string; label: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const current = assignments.find((a) => a.effective_to === null) ?? null;

  const [unitId, setUnitId] = useState(current?.org_unit_id ?? "");
  const [positionId, setPositionId] = useState(current?.position_id ?? "");
  const [locationId, setLocationId] = useState(current?.work_location_id ?? "");
  const [managerId, setManagerId] = useState(current?.manager_employee_id ?? "");
  const [changeKind, setChangeKind] = useState<AssignmentChangeKind>("CHANGE");
  const [note, setNote] = useState("");

  const name = (list: { id: string }[], id: string | null, pick: (x: never) => string) => {
    const hit = list.find((x) => x.id === id);
    return hit ? pick(hit as never) : "—";
  };

  const describe = (a: Assignment) =>
    `${name(units, a.org_unit_id, (u: HrOrgUnit) => u.name)} · ${name(positions, a.position_id, (p: Position) => p.title)} · ${name(locations, a.work_location_id, (l: Location) => l.name)}`;

  return (
    <section className="surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-navy-900">Affectation</h2>

      {current ? (
        <p className="text-sm text-slate-700">
          Depuis le <span className="tabular">{current.effective_from}</span> : {describe(current)}
          {current.manager_employee_id && (
            <span className="text-slate-500"> · Responsable : {managers.find((m) => m.id === current.manager_employee_id)?.label ?? "—"}</span>
          )}
        </p>
      ) : (
        <p className="text-sm text-slate-500">Aucune affectation enregistrée.</p>
      )}

      {canManage && (
        <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
          {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700" role="alert">{error}</p>}
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Unité">
              <option value="">— Unité —</option>
              {units.filter((u) => u.is_active).map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({UNIT_KIND_LABEL_FR[u.unit_kind as UnitKind]})</option>
              ))}
            </select>
            <select value={positionId} onChange={(e) => setPositionId(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Poste">
              <option value="">— Poste —</option>
              {positions.filter((p) => p.is_active).map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Site">
              <option value="">— Site —</option>
              {locations.filter((l) => l.is_active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <select value={managerId} onChange={(e) => setManagerId(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Responsable">
              <option value="">— Responsable —</option>
              {managers.filter((m) => m.id !== employeeId).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <select value={changeKind} onChange={(e) => setChangeKind(e.target.value as AssignmentChangeKind)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Motif">
              {CHANGE_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optionnelle)"
              className="flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <button
              disabled={pending}
              onClick={() => {
                setError(null);
                start(async () => {
                  const res = await setEmployeeAssignment(employeeId, {
                    orgUnitId: unitId || null,
                    positionId: positionId || null,
                    workLocationId: locationId || null,
                    managerEmployeeId: managerId || null,
                    changeKind,
                    note,
                  });
                  if (!res.ok) setError(ERR[res.error] ?? ERR.save_failed);
                  else { setNote(""); router.refresh(); }
                });
              }}
              className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
            >
              Enregistrer l'affectation
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Chaque enregistrement clôt l'affectation précédente et en ouvre une nouvelle — l'historique n'est jamais modifié.
          </p>
        </div>
      )}

      {assignments.filter((a) => a.effective_to !== null).length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Historique</p>
          <ul className="space-y-1 text-sm text-slate-600">
            {assignments.filter((a) => a.effective_to !== null).map((a) => (
              <li key={a.id}>
                <span className="tabular text-xs text-slate-400">{a.effective_from} → {a.effective_to}</span>{" "}
                {describe(a)}
                {a.note && <span className="text-xs text-slate-400"> — {a.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
