import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";
import { modules } from "@/lib/modules";

export const metadata: Metadata = { title: modules.customs.title };

export default function CustomsPage() {
  return <ModulePage moduleKey="customs" />;
}
