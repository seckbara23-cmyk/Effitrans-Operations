/**
 * HR-1 — Import staging workspace. Gate: hr:manage.
 * ---------------------------------------------------------------------------
 * The pipeline ends at READY (frozen scope): Upload → Stage → Mapping →
 * Validation → Preview → Maker-Checker → READY. Nothing here — or anywhere in
 * HR-1 — applies a batch to the real tables; activation waits behind HRQ-A4
 * among others, and the page says so instead of hiding it.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listImportBatches } from "@/lib/hr/organization";
import { HrImportStudio } from "@/components/hr/import-studio";

export const metadata: Metadata = { title: "Imports RH" };
export const dynamic = "force-dynamic";

export default async function HrImportsPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Ressources humaines" title="Imports" subtitle="Configuration requise." />
      </div>
    );
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:read")) notFound();
  if (!hasPermission(permissions, "hr:manage")) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Ressources humaines" title="Imports" subtitle="Préparation des données d'organisation." />
        <div className="surface p-6 text-sm text-slate-600">La préparation des imports requiert « hr:manage ».</div>
      </div>
    );
  }

  const batches = await listImportBatches(user.tenantId);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Ressources humaines"
        title="Imports — préparation"
        subtitle="Téléversement → préparation → correspondance → validation → visa à quatre yeux → PRÊT. L'application des lots n'est pas encore activée (HRQ-A4 en attente)."
      />
      <Link href="/departments/hr" className="inline-block text-sm text-teal-700 hover:underline">← Tableau de bord RH</Link>
      <HrImportStudio batches={batches} currentUserId={user.id} />
    </div>
  );
}
