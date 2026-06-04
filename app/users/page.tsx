import type { Metadata } from "next";
import { ModulePage } from "@/components/module-page";
import { modules } from "@/lib/modules";

export const metadata: Metadata = { title: modules.users.title };

export default function UsersPage() {
  return <ModulePage moduleKey="users" />;
}
