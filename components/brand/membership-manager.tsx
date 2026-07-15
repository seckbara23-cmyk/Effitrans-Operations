"use client";

/**
 * International memberships (DBC-1). CLIENT.
 * ---------------------------------------------------------------------------
 * Manage the tenant's network memberships (WCA/FIATA/…). No IDs/dates/logos are invented —
 * only what the operator enters. Retire sets status inactive (excluded from future
 * generators). Gated createMembership/updateMembership/retireMembership re-validate server-side.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMembership, retireMembership, type MembershipInput } from "@/lib/brand/server/actions";
import type { MembershipView } from "@/lib/brand/server/service";

const ERR_FR: Record<string, string> = {
  invalid_name: "Nom requis (sans chevrons).", invalid_https_url: "URL invalide (https requis).",
  invalid_status: "Statut invalide.", invalid_text: "Texte invalide.", forbidden: "Non autorisé.", write_failed: "Échec.",
};
const empty: MembershipInput = { organizationName: "", membershipId: "", officialUrl: "", status: "active", displayOrder: 0 };

export function MembershipManager({ memberships }: { memberships: MembershipView[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState<MembershipInput>(empty);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; msg: string } | null>(null);

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.organizationName.trim()) { setStatus({ tone: "error", msg: ERR_FR.invalid_name }); return; }
    setStatus(null);
    start(async () => {
      const res = await createMembership(form);
      if (res.ok) { setStatus({ tone: "ok", msg: "Adhésion ajoutée." }); setForm(empty); router.refresh(); }
      else setStatus({ tone: "error", msg: ERR_FR[res.error] ?? "Échec." });
    });
  }
  function retire(id: string) {
    start(async () => { const r = await retireMembership(id); if (r.ok) router.refresh(); });
  }
  const set = (k: keyof MembershipInput, v: string | number) => { setStatus(null); setForm((p) => ({ ...p, [k]: v })); };

  return (
    <div className="space-y-6">
      <form onSubmit={add} className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Ajouter une adhésion</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Inp label="Réseau / organisation" v={form.organizationName} on={(v) => set("organizationName", v)} placeholder="WCA First" />
          <Inp label="Numéro d'adhésion" v={form.membershipId ?? ""} on={(v) => set("membershipId", v)} placeholder="93972" />
          <Inp label="URL officielle (https)" v={form.officialUrl ?? ""} on={(v) => set("officialUrl", v)} />
          <Inp label="Valide à partir de" type="date" v={form.validFrom ?? ""} on={(v) => set("validFrom", v)} />
          <Inp label="Expire le" type="date" v={form.expiresAt ?? ""} on={(v) => set("expiresAt", v)} />
          <Inp label="Ordre d'affichage" type="number" v={String(form.displayOrder ?? 0)} on={(v) => set("displayOrder", Number(v) || 0)} />
        </div>
        <div className="mt-3 flex items-center justify-end gap-3">
          {status && <p aria-live="polite" className={`text-sm ${status.tone === "ok" ? "text-emerald-600" : "text-red-600"}`}>{status.msg}</p>}
          <button type="submit" disabled={pending} className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-40">{pending ? "…" : "Ajouter"}</button>
        </div>
      </form>

      <section className="surface overflow-hidden">
        <header className="border-b border-slate-100 px-5 py-3.5 text-sm font-semibold text-navy-900">Adhésions ({memberships.length})</header>
        {memberships.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">Aucune adhésion enregistrée.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {memberships.map((m) => (
              <div key={m.id} className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-navy-900">{m.organizationName} {m.membershipId && <span className="text-xs text-slate-400">#{m.membershipId}</span>}</p>
                  <p className="text-xs text-slate-500">{m.status === "active" ? "Active" : "Inactive"}{m.expiresAt ? ` · expire ${m.expiresAt}` : ""}</p>
                </div>
                {m.status === "active" && (
                  <button type="button" onClick={() => retire(m.id)} disabled={pending} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">Désactiver</button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Inp({ label, v, on, type = "text", placeholder }: { label: string; v: string; on: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input type={type} value={v} onChange={(e) => on(e.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-teal-500 focus:outline-none" />
    </label>
  );
}
