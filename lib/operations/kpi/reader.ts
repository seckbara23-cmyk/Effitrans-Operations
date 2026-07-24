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
 * 10.0D-1 shipped the snapshot KPIs from EXISTING readers (dossiers_actifs,
 * dossiers_intervention, douane_en_cours, demandes_finance). 10.0D-2 adds the
 * WINDOWED event KPIs over ./windowed-readers — head-only counts on the §7
 * authoritative timestamps, bounded by the tenant-timezone windows (./windows).
 * The per-currency monetary KPIs (facturé/encaissé/créances, DEC-B44) arrive
 * in 10.0D-3 through this same contract — never fabricated ahead of their
 * authoritative reader.
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
import { getFinanceQueue } from "@/lib/finance/service";
import { getFinanceRequestQueue } from "../finance-requests";
import { countKpi, moneyFlowKpi, moneySnapshotKpi, overdueRowsAtTenantDay } from "./compose";
import {
  currentWindow, frenchMonthName, monthToDateWindow, previousMonthBounds, resolveTimezone,
  tenantToday, todayWindow,
} from "./windows";
import {
  conversationsStartedInWindow, customsReleasesInWindow, deliveriesCompletedInWindow,
  dossiersClosedInWindow, dossiersCreatedInWindow, financeApprovalsInWindow,
  financeDisbursementsInWindow, financeRequestsInWindow,
} from "./windowed-readers";
import { readCollectedByWindow, readInvoicedByWindow } from "./finance-readers";
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
  // Timezone FIRST — every window below derives from it (DEC-B39). The one
  // direct business-free read of this engine (organization.timezone).
  const timezone = resolveTimezone(
    await admin
      .from("organization")
      .select("timezone")
      .eq("id", user.tenantId)
      .maybeSingle()
      .then((r) => (r.data as { timezone?: string } | null)?.timezone, () => undefined),
  );
  const current = currentWindow(timezone);
  const today = todayWindow(timezone);
  const mtd = monthToDateWindow(timezone);
  const prevMonth = previousMonthBounds(timezone);
  const financeBounds = { mtdStart: mtd.start!, mtdEnd: mtd.end!, prevStart: prevMonth.start };
  const compareLabel = `vs ${frenchMonthName(prevMonth.start)} (mois complet)`;

  const [
    ctR, anR, customsR, requestsR, queueR, invoicedR, collectedR,
    createdR, closedR, deliveriesR, releasesR, freqTodayR, apprTodayR, disbTodayR, convR,
  ] = await Promise.allSettled([
    getControlTower(perms), // request-cache()d — shared with every other consumer this render
    getAnalytics(canFinance), // idem (also deduped inside getControlTower)
    canCustoms ? getIntelligenceDashboard() : none,
    canFinance ? getFinanceRequestQueue() : none,
    // 10.0D-3 — finance money (per-currency; invoices/payments always exist, so
    // NOT gated on the financeExecution flag — only on finance:read).
    canFinance ? getFinanceQueue() : none, // authoritative invoices for Créances (reused, cache()d)
    canFinance ? readInvoicedByWindow(user.tenantId, financeBounds) : none, // Facturé MTD + prev
    canFinance ? readCollectedByWindow(user.tenantId, financeBounds) : none, // Encaissé MTD + prev
    // 10.0D-2 — windowed event counts (head-only, §7 timestamps, tenant-day bounds).
    dossiersCreatedInWindow(user.tenantId, today),
    dossiersClosedInWindow(user.tenantId, today),
    deliveriesCompletedInWindow(user.tenantId, today), // 10.0D-3 ratified operational addition
    canCustoms ? customsReleasesInWindow(user.tenantId, today) : none,
    canFinance ? financeRequestsInWindow(user.tenantId, today) : none,
    canFinance ? financeApprovalsInWindow(user.tenantId, today) : none,
    canFinance ? financeDisbursementsInWindow(user.tenantId, today) : none,
    conversationsStartedInWindow(user.tenantId, today),
  ]);

  const ct = settled(ctR);
  const an = settled(anR);
  const customs = settled(customsR);
  const requests = settled(requestsR);
  // Finance execution dark / migration absent ⇒ the whole finance-request family is
  // honestly UNAVAILABLE — a count of historical rows must never render while the
  // feature is off (0 would be a confident lie, N a ghost).
  const financeExecutionLive = requests != null;
  const freqToday = financeExecutionLive ? settled(freqTodayR) : null;
  const apprToday = financeExecutionLive ? settled(apprTodayR) : null;
  const disbToday = financeExecutionLive ? settled(disbTodayR) : null;

  // 10.0D-3 finance money — invoices/payments always exist, so these do NOT
  // depend on financeExecution; only finance:read (already gating the branch).
  const queue = settled(queueR); // authoritative invoices (getFinanceQueue)
  const invoiced = settled(invoicedR);
  const collected = settled(collectedR);
  // Créances: re-evaluate overdue at the TENANT-DAY boundary over the authoritative
  // queue (reuses isOverdue; queue null ⇒ null ⇒ the KPI renders unavailable).
  const overdueRows = queue
    ? overdueRowsAtTenantDay(
        queue.map((i) => ({ status: i.status, dueDate: i.dueDate, balance: i.balance, currency: i.currency })),
        tenantToday(timezone),
      )
    : null;

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
    // 10.0D-2 — windowed operational flows (today, tenant-day).
    countKpi({
      key: "dossiers_crees_jour",
      label: "Dossiers créés aujourd'hui",
      value: settled(createdR),
      window: today,
      source: "operational_file.created_at",
      href: "/files",
    }),
    countKpi({
      key: "dossiers_clotures_jour",
      label: "Dossiers clôturés aujourd'hui",
      value: settled(closedR),
      window: today,
      source: "file_state_transition",
      href: "/files?status=CLOSED",
    }),
    countKpi({
      key: "conversations_jour",
      label: "Conversations ouvertes aujourd'hui",
      value: settled(convR),
      window: today,
      source: "conversation.created_at",
      href: "/messages",
    }),
    // 10.0D-3 ratified operational addition — deliveries completed today.
    countKpi({
      key: "livraisons_jour",
      label: "Livraisons terminées aujourd'hui",
      value: settled(deliveriesR),
      window: today,
      source: "transport_record.delivery_actual",
      href: "/transport",
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
          countKpi({
            key: "mainlevees_jour",
            label: "Mainlevées aujourd'hui",
            value: settled(releasesR),
            window: today,
            source: "customs_record.release_date",
            href: "/customs/intelligence",
          }),
        ]
      : []),
    // Finance money family (10.0D-3, DEC-B44) — per-currency, OMITTED entirely
    // without finance:read (analytics:read alone gets NO monetary KPI). These
    // read invoices/payments (always present) — independent of financeExecution.
    ...(canFinance
      ? [
          // Facturé (mois) — Σ authoritative invoice totals (issued set), per currency,
          // MTD vs the full previous tenant month (per-currency comparison).
          moneyFlowKpi({
            key: "facture_mtd",
            label: "Facturé (mois)",
            current: invoiced?.current ?? null,
            previous: invoiced?.previous ?? [],
            window: mtd,
            source: "invoice.issue_date",
            href: "/finance?status=ISSUED",
            comparisonLabel: compareLabel,
          }),
          // Encaissé (mois) — Σ non-reversed payments by linked-invoice currency,
          // MTD vs the full previous tenant month (per-currency comparison).
          moneyFlowKpi({
            key: "encaisse_mtd",
            label: "Encaissé (mois)",
            current: collected?.current ?? null,
            previous: collected?.previous ?? [],
            window: mtd,
            source: "payment.paid_at",
            href: "/finance/reconciliation",
            comparisonLabel: compareLabel,
          }),
          // Créances en retard — SNAPSHOT (no comparison, DEC-B42), per currency,
          // overdue at the tenant-day boundary.
          moneySnapshotKpi({
            key: "creances_retard",
            label: "Créances en retard",
            rows: overdueRows,
            window: current,
            source: "invoice.balance",
            href: "/collections",
            note: "included = nombre de factures en retard",
          }),
        ]
      : []),
    // Finance-request family — OMITTED without finance:read; when the execution
    // feature is dark / migration absent, every member renders an honest
    // "unavailable", never zero (DEC-B46).
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
          countKpi({
            key: "demandes_finance_jour",
            label: "Demandes finance déposées aujourd'hui",
            value: freqToday,
            window: today,
            source: "finance_request.requested_at",
            href: "/finance",
          }),
          countKpi({
            key: "approbations_finance_jour",
            label: "Demandes finance approuvées aujourd'hui",
            value: apprToday,
            window: today,
            source: "finance_request.reviewed_at",
            href: "/finance",
          }),
          countKpi({
            key: "decaissements_finance_jour",
            label: "Décaissements aujourd'hui",
            value: disbToday,
            window: today,
            source: "finance_request.disbursed_at",
            href: "/finance",
          }),
        ]
      : []),
  ];

  return { generatedAt: new Date().toISOString(), timezone, canFinance, kpis };
});
