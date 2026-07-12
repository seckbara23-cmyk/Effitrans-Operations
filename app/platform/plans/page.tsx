import { assertPlatformPermission } from "@/lib/platform/auth";
import { PLAN_KEYS, defaultModulesForPlan } from "@/lib/platform/entitlements";

export const dynamic = "force-dynamic";

export default async function PlatformPlans() {
  await assertPlatformPermission("platform:plans:read");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Plans</h1>
        <p className="mt-1 text-sm text-slate-400">
          Modules activés par défaut selon le plan (l&apos;application des droits arrive en Phase 4.0D).
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {PLAN_KEYS.map((plan) => (
          <div key={plan} className="rounded-xl border border-white/10 bg-white/5 p-5">
            <p className="text-lg font-bold text-white">{plan}</p>
            <ul className="mt-3 space-y-1">
              {defaultModulesForPlan(plan).map((m) => (
                <li key={m} className="text-[14px] text-slate-300">
                  {m.replace("module.", "")}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
