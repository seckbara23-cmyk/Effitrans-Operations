/**
 * Logistics Copilot — context builder (Phase 7.6A). SERVER-ONLY.
 * ---------------------------------------------------------------------------
 * Assembles a BOUNDED, READ-ONLY, permission-degraded snapshot for the copilot. It composes the
 * EXISTING bounded readers (the Command Center, customs declarations, overdue invoices) — no new
 * domain calculation, no write path in the module graph. Every source is page-0 and ≤ CAP; the
 * tenant is never fully scanned. A section the caller can't read (or that fails) is recorded in
 * `unavailable` so the copilot says "not available" rather than "nothing found" (Missing ≠ Negative).
 */
import "server-only";
import { assertPermission } from "@/lib/auth/require-permission";
import { getEffectivePermissions, hasPermission } from "@/lib/rbac/permissions";
import { getCommandCenter } from "@/lib/logistics/reader";
import { listDeclarations } from "@/lib/customs/intelligence/service";
import { getFinanceQueue } from "@/lib/finance/service";
import type { CopilotAlert, CopilotDeclaration, CopilotInvoice, CopilotUpcoming, LogisticsContext, LogisticsModule } from "./types";

const CAP = 100;
const BLOCKED_CUSTOMS = ["REJECTED", "CANCELLED", "AWAITING_PAYMENT"];

const uniq = <T,>(a: T[]): T[] => Array.from(new Set(a));

export async function buildLogisticsCopilotContext(): Promise<LogisticsContext> {
  const user = await assertPermission("logistics:copilot:read"); // gate (throws → 403 in the route)
  const perms = await getEffectivePermissions(user.id);
  const authorized = {
    transport: hasPermission(perms, "transport:read"),
    customs: hasPermission(perms, "customs:read"),
    finance: hasPermission(perms, "finance:read"),
    document: hasPermission(perms, "document:read"),
  };

  const generatedAt = new Date().toISOString();
  const modules: LogisticsModule[] = [];
  const unavailable: LogisticsModule[] = [];

  // ---- Layer A: the Command Center (road/ocean/air overview + customs/doc indicators) ----
  let attention: CopilotAlert[] = [];
  let upcoming: CopilotUpcoming[] = [];
  let headline: LogisticsContext["headline"] = null;
  let docReview: LogisticsContext["docReview"] = null;
  if (authorized.transport) {
    try {
      const cc = await getCommandCenter();
      headline = cc.headline;
      attention = cc.attention.map((a): CopilotAlert => ({ mode: a.mode, severity: a.severity, reference: a.reference, clientName: a.clientName, reason: a.reason, link: a.link }));
      upcoming = cc.upcoming.map((u): CopilotUpcoming => ({ mode: u.mode, reference: u.reference, clientName: u.clientName, route: u.route, at: u.at, status: u.status, link: u.link }));
      docReview = cc.docIntel;
      modules.push("road", "ocean", "air");
    } catch {
      unavailable.push("road", "ocean", "air");
    }
  } else {
    unavailable.push("road", "ocean", "air");
  }

  // ---- Layer B: blocked customs declarations (real citations) ----
  let blockedCustoms: CopilotDeclaration[] = [];
  if (authorized.customs) {
    try {
      const page = await listDeclarations({}, 0, CAP); // page 0, ≤ CAP — never a full-tenant scan
      blockedCustoms = page.items
        .filter((d) => BLOCKED_CUSTOMS.includes(d.status))
        .map((d): CopilotDeclaration => ({ reference: d.reference, fileNumber: d.fileNumber, clientName: d.clientName, office: d.office, status: d.status, link: `/files/${d.fileId}` }));
      modules.push("customs");
    } catch {
      unavailable.push("customs");
    }
  } else {
    unavailable.push("customs");
  }

  // ---- Layer B: overdue invoices (finance-gated, separate from operational visibility) ----
  let overdueInvoices: CopilotInvoice[] = [];
  if (authorized.finance) {
    try {
      const queue = await getFinanceQueue();
      overdueInvoices = queue
        .filter((i) => i.overdue)
        .slice(0, CAP)
        .map((i): CopilotInvoice => ({ invoiceNumber: i.invoiceNumber, fileNumber: i.fileNumber, clientName: i.clientName, balance: i.balance, currency: i.currency, dueDate: i.dueDate, link: `/files/${i.fileId}` }));
      modules.push("finance");
    } catch {
      unavailable.push("finance");
    }
  } else {
    unavailable.push("finance");
  }

  // ---- Document intelligence indicator (from the Command Center) ----
  if (authorized.document && docReview) modules.push("documents");
  else if (!authorized.document) unavailable.push("documents");

  const consulted = uniq(modules);
  return {
    generatedAt,
    modules: consulted,
    unavailable: uniq(unavailable).filter((m) => !consulted.includes(m)),
    authorized,
    headline,
    attention,
    upcoming,
    blockedCustoms,
    overdueInvoices,
    docReview,
    counts: { attention: attention.length, upcoming: upcoming.length, blockedCustoms: blockedCustoms.length, overdueInvoices: overdueInvoices.length, cap: CAP },
  };
}
