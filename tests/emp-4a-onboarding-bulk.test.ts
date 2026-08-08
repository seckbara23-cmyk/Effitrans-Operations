/**
 * EMP-4A completion — the onboarding surface and previewed bulk assignment.
 *
 * The classifier is pure, so the bulk semantics are tested behaviourally. The
 * rest are contracts source alone can hold: that nothing is assigned silently,
 * that execution cannot skip the preview, and that no Send As exists.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  previewBulkAssignment, summarize, writableDecisions, previewFingerprint,
  OUTCOME_FR, type BulkCandidate, type BulkCapabilities,
} from "@/lib/ec/mailboxes/bulk";
import { eligibleMailboxes } from "@/lib/ec/mailboxes/eligibility";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const BULK = "lib/ec/mailboxes/bulk.ts";
const BULK_ACTIONS = "lib/ec/mailboxes/bulk-actions.ts";
const USER_PANEL = "components/ec/user-mailbox-panel.tsx";
const BULK_PANEL = "components/ec/bulk-assign-panel.tsx";
const ADMIN_ACTIONS = "lib/ec/mailboxes/admin-actions.ts";
const USER_PAGE = "app/users/[id]/enterprise-mail/page.tsx";
const BULK_PAGE = "app/users/enterprise-mail/bulk/page.tsx";

const TENANT = "t1";
const CAPS: BulkCapabilities = { canRead: true, canSend: false, canManageMembers: false, isDefaultSender: false };

const cand = (p: Partial<BulkCandidate> & { userId: string }): BulkCandidate => ({
  name: "N", email: `${p.userId}@x.com`, tenantId: TENANT, roleCodes: ["COORDINATOR"],
  existing: null, hasOtherDefaultSender: false, ...p,
});

const run = (candidates: BulkCandidate[], opts: Partial<{ requireEligibility: boolean; caps: BulkCapabilities }> = {}) =>
  previewBulkAssignment({
    tenantId: TENANT, mailboxPurpose: "OPERATIONS",
    capabilities: opts.caps ?? CAPS, candidates,
    requireEligibility: opts.requireEligibility ?? true,
  });

// ---------------------------------------------------------------------------
// 0. Errors reach the administrator as sentences
// ---------------------------------------------------------------------------
describe("every action error is a sentence, not a code", () => {
  it("maps every error string the admin actions can return", () => {
    // The panel falls back to `Échec : <code>`, so an unmapped code does not
    // crash -- it just shows an administrator a raw identifier and no idea what
    // to do about it. Two of these were added when the default-sender CHECK was
    // given its own error, which is exactly when this drifts.
    const codes = new Set(
      [...read(ADMIN_ACTIONS).matchAll(/error:\s*"([a-z_]+)"/g)].map((m) => m[1]),
    );
    const mapped = new Set(
      [...read(USER_PANEL).matchAll(/^ {2}([a-z_]+):\s*"/gm)].map((m) => m[1]),
    );
    expect(codes.size).toBeGreaterThan(10);
    expect([...codes].filter((c) => !mapped.has(c))).toEqual([]);
  });

  it("distinguishes the two default-sender constraints", () => {
    // 23505 (a second default sender) and 23514 (default sender without send
    // authority) are different mistakes with different fixes.
    const s = code(ADMIN_ACTIONS);
    expect(s).toContain('"23505"');
    expect(s).toContain('"23514"');
    expect(s).toContain("default_sender_requires_send");
  });
});

// ---------------------------------------------------------------------------
// 1. Onboarding suggestions
// ---------------------------------------------------------------------------
describe("onboarding suggestions", () => {
  it("are deterministic", () => {
    const a = eligibleMailboxes(["COORDINATOR", "FINANCE_OFFICER"]);
    const b = eligibleMailboxes(["COORDINATOR", "FINANCE_OFFICER"]);
    expect(a).toEqual(b);
  });

  it("do not depend on role order", () => {
    expect(eligibleMailboxes(["COORDINATOR", "FINANCE_OFFICER"]))
      .toEqual(eligibleMailboxes(["FINANCE_OFFICER", "COORDINATOR"]));
  });

  it("suggest nothing when no role maps to a department", () => {
    expect(eligibleMailboxes(["SYSTEM_ADMIN", "CEO", "MAIL_ADMIN"])).toEqual([]);
    expect(eligibleMailboxes([])).toEqual([]);
  });

  it("are never applied on load — the surface only proposes", () => {
    const s = code(USER_PANEL);
    // Every grant is behind an onClick; nothing runs in an effect.
    expect(s).not.toContain("useEffect");
    const suggestions = s.slice(s.indexOf("Boîtes proposées"));
    expect(suggestions).toContain("onClick");
    expect(suggestions).toContain("grantMembership");
  });

  it("say they are proposals, in the surface itself", () => {
    expect(read(USER_PANEL)).toMatch(/rien\s*\n?\s*n&apos;est attribué sans une action explicite/);
  });
});

// ---------------------------------------------------------------------------
// 2. The classifier — every user lands somewhere
// ---------------------------------------------------------------------------
describe("bulk preview classifies every candidate", () => {
  it("returns exactly one decision per candidate", () => {
    const d = run([cand({ userId: "a" }), cand({ userId: "b" }), cand({ userId: "c" })]);
    expect(d).toHaveLength(3);
    expect(new Set(d.map((x) => x.userId)).size).toBe(3);
    for (const x of d) expect(OUTCOME_FR[x.outcome]).toBeTruthy();
  });

  it("grants a new membership", () => {
    expect(run([cand({ userId: "a" })])[0].outcome).toBe("GRANT_NEW");
  });

  it("reactivates a revoked membership on the SAME row", () => {
    const d = run([cand({ userId: "a", existing: {
      id: "m1", canRead: true, canSend: false, canManageMembers: false,
      isDefaultSender: false, revokedAt: "2026-01-01T00:00:00Z",
    } })]);
    expect(d[0].outcome).toBe("REACTIVATE");
    expect(d[0].reason).toMatch(/même ligne/);
    expect(d[0].writes).toBe(true);
  });

  it("leaves a matching membership UNCHANGED and writes nothing", () => {
    const d = run([cand({ userId: "a", existing: {
      id: "m1", canRead: true, canSend: false, canManageMembers: false,
      isDefaultSender: false, revokedAt: null,
    } })]);
    expect(d[0].outcome).toBe("UNCHANGED");
    expect(d[0].writes).toBe(false);
  });

  it("updates a membership whose capabilities differ", () => {
    const d = run([cand({ userId: "a", existing: {
      id: "m1", canRead: true, canSend: true, canManageMembers: false,
      isDefaultSender: false, revokedAt: null,
    } })]);
    expect(d[0].outcome).toBe("UPDATE");
  });

  it("rejects cross-tenant candidates rather than hiding them", () => {
    const d = run([cand({ userId: "a", tenantId: "OTHER" })]);
    expect(d[0].outcome).toBe("REJECTED_CROSS_TENANT");
    expect(d[0].writes).toBe(false);
  });

  it("skips users with no department mapping", () => {
    const d = run([cand({ userId: "a", roleCodes: ["SYSTEM_ADMIN"] })]);
    expect(d[0].outcome).toBe("SKIPPED_NO_DEPARTMENT");
  });

  it("skips users whose department does not propose the mailbox", () => {
    const d = run([cand({ userId: "a", roleCodes: ["FINANCE_OFFICER"] })]);
    expect(d[0].outcome).toBe("SKIPPED_NOT_ELIGIBLE");
  });

  it("honours an explicit selection when eligibility is not required", () => {
    const d = run([cand({ userId: "a", roleCodes: ["SYSTEM_ADMIN"] })], { requireEligibility: false });
    expect(d[0].outcome).toBe("GRANT_NEW");
  });

  it("flags a second default sender instead of letting the index error", () => {
    const caps = { ...CAPS, canSend: true, isDefaultSender: true };
    const d = run([cand({ userId: "a", hasOtherDefaultSender: true })], { caps });
    expect(d[0].outcome).toBe("CONFLICT_DEFAULT_SENDER");
    expect(d[0].writes).toBe(false);
  });

  it("does not flag a conflict when the default sender is already this mailbox", () => {
    const caps = { ...CAPS, canSend: true, isDefaultSender: true };
    const d = run([cand({ userId: "a", hasOtherDefaultSender: true, existing: {
      id: "m1", canRead: true, canSend: true, canManageMembers: false,
      isDefaultSender: true, revokedAt: null,
    } })], { caps });
    expect(d[0].outcome).toBe("UNCHANGED");
  });

  it("is idempotent: re-previewing after applying yields no writes", () => {
    const applied = cand({ userId: "a", existing: {
      id: "m1", canRead: true, canSend: false, canManageMembers: false,
      isDefaultSender: false, revokedAt: null,
    } });
    expect(writableDecisions(run([applied]))).toHaveLength(0);
  });

  it("summarizes every outcome key", () => {
    const s = summarize(run([cand({ userId: "a" }), cand({ userId: "b", tenantId: "OTHER" })]));
    expect(s.GRANT_NEW).toBe(1);
    expect(s.REJECTED_CROSS_TENANT).toBe(1);
    expect(Object.keys(s).sort()).toEqual(Object.keys(OUTCOME_FR).sort());
  });

  it("fingerprints stably and changes when a decision changes", () => {
    const ctx = { mailboxId: "mb1", capabilities: CAPS, requireEligibility: true };
    const a = run([cand({ userId: "a" }), cand({ userId: "b" })]);
    const b = run([cand({ userId: "b" }), cand({ userId: "a" })]);
    expect(previewFingerprint(a, ctx)).toBe(previewFingerprint(b, ctx));

    const changed = run([cand({ userId: "a" }), cand({ userId: "b", tenantId: "OTHER" })]);
    expect(previewFingerprint(changed, ctx)).not.toBe(previewFingerprint(a, ctx));
  });

  it("fingerprints the CAPABILITIES, not just the outcomes", () => {
    // The defect this pins: for a user with no membership the outcome is
    // GRANT_NEW whatever capabilities are asked for. A decisions-only
    // fingerprint is therefore identical for "grant read" and "grant read,
    // send and member-management" — so a caller could confirm the harmless
    // preview and execute the powerful one with a fingerprint that still
    // matches. Binding the capabilities is what closes that.
    const decisions = run([cand({ userId: "a" }), cand({ userId: "b" })]);
    expect(decisions.every((d) => d.outcome === "GRANT_NEW")).toBe(true);

    const readOnly = previewFingerprint(decisions, {
      mailboxId: "mb1", requireEligibility: true,
      capabilities: { canRead: true, canSend: false, canManageMembers: false, isDefaultSender: false },
    });
    const powerful = previewFingerprint(decisions, {
      mailboxId: "mb1", requireEligibility: true,
      capabilities: { canRead: true, canSend: true, canManageMembers: true, isDefaultSender: false },
    });
    expect(powerful).not.toBe(readOnly);
  });

  it("fingerprints the target mailbox and the eligibility filter too", () => {
    const decisions = run([cand({ userId: "a" })]);
    const base = { mailboxId: "mb1", capabilities: CAPS, requireEligibility: true };
    expect(previewFingerprint(decisions, { ...base, mailboxId: "mb2" }))
      .not.toBe(previewFingerprint(decisions, base));
    expect(previewFingerprint(decisions, { ...base, requireEligibility: false }))
      .not.toBe(previewFingerprint(decisions, base));
  });

  it("is pure — no I/O of any kind", () => {
    const s = code(BULK);
    for (const w of ["supabase", "fetch(", "insert", "update", "Date.now", "new Date"]) {
      expect(s, w).not.toContain(w);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Preview-first is enforced on the server
// ---------------------------------------------------------------------------
describe("execution cannot skip the preview", () => {
  it("the preview action performs no write", () => {
    const s = code(BULK_ACTIONS);
    const fn = s.slice(s.indexOf("export async function previewBulkAssignmentAction"),
                       s.indexOf("export async function executeBulkAssignment"));
    for (const w of [".upsert(", ".insert(", ".update(", ".delete(", "writeAudit"]) {
      expect(fn, w).not.toContain(w);
    }
  });

  it("execution requires a fingerprint and recomputes it server-side", () => {
    const s = code(BULK_ACTIONS);
    const fn = s.slice(s.indexOf("export async function executeBulkAssignment"));
    expect(fn).toContain("fingerprint: string");
    expect(fn).toContain("await previewBulkAssignmentAction");
    expect(fn).toContain("preview.fingerprint !== input.fingerprint");
    expect(fn).toContain("preview_stale");
  });

  it("only writes what the preview marked as writing", () => {
    expect(code(BULK_ACTIONS)).toContain("writableDecisions(preview.decisions)");
  });

  it("writes idempotently through the unique index", () => {
    const s = code(BULK_ACTIONS);
    expect(s).toContain('onConflict: "mailbox_id,user_id"');
    expect(s).not.toContain(".delete(");
  });

  it("audits the batch AND each changed membership", () => {
    const s = code(BULK_ACTIONS);
    expect(s).toContain("EC_MAILBOX_BULK_ASSIGNED");
    expect(s).toContain("EC_MAILBOX_MEMBER_GRANTED");
    expect(s).toContain("batch_id: batchId");
  });

  it("loads candidates tenant-scoped, with cross-tenant rejection as defence in depth", () => {
    // The platform guard requires every service-role read of a tenant-scoped
    // table to be filtered, and it is right: an unscoped read is a worse risk
    // than a less informative preview. A foreign id yields no candidate, and
    // the classifier still rejects one if it ever arrives.
    const s = code(BULK_ACTIONS);
    const loader = s.slice(s.indexOf("async function loadCandidates"),
                           s.indexOf("export async function previewBulkAssignmentAction"));
    expect(loader).toContain('.eq("tenant_id", tenantId)');
    expect(loader).toContain('q = q.in("id", userIds)');
    expect(code(BULK)).toContain('outcome: "REJECTED_CROSS_TENANT"');
  });

  it("the panel renders no confirm control before a preview exists", () => {
    const s = code(BULK_PANEL);
    expect(s).toContain("{decisions ? (");
    expect(s).toContain("executeBulkAssignment");
    // Confirming clears the preview, so a second execution needs a fresh one.
    expect(s).toContain("setDecisions(null); setFingerprint(null);");
  });
});

// ---------------------------------------------------------------------------
// 4. Security and scope
// ---------------------------------------------------------------------------
describe("security and scope", () => {
  it("both surfaces are permission-gated", () => {
    expect(code(BULK_PAGE)).toContain('hasPermission(permissions, "communication:membership:manage")');
    const u = code(USER_PAGE);
    expect(u).toContain('hasPermission(permissions, "communication:membership:manage")');
    expect(u).toContain('hasPermission(permissions, "communication:mailbox:provision")');
    expect(u).toContain("notFound()");
  });

  it("every read is tenant-scoped", () => {
    expect(code(USER_PAGE)).toContain('.eq("tenant_id", actor.tenantId)');
    expect(code(BULK_ACTIONS)).toContain('.eq("tenant_id", user.tenantId)');
  });

  it("adds no permission and no policy", () => {
    for (const f of [BULK, BULK_ACTIONS, USER_PAGE, BULK_PAGE, USER_PANEL, BULK_PANEL]) {
      const s = code(f);
      expect(s, f).not.toMatch(/create\s+policy/i);
      expect(s, f).not.toContain("communication:inbound:read");
    }
  });

  it("grants SYSTEM_ADMIN nothing and adds no migration", () => {
    for (const f of [BULK, BULK_ACTIONS, USER_PAGE, BULK_PAGE, USER_PANEL, BULK_PANEL]) {
      expect(code(f), f).not.toContain("SYSTEM_ADMIN");
    }
    expect(existsSync(join(root, "supabase/migrations/20260814000001_.sql"))).toBe(false);
  });

  it("has no can_send_as anywhere, and no Send As wording", () => {
    for (const f of [BULK, BULK_ACTIONS, USER_PAGE, BULK_PAGE, USER_PANEL, BULK_PANEL]) {
      expect(code(f), f).not.toContain("can_send_as");
      expect(code(f), f).not.toContain("canSendAs");
      expect(code(f).toLowerCase(), f).not.toContain("send as");
      expect(code(f).toLowerCase(), f).not.toContain("envoyer en tant que");
    }
  });

  it("displays the central-sender warning on the user surface", () => {
    expect(read(USER_PANEL)).toMatch(/expéditeur Effitrans configuré de/);
  });

  it("adds no provider, AI or customer-facing path", () => {
    for (const f of [BULK, BULK_ACTIONS, USER_PANEL, BULK_PANEL]) {
      const s = code(f).toLowerCase();
      for (const w of ["imap", "pop3", "exchange", "openai", "anthropic", "portal", "clientsafe"]) {
        expect(s, `${f}:${w}`).not.toContain(w);
      }
    }
  });

  it("does not modify createUser — mail can never roll back an account", () => {
    const s = code("lib/users/actions.ts");
    expect(s).not.toContain("ec_mailbox");
    expect(s).not.toContain("grantMembership");
    expect(s).not.toContain("provisionMailbox");
  });
});
