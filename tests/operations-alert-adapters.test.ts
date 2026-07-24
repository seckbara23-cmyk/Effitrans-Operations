/**
 * Phase 10.0E-2 — Initial alert adapters. The pure projection logic (the shared
 * alertFrom builder + the Command Center code/entity mapping) is exercised DIRECTLY;
 * each adapter and its source/gate/codes/redaction are verified STRUCTURALLY (source
 * reader only, self-gate, approved codes, no risk scoring, no personal signal, no
 * amounts/errors/recipients, registry of seven, omitted-vs-unavailable-vs-zero).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { alertFrom } from "@/lib/operations/alerts/adapters/shared";
import { codeFor, entityFromLink } from "@/lib/operations/alerts/adapters/command-center-mapping";
import { ALERT_CODES, ALERT_CODE_PATTERN } from "@/lib/operations/alerts/codes";
import type { UnifiedAlert } from "@/lib/logistics/compose";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const dir = "../lib/operations/alerts/adapters/";
const RISK = code(dir + "risk.ts");
const CC = code(dir + "command-center.ts");
const FINREQ = code(dir + "finance-requests.ts");
const RECON = code(dir + "reconciliation.ts");
const RECV = code(dir + "receivables.ts");
const COMMS = code(dir + "communications.ts");
const MSG = code(dir + "messaging.ts");
const READER = code(dir + "../reader.ts");
const ALL = [RISK, CC, FINREQ, RECON, RECV, COMMS, MSG];

const ua = (over: Partial<UnifiedAlert> = {}): UnifiedAlert => ({
  mode: "road", severity: "warning", reference: "F-1", clientName: "ACME",
  reason: "Livraison routière en retard", link: "/files/00000000-0000-0000-0000-000000000001",
  ...over,
});

// ================================================================ pure: shared builder ====
describe("alertFrom — uniform projection, no leakage by construction", () => {
  it("defaults sourceSeverity to level and omits optional metadata when absent", () => {
    const a = alertFrom({ level: "high", domain: "finance", reason: "R", href: "/finance" });
    expect(a).toMatchObject({ level: "high", sourceSeverity: "high", domain: "finance", reason: "R", href: "/finance", origin: "finance", reference: null, clientName: null, occurredAt: null });
    expect(a.code).toBeUndefined();
    expect(a.entityType).toBeUndefined();
    expect(a.entityId).toBeUndefined();
  });
  it("carries code/entity when supplied (entityId is metadata, never in reason)", () => {
    const a = alertFrom({ level: "critical", domain: "operations", code: "operations.dossier.risk_critical", reason: "Risque", href: "/files/x", entityType: "dossier", entityId: "abc" });
    expect(a.code).toBe("operations.dossier.risk_critical");
    expect(a.entityId).toBe("abc");
    expect(a.reason).not.toContain("abc");
  });
});

// ================================================================ pure: Command Center mapping ====
describe("Command Center code mapping — grounded literals only, no arbitrary-text inference", () => {
  it("maps the fixed road literals", () => {
    expect(codeFor(ua({ mode: "road", reason: "Livraison routière en retard" }))).toBe("transport.delivery.overdue");
    expect(codeFor(ua({ mode: "road", reason: "POD requis" }))).toBe("transport.pod.owed");
  });
  it("maps the customs categories (severity + grounded category words)", () => {
    expect(codeFor(ua({ mode: "customs", severity: "critical", reason: "2 déclaration(s) bloquée(s) / rejetée(s)" }))).toBe("customs.declaration.blocked");
    expect(codeFor(ua({ mode: "customs", severity: "warning", reason: "3 en inspection" }))).toBe("customs.inspection.pending");
    expect(codeFor(ua({ mode: "customs", severity: "warning", reason: "1 en attente de paiement" }))).toBe("customs.payment.awaited");
  });
  it("leaves ocean/air UNCODED — their source code was dropped, message is variable (§2)", () => {
    expect(codeFor(ua({ mode: "ocean", reason: "Retard d'escale significatif" }))).toBeUndefined();
    expect(codeFor(ua({ mode: "air", reason: "Suivi ancien" }))).toBeUndefined();
  });
  it("extracts entity identity only from the fixed link shapes", () => {
    expect(entityFromLink("/files/00000000-0000-0000-0000-000000000001")).toEqual({ entityType: "dossier", entityId: "00000000-0000-0000-0000-000000000001" });
    expect(entityFromLink("/shipping/shipments/s9")).toEqual({ entityType: "shipment", entityId: "s9" });
    expect(entityFromLink("/air/shipments/a7")).toEqual({ entityType: "shipment", entityId: "a7" });
    expect(entityFromLink("/customs/intelligence")).toEqual({}); // aggregate customs → code-only dedupe
  });
  it("every code produced by the mapping is a real approved code", () => {
    for (const c of [
      codeFor(ua({ mode: "road", reason: "Livraison routière en retard" })),
      codeFor(ua({ mode: "road", reason: "POD requis" })),
      codeFor(ua({ mode: "customs", reason: "x bloquée" })),
      codeFor(ua({ mode: "customs", reason: "x inspection" })),
      codeFor(ua({ mode: "customs", reason: "x paiement" })),
    ]) {
      expect(c).toBeDefined();
      expect(ALERT_CODES).toContain(c!);
    }
  });
});

// ================================================================ registry ====
describe("registry — exactly the seven ratified adapters, stable keys", () => {
  const INDEX = code(dir + "index.ts");
  it("index registers the seven adapters in the ratified order", () => {
    const order = ["riskAdapter", "commandCenterAdapter", "financeRequestsAdapter", "reconciliationAdapter", "receivablesAdapter", "communicationsAdapter", "messagingAdapter"];
    let last = -1;
    for (const a of order) {
      const at = INDEX.indexOf(a);
      expect(at, a).toBeGreaterThan(last);
      last = at;
    }
    expect(INDEX).toContain("ALERT_ADAPTERS");
  });
  it("each adapter declares its stable key + a load + an available gate", () => {
    const src: Record<string, string> = { risk: RISK, "command-center": CC, "finance-requests": FINREQ, reconciliation: RECON, receivables: RECV, communications: COMMS, messaging: MSG };
    for (const [key, s] of Object.entries(src)) {
      expect(s, key).toContain(`key: "${key}"`);
      expect(s, key).toMatch(/async load\(/);
      expect(s, key).toContain("available:");
    }
  });
  it("the reader consumes the registry (architecture unchanged)", () => {
    expect(READER).toContain("ALERT_ADAPTERS");
    expect(READER).toContain("const ADAPTERS = ALERT_ADAPTERS");
  });
});

// ================================================================ per-adapter gates ====
describe("each adapter enforces ONLY its source permission (no new alerts permission)", () => {
  const GATE: Record<string, string> = {
    risk: "analytics:read", "command-center": "transport:read", "finance-requests": "finance:read",
    reconciliation: "finance:read", receivables: "finance:read", communications: "communication:read",
    messaging: "messaging:manage",
  };
  it("declares the ratified gate per adapter", () => {
    const src: Record<string, string> = { risk: RISK, "command-center": CC, "finance-requests": FINREQ, reconciliation: RECON, receivables: RECV, communications: COMMS, messaging: MSG };
    for (const [key, perm] of Object.entries(GATE)) {
      expect(src[key], key).toContain(`hasPermission(ctx.permissions, "${perm}")`);
    }
  });
  it("no adapter invents an alerts:* / global gate", () => {
    for (const s of ALL) expect(s).not.toMatch(/alerts?:read|operations:alerts/);
  });
});

// ================================================================ risk adapter doctrine ====
describe("risk adapter — consumes CT output, never scores", () => {
  it("reads getControlTower(attentionQueue), NOT the risk engine directly", () => {
    expect(RISK).toContain("getControlTower");
    expect(RISK).toContain("attentionQueue");
    for (const banned of ["assessRisk", "RISK_POINTS", "riskLevel", "risk-engine"]) expect(RISK).not.toContain(banned);
  });
  it("emits only the two canonical risk codes and a dossier href, no invented timestamp", () => {
    expect(RISK).toContain('"operations.dossier.risk_critical"');
    expect(RISK).toContain('"operations.dossier.risk_high"');
    expect(RISK).toContain("`/files/${r.fileId}`");
    expect(RISK).not.toContain("occurredAt:"); // AttentionRiskItem has no timestamp
    expect(RISK).not.toContain("new Date(");
  });
});

// ================================================================ finance-family redaction ====
describe("finance adapters — presence-only, redacted, dark ⇒ unavailable", () => {
  it("finance-requests: three codes, dark-null throws (unavailable), NO amounts/threshold", () => {
    for (const c of ["finance.request.pending_review", "finance.request.approved_not_disbursed", "finance.disbursement.evidence_owed"]) expect(FINREQ).toContain(`"${c}"`);
    expect(FINREQ).toContain("q === null) throw new Error"); // dark ⇒ unavailable, not zero
    expect(FINREQ).not.toContain("pendingAmounts");
    expect(FINREQ).not.toMatch(/amount|montant\b/i);
  });
  it("reconciliation: three codes, no payment reference / provider payload in text", () => {
    for (const c of ["finance.reconciliation.missing_reference", "finance.intent.failed", "finance.reconciliation.pending"]) expect(RECON).toContain(`"${c}"`);
    expect(RECON).not.toContain("providerReference");
    expect(RECON).not.toContain("lastError");
    expect(RECON).not.toContain("checkoutUrl");
  });
  it("receivables: SAME source as the KPI (getFinanceQueue + overdueRowsAtTenantDay), count-only, no amount", () => {
    expect(RECV).toContain("getFinanceQueue");
    expect(RECV).toContain("overdueRowsAtTenantDay");
    expect(RECV).toContain('"finance.receivable.overdue"');
    expect(RECV).toContain("return []"); // truthful zero when none overdue
    expect(RECV).not.toMatch(/\.amount\b|montant|toLocaleString/);
    expect(RECV).not.toContain("clientName");
  });
});

// ================================================================ comms + messaging ====
describe("communications + messaging — bounded, redacted, personal signal excluded", () => {
  it("communications uses the bounded head-count helper, never row content", () => {
    expect(COMMS).toContain("countCommunications");
    expect(COMMS).toContain('"messaging.communication.failed"');
    expect(COMMS).not.toContain("last_error");
    expect(COMMS).not.toContain("lastError");
    expect(COMMS).not.toContain("listCommunications"); // not the full-row reader
  });
  it("the count helper reads a head-count only (no row payload)", () => {
    const svc = code(dir + "../../../comms/service.ts");
    expect(svc).toContain("export async function countCommunications");
    expect(svc).toMatch(/\{ count: "exact", head: true \}/);
  });
  it("messaging uses tenant-operational counts and NEVER the personal unread reader (DEC-B56)", () => {
    expect(MSG).toContain("getMessagingDashboardSummary");
    expect(MSG).toContain('"messaging.conversation.urgent"');
    expect(MSG).toContain('"messaging.conversation.awaiting_reply"');
    expect(MSG).not.toContain("unreadStaffMessagingCount");
    expect(MSG).not.toContain("listStaffConversations");
  });
});

// ================================================================ cross-cutting doctrine ====
describe("cross-cutting — availability contract, codes, no mutations/Realtime/legacy", () => {
  it("every produced code literal is approved + pattern-valid", () => {
    const codeLiterals = ALL.join("\n").match(/"[a-z]+(?:\.[a-z_]+){2}"/g) ?? [];
    expect(codeLiterals.length).toBeGreaterThan(5);
    for (const lit of codeLiterals) {
      const c = lit.slice(1, -1);
      expect(c, c).toMatch(ALERT_CODE_PATTERN);
      expect(ALERT_CODES, c).toContain(c);
    }
  });
  it("source failure is surfaced by throwing — never swallowed into an empty list", () => {
    // The two nullable sources throw on their sentinel; none catches its source reader.
    expect(FINREQ).toContain("throw new Error");
    expect(MSG).toContain("throw new Error");
    for (const s of ALL) expect(s).not.toMatch(/\.catch\(\(\) => \[\]\)/);
  });
  it("no mutations, no server action, no revalidate, no Realtime/polling, no legacy analytics", () => {
    for (const s of ALL) {
      expect(s).not.toMatch(/\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
      expect(s).not.toContain('"use server"');
      expect(s).not.toContain("revalidatePath");
      expect(s).not.toMatch(/\.channel\(|\.subscribe\(|setInterval/);
      expect(s).not.toContain("getExecutiveAnalytics");
    }
  });
  it("adapters do not re-implement the shared engine (no normalizeSeverity/SEVERITY_MAP definitions)", () => {
    for (const s of ALL) {
      expect(s).not.toContain("function normalizeSeverity");
      expect(s).not.toContain("SEVERITY_MAP =");
    }
    // The CC adapter REUSES the shared normalizer for its raw severity tokens.
    expect(CC).toContain("normalizeSeverity(a.severity)");
  });
  it("only receivables issues a bounded metadata read (organization.timezone); no adapter scans business tables broadly", () => {
    // The only `.from(` in the whole adapter set is receivables' single-row timezone read.
    const froms = ALL.flatMap((s) => [...s.matchAll(/\.from\("([^"]+)"\)/g)].map((m) => m[1]));
    expect(froms).toEqual(["organization"]);
  });
});
