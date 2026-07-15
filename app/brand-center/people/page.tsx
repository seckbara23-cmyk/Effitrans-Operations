import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listWorkforceProfiles } from "@/lib/brand/server/service";
import { PeopleManager } from "@/components/brand/people-manager";

export const metadata: Metadata = { title: "Identité collaborateurs" };
export const dynamic = "force-dynamic";

export default async function BrandPeoplePage() {
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  // Employee Brand Center profiles are governed by user management.
  if (!hasPermission(permissions, "admin:users:manage")) {
    return <div className="surface p-6 text-sm text-slate-600">Accès non autorisé.</div>;
  }
  const people = await listWorkforceProfiles();
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Centre de marque" title="Identité collaborateurs" subtitle="Fonction, coordonnées et variante de signature. Le nom, l'e-mail et les rôles restent gérés par le module Utilisateurs." />
      <PeopleManager people={people} />
    </div>
  );
}
