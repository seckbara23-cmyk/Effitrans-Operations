/**
 * EMP-4 — attachment → document ingestion.
 *
 * The phase's risk is architectural rather than algorithmic: a second document
 * model, a second upload path, a duplicate emitter, or a silent double
 * ingestion. Those are properties of the source and the schema, so most of
 * these are structural, and the ones that need a real database (idempotency,
 * exactly-once emission, evidence immutability) live in the SQL suite.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getEventType, clientSafeEventTypes } from "@/lib/workflow/events/types";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260812000001_document_ingest_provenance.sql";
const SERVICE = "lib/ec/ingest/service.ts";
const ACTIONS = "lib/ec/ingest/actions.ts";
const UI = "components/ec/attachment-ingest.tsx";
const SUITE = "supabase/tests/rls_document_ingest_test.sql";
const EC2_ACTIONS = "lib/ec/triage/actions.ts";
const EC2_STUDIO = "components/ec/triage-studio.tsx";

// ---------------------------------------------------------------------------
// 1. No duplicate architecture
// ---------------------------------------------------------------------------
describe("EMP-4 duplicates nothing", () => {
  it("creates no table — no second document or attachment model", () => {
    const s = sql(MIGRATION);
    expect(s).not.toMatch(/create\s+table/i);
    expect(s).toMatch(/alter table public\.document/i);
  });

  it("creates no bucket", () => {
    expect(sql(MIGRATION)).not.toMatch(/storage\.buckets/i);
    for (const f of [SERVICE, ACTIONS, UI]) {
      expect(code(f)).not.toMatch(/createBucket|storage\.buckets/i);
    }
  });

  it("adds no RLS policy and no permission", () => {
    const s = sql(MIGRATION);
    expect(s).not.toMatch(/create\s+policy/i);
    expect(s).not.toMatch(/insert into public\.permission/i);
    expect(s).not.toMatch(/insert into public\.role_permission/i);
    expect(s).not.toMatch(/\bgrant\b/i);
  });

  it("adds no emitter — the DOCUMENT_UPLOADED trigger stays the only producer", () => {
    const s = sql(MIGRATION);
    expect(s).not.toContain("emit_business_event");
    expect(s).not.toMatch(/create trigger/i);
    for (const f of [SERVICE, ACTIONS]) {
      expect(code(f)).not.toContain("emit_business_event");
      expect(code(f)).not.toContain("DOCUMENT_UPLOADED");
    }
    // And the registry still declares it trigger-emitted.
    expect(getEventType("DOCUMENT_UPLOADED")?.emission).toBe("trigger");
  });

  it("uses the ONE storage abstraction and never reaches past it", () => {
    const s = code(SERVICE);
    expect(s).toContain("uploadObject");
    expect(s).toContain("sha256Hex");
    expect(s).toContain("buildStoragePath");
    // No direct write to the documents bucket.
    expect(s).not.toMatch(/storage\s*\.\s*from\(\s*["'`]documents["'`]\s*\)/);
    expect(s).not.toContain(".upload(");
  });

  it("reads the inbound bucket only to download — never to write or delete", () => {
    const s = code(SERVICE);
    expect(s).toContain("EC_INBOUND_BUCKET");
    const inbound = s.slice(s.indexOf("EC_INBOUND_BUCKET"));
    expect(inbound).toContain(".download(");
    expect(inbound).not.toContain(".upload(");
    expect(inbound).not.toContain(".remove(");
  });

  it("never mutates the inbound attachment row", () => {
    for (const f of [SERVICE, ACTIONS]) {
      const s = code(f);
      expect(s).not.toMatch(/ec_inbound_attachment[\s\S]{0,160}?\.(update|delete|insert|upsert)\(/);
    }
  });

  it("keeps EC-2's own surfaces free of document promotion", () => {
    // The guard EC-2 wrote must remain true: ingestion lives in its own module.
    const all = code(EC2_ACTIONS) + code(EC2_STUDIO);
    expect(all).not.toMatch(/public\.document|from\("document"\)/);
  });

  it("is positioned as migration 88 with nothing before it moved", () => {
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(files.indexOf("20260812000001_document_ingest_provenance.sql")).toBe(87);
    expect(files.indexOf("20260811000001_outbound_mail.sql")).toBe(86);
  });
});

// ---------------------------------------------------------------------------
// 2. Provenance
// ---------------------------------------------------------------------------
describe("provenance is recorded, not inferred", () => {
  it("adds exactly one nullable FK to the inbound attachment", () => {
    const s = sql(MIGRATION);
    expect(s).toContain("add column if not exists source_attachment_id uuid");
    expect(s).toContain("references public.ec_inbound_attachment (id)");
    // Scoped to the DDL: the migration's own assertion MESSAGE mentions
    // "NOT NULL", and matching prose is not matching a column definition.
    const ddl = s.slice(s.indexOf("alter table public.document"), s.indexOf("comment on column"));
    expect(ddl).not.toMatch(/not null/i);
  });

  it("keeps BOTH the hash and the FK — they answer different questions", () => {
    const s = code(SERVICE);
    expect(s).toContain("content_sha256: contentSha256");
    expect(s).toContain("source_attachment_id: attachment.id");
  });

  it("hashes the bytes it actually stores, and stores the bytes it hashed", () => {
    const s = code(SERVICE);
    const hash = s.indexOf("sha256Hex(bytes)");
    const upload = s.indexOf("uploadObject(path, bytes");
    expect(hash).toBeGreaterThan(-1);
    expect(upload).toBeGreaterThan(hash);
    // One buffer, used for both — no re-read between them.
    expect((s.match(/arrayBuffer\(\)/g) ?? []).length).toBe(1);
  });

  it("refuses when the copied bytes disagree with the captured hash", () => {
    const s = code(SERVICE);
    expect(s).toContain("hash_mismatch");
    expect(s).toContain("attachment.sha256.toLowerCase() !== contentSha256");
  });
});

// ---------------------------------------------------------------------------
// 3. Idempotency
// ---------------------------------------------------------------------------
describe("one attachment yields at most one document", () => {
  it("enforces it with a PARTIAL unique index, not only a service check", () => {
    const s = sql(MIGRATION);
    expect(s).toContain("create unique index if not exists uq_document_source_attachment");
    expect(s).toContain("where source_attachment_id is not null");
  });

  it("proves the index bites, and that NULL provenance stays unconstrained", () => {
    const s = sql(MIGRATION);
    expect(s).toContain("the same attachment was ingested twice");
    expect(s).toContain("when unique_violation then null");
    // Two documents with no source attachment must remain legal, or every
    // ordinary upload would break.
    expect(s).toContain("emp4/assert/c.pdf");
    expect(s).toContain("emp4/assert/d.pdf");
  });

  it("treats a unique violation as already_ingested, never as a crash", () => {
    const s = code(SERVICE);
    expect(s).toContain('insertError.code === "23505"');
    expect(s).toContain("already_ingested");
  });

  it("does not delete the stored object when it loses the race", () => {
    // Removing an object on a path another writer may own is worse than
    // leaving an inert orphan.
    const s = code(SERVICE);
    expect(s).not.toContain("removeObject");
  });

  it("never makes duplicate creation the default", () => {
    const s = code(SERVICE) + code(ACTIONS) + code(UI);
    expect(s).not.toMatch(/force|allowDuplicate|override/i);
  });
});

// ---------------------------------------------------------------------------
// 4. Authorization
// ---------------------------------------------------------------------------
describe("ingestion requires both authorities", () => {
  it("checks inbound read AND document create AND dossier visibility", () => {
    const s = code(ACTIONS);
    expect(s).toContain('hasPermission(permissions, "communication:inbound:read")');
    expect(s).toContain('hasPermission(permissions, "document:create")');
    expect(s).toContain("isFileVisible(user.id, user.tenantId, input.fileId)");
  });

  it("creates no new permission anywhere", () => {
    for (const f of [MIGRATION, SERVICE, ACTIONS, UI]) {
      expect(read(f)).not.toMatch(/ingest:[a-z]+|document:ingest/);
    }
  });

  it("scopes every read by tenant", () => {
    const s = code(SERVICE);
    const reads = (s.match(/\.from\("(ec_inbound_attachment|document)"\)/g) ?? []).length;
    const scopes = (s.match(/\.eq\("tenant_id", tenantId\)/g) ?? []).length;
    expect(scopes).toBeGreaterThanOrEqual(reads - 1); // the insert carries tenant_id in its payload
    expect(s).toContain("tenant_id: tenantId");
  });

  it("grants SYSTEM_ADMIN nothing", () => {
    for (const f of [MIGRATION, SERVICE, ACTIONS, UI]) {
      expect(code(f)).not.toContain("SYSTEM_ADMIN");
    }
  });

  it("requires an explicit document type — none is inferred", () => {
    expect(code(ACTIONS)).toContain('return { ok: false, error: "type_required" }');
    const ui = code(UI);
    expect(ui).toContain("— Type de document —");
    expect(ui).toContain("!typeCode");
  });
});

// ---------------------------------------------------------------------------
// 5. Out of scope — pinned
// ---------------------------------------------------------------------------
describe("EMP-4 ships nothing from a later phase", () => {
  it("triggers no OCR and no document intelligence", () => {
    for (const f of [SERVICE, ACTIONS, UI]) {
      const s = code(f);
      for (const forbidden of ["createIntelligenceJob", "runExtraction", "docintel", "extractSearchablePdf"]) {
        expect(s, f).not.toContain(forbidden);
      }
    }
  });

  it("runs no AI, classification, extraction or summarization", () => {
    for (const f of [SERVICE, ACTIONS, UI]) {
      const s = code(f).toLowerCase();
      for (const forbidden of ["openai", "anthropic", "classify", "summar", "runcopilot", "suggest"]) {
        expect(s, f).not.toContain(forbidden);
      }
    }
  });

  it("introduces no background work", () => {
    for (const f of [SERVICE, ACTIONS]) {
      expect(code(f)).not.toMatch(/setTimeout|setInterval|cron|queue|worker|scheduler/i);
    }
  });

  it("adds no customer visibility", () => {
    const s = code(SERVICE) + code(ACTIONS) + code(UI);
    expect(s).not.toContain("shared_with_client");
    expect(s).not.toContain("portal");
    // The document arrives UPLOADED, exactly like a manual upload.
    expect(code(SERVICE)).toContain('status: "UPLOADED"');
  });

  it("changes no customer-facing projection", () => {
    // DOCUMENT_UPLOADED was already client-safe before EMP-4; that is unchanged
    // and is not something this phase introduced.
    expect(clientSafeEventTypes().map((e) => e.type)).toContain("DOCUMENT_UPLOADED");
  });
});

// ---------------------------------------------------------------------------
// 6. Audit and events are not duplicated
// ---------------------------------------------------------------------------
describe("one act, one audit entry, one timeline entry", () => {
  it("writes exactly one audit entry, distinct from the timeline event", () => {
    const s = code(ACTIONS);
    expect((s.match(/writeAudit\(/g) ?? []).length).toBe(1);
    expect(s).toContain("EC_ATTACHMENT_INGESTED");
    expect(read("lib/audit/events.ts")).toContain('EC_ATTACHMENT_INGESTED: "ec.attachment.ingested"');
  });

  it("the service writes no audit of its own — the action owns that", () => {
    expect(code(SERVICE)).not.toContain("writeAudit");
  });

  it("the SQL suite proves exactly-once emission against a real database", () => {
    expect(existsSync(join(root, SUITE))).toBe(true);
    const s = read(SUITE);
    expect(s).toContain("DOCUMENT_UPLOADED");
    expect(s).toContain("exactly once");
    expect(read(".github/workflows/ci.yml")).toContain(SUITE);
  });
});
