/**
 * Phase WES-9 — immutable business event ledger.
 *
 * Structural assertions read the SOURCE with comments stripped (`code()`), the
 * convention this repository already uses. Matching raw text would let a test
 * pass on the strength of a comment that says the right thing while the code
 * does the wrong thing — a mistake this project has made before.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  EVENT_DOMAINS,
  EVENT_TYPES,
  clientSafeEventTypes,
  emittedEventTypes,
  getEventType,
  isClientSafeEvent,
  isEventSource,
  isKnownEventType,
} from "@/lib/workflow/events/types";
import {
  MAX_METADATA_VALUE_LENGTH,
  PROHIBITED_METADATA_KEYS,
  registryMetadataViolations,
  validateEventMetadata,
} from "@/lib/workflow/events/metadata";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * SQL comments use `--`, which `code()` (written for TypeScript) does not
 * strip. Asserting against raw SQL therefore lets a migration's own header
 * satisfy a test about its code — including a header that QUOTES the very
 * anti-pattern under test, which is exactly how the first version of these
 * assertions passed. Strip `--` lines for every structural SQL check.
 */
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260726000004_business_event_ledger.sql";
const ATOMICITY = "supabase/migrations/20260727000001_business_event_atomicity.sql";
const migration = () => sqlCode(MIGRATION);
/** WES-9A: the emission functions as they stand today (62 replaced by 63). */
const atomicity = () => sqlCode(ATOMICITY);

// ---------------------------------------------------------------------------
// 9A — taxonomy
// ---------------------------------------------------------------------------
describe("WES-9A event taxonomy", () => {
  it("is a closed registry with unique type names", () => {
    const names = EVENT_TYPES.map((e) => e.type);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThan(20);
  });

  it("declares every type against a known domain", () => {
    for (const def of EVENT_TYPES) {
      expect(EVENT_DOMAINS).toContain(def.domain);
    }
  });

  it("gives every type a positive version and a French label", () => {
    for (const def of EVENT_TYPES) {
      expect(def.version).toBeGreaterThan(0);
      expect(def.labelFr.trim().length).toBeGreaterThan(0);
    }
  });

  it("resolves known types and rejects unknown ones", () => {
    expect(isKnownEventType("DOSSIER_OPENED")).toBe(true);
    expect(isKnownEventType("SOMETHING_INVENTED")).toBe(false);
    expect(getEventType("SOMETHING_INVENTED")).toBeNull();
  });

  it("declares no type for a feature that does not exist yet", () => {
    // WES-4/WES-6 build these. Naming them now would be vocabulary for
    // behaviour nobody has written.
    for (const absent of [
      "INTERNAL_DOCUMENT_GENERATED",
      "TRANSPORT_ORDER_GENERATED",
      "MISSION_STARTED",
      "ASSIGNMENT_CHANGED",
    ]) {
      expect(isKnownEventType(absent)).toBe(false);
    }
  });

  it("emits only trigger- or RPC-backed types", () => {
    for (const def of emittedEventTypes()) {
      expect(["trigger", "rpc"]).toContain(def.emission);
    }
  });

  it("keeps app-layer-only actions RESERVED rather than unreliably emitted", () => {
    // These are real features whose writes are application multi-writes. WES-9J
    // prefers fewer trustworthy events over broad unreliable coverage.
    for (const reserved of [
      "HANDOFF_SENT",
      "HANDOFF_RECEIVED",
      "EXPENSE_AUTHORIZED",
      "DOCUMENT_SHARED_WITH_CLIENT",
    ]) {
      expect(getEventType(reserved)?.emission).toBe("reserved");
    }
  });
});

