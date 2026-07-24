/**
 * Executive KPI Engine — reader (Phase 10.0D-1). SERVER-ONLY, read-only.
 * ---------------------------------------------------------------------------
 * THE authoritative KPI composition point (DEC-B35): one engine, many
 * consumers. CONSUME, NEVER OWN — every figure is produced by an existing
 * bounded reader; this file calls them, applies the ratified windows/currency/
 * quality contract, and shapes the typed set. The ONLY direct table read is
 * organization.timezone (window metadata, DEC-B39 — the same lookup the
 * collections module performs); business tables are never touched here.
 *
 * DEC-B36 gate: the executive strip requires analytics:read — without it the
 * whole set is null (the strip is absent, never empty-zeroes). Monetary /
 * finance KPIs additionally require finance:read and are OMITTED without it.
 *
 * 10.0D-1 ships the KPIs computable from EXISTING readers (no new data
 * queries): dossiers_actifs, dossiers_intervention, douane_en_cours,
 * demandes_finance. The windowed today/MTD KPIs (ouverts/livraisons/
 * mainlevées) arrive in 10.0D-2 and the per-currency monetary KPIs
 * (facturé/encaissé/créances, DEC-B44) in 10.0D-3, all through this same
 * contract — none are fabricated ahead of their authoritative reader.
 *
 * « Dossiers nécessitant une intervention » (ratified 10.0D-1 addition) is the
 * CEO's morning attention indicator: dossiers whose risk level is high or
 * critical, from the platform's ONE risk engine (lib/copilot/risk-engine via
 * the control tower — which already aggregates blocked work, SLA breaches,
 * missing documents, customs inspection age, awaiting-POD and overdue finance).
 * DEC-B43 guarantees terminal dossiers never enter that scoring. New exception
 * sources extend it through the risk engine / 10.0E alert adapters — never by
 * a second scoring formula here.
 */
import "server-only";
import { cache } from "react";
import { requireUser } from "@/lib/auth/require-user";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getAnalytics } from "@/lib/analytics/service";
import { getControlTower } from "@/lib/control-tower/service";
import { getIntelligenceDashboard } from "@/lib/customs/intelligence/service";
import { getFinanceRequestQueue } from "../finance-requests";
import { countKpi } from "./compose";
import { currentWindow, resolveTimezone } from "./windows";
import type { OperationsKpiSet } from "./types";

const settled = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);
const none = Promise.resolve(null);

export const getOperationsKpis = cache(async (): Promise<OperationsKpiSet | null> => {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return null;
  const user = await requireUser();
  const perms = await getEffectivePermissions(user.id);
  // DEC-B36 — the executive strip exists only behind the supervision boundary.
  if (!hasPermission(perms, "analytics:read")) return null;
  const canFinance = hasPermission(perms, "finance:read");
  const canCustoms = hasPermission(perms, "customs:read");

  const admin = getAdminSupabaseClient();
  const [tzR, ctR, anR, customsR, requestsR] = await Promise.allSettled([
    // Window metadata only — the one direct read (organization.timezone, DEC-B39).
    admin.from("organization").select("timezone").eq("id", user.tenantId).maybeSingle(),
    getControlTower(perms), // request-cache()d — shared with every other consumer this render
    getAnalytics(canFinance), // idem (also deduped inside getControlTower)
    canCustoms ? getIntelligenceDashboard() : none,
    canFinance ? getFinanceRequestQueue() : none,
  ]);

  const timezone = resolveTimezone(
    (settled(tzR)?.data as { timezone?: string } | null | undefined)?.timezone,
  );
  const ct = settled(ctR);
  const an = settled(anR);
  const customs = settled(customsR);
  const requests = settled(requestsR);
  const current = currentWindow(timezone);

  const kpis = [
    // DEC-B43 — THE ratified active definition, via the analytics reader (single source;
    // the control tower reuses the same figure, so no divergence can reappear).
    countKpi({
      key: "dossiers_actifs",
      label: "Dossiers actifs",
      value: an?.operations.active ?? null,
      window: current,
      source: "analytics",
      href: "/files",
    }),
    // The CEO attention indicator — high + critical risk dossiers from the ONE risk engine.
    countKpi({
      key: "dossiers_intervention",
      label: "Dossiers nécessitant une intervention",
      value: ct ? ct.riskKpis.critical + ct.riskKpis.high : null,
      window: current,
      source: "control-tower-risk",
      // No credible filtered destination exists yet (§16) — the attention queue renders
      // on the cockpit itself; a href is added when a real filtered route exists.
    }),
    // Customs slice — OMITTED (not "unavailable") without customs:read: absent ≠ zero.
    ...(canCustoms
      ? [
          countKpi({
            key: "douane_en_cours",
            label: "File douane",
            value: customs?.dashboard.pending ?? null,
            window: current,
            source: "customs-intelligence",
            href: "/customs/intelligence",
          }),
        ]
      : []),
    // Finance-request pipeline — OMITTED without finance:read; null reader (engine dark /
    // migration absent) renders an honest "unavailable", never zero (DEC-B46).
    ...(canFinance
      ? [
          countKpi({
            key: "demandes_finance",
            label: "Demandes finance à traiter",
            value: requests ? requests.pendingReview + requests.approvedNotDisbursed : null,
            window: current,
            source: "finance-requests",
            href: "/finance",
          }),
        ]
      : []),
  ];

  return { generatedAt: new Date().toISOString(), timezone, canFinance, kpis };
});
