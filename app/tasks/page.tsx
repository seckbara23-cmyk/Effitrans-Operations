import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { TasksExplorer } from "@/components/tasks/tasks-explorer";

export const metadata: Metadata = { title: "Tâches" };

export default function TasksPage() {
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Pilotage"
        title="Tâches & workflow"
        subtitle="Exécution opérationnelle : suivi des tâches reliées aux clients, expéditions, dossiers douane et documents."
      />
      <TasksExplorer />
    </div>
  );
}
