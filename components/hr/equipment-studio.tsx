"use client";

/**
 * HR-4 — Equipment workspace (client). Assignment and return go through the
 * transactional RPCs; "one active custodian" is a database invariant, so the
 * refusal here only names what the database already guarantees.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEquipment, assignEquipment, returnEquipment } from "@/lib/hr/onboarding-actions";
import type { Database } from "@/lib/db/types";

type Tbl = Database["public"]["Tables"];
type Equipment = Tbl["hr_equipment"]["Row"];
type EqType = Tbl["hr_equipment_type"]["Row"];
type Custody = Tbl["hr_equipment_assignment"]["Row"];

const LIFECYCLE_FR: Record<string, string> = {
  IN_STOCK: "En stock", ASSIGNED: "Attribué", IN_REPAIR: "En réparation", RETIRED: "Retiré", LOST: "Perdu",
};
const OUTCOMES: [string, string][] = [
  ["RETURNED", "Restitué"], ["DAMAGED", "Restitué endommagé"], ["LOST", "Perdu"], ["NOT_RETURNED", "Non restitué"],
];
const ERR: Record<string, string> = {
  forbidden: "Action non autorisée (hr:manage requis).",
  equipment_not_found: "Équipement introuvable.",
  employee_not_found: "Employé introuvable.",
  already_assigned: "Cet équipement est déjà attribué à quelqu'un — restituez-le d'abord.",
  assignment_not_found: "Attribution active introuvable.",
  invalid_outcome: "Issue de restitution invalide.",
  asset_tag_required: "L'identifiant d'inventaire est obligatoire.",
  asset_tag_taken: "Cet identifiant d'inventaire existe déjà.",
  save_failed: "Échec de l'enregistrement.",
};

export function EquipmentStudio({
  equipment, types, openCustody, employees, canManage,
}: {
  equipment: Equipment[]; types: EqType[]; openCustody: Custody[];
  employees: { id: string; label: string }[]; canManage: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [typeId, setTypeId] = useState("");
  const [tag, setTag] = useState("");
  const [serial, setSerial] = useState("");
  const [assignTo, setAssignTo] = useState<Record<string, string>>({});

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(ERR[res.error ?? ""] ?? ERR.save_failed);
      else router.refresh();
    });
  };

  const custodyOf = (equipmentId: string) => openCustody.find((c) => c.equipment_id === equipmentId) ?? null;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      {canManage && (
        <section className="surface space-y-3 p-5">
          <h2 className="text-sm font-semibold text-navy-900">Nouvel équipement</h2>
          <div className="grid gap-2 sm:grid-cols-4">
            <select value={typeId} onChange={(e) => setTypeId(e.target.value)}
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" aria-label="Type d'équipement">
              <option value="">— Type —</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.label_fr}</option>)}
            </select>
            <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Identifiant d'inventaire"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <input value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="N° de série (optionnel)"
              className="rounded-md border border-slate-200 px-2 py-1.5 text-sm" />
            <button disabled={pending || !typeId || !tag}
              onClick={() => run(() => createEquipment({ equipmentTypeId: typeId, assetTag: tag, serialNumber: serial })
                .then((r) => { if (r.ok) { setTag(""); setSerial(""); } return r; }))}
              className="rounded-lg bg-navy-900 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
              Ajouter
            </button>
          </div>
        </section>
      )}

      <section className="surface p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy-900">Parc</h2>
        {equipment.length === 0 ? <p className="text-sm text-slate-500">Aucun équipement enregistré.</p> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {equipment.map((e) => {
              const c = custodyOf(e.id);
              const overdue = c?.expected_return_date && c.expected_return_date < today;
              return (
                <li key={e.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-mono text-xs text-teal-700">{e.asset_tag}</span>
                  <span className="text-navy-900">{types.find((t) => t.id === e.equipment_type_id)?.label_fr ?? "—"}</span>
                  {e.serial_number && <span className="text-xs text-slate-400">SN {e.serial_number}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    e.lifecycle_status === "ASSIGNED" ? "bg-amber-50 text-amber-800"
                    : e.lifecycle_status === "LOST" ? "bg-red-50 text-red-700"
                    : "bg-slate-100 text-slate-600"}`}>{LIFECYCLE_FR[e.lifecycle_status] ?? e.lifecycle_status}</span>

                  {c ? (
                    <>
                      <span className="text-xs text-slate-500">
                        → {employees.find((x) => x.id === c.employee_id)?.label ?? c.employee_id}
                        {c.expected_return_date && <span className={overdue ? " text-red-600" : ""}> (retour {c.expected_return_date})</span>}
                      </span>
                      {canManage && OUTCOMES.map(([code, label]) => (
                        <button key={code} disabled={pending}
                          onClick={() => run(() => returnEquipment({ assignmentId: c.id, outcome: code as "RETURNED" }))}
                          className="text-[11px] text-teal-700 hover:underline">{label}</button>
                      ))}
                    </>
                  ) : canManage && e.is_active && e.lifecycle_status === "IN_STOCK" ? (
                    <>
                      <select value={assignTo[e.id] ?? ""} onChange={(ev) => setAssignTo({ ...assignTo, [e.id]: ev.target.value })}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs" aria-label="Attribuer à">
                        <option value="">— Attribuer à —</option>
                        {employees.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                      </select>
                      <button disabled={pending || !assignTo[e.id]}
                        onClick={() => run(() => assignEquipment({ equipmentId: e.id, employeeId: assignTo[e.id] }))}
                        className="text-xs text-teal-700 hover:underline disabled:opacity-40">Attribuer</button>
                    </>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
