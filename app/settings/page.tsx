import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";
import { modules } from "@/lib/modules";

export const metadata: Metadata = { title: modules.settings.title };

export default function SettingsPage() {
  return <ModulePage moduleKey="settings" />;
}
