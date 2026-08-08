import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { getAdminUser } from "@/lib/users/service";
import { canUserAdmin } from "@/lib/users/permissions";
import { UserPasswordPanel } from "@/components/users/user-password-panel";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.users.title };

// Auth/RLS-dependent: never prerender at build.
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

/**
 * Staff user details — the home of Password Management.
 *
 * Every control is rendered from a SEPARATE capability check, so an
 * administrator granted only admin:users:read sees the record and its password
 * state but no lever. The checks here hide controls; the server actions are
 * what actually refuse, and they re-check independently.
 */
export default async function UserDetailsPage({ params }: { params: { id: string } }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Administration" title={t.users.title} subtitle={t.users.subtitle} />
        <Notice>{t.users.notConfigured}</Notice>
      </div>
    );
  }

  const current = await requireUser();
  const permissions = await getEffectivePermissions(current.id);

  if (!canUserAdmin(permissions, "read")) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Administration" title={t.users.title} subtitle={t.users.subtitle} />
        <Notice>{t.users.forbidden}</Notice>
      </div>
    );
  }

  const user = await getAdminUser(params.id);
  if (!user) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Administration" title={t.users.title} subtitle={t.users.subtitle} />
        <Notice>{t.users.errors.not_found}</Notice>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Administration"
        title={user.name ?? user.email}
        subtitle={user.email}
      />

      <Link href="/users" className="inline-block text-sm text-teal-700 hover:underline">
        ← {t.users.title}
      </Link>

      <section className="surface p-5">
        {/* EMP-4A — Enterprise Mail access for this user. A link rather than an
            inline panel: mailbox administration is its own authority, and most
            people opening this page do not hold it. */}
        <Link
          href={`/users/${params.id}/enterprise-mail`}
          className="mb-3 inline-block text-sm text-teal-700 hover:underline"
        >
          Enterprise Mail — accès aux boîtes →
        </Link>
        <h2 className="text-sm font-semibold text-navy-900">{t.users.columns.roles}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={
              user.status === "active"
                ? "rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700"
                : user.status === "archived"
                  ? "rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600"
                  : "rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
            }
          >
            {t.users.status[user.status]}
          </span>
          {user.roles.length === 0 && <span className="text-xs text-slate-400">{t.common.none}</span>}
          {user.roles.map((r) => (
            <span key={r.roleId} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-navy-800">
              {r.labelFr ?? r.code}
            </span>
          ))}
        </div>
      </section>

      <UserPasswordPanel
        user={{
          id: user.id,
          email: user.email,
          name: user.name,
          archived: user.status === "archived",
          passwordChangedAt: user.passwordChangedAt,
          tempPasswordExpiresAt: user.tempPasswordExpiresAt,
          passwordStatus: user.passwordStatus,
        }}
        canResetPassword={canUserAdmin(permissions, "resetPassword")}
        canGenerateTempPassword={canUserAdmin(permissions, "tempPassword")}
        canUnlock={canUserAdmin(permissions, "unlock")}
        isSelf={user.id === current.id}
      />
    </div>
  );
}