// ---------------------------------------------------------------------------
// 9C — metadata contract
// ---------------------------------------------------------------------------
describe("WES-9C metadata contract", () => {
  it("accepts allow-listed keys", () => {
    const r = validateEventMetadata("DOSSIER_OPENED", {
      file_number: "IMP-2026-0001",
      file_type: "IMP",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.metadata.file_number).toBe("IMP-2026-0001");
  });

  it("rejects a key that is not on the type's allow-list", () => {
    const r = validateEventMetadata("DOSSIER_OPENED", { unexpected: "x" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "key_not_allowed")).toBe(true);
  });

  it("rejects money, personal data and free text by key name", () => {
    for (const key of ["amount", "currency", "email", "phone", "notes", "reason", "storage_path"]) {
      const r = validateEventMetadata("PAYMENT_RECORDED", { [key]: "x" });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.errors.some((e) => e.code === "prohibited_key" || e.code === "key_not_allowed")).toBe(true);
      }
    }
  });

  it("rejects nested objects and arrays — scalars only", () => {
    const nested = validateEventMetadata("DOSSIER_OPENED", { file_number: { a: 1 } });
    expect(nested.ok).toBe(false);
    const arr = validateEventMetadata("DOSSIER_OPENED", { file_number: ["a"] });
    expect(arr.ok).toBe(false);
  });

  it("rejects an over-long value", () => {
    const r = validateEventMetadata("DOSSIER_OPENED", {
      file_number: "x".repeat(MAX_METADATA_VALUE_LENGTH + 1),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.code === "value_too_long")).toBe(true);
  });

  it("rejects an unknown or reserved event type outright", () => {
    expect(validateEventMetadata("NOPE", {}).ok).toBe(false);
    expect(validateEventMetadata("HANDOFF_SENT", {}).ok).toBe(false);
  });

  it("treats absent metadata as empty, not as an error", () => {
    const r = validateEventMetadata("DRIVER_ASSIGNED", null);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.metadata).toEqual({});
  });

  it("drops null and undefined values instead of storing them", () => {
    const r = validateEventMetadata("DOSSIER_OPENED", { file_number: "A", file_type: null });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.metadata)).toEqual(["file_number"]);
  });

  it("has no registry type declaring a prohibited key", () => {
    expect(registryMetadataViolations()).toEqual([]);
  });

  it("keeps the deny-list covering the categories WES-9C names", () => {
    for (const key of ["amount", "name", "email", "notes", "password", "snapshot"]) {
      expect(PROHIBITED_METADATA_KEYS).toContain(key);
    }
  });

  it("never allows an amount on the payment event", () => {
    // The payment row stays the authority on money; an immutable copy could
    // drift from it and could never be corrected.
    expect(getEventType("PAYMENT_RECORDED")?.metadataKeys).not.toContain("amount");
    for (const sql of [migration(), atomicity()]) expect(sql).not.toMatch(/'amount',\s*new\.amount/);
  });

  it("never copies a document rejection note into the ledger", () => {
    expect(getEventType("DOCUMENT_REJECTED")?.metadataKeys).not.toContain("reason");
    for (const sql of [migration(), atomicity()]) expect(sql).not.toContain("new.review_note");
  });

  it("never copies driver personal data into the ledger", () => {
    expect(getEventType("DRIVER_ASSIGNED")?.metadataKeys).toEqual([]);
    for (const sql of [migration(), atomicity()]) {
      expect(sql).not.toMatch(/'driver_name',\s*new\.driver_name/);
      expect(sql).not.toContain("new.driver_phone");
    }
  });
});

