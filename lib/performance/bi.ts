/**
 * The BI aggregation — the SAME numbers the report freezes.
 * ---------------------------------------------------------------------------
 * `buildSnapshot` is what publication stores. This module calls it for the live
 * view too, so a dashboard and a published report cannot disagree: there is one
 * aggregation, and the only difference between "live" and "published" is when
 * it ran. A second implementation for BI is exactly the drift this platform
 * exists to end, and a test asserts this file computes nothing of its own.
 */
import { collaboratorPerformance, ictdDossiers, loadCalendar, INDICATOR_READINESS } from "./read";
import { buildSnapshot, type ReportSnapshot } from "./report";
import type { PerformancePeriod } from "./period";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import type { IctdDossierRow } from "./read";

export type BiView = {
  snapshot: ReportSnapshot;
  /** The per-dossier rows behind every aggregate, for drill-down. */
  dossiers: IctdDossierRow[];
  clientNames: Map<string, string>;
};

export async function loadBiView(
  tenantId: string,
  period: PerformancePeriod,
): Promise<BiView> {
  const [collaborators, dossiers, calendar] = await Promise.all([
    collaboratorPerformance(tenantId, period),
    ictdDossiers(tenantId, period),
    loadCalendar(tenantId, period),
  ]);

  const admin = getAdminSupabaseClient();
  const clientIds = [...new Set(dossiers.map((d) => d.clientId).filter((v): v is string => !!v))];
  const clientNames = new Map<string, string>();
  if (clientIds.length > 0) {
    const { data } = await admin
      .from("client")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .in("id", clientIds);
    for (const c of data ?? []) clientNames.set(c.id as string, c.name as string);
  }

  return {
    snapshot: buildSnapshot({
      period,
      collaborators,
      dossiers,
      clientNames,
      calendarDays: calendar.size,
      unavailable: INDICATOR_READINESS,
    }),
    dossiers,
    clientNames,
  };
}
