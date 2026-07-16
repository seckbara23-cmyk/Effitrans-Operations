import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getDeclarationDetail } from "@/lib/customs/intelligence/service";
import { declarationLabel } from "@/lib/customs/intelligence/state-machine";
import { DeclarationActions } from "@/components/customs/intelligence/declaration-actions";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: "Déclaration — Intelligence douanière" };
export const dynamic = "force-dynamic";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1">
      <dt className="text-slate-500">{label}</dt>
      <dd className="tabular text-right font-medium text-navy-800">{value}</dd>
    </div>
  );
}

export default async function DeclarationDetailPage({ params }: { params: { declarationId: string } }) {
  const header = <PageHeader meta="Douane · Intelligence" title="Déclaration" subtitle="Cycle de vie canonique, journal immuable et fournisseur." />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<div className="surface p-6 text-sm text-slate-600">Configuration requise.</div></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "customs:read")) notFound();

  const detail = await getDeclarationDetail(params.declarationId);
  if (!detail) notFound();

  const { view, timeline, fileNumber, clientName, providerConfig, nextStatuses } = detail;
  const d = view.declaration;
  const canUpdate = hasPermission(permissions, "customs:update");
  const canRelease = hasPermission(permissions, "customs:release");
  const refreshEnabled = providerConfig.status === "configured" && providerConfig.providerCode !== "manual";
  const refreshHint =
    providerConfig.providerCode === "GAINDE"
      ? "GAINDE n'est pas connecté (intégration par référence)."
      : "Aucun fournisseur externe à interroger pour le moment.";

  return (
    <div className="animate-fade-in space-y-5">
      {header}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/customs/intelligence" className="text-teal-700 hover:underline">← Intelligence douanière</Link>
        {fileNumber && (
          <>
            <span className="text-slate-300">·</span>
            <Link href={`/files/${d.fileId}`} className="text-navy-700 hover:text-teal-700">Dossier {fileNumber}</Link>
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Summary */}
        <div className="surface p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-navy-50 px-2.5 py-0.5 text-xs font-medium text-navy-700">{declarationLabel(d.status)}</span>
            <span className="text-xs text-slate-500">Statut opérationnel : {t.customs.statuses[view.meta.operationalStatus]}</span>
            <span className="ml-auto text-xs text-slate-400">v{view.meta.version}</span>
          </div>
          <dl className="grid grid-cols-1 gap-x-8 text-sm sm:grid-cols-2">
            <Row label="Référence" value={d.reference ?? "—"} />
            <Row label="Fournisseur" value={d.provider.provider === "manual" ? "Manuel" : d.provider.provider} />
            <Row label="Réf. fournisseur" value={d.provider.externalReference ?? "—"} />
            <Row label="Bureau de douane" value={d.office?.code ?? "—"} />
            <Row label="Régime" value={d.regime ?? "—"} />
            <Row label="Client" value={clientName ?? "—"} />
            <Row label="Soumise le" value={d.provider.submittedAt?.slice(0, 10) ?? "—"} />
            <Row label="Mainlevée le" value={d.release?.releasedAt?.slice(0, 10) ?? "—"} />
          </dl>
        </div>

        <DeclarationActions
          id={d.id}
          version={view.meta.version}
          nextStatuses={nextStatuses}
          canUpdate={canUpdate}
          canRelease={canRelease}
          refreshEnabled={refreshEnabled}
          refreshHint={refreshHint}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Timeline */}
        <div className="surface p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-navy-900">Journal (immuable)</h2>
          {timeline.length === 0 ? (
            <p className="text-xs text-slate-500">Aucun évènement de cycle de vie enregistré.</p>
          ) : (
            <ol className="space-y-2">
              {timeline.map((e, i) => (
                <li key={`${e.occurredAt}-${i}`} className="flex items-start gap-3 text-sm">
                  <span className="tabular mt-0.5 w-28 shrink-0 text-xs text-slate-400">{e.occurredAt.slice(0, 16).replace("T", " ")}</span>
                  <span className="flex-1">
                    <span className="font-medium text-navy-800">{declarationLabel(e.status)}</span>
                    <span className="ml-2 text-xs text-slate-500">
                      {e.provider === "manual" ? "Manuel" : e.provider}
                      {e.actor ? ` · ${e.actor}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* Inspection + Duties + Provider */}
        <div className="space-y-4">
          <div className="surface p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">Inspection</h2>
            <Row label="Statut" value={d.inspection.status} />
            <Row label="Requise" value={d.inspection.required ? "Oui" : "Non"} />
          </div>

          <div className="surface p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">Droits & paiements</h2>
            {d.duties.length === 0 && d.payments.length === 0 ? (
              <p className="text-xs text-slate-500">Aucune donnée de droits/paiements enregistrée.</p>
            ) : (
              <>
                {d.duties.map((x, i) => <Row key={`d${i}`} label={x.label} value={`${x.amount} ${x.currency}`} />)}
                {d.payments.map((x, i) => <Row key={`p${i}`} label={`Paiement (${x.status})`} value={`${x.amount} ${x.currency}`} />)}
              </>
            )}
          </div>

          <div className="surface p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold text-navy-900">Fournisseur</h2>
            <Row label="Fournisseur" value={providerConfig.providerCode === "manual" ? "Manuel" : providerConfig.providerCode} />
            <Row label="État" value={providerConfig.status === "configured" ? "Actif" : providerConfig.status === "unsupported" ? "Non connecté" : providerConfig.status} />
            <Row label="Dernière synchro" value={view.meta.providerSyncedAt?.slice(0, 16).replace("T", " ") ?? "—"} />
            {view.meta.providerError && <Row label="Dernière erreur" value={view.meta.providerError} />}
            {providerConfig.providerCode === "GAINDE" && providerConfig.requiredInputs.length > 0 && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                <p className="mb-1 font-semibold">Connexion GAINDE bloquée — prérequis officiels :</p>
                <ul className="list-inside list-disc space-y-0.5">
                  {providerConfig.requiredInputs.slice(0, 6).map((r) => <li key={r}>{r}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
