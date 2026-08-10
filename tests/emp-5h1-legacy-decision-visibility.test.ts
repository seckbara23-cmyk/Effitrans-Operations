/**
 * EMP-5H.1 — Legacy Decision Visibility & Duplicate-Submission Guard.
 * ---------------------------------------------------------------------------
 * Production incident: recordLegacyActiveDecision WORKED (three identical
 * ec.mailbox.legacy_decision audit rows persisted), but the mailbox surface
 * gave no visible difference between a saved and a lost decision — so the same
 * decision was recorded three times, and the operator reported a persistence
 * failure that never happened.
 *
 * The contract pinned here:
 *   1. the recorded decision is now VISIBLE where it was taken — read from the
 *      audit trail (the single store; no second decision table, nothing
 *      duplicated onto ec_mailbox), rendered with decision/date/actor/reason;
 *   2. a successful submission shows an explicit success state and clears the
 *      reason field — success no longer looks like failure;
 *   3. an IDENTICAL repeat (same mailbox, decision, reason) is refused BEFORE
 *      writing — append-only history untouched, historical duplicates
 *      preserved, changed decision/reason still recordable;
 *   4. visibility changes NOTHING: the lifecycle/readiness model never reads
 *      the audit trail, and the action still writes no mailbox field.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ACTIONS = "lib/ec/mailboxes/admin-actions.ts";
const MEMBERSHIP = "lib/ec/mailboxes/membership.ts";
const PANEL = "components/ec/mailbox-admin-panel.tsx";
const PAGE = "app/admin/enterprise-mail/mailboxes/page.tsx";
const LIFECYCLE = "lib/ec/mailboxes/lifecycle.ts";

/** The body of one exported async function (to the next export or EOF). */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  const next = src.indexOf("export async function", start + 1);
  return src.slice(start, next === -1 ? src.length : next);
}

// ---------------------------------------------------------------------------
describe("the recorded decision is visible where it was taken", () => {
  it("the page reads the latest decision per legacy mailbox, server-side, and passes it down", () => {
    const p = code(PAGE);
    expect(p).toContain("latestLegacyDecisions(user.tenantId, legacyIds)");
    expect(p).toMatch(/legacyActive/);
    expect(p).toContain("legacyDecisions={legacyDecisions}");
  });

  it("the reader is tenant-scoped, audit-trail-only, and fail-open to empty (display-only)", () => {
    const body = fnBody(code(MEMBERSHIP), "latestLegacyDecisions");
    expect(body).toContain('from("audit_log")');
    expect(body).toContain('.eq("tenant_id", tenantId)');
    expect(body).toContain('"ec.mailbox.legacy_decision"');
    expect(body).toMatch(/if \(error \|\| !data\) return \{\}/);
    // No second decision store: the reader writes nothing, anywhere.
    expect(body).not.toMatch(/\.(insert|update|upsert|delete)\(/);
  });

  it("the panel renders decision, date, actor and reason FROM the persisted record", () => {
    const p = read(PANEL);
    expect(p).toContain("Décision enregistrée — aucune modification de la boîte");
    for (const origin of [
      "legacyDecisions[selected.id].decision",
      "legacyDecisions[selected.id].occurredAt",
      "legacyDecisions[selected.id].actorEmail",
      "legacyDecisions[selected.id].reason",
    ]) {
      expect(p).toContain(origin);
    }
    // The decision code renders through the SAME label list the select uses —
    // one vocabulary, no second copy.
    expect(p).toMatch(/LEGACY_DECISIONS\.find\(\(d\) => d\.value === legacyDecisions\[selected\.id\]\.decision\)/);
  });

  it("the block states what the decision does NOT do", () => {
    const p = read(PANEL);
    expect(p).toContain("ne vérifie pas la");
    // JSX apostrophes are &apos; entities in source.
    expect(p).toContain("n&apos;établit pas la provenance");
    expect(p).toContain("n&apos;active ni ne désactive rien");
    expect(p).toContain("ne modifie pas la boîte réelle");
    expect(p).toContain("journal d&apos;audit");
  });
});

// ---------------------------------------------------------------------------
describe("success no longer looks like failure", () => {
  const p = read(PANEL);

  it("run() carries an optional success message rendered like errors are", () => {
    expect(p).toMatch(/successMsg\?: string/);
    expect(p).toMatch(/else if \(successMsg\) setSuccess\(successMsg\)/);
    expect(p).toMatch(/\{success \? <p[^>]*role="status"/);
  });

  it("the legacy submit passes a success message and clears the reason on ok", () => {
    expect(p).toContain('"Décision enregistrée — elle apparaît dans l\'encadré « Décision "');
    expect(p).toMatch(/if \(r\.ok\) setLegacyReason\(""\)/);
  });

  it("every run() clears BOTH banners first — stale success can never survive a new action", () => {
    expect(p).toMatch(/setError\(null\);\s*setSuccess\(null\);/);
  });
});

// ---------------------------------------------------------------------------
describe("duplicate guard — identical repeats refused, new decisions recorded", () => {
  const body = fnBody(code(ACTIONS), "recordLegacyActiveDecision");

  it("reads the LATEST prior decision (tenant + mailbox scoped) BEFORE writing", () => {
    expect(body).toContain('from("audit_log")');
    expect(body).toContain('.eq("tenant_id", user.tenantId)');
    expect(body).toContain('.eq("entity_id", mailboxId)');
    expect(body).toMatch(/order\("occurred_at", \{ ascending: false \}\)/);
    expect(body).toContain(".limit(1)");
    expect(body.indexOf('from("audit_log")')).toBeLessThan(body.indexOf("writeAudit"));
  });

  it("refuses ONLY when decision AND reason both match; a changed act still records", () => {
    expect(body).toMatch(/priorAfter\.decision === decision && priorAfter\.reason === reason\.slice\(0, 500\)/);
    expect(body).toContain('"duplicate_decision"');
  });

  it("append-only semantics untouched: the guard never mutates the audit trail", () => {
    // The only new statement is a SELECT; the historical duplicates stay.
    expect(body).not.toMatch(/audit_log"\)[\s\S]{0,120}\.(update|delete|upsert|insert)\(/);
  });

  it("the refusal is explained to the operator, pointing at the visible record", () => {
    const p = read(PANEL);
    expect(p).toContain("duplicate_decision");
    expect(p).toContain("Cette décision identique est déjà enregistrée");
  });

  it("the EMP-5F safety property survives: the action still writes NO mailbox field", () => {
    for (const forbidden of ['.from("ec_mailbox")', ".update(", ".insert(", ".delete("]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
describe("authorization and state boundaries unchanged", () => {
  it("the action still gates on communication:mailbox:provision", () => {
    const body = fnBody(code(ACTIONS), "recordLegacyActiveDecision");
    expect(body).toContain('gate("communication:mailbox:provision")');
  });

  it("the decision FORM stays behind canProvision; the page still requires an admin authority", () => {
    const p = read(PANEL);
    // The literal section markers — "readiness checks" alone also appears in
    // the file's header comment, far earlier.
    const legacy = p.slice(p.indexOf("---- legacy-active remediation ----"), p.indexOf("---- readiness checks ----"));
    expect(legacy).toMatch(/canProvision \? \(/);
    const page = read(PAGE);
    expect(page).toContain("if (!canProvision && !canManageMembers) notFound()");
  });

  it("visibility feeds NO rule: the lifecycle authority never reads the audit trail", () => {
    expect(code(LIFECYCLE)).not.toContain("audit_log");
    // And the view builder's inputs are unchanged — no decision parameter.
    expect(read(LIFECYCLE)).not.toContain("legacyDecision");
  });
});
