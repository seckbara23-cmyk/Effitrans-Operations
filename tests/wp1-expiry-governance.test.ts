/**
 * CEO-ALIGNMENT WP1-E — governed expiry-date changes.
 * ---------------------------------------------------------------------------
 * Pure rules exercised directly; the database contract (migration #161) and
 * the action boundary asserted on COMMENT-STRIPPED source. The behaviour of
 * the RPCs, the governing trigger and the append-only history is proved
 * against a real database by supabase/tests/rls_wp1_opening_test.sql in CI.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  EXPIRY_MESSAGES_FR,
  EXPIRY_PROPOSAL_STATUSES,
  expiryHistoryLineFr,
  expiryMessageFr,
  expiryTierFor,
  summarizeExpiryHistory,
  validateExpiryDecision,
  validateExpiryRequest,
  type ExpiryHistoryEntry,
} from "@/lib/documents/expiry-change";
import { TENANT_SCOPED_TABLES } from "@/lib/db/tenant-tables";
import { AuditActions } from "@/lib/audit/events";
import { validateAuditEvent } from "@/lib/audit/validate";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (p: string) => read(p).replace(/--[^\n]*/g, "");
const MIG = sql("supabase/migrations/20261021000005_document_expiry_change.sql");

const fnBody = (name: string) => {
  const start = MIG.indexOf(`create or replace function public.${name}(`);
  return MIG.slice(start, MIG.indexOf("$$;", start));
};

describe("WP1-E — the two tiers", () => {
  it("verified evidence needs a proposal; anything unverified changes directly; superseded is closed", () => {
    for (const s of ["VERIFIED", "APPROVED", "CONSUMED_AS_EVIDENCE", "EXPIRED"]) expect(expiryTierFor(s)).toBe("PROPOSAL");
    for (const s of ["UPLOADED", "UNDER_REVIEW", "PENDING_REVIEW", "REJECTED"]) expect(expiryTierFor(s)).toBe("DIRECT");
    expect(expiryTierFor("SUPERSEDED")).toBe("CLOSED");
  });

  it("the application's tier list is EXACTLY the database's", () => {
    const lists = MIG.match(/status in \('VERIFIED', 'APPROVED', 'CONSUMED_AS_EVIDENCE', 'EXPIRED'\)/g) ?? [];
    // trigger + record RPC
    expect(lists.length).toBe(2);
    expect([...EXPIRY_PROPOSAL_STATUSES]).toEqual(["VERIFIED", "APPROVED", "CONSUMED_AS_EVIDENCE", "EXPIRED"]);
  });
});

describe("WP1-E — input rules (before the round trip)", () => {
  it("a reason is mandatory and bounded", () => {
    expect(validateExpiryRequest({ expiryDate: "2027-01-31", reason: "  " })).toEqual({ ok: false, error: "reason_required" });
    expect(validateExpiryRequest({ expiryDate: "2027-01-31", reason: "x".repeat(501) })).toEqual({ ok: false, error: "reason_too_long" });
    expect(validateExpiryRequest({ expiryDate: "2027-01-31", reason: " Date  du certificat " }))
      .toEqual({ ok: true, expiryDate: "2027-01-31", reason: "Date du certificat" });
  });

  it("a date is ISO or empty (« clear »), never anything else", () => {
    expect(validateExpiryRequest({ expiryDate: "31/01/2027", reason: "r" })).toEqual({ ok: false, error: "invalid_expiry_date" });
    expect(validateExpiryRequest({ expiryDate: "2027-02-30x", reason: "r" })).toEqual({ ok: false, error: "invalid_expiry_date" });
    expect(validateExpiryRequest({ expiryDate: "", reason: "r" })).toEqual({ ok: true, expiryDate: null, reason: "r" });
  });

  it("a refusal needs a reason; a confirmation does not; nothing else is a decision", () => {
    expect(validateExpiryDecision({ decision: "REJECTED", reason: "" })).toEqual({ ok: false, error: "reason_required" });
    expect(validateExpiryDecision({ decision: "CONFIRMED", reason: "" })).toEqual({ ok: true, decision: "CONFIRMED", reason: null });
    expect(validateExpiryDecision({ decision: "APPROVED", reason: "x" })).toEqual({ ok: false, error: "invalid_decision" });
  });
});

