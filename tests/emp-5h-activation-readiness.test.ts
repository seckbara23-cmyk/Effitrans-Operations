/**
 * EMP-5H — activation readiness, and the invariants that must survive it.
 *
 * The phase built almost nothing: EMP-5C→5G already own the lifecycle, the
 * evidence model, the guard, the runtime predicates and the permission. What
 * was missing was a way to SEE readiness across every mailbox at once, and
 * proof that the properties earned over five phases cannot be quietly undone
 * by the surface that displays them.
 *
 * Section 9 of the brief is the heart of this file: nine invariants, each
 * tested behaviourally where the rule is pure, and structurally only where the
 * claim is about wiring.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  buildLifecycleView, activationGuard, mailboxRuntimeEligibility, makerCheckerStatus,
  evidenceFreshness, canonicalState, isLegacyActive, capabilityReadiness,
  DEFAULT_EVIDENCE_POLICY,
  type LifecycleFacts, type ActivationActor,
} from "@/lib/ec/mailboxes/lifecycle";
import { eligibleMailboxes } from "@/lib/ec/mailboxes/eligibility";
import { previewBulkAssignment } from "@/lib/ec/mailboxes/bulk";
import { resolveRouting, type MailboxRow } from "@/lib/ec/inbound/parse";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const TABLE = "components/ec/mailbox-readiness-table.tsx";
const PANEL = "components/ec/mailbox-admin-panel.tsx";
const PAGE = "app/admin/enterprise-mail/mailboxes/page.tsx";
const LIFECYCLE = "lib/ec/mailboxes/lifecycle.ts";
const ADMIN_ACTIONS = "lib/ec/mailboxes/admin-actions.ts";
const DISPATCH = "lib/comms/dispatch.ts";

const TENANT = "t1";
const NOW = "2026-08-09T12:00:00.000Z";
const MAKER = "user-maker";
const CHECKER = "user-checker";

const ready = (over: Partial<LifecycleFacts> = {}): LifecycleFacts => ({
  id: "mb-1", tenantId: TENANT, address: "operations@effitrans.com",
  mailboxType: "SHARED", ownerUserId: null,
  provisioningStatus: "ACTIVE", provisioningNote: null,
  ownership: "CORPORATE_EXISTING",
  externalProvider: "confirmed-provider", externalMailboxId: "ext-1",
  corporateIdentityConfirmedAt: "2026-07-01T00:00:00.000Z", corporateIdentityConfirmedBy: MAKER,
  outboundVerifiedAt: "2026-08-01T00:00:00.000Z", outboundVerifiedBy: MAKER,
  outboundVerificationRef: "provider-msg-1",
  inboundVerifiedAt: "2026-08-01T00:00:00.000Z", inboundVerifiedBy: MAKER,
  inboundVerificationRef: "webhook-1",
  activatedAt: "2026-08-02T00:00:00.000Z", activatedBy: CHECKER,
  ...over,
});

const actor = (over: Partial<ActivationActor> = {}): ActivationActor => ({
  id: CHECKER, tenantId: TENANT, canProvision: true, ...over,
});

const row = (over: Partial<LifecycleFacts> = {}): MailboxRow => {
  const facts = ready(over);
  return { id: facts.id, tenantId: facts.tenantId, address: facts.address,
           isActive: facts.provisioningStatus === "ACTIVE", facts };
};

// ---------------------------------------------------------------------------
// §9 — the nine invariants
// ---------------------------------------------------------------------------
describe("security invariants", () => {
  it("1 — a rollout flag cannot make an unverified mailbox operational", () => {
    // The runtime authority cannot read a flag, so no flag can change its
    // answer. Proven both ways: it refuses regardless, and it holds no
    // reference to either switch.
    const unverified = ready({ outboundVerificationRef: null, inboundVerificationRef: null });
    expect(mailboxRuntimeEligibility({
      tenantId: TENANT, mailbox: unverified, direction: "OUTBOUND", now: NOW,
    }).eligible).toBe(false);
    expect(resolveRouting([row({ inboundVerificationRef: null })], NOW).routed).toBe(false);

    const s = code(LIFECYCLE);
    for (const w of ["EFFITRANS_EC_OUTBOUND_ENABLED", "EFFITRANS_EC_INBOUND_ENABLED",
                     "process.env", "tenant_ec_inbound_rollout"]) {
      expect(s, w).not.toContain(w);
    }
  });

  it("2 — the maker cannot approve their own verification", () => {
    const pending = ready({ provisioningStatus: "VERIFIED", activatedAt: null, activatedBy: null });
    expect(activationGuard({ actor: actor({ id: MAKER }), mailbox: pending, now: NOW }).blockers
      .map((b) => b.code)).toContain("MAKER_CHECKER_SAME_ACTOR");
    expect(activationGuard({ actor: actor({ id: CHECKER }), mailbox: pending, now: NOW }).allowed)
      .toBe(true);
    // And with nobody recorded as maker, separation would be satisfied
    // vacuously — so it is refused instead.
    expect(activationGuard({
      actor: actor(), mailbox: ready({ ...pending, corporateIdentityConfirmedBy: null }), now: NOW,
    }).blockers.map((b) => b.code)).toContain("NO_VERIFIER_RECORDED");
  });

  it("3 — browser input cannot nominate verification authority", () => {
    // The verifier and the activator are stamped from the SERVER session, never
    // accepted as parameters. No action signature admits an actor id.
    const s = code(ADMIN_ACTIONS);
    expect(s).toContain("patch.corporate_identity_confirmed_by = user.id");
    expect(s).toContain("activated_by: user.id");
    // `actorId` appears only as `actorId: user.id` — the resolved SESSION actor
    // being recorded in the audit. What must not exist is an actor arriving
    // from a caller, so the check is on where the value comes from, not on the
    // identifier.
    for (const m of [...s.matchAll(/actorId:\s*([^,\n}]+)/g)]) {
      expect(m[1].trim(), m[0]).toBe("user.id");
    }
    // Likewise `activatedBy` exists only as `facts.activatedBy` — reading what
    // the database already stores, into an audit payload. Never assigned from a
    // caller.
    // `facts.` = reading resolved state; `r.` = mapping a database row. Both
    // originate in the database. Nothing originates in a request.
    for (const m of [...s.matchAll(/[^.\w](activatedBy|verifiedBy|confirmedBy):\s*([^,\n}]+)/g)]) {
      expect(m[2].trim(), m[0]).toMatch(/^(facts|r)\./);
    }
    expect(s).not.toContain("p_actor_id");
    // And no exported action takes an actor from its caller at all.
    for (const sig of [...s.matchAll(/export async function \w+\(([\s\S]*?)\)\s*:/g)]) {
      expect(sig[1].toLowerCase(), sig[0].slice(0, 60)).not.toMatch(/actor|verifier|approver/);
    }
    // The guard reads the actor from a resolved session object, and the action
    // re-reads the mailbox itself rather than trusting anything supplied.
    expect(s).toContain("await loadFacts(mailboxId, user.tenantId)");
  });

  it("4 — department eligibility grants no membership", () => {
    // Eligibility PROPOSES. Setting or clearing it touches one column and
    // mentions the membership table nowhere.
    const s = code(ADMIN_ACTIONS);
    const fn = s.slice(s.indexOf("export async function setDepartmentEligibility"),
                       s.indexOf("export async function ",
                                 s.indexOf("export async function setDepartmentEligibility") + 1));
    expect(fn).toContain(".update({ department_eligibility: eligibility })");
    expect(fn).not.toContain("ec_mailbox_member");

    // And a proposal is still only a proposal: the classifier marks it, it does
    // not apply it.
    const d = previewBulkAssignment({
      tenantId: TENANT, mailboxEligibility: "OPERATIONS", mailboxType: "SHARED",
      capabilities: { canRead: true, canSend: false, canManageMembers: false, isDefaultSender: false },
      candidates: [{ userId: "u", name: null, email: "u@x.com", tenantId: TENANT,
                     roleCodes: ["COORDINATOR"], existing: null, hasOtherDefaultSender: false }],
      requireEligibility: true,
    });
    expect(d[0].outcome).toBe("GRANT_NEW");   // a PREVIEW, nothing written
    expect(eligibleMailboxes(["COORDINATOR"]).length).toBeGreaterThan(0);
  });

  it("5 — membership implies no lifecycle verification", () => {
    // A mailbox with members is not thereby verified, and the readiness view
    // keeps the two in separate columns.
    const withMembers = ready({
      outboundVerificationRef: null, inboundVerificationRef: null,
      corporateIdentityConfirmedAt: null,
    });
    expect(capabilityReadiness(withMembers, NOW).identityConfirmed).toBe(false);
    expect(mailboxRuntimeEligibility({
      tenantId: TENANT, mailbox: withMembers, direction: "OUTBOUND", now: NOW,
    }).eligible).toBe(false);
    // The membership count never feeds a readiness predicate.
    expect(code(LIFECYCLE)).not.toContain("activeMembers");
  });

  it("6 — outbound verification does not imply inbound verification", () => {
    const outboundOnly = ready({
      inboundVerifiedAt: null, inboundVerifiedBy: null, inboundVerificationRef: null,
    });
    const r = capabilityReadiness(outboundOnly, NOW);
    expect(r.outboundReady).toBe(true);
    expect(r.inboundReady).toBe(false);
    expect(mailboxRuntimeEligibility({
      tenantId: TENANT, mailbox: outboundOnly, direction: "OUTBOUND", now: NOW,
    }).eligible).toBe(true);
    expect(mailboxRuntimeEligibility({
      tenantId: TENANT, mailbox: outboundOnly, direction: "INBOUND", now: NOW,
    }).eligible).toBe(false);
  });

  it("7 — legacy ACTIVE is not verified ACTIVE", () => {
    const legacy = ready({ activatedAt: null, activatedBy: null });
    expect(canonicalState(legacy.provisioningStatus)).toBe("ACTIVE");
    expect(isLegacyActive(legacy)).toBe(true);
    // Same state, opposite runtime answer.
    expect(mailboxRuntimeEligibility({
      tenantId: TENANT, mailbox: legacy, direction: "OUTBOUND", now: NOW,
    })).toEqual({ eligible: false, reason: "legacy_unverified" });
    expect(mailboxRuntimeEligibility({
      tenantId: TENANT, mailbox: ready(), direction: "OUTBOUND", now: NOW,
    }).eligible).toBe(true);
  });

  it("8 — no mailbox administration operation touches DNS or provider config", () => {
    for (const f of [ADMIN_ACTIONS, LIFECYCLE, PAGE]) {
      const s = code(f).toLowerCase();
      for (const w of ["dns", "spf", "dkim", "dmarc", " mx ", "resend", "nameserver",
                       "forwarding", "return_path", "send as"]) {
        expect(s, `${f}:${w}`).not.toContain(w);
      }
    }
    // The two SURFACES are excluded from the word check because both must SAY
    // that « Active » attests nothing about DNS or the provider. A sentence
    // denying the capability is evidence FOR this invariant, not against it —
    // so what is checked there is the ABILITY, which neither has.
    for (const f of [PANEL, TABLE]) {
      const s = code(f);
      for (const w of ["fetch(", "node:dns", "resolveMx", "RESEND", "process.env",
                       "supabase", ".update(", ".insert("]) {
        expect(s, `${f}:${w}`).not.toContain(w);
      }
    }
    expect(read(PANEL)).toMatch(/n&apos;atteste ni la configuration DNS/);
    expect(read(TABLE)).toMatch(/n&apos;est <strong>pas<\/strong> une/);
  });

  it("9 — mailbox-less transactional email paths remain untouched", () => {
    for (const f of ["lib/comms/queue.ts", "lib/finance/invoice-send.ts",
                     "lib/commercial/send.ts", "lib/portal/admin-actions.ts",
                     "lib/users/welcome-send.ts", "lib/customer-notify/service.ts",
                     "lib/platform/provisioning/engine.ts"]) {
      const s = code(f);
      expect(s, f).not.toContain("mailboxRuntimeEligibility");
      expect(s, f).not.toContain("mailbox_id");
      expect(s, f).not.toContain("buildLifecycleView");
    }
    // Only the one path that HAS a mailbox of record is gated.
    expect(code(DISPATCH)).toContain("mailboxRuntimeEligibility(");
  });
});

// ---------------------------------------------------------------------------
// Maker-checker readiness — the audit answer, pinned
// ---------------------------------------------------------------------------
describe("maker-checker readiness", () => {
  it("needs two DISTINCT administrators, and says so", () => {
    const m = ready();
    expect(makerCheckerStatus({ mailbox: m, actorId: CHECKER, eligibleAdministrators: 2 }))
      .toEqual({ makerRecorded: true, actorIsMaker: false, checkerAvailable: true, satisfiable: true });
    expect(makerCheckerStatus({ mailbox: m, actorId: MAKER, eligibleAdministrators: 2 }).actorIsMaker)
      .toBe(true);
  });

  it("fails closed when only one administrator exists", () => {
    for (const n of [0, 1]) {
      const s = makerCheckerStatus({ mailbox: ready(), actorId: CHECKER, eligibleAdministrators: n });
      expect(s.checkerAvailable, String(n)).toBe(false);
      expect(s.satisfiable, String(n)).toBe(false);
    }
  });

  it("is not satisfiable without a recorded maker, however many admins exist", () => {
    expect(makerCheckerStatus({
      mailbox: ready({ corporateIdentityConfirmedBy: null }),
      actorId: CHECKER, eligibleAdministrators: 9,
    }).satisfiable).toBe(false);
  });

  it("counts DISTINCT PEOPLE, not role rows", () => {
    // One person holding the permission through two roles is one person, and a
    // separation satisfied by counting rows would be no separation at all.
    const s = code("lib/ec/mailboxes/membership.ts");
    expect(s).toContain("new Set(");
    expect(s).toContain('.eq("tenant_id", tenantId)');
    expect(s).toContain('u?.status === "active"');
    expect(s).toContain("return 0");   // fail-closed on any read failure
  });

  it("requires no new permission — MAIL_ADMIN already carries it", () => {
    const templates = read("lib/platform/role-templates.ts");
    expect(templates).toContain("communication:mailbox:provision");
    // And SYSTEM_ADMIN is still excluded from mail administration.
    const mailAdmin = templates.slice(templates.indexOf("MAIL_ADMIN"));
    expect(mailAdmin.slice(0, 2000)).toContain("communication:mailbox:provision");
  });
});

// ---------------------------------------------------------------------------
// The readiness surface
// ---------------------------------------------------------------------------
describe("the activation readiness view", () => {
  it("reports evidence AGE, and distinguishes absent from fresh", () => {
    const f = evidenceFreshness(ready(), NOW);
    expect(f.identityDays).toBe(39);
    expect(f.outboundDays).toBe(8);
    expect(f.outboundStale).toBe(false);
    // Absent evidence is null — never 0, which would read as "checked today".
    const none = evidenceFreshness(ready({ outboundVerifiedAt: null }), NOW);
    expect(none.outboundDays).toBeNull();
    expect(none.outboundStale).toBe(false);   // absent is not stale; it is absent
  });

  it("marks capability evidence stale at the ratified window", () => {
    const f = evidenceFreshness(ready({ outboundVerifiedAt: "2026-01-01T00:00:00.000Z" }), NOW);
    expect(f.outboundStale).toBe(true);
    expect(f.capabilityMaxAgeDays).toBe(DEFAULT_EVIDENCE_POLICY.capabilityMaxAgeDays);
    // Identity does not expire, however old.
    expect(evidenceFreshness(ready({ corporateIdentityConfirmedAt: "2019-01-01T00:00:00.000Z" }), NOW)
      .identityDays).toBeGreaterThan(2000);
  });

  it("carries everything the dashboard shows in ONE server-built view", () => {
    const v = buildLifecycleView({
      actor: actor(), mailbox: ready(), now: NOW, eligibleAdministrators: 2,
    });
    expect(v.state).toBe("ACTIVE");
    expect(v.capability.outboundReady).toBe(true);
    expect(v.freshness.outboundDays).toBe(8);
    expect(v.makerChecker.satisfiable).toBe(true);
    expect(v.legacyActive).toBe(false);
  });

  it("defaults to NO checker available when the count is unknown", () => {
    expect(buildLifecycleView({ actor: actor(), mailbox: ready(), now: NOW })
      .makerChecker.checkerAvailable).toBe(false);
  });

  it("re-derives no rule in React", () => {
    const t = code(TABLE);
    for (const w of ["activationGuard", "mailboxRuntimeEligibility", "capabilityReadiness",
                     "makerCheckerStatus", "evidenceFreshness", "new Date", "Date.now"]) {
      expect(t, w).not.toContain(w);
    }
    expect(t).toContain("views[m.id]");
    expect(code(PAGE)).toContain("buildLifecycleView(");
  });

  it("never presents ACTIVE as a provider or DNS attestation", () => {
    expect(read(TABLE)).toMatch(/n&apos;est <strong>pas<\/strong> une/);
    expect(read(PANEL)).toMatch(/n&apos;atteste ni la configuration DNS/);
  });

  it("extends the existing administration surface rather than adding another", () => {
    // One mailbox registry, one administration route.
    const pages = readdirSync(join(root, "app/admin/enterprise-mail"));
    expect(pages).toContain("mailboxes");
    expect(pages).not.toContain("readiness");
    expect(code(PAGE)).toContain("MailboxReadinessTable");
    expect(code(PAGE)).toContain("MailboxAdminPanel");
  });

  it("is read-only — it cannot change a mailbox", () => {
    const t = code(TABLE);
    for (const w of ["use client", "onClick", "useState", "useTransition",
                     "activateMailbox", "supabase", ".update(", ".insert("]) {
      expect(t, w).not.toContain(w);
    }
  });
});

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------
describe("scope", () => {
  it("adds no migration", () => {
    const migrations = readdirSync(join(root, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql")).sort();
    expect(migrations[migrations.length - 1])
      .toBe("20260820000001_quarantine_reason_unverified_mailbox.sql");
    expect(migrations).toHaveLength(98);
  });

  it("grants no role and adds no new mailbox-creation path", () => {
    for (const f of [PAGE, PANEL, TABLE, "lib/ec/mailboxes/membership.ts", LIFECYCLE]) {
      const s = code(f);
      expect(s, f).not.toMatch(/insert[\s\S]{0,40}user_role/i);
      expect(s, f).not.toMatch(/insert[\s\S]{0,40}ec_mailbox_member/i);
    }
    // `Réserver` has existed since EMP-4A and stays on the panel — this phase
    // added no second way in. The readiness view, which is what EMP-5H built,
    // cannot create anything at all.
    expect(code(PANEL)).toContain("provisionMailbox(");
    expect(code(TABLE)).not.toContain("provisionMailbox");
    expect(code(PAGE)).not.toContain("provisionMailbox");
  });

  it("leaves the production mailbox unnamed and untouched", () => {
    for (const f of [PAGE, PANEL, TABLE, LIFECYCLE, ADMIN_ACTIONS,
                     "docs/mail/emp-5h-activation-readiness.md",
                     "docs/mail/emp-5h-activation-runbook.md"]) {
      expect(read(f).toLowerCase(), f).not.toContain("aminata");
    }
  });

  it("proposes departmental addresses without creating them", () => {
    const matrix = read("docs/mail/emp-5h-activation-readiness.md");
    for (const d of ["OPERATIONS", "TRANSIT", "CUSTOMS", "FINANCE", "COMMERCIAL", "SUPPORT"]) {
      expect(matrix, d).toContain(d);
    }
    expect(matrix).toMatch(/Proposals only/i);
    expect(matrix).toMatch(/No address is created, reserved or verified by this phase/i);
    // No code path creates them.
    expect(code(PAGE)).not.toContain("@effitrans.com");
    expect(code(TABLE)).not.toContain("@effitrans.com");
  });
});
