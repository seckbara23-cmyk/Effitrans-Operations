/**
 * Workflow policy administration (Phase WES-7F). SERVER.
 * ---------------------------------------------------------------------------
 * Server-gated on the EXISTING `admin:config:manage` — workflow policy IS system
 * configuration, and WES-7F forbids inventing a privileged permission without
 * evidence one is needed. Every action re-asserts the same permission; the
 * platform-default scope is additionally bounded by the platform-admin identity
 * inside the actions.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import {
  getActivePolicyVersion,
  getBuiltInDefaultSummary,
  listPolicyVersions,
} from "@/lib/workflow/policy/readers";
import { PolicyAdmin } from "@/components/settings/policy-admin";

export const metadata: Metadata = { title: "Politique de workflow" };
export const dynamic = "force-dynamic";

export default async function WorkflowPolicyPage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "admin:config:manage")) notFound();

  const [versions, active, builtIn] = await Promise.all([
    listPolicyVersions(),
    getActivePolicyVersion(),
    getBuiltInDefaultSummary(),
  ]);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Paramètres"
        title="Politique de workflow"
        subtitle="Règles métier versionnées : départements responsables, sièges, preuves requises, transferts et cibles SLA."
      />
      <PolicyAdmin versions={versions} active={active} builtInHash={builtIn?.contentSha256 ?? null} />
    </div>
  );
}
