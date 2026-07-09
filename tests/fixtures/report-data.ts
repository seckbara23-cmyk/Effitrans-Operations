/**
 * Deterministic BI / Control Tower / Analytics fixtures for the reporting tests
 * (Phase 3.0B). NOT a test file — imported by tests/reports-*.test.ts.
 */
import type { BusinessIntelligence } from "@/lib/bi/service";
import type { ControlTowerData } from "@/lib/control-tower/service";
import type { AnalyticsData } from "@/lib/analytics/types";

export const BI: BusinessIntelligence = {
  canFinance: true,
  currency: "XOF",
  revenue: { thisMonth: 1_000_000, lastMonth: 800_000, ytd: 12_000_000, outstanding: 500_000, collectedThisMonth: 900_000, avgInvoiceValue: 250_000 },
  activeClients: 3,
  clients: [
    { clientId: "c1", clientName: "ACME SARL", revenue: 5_000_000, shipments: 4, outstanding: 500_000, avgPaymentDelayDays: 12.5, lastActivity: "2026-06-01T00:00:00.000Z" },
    { clientId: "c2", clientName: "Globex", revenue: 3_000_000, shipments: 2, outstanding: 0, avgPaymentDelayDays: null, lastActivity: null },
  ],
  topOverdueClients: [{ clientName: "ACME SARL", outstanding: 500_000 }],
  aging: { b0_30: 100_000, b31_60: 200_000, b61_90: 100_000, b90p: 100_000, total: 500_000, count: 4 },
  productivity: {
    documentation: { processed: 10, verified: 8 },
    customs: { declarations: 5, releases: 4, avgClearanceDays: 3.2 },
    transport: { delivered: 6, podReceived: 5, podRate: 83, avgDeliveryDays: 2.1 },
    finance: { invoicesIssued: 7, paymentsRecorded: 6, collectionRate: 90 },
  },
};

export const CT: ControlTowerData = {
  funnel: { draft: 1, documents: 2, customs: 1, transport: 1, delivered: 1, invoiced: 0, paid: 0, archived: 3 },
  flow: { documentation: 2, customs: 1, transport: 1, finance: 0, archive: 3 },
  aging: { b0_2: 2, b3_5: 1, b6_10: 1, b10p: 1 },
  bottlenecks: [{ key: "customs_inspection", label: "Dossiers en inspection douanière", count: 1 }],
  needsAttention: [],
  kpis: { activeDossiers: 5, deliveredThisMonth: 2, revenueThisMonth: 1_000_000, outstanding: 500_000, avgCustomsDays: 3.2, avgDeliveryDays: 2.1, currency: "XOF" },
  slaByDept: {
    documentation: { normal: 3, warning: 1, critical: 0 },
    customs: { normal: 2, warning: 0, critical: 1 },
    transport: { normal: 2, warning: 1, critical: 0 },
    finance: { normal: 1, warning: 0, critical: 0 },
  },
  delayed: [],
  slaRanking: [],
  avgTimes: { documentationDays: null, customsDays: 3.2, transportDays: 2.1, timeToInvoiceDays: null, timeToPaymentDays: null },
  canFinance: true,
  attentionQueue: [
    { fileId: "f1", fileNumber: "EFT-IMP-2026-00001", clientName: "ACME SARL", department: "customs", level: "high", score: 55, primaryReason: "SLA critique — étape dépassée", priority: "high", ageDays: 7 },
  ],
  riskKpis: { critical: 1, high: 2, slaBreaches: 1, overdueFinance: 1 },
  dossiers: [
    { fileNumber: "EFT-IMP-2026-00001", clientName: "ACME SARL", type: "IMP", priority: "high", fileStatus: "IN_PROGRESS", currentDepartment: "customs", lifecycleStage: "customs_inspection", riskLevel: "high", riskScore: 55, slaStatus: "critical", daysOpen: 7, customsStatus: "INSPECTION", transportStatus: null, paymentStatus: "Current", outstanding: 500_000 },
    { fileNumber: "EFT-EXP-2026-00002", clientName: "Globex", type: "EXP", priority: "normal", fileStatus: "OPENED", currentDepartment: "documentation", lifecycleStage: "documents_collection", riskLevel: "low", riskScore: 10, slaStatus: "normal", daysOpen: 2, customsStatus: null, transportStatus: null, paymentStatus: "None", outstanding: 0 },
  ],
};

export const ANALYTICS: AnalyticsData = {
  currency: "XOF",
  financial: { revenueThisMonth: 1_000_000, revenueYtd: 12_000_000, outstanding: 500_000, overdue: 100_000, invoicesIssuedThisMonth: 3, collectionRate: 90 },
  operations: { active: 5, newThisMonth: 2, delivered: 2, closed: 3, highPriority: 1, blocked: 0 },
  customs: { pending: 1, underReview: 0, inspection: 1, released: 4, avgReleaseDays: 3.2 },
  transport: { planned: 1, inTransit: 1, delivered: 6, podReceived: 5, onTimePct: 80 },
  portal: { users: 2, activeClients: 2, sharedDocuments: 3, downloads: 1, invoiceViews: 1 },
  team: { openTasks: 4, completedTasks: 10, customsReleases: 4, invoicesIssued: 7, avgClosureDays: 5.5 },
  charts: { revenueTrend: null, statusDistribution: [], revenueByClient: null, customsPipeline: [], transportPipeline: [] },
};

/** Decode raw export bytes as Latin-1 for substring assertions. */
export function latin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}
