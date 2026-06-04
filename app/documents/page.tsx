import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";
import { modules } from "@/lib/modules";

export const metadata: Metadata = { title: modules.documents.title };

export default function DocumentsPage() {
  return <ModulePage moduleKey="documents" />;
}
