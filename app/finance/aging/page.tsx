import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/require-user";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAgingCurrencies, getAgingReportView } from "@/lib/finance/aging/server/read-service";
import { agingWorkspaceEnabled } from "@/lib/finance/aging/rollout";
import { isoDate, tryIsoDate, type AverageDelayPopulation } from "@/lib/finance/aging";
import { todayInTimezone } from "@/lib/collections/aging";
import { AgingWorkspace } from "@/components/finance/aging/aging-workspace";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { formatDateLongFr } from "@/lib/finance/aging/presentation";

export const metadata: Metadata = { title: "Balance âgée" };

// Auth/RLS-dependent and parameterised by the arrêté: never prerender.
export const dynamic = "force-dynamic";

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="surface p-6 text-sm text-slate-600">{children}</div>;
}

/**
 * Balance âgée — read-only workspace (FIN-AGING-3).
 *
 * TWO INDEPENDENT GATES, and the order matters:
 *
 *   1. The env kill switch. Off ⇒ notFound(), so the route does not exist rather
 *      than existing-and-refusing. A 404 leaks nothing about what is being built.
 *   2. `finance:aging:read`. In production this is currently unsatisfiable by
 *      anyone, because migration 72 is unapplied and the permission row does not
 *      exist — which is the real reason the feature is dark there, independent of
 *      any environment variable.
 *
 * It WRITES NOTHING. Opening this page does not create an aging_report; a report
 * is a deliberate, permissioned act arriving in a later phase.
 */
export default async function AgingBalancePage({
  searchParams,
}: {
  searchParams?: { date?: string; currency?: string; population?: string };
}) {
  if (!agingWorkspaceEnabled()) notFound();

  const user = await requireUser();
  const permissions = await getEffectivePermissions(user.id);
  if (!hasPermission(permissions, "finance:aging:read")) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Finance" title="Balance âgée" subtitle="Recouvrement et encours clients" />
        <Notice>Vous n&apos;avez pas l&apos;autorisation de consulter la balance âgée.</Notice>
      </div>
    );
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Finance" title="Balance âgée" subtitle="Recouvrement et encours clients" />
        <Notice>La balance âgée nécessite la configuration Supabase de l&apos;environnement.</Notice>
      </div>
    );
  }

  // The arrêté defaults to TODAY IN THE TENANT'S TIMEZONE — a Dakar portfolio
  // must not age by a server's UTC clock. An unparseable ?date= falls back to
  // that default rather than throwing: a bad URL should not break the page.
  const { data: org } = await getAdminSupabaseClient()
    .from("organization")
    .select("timezone")
    .eq("id", user.tenantId)
    .maybeSingle<{ timezone: string | null }>();
  const fallback = isoDate(todayInTimezone(org?.timezone ?? "Africa/Dakar"));
  const reportingDate = tryIsoDate(searchParams?.date ?? null) ?? fallback;

  const currencies = await getAgingCurrencies(user.tenantId);
  const requested = (searchParams?.currency ?? "").toUpperCase();
  const currency = currencies.includes(requested) ? requested : (currencies[0] ?? "XOF");

  // Q-04 remains unresolved, so the population is an explicit input with the
  // ratified default. It travels in the view model and the UI discloses it.
  const population: AverageDelayPopulation =
    searchParams?.population === "OVERDUE_ONLY" ? "OVERDUE_ONLY" : "ALL_ROWS";

  let report;
  try {
    report = await getAgingReportView({
      tenantId: user.tenantId,
      reportingDate,
      currency,
      averageDelayPopulation: population,
    });
  } catch (e) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader meta="Finance" title="Balance âgée" subtitle="Recouvrement et encours clients" />
        <Notice>
          La balance âgée n&apos;a pas pu être calculée. Les données financières sont peut-être
          momentanément indisponibles — réessayez, et signalez le problème si il persiste.
          {process.env.NODE_ENV !== "production" && (
            <pre className="mt-3 overflow-x-auto rounded bg-slate-50 p-3 text-xs text-red-700">
              {e instanceof Error ? e.message : String(e)}
            </pre>
          )}
        </Notice>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        meta="Finance · Recouvrement"
        title="Balance âgée"
        subtitle={`Encours clients arrêtés au ${formatDateLongFr(reportingDate)}`}
      />
      <AgingWorkspace
        report={report}
        currencies={currencies}
        canReadFollowUps={hasPermission(permissions, "collections:manage")}
      />
    </div>
  );
}
