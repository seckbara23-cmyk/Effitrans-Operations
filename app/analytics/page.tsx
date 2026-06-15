import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { AnalyticsBody, AnalyticsSkeleton } from "@/components/analytics/analytics-body";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t.analytics.title };
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

export default async function AnalyticsPage() {
  const header = <PageHeader meta="Administration" title={t.analytics.title} subtitle={t.analytics.subtitle} />;

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.analytics.notConfigured}</Notice></div>;
  }

  // Cheap, cached gate — renders immediately; the heavy aggregation streams below.
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "analytics:read")) {
    return <div className="animate-fade-in space-y-6">{header}<Notice>{t.analytics.forbidden}</Notice></div>;
  }
  const canFinance = hasPermission(permissions, "finance:read");

  return (
    <div className="animate-fade-in space-y-6">
      {header}
      <Suspense fallback={<AnalyticsSkeleton />}>
        <AnalyticsBody canFinance={canFinance} />
      </Suspense>
    </div>
  );
}
