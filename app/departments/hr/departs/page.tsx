/**
 * HR-8B — Départs (offboarding workspace). Gate hr:read; the acts gate
 * hr:manage in the server actions and again in the database (INV-7).
 *
 * COMPOSITION ONLY. The clearance gates shown here are read from the tables
 * that own them — equipment custody (HR-4) and the required end-of-contract
 * documents (HR-3). They are DISPLAY: hr_complete_offboarding re-derives the
 * blocking facts inside its own transaction, so a stale screen can never
 * close a departure (I-8.2).
 *
 * This page terminates nobody and touches no login account: the employment
 * lifecycle stays in the registry, and the account step is a prompt toward
 * Administration → Utilisateurs (DEC-B62 / I-8.3).
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { GuideLink } from "@/components/hr/guide-link";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listEmployees } from "@/lib/hr/read";
import { listEquipment } from "@/lib/hr/onboarding";
import {
  listOffboardingCases, listOffboardingItems, listOffboardingTemplates, offboardingGates,
} from "@/lib/hr/offboarding";
import { OffboardingStudio, type CaseGates } from "@/components/hr/offboarding-studio";

export const metadata: Metadata = { title: "Départs — RH" };
export const dynamic = "force-dynamic";

export default async function HrOffboardingPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Ressources humaines" title="Départs" subtitle="Configuration requise." />
      </div>
    );
  }
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "hr:read")) notFound();
  const canManage = hasPermission(permissions, "hr:manage");
  // Only a sensitive-tier holder sees C3 documents in the evidence picker; the
  // list is the employee file's own rule, reused rather than re-implemented.
  const canSeeSensitive = hasPermission(permissions, "hr:sensitive:read");

  const [cases, templates, directory, equipment] = await Promise.all([
    listOffboardingCases(user.tenantId),
    listOffboardingTemplates(user.tenantId),
    listEmployees(user.tenantId),
    listEquipment(user.tenantId),
  ]);

  const employeeById: Record<string, { label: string; matricule: string; status: string }> = {};
  for (const e of directory) {
    employeeById[e.id] = {
      label: `${e.first_name} ${e.last_name}`,
      matricule: e.employee_number,
      status: e.status,
    };
  }
  // Eligibility mirrors the RPC's rule exactly — a departure concerns someone
  // still employed. Anything else is refused in the database anyway.
  const eligibleIds = new Set(cases.filter((c) => ["OPEN", "IN_PROGRESS"].includes(c.status)).map((c) => c.employee_id));
  const eligible = directory
    .filter((e) => ["ACTIVE", "SUSPENDED"].includes(e.status) && !eligibleIds.has(e.id))
    .map((e) => ({ id: e.id, label: `${e.first_name} ${e.last_name} (${e.employee_number})` }));

  const assetLabel = new Map(equipment.map((q) => [q.id, q.asset_tag]));
  const itemsByCase: Record<string, Awaited<ReturnType<typeof listOffboardingItems>>> = {};
  const gatesByCase: Record<string, CaseGates> = {};
  await Promise.all(cases.map(async (c) => {
    const [items, gates] = await Promise.all([
      listOffboardingItems(user.tenantId, c.id),
      offboardingGates(user.tenantId, c.employee_id, canSeeSensitive),
    ]);
    itemsByCase[c.id] = items;
    gatesByCase[c.id] = {
      equipment: gates.openCustody.map((a) => ({
        id: a.id,
        label: assetLabel.get(a.equipment_id) ?? "Matériel",
        assignedOn: a.assigned_on,
      })),
      missingDocuments: gates.missingDocuments,
      contractsNotEnded: gates.contractsNotEnded,
      account: gates.account,
      documents: gates.documents,
    };
  }));

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Ressources humaines" title="Départs"
        subtitle="Sorties, restitution du matériel et clôture des dossiers." />
      <div className="flex flex-wrap items-center gap-4">
        <Link href="/departments/hr" className="inline-block text-sm text-teal-700 hover:underline">← Tableau de bord RH</Link>
        <GuideLink route="/departments/hr/departs" />
      </div>
      <OffboardingStudio cases={cases} employeeById={employeeById} eligible={eligible}
        templates={templates} itemsByCase={itemsByCase} gatesByCase={gatesByCase} canManage={canManage}
        registrySize={directory.length} />
    </div>
  );
}
