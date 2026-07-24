"use client";
/**
 * Employee create form (Phase HR-1). Client component.
 * ---------------------------------------------------------------------------
 * Collapsible form on the registry page. Invokes the createEmployee server
 * action (permission-gated + audited server-side). Imports NO server-only code.
 * Collects the HR-1 registry minimum only — NO salary/national-ID/DOB/medical
 * fields exist to collect (DEC-B27).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEmployee, type CreateEmployeeInput } from "@/lib/hr/actions";
import { CANONICAL_DEPARTMENTS } from "@/lib/organization/departments";
import { EMPLOYMENT_TYPES } from "@/lib/hr/validate";

const input = "w-full rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-teal-400 focus:outline-none";
const label = "block text-xs font-medium text-slate-500";

export function EmployeeCreateForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<string[]>([]);
  const [form, setForm] = useState<CreateEmployeeInput>({ firstName: "", lastName: "", department: "OPERATIONS" });

  const set = (k: keyof CreateEmployeeInput, v: string) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    setErrors([]);
    startTransition(async () => {
      const res = await createEmployee(form);
      if (res.ok) {
        setOpen(false);
        setForm({ firstName: "", lastName: "", department: "OPERATIONS" });
        router.push(`/departments/hr/${res.id}`);
        router.refresh();
      } else {
        setErrors(res.messages?.length ? res.messages : ["La création a échoué."]);
      }
    });
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800">
        + Nouvel employé
      </button>
    );
  }

  return (
    <div className="surface space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-navy-900">Nouvel employé</h2>
        <button onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-slate-600">Annuler</button>
      </div>

      {errors.length > 0 && (
        <ul className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          {errors.map((e) => <li key={e}>• {e}</li>)}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div><label className={label}>Prénom *</label><input className={input} value={form.firstName} onChange={(e) => set("firstName", e.target.value)} /></div>
        <div><label className={label}>Nom *</label><input className={input} value={form.lastName} onChange={(e) => set("lastName", e.target.value)} /></div>
        <div><label className={label}>Nom d'usage</label><input className={input} value={form.preferredName ?? ""} onChange={(e) => set("preferredName", e.target.value)} /></div>
        <div>
          <label className={label}>Département *</label>
          <select className={input} value={form.department} onChange={(e) => set("department", e.target.value)}>
            {CANONICAL_DEPARTMENTS.map((d) => <option key={d.code} value={d.code}>{d.labelFr}</option>)}
          </select>
        </div>
        <div><label className={label}>Fonction</label><input className={input} value={form.jobTitle ?? ""} onChange={(e) => set("jobTitle", e.target.value)} /></div>
        <div>
          <label className={label}>Type de contrat</label>
          <select className={input} value={form.employmentType ?? ""} onChange={(e) => set("employmentType", e.target.value)}>
            <option value="">—</option>
            {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div><label className={label}>Lieu de travail</label><input className={input} value={form.workLocation ?? ""} onChange={(e) => set("workLocation", e.target.value)} /></div>
        <div><label className={label}>Date d'embauche</label><input type="date" className={input} value={form.hireDate ?? ""} onChange={(e) => set("hireDate", e.target.value)} /></div>
        <div><label className={label}>Fin de période d'essai</label><input type="date" className={input} value={form.probationEndDate ?? ""} onChange={(e) => set("probationEndDate", e.target.value)} /></div>
        <div><label className={label}>E-mail professionnel</label><input className={input} value={form.professionalEmail ?? ""} onChange={(e) => set("professionalEmail", e.target.value)} /></div>
        <div><label className={label}>E-mail personnel</label><input className={input} value={form.personalEmail ?? ""} onChange={(e) => set("personalEmail", e.target.value)} /></div>
        <div><label className={label}>Téléphone professionnel</label><input className={input} value={form.professionalPhone ?? ""} onChange={(e) => set("professionalPhone", e.target.value)} /></div>
        <div><label className={label}>Téléphone personnel</label><input className={input} value={form.personalPhone ?? ""} onChange={(e) => set("personalPhone", e.target.value)} /></div>
        <div><label className={label}>Contact d'urgence — nom</label><input className={input} value={form.emergencyContactName ?? ""} onChange={(e) => set("emergencyContactName", e.target.value)} /></div>
        <div><label className={label}>Contact d'urgence — téléphone</label><input className={input} value={form.emergencyContactPhone ?? ""} onChange={(e) => set("emergencyContactPhone", e.target.value)} /></div>
      </div>

      <button onClick={submit} disabled={pending} className="rounded-lg bg-teal-700 px-4 py-1.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-50">
        {pending ? "Création…" : "Créer l'employé"}
      </button>
    </div>
  );
}
