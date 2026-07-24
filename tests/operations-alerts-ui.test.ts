/**
 * Phase 10.0E-3 — Cockpit alert panel rewire. The panel + page are server components,
 * verified STRUCTURALLY (the house idiom): /dashboard consumes the unified
 * getOperationalAlerts() set through the ONE preserved CockpitAttentionPanel; the old
 * Command-Center-only list is gone; source availability is honest; the UI trusts the
 * engine (no re-dedupe / re-sort / re-count / severity remap); no code/entityId/source
 * key is rendered; Control Tower analysis detail remains.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PANEL = code("../components/operations/cockpit-attention-panel.tsx");
const SECTIONS = code("../components/operations/cockpit-sections.tsx");
const SUPPORTING = code("../components/operations/dashboard-supporting.tsx");

// ================================================================ unified source ====
describe("the cockpit consumes the unified operational alert set (10.0E-3)", () => {
  it("/dashboard fetches getOperationalAlerts() and feeds it to the panel", () => {
    expect(SECTIONS).toContain("getOperationalAlerts");
    expect(SECTIONS).toContain("<CockpitAttentionPanel set={alertSet} />");
    expect(PANEL).toContain("set: OperationalAlertSet | null");
  });
  it("the panel no longer depends on the Command-Center-only cockpit.alerts input", () => {
    expect(SECTIONS).not.toContain("alerts={c.alerts}");
    expect(SECTIONS).not.toContain("c.alerts &&");
    expect(PANEL).not.toContain("CockpitAlerts"); // old 10.0C input type gone
  });
  it("the alert reader is failure-isolated so the rest of /dashboard still renders", () => {
    expect(SECTIONS).toContain("getOperationalAlerts().catch(() => null)");
  });
  it("neither the page nor the panel calls a source reader or an adapter directly", () => {
    for (const src of [SECTIONS, PANEL]) {
      expect(src).not.toContain("getAdminSupabaseClient");
      expect(src).not.toMatch(/\.from\(/);
      for (const reader of ["getControlTower", "getCommandCenter", "getReconciliation", "getFinanceRequestQueue", "getFinanceQueue", "countCommunications", "getMessagingDashboardSummary"]) {
        expect(src, reader).not.toContain(reader);
      }
      expect(src).not.toMatch(/alerts\/adapters/);
    }
  });
});

// ================================================================ one-list rule ====
describe("exactly one primary cockpit alert list", () => {
  it("renders a single CockpitAttentionPanel", () => {
    expect(SECTIONS.match(/<CockpitAttentionPanel\b/g) ?? []).toHaveLength(1);
  });
  it("the Control Tower management-analysis detail remains (NOT suppressed this phase)", () => {
    expect(SUPPORTING).toContain("<ControlTower data={controlTower}");
    // Its risk/SLA/funnel/delayed tables are still rendered (component unchanged).
  });
});

// ================================================================ source availability (DEC-B58) ====
describe("truthful source-availability states", () => {
  it("a null set (reader failed) ⇒ « Alertes temporairement indisponibles », never « 0 alertes »", () => {
    expect(PANEL).toContain("if (!set)");
    expect(PANEL).toContain("Alertes temporairement indisponibles");
    expect(PANEL).toContain("CockpitUnavailableState");
    expect(PANEL).not.toContain("0 alertes");
  });
  it("no alerts + a permitted source unavailable ⇒ unavailable (cannot claim zero)", () => {
    expect(PANEL).toContain('s.status === "unavailable"');
    expect(PANEL).toMatch(/alerts\.length === 0 && anyUnavailable/);
  });
  it("no alerts + all permitted sources ok ⇒ a truthful empty state", () => {
    expect(PANEL).toContain('s.status === "ok"');
    expect(PANEL).toContain("Aucune alerte opérationnelle");
  });
  it("omitted-only (no readable source, permission-shaped) ⇒ the panel is omitted, NO warning", () => {
    expect(PANEL).toContain("alerts.length === 0 && !anyOk) return null");
  });
  it("some sources unavailable alongside alerts ⇒ a quiet partial warning, no internal keys named", () => {
    expect(PANEL).toContain("anyUnavailable && <PartialWarning");
    expect(PANEL).toContain("Certaines sources d'alerte sont temporairement indisponibles");
    // The warning never lists a source key / adapter name.
    for (const key of ["risk", "command-center", "finance-requests", "reconciliation", "receivables", "communications", "messaging"]) {
      expect(PANEL).not.toContain(`"${key}"`);
    }
  });
  it("the partial warning is accessible (role=status)", () => {
    expect(PANEL).toContain('role="status"');
  });
});

// ================================================================ presentation ====
describe("presentation trusts the engine — no UI-side dedupe/sort/recount/remap", () => {
  it("caps the primary list at 8 and keeps « N autres »", () => {
    expect(PANEL).toContain("PRIMARY_CAP = 8");
    expect(PANEL).toContain("alerts.slice(0, PRIMARY_CAP)");
    expect(PANEL).toContain("autre(s) alerte(s)");
  });
  it("uses the supplied counts and order verbatim (no re-sort, no re-count, no dedupe)", () => {
    expect(PANEL).toContain("counts.critical");
    expect(PANEL).not.toContain(".sort(");
    expect(PANEL).not.toContain("dedupe");
    expect(PANEL).not.toContain("countAlertsByLevel");
    expect(PANEL).not.toContain("normalizeSeverity");
  });
  it("severity is shown by label AND dot (not colour alone) — accessibility preserved", () => {
    expect(PANEL).toContain("LEVEL_LABEL");
    expect(PANEL).toContain("LEVEL_DOT");
  });
});

// ================================================================ privacy ====
describe("privacy — only safe normalized fields render", () => {
  it("never renders code, entityId, source severity, or an internal source key as content", () => {
    expect(PANEL).not.toContain("a.code");
    expect(PANEL).not.toContain("a.entityId");
    expect(PANEL).not.toContain("a.sourceSeverity");
    expect(PANEL).not.toContain("a.domain");
    expect(PANEL).not.toMatch(/>\s*\{a\.origin\}/); // origin never rendered as text
  });
  it("renders only level / reason / reference / clientName / href", () => {
    for (const f of ["a.level", "a.reason", "a.reference", "a.clientName", "a.href"]) expect(PANEL).toContain(f);
  });
  it("no raw UUID / payment reference / email / provider error string is emitted by the panel", () => {
    expect(PANEL).not.toMatch(/lastError|providerReference|checkoutUrl/);
    expect(PANEL).not.toMatch(/[a-z0-9]@[a-z]/i); // an actual email (not the "@/lib" import alias)
  });
});

// ================================================================ doctrine ====
describe("doctrine — computed-only, no Realtime/polling/mutations, no new gate", () => {
  it("the panel does no permission checks (it trusts the permission-shaped set)", () => {
    expect(PANEL).not.toContain("hasPermission");
    expect(PANEL).not.toContain("assertPermission");
  });
  it("no Realtime, no polling, no mutations in the rewired surfaces", () => {
    for (const src of [PANEL, SECTIONS]) {
      expect(src).not.toMatch(/\.channel\(|\.subscribe\(|setInterval/);
      expect(src).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
      expect(src).not.toContain('"use server"');
      expect(src).not.toContain("revalidatePath");
    }
  });
});
