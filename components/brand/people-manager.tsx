"use client";

/**
 * Employee brand identity (DBC-1). CLIENT.
 * ---------------------------------------------------------------------------
 * Lists tenant users (name/email/role are authoritative elsewhere and READ-ONLY here) and
 * edits ONLY the Brand Center profile fields (title, phones, signature variant, public-card
 * opt-in). Gated updateWorkforceProfile re-validates. The public-card token is never shown;
 * no public route exists in DBC-1.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateWorkforceProfile, type WorkforceInput } from "@/lib/brand/server/actions";
import { SIGNATURE_VARIANTS } from "@/lib/brand/model";
import type { WorkforceView } from "@/lib/brand/server/service";

export function PeopleManager({ people }: { people: WorkforceView[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <section className="surface overflow-hidden">
      <header className="border-b border-slate-100 px-5 py-3.5 text-sm font-semibold text-navy-900">Collaborateurs ({people.length})</header>
      {people.length === 0 ? (
        <p className="p-5 text-sm text-slate-500">Aucun collaborateur.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {people.map((p) => (
            <div key={p.userId} className="p-4">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-navy-900">{p.name}</p>
                  <p className="truncate text-xs text-slate-500">{p.email}{p.roleSummary ? ` · ${p.roleSummary}` : ""}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Chip ok={Boolean(p.jobTitle)}>Fonction</Chip>
                  <Chip ok={p.hasPhone}>Tél.</Chip>
                  <Chip ok={p.hasPhoto}>Photo</Chip>
                </div>
                <button type="button" onClick={() => setOpenId(openId === p.userId ? null : p.userId)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
                  {openId === p.userId ? "Fermer" : "Modifier"}
                </button>
              </div>
              {openId === p.userId && <EditRow person={p} onDone={() => setOpenId(null)} />}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Chip({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${ok ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>{children}</span>;
}

function EditRow({ person, onDone }: { person: WorkforceView; onDone: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [d, setD] = useState<WorkforceInput>({ jobTitle: person.jobTitle ?? "", signatureVariant: person.signatureVariant, publicCardEnabled: person.publicCardEnabled });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof WorkforceInput, v: string | boolean) => { setErr(null); setD((p) => ({ ...p, [k]: v })); };

  function save() {
    start(async () => {
      const res = await updateWorkforceProfile(person.userId, d);
      if (res.ok) { router.refresh(); onDone(); }
      else setErr(res.error === "invalid_phone" ? "Téléphone invalide." : res.error === "invalid_text" ? "Texte invalide." : "Échec.");
    });
  }

  return (
    <div className="mt-3 grid grid-cols-1 gap-3 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
      <Fld label="Fonction (titre professionnel)"><input value={d.jobTitle ?? ""} onChange={(e) => set("jobTitle", e.target.value)} className={inp} placeholder="Managing Director | CEO" /></Fld>
      <Fld label="Variante de signature"><select value={d.signatureVariant} onChange={(e) => set("signatureVariant", e.target.value)} className={inp}>{SIGNATURE_VARIANTS.map((v) => <option key={v} value={v}>{v}</option>)}</select></Fld>
      <Fld label="Téléphone bureau"><input value={d.phoneOffice ?? ""} onChange={(e) => set("phoneOffice", e.target.value)} className={inp} placeholder="+221 33 867 02 67" /></Fld>
      <Fld label="Mobile"><input value={d.phoneMobile ?? ""} onChange={(e) => set("phoneMobile", e.target.value)} className={inp} placeholder="+221 76 356 58 59" /></Fld>
      <Fld label="WhatsApp"><input value={d.whatsapp ?? ""} onChange={(e) => set("whatsapp", e.target.value)} className={inp} /></Fld>
      <label className="flex items-center gap-2 self-end text-sm text-slate-700">
        <input type="checkbox" checked={Boolean(d.publicCardEnabled)} onChange={(e) => set("publicCardEnabled", e.target.checked)} />
        Carte numérique publique (activée en DBC-3)
      </label>
      <div className="col-span-full flex items-center justify-end gap-3">
        {err && <p aria-live="polite" className="text-sm text-red-600">{err}</p>}
        <button type="button" onClick={save} disabled={pending} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-40">{pending ? "…" : "Enregistrer"}</button>
      </div>
    </div>
  );
}

const inp = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none";
function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>{children}</label>;
}
