import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";
import { modules } from "@/lib/modules";

export const metadata: Metadata = { title: modules.reports.title };

export default function ReportsPage() {
  return <ModulePage moduleKey="reports" />;
}
