/**
 * Paramètres — deliberately not a formula builder.
 *
 * The coefficients below are the ratified methodology, and they are READ-ONLY
 * for a reason that is not caution: §17.2 forbids retroactive recomputation, and
 * the platform has no parameter version pinning yet. An editable coefficient
 * today would silently rewrite every past month the moment someone changed it —
 * the exact failure the Excel workbook has and the platform was meant to end.
 *
 * So this tab shows what governs the calculations and states plainly why nothing
 * here is editable. When pinning exists, editability becomes a safe question;
 * until then it is not a missing feature, it is a refused one.
 */
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { CDP_COEFFICIENTS, DECLARATION_TYPES } from "@/lib/performance/declaration-type";
import { UD, UF, UA, CCT_COEFFICIENTS, DPI_UNITS, TE_UNIT, COT_UNIT } from "@/lib/performance/ictd";
import { MIN_DOSSIERS } from "@/lib/performance/reliability";

export const metadata: Metadata = { title: "Paramètres" };
export const dynamic = "force-dynamic";

const fr = (n: number) => n.toFixed(2).replace(".", ",");

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5 text-xs last:border-0">
      <span className="text-slate-600">{label}</span>
      <span className="font-mono text-navy-900">{value}</span>
    </div>
  );
}

export default async function SettingsPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  const canManage = hasPermission(permissions, "performance:manage");

  return (
    <div className="space-y-6">
      <PageHeader
        meta="Gestion de la Performance"
        title="Paramètres"
        subtitle="Coefficients et seuils de la méthode ratifiée."
      />

      <div className="surface border-l-4 border-amber-400 p-5">
        <p className="text-sm font-medium text-navy-900">Paramètres non modifiables</p>
        <p className="mt-2 text-xs text-slate-600">
          La note de méthode interdit de recalculer l&apos;historique avec des valeurs futures. La
          plateforme ne sait pas encore épingler une version de paramètres à une période close :
          modifier un coefficient réécrirait donc silencieusement tous les mois déjà publiés. Tant
          que cet ancrage n&apos;existe pas, ces valeurs restent en lecture seule —{" "}
          {canManage
            ? "y compris pour vous, qui portez pourtant performance:manage."
            : "pour tout le monde."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="surface p-5">
          <h2 className="text-sm font-semibold text-navy-900">Unités de base (ICTD)</h2>
          <div className="mt-3">
            <Row label="UD — unité dossier" value={fr(UD)} />
            <Row label="UF — par facture fournisseur" value={fr(UF)} />
            <Row label="UA — par position SH" value={fr(UA)} />
            <Row label="U_COT — par cotation" value={fr(COT_UNIT)} />
            <Row label="U_TE — titre d'exonération (EFFITRANS)" value={fr(TE_UNIT)} />
          </div>
        </div>

        <div className="surface p-5">
          <h2 className="text-sm font-semibold text-navy-900">CDP — type de déclaration</h2>
          <div className="mt-3">
            {DECLARATION_TYPES.map((t) => (
              <Row key={t} label={t} value={fr(CDP_COEFFICIENTS[t])} />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Quatre types. « DPE » n&apos;en est pas un.
          </p>
        </div>

        <div className="surface p-5">
          <h2 className="text-sm font-semibold text-navy-900">CCT — classement tarifaire</h2>
          <div className="mt-3">
            <Row label="CLIENT" value={fr(CCT_COEFFICIENTS.CLIENT)} />
            <Row label="EFFITRANS" value={fr(CCT_COEFFICIENTS.EFFITRANS)} />
          </div>
        </div>

        <div className="surface p-5">
          <h2 className="text-sm font-semibold text-navy-900">U_DPI — prise en charge DPI</h2>
          <div className="mt-3">
            {(Object.keys(DPI_UNITS) as (keyof typeof DPI_UNITS)[]).map((k) => (
              <Row key={k} label={k} value={fr(DPI_UNITS[k])} />
            ))}
          </div>
        </div>
      </div>

      <div className="surface p-5">
        <h2 className="text-sm font-semibold text-navy-900">Fiabilité</h2>
        <div className="mt-3">
          <Row label="Volume minimum avant classement" value={`${MIN_DOSSIERS} dossiers`} />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Le seuil de couverture de 80 % du classeur a été retiré : il servait à pousser les agents
          à remplir toutes les cellules, ce que la plateforme fait désormais elle-même. Le seuil de
          volume, lui, reste — il parle de fiabilité d&apos;interprétation, pas de saisie.
        </p>
      </div>
    </div>
  );
}