// ---------------------------------------------------------------------------
// 9K — client-safe projection
// ---------------------------------------------------------------------------
describe("WES-9K client-safe allow-list", () => {
  it("marks operational milestones client-safe", () => {
    for (const type of ["DOSSIER_OPENED", "CUSTOMS_DECLARED", "DELIVERY_COMPLETED", "POD_RECEIVED"]) {
      expect(isClientSafeEvent(type)).toBe(true);
    }
  });

  it("keeps internal decisions and configuration OFF the client feed", () => {
    for (const type of [
      "DOCUMENT_REJECTED",
      "TASK_CREATED",
      "TASK_COMPLETED",
      "DRIVER_ASSIGNED",
      "POLICY_ACTIVATED",
      "POLICY_RETIRED",
      "CUSTOMS_STATUS_CHANGED",
      "DOSSIER_STATUS_CHANGED",
      "BAE_RECORDED",
    ]) {
      expect(isClientSafeEvent(type)).toBe(false);
    }
  });

  it("defaults an unknown type to NOT client-safe", () => {
    expect(isClientSafeEvent("ANYTHING_ELSE")).toBe(false);
  });

  it("projects by allow-list rather than filtering out internal rows", () => {
    const src = code("lib/workflow/events/readers.ts");
    expect(src).toContain("clientSafeEventTypes()");
    expect(src).toMatch(/\.in\("event_type", types\)/);
    // A negative filter would leak any type someone forgets to classify.
    expect(src).not.toMatch(/\.neq\("event_type"/);
    expect(src).not.toMatch(/clientSafe === false/);
  });

  it("re-checks clientSafe after the query as a second barrier", () => {
    expect(code("lib/workflow/events/readers.ts")).toContain("!def.clientSafe");
  });

  it("gates the client feed on the EXISTING portal access boundary", () => {
    const src = code("lib/workflow/events/readers.ts");
    expect(src).toContain("requirePortalUser");
    expect(src).toContain("getPortalFileSummary");
  });

  it("exposes no actor, metadata or policy to the customer", () => {
    const src = code("lib/workflow/events/readers.ts");
    const projection = src.slice(src.indexOf("readClientTimeline"));
    expect(projection).toContain('.select("id, event_type, occurred_at")');
    expect(projection).not.toContain("actor_user_id");
    expect(projection).not.toContain("policy_version_id");
  });
});

// ---------------------------------------------------------------------------
// 9B / 9H — envelope, immutability, RLS
// ---------------------------------------------------------------------------
describe("WES-9B/9H ledger schema", () => {
  it("carries the full envelope", () => {
    const sql = migration();
    for (const column of [
      "event_type",
      "event_domain",
      "event_version",
      "source",
      "dossier_id",
      "subject_type",
      "subject_id",
      "actor_user_id",
      "correlation_id",
      "causation_id",
      "metadata",
      "policy_version_id",
      "policy_provenance",
      "occurred_at",
    ]) {
      expect(sql).toContain(column);
    }
  });

  it("blocks UPDATE and DELETE for every role, service role included", () => {
    const sql = migration();
    expect(sql).toMatch(/before update on public\.business_event[\s\S]*?prevent_mutation/);
    expect(sql).toMatch(/before delete on public\.business_event[\s\S]*?prevent_mutation/);
  });

  it("has no correction, redaction or soft-delete path", () => {
    const sql = migration();
    expect(sql).not.toMatch(/update public\.business_event/i);
    expect(sql).not.toMatch(/delete from public\.business_event/i);
    expect(sql).not.toContain("deleted_at");
  });

  it("never lets a cascade delete history", () => {
    const sql = migration();
    const table = sql.slice(
      sql.indexOf("create table public.business_event"),
      sql.indexOf("create index idx_business_event_dossier"),
    );
    // Only tenant_id, actor, causation and policy_version_id are FKs, and none
    // of them cascades. dossier_id / subject_id are deliberately plain uuids:
    // document, task, invoice and the rest all cascade from operational_file.
    expect(table).not.toContain("on delete cascade");
    expect(table).not.toMatch(/dossier_id\s+uuid\s+not null references/);
    expect(table).not.toMatch(/subject_id\s+uuid\s+references/);
  });

  it("enables RLS with a SELECT-only policy and no write policy", () => {
    const sql = migration();
    expect(sql).toContain("alter table public.business_event enable row level security");
    expect(sql).toMatch(/create policy business_event_select[\s\S]*?for select to authenticated/);
    expect(sql).not.toMatch(/create policy[\s\S]*?on public\.business_event\s+for (insert|update|delete)/);
    expect(sql).toMatch(/grant select on public\.business_event to authenticated/);
  });

  it("defers dossier visibility to the existing rule instead of a weaker copy", () => {
    expect(migration()).toContain("public.can_read_file(dossier_id)");
  });

  it("gates configuration-scope events on admin:config:manage", () => {
    expect(migration()).toContain("public.has_permission('admin:config:manage')");
  });

  it("grants no INSERT to authenticated anywhere", () => {
    expect(migration()).not.toMatch(/grant insert on public\.business_event/);
  });

  it("makes an application-side insert unrepresentable in the typed client", () => {
    const types = code("lib/db/types.ts");
    const block = types.slice(types.indexOf("business_event: {"));
    const head = block.slice(0, block.indexOf("Relationships"));
    expect(head).toContain("Insert: never");
    expect(head).toContain("Update: never");
  });
});

// ---------------------------------------------------------------------------
// 9D / 9I — transactionality
// ---------------------------------------------------------------------------
describe("WES-9D transactional emission", () => {
  it("routes every write through the single emit function", () => {
    const sql = migration();
    const inserts = sql.match(/insert into public\.business_event/g) ?? [];
    expect(inserts).toHaveLength(1);
    expect(sql).toMatch(/create or replace function public\.emit_business_event/);
  });

  it("emits from database triggers, never from an application dual write", () => {
    const sql = migration();
    for (const table of [
      "operational_file",
      "document",
      "customs_record",
      "transport_record",
      "task",
      "invoice",
      "payment",
    ]) {
      expect(sql).toMatch(new RegExp(`after (insert|update)[\\s\\S]*?on public\\.${table}`));
    }
  });

  it("never inserts an event from application code", () => {
    for (const file of ["lib/workflow/events/readers.ts"]) {
      const src = code(file);
      expect(src).not.toMatch(/\.from\("business_event"\)[\s\S]{0,80}\.insert/);
    }
  });

  it("emits only on ENUMERATED transitions, never on any column change", () => {
    const sql = migration();
    // Every UPDATE-path emission is guarded by a status (or explicit field)
    // comparison. A bare `if tg_op = 'UPDATE' then emit` would be the
    // "trigger on every table" WES-9D warns against.
    expect(sql).toMatch(/new\.status is distinct from old\.status/);
    expect(sql).toMatch(/new\.bae_reference is not null and old\.bae_reference is null/);
    expect(sql).toMatch(/new\.driver_name is not null and old\.driver_name is null/);
  });

  it("derives the actor from committed row columns, never from a GUC", () => {
    const sql = migration();
    for (const col of ["new.created_by", "new.uploaded_by", "new.reviewed_by", "new.assigned_by", "new.recorded_by", "new.issued_by"]) {
      expect(sql).toContain(col);
    }
    // PostgREST runs each request in its own transaction, so an app-set GUC
    // cannot reach the trigger.
    expect(sql).not.toContain("current_setting('app.");
  });

  it("emits policy activation inside the existing atomic RPC", () => {
    const sql = migration();
    const rpc = sql.slice(sql.indexOf("create or replace function public.activate_workflow_policy"));
    expect(rpc).toContain("POLICY_ACTIVATED");
    expect(rpc).toContain("POLICY_RETIRED");
    expect(rpc).toContain("emit_business_event");
  });

  it("preserves the WES-7 activation contract exactly", () => {
    const sql = migration();
    const rpc = sql.slice(sql.indexOf("create or replace function public.activate_workflow_policy"));
    // Return type and shape must not change — WES-7 callers read this object.
    expect(rpc).toContain("returns jsonb");
    expect(rpc).toContain("'activated_id', p_version_id");
    expect(rpc).toContain("'retired_id',   v_retired");
    // The fail-closed guards stay.
    expect(rpc).toContain("only a VALIDATED version may be activated");
    expect(rpc).toContain("has not passed validation");
    expect(rpc).toContain("policy schema version mismatch");
    expect(rpc).toContain("tenant_id is not distinct from v.tenant_id");
  });
});

// ---------------------------------------------------------------------------
// 9A — MANDATORY-EVENT ATOMICITY (Model A)
//
// Migration 62 shipped `exception when others then raise warning; return null`,
// which downgraded a failed ledger append to a log line and let the domain write
// commit. That is Model B and it contradicts ADR-WES-014. Migration 63 replaces
// every emission function. These tests exist so the swallow cannot come back.
// ---------------------------------------------------------------------------
describe("WES-9A mandatory-event atomicity", () => {
  it("replaces every emission function shipped by migration 62", () => {
    const sql = atomicity();
    for (const fn of [
      "emit_dossier_events",
      "emit_document_events",
      "emit_customs_events",
      "emit_transport_events",
      "emit_task_events",
      "emit_finance_events",
      "emit_business_event",
    ]) {
      expect(sql).toContain(`create or replace function public.${fn}`);
    }
  });

  it("NEVER swallows: no handler returns instead of raising", () => {
    const sql = atomicity();
    // The exact shape migration 62 shipped, and the reason this phase exists.
    expect(sql).not.toMatch(/exception\s+when others then\s+raise warning[^;]*;\s*return null;/);
    // No exception branch may end by returning — that is a swallow by any name.
    expect(sql).not.toMatch(/exception[\s\S]*?when others then[\s\S]{0,400}?return null;\s*end;/);
  });

  it("re-raises from every single handler", () => {
    const sql = atomicity();
    const branches = sql.match(/when others then/g) ?? [];
    const raises = sql.match(/raise exception\s*\n?\s*'Enregistrement impossible/g) ?? [];
    // six trigger functions, each with exactly one `when others` that raises
    expect(branches.length).toBe(6);
    expect(raises.length).toBeGreaterThanOrEqual(6);
  });

  it("preserves the original error when the ledger already failed cleanly", () => {
    // A bare `raise` keeps emit_business_event's own message and code rather
    // than re-wrapping it into a vaguer one.
    const sql = atomicity();
    const bare = sql.match(/when sqlstate 'EF001' then\s*\n\s*raise;/g) ?? [];
    expect(bare.length).toBe(6);
  });

  it("still logs the underlying cause so operators are not left blind", () => {
    const sql = atomicity();
    const warnings = sql.match(/raise warning 'business_event emission failed/g) ?? [];
    expect(warnings.length).toBe(6);
    // …but the warning is followed by a raise, never used as the outcome.
    expect(sql).not.toMatch(/raise warning[^;]*;\s*return/);
  });

  it("returns a safe user-facing message, not database internals", () => {
    const sql = atomicity();
    expect(sql).toContain("Enregistrement impossible");
    expect(sql).toContain("Aucune modification n''a été enregistrée");
    // sqlerrm goes to the server log only, never into the raised message.
    expect(sql).not.toMatch(/raise exception[^;]*sqlerrm/);
  });

  it("uses a stable application error code the app layer can recognise", () => {
    const sql = atomicity();
    const codes = sql.match(/using errcode = 'EF001'/g) ?? [];
    expect(codes.length).toBeGreaterThanOrEqual(7);
  });

  it("fails closed on a structurally invalid envelope", () => {
    const sql = atomicity();
    const fn = sql.slice(sql.indexOf("create or replace function public.emit_business_event"));
    expect(fn).toMatch(/p_event_domain is null or p_subject_type is null/);
    expect(fn).toContain("using errcode = 'EF001'");
  });

  it("classifies every emitted type as mandatory — the ledger holds no telemetry", () => {
    // Model A only coheres if nothing in the ledger is optional. Observational
    // signals (page views, downloads, notification delivery) have no type here.
    for (const telemetry of [
      "PAGE_VIEWED",
      "REPORT_DOWNLOADED",
      "NOTIFICATION_DELIVERED",
      "UI_INTERACTION",
      "TELEMETRY",
    ]) {
      expect(isKnownEventType(telemetry)).toBe(false);
    }
    for (const def of emittedEventTypes()) {
      expect(def.emission === "trigger" || def.emission === "rpc").toBe(true);
    }
  });

  it("withdraws migration 62's inaccurate claim about type enforcement", () => {
    // 62 said an unknown type was "unwritable — enforced by
    // emit_business_event()". The function never checked. 63 says so plainly
    // and points at the build-time test that IS the enforcement.
    const sql = read(ATOMICITY);
    expect(sql).toContain("The claim is withdrawn");
    expect(sql).toContain("tests/business-events.test.ts");
  });
});

// ---------------------------------------------------------------------------
// 9F / 9G — correlation and policy provenance
// ---------------------------------------------------------------------------
describe("WES-9F/9G correlation and provenance", () => {
  it("uses the dossier as the correlation thread rather than a parallel id", () => {
    const sql = migration();
    const insert = sql.slice(sql.indexOf("insert into public.business_event"));
    expect(insert).toMatch(/p_dossier_id, p_causation_id/);
  });

  it("links a retirement to the activation that caused it", () => {
    const sql = migration();
    const rpc = sql.slice(sql.indexOf("create or replace function public.activate_workflow_policy"));
    expect(rpc).toMatch(/v_activation := public\.emit_business_event/);
    expect(rpc).toMatch(/POLICY_RETIRED[\s\S]*?v_activation\)/);
  });

  it("records the governing policy version and its provenance", () => {
    const sql = migration();
    expect(sql).toContain("pi.policy_version_id, pi.policy_provenance");
    expect(sql).toContain("policy_provenance text check (policy_provenance in ('PINNED', 'LEGACY_DEFAULT', 'MIGRATED'))");
  });

  it("leaves provenance NULL when nothing was recorded rather than guessing", () => {
    const sql = migration();
    expect(sql).not.toMatch(/coalesce\(v_provenance,\s*'PINNED'\)/);
    expect(sql).not.toMatch(/coalesce\(v_provenance,\s*'LEGACY_DEFAULT'\)/);
  });
});

// ---------------------------------------------------------------------------
// 9E / 9M — relationship to audit_log, and retention
// ---------------------------------------------------------------------------
describe("WES-9E/9M boundaries", () => {
  it("does not touch audit_log", () => {
    for (const sql of [migration(), atomicity()]) {
      expect(sql).not.toMatch(/insert into public\.audit_log/i);
      expect(sql).not.toMatch(/alter table public\.audit_log/i);
    }
  });

  it("ships NO retention or purge job", () => {
    for (const sql of [migration(), atomicity()]) {
      expect(sql).not.toMatch(/pg_cron|cron\.schedule/i);
      expect(sql).not.toMatch(/delete from/i);
      expect(sql).not.toMatch(/create .*(policy|function).*(purge|retention|prune)/i);
    }
  });

  it("authorizes nothing — no workflow module reads the ledger to decide", () => {
    for (const file of [
      "lib/workflow/projection.ts",
      "lib/handoffs/service.ts",
      "lib/files/lifecycle.ts",
    ]) {
      expect(code(file)).not.toContain("business_event");
    }
  });
});

// ---------------------------------------------------------------------------
// 9L — UI
// ---------------------------------------------------------------------------
describe("WES-9L timeline UI", () => {
  it("is read-only — no forms, no actions", () => {
    const src = code("components/files/event-timeline.tsx");
    expect(src).not.toContain("<form");
    expect(src).not.toContain("use client");
    expect(src).not.toContain("onClick");
  });

  it("shows a missing actor honestly instead of inventing one", () => {
    expect(code("components/files/event-timeline.tsx")).toContain("Auteur non enregistré");
  });

  it("states that coverage is partial rather than implying completeness", () => {
    const src = read("components/files/event-timeline.tsx");
    expect(src).toMatch(/n&apos;y figurent pas encore/);
  });

  it("is mounted on the dossier page", () => {
    const page = code("app/files/[id]/page.tsx");
    expect(page).toContain("<EventTimeline fileId={file.id} />");
  });
});

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------
describe("event sources", () => {
  it("accepts only the declared subsystems", () => {
    expect(isEventSource("db_trigger")).toBe(true);
    expect(isEventSource("policy_rpc")).toBe(true);
    expect(isEventSource("kafka")).toBe(false);
  });

  it("keeps the SQL source CHECK aligned with the TypeScript vocabulary", () => {
    expect(migration()).toContain("source in ('db_trigger', 'policy_rpc', 'app_action')");
  });

  it("keeps the SQL domain CHECK aligned with EVENT_DOMAINS", () => {
    const sql = migration();
    for (const domain of EVENT_DOMAINS) expect(sql).toContain(`'${domain}'`);
  });

  it("emits only types the registry declares", () => {
    const sql = migration();
    const emitted = new Set<string>();
    for (const m of sql.matchAll(/'([A-Z][A-Z_]{4,})',\s*'(dossier|document|customs|transport|task|handoff|finance|policy|ledger)'/g)) {
      emitted.add(m[1]);
    }
    expect(emitted.size).toBeGreaterThan(10);
    for (const type of emitted) {
      expect(isKnownEventType(type)).toBe(true);
      expect(getEventType(type)?.emission).not.toBe("reserved");
    }
  });

  it("emits every non-reserved type the registry declares", () => {
    const sql = migration();
    for (const def of emittedEventTypes()) {
      expect(sql).toContain(`'${def.type}'`);
    }
  });

  it("exposes a non-empty client-safe set", () => {
    expect(clientSafeEventTypes().length).toBeGreaterThan(5);
  });
});
