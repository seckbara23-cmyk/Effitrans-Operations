/**
 * Administration deposit workspace (Phase 5.0D-3, Deliverable 13).
 * ---------------------------------------------------------------------------
 * The whole physical-deposit chain in one bounded read — no N+1. Sections mirror
 * the official custody sequence, and every row shows the immutable custody
 * timeline rather than inferring history from the current status.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getProcessFlags } from "@/lib/process/config";
import { listTenantDeposits, type DepositView } from "@/lib/deposit/service";
import { DepositRow } from "@/components/deposit/deposit-row";
import type { DepositStatus } from "@/lib/deposit/status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dépôts physiques" };

const SECTIONS: { label: string; statuses: DepositStatus[]; hint: string }[] = [
  { label: "Plis à préparer", statuses: ["PREPARATION_PENDING"], hint: "Facture reçue de la Facturation." },
  { label: "Coursier à affecter", statuses: ["READY_FOR_COURIER"], hint: "Pli prêt — ou retourné après un échec/refus." },
  { label: "Affectés / en cours", statuses: ["ASSIGNED", "IN_TRANSIT"], hint: "Le coursier doit accepter puis partir." },
  { label: "Dépôts sans preuve", statuses: ["DEPOSITED"], hint: "Déposé — preuve pas encore transmise." },
  { label: "Preuves à contrôler", statuses: ["PROOF_SUBMITTED"], hint: "Contrôle Administration requis." },
  { label: "Preuves rejetées", statuses: ["PROOF_REJECTED"], hint: "Correction attendue du coursier." },
  { label: "À remettre au recouvrement", statuses: ["PROOF_ACCEPTED"], hint: "Preuve validée." },
  { label: "Remis au recouvrement", statuses: ["HANDED_TO_COLLECTIONS"], hint: "" },
];

export default async function DepositsPage() {
  const flags = getProcessFlags();
  if (!flags.enabled || !flags.physicalDeposit) notFound();

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  const canAdmin = hasPermission(permissions, "admin_service:manage");
  if (!canAdmin && !hasPermission(permissions, "collections:manage")) notFound();

  const deposits: DepositView[] = await listTenantDeposits(user.tenantId, permissions);

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold text-navy-900">Dépôts physiques de factures</h1>
        <p className="text-sm text-slate-600">
          Étapes officielles 22 à 25 · {deposits.length} circuit(s) actif(s) · chaîne de traçabilité complète
        </p>
      </header>

      {deposits.length === 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          Aucun dépôt physique en cours. Un circuit démarre lorsque la Facturation remet une facture
          envoyée à l&apos;Administration, pour un client explicitement configuré.
        </div>
      )}

      {SECTIONS.map((s) => {
        const rows = deposits.filter((d) => s.statuses.includes(d.status));
        if (rows.length === 0) return null;
        return (
          <section key={s.label}>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-navy-900">{s.label}</h2>
              <span className="text-xs text-slate-400">{rows.length}</span>
            </div>
            {s.hint && <p className="mb-2 text-xs text-slate-500">{s.hint}</p>}
            <div className="space-y-2">
              {rows.map((d) => (
                <DepositRow key={d.id} deposit={d} canAdmin={canAdmin} />
              ))}
            </div>
          </section>
        );
      })}

      <p className="text-xs text-slate-400">
        L&apos;archivage n&apos;est pas la clôture : un dossier archivé reste accessible au recouvrement.{" "}
        <Link href="/my-work" className="text-blue-600 hover:underline">
          Mon travail
        </Link>
      </p>
    </main>
  );
}
