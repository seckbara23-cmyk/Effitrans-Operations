import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { listUsers, listAssignableRoles } from "@/lib/users/service";
import { UsersAdmin } from "@/components/users/users-admin";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.users.title };

// Auth/RLS-dependent: never prerender at build.
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function UsersPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Administration" title={t.users.title} subtitle={t.users.subtitle} />
        <Notice>{t.users.notConfigured}</Notice>
      </div>
    );
  }

  const user = await requireUser(); // redirects to /login if unauthenticated/disabled
  const permissions = await getEffectivePermissions(user.id);

  if (!hasPermission(permissions, "admin:users:manage")) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Administration" title={t.users.title} subtitle={t.users.subtitle} />
        <Notice>{t.users.forbidden}</Notice>
      </div>
    );
  }

  const [users, roles] = await Promise.all([listUsers(), listAssignableRoles()]);
  const canManageRoles = hasPermission(permissions, "admin:roles:manage");

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader meta="Administration" title={t.users.title} subtitle={t.users.subtitle} />
      <UsersAdmin users={users} roles={roles} canManageRoles={canManageRoles} />
    </div>
  );
}
