/**
 * EC-1 — Inbound Email Foundation. Pins the boundaries this phase promised NOT
 * to cross as hard as the behaviour it delivered: capture only, no business
 * object, no fifth comms engine, no scheduler, no SYSTEM_ADMIN read.
 *
 * The pure layer (parse.ts) is unit-tested directly; the server layer is pinned
 * by source contract, because it needs a database and a provider to run.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeAddress, normalizeAddressList, extractDisplayName, sanitizeFilename,
  deriveThreadKey, resolveRouting, isAllowedAttachmentMime, isOversized,
  inboundStoragePath, MAX_WEBHOOK_BYTES, MAX_ATTACHMENT_BYTES, type MailboxRow,
} from "@/lib/ec/inbound/parse";
import { isInboundProviderName, INBOUND_PROVIDERS } from "@/lib/ec/inbound/types";
import { AuditActions } from "@/lib/audit/events";
import { isSystemAction } from "@/lib/audit/validate";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const MIG = "supabase/migrations/20260804000001_ec_inbound_foundation.sql";
const CAPTURE = "lib/ec/inbound/capture.ts";
const ROUTE = "app/api/ec/inbound/[provider]/route.ts";
const EC_TABLES = [
  "ec_mailbox", "ec_webhook_event", "ec_inbound_message",
  "ec_inbound_attachment", "ec_triage_item", "tenant_ec_inbound_rollout",
];

// ---------------------------------------------------------------------------
describe("migration chain", () => {
  it("adds exactly one migration after 79 and touches none before it", () => {
    const all = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    // Pinned RELATIVELY: later phases legitimately add migrations, and a global
    // count would make every future phase look like a breach of EC-1's promise.
    const hr6 = all.indexOf("20260803000002_hr_training.sql");
    expect(hr6).toBeGreaterThan(-1);
    expect(all[hr6 + 1]).toBe("20260804000001_ec_inbound_foundation.sql");
  });

  it("is idempotent and makes no destructive change", () => {
    const sql = code(MIG);
    for (const t of EC_TABLES) expect(sql, t).toContain(`create table if not exists public.${t}`);
    expect(sql).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b|\balter column .* type\b/i);
    for (const m of sql.match(/^\s*drop\s+(\w+)/gim) ?? []) {
      expect(m.trim().split(/\s+/)[1].toLowerCase()).toMatch(/^(trigger|policy|function)$/);
    }
  });
});

// ---------------------------------------------------------------------------
describe("permissions — inbound gets its OWN read gate", () => {
  it("catalogues exactly two codes and grants neither", () => {
    const sql = code(MIG);
    const added = [...sql.matchAll(/\('(communication:[a-z:_]+)',\s*'communication'/g)].map((m) => m[1]);
    expect(added.sort()).toEqual(["communication:inbound:read", "communication:triage"]);
    expect(sql).not.toMatch(/insert into public\.role_permission/i);
  });

  it("does NOT gate inbound reads on communication:read — which SYSTEM_ADMIN holds", () => {
    // The whole reason a new code exists. communication:read is granted to five
    // roles including SYSTEM_ADMIN in 20260615000008; reusing it would hand
    // every customer email to a platform administrator on day one.
    const seed = code("supabase/migrations/20260615000008_create_communications.sql");
    expect(seed).toMatch(/communication:read[\s\S]*?SYSTEM_ADMIN/);

    const sql = code(MIG);
    const policies = [...sql.matchAll(/create policy (\w+)_select on public\.(\w+)([\s\S]*?);/g)];
    const gated = policies.filter((p) => p[2] !== "tenant_ec_inbound_rollout");
    expect(gated.length).toBe(EC_TABLES.length - 1);
    for (const p of gated) {
      expect(p[3], p[2]).toContain("public.has_permission('communication:inbound:read')");
      expect(p[3], p[2]).not.toContain("has_permission('communication:read')");
    }
  });

  it("never names SYSTEM_ADMIN and creates no portal policy", () => {
    const sql = code(MIG);
    expect(sql).not.toContain("SYSTEM_ADMIN");
    expect(sql).not.toMatch(/client_user|portal/i);
  });

  it("grants authenticated SELECT only — writes go through the service role", () => {
    for (const g of code(MIG).match(/grant [\s\S]*?to authenticated;/g) ?? []) {
      expect(g).toMatch(/grant select/);
      expect(g).not.toMatch(/insert|update|delete/i);
    }
  });
});

// ---------------------------------------------------------------------------
describe("capture is capture-only — the core promise", () => {
  it("the pipeline imports NO business service", () => {
    const c = code(CAPTURE);
    for (const forbidden of [
      "@/lib/files", "@/lib/clients", "@/lib/documents", "@/lib/tasks",
      "@/lib/finance", "@/lib/process", "@/lib/portal", "@/lib/hr",
    ]) {
      expect(c, forbidden).not.toContain(`from "${forbidden}`);
    }
  });

  it("the pipeline writes ONLY to ec_* tables (plus storage and audit)", () => {
    const c = code(CAPTURE);
    const written = new Set([...c.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]));
    for (const t of written) expect(t.startsWith("ec_") || t === "tenant_ec_inbound_rollout", t).toBe(true);
    expect(written.has("ec_inbound_message")).toBe(true);
  });

  it("creates no client, dossier, document, task, quotation or invoice", () => {
    const c = code(CAPTURE) + code(ROUTE) + code(MIG);
    for (const forbidden of [
      "operational_file", "public.document", "quotation", "invoice",
      "task", "client_notification",
    ]) {
      expect(c, forbidden).not.toContain(forbidden);
    }
  });

  it("has no foreign key from EC into any business table", () => {
    const sql = code(MIG);
    const refs = [...sql.matchAll(/references public\.(\w+)/g)].map((m) => m[1]);
    const allowed = new Set(["organization", "app_user", "platform_admin", ...EC_TABLES]);
    for (const r of refs) expect(allowed.has(r), `unexpected FK target: ${r}`).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("webhook security", () => {
  it("verifies the signature over the RAW body, reusing the payments helper", () => {
    const p = code("lib/ec/inbound/providers.ts");
    expect(p).toContain('from "@/lib/finance/providers/sign"');
    expect(p).toContain("verifyHmacSignature(secret, rawBody, signature)");
  });

  it("the route reads the raw body BEFORE anything interprets it", () => {
    // Scoped to the HANDLER: `captureInbound` also appears in the import line,
    // and an import is not an interpretation of the body.
    const r = code(ROUTE);
    const handler = r.slice(r.indexOf("export async function POST"));
    const rawAt = handler.indexOf("req.text()");
    const captureAt = handler.indexOf("captureInbound(");
    expect(rawAt).toBeGreaterThan(-1);
    expect(captureAt).toBeGreaterThan(-1);
    expect(rawAt).toBeLessThan(captureAt);
    expect(r).toContain('runtime = "nodejs"');
  });

  it("carries no session, cookie or permission check at the route", () => {
    const r = code(ROUTE);
    for (const forbidden of ["cookies", "getCurrentUser", "assertPermission", "requireUser"]) {
      expect(r, forbidden).not.toContain(forbidden);
    }
  });

  it("fails closed: dark by env, unknown provider 404, oversize 413, bad signature 401", () => {
    const c = code(CAPTURE);
    expect(c).toContain("if (!inboundEnabled())");
    expect(c).toContain("httpStatus: 503");
    expect(c).toContain("httpStatus: 404");
    expect(c).toContain("httpStatus: 413");
    expect(c).toContain("httpStatus: 401");
    // The size check precedes the parse — refusing before doing work.
    expect(c.indexOf("isOversized(rawBody)")).toBeLessThan(c.indexOf("parseWebhook"));
  });

  it("is idempotent and replay-safe on (provider, event_id)", () => {
    expect(code(MIG)).toContain("unique (provider, provider_event_id)");
    const c = code(CAPTURE);
    expect(c).toContain('outcome: "DUPLICATE"');
    expect(c).toContain('error.code === "23505"');
  });

  it("keeps IMAP polling and schedulers out", () => {
    const c = code(CAPTURE) + code("lib/ec/inbound/providers.ts") + code(ROUTE);
    expect(c).not.toMatch(/imap|pop3|setInterval|cron|node-schedule/i);
    expect(existsSync(join(root, "app", "api", "cron"))).toBe(false);
  });

  it("provider parsing sits behind an adapter registry", () => {
    const p = code("lib/ec/inbound/providers.ts");
    expect(p).toContain("const REGISTRY: Record<InboundProviderName, InboundEmailProvider>");
    expect(p).toContain("export function getInboundProvider");
    // The capture pipeline never branches on a provider name.
    expect(code(CAPTURE)).not.toMatch(/provider === "GENERIC"|provider === "RESEND"/);
  });

  it("RESEND stays not_configured until DEC-EC-D2", () => {
    expect(code("lib/ec/inbound/providers.ts")).toContain('InboundProviderError("not_configured"');
    expect([...INBOUND_PROVIDERS]).toEqual(["GENERIC", "RESEND"]);
    expect(isInboundProviderName("GENERIC")).toBe(true);
    expect(isInboundProviderName("MAILGUN")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("data protection — no prose escapes", () => {
  it("audit payloads carry identifiers and outcomes only", () => {
    const c = code(CAPTURE);
    for (const m of c.match(/writeAudit\(\{[\s\S]*?\}\)/g) ?? []) {
      for (const forbidden of [
        "subject", "textBody", "htmlBody", "rawEnvelope", "fromAddress",
        "from_address", "filename", "headers", "toAddresses",
      ]) {
        expect(m, forbidden).not.toContain(forbidden);
      }
    }
  });

  it("no body, subject or address is logged or returned to the caller", () => {
    const c = code(CAPTURE) + code(ROUTE);
    expect(c).not.toMatch(/console\.(log|info|warn|error)/);
    // The HTTP response is an outcome plus a short classification, nothing else.
    expect(code(ROUTE)).toContain("outcome: result.outcome");
    expect(code(ROUTE)).toContain("detail: result.detail ?? null");
  });

  it("bodies live in storage, never in a column", () => {
    const sql = code(MIG);
    expect(sql).toContain("text_body_path");
    expect(sql).toContain("html_body_path");
    for (const forbidden of ["text_body ", "html_body ", "body_text", "body_html"]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
  });

  it("the three audit actions are registered as MACHINE events", () => {
    for (const a of [
      AuditActions.EC_INBOUND_RECEIVED,
      AuditActions.EC_INBOUND_QUARANTINED,
      AuditActions.EC_INBOUND_REJECTED,
    ]) {
      expect(a.startsWith("ec.inbound.")).toBe(true);
      // No human actor exists for a provider POST; the validator must allow it.
      expect(isSystemAction(a), a).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe("routing — explicit or quarantine, never a guess", () => {
  const mb = (id: string, tenantId: string, isActive = true): MailboxRow =>
    ({ id, tenantId, address: `${id}@x.test`, isActive });

  it("one matching mailbox routes", () => {
    expect(resolveRouting([mb("m1", "t1")])).toEqual({ routed: true, tenantId: "t1", mailboxId: "m1" });
  });

  it("no match quarantines", () => {
    expect(resolveRouting([])).toEqual({ routed: false, reason: "no_matching_mailbox" });
  });

  it("two DIFFERENT mailboxes refuse — even inside one tenant", () => {
    expect(resolveRouting([mb("m1", "t1"), mb("m2", "t1")]))
      .toEqual({ routed: false, reason: "ambiguous_routing" });
    expect(resolveRouting([mb("m1", "t1"), mb("m2", "t2")]))
      .toEqual({ routed: false, reason: "ambiguous_routing" });
  });

  it("the SAME mailbox named twice (To and Cc) is not ambiguous", () => {
    expect(resolveRouting([mb("m1", "t1"), mb("m1", "t1")]))
      .toEqual({ routed: true, tenantId: "t1", mailboxId: "m1" });
  });

  it("an inactive sole match refuses rather than routing", () => {
    expect(resolveRouting([mb("m1", "t1", false)]))
      .toEqual({ routed: false, reason: "mailbox_inactive" });
  });

  it("the address is globally unique, so no address can span two tenants", () => {
    expect(code(MIG)).toContain("create unique index if not exists uq_ec_mailbox_address on public.ec_mailbox (address)");
  });

  it("routing never consults the sender", () => {
    const c = code(CAPTURE);
    const block = c.slice(c.indexOf("const recipients"), c.indexOf("const messageRowId") + 1 || c.length);
    expect(block).not.toContain("fromAddress");
  });

  it("quarantine has no tenant, so no tenant can see it", () => {
    const sql = code(MIG);
    expect(sql).toContain("capture_status = 'QUARANTINED' and tenant_id is null");
    expect(sql).toContain("tenant_id = public.auth_tenant_id()");
  });
});

// ---------------------------------------------------------------------------
describe("address and filename normalization", () => {
  it("normalizes display names, angle brackets and case", () => {
    expect(normalizeAddress('"Awa Ndiaye" <Awa@Example.COM>')).toBe("awa@example.com");
    expect(normalizeAddress("  Ops@Tenant.SN ")).toBe("ops@tenant.sn");
    expect(normalizeAddress("not-an-address")).toBeNull();
    expect(normalizeAddress("a b@c.test")).toBeNull();
    expect(normalizeAddress(null)).toBeNull();
    expect(normalizeAddress(`${"x".repeat(400)}@y.test`)).toBeNull();
  });

  it("dedupes a recipient list and drops unusable entries", () => {
    expect(normalizeAddressList(["A@x.test", "a@x.test", "junk", null, "B@x.test"]))
      .toEqual(["a@x.test", "b@x.test"]);
  });

  it("extracts a display name without using it for routing", () => {
    expect(extractDisplayName('"Awa" <a@x.test>')).toBe("Awa");
    expect(extractDisplayName("a@x.test")).toBeNull();
  });

  it("sanitizes hostile filenames", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Windows\\evil.exe")).toBe("evil.exe");
    expect(sanitizeFilename("bon de livraison.pdf")).toBe("bon_de_livraison.pdf");
    expect(sanitizeFilename("...hidden")).toBe("hidden");
    expect(sanitizeFilename("")).toBe("piece-jointe");
    expect(sanitizeFilename(null)).toBe("piece-jointe");
    expect(sanitizeFilename("a".repeat(300)).length).toBeLessThanOrEqual(120);
    // No path separator can survive.
    for (const n of ["a/b", "a\\b", "..", "./x"]) {
      expect(sanitizeFilename(n)).not.toMatch(/[/\\]/);
    }
  });

  it("derives a thread key from References, then In-Reply-To, then Message-ID", () => {
    expect(deriveThreadKey({ messageId: "<c>", inReplyTo: "<b>", referencesHeader: "<a> <b>" })).toBe("<a>");
    expect(deriveThreadKey({ messageId: "<c>", inReplyTo: "<b>", referencesHeader: null })).toBe("<b>");
    expect(deriveThreadKey({ messageId: "<c>", inReplyTo: null, referencesHeader: null })).toBe("<c>");
    expect(deriveThreadKey({ messageId: null, inReplyTo: null, referencesHeader: null })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("attachments — evidence-in-waiting, never documents", () => {
  it("enforces a MIME allow-list", () => {
    expect(isAllowedAttachmentMime("application/pdf")).toBe(true);
    expect(isAllowedAttachmentMime("application/pdf; charset=binary")).toBe(true);
    expect(isAllowedAttachmentMime("APPLICATION/PDF")).toBe(true);
    expect(isAllowedAttachmentMime("application/x-msdownload")).toBe(false);
    expect(isAllowedAttachmentMime("text/html")).toBe(false);
    expect(isAllowedAttachmentMime(null)).toBe(false);
  });

  it("records refused parts instead of dropping them", () => {
    const sql = code(MIG);
    expect(sql).toContain("rejection_reason");
    expect(sql).toContain("'mime_not_allowed','too_large','extraction_failed'");
    expect(sql).toContain("constraint ec_attachment_stored_shape");
    // Metadata is mandatory; bytes are conditional.
    expect(code(CAPTURE)).toContain("sha256: sha256Hex(bytes)");
  });

  it("never writes into the documents bucket or public.document", () => {
    const c = code(CAPTURE);
    expect(c).toContain('EC_INBOUND_BUCKET = "ec-inbound"');
    expect(c).not.toMatch(/"documents"|messaging-attachments|hr-documents/);
  });

  it("scopes storage paths by tenant, and quarantine outside every tenant", () => {
    expect(inboundStoragePath("00000000-0000-0000-0000-000000000001", "m", "raw.eml"))
      .toBe("00000000-0000-0000-0000-000000000001/m/raw.eml");
    // A non-uuid scope cannot forge a tenant prefix.
    expect(inboundStoragePath("quarantine", "m", "raw.eml")).toBe("quarantine/m/raw.eml");
    expect(inboundStoragePath("../../etc", "m", "raw.eml")).toBe("quarantine/m/raw.eml");
  });

  it("caps payload and attachment size", () => {
    expect(MAX_WEBHOOK_BYTES).toBe(26_214_400);
    expect(MAX_ATTACHMENT_BYTES).toBe(15_728_640);
    expect(isOversized("x".repeat(10))).toBe(false);
    expect(isOversized("x".repeat(11), 10)).toBe(true);
    // Measured in BYTES: a multi-byte character must not be counted as one.
    expect(isOversized("é".repeat(6), 10)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("immutability and triage foundation", () => {
  it("the capture is append-only; the triage item is the mutable half", () => {
    const sql = code(MIG);
    expect(sql).toMatch(/trg_ec_inbound_message_immutable[\s\S]*?prevent_mutation/);
    expect(sql).toMatch(/trg_ec_attachment_immutable[\s\S]*?prevent_mutation/);
    expect(sql).toMatch(/trg_ec_webhook_event_immutable[\s\S]*?prevent_mutation/);
    // The triage table has NO prevent_mutation — it is meant to change.
    const triageBlock = sql.slice(sql.indexOf("create table if not exists public.ec_triage_item"));
    expect(triageBlock.slice(0, triageBlock.indexOf("create table") + 1 || undefined))
      .not.toContain("prevent_mutation");
  });

  it("ships the five triage states and no outcome column (that is EC-2)", () => {
    const sql = code(MIG);
    expect(sql).toContain("'NEW','ASSIGNED','IN_REVIEW','RESOLVED','QUARANTINED'");
    for (const ec2 of ["outcome", "file_id", "quotation", "dossier"]) {
      const block = sql.slice(sql.indexOf("create table if not exists public.ec_triage_item"),
                              sql.indexOf("create index if not exists idx_ec_triage_tenant_status"));
      expect(block, ec2).not.toContain(ec2);
    }
  });

  it("guards triage transitions and keeps terminal states terminal", () => {
    const sql = code(MIG);
    const fn = sql.slice(sql.indexOf("function public.ec_triage_transition_guard"));
    expect(fn).toContain("old.status in ('RESOLVED','QUARANTINED')");
    expect(fn).toContain("EC601");
    expect(fn).toContain("EC602"); // quarantine is decided at capture, never after
    expect(fn).toContain("EC603");
  });
});

// ---------------------------------------------------------------------------
describe("no fifth communication engine", () => {
  it("EC-1 adds no outbound path and touches no existing comms contract", () => {
    const c = code(CAPTURE) + code("lib/ec/inbound/providers.ts") + code(ROUTE);
    expect(c).not.toMatch(/queueAndSend|sendEmail|communication_message|notifyCustomer/);
  });

  it("leaves the four existing subsystems' tables untouched", () => {
    const sql = code(MIG);
    for (const t of ["communication_message", "conversation", "notification", "client_notification"]) {
      expect(sql, t).not.toContain(t);
    }
  });

  it("uses the two-layer flag doctrine, failing closed", () => {
    expect(code(MIG)).toContain("create table if not exists public.tenant_ec_inbound_rollout");
    const c = code(CAPTURE);
    expect(c).toContain("if (error || !data) return false; // fail closed");
    expect(code("lib/ec/inbound/providers.ts"))
      .toContain('process.env.EFFITRANS_EC_INBOUND_ENABLED === "true"');
  });

  it("is registered in CI as its own RLS suite", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("rls_ec_inbound_test.sql");
    expect(ci).toContain("EC-1 FAIL");
  });
});
