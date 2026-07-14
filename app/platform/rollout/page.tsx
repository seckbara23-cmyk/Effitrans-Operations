/**
 * Platform → Déploiement processus (Phase 5.0E-2A).
 * ---------------------------------------------------------------------------
 * Where a platform SUPER_ADMIN turns the official Effitrans process on for ONE
 * tenant, and — more importantly — turns it back off in one click.
 *
 * The page shows the DEPLOYMENT kill switch and the EFFECTIVE state per tenant,
 * not just the stored row. A row saying "on" while the kill switch is off is not
 * "on", and a console that showed it as such would be lying at exactly the moment
 * someone needed the truth.
 */
import type { Metadata } from "next";
import { assertPlatformPermission } from "@/lib/platform/auth";
import { getRolloutOverview } from "@/lib/platform/rollout-read";
import { RolloutControls } from "@/components/platform/rollout-controls";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Déploiement processus" };

function Pill({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
        on ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5 text-slate-500"
      }`}
    >
      {label}
    </span>
  );
}

export default async function PlatformRollout() {
  await assertPlatformPermission("platform:rollout:manage");

  const { killSwitch, rows, enabledCount } = await getRolloutOverview();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Déploiement processus</h1>
        <p className="mt-1 text-sm text-slate-400">
          Activation du processus officiel Effitrans, tenant par tenant. Un tenant sans ligne est
          désactivé.
        </p>
      </div>

      {/* The kill switch. Stated first, because it overrides everything below it. */}
      <div
        className={`rounded-xl border p-5 ${
          killSwitch.enabled ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-white">
              Interrupteur global {killSwitch.enabled ? "ACTIF" : "COUPÉ"}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {killSwitch.enabled
                ? "Le moteur est compilé et actif au niveau du déploiement. Seuls les tenants activés ci-dessous l'utilisent réellement."
                : "Le moteur est éteint pour TOUS les tenants, quelles que soient les cases cochées ci-dessous. Variable d'environnement EFFITRANS_PROCESS_ENGINE_ENABLED."}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Pill on={killSwitch.enabled} label="moteur" />
            <Pill on={killSwitch.workspaces} label="espaces" />
            <Pill on={killSwitch.physicalDeposit} label="dépôt" />
            <Pill on={killSwitch.collections} label="recouvrement" />
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          L&apos;interrupteur global ne nécessite aucun accès base de données : il fonctionne encore
          quand la base est précisément ce qui est en panne. Les activations par tenant, elles, ne
          nécessitent aucun redéploiement.
        </p>
      </div>

      <p className="text-sm text-slate-400">
        {enabledCount === 0
          ? "Aucun tenant n'exécute le processus officiel."
          : `${enabledCount} tenant(s) exécutent le processus officiel.`}
      </p>

      <div className="space-y-3">
        {rows.map((row) => (
          <RolloutControls key={row.tenantId} row={row} killSwitchOn={killSwitch.enabled} />
        ))}
        {rows.length === 0 && (
          <p className="rounded-xl border border-white/10 bg-white/5 p-6 text-center text-sm text-slate-400">
            Aucune entreprise.
          </p>
        )}
      </div>
    </div>
  );
}
