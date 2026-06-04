import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";
import { modules } from "@/lib/modules";

export const metadata: Metadata = { title: modules.finance.title };

export default function FinancePage() {
  return <ModulePage moduleKey="finance" />;
}
