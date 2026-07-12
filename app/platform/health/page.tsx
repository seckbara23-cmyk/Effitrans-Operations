import { listCompanies } from "@/lib/platform/companies";

export const dynamic = "force-dynamic";

export default async function PlatformHealth() {
  const companies = await listCompanies();
  const complete = companies.filter((c) => c.onboardingStatus === "complete").length;
  const provisioning = companies.length - complete;
  const brandingIncomplete = companies.filter((c) => !c.brandingComplete).length;

  const rows = [
    { label: "Onboarding terminé", value: complete },
    { label: "En cours de provisionnement", value: provisioning },
    { label: "Branding incomplet", value: brandingIncomplete },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Santé système</h1>
        <p className="mt-1 text-sm text-slate-400">Provisionnement et complétude des entreprises.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {rows.map((r) => (
          <div key={r.label} className="rounded-xl border border-white/10 bg-white/5 p-5">
            <p className="text-[13px] uppercase tracking-wide text-slate-400">{r.label}</p>
            <p className="mt-2 text-3xl font-bold text-white">{r.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
