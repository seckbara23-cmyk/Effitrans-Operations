import { assertPlatformPermission } from "@/lib/platform/auth";

export const dynamic = "force-dynamic";

export default async function PlatformSettings() {
  await assertPlatformPermission("platform:settings:manage");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Paramètres</h1>
        <p className="mt-1 text-sm text-slate-400">Configuration de la plateforme.</p>
      </div>
      <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-10 text-center text-slate-400">
        La configuration de la plateforme (gestion des administrateurs, plans, intégrations) arrive dans une prochaine étape.
      </div>
    </div>
  );
}
