/**
 * EMP-5D — Reply-To resolution and the purpose/eligibility separation.
 *
 * The Reply-To rule is PURE, so it is tested behaviourally here rather than by
 * reading source: `resolveReplyTo` is called with real inputs and its decisions
 * are asserted. Only the wiring — that dispatch resolves server-side and that
 * nothing else about the envelope moved — is a source contract.
 *
 * The property everything rests on: Reply-To is resolved from a mailbox the
 * SERVER looked up, tenant-scoped, and is omitted whenever that mailbox cannot
 * be trusted. Omission reproduces the previous behaviour exactly, so this phase
 * cannot stop a message that would previously have been sent.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveReplyTo, type MailboxOfRecord } from "@/lib/comms/reply-to";
import { buildResendPayload, type OutboundEmail } from "@/lib/comms/provider";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** SQL with `--` comments stripped: a comment EXPLAINING what a migration does
 *  not do must not be read as the migration doing it. */
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";

const mailbox = (over: Partial<MailboxOfRecord> = {}): MailboxOfRecord => ({
  id: "mb-1",
  tenantId: TENANT,
  address: "operations@effitrans.com",
  isActive: true,
  provisioningStatus: "ACTIVE",
  ...over,
});

const email = (over: Partial<OutboundEmail> = {}): OutboundEmail => ({
  to: "client@example.com",
  toName: "Client",
  subject: "s",
  html: "<p>h</p>",
  text: "t",
  ...over,
});

