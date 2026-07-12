import { notFound } from "next/navigation";
import { getCompany } from "@/lib/platform/companies";

export const dynamic = "force-dynamic";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
      <p className="text-[12px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-[15px] font-semibold text-white">{value}</p>
    </div>
  );
}

export default async function PlatformCompanyDetail({ params }: { params: { id: string } }) {
  const c = await getCompany(params.id);
  if (!c) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">{c.displayName}</h1>
        <p className="mt-1 text-sm text-slate-400">{c.slug ?? "—"}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Statut" value={c.lifecycleStatus} />
        <Field label="Profil" value={c.productProfile} />
        <Field label="Plan" value={c.planKey ?? "—"} />
        <Field label="Pays" value={c.country ?? "—"} />
        <Field label="Devise" value={c.currency} />
        <Field label="Fuseau" value={c.timezone} />
        <Field label="Utilisateurs" value={String(c.userCount)} />
        <Field label="Dossiers actifs" value={String(c.activeDossierCount)} />
        <Field label="Onboarding" value={c.onboardingStatus} />
        <Field label="Dernière connexion" value={c.lastTenantLoginAt ?? "—"} />
      </div>

      <div>
        <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-slate-400">Modules activés</p>
        <div className="flex flex-wrap gap-2">
          {c.enabledModules.length === 0 ? (
            <span className="text-sm text-slate-500">Aucun</span>
          ) : (
            c.enabledModules.map((m) => (
              <span key={m} className="rounded-full border border-teal-400/30 bg-teal-400/10 px-3 py-1 text-[13px] text-teal-200">
                {m.replace("module.", "")}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
