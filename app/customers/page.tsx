import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";
import { modules } from "@/lib/modules";

export const metadata: Metadata = { title: modules.customers.title };

export default function CustomersPage() {
  return <ModulePage moduleKey="customers" />;
}
