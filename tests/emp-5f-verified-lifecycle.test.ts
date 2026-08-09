/**
 * EMP-5F — the verified mailbox lifecycle.
 *
 * WHAT THIS PHASE FIXES. `ACTIVE` meant "an operator clicked success": the
 * production mailbox was reserved and marked ACTIVE nineteen seconds later with
 * an empty note. The column also DEFAULTED to 'ACTIVE', so an insert that
 * merely omitted it produced a live, evidence-free mailbox. And a second
 * control, `setMailboxActive`, wrote `is_active` directly — which EMP-4A's
 * trigger silently reverted, so it changed nothing, reported success, and
 * audited a state change that never happened.
 *
 * The guard is PURE and takes `now`, so every rule below is tested
 * BEHAVIOURALLY with real inputs — including staleness, which a clock-reading
 * implementation could not be tested for without waiting. Source assertions are
 * reserved for wiring a pure function cannot show.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  activationGuard, permittedActions, canonicalState, isLegacyActive,
  capabilityReadiness, readinessChecks, canTransition, buildLifecycleView,
  MAILBOX_STATES, LEGACY_STATE_ALIASES, STATE_FR, STATE_MEANING_FR, ACTION_FR,
  DEFAULT_EVIDENCE_POLICY,
  type LifecycleFacts, type ActivationActor, type MailboxState,
} from "@/lib/ec/mailboxes/lifecycle";
import { mailboxReadiness } from "@/lib/ec/mailboxes/readiness";
import { resolveReplyTo } from "@/lib/comms/reply-to";
import { previewBulkAssignment } from "@/lib/ec/mailboxes/bulk";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** SQL with `--` comments stripped: a comment explaining what a migration does
 *  NOT do must never be read as the migration doing it. */
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const fnBody = (src: string, name: string): string => {
  const start = src.indexOf(`export async function ${name}`);
  expect(start, name).toBeGreaterThan(-1);
  const next = src.indexOf("export async function ", start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
};

const ADMIN_ACTIONS = "lib/ec/mailboxes/admin-actions.ts";
const LIFECYCLE = "lib/ec/mailboxes/lifecycle.ts";
const PANEL = "components/ec/mailbox-admin-panel.tsx";
const PAGE = "app/admin/enterprise-mail/mailboxes/page.tsx";
const MIGRATION = "supabase/migrations/20260819000001_verified_mailbox_lifecycle.sql";

const TENANT = "t1";
const NOW = "2026-08-09T12:00:00.000Z";
const VERIFIER = "user-maker";
const CHECKER = "user-checker";

const actor = (over: Partial<ActivationActor> = {}): ActivationActor => ({
  id: CHECKER, tenantId: TENANT, canProvision: true, ...over,
});

/** A mailbox that has passed every step and is ready to be put into service. */
const verified = (over: Partial<LifecycleFacts> = {}): LifecycleFacts => ({
  id: "mb-1",
  tenantId: TENANT,
  address: "operations@effitrans.com",
  mailboxType: "SHARED",
  ownerUserId: null,
  provisioningStatus: "VERIFIED",
  provisioningNote: null,
  ownership: "CORPORATE_EXISTING",
  externalProvider: "confirmed-provider",
  externalMailboxId: "ext-1",
  corporateIdentityConfirmedAt: "2026-08-08T09:00:00.000Z",
  corporateIdentityConfirmedBy: VERIFIER,
  outboundVerifiedAt: null,
  outboundVerifiedBy: null,
  outboundVerificationRef: null,
  inboundVerifiedAt: null,
  inboundVerifiedBy: null,
  inboundVerificationRef: null,
  activatedAt: null,
  activatedBy: null,
  ...over,
});

const codesOf = (m: LifecycleFacts, a: ActivationActor | null = actor(), policy?: never) =>
  activationGuard({ actor: a, mailbox: m, now: NOW, ...(policy ? { policy } : {}) })
    .blockers.map((b) => b.code);

// ---------------------------------------------------------------------------
// 1. ACTIVE is no longer reachable by clicking
// ---------------------------------------------------------------------------
describe("activation requires evidence", () => {
  it("lets an authorised checker activate a fully verified mailbox", () => {
    const d = activationGuard({ actor: actor(), mailbox: verified(), now: NOW });
    expect(d.blockers).toEqual([]);
    expect(d.allowed).toBe(true);
  });

  it("refuses a merely RESERVED mailbox", () => {
    // The nineteen-second path: reserved, then declared active.
    const codes = codesOf(verified({
      provisioningStatus: "RESERVED", ownership: "UNKNOWN",
      externalProvider: null, externalMailboxId: null,
      corporateIdentityConfirmedAt: null, corporateIdentityConfirmedBy: null,
    }));
    expect(codes).toContain("WRONG_STATE");
    expect(codes).toContain("OWNERSHIP_UNKNOWN");
    expect(codes).toContain("CORPORATE_IDENTITY_UNCONFIRMED");
    expect(codes).toContain("EXTERNAL_REFERENCE_MISSING");
  });

  it("refuses a CONFIGURED mailbox whose identity was never confirmed", () => {
    const codes = codesOf(verified({
      provisioningStatus: "CONFIGURED",
      corporateIdentityConfirmedAt: null, corporateIdentityConfirmedBy: null,
    }));
    expect(codes).toContain("WRONG_STATE");
    expect(codes).toContain("CORPORATE_IDENTITY_UNCONFIRMED");
  });

  it("refuses while an unresolved failure stands, and says what it was", () => {
    const d = activationGuard({
      actor: actor(),
      mailbox: verified({ provisioningStatus: "FAILED", provisioningNote: "boîte absente chez le fournisseur" }),
      now: NOW,
    });
    const codes = d.blockers.map((b) => b.code);
    expect(codes).toContain("UNRESOLVED_FAILURE");
    expect(codes).not.toContain("WRONG_STATE");   // the specific reason, not the generic one
    expect(d.blockers.find((b) => b.code === "UNRESOLVED_FAILURE")?.messageFr)
      .toContain("boîte absente chez le fournisseur");
  });

  it("refuses when provenance is unknown", () => {
    expect(codesOf(verified({ ownership: "UNKNOWN" }))).toContain("OWNERSHIP_UNKNOWN");
  });

  it("refuses when no external reference was ever recorded", () => {
    expect(codesOf(verified({ externalProvider: null, externalMailboxId: null })))
      .toContain("EXTERNAL_REFERENCE_MISSING");
    // Either one alone is enough to reconcile against later.
    expect(codesOf(verified({ externalProvider: null }))).not.toContain("EXTERNAL_REFERENCE_MISSING");
    expect(codesOf(verified({ externalMailboxId: null }))).not.toContain("EXTERNAL_REFERENCE_MISSING");
  });

  it("refuses an incoherent type/owner shape", () => {
    expect(codesOf(verified({ mailboxType: "PERSONAL", ownerUserId: null })))
      .toContain("TYPE_INCOMPATIBLE");
    expect(codesOf(verified({ mailboxType: "SHARED", ownerUserId: "someone" })))
      .toContain("TYPE_INCOMPATIBLE");
  });

  it("reports EVERY blocker, not just the first", () => {
    // An administrator who fixes one problem only to discover the next turns
    // verification into a guessing game.
    const codes = codesOf(
      verified({
        provisioningStatus: "RESERVED", ownership: "UNKNOWN",
        externalProvider: null, externalMailboxId: null,
        corporateIdentityConfirmedAt: null, corporateIdentityConfirmedBy: null,
      }),
      actor({ canProvision: false, tenantId: "OTHER" }),
    );
    expect(codes.length).toBeGreaterThanOrEqual(6);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

// ---------------------------------------------------------------------------
// 2. Freshness — the mechanism exists; the value is not invented
// ---------------------------------------------------------------------------
describe("evidence freshness", () => {
  it("imposes NO window by default — the number is a ratification, not a guess", () => {
    expect(DEFAULT_EVIDENCE_POLICY.identityMaxAgeDays).toBeNull();
    expect(DEFAULT_EVIDENCE_POLICY.capabilityMaxAgeDays).toBeNull();
    // Two-year-old evidence therefore does not block activation today.
    expect(activationGuard({
      actor: actor(),
      mailbox: verified({ corporateIdentityConfirmedAt: "2024-01-01T00:00:00.000Z" }),
      now: NOW,
    }).allowed).toBe(true);
  });

  it("blocks activation on stale evidence once a window IS enforced", () => {
    const d = activationGuard({
      actor: actor(),
      mailbox: verified({ corporateIdentityConfirmedAt: "2026-01-01T00:00:00.000Z" }),
      now: NOW,
      policy: { identityMaxAgeDays: 30, capabilityMaxAgeDays: 30 },
    });
    expect(d.allowed).toBe(false);
    expect(d.blockers.map((b) => b.code)).toContain("EVIDENCE_STALE");
  });

  it("accepts evidence inside the window", () => {
    expect(activationGuard({
      actor: actor(),
      mailbox: verified({ corporateIdentityConfirmedAt: "2026-08-08T09:00:00.000Z" }),
      now: NOW,
      policy: { identityMaxAgeDays: 30, capabilityMaxAgeDays: 30 },
    }).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Who may activate
// ---------------------------------------------------------------------------
describe("authority", () => {
  it("refuses an anonymous or SYSTEM actor", () => {
    // RATIFY-OPSSEC2-2A: there is no SYSTEM lane, and a NULL actor grants no
    // authority by itself.
    expect(codesOf(verified(), null)).toContain("NO_ACTOR");
    expect(codesOf(verified(), actor({ id: null }))).toContain("NO_ACTOR");
    expect(activationGuard({ actor: null, mailbox: verified(), now: NOW }).allowed).toBe(false);
  });

  it("refuses an actor without mailbox administration authority", () => {
    expect(codesOf(verified(), actor({ canProvision: false }))).toContain("FORBIDDEN");
  });

  it("refuses across tenants", () => {
    expect(codesOf(verified(), actor({ tenantId: "OTHER" }))).toContain("CROSS_TENANT");
    expect(codesOf(verified({ tenantId: "OTHER" }))).toContain("CROSS_TENANT");
  });

  it("MAKER-CHECKER: the verifier cannot also activate", () => {
    const d = activationGuard({
      actor: actor({ id: VERIFIER }), mailbox: verified(), now: NOW,
    });
    expect(d.allowed).toBe(false);
    expect(d.blockers.map((b) => b.code)).toContain("MAKER_CHECKER_SAME_ACTOR");
    // …while a second administrator may.
    expect(activationGuard({ actor: actor({ id: CHECKER }), mailbox: verified(), now: NOW }).allowed)
      .toBe(true);
  });

  it("refuses when no verifier was recorded at all", () => {
    // Without a maker there is nobody for the checker to be different FROM,
    // and separation of duties would be satisfied vacuously.
    expect(codesOf(verified({ corporateIdentityConfirmedBy: null })))
      .toContain("NO_VERIFIER_RECORDED");
  });
});

// ---------------------------------------------------------------------------
// 4. Legacy-active — surfaced, never rewritten
// ---------------------------------------------------------------------------
describe("legacy-unverified ACTIVE", () => {
  it("detects an ACTIVE mailbox nobody activated", () => {
    expect(isLegacyActive({ provisioningStatus: "ACTIVE", activatedBy: null })).toBe(true);
    expect(isLegacyActive({ provisioningStatus: "ACTIVE", activatedBy: CHECKER })).toBe(false);
    expect(isLegacyActive({ provisioningStatus: "VERIFIED", activatedBy: null })).toBe(false);
  });

  it("describes the production mailbox exactly as it stands", () => {
    // ownership UNKNOWN, ACTIVE, no evidence, no members, nominative address.
    const codes = mailboxReadiness({
      address: "prenom@effitrans.com", mailboxType: "SHARED", ownership: "UNKNOWN",
      provisioningStatus: "ACTIVE", isActive: true, departmentEligibility: null,
      corporateIdentityConfirmedAt: null, outboundVerifiedAt: null, inboundVerifiedAt: null,
      activeMembers: 0, activatedBy: null,
    }).map((n) => n.code);
    expect(codes).toContain("LEGACY_ACTIVE_UNVERIFIED");
    expect(codes).toContain("OWNERSHIP_UNKNOWN");
    expect(codes).toContain("ACTIVE_WITHOUT_VERIFICATION");
  });

  it("says a decision is required and that nothing was changed", () => {
    const n = mailboxReadiness({
      address: "operations@effitrans.com", mailboxType: "SHARED", ownership: "UNKNOWN",
      provisioningStatus: "ACTIVE", isActive: true, departmentEligibility: null,
      corporateIdentityConfirmedAt: null, outboundVerifiedAt: null, inboundVerifiedAt: null,
      activeMembers: 1, activatedBy: null,
    }).find((x) => x.code === "LEGACY_ACTIVE_UNVERIFIED");
    expect(n?.severity).toBe("warning");
    expect(n?.messageFr).toMatch(/décision\s+explicite est requise/);
    expect(n?.messageFr).toMatch(/rien n'a été modifié automatiquement/);
  });

  it("records a remediation decision WITHOUT touching the mailbox", () => {
    const fn = fnBody(code(ADMIN_ACTIONS), "recordLegacyActiveDecision");
    expect(fn).toContain("isLegacyActive(facts)");
    expect(fn).toContain("EC_MAILBOX_LEGACY_DECISION");
    // The whole safety property: it writes nothing to the mailbox.
    for (const forbidden of ['.from("ec_mailbox")', ".update(", ".insert(", ".delete("]) {
      expect(fn, forbidden).not.toContain(forbidden);
    }
    expect(fn).toContain("reason_required");
  });

  it("offers all five operator options and decides none of them", () => {
    const panel = read(PANEL);
    for (const o of ["CONFIRM_PERSONAL", "CONFIRM_SHARED", "RECLASSIFY_FUNCTIONAL",
                     "DISABLE_PENDING_VERIFICATION", "KEEP_RESTRICTED"]) {
      expect(panel, o).toContain(o);
    }
    expect(panel).toMatch(/enregistre une décision, elle ne la prend pas/);
  });
});

// ---------------------------------------------------------------------------
// 5. Capability readiness is per-direction
// ---------------------------------------------------------------------------
describe("outbound and inbound readiness are independent", () => {
  const live = (over: Partial<LifecycleFacts> = {}) =>
    verified({ provisioningStatus: "ACTIVE", activatedBy: CHECKER, ...over });

  it("permits outbound readiness with NO inbound evidence at all", () => {
    // Coexistence may well be outbound-only: requiring inbound proof to send
    // would block a legitimate arrangement.
    const r = capabilityReadiness(live({
      outboundVerifiedAt: "2026-08-08T10:00:00.000Z",
      outboundVerifiedBy: VERIFIER, outboundVerificationRef: "provider-msg-1",
    }), NOW);
    expect(r.outboundReady).toBe(true);
    expect(r.inboundReady).toBe(false);
    expect(r.identityConfirmed).toBe(true);
  });

  it("permits inbound readiness with no outbound evidence", () => {
    const r = capabilityReadiness(live({
      inboundVerifiedAt: "2026-08-08T10:00:00.000Z",
      inboundVerifiedBy: VERIFIER, inboundVerificationRef: "webhook-1",
    }), NOW);
    expect(r.inboundReady).toBe(true);
    expect(r.outboundReady).toBe(false);
  });

  it("refuses a capability whose evidence has no reference to check", () => {
    const r = capabilityReadiness(live({
      outboundVerifiedAt: "2026-08-08T10:00:00.000Z", outboundVerificationRef: null,
    }), NOW);
    expect(r.outboundReady).toBe(false);
  });

  it("gives no capability to a mailbox that is not operational", () => {
    const r = capabilityReadiness(verified({
      outboundVerifiedAt: "2026-08-08T10:00:00.000Z", outboundVerificationRef: "x",
      inboundVerifiedAt: "2026-08-08T10:00:00.000Z", inboundVerificationRef: "y",
    }), NOW);
    expect(r.outboundReady).toBe(false);
    expect(r.inboundReady).toBe(false);
  });

  it("labels manual evidence as manual and derived evidence as automated", () => {
    const checks = readinessChecks(verified(), TENANT, NOW);
    const kind = (c: string) => checks.find((x) => x.code === c)?.kind;
    expect(kind("ADDRESS_VALID")).toBe("automated");
    expect(kind("TENANT_MATCH")).toBe("automated");
    expect(kind("TYPE_COHERENT")).toBe("automated");
    expect(kind("IDENTITY_CONFIRMED")).toBe("manual");
    expect(kind("OUTBOUND_EVIDENCE")).toBe("manual");
    expect(kind("INBOUND_EVIDENCE")).toBe("manual");
    // And the surface says why every capability check is manual.
    expect(read(PANEL)).toMatch(/preuve manuelle/);
    expect(read(PANEL)).toMatch(/ne\s+teste rien à distance/);
  });

  it("claims no automated provider or DNS check anywhere", () => {
    const s = code(LIFECYCLE).toLowerCase();
    for (const w of ["dns", "mx", "spf", "dkim", "dmarc", "fetch(", "resolve4", "smtp"]) {
      expect(s, w).not.toContain(w);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. The state model
// ---------------------------------------------------------------------------
describe("state model", () => {
  it("maps every legacy spelling onto the canonical model", () => {
    expect(canonicalState("DRAFT")).toBe("RESERVED");
    expect(canonicalState("PENDING_EXTERNAL_SETUP")).toBe("CONFIGURATION_REQUIRED");
    expect(canonicalState("SETUP_FAILED")).toBe("FAILED");
    expect(Object.keys(LEGACY_STATE_ALIASES)).toHaveLength(3);
  });

  it("resolves an unrecognised value DOWNWARD, never to ACTIVE", () => {
    for (const junk of ["", "  ", "WHATEVER", "active", null, undefined]) {
      expect(canonicalState(junk as string), String(junk)).toBe("RESERVED");
    }
  });

  it("gives every state a French name and a stated meaning", () => {
    for (const s of MAILBOX_STATES) {
      expect(STATE_FR[s], s).toBeTruthy();
      expect(STATE_MEANING_FR[s], s).toBeTruthy();
    }
    expect(STATE_MEANING_FR.ACTIVE).toMatch(/un opérateur a cliqué sur succès/);
  });

  it("admits only the transitions the lifecycle describes", () => {
    expect(canTransition("RESERVED", "CONFIGURED")).toBe(true);
    expect(canTransition("CONFIGURED", "PENDING_VERIFICATION")).toBe(true);
    expect(canTransition("PENDING_VERIFICATION", "VERIFIED")).toBe(true);
    expect(canTransition("VERIFIED", "ACTIVE")).toBe(true);
    // The shortcuts that made ACTIVE cheap.
    expect(canTransition("RESERVED", "ACTIVE")).toBe(false);
    expect(canTransition("CONFIGURED", "ACTIVE")).toBe(false);
    expect(canTransition("PENDING_VERIFICATION", "ACTIVE")).toBe(false);
    expect(canTransition("FAILED", "ACTIVE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. The UI offers only what will work
// ---------------------------------------------------------------------------
describe("permitted actions", () => {
  it("never offers « Activer » when activation would fail", () => {
    const blocked = verified({ ownership: "UNKNOWN" });
    expect(activationGuard({ actor: actor(), mailbox: blocked, now: NOW }).allowed).toBe(false);
    expect(permittedActions({ actor: actor(), mailbox: blocked, now: NOW })).not.toContain("ACTIVATE");
  });

  it("offers it when it will", () => {
    expect(permittedActions({ actor: actor(), mailbox: verified(), now: NOW })).toContain("ACTIVATE");
  });

  it("withholds it from the verifier themselves", () => {
    expect(permittedActions({ actor: actor({ id: VERIFIER }), mailbox: verified(), now: NOW }))
      .not.toContain("ACTIVATE");
  });

  it("walks the four steps in order", () => {
    const at = (state: string, over: Partial<LifecycleFacts> = {}) =>
      permittedActions({ actor: actor(), mailbox: verified({ provisioningStatus: state, ...over }), now: NOW });
    expect(at("RESERVED")).toEqual(["CONFIGURE"]);
    expect(at("CONFIGURED")).toEqual(["CONFIGURE", "SUBMIT_VERIFICATION"]);
    expect(at("PENDING_VERIFICATION")).toEqual(["RECORD_VERIFICATION"]);
    expect(at("VERIFIED")).toEqual(["RECORD_VERIFICATION", "ACTIVATE"]);
    expect(at("ACTIVE", { activatedBy: CHECKER })).toContain("DEACTIVATE");
    expect(at("FAILED")).toContain("RETRY");
  });

  it("offers nothing to an actor who may not administer mailboxes", () => {
    expect(permittedActions({ actor: actor({ canProvision: false }), mailbox: verified(), now: NOW })).toEqual([]);
    expect(permittedActions({ actor: null, mailbox: verified(), now: NOW })).toEqual([]);
    expect(permittedActions({ actor: actor({ tenantId: "OTHER" }), mailbox: verified(), now: NOW })).toEqual([]);
  });

  it("names every button in French", () => {
    for (const label of Object.values(ACTION_FR)) expect(label).toBeTruthy();
    expect(ACTION_FR.SUBMIT_VERIFICATION).toBe("Soumettre à vérification");
    expect(ACTION_FR.RECORD_VERIFICATION).toBe("Enregistrer le résultat");
  });

  it("is DECIDED ON THE SERVER — the panel evaluates no rule of its own", () => {
    // A component that re-derived the rules would be a second copy that goes
    // stale, and it would have to read its own clock.
    const panel = code(PANEL);
    expect(panel).not.toContain("activationGuard(");
    expect(panel).not.toContain("permittedActions(");
    expect(panel).not.toContain("new Date().toISOString()");
    expect(panel).toContain("views[");
    const page = code(PAGE);
    expect(page).toContain("buildLifecycleView(");
    expect(page).toContain("const now = new Date().toISOString()");
  });

  it("builds a coherent view in one call", () => {
    const v = buildLifecycleView({ actor: actor(), mailbox: verified(), now: NOW });
    expect(v.state).toBe<MailboxState>("VERIFIED");
    expect(v.actions).toContain("ACTIVATE");
    expect(v.blockers).toEqual([]);
    expect(v.legacyActive).toBe(false);
    expect(v.checks.length).toBeGreaterThan(5);
  });
});

// ---------------------------------------------------------------------------
// 8. The write paths
// ---------------------------------------------------------------------------
describe("server actions", () => {
  const src = code(ADMIN_ACTIONS);

  it("has exactly ONE door to ACTIVE, and it is guarded", () => {
    const writesActive = [...src.matchAll(/provisioning_status:\s*"ACTIVE"/g)];
    expect(writesActive).toHaveLength(1);
    const fn = fnBody(src, "activateMailbox");
    expect(fn).toContain("activationGuard(");
    expect(fn).toContain('provisioning_status: "ACTIVE"');
    expect(fn).toContain("activation_refused");
  });

  it("records who activated it, and the evidence it accepted", () => {
    const fn = fnBody(src, "activateMailbox");
    expect(fn).toContain("activated_by: user.id");
    expect(fn).toContain("activated_at: now");
    expect(fn).toContain("verified_by: facts.corporateIdentityConfirmedBy");
    expect(fn).toContain("evidence_ref:");
    expect(fn).toContain("prior_state");
    expect(fn).toContain("next_state");
  });

  it("re-reads the mailbox itself and compare-and-sets on the judged state", () => {
    const fn = fnBody(src, "activateMailbox");
    expect(fn).toContain("await loadFacts(mailboxId, user.tenantId)");
    expect(fn).toContain('.eq("provisioning_status", facts.provisioningStatus)');
    expect(fn).not.toMatch(/mailbox:\s*(input|payload|body)\./);
  });

  it("closed the ungated re-activation door", () => {
    // `setMailboxEnabled(true)` used to flip DISABLED straight to ACTIVE with
    // no evidence examined at all.
    const fn = fnBody(src, "setMailboxEnabled");
    expect(fn).toContain("activation_requires_verification");
    // It still READS the state — it may only deactivate something that is
    // active. What it must never do again is WRITE it.
    expect(fn).toContain('from !== "ACTIVE"');
    expect(fn).not.toContain('provisioning_status: "ACTIVE"');
  });

  it("preserves history on deactivation", () => {
    const fn = fnBody(src, "setMailboxEnabled");
    for (const cleared of ["activated_by: null", "activated_at: null",
                           "corporate_identity_confirmed_at: null",
                           "outbound_verified_at: null", ".delete("]) {
      expect(fn, cleared).not.toContain(cleared);
    }
    expect(fn).toContain("activated_by: facts.activatedBy");   // carried into the audit
  });

  it("carries the failure reason into the audit before a retry clears it", () => {
    const fn = fnBody(src, "retryProvisioning");
    expect(fn).toContain("reason: facts.provisioningNote");
    expect(fn).toContain("provisioning_note: null");
    expect(fn.indexOf("provisioning_note: null")).toBeLessThan(fn.indexOf("reason: facts.provisioningNote"));
  });

  it("requires a checkable reference for a capability claim", () => {
    const fn = fnBody(src, "recordVerificationOutcome");
    expect(fn).toContain("evidence_reference_required");
    expect(fn).toContain('evidence_kind: "manual"');
  });

  it("reserves at RESERVED, never at ACTIVE", () => {
    const fn = fnBody(src, "provisionMailbox");
    expect(fn).toContain('provisioning_status: "RESERVED"');
    expect(fn).not.toContain('"ACTIVE"');
  });

  it("audits every lifecycle step with prior and next state", () => {
    for (const a of ["EC_MAILBOX_CONFIGURED", "EC_MAILBOX_VERIFICATION_SUBMITTED",
                     "EC_MAILBOX_VERIFICATION_PASSED", "EC_MAILBOX_VERIFICATION_FAILED",
                     "EC_MAILBOX_LEGACY_DECISION"]) {
      expect(read("lib/audit/events.ts"), a).toContain(a);
      expect(src, a).toContain(a);
    }
    expect((src.match(/prior_state/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("keeps every lifecycle read and write tenant-scoped", () => {
    for (const fn of ["activateMailbox", "setMailboxEnabled", "retryProvisioning",
                      "recordMailboxConfiguration", "submitMailboxForVerification",
                      "recordVerificationOutcome", "recordLegacyActiveDecision"]) {
      expect(fnBody(src, fn), fn).toContain("user.tenantId");
    }
    expect(src).toContain('.eq("id", mailboxId).eq("tenant_id", tenantId)');
  });

  it("stores no secret in any audit payload", () => {
    for (const w of ["password", "api_key", "apiKey", "secret", "token", "RESEND"]) {
      expect(src, w).not.toContain(w);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. The impotent second lifecycle is gone
// ---------------------------------------------------------------------------
describe("the shadow control that could never work", () => {
  it("no longer exists", () => {
    // `setMailboxActive` wrote `is_active`, which EMP-4A's BEFORE trigger
    // derives from `provisioning_status` and immediately overwrote. It changed
    // nothing, returned ok, and audited an activation that never happened.
    expect(code("lib/ec/mailboxes/actions.ts")).not.toContain("setMailboxActive");
    expect(existsSync(join(root, "components/ec/mailbox-toggle.tsx"))).toBe(false);
  });

  it("left no caller behind", () => {
    for (const f of ["app/mail/mailboxes/[id]/page.tsx",
                     "app/admin/enterprise-mail/capture/page.tsx"]) {
      expect(code(f), f).not.toContain("MailboxToggle");
      expect(code(f), f).not.toContain("setMailboxActive");
      expect(code(f), f).toContain("MailboxLifecycleBadge");
    }
  });

  it("is documented rather than silently deleted", () => {
    const s = read("lib/ec/mailboxes/actions.ts");
    expect(s).toContain("new.is_active := (new.provisioning_status = 'ACTIVE')");
    expect(s).toMatch(/audit\s+\*?\s*row for a change that never happened/);
  });

  it("writes is_active nowhere in the application", () => {
    for (const f of [ADMIN_ACTIONS, "lib/ec/mailboxes/actions.ts",
                     "lib/ec/mailboxes/membership.ts", "lib/ec/mailboxes/service.ts"]) {
      expect(code(f), f).not.toMatch(/is_active:\s*(true|false|active|enabled)/);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. The migration
// ---------------------------------------------------------------------------
describe("migration 20260819000001", () => {
  const m = sqlCode(MIGRATION);

  it("stops the column defaulting to an operational state", () => {
    expect(m).toContain("alter column provisioning_status set default 'RESERVED'");
    expect(m).toContain("must not default to ACTIVE");
  });

  it("WIDENS the state vocabulary — no legacy value is outlawed", () => {
    for (const s of ["RESERVED", "CONFIGURATION_REQUIRED", "CONFIGURED", "PENDING_VERIFICATION",
                     "VERIFIED", "ACTIVE", "FAILED", "DISABLED",
                     "DRAFT", "PENDING_EXTERNAL_SETUP", "SETUP_FAILED"]) {
      expect(m, s).toContain(s);
    }
  });

  it("adds the accountability columns, all nullable", () => {
    for (const c of ["activated_at", "activated_by", "verification_submitted_at",
                     "verification_submitted_by", "outbound_verified_by", "inbound_verified_by"]) {
      expect(m, c).toContain(c);
    }
    expect(m).toContain("must all be nullable");
    expect(m).not.toMatch(/add column[^;]*not null/i);
  });

  it("stores no legacy marker — legacy-active stays derived", () => {
    expect(m).toContain("legacy-active must be derived, not stored");
    expect(m).not.toMatch(/add column[^;]*is_legacy/i);
  });

  it("CHANGES NO ROW", () => {
    // Read as code: the header legitimately names the production mailbox while
    // promising not to touch it.
    expect(m).not.toMatch(/\bupdate\s+public\./i);
    expect(m).not.toMatch(/\bdelete\s+from\b/i);
    expect(m).not.toMatch(/\binsert\s+into\s+public\./i);
    expect(m).not.toContain("aminata");
  });

  it("does not modify migrations 95 or 96", () => {
    expect(read("supabase/migrations/20260817000001_mailbox_coexistence_foundation.sql"))
      .toContain("EMP-5C");
    expect(read("supabase/migrations/20260818000001_mailbox_department_eligibility.sql"))
      .toContain("EMP-5D");
    expect(m).not.toContain("20260817000001");
    expect(m).not.toContain("20260818000001");
  });

  it("touches no RLS, permission or role template", () => {
    for (const w of ["create policy", "alter policy", "insert into public.permission",
                     "role_template", "grant "]) {
      expect(m.toLowerCase(), w).not.toContain(w);
    }
  });

  it("is covered by a CI step", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("supabase/tests/emp_5f_verified_lifecycle_test.sql");
    expect(ci).toContain("EMP-5F verified lifecycle suite FAILED");
  });
});

// ---------------------------------------------------------------------------
// 11. Scope — everything this phase must NOT have done
// ---------------------------------------------------------------------------
describe("scope", () => {
  const TOUCHED = [LIFECYCLE, ADMIN_ACTIONS, PANEL, PAGE,
                   "lib/ec/mailboxes/readiness.ts", "lib/ec/mailboxes/membership.ts",
                   "lib/ec/mailboxes/service.ts", "lib/ec/mailboxes/actions.ts",
                   "components/ec/mailbox-lifecycle-badge.tsx"];

  it("leaves inbound and outbound exactly as disabled as they were", () => {
    // `service.ts` is excluded because it OWNS the inbound posture reader and
    // legitimately named that flag before this phase — asserting its absence
    // there would be asserting that a pre-existing gate does not exist. That
    // it still reads it, unchanged, is asserted below.
    for (const f of TOUCHED.filter((x) => x !== "lib/ec/mailboxes/service.ts")) {
      const s = code(f);
      for (const w of ["EFFITRANS_EC_INBOUND_ENABLED", "EFFITRANS_EC_OUTBOUND_ENABLED",
                       "COMMUNICATIONS_EMAIL_FROM", "RESEND_API_KEY", "resend",
                       "tenant_ec_inbound_rollout"]) {
        expect(s, `${f}:${w}`).not.toContain(w);
      }
    }
    // The gates themselves are untouched.
    expect(code("lib/comms/dispatch.ts")).toContain("EFFITRANS_EC_OUTBOUND_ENABLED");
    expect(code("lib/ec/mailboxes/service.ts")).toContain("EFFITRANS_EC_INBOUND_ENABLED");
  });

  it("changes no DNS, envelope or Send As behaviour", () => {
    for (const f of TOUCHED) {
      const s = code(f).toLowerCase();
      for (const w of ["spf", "dkim", "dmarc", " mx ", "return_path", "send as",
                       "envoyer en tant que", "can_send_as"]) {
        expect(s, `${f}:${w}`).not.toContain(w);
      }
    }
  });

  it("adds no permission and grants SYSTEM_ADMIN nothing", () => {
    const known = ["communication:mailbox:provision", "communication:membership:manage"];
    for (const f of TOUCHED) {
      const s = code(f);
      expect(s, f).not.toContain("SYSTEM_ADMIN");
      for (const p of [...s.matchAll(/"([a-z_]+:[a-z_:]+)"/g)].map((x) => x[1])) {
        if (p.startsWith("communication:")) expect(known, `${f}:${p}`).toContain(p);
      }
    }
  });

  it("creates no membership anywhere in the lifecycle", () => {
    for (const fn of ["activateMailbox", "recordMailboxConfiguration",
                      "submitMailboxForVerification", "recordVerificationOutcome",
                      "recordLegacyActiveDecision", "setMailboxEnabled", "retryProvisioning"]) {
      expect(fnBody(code(ADMIN_ACTIONS), fn), fn).not.toContain("ec_mailbox_member");
    }
  });

  it("names the production mailbox nowhere in code", () => {
    for (const f of [...TOUCHED, MIGRATION, "supabase/tests/emp_5f_verified_lifecycle_test.sql"]) {
      expect(read(f).toLowerCase(), f).not.toContain("aminata");
    }
  });

  it("leaves EMP-5E's eligibility behaviour intact", () => {
    // purpose still decides nothing; department_eligibility still decides it all.
    expect(code("lib/ec/mailboxes/bulk.ts")).not.toContain("purpose");
    const d = previewBulkAssignment({
      tenantId: TENANT, mailboxEligibility: "OPERATIONS", mailboxType: "SHARED",
      capabilities: { canRead: true, canSend: false, canManageMembers: false, isDefaultSender: false },
      candidates: [{ userId: "u", name: null, email: "u@x.com", tenantId: TENANT,
                     roleCodes: ["COORDINATOR"], existing: null, hasOtherDefaultSender: false }],
      requireEligibility: true,
    });
    expect(d[0].outcome).toBe("GRANT_NEW");
  });

  it("leaves EMP-5D's Reply-To rule intact", () => {
    expect(resolveReplyTo(TENANT, {
      id: "mb", tenantId: TENANT, address: "operations@effitrans.com",
      isActive: true, provisioningStatus: "ACTIVE",
    })).toEqual({ replyTo: "operations@effitrans.com", reason: "mailbox_of_record" });
    expect(code("lib/comms/reply-to.ts")).not.toContain("lifecycle");
  });

  it("keeps the lifecycle module pure", () => {
    const s = code(LIFECYCLE);
    for (const w of ["supabase", "fetch(", "insert", "revalidatePath",
                     "Date.now", "new Date", "Math.random"]) {
      expect(s, w).not.toContain(w);
    }
  });
});
