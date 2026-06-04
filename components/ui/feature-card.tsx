import type { Feature } from "@/lib/modules";

export function FeatureCard({ feature }: { feature: Feature }) {
  const Icon = feature.icon;
  return (
    <div className="surface group relative overflow-hidden p-4 transition-shadow hover:shadow-card-hover sm:p-5">
      {/* faint route line in the corner for texture */}
      <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-teal-50 opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="relative flex items-start gap-3.5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-navy-900 text-teal-300 ring-1 ring-inset ring-white/10">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-navy-900">
              {feature.title}
            </h3>
            <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 ring-1 ring-inset ring-amber-200">
              Bientôt
            </span>
          </div>
          <p className="mt-1 text-sm leading-relaxed text-slate-500">
            {feature.description}
          </p>
        </div>
      </div>
    </div>
  );
}
