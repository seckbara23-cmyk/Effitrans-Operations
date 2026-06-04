import { modules } from "@/lib/modules";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { FeatureCard } from "@/components/ui/feature-card";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Shared scaffold for every Phase-2 module page. Reads its content from the
 * `modules` config by key, so each route file stays a one-liner. No CRUD,
 * no data — a credible preview of what the module will handle.
 */
export function ModulePage({ moduleKey }: { moduleKey: keyof typeof modules }) {
  const m = modules[moduleKey];

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta={m.eyebrow} title={m.title} subtitle={m.subtitle} />

      <Panel eyebrow="Périmètre du module" title="Ce que ce module gérera">
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5">
          {m.features.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} />
          ))}
        </div>
      </Panel>

      <EmptyState
        icon={m.icon}
        title={m.emptyTitle}
        description={m.emptyDescription}
      />
    </div>
  );
}
