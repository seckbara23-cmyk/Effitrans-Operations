/**
 * Logistics Copilot — context builder (Phase 7.6A + 7.6B). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Assembles a BOUNDED, READ-ONLY, permission-degraded snapshot. It composes the EXISTING bounded
 * readers (Command Center, customs declarations, overdue invoices, missing-required docs, doc-
 * intelligence jobs) — no new domain calculation, no write path. Every source is page-0 and
 * ≤ its budgeted cap; the tenant is never fully scanned. A section the caller can't read (or that
 * fails) is recorded in `unavailable` so the copilot says "not available" rather than "nothing
 * found" (Missing ≠ Negative). 7.6B adds question-classified budgeting, portfolio risk, missing-
 * required documents, a safe doc-intelligence projection, and grounded customer-notification facts.
 */
import "server-only";
import { assertPermission } from "@/lib/auth/require-permission";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getCommandCenter } from "@/lib/logistics/reader";
import { listDeclarations } from "@/lib/customs/intelligence/service";
import { getFinanceQueue } from "@/lib/finance/service";
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { overdueDays } from "@/lib/copilot/risk-engine";
import { classifyQuestion, moduleCaps } from "./budget";
import { assemblePortfolioRisk } from "./risk";
import { readMissingRequiredDocs, readDocIntelJobs } from "./readers";
import type { CopilotAlert, CopilotDeclaration, CopilotInvoice, CopilotNotifyOpportunity, CopilotUpcoming, LogisticsContext, LogisticsModule, QuestionClass } from "./types";

const CAP = 100;
const BLOCKED_CUSTOMS = ["REJECTED", "CANCELLED", "AWAITING_PAYMENT"];
const RISK_CAP = 15;
const uniq = <T,>(a: T[]): T[] => Array.from(new Set(a));
const PAYMENT_STATE: Record<string, string> = { ISSUED: "émise", PARTIALLY_PAID: "partiellement payée", PAID: "payée" };

