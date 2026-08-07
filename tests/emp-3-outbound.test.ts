/**
 * EMP-3 — governed outbound mail.
 *
 * The composition rules are pure, so recipient validation, reply headers and
 * reply-all audience are tested behaviourally. Concurrency, exactly-once
 * emission and the privilege matrix live in SQL, so those are asserted against
 * the migration — and exercised for real by the DO blocks inside it, which run
 * at migration time in CI.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  isValidAddress, validateRecipients, buildReplyHeaders, buildReplyAudience,
  replySubject, idempotencyKeyFor, validateAttachmentRefs, MAX_RECIPIENTS,
  type ReplySource,
} from "@/lib/comms/compose";
import { EVENT_TYPES, getEventType, clientSafeEventTypes } from "@/lib/workflow/events/types";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260811000001_outbound_mail.sql";
const DISPATCH = "lib/comms/dispatch.ts";
const ACTIONS = "lib/comms/outbound-actions.ts";
const COMPOSE = "lib/comms/compose.ts";
const PROVIDER = "lib/comms/provider.ts";
const LEGACY = "lib/comms/actions.ts";

const source = (p: Partial<ReplySource> = {}): ReplySource => ({
  messageId: "<parent@x.com>", inReplyTo: null, referencesHeader: null,
  fromAddress: "client@acme.com", toAddresses: ["ops@effitrans.sn"], ccAddresses: [],
  subject: "Conteneur MSKU1234567", ...source0(p),
});
const source0 = (p: Partial<ReplySource>) => p;

// ---------------------------------------------------------------------------
// 1. Architecture — one queue, one timeline, no second anything
// ---------------------------------------------------------------------------
describe("EMP-3 reuses the existing outbound queue", () => {
  it("creates no second outbound table", () => {
    const s = sql(MIGRATION);
    expect(s).not.toMatch(/create\s+table/i);
    expect(s).toMatch(/alter table public\.communication_message/i);
  });

  it("adds no new RLS policy and no new permission", () => {
    const s = sql(MIGRATION);
    expect(s).not.toMatch(/create\s+policy/i);
    expect(s).not.toMatch(/insert into public\.permission/i);
    expect(s).not.toMatch(/insert into public\.role_permission/i);
  });

  it("adds no second timeline or event journal", () => {
    const s = sql(MIGRATION);
    expect(s).not.toMatch(/create table.*event/i);
    // It writes to the ledger only through the sanctioned function.
    expect(s).toContain("public.emit_business_event(");
  });

  it("does not duplicate the inbound emitter", () => {
    const s = sql(MIGRATION);
    expect(s).not.toContain("CORRESPONDENCE_RECEIVED");
    // A foreign key to the inbound table is fine and expected (a reply names
    // the message it answers). What must not exist is any TRIGGER on it — that
    // would be a second emitter beside UT-3B's.
    expect(s).not.toMatch(/create trigger[\s\S]*?on public\.ec_inbound_message/i);
    expect(s).toContain("references public.ec_inbound_message (id)");
  });

  it("leaves the inbound trigger from UT-3B untouched", () => {
    const ut3 = sql("supabase/migrations/20260810000001_decision_plane_emitters.sql");
    expect(ut3).toContain("emit_correspondence_received");
    expect(getEventType("CORRESPONDENCE_RECEIVED")?.emission).toBe("trigger");
  });

  it("is positioned as migration 87 and nothing before it moved", () => {
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(files.indexOf("20260811000001_outbound_mail.sql")).toBe(86);
    expect(files.indexOf("20260810000001_decision_plane_emitters.sql")).toBe(85);
  });
});

// ---------------------------------------------------------------------------
// 2. No fake template key
// ---------------------------------------------------------------------------
describe("free compose needs no fake template", () => {
  it("makes template_key nullable and couples it to kind", () => {
    const s = sql(MIGRATION);
    expect(s).toMatch(/alter column template_key drop not null/i);
    expect(s).toContain("(kind = 'TEMPLATE') = (template_key is not null)");
  });

  it("never invents a sentinel template key", () => {
    for (const f of [MIGRATION, ACTIONS, COMPOSE, DISPATCH]) {
      expect(read(f)).not.toContain("FREE_COMPOSE");
    }
    // The compose path writes a NULL template, not a placeholder.
    expect(code(ACTIONS)).toContain("template_key: null");
  });
});

// ---------------------------------------------------------------------------
// 3. Delivery vocabulary — only what evidence supports
// ---------------------------------------------------------------------------
describe("delivery states claim only what can be proven", () => {
  it("declares exactly the six evidenced states", () => {
    const s = sql(MIGRATION);
    expect(s).toContain("check (status in ('DRAFT', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED'))");
  });

  it("introduces no DELIVERED or READ state anywhere", () => {
    // There is no bounce or delivery webhook in this platform, so neither is
    // provable and neither may exist.
    for (const f of [MIGRATION, DISPATCH, ACTIONS, COMPOSE]) {
      const s = read(f);
      expect(s).not.toMatch(/['"]DELIVERED['"]/);
      expect(s).not.toMatch(/['"]READ['"]/);
    }
  });

  it("requires provider evidence before a row may be SENT", () => {
    expect(sql(MIGRATION)).toContain("check (status <> 'SENT' or provider is not null)");
  });

  it("grandfathers historical sends instead of aborting the migration", () => {
    // Caught by CI, not locally: ADD CONSTRAINT validates existing rows, and
    // every row sent before EMP-3 is SENT with no provider — the column did not
    // exist. Without NOT VALID this migration fails on any database with
    // history, which is every real one.
    const s = sql(MIGRATION);
    const c = s.slice(s.indexOf("communication_message_sent_evidence"));
    expect(c.slice(0, 400)).toContain("not valid");
  });

  it("back-fills no provider onto historical rows", () => {
    // We do not know which provider accepted them, and for much of that period
    // the answer is "none — the stub did". A guess would manufacture exactly
    // the false evidence RATIFY-EMP3-2 exists to prevent.
    const s = sql(MIGRATION);
    expect(s).not.toMatch(/update public\.communication_message\s+set provider/i);
  });
});

// ---------------------------------------------------------------------------
// 4. Concurrency — the defect this phase exists to close
// ---------------------------------------------------------------------------
describe("duplicate sends are impossible", () => {
  it("acquires the send by compare-and-set before the provider is called", () => {
    const s = sql(MIGRATION);
    const fn = s.slice(s.indexOf("function public.comm_acquire_send"));
    expect(fn).toContain("set status = 'SENDING'");
    expect(fn).toContain("and status in ('QUEUED', 'FAILED')");
  });

  it("the dispatcher calls the provider only after winning the CAS", () => {
    const s = code(DISPATCH);
    const acquire = s.indexOf("comm_acquire_send");
    const send = s.indexOf("await sendEmail(");
    expect(acquire).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(acquire);
    // And it bails out explicitly when it did not win.
    expect(s).toContain("acquired !== true");
  });

  it("the migration proves single-winner CAS at migration time", () => {
    const s = sql(MIGRATION);
    expect(s).toContain("if public.comm_acquire_send(v_id, v_tenant) then");
    expect(s).toContain("second acquire also won");
  });

  it("a stuck SENDING row is never redispatched automatically", () => {
    // DRAFT and SENDING are both absent from the acquirable set.
    const s = sql(MIGRATION);
    const fn = s.slice(s.indexOf("function public.comm_acquire_send"));
    // The acquirable set is exactly QUEUED and FAILED. SENDING is not in it, so
    // an in-flight row can never be acquired a second time.
    const where = fn.slice(fn.indexOf("and status in ("), fn.indexOf("returning"));
    expect(where).toContain("'QUEUED'");
    expect(where).toContain("'FAILED'");
    expect(where).not.toContain("'SENDING'");
    expect(where).not.toContain("'DRAFT'");
    expect(code(DISPATCH)).not.toMatch(/setTimeout|setInterval|retryLoop/);
  });

  it("reconciliation is human, audited, and cannot claim a send happened", () => {
    const s = sql(MIGRATION);
    const start = s.indexOf("function public.comm_reconcile_stuck_send");
    const fn = s.slice(start, s.indexOf("revoke all on function public.comm_reconcile_stuck_send"));
    expect(fn).toContain("p_outcome not in ('FAILED', 'CANCELLED')");
    // "It was actually sent" is deliberately not offered: recording an
    // acceptance nobody witnessed would fabricate a ledger event.
    expect(fn).not.toContain("'SENT'");
    expect(code(ACTIONS)).toContain('hasPermission(permissions, "communication:manage")');
    expect(code(DISPATCH)).toContain("COMMUNICATION_RECONCILED");
  });

  it("retry reuses the row's own identity as the idempotency key", () => {
    expect(idempotencyKeyFor("abc")).toBe("msg:abc");
    expect(idempotencyKeyFor("abc")).toBe(idempotencyKeyFor("abc"));
    expect(idempotencyKeyFor("abc")).not.toBe(idempotencyKeyFor("def"));
  });

  it("enforces idempotency in the database, not only in code", () => {
    expect(sql(MIGRATION)).toContain("create unique index if not exists uq_comm_idempotency");
    expect(sql(MIGRATION)).toContain("where idempotency_key is not null");
  });
});

// ---------------------------------------------------------------------------
// 5. The no-op provider (RATIFY-EMP3-2)
// ---------------------------------------------------------------------------
describe("an unconfigured provider fails closed", () => {
  it("returns provider_not_configured instead of success", () => {
    const s = code(PROVIDER);
    expect(s).toContain('return { ok: false, error: "provider_not_configured" }');
    // The old lie is gone.
    expect(s).not.toMatch(/No-op: the message is treated as delivered/);
  });

  it("the dispatcher refuses before acquiring, so nothing is consumed", () => {
    const s = code(DISPATCH);
    const guard = s.indexOf("isProviderConfigured()");
    const acquire = s.indexOf("comm_acquire_send");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(acquire);
  });

  it("the database refuses to record acceptance from a stub", () => {
    const s = sql(MIGRATION);
    const fn = s.slice(s.indexOf("function public.comm_record_send_accepted"));
    expect(fn).toContain("p_provider not in ('resend', 'smtp')");
    expect(fn).toContain("raise exception");
  });

  it("a send with no provider never reaches SENT and emits nothing", () => {
    const s = code(DISPATCH);
    // The only path to the emitting RPC requires result.provider to be set.
    expect(s).toContain("if (!result.ok || !result.provider)");
    const failBranch = s.slice(s.indexOf("if (!result.ok || !result.provider)"));
    expect(failBranch.slice(0, 400)).toContain("comm_record_send_failed");
    expect(failBranch.slice(0, 400)).not.toContain("comm_record_send_accepted");
  });
});

// ---------------------------------------------------------------------------
// 6. Exactly-once emission
// ---------------------------------------------------------------------------
describe("CORRESPONDENCE_SENT is emitted exactly once, after acceptance", () => {
  it("exists in the registry as an rpc-emitted, non-client-safe event", () => {
    const def = getEventType("CORRESPONDENCE_SENT");
    expect(def).toBeTruthy();
    expect(def?.domain).toBe("communication");
    expect(def?.emission).toBe("rpc");
    expect(def?.clientSafe).toBe(false);
  });

  it("is emitted from exactly one place, inside the acceptance transaction", () => {
    const s = sql(MIGRATION);
    expect(s.match(/'CORRESPONDENCE_SENT'/g) ?? []).toHaveLength(1);
    const fn = s.slice(s.indexOf("function public.comm_record_send_accepted"));
    expect(fn).toContain("'CORRESPONDENCE_SENT'");
    // The transition and the emission are in the same function, so they commit
    // together; a second call finds status <> SENDING and returns early.
    expect(fn).toContain("and status = 'SENDING'");
    expect(fn).toContain("if v_row.id is null then");
  });

  it("carries identifiers and codes only — never content", () => {
    const def = getEventType("CORRESPONDENCE_SENT");
    for (const k of def?.metadataKeys ?? []) {
      expect(["message_id", "mailbox_id", "thread_id", "kind", "provider"]).toContain(k);
    }
    const fn = sql(MIGRATION).slice(sql(MIGRATION).indexOf("function public.comm_record_send_accepted"));
    for (const forbidden of ["subject", "body_text", "body_html", "recipient_email", "to_addresses", "attachments"]) {
      expect(fn).not.toContain(`'${forbidden}'`);
    }
  });

  it("a failed send emits nothing", () => {
    const s = sql(MIGRATION);
    const fn = s.slice(s.indexOf("function public.comm_record_send_failed"), s.indexOf("function public.comm_reconcile_stuck_send"));
    expect(fn).not.toContain("emit_business_event");
  });

  it("a draft emits nothing — drafting is not communicating", () => {
    const s = code(ACTIONS);
    const draft = s.slice(s.indexOf("export async function saveDraft"), s.indexOf("async function prepare"));
    expect(draft).not.toContain("emit_business_event");
    expect(draft).not.toContain("comm_record_send_accepted");
    expect(draft).toContain('status: "DRAFT"');
  });
});

// ---------------------------------------------------------------------------
// 7. Recipient validation (pure)
// ---------------------------------------------------------------------------
describe("recipient validation", () => {
  it("accepts ordinary addresses and rejects malformed ones", () => {
    expect(isValidAddress("client@acme.com")).toBe(true);
    for (const bad of ["", "  ", "no-at-sign", "a@b", "a@@b.com", "a b@c.com", "a@b,c.com"]) {
      expect(isValidAddress(bad), bad).toBe(false);
    }
  });

  it("refuses header injection outright", () => {
    for (const bad of ["a@b.com\nBcc: x@y.com", "a@b.com\r\nSubject: x", "a@b.com\0"]) {
      expect(isValidAddress(bad)).toBe(false);
    }
    const r = validateRecipients({ to: ["a@b.com\nBcc: evil@x.com"] }, "ops@effitrans.sn");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toBe("header_injection");
  });

  it("requires at least one recipient", () => {
    const r = validateRecipients({ to: [] }, "ops@effitrans.sn");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toBe("empty");
  });

  it("de-duplicates deterministically across fields, To winning over Cc over Bcc", () => {
    const r = validateRecipients(
      { to: ["A@x.com"], cc: ["a@x.com", "b@x.com"], bcc: ["B@x.com", "c@x.com"] },
      "ops@effitrans.sn",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recipients.to).toEqual(["A@x.com"]);
      expect(r.recipients.cc).toEqual(["b@x.com"]);
      expect(r.recipients.bcc).toEqual(["c@x.com"]);
    }
  });

  it("refuses the sending mailbox in any field", () => {
    for (const field of ["to", "cc", "bcc"] as const) {
      const input = { to: ["x@y.com"], cc: [] as string[], bcc: [] as string[] };
      input[field] = field === "to" ? ["ops@effitrans.sn"] : ["ops@effitrans.sn"];
      const r = validateRecipients(input, "OPS@effitrans.sn");
      expect(r.ok, field).toBe(false);
      if (!r.ok) expect(r.problem).toBe("sender_in_recipients");
    }
  });

  it("caps the audience", () => {
    const many = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `u${i}@x.com`);
    const r = validateRecipients({ to: many }, "ops@effitrans.sn");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toBe("too_many");
  });
});

// ---------------------------------------------------------------------------
// 8. Reply headers and audience
// ---------------------------------------------------------------------------
describe("reply headers come from evidence, never invention", () => {
  it("sets In-Reply-To and References from the parent", () => {
    const h = buildReplyHeaders(source({ messageId: "<p@x.com>", referencesHeader: "<root@x.com>" }));
    expect(h.inReplyTo).toBe("<p@x.com>");
    expect(h.referencesHeader).toBe("<root@x.com> <p@x.com>");
    expect(h.startsNewThread).toBe(false);
  });

  it("preserves the chain order and does not duplicate the parent", () => {
    const h = buildReplyHeaders(source({ messageId: "<b@x.com>", referencesHeader: "<a@x.com> <b@x.com>" }));
    expect(h.referencesHeader).toBe("<a@x.com> <b@x.com>");
  });

  it("fabricates NOTHING when the parent has no usable Message-ID", () => {
    for (const bad of [null, "", "garbage", "<no-at-sign>"]) {
      const h = buildReplyHeaders(source({ messageId: bad as string | null, referencesHeader: "<a@x.com>" }));
      expect(h.inReplyTo).toBeNull();
      expect(h.referencesHeader).toBeNull();
      expect(h.startsNewThread).toBe(true);
    }
  });

  it("prefixes Re: exactly once", () => {
    expect(replySubject("Conteneur")).toBe("Re: Conteneur");
    expect(replySubject("Re: Conteneur")).toBe("Re: Conteneur");
    expect(replySubject("RE : Conteneur")).toBe("RE : Conteneur");
    expect(replySubject(null)).toBe("Re:");
  });

  it("reply addresses the original sender only", () => {
    const a = buildReplyAudience(source(), "ops@effitrans.sn", false);
    expect(a.to).toEqual(["client@acme.com"]);
    expect(a.cc).toEqual([]);
  });

  it("reply-all keeps everyone visible and drops the sending mailbox", () => {
    const a = buildReplyAudience(
      source({ toAddresses: ["ops@effitrans.sn", "agent@acme.com"], ccAddresses: ["watch@acme.com"] }),
      "ops@effitrans.sn",
      true,
    );
    expect(a.to).toEqual(["client@acme.com"]);
    expect(a.cc).toEqual(["agent@acme.com", "watch@acme.com"]);
    expect([...a.to, ...a.cc]).not.toContain("ops@effitrans.sn");
  });

  it("reply-all removes duplicates deterministically", () => {
    const a = buildReplyAudience(
      source({ fromAddress: "client@acme.com", toAddresses: ["CLIENT@acme.com"], ccAddresses: ["client@acme.com"] }),
      "ops@effitrans.sn",
      true,
    );
    expect(a.to).toEqual(["client@acme.com"]);
    expect(a.cc).toEqual([]);
  });

  it("NEVER reconstructs a prior Bcc — the field does not exist on the source", () => {
    // The strongest possible form: ReplySource has no bcc, so reply-all cannot
    // reach one even if a future edit tried.
    const s = code(COMPOSE);
    const type = s.slice(s.indexOf("export type ReplySource"), s.indexOf("export type ReplyHeaders"));
    expect(type).not.toMatch(/bcc/i);
    // And the reply loader never selects it from the database.
    const loader = code(ACTIONS).slice(code(ACTIONS).indexOf("async function loadReplySource"));
    expect(loader.slice(0, 700)).not.toContain("bcc_addresses");
  });

  it("never infers recipients from subject text", () => {
    const s = code(COMPOSE);
    const audience = s.slice(s.indexOf("export function buildReplyAudience"));
    expect(audience.slice(0, 900)).not.toContain("subject");
  });
});

// ---------------------------------------------------------------------------
// 9. Authorization
// ---------------------------------------------------------------------------
describe("authorization and rollout", () => {
  it("separates drafting from sending", () => {
    const s = code(ACTIONS);
    const draft = s.slice(s.indexOf("export async function saveDraft"), s.indexOf("async function prepare"));
    expect(draft).toContain('hasPermission(permissions, "communication:read")');
    const send = s.slice(s.indexOf("export async function sendComposed"));
    expect(send.slice(0, 600)).toContain('hasPermission(permissions, "communication:send")');
  });

  it("requires BOTH rollout halves before any send", () => {
    expect(code(DISPATCH)).toContain('process.env.EFFITRANS_EC_OUTBOUND_ENABLED === "true"');
    const s = code(ACTIONS);
    expect(s).toContain("outboundEnabled()");
    expect(s).toContain("isProviderConfigured()");
  });

  it("an inactive mailbox cannot send", () => {
    const s = code(ACTIONS);
    const resolve = s.slice(s.indexOf("async function resolveMailbox"));
    expect(resolve.slice(0, 900)).toContain('error: "mailbox_inactive"');
    expect(resolve.slice(0, 900)).toContain(".eq(\"tenant_id\", tenantId)");
  });

  it("re-validates the mailbox at SEND time, not only at draft time", () => {
    const send = code(ACTIONS).slice(code(ACTIONS).indexOf("export async function sendComposed"));
    expect(send).toContain("resolveMailbox(user.tenantId, m.mailbox_id)");
  });

  it("resolves the sender server-side — the browser never supplies a From", () => {
    const s = code(ACTIONS);
    expect(s).not.toMatch(/fromAddress\s*[:=]\s*input\./);
    expect(s).toContain('.from("ec_mailbox")');
  });

  it("scopes every outbound read and write by tenant", () => {
    for (const f of [ACTIONS, DISPATCH]) {
      const s = code(f);
      const reads = (s.match(/\.from\("communication_message"\)/g) ?? []).length;
      const scopes = (s.match(/\.eq\("tenant_id", (user\.)?tenantId\)/g) ?? []).length;
      expect(scopes, f).toBeGreaterThanOrEqual(reads);
    }
  });

  it("grants SYSTEM_ADMIN nothing", () => {
    // code(), not read(): the modules' own comments state that SYSTEM_ADMIN
    // holds none of these permissions, and that sentence is not a grant.
    for (const f of [MIGRATION, ACTIONS, DISPATCH, COMPOSE]) {
      expect(code(f), f).not.toContain("SYSTEM_ADMIN");
    }
  });

  it("denies dispatch functions to every browser role", () => {
    const s = sql(MIGRATION);
    for (const fn of ["comm_acquire_send", "comm_record_send_accepted",
      "comm_record_send_failed", "comm_reconcile_stuck_send"]) {
      expect(s).toContain(`revoke all on function public.${fn}`);
    }
    expect(s).not.toMatch(/grant execute on function public\.comm_/i);
    // And the migration asserts the resulting matrix rather than assuming it.
    expect(s).toContain("privilege assertion FAILED (execute granted)");
    expect(s).toContain("privilege assertion FAILED (table write granted)");
  });
});

// ---------------------------------------------------------------------------
// 10. Attachments
// ---------------------------------------------------------------------------
describe("attachments reuse the existing model", () => {
  it("stores references, never bytes or storage paths", () => {
    const s = sql(MIGRATION);
    expect(s).toContain("attachments         jsonb");
    expect(s).not.toMatch(/storage_path|bytea|content_base64/i);
  });

  it("accepts only the two known sources and rejects path-like filenames", () => {
    expect(validateAttachmentRefs([{ source: "document", id: "1", filename: "facture.pdf" }]).ok).toBe(true);
    const bad = validateAttachmentRefs([{ source: "elsewhere" as "document", id: "1", filename: "a.pdf" }]);
    expect(bad.ok).toBe(false);
    for (const fn of ["../etc/passwd", "a/b.pdf", "a\\b.pdf", "a\nb.pdf", ""]) {
      const r = validateAttachmentRefs([{ source: "document", id: "1", filename: fn }]);
      expect(r.ok, fn).toBe(false);
    }
  });

  it("creates no dossier document — that is EMP-4", () => {
    for (const f of [ACTIONS, DISPATCH, COMPOSE]) {
      const s = code(f);
      expect(s).not.toContain('from("document")');
      expect(s).not.toContain("createDocument");
    }
  });

  it("never mutates an inbound attachment", () => {
    for (const f of [ACTIONS, DISPATCH, MIGRATION]) {
      const s = code(f);
      expect(s).not.toMatch(/ec_inbound_attachment[\s\S]{0,120}?\.(update|delete|insert)\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// 11. Customer visibility, AI, and scope
// ---------------------------------------------------------------------------
describe("EMP-3 stays inside its scope", () => {
  it("adds no customer visibility", () => {
    expect(getEventType("CORRESPONDENCE_SENT")?.clientSafe).toBe(false);
    const safe = clientSafeEventTypes().map((e) => e.type);
    expect(safe).not.toContain("CORRESPONDENCE_SENT");
    for (const d of EVENT_TYPES.filter((e) => e.domain === "communication")) {
      expect(d.clientSafe, d.type).toBe(false);
    }
    for (const f of [ACTIONS, DISPATCH, COMPOSE]) {
      expect(code(f)).not.toContain("portal");
    }
  });

  it("adds no AI path", () => {
    for (const f of [ACTIONS, DISPATCH, COMPOSE, MIGRATION]) {
      const s = read(f).toLowerCase();
      for (const forbidden of ["openai", "anthropic", "runcopilot", "suggest"]) {
        expect(s, f).not.toContain(forbidden);
      }
    }
  });

  it("builds no SMTP", () => {
    // The value is still accepted by the seam and still unimplemented.
    expect(code(PROVIDER)).toContain('return { ok: false, error: "provider_not_implemented" }');
    for (const f of [ACTIONS, DISPATCH, COMPOSE]) {
      expect(read(f).toLowerCase()).not.toContain("nodemailer");
    }
  });

  it("adds no autonomous retry", () => {
    for (const f of [ACTIONS, DISPATCH]) {
      const s = code(f);
      expect(s).not.toMatch(/setTimeout|setInterval|cron|scheduler/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 12. The legacy defect is actually fixed
// ---------------------------------------------------------------------------
describe("the pre-existing duplicate-send path is closed", () => {
  it("the legacy deliver() no longer calls the provider itself", () => {
    const s = code(LEGACY);
    expect(s).not.toContain("await sendEmail(");
    expect(s).toContain("dispatchMessage(");
  });

  it("template mail inherits the CAS guarantee", () => {
    const s = code(LEGACY);
    const deliver = s.slice(s.indexOf("async function deliver("));
    expect(deliver.slice(0, 800)).toContain("dispatchMessage");
    // The old read-then-send status check is gone from this path.
    expect(deliver.slice(0, 800)).not.toContain('m.status !== "QUEUED"');
  });
});
