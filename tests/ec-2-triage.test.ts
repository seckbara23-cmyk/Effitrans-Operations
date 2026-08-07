/**
 * EC-2 — Triage Workspace. Pins the ratified boundaries as hard as the
 * behaviour: quarantine semantics untouched, four outcomes only, nothing
 * created automatically, no HTML rendered, no permission granted.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  TRIAGE_OUTCOMES, TRIAGE_OUTCOME_FR, DISCARD_REASON_CODES, DISCARD_REASON_FR,
  TRIAGE_STATUS_FR, OPEN_TRIAGE_STATUSES, isOpen, isDiscardReasonCode,
  validateOutcome, suggestOutcome,
} from "@/lib/ec/triage/model";
import { EVENT_DOMAINS, EVENT_TYPES, getEventType } from "@/lib/workflow/events/types";
import { registryMetadataViolations } from "@/lib/workflow/events/metadata";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const MIG = "supabase/migrations/20260805000001_ec_triage_outcomes.sql";
const EC1_MIG = "supabase/migrations/20260804000001_ec_inbound_foundation.sql";
const ACTIONS = "lib/ec/triage/actions.ts";
const STUDIO = "components/ec/triage-studio.tsx";
const QUEUE = "app/communications/triage/page.tsx";
const DETAIL = "app/communications/triage/[id]/page.tsx";

// ---------------------------------------------------------------------------
describe("migration chain", () => {
  it("adds one migration after 80 and touches none before it", () => {
    const all = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    // Pinned RELATIVELY: later phases legitimately add migrations, and a global
    // count would make every future phase look like a breach of EC-2's promise.
    const ec1 = all.indexOf("20260804000001_ec_inbound_foundation.sql");
    expect(ec1).toBeGreaterThan(-1);
    expect(all[ec1 + 1]).toBe("20260805000001_ec_triage_outcomes.sql");
  });

  it("is additive: no table created, no column dropped, no destructive statement", () => {
    const sql = code(MIG);
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b/i);
    expect(sql).toContain("add column if not exists");
    for (const m of sql.match(/^\s*drop\s+(\w+)/gim) ?? []) {
      // Only triggers and the widened CHECK are dropped-then-recreated.
      expect(m.trim().split(/\s+/)[1].toLowerCase()).toMatch(/^(trigger|constraint|function|policy)$/);
    }
  });
});

// ---------------------------------------------------------------------------
describe("EC-1 quarantine semantics are UNCHANGED (the ratified Q-EC2-1 answer)", () => {
  it("does not redefine EC-1's transition guard", () => {
    const sql = code(MIG);
    expect(sql).not.toContain("ec_triage_transition_guard");
    expect(sql).not.toContain("trg_ec_triage_guard");
    // EC-1 still owns it, unmodified.
    expect(code(EC1_MIG)).toContain("function public.ec_triage_transition_guard");
  });

  it("adds a SEPARATE outcome guard rather than editing the status guard", () => {
    const sql = code(MIG);
    expect(sql).toContain("function public.ec_triage_outcome_guard");
    expect(sql).toContain("create trigger trg_ec_triage_outcome");
  });

  it("creates no second quarantine concept anywhere", () => {
    // The word may appear only in the rule that REFUSES to triage a quarantined
    // item — never as a status EC-2 sets, and never as an outcome.
    const sql = code(MIG);
    // EC-2 must never ASSIGN the status — reading it in a refusal is the point.
    expect(sql).not.toMatch(/set +status *= *'QUARANTINED'|new\.status *= *'QUARANTINED'/);
    expect(sql).toContain("old.status = 'QUARANTINED'"); // the refusal
    for (const f of [ACTIONS, "lib/ec/triage/model.ts", STUDIO, "lib/ec/triage/service.ts"]) {
      expect(code(f), f).not.toMatch(/QUARANTINE(?!D)/);
    }
  });

  it("a quarantined item is untriable, and unreachable by any tenant read", () => {
    expect(code(MIG)).toContain("EC613");
    // Every service read is tenant-scoped; quarantine carries tenant_id NULL.
    const svc = code("lib/ec/triage/service.ts");
    for (const m of svc.match(/\.from\("ec_\w+"\)[\s\S]{0,200}?;/g) ?? []) {
      if (m.includes("select")) expect(m).toMatch(/eq\("tenant_id", tenantId\)|eq\("id", /);
    }
  });
});

// ---------------------------------------------------------------------------
describe("four outcomes, and only four", () => {
  it("the ratified set is exactly the four", () => {
    expect([...TRIAGE_OUTCOMES]).toEqual([
      "ATTACH_TO_DOSSIER", "HANDOFF_TO_QUOTATION", "GENERAL_CORRESPONDENCE", "DISCARD",
    ]);
    for (const o of TRIAGE_OUTCOMES) expect(TRIAGE_OUTCOME_FR[o]).toBeTruthy();
  });

  it("the schema CHECK matches the code exactly", () => {
    const sql = code(MIG);
    for (const o of TRIAGE_OUTCOMES) expect(sql, o).toContain(`'${o}'`);
    expect(sql).toContain("constraint ec_triage_outcome_values");
  });

  it("attach requires a dossier; discard requires a reason; neither carries the other", () => {
    expect(validateOutcome({ outcome: "ATTACH_TO_DOSSIER" })).toBe("dossier_required");
    expect(validateOutcome({ outcome: "ATTACH_TO_DOSSIER", fileId: "f" })).toBeNull();
    expect(validateOutcome({ outcome: "ATTACH_TO_DOSSIER", fileId: "f", reasonCode: "SPAM" })).toBe("reason_not_allowed");
    expect(validateOutcome({ outcome: "DISCARD" })).toBe("reason_required");
    expect(validateOutcome({ outcome: "DISCARD", reasonCode: "   " })).toBe("reason_required");
    expect(validateOutcome({ outcome: "DISCARD", reasonCode: "NOPE" })).toBe("invalid_reason");
    expect(validateOutcome({ outcome: "DISCARD", reasonCode: "SPAM" })).toBeNull();
    expect(validateOutcome({ outcome: "DISCARD", reasonCode: "SPAM", fileId: "f" })).toBe("dossier_not_allowed");
    expect(validateOutcome({ outcome: "GENERAL_CORRESPONDENCE" })).toBeNull();
    expect(validateOutcome({ outcome: "HANDOFF_TO_QUOTATION" })).toBeNull();
    expect(validateOutcome({ outcome: "HANDOFF_TO_QUOTATION", fileId: "f" })).toBe("dossier_not_allowed");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(validateOutcome({ outcome: "QUARANTINE" as any })).toBe("invalid_outcome");
  });

  it("the database enforces the same shape independently", () => {
    const sql = code(MIG);
    expect(sql).toContain("constraint ec_triage_outcome_shape");
    expect(sql).toContain("EC611"); // resolving requires an outcome
    expect(sql).toContain("EC618"); // discard requires a reason
    expect(sql).toContain("EC617"); // attach requires a dossier in THIS tenant
  });

  it("the discard vocabulary is configurable, not a schema enum", () => {
    expect([...DISCARD_REASON_CODES]).toEqual([
      "SPAM", "DUPLICATE", "NOT_BUSINESS_RELATED", "WRONG_RECIPIENT", "UNSOLICITED", "OTHER",
    ]);
    for (const c of DISCARD_REASON_CODES) expect(DISCARD_REASON_FR[c]).toBeTruthy();
    expect(isDiscardReasonCode("SPAM")).toBe(true);
    expect(isDiscardReasonCode("WHATEVER")).toBe(false);
    // The SCHEMA must not freeze the values — only their presence.
    const sql = code(MIG);
    for (const c of DISCARD_REASON_CODES) expect(sql, c).not.toContain(`'${c}'`);
  });

  it("an outcome is immutable once recorded", () => {
    expect(code(MIG)).toContain("EC610");
    const fn = code(MIG).slice(code(MIG).indexOf("function public.ec_triage_outcome_guard"));
    expect(fn).toContain("old.outcome is not null");
  });
});

// ---------------------------------------------------------------------------
describe("nothing is created automatically", () => {
  it("no quotation entity is invented — EC-3 owns it", () => {
    const all = code(MIG) + code(ACTIONS) + code("lib/ec/triage/service.ts") + code(STUDIO);
    expect(all).not.toMatch(/create table[\s\S]*?quotation/i);
    expect(all).not.toMatch(/\.from\("quotation/);
    expect(all).not.toMatch(/quotation_line|quotation_request/);
    // The handoff stores INTENT: no quotation column exists on the triage item.
    expect(code(MIG)).not.toMatch(/quotation_id|outcome_quotation/);
  });

  it("no dossier, client, document, task or invoice is written", () => {
    const writes = code(ACTIONS).match(/\.from\("(\w+)"\)[\s\S]{0,120}?\.(insert|update|delete)\(/g) ?? [];
    expect(writes).toEqual([]); // every write goes through an RPC
    const sql = code(MIG);
    for (const t of ["operational_file", "client", "document"]) {
      // Referenced for validation and FKs — never inserted into.
      expect(sql, t).not.toMatch(new RegExp(`insert into public\\.${t}`, "i"));
    }
  });

  it("attachments are never auto-promoted into public.document", () => {
    const all = code(ACTIONS) + code(STUDIO) + code(MIG);
    expect(all).not.toMatch(/public\.document|from\("document"\)/);
  });

  it("adds no permission and no grant", () => {
    const sql = code(MIG);
    expect(sql).not.toMatch(/insert into public\.permission/i);
    expect(sql).not.toMatch(/insert into public\.role_permission/i);
    expect(sql).not.toContain("SYSTEM_ADMIN");
  });
});

// ---------------------------------------------------------------------------
describe("authority", () => {
  it("reads gate on inbound:read, acts gate on triage", () => {
    expect(code(QUEUE)).toContain('hasPermission(permissions, "communication:inbound:read")');
    expect(code(QUEUE)).toContain("notFound()");
    expect(code(DETAIL)).toContain('hasPermission(permissions, "communication:inbound:read")');
    const a = code(ACTIONS);
    for (const fn of ["claimTriageItem", "assignTriageItem", "reviewTriageItem", "resolveTriageItem"]) {
      const body = a.slice(a.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 400), fn).toContain('assertPermission("communication:triage")');
    }
  });

  it("reassignment is gated by ROLE — never by communication:manage", () => {
    const a = code(ACTIONS);
    expect(a).toContain('SUPERVISORY_ROLE = "OPS_SUPERVISOR"');
    expect(a).toContain("forbidden_reassign");
    // The trap that was deliberately avoided: SYSTEM_ADMIN holds this permission.
    expect(a).not.toContain('assertPermission("communication:manage")');
  });

  it("attaching requires the dossier to be VISIBLE to this user, not merely present", () => {
    const a = code(ACTIONS);
    expect(a).toContain("isFileVisible(user.id, user.tenantId, input.fileId!)");
    expect(a).toContain("dossier_not_visible");
    // And the RPC re-checks tenant ownership independently.
    expect(code(MIG)).toContain("where id = p_file_id and tenant_id = p_tenant");
  });
});

// ---------------------------------------------------------------------------
describe("safe rendering — by removal, not by sanitizer", () => {
  it("no HTML from an inbound message is ever rendered", () => {
    expect(code(STUDIO)).not.toContain("dangerouslySetInnerHTML");
    expect(code(DETAIL)).not.toContain("dangerouslySetInnerHTML");
    expect(code(QUEUE)).not.toContain("dangerouslySetInnerHTML");
  });

  it("only the TEXT body is ever fetched", () => {
    const a = code(ACTIONS);
    expect(a).toContain("text_body_path");
    expect(a).not.toContain("html_body_path");
    // No <img>/<iframe>/remote fetch of message content in the studio.
    expect(code(STUDIO)).not.toMatch(/<img|<iframe|srcDoc/);
  });

  it("attachment access is a short-TTL signed URL, never a public one", () => {
    const a = code(ACTIONS);
    expect(a).toContain("createSignedUrl(att.storage_path, 60)");
    expect(a).not.toMatch(/getPublicUrl/);
    expect(a).toContain('att.stored');
  });
});

// ---------------------------------------------------------------------------
describe("Digital-LOS events", () => {
  it("the communication domain is registered in code and widened in SQL", () => {
    expect([...EVENT_DOMAINS]).toContain("communication");
    const sql = code(MIG);
    expect(sql).toContain("business_event_event_domain_check");
    expect(sql).toContain("'communication'");
    // Widened by drop-and-recreate — the WES-5 precedent, non-destructive.
    expect(sql).toContain("drop constraint if exists business_event_event_domain_check");
  });

  it("every EC-2 event type is registered with a French label", () => {
    const types = [
      "CORRESPONDENCE_RECEIVED", "CORRESPONDENCE_ASSIGNED", "CORRESPONDENCE_REASSIGNED",
      "CORRESPONDENCE_ATTACHED", "CORRESPONDENCE_QUOTATION_HANDOFF",
      "CORRESPONDENCE_RESOLVED", "CORRESPONDENCE_DISCARDED",
    ];
    for (const t of types) {
      const def = getEventType(t);
      expect(def, t).toBeTruthy();
      expect(def!.domain).toBe("communication");
      expect(def!.labelFr).toBeTruthy();
      // Correspondence is never surfaced to the customer portal feed.
      expect(def!.clientSafe, t).toBe(false);
    }
  });

  it("CORRESPONDENCE_RECEIVED is NOT emitted by EC-2 — it belongs to attribution", () => {
    // It was reserved while EC-1's capture was a non-transactional app write.
    // UT-3B (migration 86) put it on a trigger at first tenant attribution.
    // What EC-2 still guarantees is that TRIAGE does not emit it: arrival and
    // triage are different facts, and triage is far too late to claim arrival.
    expect(getEventType("CORRESPONDENCE_RECEIVED")!.emission).toBe("trigger");
    expect(code(MIG)).not.toContain("'CORRESPONDENCE_RECEIVED'");
  });

  it("the attach event carries the DOSSIER as subject AND dossier_id", () => {
    const sql = code(MIG);
    const emit = sql.slice(sql.indexOf("'CORRESPONDENCE_ATTACHED'"));
    expect(emit.slice(0, 300)).toContain("'operational_file', v_file, v_file");
  });

  it("events are emitted inside the RPC — the same transaction as the state change", () => {
    const sql = code(MIG);
    const fn = sql.slice(sql.indexOf("function public.ec_resolve_triage"));
    expect(fn).toContain("update public.ec_triage_item");
    expect(fn).toContain("perform public.emit_business_event");
    // Every communication event EC-2 owns is RPC-emitted. CORRESPONDENCE_RECEIVED
    // is excluded: it is owned by capture/attribution, not by triage, and is
    // trigger-emitted since UT-3B.
    for (const def of EVENT_TYPES.filter(
      (d) => d.domain === "communication" && d.emission !== "reserved"
             && d.type !== "CORRESPONDENCE_RECEIVED",
    )) {
      expect(def.emission, def.type).toBe("rpc");
    }
  });

  it("event metadata carries identifiers and codes only — the registry proves it", () => {
    // The platform-wide allow-list/deny-list check must still pass with the new types.
    expect(registryMetadataViolations()).toEqual([]);
    for (const def of EVENT_TYPES.filter((d) => d.domain === "communication")) {
      for (const k of def.metadataKeys) {
        // EMP-3 adds three to the communication domain, all still identifiers
        // or closed codes: thread_id (identifier), kind (TEMPLATE|COMPOSE|REPLY)
        // and provider (resend|smtp). No address, subject, body or filename.
        expect(
          ["triage_item_id", "message_id", "mailbox_id", "outcome", "reason_code",
           "thread_id", "kind", "provider"],
          `${def.type}.${k}`,
        )
          .toContain(k);
      }
    }
  });

  it("the discard COMMENT never travels — only its reason code", () => {
    const sql = code(MIG);
    const emit = sql.slice(sql.indexOf("'CORRESPONDENCE_DISCARDED'"));
    expect(emit.slice(0, 400)).toContain("'reason_code', v_reason");
    expect(emit.slice(0, 400)).not.toContain("p_comment");
  });

  it("audit payloads carry no subject, sender, body or filename", () => {
    // Scoped to the PAYLOAD (`after:`), because "body" legitimately appears in
    // the action NAME `ec.correspondence.body_read` — a label, never content.
    for (const m of code(ACTIONS).match(/after: \{[\s\S]*?\}/g) ?? []) {
      for (const forbidden of ["subject", "from_address", "fromAddress", "body", "text", "filename", "comment"]) {
        expect(m, forbidden).not.toContain(forbidden);
      }
    }
  });

  it("the dossier timeline component acknowledges the new domain", () => {
    expect(code("lib/unified-timeline/presentation.ts")).toContain("communication:");
  });
});

// ---------------------------------------------------------------------------
describe("workspace", () => {
  it("extends /communications — one canonical route, no second inbox", () => {
    expect(existsSync(join(root, "app", "communications", "triage", "page.tsx"))).toBe(true);
    expect(existsSync(join(root, "app", "communications", "triage", "[id]", "page.tsx"))).toBe(true);
    // No competing top-level route.
    expect(existsSync(join(root, "app", "triage"))).toBe(false);
    expect(existsSync(join(root, "app", "inbox"))).toBe(false);
  });

  it("filters cover status, mailbox, sender, date and assignment", () => {
    const q = code(QUEUE);
    for (const f of ["status", "mailbox", "sender", "from", "to", "mine", "unassigned"]) {
      expect(q, f).toContain(f);
    }
    // A GET form, so a filtered view is a shareable URL.
    expect(q).toContain('method="get"');
  });

  it("the sender filter is sanitized before reaching PostgREST", () => {
    const svc = code("lib/ec/triage/service.ts");
    expect(svc).toContain('replace(/[%,()*]/g, " ")');
  });

  it("attention counters are computed live — no scheduler was introduced", () => {
    expect(code("lib/ec/triage/service.ts")).toContain("export async function triageCounts");
    for (const f of ["lib/ec/triage/service.ts", ACTIONS]) {
      expect(code(f), f).not.toMatch(/setInterval|setTimeout\(|cron|node-schedule|new Worker/i);
    }
    expect(existsSync(join(root, "app", "api", "cron"))).toBe(false);
  });

  it("the client studio imports no server-only module", () => {
    const c = read(STUDIO);
    expect(c.startsWith('"use client"')).toBe(true);
    expect(c).not.toMatch(/from "@\/lib\/ec\/triage\/service"/);
    expect(read("lib/ec/triage/model.ts")).not.toContain('import "server-only"');
  });

  it('all "use server" exports are async', () => {
    const a = read(ACTIONS);
    expect(a.startsWith('"use server"')).toBe(true);
    for (const m of a.match(/^export (?!type )(?:async )?function/gm) ?? []) {
      expect(m).toContain("async");
    }
    expect(a).not.toMatch(/^export const \w+ =/m);
  });

  it("accessibility: labelled controls, no emoji", () => {
    const q = read(QUEUE); const s = read(STUDIO);
    expect(q).toContain("sr-only");
    expect(s).toContain("<legend");
    expect(s).toContain('role="alert"');
    for (const f of [q, s]) expect(f).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("status vocabulary is complete and terminal states are excluded from OPEN", () => {
    expect(Object.keys(TRIAGE_STATUS_FR).sort())
      .toEqual(["ASSIGNED", "IN_REVIEW", "NEW", "QUARANTINED", "RESOLVED"]);
    expect([...OPEN_TRIAGE_STATUSES]).toEqual(["NEW", "ASSIGNED", "IN_REVIEW"]);
    expect(isOpen("RESOLVED")).toBe(false);
    expect(isOpen("QUARANTINED")).toBe(false);
    expect(isOpen("NEW")).toBe(true);
  });

  it("outcome suggestion never guesses", () => {
    expect(suggestOutcome("QUOTATION")).toBe("HANDOFF_TO_QUOTATION");
    expect(suggestOutcome("OPERATIONS")).toBeNull();
    expect(suggestOutcome(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("scope boundaries", () => {
  it("no reply/compose capability (EC-4)", () => {
    const all = code(ACTIONS) + code(STUDIO) + code("lib/ec/triage/service.ts");
    expect(all).not.toMatch(/queueAndSend|sendEmail|replyTo|compose/i);
  });

  it("no postal-mail, chrono-numbering or deadline machinery (excluded from EC-2)", () => {
    const all = code(MIG) + code(ACTIONS) + code("lib/ec/triage/service.ts") + code(STUDIO) + code(QUEUE);
    for (const forbidden of ["chrono", "postal", "courrier_arrivee", "deadline", "delai_legal", "scan"]) {
      expect(all.toLowerCase(), forbidden).not.toContain(forbidden);
    }
  });

  it("no SQL suite resolves a triage item without an outcome (cross-suite guard)", () => {
    // EC-2's outcome guard applies to EVERY writer of ec_triage_item, including
    // fixtures in OTHER suites. This exact interaction broke EC-1's suite once:
    // a bare `set status = 'RESOLVED'` now raises EC611. A vitest cannot run the
    // SQL, so it reads it instead — cheap, and it catches the regression class.
    const dir = join(root, "supabase", "tests");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
      const sql = readFileSync(join(dir, f), "utf8");
      // Comments are KEPT: a deliberate negative marks itself EXPECT-FAIL.
      for (const m of sql.matchAll(/update public\.ec_triage_item[\s\S]*?;/g)) {
        const stmt = m[0];
        if (!/status *= *'RESOLVED'/.test(stmt)) continue;
        const preceding = sql.slice(Math.max(0, m.index! - 200), m.index!);
        if (preceding.includes("EXPECT-FAIL")) continue;
        expect(stmt, `${f}: resolving without an outcome`).toMatch(/outcome *=/);
      }
    }
  });

  it("is registered in CI as its own suite, and EC-1's suite still runs", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("rls_ec_triage_test.sql");
    expect(ci).toContain("EC-2 FAIL");
    expect(ci).toContain("rls_ec_inbound_test.sql");
  });
});