export async function buildLogisticsCopilotContext(question = ""): Promise<LogisticsContext> {
  const user = await assertPermission("logistics:copilot:read"); // gate (throws → 403 in the route)
  const perms = await getEffectivePermissions(user.id);
  const authorized = {
    transport: hasPermission(perms, "transport:read"),
    customs: hasPermission(perms, "customs:read"),
    finance: hasPermission(perms, "finance:read"),
    document: hasPermission(perms, "document:read"),
  };
  const questionClass: QuestionClass = classifyQuestion(question);
  const caps = moduleCaps(questionClass);
  const admin = getAdminSupabaseClient();

  const generatedAt = new Date().toISOString();
  const modules: LogisticsModule[] = [];
  const unavailable: LogisticsModule[] = [];
  const truncated: LogisticsModule[] = [];
  const capTo = <T,>(rows: T[], m: LogisticsModule): T[] => {
    if (rows.length > caps[m]) { truncated.push(m); return rows.slice(0, caps[m]); }
    return rows;
  };

  // ---- Layer A: Command Center (road/ocean/air overview + customs/doc indicators) ----
  let attentionAll: CopilotAlert[] = [];
  let upcomingAll: CopilotUpcoming[] = [];
  let headline: LogisticsContext["headline"] = null;
  let docReview: LogisticsContext["docReview"] = null;
  if (authorized.transport) {
    try {
      const cc = await getCommandCenter();
      headline = cc.headline;
      attentionAll = cc.attention.map((a): CopilotAlert => ({ mode: a.mode, severity: a.severity, reference: a.reference, clientName: a.clientName, reason: a.reason, link: a.link }));
      upcomingAll = cc.upcoming.map((u): CopilotUpcoming => ({ mode: u.mode, reference: u.reference, clientName: u.clientName, route: u.route, at: u.at, status: u.status, link: u.link }));
      docReview = cc.docIntel;
      modules.push("road", "ocean", "air");
    } catch { unavailable.push("road", "ocean", "air"); }
  } else { unavailable.push("road", "ocean", "air"); }

  // ---- Layer B: blocked customs (real citations) ----
  let blockedAll: CopilotDeclaration[] = [];
  if (authorized.customs) {
    try {
      const page = await listDeclarations({}, 0, CAP);
      blockedAll = page.items.filter((d) => BLOCKED_CUSTOMS.includes(d.status)).map((d): CopilotDeclaration => ({ reference: d.reference, fileNumber: d.fileNumber, clientName: d.clientName, office: d.office, status: d.status, link: `/files/${d.fileId}` }));
      modules.push("customs");
    } catch { unavailable.push("customs"); }
  } else { unavailable.push("customs"); }

  // ---- Layer B: overdue invoices (finance-gated — no finance context without finance:read) ----
  let overdueAll: CopilotInvoice[] = [];
  if (authorized.finance) {
    try {
      const now = new Date();
      overdueAll = (await getFinanceQueue())
        .filter((i) => i.overdue)
        .map((i): CopilotInvoice => ({ invoiceNumber: i.invoiceNumber, fileNumber: i.fileNumber, clientName: i.clientName, balance: i.balance, currency: i.currency, dueDate: i.dueDate, daysOverdue: overdueDays(i.dueDate, now), paymentState: PAYMENT_STATE[i.status] ?? i.status, link: `/files/${i.fileId}` }));
      modules.push("finance");
    } catch { unavailable.push("finance"); }
  } else { unavailable.push("finance"); }

  // ---- Layer B: required-document completeness + doc-intelligence projection (document:read) ----
  let missingAll: LogisticsContext["missingDocs"] = [];
  let docIntelAll: LogisticsContext["docIntelJobs"] = [];
  if (authorized.document) {
    try {
      [missingAll, docIntelAll] = await Promise.all([readMissingRequiredDocs(admin, user.tenantId, CAP), readDocIntelJobs(admin, user.tenantId, CAP)]);
      modules.push("documents");
    } catch { unavailable.push("documents"); }
  } else { unavailable.push("documents"); }

  // ---- Deterministic budgeting: per-module caps by question class ----
  const attention = capTo(attentionAll, "ocean"); // attention is cross-modal; cap under the transport budget
  const upcoming = capTo(upcomingAll, "ocean");
  const blockedCustoms = capTo(blockedAll, "customs");
  const overdueInvoices = capTo(overdueAll, "finance");
  const missingDocs = capTo(missingAll, "documents");
  const docIntelJobs = capTo(docIntelAll, "documents");

  // ---- Portfolio risk projection (reuses assessRisk over the gathered signals) ----
  const portfolioRisk = assemblePortfolioRisk({ attention, blockedCustoms, overdueInvoices, missingDocs }, RISK_CAP);

  // ---- Grounded customer-notification opportunities (recommendation only; no contact values) ----
  const notifyOpportunities: CopilotNotifyOpportunity[] = [
    ...upcoming.filter((u) => u.mode === "ocean" || u.mode === "air").map((u): CopilotNotifyOpportunity => ({ mode: u.mode, reference: u.reference, clientName: u.clientName, reason: `Arrivée imminente (${u.at.slice(0, 10)})`, alreadyNotified: false, link: u.link })),
    ...attention.filter((a) => a.mode === "customs").map((a): CopilotNotifyOpportunity => ({ mode: a.mode, reference: a.reference, clientName: a.clientName, reason: a.reason, alreadyNotified: false, link: a.link })),
  ].slice(0, caps.ocean);

  const consulted = uniq(modules);
  return {
    generatedAt,
    questionClass,
    modules: consulted,
    unavailable: uniq(unavailable).filter((m) => !consulted.includes(m)),
    authorized,
    headline,
    attention,
    upcoming,
    blockedCustoms,
    overdueInvoices,
    missingDocs,
    docIntelJobs,
    portfolioRisk,
    notifyOpportunities,
    docReview,
    truncated: uniq(truncated),
    counts: { attention: attention.length, upcoming: upcoming.length, blockedCustoms: blockedCustoms.length, overdueInvoices: overdueInvoices.length, missingDocs: missingDocs.length, docIntelJobs: docIntelJobs.length, portfolioRisk: portfolioRisk.length, cap: CAP },
  };
}