describe("WP1-E — every outcome the database can return has a French sentence", () => {
  const returned = [...new Set([...MIG.matchAll(/return '([a-z_]+)';/g)].map((m) => m[1]))];

  it("the RPCs return a known, closed set of codes", () => {
    expect(returned.sort()).toEqual([
      "already_decided", "applied", "confirmed", "document_superseded", "expiry_required",
      "expiry_unchanged", "invalid_decision", "not_found", "proposal_pending", "proposal_stale",
      "proposed", "reason_required", "reason_too_long", "rejected", "self_approval_forbidden",
    ]);
  });

  it("…each of which the operator reads in French, and the action passes through", () => {
    const actions = code("lib/documents/expiry-actions.ts");
    for (const c of returned) {
      expect(EXPIRY_MESSAGES_FR[c], c).toBeTruthy();
      expect(actions, c).toContain(`"${c}"`);
    }
    expect(expiryMessageFr("something_unknown")).toBe(EXPIRY_MESSAGES_FR.generic);
  });
});

describe("WP1-E — the history read model", () => {
  const row = (over: Partial<ExpiryHistoryEntry & { proposalId: string | null }>) => ({
    id: "h", kind: "APPLIED" as const, proposalId: null, oldExpiry: "2026-12-31", newExpiry: "2027-06-30",
    reason: "r", actorId: "u1", actorEmail: "u1@x", occurredAt: "2026-10-21T10:00:00Z", ...over,
  });

  it("a proposal is open until a decision points at it", () => {
    const open = summarizeExpiryHistory([row({ id: "p1", kind: "PROPOSED" })]);
    expect(open.pending?.id).toBe("p1");
    expect(open.pending?.proposerId).toBe("u1");
    const closed = summarizeExpiryHistory([
      row({ id: "p1", kind: "PROPOSED" }),
      row({ id: "d1", kind: "CONFIRMED", proposalId: "p1", actorId: "u2", occurredAt: "2026-10-21T11:00:00Z" }),
    ]);
    expect(closed.pending).toBeNull();
    expect(closed.recent[0].id).toBe("d1");
  });

  it("shows the three most recent entries, newest first", () => {
    const s = summarizeExpiryHistory([1, 2, 3, 4].map((n) => row({ id: `h${n}`, occurredAt: `2026-10-2${n}T00:00:00Z` })));
    expect(s.recent.map((e) => e.id)).toEqual(["h4", "h3", "h2"]);
  });

  it("each line names who, when, the move and the reason", () => {
    expect(expiryHistoryLineFr(row({}))).toBe("Échéance modifiée le 2026-10-21 par u1@x — 2026-12-31 → 2027-06-30 — r");
  });
});

describe("WP1-E — the database contract (migration #161)", () => {
  it("the history is append-only through the foundation's prevent_mutation()", () => {
    expect(MIG).toMatch(/create trigger trg_document_expiry_change_no_update\s+before update on public\.document_expiry_change\s+for each row execute function public\.prevent_mutation\(\);/);
    expect(MIG).toMatch(/create trigger trg_document_expiry_change_no_delete\s+before delete on public\.document_expiry_change\s+for each row execute function public\.prevent_mutation\(\);/);
  });

  it("an expiry date moves only with a matching history row in the same transaction", () => {
    expect(MIG).toMatch(/create trigger trg_document_expiry_governed\s+before update of expiry_date on public\.document/);
    const g = fnBody("govern_document_expiry_change");
    expect(g).toMatch(/c\.occurred_at = now\(\)/);
    expect(g).toMatch(/v_kind := case when v_verified then 'CONFIRMED' else 'APPLIED' end;/);
    expect(g).toMatch(/raise exception/);
  });

  it("the writers re-prove their actor (SERVICE lane) and are callable by the service role only", () => {
    expect(fnBody("record_document_expiry_change")).toMatch(/assert_actor_authority\(p_actor, p_tenant, 'document:update', 'SERVICE'\)/);
    expect(fnBody("decide_document_expiry_change")).toMatch(/assert_actor_authority\(p_actor, p_tenant, 'document:approve', 'SERVICE'\)/);
    for (const fn of ["record_document_expiry_change(uuid, uuid, uuid, date, text)", "decide_document_expiry_change(uuid, uuid, uuid, text, text)"]) {
      for (const role of ["public", "anon", "authenticated"]) {
        expect(MIG).toContain(`revoke execute on function public.${fn} from ${role};`);
      }
      // …and granted to service_role EXPLICITLY: a database without Supabase's
      // default privileges otherwise refuses the server too (CI-REPAIR-01).
      expect(MIG).toContain(`grant  execute on function public.${fn} to service_role;`);
    }
    expect(MIG).not.toMatch(/grant\s+execute\s+on\s+function\s+public\.(record|decide)_document_expiry_change[^;]*\bto\s+(public|anon|authenticated)\b/i);
    expect(MIG).toMatch(/raise exception 'MIGRATION FAILED: the expiry RPCs must be executable by service_role only'/);
  });

  it("maker ≠ checker: the proposer can never decide their own proposal", () => {
    const d = fnBody("decide_document_expiry_change");
    expect(d).toMatch(/if v_prop\.actor_id = p_actor then return 'self_approval_forbidden'; end if;/);
    // …and the check precedes any write.
    expect(d.indexOf("self_approval_forbidden")).toBeLessThan(d.indexOf("insert into public.document_expiry_change"));
  });

  it("no writer touches document.status", () => {
    for (const fn of ["record_document_expiry_change", "decide_document_expiry_change"]) {
      expect(fnBody(fn), fn).not.toMatch(/set\s+[^;]*\bstatus\s*=/i);
    }
  });

  it("read access is SELECT-only, scoped to the dossier's visibility", () => {
    expect(MIG).toMatch(/create policy document_expiry_change_select on public\.document_expiry_change\s+for select to authenticated/);
    expect(MIG).toMatch(/public\.has_permission\('document:read'\)\s+and public\.can_read_file\(file_id\)/);
    expect(MIG).not.toMatch(/for (insert|update|delete|all) to/i);
    expect(TENANT_SCOPED_TABLES.has("document_expiry_change")).toBe(true);
  });

  it("no validity duration is defined anywhere in this slice (DEC-CEO-04/05)", () => {
    expect(MIG).not.toMatch(/default_validity_days|has_validity\s*=/);
    expect(code("lib/documents/expiry-change.ts")).not.toMatch(/validity_days|VALIDITY_DAYS|addDays|\+\s*\d+\s*\*\s*86400/);
  });
});

