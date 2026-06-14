import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { ClientForm } from "@/components/clients/client-form";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.clients.new };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function NewClientPage() {
  const header = <PageHeader meta="Opérations" title={t.clients.new} subtitle={t.clients.subtitle} />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.clients.notConfigured}</Notice></div>;
  }

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "client:create")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.clients.forbidden}</Notice></div>;
  }

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <Link href="/clients" className="text-sm text-teal-700 hover:underline">
        ← {t.clients.backToList}
      </Link>
      <ClientForm mode="create" />
    </div>
  );
}