// ---------------------------------------------------------------------------
// 1. The rule
// ---------------------------------------------------------------------------
describe("Reply-To comes from the validated mailbox of record", () => {
  it("uses the corporate address of an active mailbox", () => {
    const d = resolveReplyTo(TENANT, mailbox());
    expect(d.replyTo).toBe("operations@effitrans.com");
    expect(d.reason).toBe("mailbox_of_record");
  });

  it("is omitted when the message has no mailbox of record", () => {
    // Template and system messages have none. They must send exactly as before.
    expect(resolveReplyTo(TENANT, null)).toEqual({
      replyTo: null, reason: "no_mailbox_of_record",
    });
  });

  it("REFUSES a mailbox from another tenant", () => {
    const d = resolveReplyTo(TENANT, mailbox({ tenantId: OTHER_TENANT }));
    expect(d.replyTo).toBeNull();
    expect(d.reason).toBe("tenant_mismatch");
  });

  it("refuses an administratively disabled mailbox", () => {
    expect(resolveReplyTo(TENANT, mailbox({ isActive: false })).reason)
      .toBe("mailbox_inactive");
  });

  it("refuses a mailbox that is not ACTIVE in its lifecycle", () => {
    // A mailbox still being set up, disabled, or whose setup failed is not
    // somewhere a customer's reply should be directed.
    for (const status of ["PENDING_EXTERNAL_SETUP", "SETUP_FAILED", "DISABLED", "DRAFT"]) {
      expect(resolveReplyTo(TENANT, mailbox({ provisioningStatus: status })).reason, status)
        .toBe("mailbox_not_active_status");
    }
  });

  it("refuses a mailbox with no usable corporate address", () => {
    for (const addr of [null, "", "   ", "not-an-address", "UPPER@effitrans.com"]) {
      expect(resolveReplyTo(TENANT, mailbox({ address: addr })).replyTo, String(addr))
        .toBeNull();
    }
  });

  it("NEVER uses the integration address", () => {
    // That alias is the platform's capture feed. Sending customer replies there
    // would route them into the integration channel instead of the mailbox the
    // team actually reads — the exact disruption this design avoids.
    const d = resolveReplyTo(TENANT, mailbox({
      address: "operations@effitrans.com",
      integrationAddress: "ops-platform@effitrans.com",
    }));
    expect(d.replyTo).toBe("operations@effitrans.com");
    expect(d.replyTo).not.toBe("ops-platform@effitrans.com");
  });

  it("is deterministic, so a retry resolves the identical value", () => {
    // The idempotency key is derived from the message row; Reply-To is derived
    // from the same row's mailbox. A replay cannot silently change it.
    const mb = mailbox();
    const a = resolveReplyTo(TENANT, mb);
    const b = resolveReplyTo(TENANT, mb);
    expect(a).toEqual(b);
  });

  it("never throws — an unusable mailbox stops the Reply-To, not the send", () => {
    // Failing the whole message here would turn a cosmetic improvement into an
    // outage.
    expect(() => resolveReplyTo(TENANT, mailbox({ address: null }))).not.toThrow();
    expect(() => resolveReplyTo(TENANT, undefined)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. The provider payload
// ---------------------------------------------------------------------------
describe("the provider payload carries Reply-To and nothing else changed", () => {
  it("includes reply_to when one was resolved", () => {
    const p = buildResendPayload(email({ replyTo: "operations@effitrans.com" }), "from@send.x");
    expect(p.reply_to).toBe("operations@effitrans.com");
  });

  it("OMITS reply_to entirely when none was resolved", () => {
    // Byte-identical to the previous payload for every caller without a mailbox.
    const p = buildResendPayload(email(), "from@send.x");
    expect("reply_to" in p).toBe(false);
    expect(buildResendPayload(email({ replyTo: null }), "from@send.x")).not.toHaveProperty("reply_to");
  });

  it("does not touch the visible From", () => {
    const withReply = buildResendPayload(email({ replyTo: "ops@effitrans.com" }), "from@send.x");
    const without = buildResendPayload(email(), "from@send.x");
    expect(withReply.from).toBe("from@send.x");
    expect(withReply.from).toBe(without.from);
  });

  it("sets no envelope/Return-Path or DKIM field — four different things", () => {
    const p = buildResendPayload(email({ replyTo: "ops@effitrans.com" }), "from@send.x") as Record<string, unknown>;
    for (const k of ["return_path", "envelope_from", "sender", "dkim", "headers"]) {
      expect(p, k).not.toHaveProperty(k);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Wiring — the parts source alone can prove
// ---------------------------------------------------------------------------
describe("dispatch resolves Reply-To server-side", () => {
  const dispatch = code("lib/comms/dispatch.ts");

  it("looks the mailbox up itself, scoped to the message's tenant", () => {
    expect(dispatch).toContain('.from("ec_mailbox")');
    expect(dispatch).toContain('.eq("tenant_id", tenantId)');
    expect(dispatch).toContain("resolveReplyTo(tenantId, mailboxOfRecord)");
  });

  it("takes Reply-To from the stored mailbox_id, never from input", () => {
    // The browser supplies no address here; it supplies at most a mailbox
    // choice, which the server then re-reads and validates.
    expect(dispatch).toContain('.eq("id", m.mailbox_id as string)');
    expect(dispatch).not.toMatch(/replyTo:\s*(input|payload|body)\./);
  });

  it("resolves AFTER the compare-and-set, so one sender owns the decision", () => {
    // `resolveReplyTo` also appears in the import at the top, so compare
    // against the CALL site rather than the first occurrence of the name.
    expect(dispatch.indexOf("comm_acquire_send"))
      .toBeLessThan(dispatch.indexOf("resolveReplyTo(tenantId"));
  });

  it("changes no other outbound behaviour", () => {
    for (const forbidden of ["COMMUNICATIONS_EMAIL_FROM", "return_path", "dkim", "Send As"]) {
      expect(dispatch, forbidden).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Purpose vs eligibility — the RATIFY-EMP5C-1 separation
// ---------------------------------------------------------------------------
describe("purpose stays free vocabulary; eligibility gets its own field", () => {
  const migration = read("supabase/migrations/20260818000001_mailbox_department_eligibility.sql");
  const migrationCode = sqlCode("supabase/migrations/20260818000001_mailbox_department_eligibility.sql");

  it("adds department_eligibility, nullable and undefaulted", () => {
    expect(migration).toContain("add column if not exists department_eligibility text");
    expect(migration).toContain("must be nullable");
    expect(migration).toContain("must have no default");
  });

  it("constrains the NEW column, which is safe precisely because it is nullable", () => {
    expect(migration).toContain("ec_mailbox_department_eligibility_check");
    for (const v of ["OPERATIONS", "TRANSIT", "CUSTOMS", "FINANCE", "COMMERCIAL", "SUPPORT"]) {
      expect(migration, v).toContain(v);
    }
  });

  it("still refuses to constrain `purpose`", () => {
    // GENERAL and QUOTATION remain valid; the column default remains insertable.
    expect(migration).toContain("purpose must remain unconstrained free vocabulary");
    expect(migration).not.toMatch(/add constraint ec_mailbox_purpose_check/);
  });

  it("does not duplicate the canonical department registry", () => {
    // DEPARTMENT_MAILBOXES stays the single source of department → purposes.
    const elig = read("lib/ec/mailboxes/eligibility.ts");
    expect(elig).toContain("DEPARTMENT_MAILBOXES");
    expect(migrationCode).not.toContain("DEPARTMENT_MAILBOXES");
    expect(migrationCode).not.toContain("HUMAN_RESOURCES");
  });

  it("shipped DARK, and EMP-5E is the phase that lit it", () => {
    // EMP-5D deliberately added the column without reading it, and said so.
    // That claim is historical and stays true of the migration; asserting that
    // the classifier STILL ignores the column would now be asserting the
    // opposite of what EMP-5E was for — so what is pinned here is the honest
    // successor: `purpose` is no longer an input to eligibility anywhere.
    expect(migration).toContain("DARK");
    const bulk = code("lib/ec/mailboxes/bulk.ts");
    expect(bulk).toContain("mailboxEligibility");
    expect(bulk).not.toContain("mailboxPurpose");
  });

  it("modifies no existing row", () => {
    // Read as CODE: the header legitimately names aminata@effitrans.com while
    // promising not to touch it, and a comment saying so must not read as doing so.
    expect(migrationCode).not.toMatch(/\bupdate\s+public\./i);
    expect(migrationCode).not.toMatch(/\bdelete\s+from\b/i);
    expect(migrationCode).not.toMatch(/\binsert\s+into\s+public\./i);
    expect(migrationCode).not.toContain("aminata");
  });
});
