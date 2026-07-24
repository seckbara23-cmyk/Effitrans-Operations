import { StatCard } from "@/components/departments/stat-card";
import { CockpitSectionShell } from "./cockpit-section-shell";
import { CockpitEmptyState } from "./cockpit-states";
import type { CockpitOperations } from "@/lib/operations/types";

/**
 * Centre d'Opérations — Operations widget (Phase 10.0C, Scope D).
 * The dossier + task state the composition layer already computed. Links out to
 * the OWNING screens (/files, /tasks) — it never recreates them. The engine
 * process-tower detail is rendered separately (preserved ProcessTowerSection).
 */
export function OperationsQueueCard({ operations }: { operations: CockpitOperations }) {
  const files = operations.files;
  const tasks = operations.tasks;

  if (!files && !tasks) {
    return (
      <CockpitSectionShell title="Opérations">
        <CockpitEmptyState message="Aucune donnée de dossiers accessible." />
      </CockpitSectionShell>
    );
  }

  const cards: { key: string; label: string; value: number; tone: "navy" | "teal" | "amber" | "red" | "slate"; href: string }[] = [];
  if (files) {
    cards.push(
      { key: "active", label: "Dossiers actifs", value: files.active, tone: "navy", href: "/files" },
      { key: "opened", label: "Ouverts", value: files.opened, tone: "teal", href: "/files?status=OPENED" },
      { key: "inProgress", label: "En cours", value: files.inProgress, tone: "amber", href: "/files?status=IN_PROGRESS" },
      { key: "highPriority", label: "Prioritaires", value: files.highPriority, tone: "amber", href: "/files?priority=high" },
      { key: "overdue", label: "En retard (ETA)", value: files.overdueShipments, tone: "red", href: "/files?overdue=1" },
    );
  }
  if (tasks) {
    cards.push(
      { key: "tasksOverdue", label: "Tâches en retard", value: tasks.overdue, tone: "red", href: "/tasks?filter=overdue" },
      { key: "tasksToday", label: "À traiter aujourd'hui", value: tasks.dueToday, tone: "amber", href: "/tasks" },
    );
  }

  return (
    <CockpitSectionShell title="Opérations" action={{ href: "/departments/operations", label: "Ouvrir les Opérations" }}>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-7">
        {cards.map((c) => (
          <StatCard key={c.key} label={c.label} value={c.value} tone={c.tone} href={c.href} />
        ))}
      </div>
    </CockpitSectionShell>
  );
}
