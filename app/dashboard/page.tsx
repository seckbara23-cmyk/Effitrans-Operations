import type { Metadata } from "next";
import { Suspense } from "react";
import { t } from "@/lib/i18n";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions } from "@/lib/rbac/permissions";
import { OperationsCockpitHeader } from "@/components/operations/operations-cockpit-header";
import { CockpitSections } from "@/components/operations/cockpit-sections";
import { DashboardSupporting } from "@/components/operations/dashboard-supporting";
import { CockpitSkeleton, CockpitSupportingSkeleton } from "@/components/operations/cockpit-skeleton";

export const metadata: Metadata = {
  title: t.dashboard.title,
};

// Reads per-request operational data (auth) — never prerender.
export const dynamic = "force-dynamic";

/**
 * Centre d'Opérations (Phase 10.0C) — the company's live operational cockpit.
 * ---------------------------------------------------------------------------
 * DEC-B29: this remains /dashboard, evolved in place — no new route. The page is
 * a thin, cheap gate (the /analytics streaming pattern): it renders the hero
 * immediately, then streams two independent regions behind Suspense —
 *   1. CockpitSections   → the composition layer (getOperationsCockpit)
 *   2. DashboardSupporting→ preserved sections through their existing readers
 * Each section is permission-shaped and degrades on its own; an optional section
 * failing never blanks the page. No Realtime, no polling, no Copilot (DEC-B31/B32).
 */
export default async function DashboardPage() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <OperationsCockpitHeader title={t.dashboard.title} subtitle={t.dashboard.subtitle} renderedAt={new Date()} />
        <div className="surface p-6 text-sm text-slate-600">{t.analytics.notConfigured}</div>
      </div>
    );
  }

  // Cheap, cached gate — renders the hero immediately; heavy sections stream below.
  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);

  return (
    <div className="animate-fade-in space-y-6">
      <OperationsCockpitHeader
        title={t.dashboard.title}
        subtitle="Vue opérationnelle en direct de l'entreprise — ce qui requiert votre attention, ce qui bouge, et où agir."
        renderedAt={new Date()}
      />

      <Suspense fallback={<CockpitSkeleton />}>
        <CockpitSections />
      </Suspense>

      <Suspense fallback={<CockpitSupportingSkeleton />}>
        <DashboardSupporting permissions={permissions} />
      </Suspense>
    </div>
  );
}
