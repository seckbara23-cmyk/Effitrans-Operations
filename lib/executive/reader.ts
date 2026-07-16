/**
 * Executive Intelligence — reader layer (Phase 7.7). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * THE composition point. Every figure on the executive dashboard is produced by an EXISTING
 * bounded module reader; this layer only calls them, projects their output into the executive
 * model, and merges. It contains NO domain calculation, NO second state machine, and NO KPI of its
 * own — if a number is not returned by an authoritative reader, it is null (never estimated here).
 *
 *   getControlTower(perms)      [analytics:read]  → ops KPIs, SLA, avg customs/delivery/transport
 *                                                   days, time-to-invoice/payment, risk queue
 *   getBusinessIntelligence()   [analytics:read]  → revenue, aging, active clients, top overdue
 *   getAnalytics(canFinance)    [analytics:read]  → portal adoption KPIs (authoritative)
 *   getCommandCenter()          [transport:read]  → road/ocean/air/customs cards + attention queue
 *   getDocIntelDashboard()      [document:read]   → OCR queue / backlog / conflicts
 *   getCopilotUsageSummary()    [audit:read:all]  → AI usage (requests, fallbacks, latency, tokens)
 *   readNotificationKpis()      [executive:…]     → the ONE documented gap (see readers/portal-ops)
 *   readFleetMap()              [executive:…]     → aggregate map (reuses the tracking model)
 *   readExecutiveTimeline()     [executive:…]     → merged chronology (no new event store)
 *
 * DIRECTION OF DEPENDENCY: the dashboard depends on the modules; no module imports this file.
 *
 * DEGRADE BY SECTION: each reader self-authorizes. They run under Promise.allSettled, so a reader
 * the executive cannot read (or that fails) marks its section `unavailable` — the page never
 * crashes and never renders a missing section as a confident zero (Missing ≠ Negative).
 *
 * REQUEST-LEVEL CACHE: wrapped in React cache() so a render that reads the snapshot more than once
 * (page + AI context) performs the underlying work ONCE per request.
 */
import "server-only";
import { cache } from "react";
import { assertPermission } from "@/lib/auth/require-permission";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getControlTower } from "@/lib/control-tower/service";
import { getBusinessIntelligence } from "@/lib/bi/service";
import { getAnalytics } from "@/lib/analytics/service";
import { getCommandCenter } from "@/lib/logistics/reader";
import { getDocIntelDashboard } from "@/lib/docintel/service";
import { getCopilotUsageSummary } from "@/lib/logistics/copilot/usage";
import { getCopilotConfig } from "@/lib/copilot/engine";
import { readNotificationKpis } from "./readers/portal-ops";
import { readFleetMap } from "./readers/fleet-map";
import { readExecutiveTimeline } from "./readers/timeline";
import { countAlertsByLevel, kpi, mergeExecutiveAlerts, normalizeSeverity, successRate } from "./compose";
import { DRILL, MODE_HREF } from "./links";
import type {
  AiIntelligence, CustomerIntelligence, DocumentIntelligence, ExecutiveAlert, ExecutiveIntelligence,
  ExecutiveKpi, ExecutiveSection, FinancialOverview, OperationsOverview, PerformanceOverview,
} from "./types";

const AI_WINDOW_DAYS = 7;
const settled = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);
const uniq = <T,>(a: T[]): T[] => Array.from(new Set(a));

export { DRILL };

