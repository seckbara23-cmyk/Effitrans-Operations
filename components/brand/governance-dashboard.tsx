"use client";

/**
 * Brand governance dashboard (DBC-6). CLIENT — administrators only.
 * ---------------------------------------------------------------------------
 * Shows every template's lifecycle state and lets an admin transition it
 * (DRAFT→APPROVED→PUBLISHED→RETIRED). Holds no authority; setTemplateLifecycle re-checks the
 * transition + brand readiness. PUBLISH is blocked when the brand is incomplete.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTemplateLifecycle } from "@/lib/brand/server/governance-actions";
import { LIFECYCLE_TRANSITIONS, LIFECYCLE_LABEL, type LifecycleState } from "@/lib/brand/governance/lifecycle";
import type { GovernanceRow } from "@/lib/brand/server/governance-service";

const TONE: Record<LifecycleState, string> = {
  DRAFT: "bg-slate-100 text-slate-600", APPROVED: "bg-blue-100 text-blue-700",
  PUBLISHED: "bg-emerald-100 text-emerald-700", RETIRED: "bg-amber-100 text-amber-700",
};
const CAT_LABEL: Record<string, string> = { SIGNATURE: "Signature", DOCUMENT: "Document", PRESENTATION: "Présentation", COMMUNICATION: "Communication", MARKETING_EMAIL: "E-mail marketing" };

export function GovernanceDashboard({ rows, ready, missing }: { rows: GovernanceRow[]; ready: boolean; missing: string[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  function transition(r: GovernanceRow, to: LifecycleState) {
    setMsg(null);
    start(async () => {
      const res = await setTemplateLifecycle(r.category, r.key, to);
      if (res.ok) { setMsg({ tone: "ok", text: `${r.label} → ${LIFECYCLE_LABEL[to]}.` }); router.refresh(); }
      else setMsg({ tone: "error", text: res.error === "brand_incomplete" ? `Publication bloquée : ${(res.missing ?? []).join(", ")}.` : res.error === "bad_transition" ? "Transition non autorisée." : "Échec." });
    });
  }

  return (
    <div className="space-y-4">
      {!ready && <div className="surface border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Marque incomplète : {missing.join(", ")}. La publication est bloquée tant que ces éléments manquent.</div>}
      {msg && <p aria-live="polite" className={`text-sm font-medium ${msg.tone === "ok" ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</p>}
      <section className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead className="text-left text-[12px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2 font-semibold">Modèle</th>
                <th className="px-4 py-2 font-semibold">Catégorie</th>
                <th className="px-4 py-2 font-semibold">État</th>
                <th className="px-4 py-2 font-semibold">Version</th>
                <th className="px-4 py-2 font-semibold">Mis à jour</th>
                <th className="px-4 py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={`${r.category}:${r.key}`}>
                  <td className="px-4 py-2 font-medium text-navy-900">{r.label}</td>
                  <td className="px-4 py-2 text-slate-500">{CAT_LABEL[r.category] ?? r.category}</td>
                  <td className="px-4 py-2"><span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${TONE[r.status]}`}>{LIFECYCLE_LABEL[r.status]}</span></td>
                  <td className="px-4 py-2 text-slate-500">v{r.version}</td>
                  <td className="px-4 py-2 text-slate-400">{r.updatedAt ? `${r.updatedAt.slice(0, 10)}${r.updatedBy ? ` · ${r.updatedBy}` : ""}` : "—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {LIFECYCLE_TRANSITIONS[r.status].map((to) => (
                        <button key={to} type="button" disabled={pending} onClick={() => transition(r, to)} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">
                          → {LIFECYCLE_LABEL[to]}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
