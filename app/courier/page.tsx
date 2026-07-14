/**
 * Courier workspace (Phase 5.0D-3, Deliverable 12) — MOBILE-FIRST.
 * ---------------------------------------------------------------------------
 * A courier sees ONLY the deposits assigned to them. That is enforced three
 * times: by the RLS policy (courier_user_id = auth.uid()), by the read model's
 * courier scope, and by every server action's assignment check.
 *
 * They see the package reference, the client, the authorized destination and the
 * instructions they need to deliver — and nothing else. No invoice approval
 * history, no finance data, no other courier's work, no collection notes.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { globalKillSwitch, getTenantProcessFlags } from "@/lib/process/rollout-server";
import { listCourierDeposits } from "@/lib/deposit/service";
import { CourierMissionCard } from "@/components/deposit/courier-mission-card";
import type { CourierSection } from "@/lib/deposit/status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Mes dépôts" };

const SECTIONS: { key: CourierSection; label: string; hint: string }[] = [
  { key: "awaiting_acceptance", label: "À accepter", hint: "Acceptez la mission avant de partir." },
  { key: "ready_to_depart", label: "Prêt à partir", hint: "Mission acceptée." },
  { key: "in_progress", label: "En cours", hint: "En route vers le client." },
  { key: "deposit_details_required", label: "Destinataire à saisir", hint: "Nom du destinataire obligatoire." },
  { key: "proof_upload_required", label: "Preuve à téléverser", hint: "Photo ou PDF du reçu." },
  { key: "proof_rejected", label: "Preuve rejetée", hint: "À corriger et resoumettre." },
  { key: "proof_under_review", label: "Preuve en contrôle", hint: "En attente de l'Administration." },
  { key: "completed", label: "Terminé", hint: "" },
];

export default async function CourierPage() {
  if (!globalKillSwitch().enabled) notFound();

  const user = await requireUser();
  const flags = await getTenantProcessFlags(user.tenantId);
  if (!flags.physicalDeposit) notFound();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "courier:deposit")) notFound();

  const missions = await listCourierDeposits(user.tenantId, permissions, user.id);

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <header>
        <h1 className="text-lg font-semibold text-navy-900">Mes dépôts</h1>
        <p className="text-sm text-slate-600">
          {missions.length} mission(s) de dépôt physique qui vous sont affectées.
        </p>
      </header>

      {missions.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Aucune mission de dépôt ne vous est affectée.
        </div>
      )}

      {SECTIONS.map((s) => {
        const rows = missions.filter((m) => m.courierSection === s.key);
        if (rows.length === 0) return null;
        return (
          <section key={s.key}>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-navy-900">{s.label}</h2>
              <span className="text-xs text-slate-400">{rows.length}</span>
            </div>
            {s.hint && <p className="mb-2 text-xs text-slate-500">{s.hint}</p>}
            <div className="space-y-3">
              {rows.map((m) => (
                <CourierMissionCard key={m.id} mission={m} />
              ))}
            </div>
          </section>
        );
      })}
    </main>
  );
}