export const getExecutiveIntelligence = cache(async (): Promise<ExecutiveIntelligence> => {
  const user = await assertPermission("executive:dashboard:read");
  const perms = await getEffectivePermissions(user.id);
  const canFinance = hasPermission(perms, "finance:read");

  const generatedAt = new Date().toISOString();
  const sections: ExecutiveSection[] = [];
  const unavailable: ExecutiveSection[] = [];

  const [ctR, biR, anR, ccR, diR, aiR, notifR, mapR, tlR] = await Promise.allSettled([
    getControlTower(perms),
    getBusinessIntelligence(perms),
    getAnalytics(canFinance),
    getCommandCenter(),
    getDocIntelDashboard(),
    getCopilotUsageSummary(AI_WINDOW_DAYS),
    readNotificationKpis(),
    readFleetMap(),
    readExecutiveTimeline(),
  ]);

  const ct = settled(ctR);
  const bi = settled(biR);
  const an = settled(anR);
  const cc = settled(ccR);
  const di = settled(diR);
  const usage = settled(aiR);
  const notif = settled(notifR);
  const fleet = settled(mapR);
  const tl = settled(tlR);

  const currency = bi?.currency ?? ct?.kpis.currency ?? "XOF";

  // ---------------------------------------------------------------- operations ----
  let operations: OperationsOverview | null = null;
  if (cc) {
    operations = {
      headline: cc.headline,
      modules: cc.cards.map((c) => ({ mode: c.mode, available: c.available, state: c.state, kpis: c.kpis, href: MODE_HREF[c.mode] ?? DRILL.operations })),
    };
    sections.push("operations");
    for (const c of cc.cards) {
      const s = c.mode === "ocean" ? "shipping" : (c.mode as ExecutiveSection);
      (c.available ? sections : unavailable).push(s);
    }
  } else {
    unavailable.push("operations", "shipping", "air", "road", "customs");
  }

  // ---------------------------------------------------------------- financial ----
  let financial: FinancialOverview | null = null;
  if (bi && bi.canFinance) {
    financial = {
      currency,
      revenueThisMonth: bi.revenue.thisMonth,
      revenueYtd: bi.revenue.ytd,
      outstanding: bi.revenue.outstanding,
      collectedThisMonth: bi.revenue.collectedThisMonth,
      avgInvoiceValue: bi.revenue.avgInvoiceValue,
      // Authoritative source: the control tower's single lifecycle pass. Never recomputed here.
      avgPaymentDelayDays: ct?.avgTimes.timeToPaymentDays ?? null,
      aging: [
        { bucket: "0–30 j", value: bi.aging.b0_30 },
        { bucket: "31–60 j", value: bi.aging.b31_60 },
        { bucket: "61–90 j", value: bi.aging.b61_90 },
        { bucket: "> 90 j", value: bi.aging.b90p },
      ],
      topOverdueClients: bi.topOverdueClients.slice(0, 5),
    };
    sections.push("financial");
  } else {
    // No finance:read (or BI failed) ⇒ the row is NOT included, never shown as zero revenue.
    unavailable.push("financial");
  }

  // ---------------------------------------------------------------- customers ----
  let customers: CustomerIntelligence | null = null;
  if (an || bi || notif) {
    customers = {
      activeClients: bi?.activeClients ?? null,
      // Portal adoption: REUSED from getAnalytics().portal (authoritative) — not recomputed.
      portalUsers: an?.portal.users ?? null,
      portalActiveClients: an?.portal.activeClients ?? null,
      sharedDocuments: an?.portal.sharedDocuments ?? null,
      portalDownloads: an?.portal.downloads ?? null,
      portalInvoiceViews: an?.portal.invoiceViews ?? null,
      notificationsDelivered: notif?.delivered ?? null,
      notificationsUnread: notif?.unread ?? null,
      notificationWindowDays: notif?.windowDays ?? 30,
      topOverdueClients: bi?.canFinance ? bi.topOverdueClients.slice(0, 5) : [],
    };
    sections.push("customers");
  } else {
    unavailable.push("customers");
  }

  // ---------------------------------------------------------------- documents ----
  let documents: DocumentIntelligence | null = null;
  if (di) {
    documents = {
      // Missing-required documents has no tenant-wide reader (see docs/executive/reuse-analysis.md).
      missingRequired: null,
      reviewQueue: di.readyForReview,
      failed: di.failed,
      unresolvedConflicts: di.unresolvedConflicts,
      queued: di.queued,
      processing: di.processing,
    };
    sections.push("documents");
  } else if (cc?.docIntel) {
    // Bounded indicator the Command Center already carries — better than nothing, still honest.
    documents = { missingRequired: null, reviewQueue: cc.docIntel.readyForReview, failed: cc.docIntel.failed, unresolvedConflicts: null, queued: null, processing: null };
    sections.push("documents");
  } else {
    unavailable.push("documents");
  }

  // ---------------------------------------------------------------- AI ----
  let ai: AiIntelligence | null = null;
  if (usage) {
    const cfg = getCopilotConfig();
    ai = {
      windowDays: usage.windowDays,
      total: usage.total,
      answered: usage.answered,
      fallback: usage.fallback,
      failed: usage.failed,
      successRatePercent: successRate(usage.answered, usage.total),
      avgDurationMs: usage.avgDurationMs,
      tokens: usage.tokens,
      // Configuration state only — the dashboard NEVER probes a provider (no provider call).
      providerConfigured: cfg.configured,
      provider: cfg.provider,
      model: cfg.model,
    };
    sections.push("ai");
  } else {
    unavailable.push("ai");
  }

  // ---------------------------------------------------------------- performance ----
  const performance: PerformanceOverview | null = ct
    ? {
        avgCustomsDays: ct.kpis.avgCustomsDays,
        avgDeliveryDays: ct.kpis.avgDeliveryDays,
        avgTransportDays: ct.avgTimes.transportDays,
        timeToInvoiceDays: ct.avgTimes.timeToInvoiceDays,
        timeToPaymentDays: ct.avgTimes.timeToPaymentDays,
        // ETA accuracy has NO authoritative source (no promised-vs-actual ETA history is kept).
        // Reporting null is the honest answer; see docs/executive/acceptance.md.
        etaAccuracyPercent: null,
      }
    : null;

  // ---------------------------------------------------------------- map + timeline ----
  if (fleet && fleet.markers.length >= 0 && !fleet.warnings.includes("transport:read requis pour la carte agrégée.")) sections.push("map");
  else unavailable.push("map");
  if (tl) sections.push("timeline");
  else unavailable.push("timeline");

  // ---------------------------------------------------------------- alerts ----
  // Reuses each module's OWN alert engine. Severity is NORMALIZED from the token that engine
  // assigned (compose.ts SEVERITY_MAP) — never scored here.
  const rawAlerts: ExecutiveAlert[] = [
    ...(cc?.attention ?? []).map((a): ExecutiveAlert => ({
      level: normalizeSeverity(a.severity),
      origin: a.mode,
      reference: a.reference,
      clientName: a.clientName,
      reason: a.reason,
      href: a.link,
      occurredAt: a.occurredAt ?? null,
      sourceSeverity: a.severity,
    })),
  ];
  const alerts = mergeExecutiveAlerts(rawAlerts);
  if (cc) sections.push("alerts");
  else unavailable.push("alerts");

  // ---------------------------------------------------------------- global KPI row ----
  const h = cc?.headline ?? null;
  const kpis: ExecutiveKpi[] = [
    kpi("activeDossiers", "Dossiers actifs", ct?.kpis.activeDossiers ?? null, "control-tower", DRILL.management),
    kpi("deliveredThisMonth", "Livrés ce mois", ct?.kpis.deliveredThisMonth ?? null, "control-tower", DRILL.operations),
    kpi("movementsInProgress", "Mouvements en cours", h?.movementsInProgress ?? null, "command-center", DRILL.operations),
    kpi("arriving7d", "Arrivées ≤ 7 j", h?.arrivingWithin7Days ?? null, "command-center", DRILL.operations),
    kpi("overdueOps", "Opérations en retard", h?.overdueOps ?? null, "command-center", DRILL.operations),
    kpi("awaitingCustoms", "En attente de douane", h?.awaitingCustoms ?? null, "command-center", DRILL.customs),
    kpi("criticalAlerts", "Alertes critiques", h?.criticalAlerts ?? null, "command-center", DRILL.operations),
    kpi("revenueThisMonth", "Revenu du mois", financial?.revenueThisMonth ?? null, "business-intelligence", DRILL.financial, "currency", currency),
    kpi("outstanding", "Encours à recouvrer", financial?.outstanding ?? null, "business-intelligence", DRILL.financial, "currency", currency),
    kpi("avgCustomsDays", "Dédouanement moyen", performance?.avgCustomsDays ?? null, "control-tower", DRILL.customs, "days"),
    kpi("avgDeliveryDays", "Livraison moyenne", performance?.avgDeliveryDays ?? null, "control-tower", DRILL.operations, "days"),
    kpi("reviewQueue", "File de revue OCR", documents?.reviewQueue ?? null, "docintel-dashboard", DRILL.documents),
    kpi("activeClients", "Clients actifs", customers?.activeClients ?? null, "business-intelligence", DRILL.customers),
    kpi("aiRequests", `Requêtes IA (${AI_WINDOW_DAYS} j)`, ai?.total ?? null, "copilot-usage", DRILL.ai),
  ];

  // ---------------------------------------------------------------- governance ----
  // SLA / bottlenecks / client table come from the SAME control-tower + BI pass already performed
  // above — never a second read.
  const governance: ExecutiveIntelligence["governance"] = ct
    ? {
        sla: (["documentation", "customs", "transport", "finance"] as const).map((d) => ({ department: d, ...ct.slaByDept[d] })),
        bottlenecks: ct.bottlenecks,
        clients: (bi?.clients ?? []).slice(0, 5).map((c) => ({ clientId: c.clientId, clientName: c.clientName, revenue: c.revenue, shipments: c.shipments, outstanding: c.outstanding })),
        needsAttention: ct.needsAttention.length,
      }
    : null;

  const consulted = uniq(sections);
  return {
    generatedAt,
    sections: consulted,
    unavailable: uniq(unavailable).filter((s) => !consulted.includes(s)),
    kpis,
    operations,
    financial,
    customers,
    documents,
    ai,
    performance,
    governance,
    map: fleet,
    timeline: tl?.entries ?? [],
    alerts,
    alertCounts: countAlertsByLevel(alerts),
    canFinance,
    currency,
  };
});
