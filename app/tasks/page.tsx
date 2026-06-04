import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";
import { modules } from "@/lib/modules";

export const metadata: Metadata = { title: modules.tasks.title };

export default function TasksPage() {
  return <ModulePage moduleKey="tasks" />;
}