describe("WP1-E — the action boundary", () => {
  const a = code("lib/documents/expiry-actions.ts");
  const req = a.slice(a.indexOf("export async function requestDocumentExpiryChange"), a.indexOf("export async function decideDocumentExpiryChange"));
  const dec = a.slice(a.indexOf("export async function decideDocumentExpiryChange"));

  it("request: document:update, input, schema, dossier visibility — then the RPC", () => {
    const order = ['assertPermission("document:update")', "validateExpiryRequest(input)", "await expiryGovernanceAvailable()", "isFileVisible(", '.rpc("record_document_expiry_change"'].map((s) => req.indexOf(s));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it("decide: document:approve, input, schema, dossier visibility — then the RPC", () => {
    const order = ['assertPermission("document:approve")', "validateExpiryDecision(", "await expiryGovernanceAvailable()", "isFileVisible(", '.rpc("decide_document_expiry_change"'].map((s) => dec.indexOf(s));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it("an RPC exception (authority, EFA*) surfaces as « forbidden », never as success", () => {
    expect(a).toContain('if (error.code?.startsWith("EFA") || /OPS-SEC-2A/.test(error.message)) return "forbidden";');
    expect(req).toContain("if (error) return { ok: false, error: mapRpcError(error) };");
    expect(dec).toContain("if (error) return { ok: false, error: mapRpcError(error) };");
  });

  it("is audited with attributed, validator-accepted events; a proposal is never recorded as the new expiry", () => {
    expect(req).toContain("action: AuditActions.DOCUMENT_EXPIRY_CHANGE_REQUESTED,");
    expect(req).toContain("{ proposed_expiry_date: check.expiryDate, outcome, file_id: doc.file_id }");
    expect(dec).toContain("action: AuditActions.DOCUMENT_EXPIRY_CHANGE_DECIDED,");
    for (const action of [AuditActions.DOCUMENT_EXPIRY_CHANGE_REQUESTED, AuditActions.DOCUMENT_EXPIRY_CHANGE_DECIDED]) {
      expect(() =>
        validateAuditEvent({
          action,
          actorId: "22222222-2222-4222-8222-222222222222",
          entityId: "11111111-1111-4111-8111-111111111111",
        }),
      ).not.toThrow();
    }
  });

  it("never writes the document table itself — only the RPCs do", () => {
    expect(a).not.toMatch(/from\("document"\)[\s\S]{0,300}\.(update|insert|upsert|delete)\(/);
  });

  it("the screen never offers « Confirmer » to the proposer", () => {
    const ui = code("components/documents/expiry-control.tsx");
    expect(ui).toContain("const mayDecide = !!proposal && canApprove && proposal.proposerId !== currentUserId;");
    expect(ui).toMatch(/\{mayDecide && \(/);
  });
});

describe("WP1-E — AUDIT-HARDENING-01 (independent audit of PR #51)", () => {
  it("F-1/F-8: the history is SELECT-only for every API role — explicitly, whatever the default privileges", () => {
    expect(MIG).toContain("revoke all on public.document_expiry_change from public, anon, authenticated, service_role;");
    expect(MIG).toContain("grant select on public.document_expiry_change to authenticated, service_role;");
    // The grant must follow the revoke, or the revoke would take it back.
    expect(MIG.indexOf("grant select on public.document_expiry_change")).toBeGreaterThan(
      MIG.indexOf("revoke all on public.document_expiry_change"),
    );
    expect(MIG).not.toMatch(/grant\s+(all|insert|update|delete|truncate)[^;]*\bon\s+(table\s+)?public\.document_expiry_change\b/i);
  });

  it("F-1/F-13: TRUNCATE is refused at statement level by the same prevent_mutation()", () => {
    expect(MIG).toMatch(
      /create trigger trg_document_expiry_change_no_truncate\s+before truncate on public\.document_expiry_change\s+for each statement execute function public\.prevent_mutation\(\);/,
    );
  });

  it("CI-REPAIR-02: no API role inserts into the history whatever its grants (EFX04), before any other check", () => {
    const c = fnBody("check_document_expiry_change");
    const guard = c.search(/if current_user in \('anon', 'authenticated', 'service_role'\) then\s+raise exception[^;]*using errcode = 'EFX04';/);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(c.indexOf("EFX02"));
    expect(MIG).toMatch(/create trigger trg_document_expiry_change_check\s+before insert on public\.document_expiry_change\s+for each row execute function public\.check_document_expiry_change\(\);/);
  });

  it("the migration refuses to finish on any other privilege matrix", () => {
    expect(MIG).toContain("raise exception 'MIGRATION FAILED: TRUNCATE on the history is not refused';");
    expect(MIG).toContain(
      "raise exception 'MIGRATION FAILED: the history must be readable by authenticated and service_role and writable by no API role';",
    );
  });

  it("F-3: confirming onto a document that left the verified tier is a result code, decided before any write", () => {
    const d = fnBody("decide_document_expiry_change");
    const guard = d.search(
      /if v_doc\.status not in \('VERIFIED', 'APPROVED', 'CONSUMED_AS_EVIDENCE', 'EXPIRED'\) then\s+return 'proposal_stale';/,
    );
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(d.indexOf("'CONFIRMED', p_proposal"));
    // The REJECT path is decided earlier, so a stale proposal can still be closed.
    expect(d.indexOf("return 'rejected';")).toBeLessThan(guard);
    // The database's verified tier is exactly the application's PROPOSAL tier.
    for (const s of ["VERIFIED", "APPROVED", "CONSUMED_AS_EVIDENCE", "EXPIRED"]) expect(expiryTierFor(s)).toBe("PROPOSAL");
    expect(EXPIRY_MESSAGES_FR.proposal_stale).toMatch(/vérification du document/);
  });

  it("F-4: the proposer cannot withdraw — a self-REJECT is refused like a self-CONFIRM, and the limit is documented", () => {
    const d = fnBody("decide_document_expiry_change");
    expect(d.indexOf("self_approval_forbidden")).toBeGreaterThan(-1);
    expect(d.indexOf("self_approval_forbidden")).toBeLessThan(d.indexOf("if p_decision = 'REJECTED' then"));
    expect(read("docs/releases/WP1/release-manifest.md")).toMatch(/cannot withdraw/);
  });

  it("the verifier asserts each hardening property", () => {
    const v = read("supabase/verifiers/20261021000005_document_expiry_change.verify.sql");
    expect(v).toContain("TRUNCATE on the history is refused by prevent_mutation() (statement level)");
    expect(v).toContain("no API role can INSERT into the history, whatever its grants");
    // CI-REPAIR-02: a verifier must not assert the ABSENCE of a grant — CI's
    // journey fixture grants service_role DML on every table after the RLS suites.
    expect(v.replace(/--[^\n]*/g, "")).not.toMatch(/not has_table_privilege/);
    expect(v).toContain("authenticated and service_role can read the history (SELECT)");
    expect(v).toContain("confirms only onto a document still in the verified tier");
  });
});
