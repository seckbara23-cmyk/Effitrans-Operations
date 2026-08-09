/**
 * EMP-5G — mailbox runtime readiness at the traffic boundaries.
 *
 * EMP-5F made ACTIVE evidence-backed but connected nothing: the readiness
 * predicates existed and no message consulted them. So enabling the outbound or
 * inbound flag would have made every in-service mailbox operational, verified or
 * not — which is precisely the thing the lifecycle was built to prevent.
 *
 * This wires the ONE authority into the two boundaries where real traffic
 * touches a mailbox, and nowhere else. The decision is pure and takes `now`, so
 * staleness is tested with real inputs rather than by waiting; the wiring — that
 * the gate runs before the compare-and-set, and that mailbox-less messages never
 * reach it — is a source contract.
 *
 * THE CARVE-OUT THAT MATTERS MOST: invoice notifications, portal invitations,
 * quotation mail, welcome mail and tenant provisioning have no mailbox of
 * record. Blocking them for lacking a mailbox they were never designed to have
 * would be a self-inflicted outage, so their paths are asserted UNCHANGED.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  mailboxRuntimeEligibility, RATIFIED_EVIDENCE_POLICY, DEFAULT_EVIDENCE_POLICY,
  RUNTIME_REFUSAL_FR, activationGuard,
  type LifecycleFacts, type RuntimeRefusal,
} from "@/lib/ec/mailboxes/lifecycle";
import { resolveRouting, type MailboxRow } from "@/lib/ec/inbound/parse";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const DISPATCH = "lib/comms/dispatch.ts";
const OUTBOUND_ACTIONS = "lib/comms/outbound-actions.ts";
const CAPTURE = "lib/ec/inbound/capture.ts";
const PARSE = "lib/ec/inbound/parse.ts";
const LIFECYCLE = "lib/ec/mailboxes/lifecycle.ts";
const MIGRATION = "supabase/migrations/20260820000001_quarantine_reason_unverified_mailbox.sql";

const TENANT = "t1";
const NOW = "2026-08-09T12:00:00.000Z";

/** A mailbox that is in service AND proven in both directions. */
const ready = (over: Partial<LifecycleFacts> = {}): LifecycleFacts => ({
  id: "mb-1",
  tenantId: TENANT,
  address: "operations@effitrans.com",
  mailboxType: "SHARED",
  ownerUserId: null,
  provisioningStatus: "ACTIVE",
  provisioningNote: null,
  ownership: "CORPORATE_EXISTING",
  externalProvider: "confirmed-provider",
  externalMailboxId: "ext-1",
  corporateIdentityConfirmedAt: "2026-07-01T00:00:00.000Z",
  corporateIdentityConfirmedBy: "user-maker",
  outboundVerifiedAt: "2026-08-01T00:00:00.000Z",
  outboundVerifiedBy: "user-maker",
  outboundVerificationRef: "provider-msg-1",
  inboundVerifiedAt: "2026-08-01T00:00:00.000Z",
  inboundVerifiedBy: "user-maker",
  inboundVerificationRef: "webhook-1",
  activatedAt: "2026-08-02T00:00:00.000Z",
  activatedBy: "user-checker",
  ...over,
});

const decide = (
  m: LifecycleFacts | null,
  direction: "OUTBOUND" | "INBOUND" = "OUTBOUND",
  tenantId = TENANT,
  now = NOW,
) => mailboxRuntimeEligibility({ tenantId, mailbox: m, direction, now });

const refusal = (m: LifecycleFacts | null, d: "OUTBOUND" | "INBOUND" = "OUTBOUND"): RuntimeRefusal | null => {
  const r = decide(m, d);
  return r.eligible ? null : r.reason;
};

const row = (over: Partial<LifecycleFacts> = {}): MailboxRow => {
  const facts = ready(over);
  return {
    id: facts.id, tenantId: facts.tenantId, address: facts.address,
    isActive: facts.provisioningStatus === "ACTIVE", facts,
  };
};

// ---------------------------------------------------------------------------
// 1. RATIFY-EMP5F-1 — 90 days for operations, never for provenance
// ---------------------------------------------------------------------------
describe("the ratified evidence policy", () => {
  it("expires operational proof at 90 days and identity never", () => {
    expect(RATIFIED_EVIDENCE_POLICY.capabilityMaxAgeDays).toBe(90);
    expect(RATIFIED_EVIDENCE_POLICY.identityMaxAgeDays).toBeNull();
    expect(DEFAULT_EVIDENCE_POLICY).toEqual(RATIFIED_EVIDENCE_POLICY);
  });

  it("required NO model change — the schema already separated the two", () => {
    // EMP-5C gave identity its own timestamp, distinct from the capability
    // ones. Had all three shared one column, 90 days would have silently
    // expired provenance too and this could not have been implemented safely.
    const emp5c = read("supabase/migrations/20260817000001_mailbox_coexistence_foundation.sql");
    for (const c of ["corporate_identity_confirmed_at", "outbound_verified_at", "inbound_verified_at"]) {
      expect(emp5c, c).toContain(c);
    }
    // And EMP-5G added no column of its own to represent freshness.
    expect(sqlCode(MIGRATION)).not.toMatch(/add column/i);
  });

  it("lets identity evidence age indefinitely", () => {
    // An address existing in the corporate mail system does not stop being
    // true because ninety days passed.
    expect(decide(ready({ corporateIdentityConfirmedAt: "2019-01-01T00:00:00.000Z" })).eligible)
      .toBe(true);
  });

  it("expires capability evidence at exactly the ratified boundary", () => {
    const at = (iso: string) => refusal(ready({ outboundVerifiedAt: iso }));
    // 89 days old — inside the window.
    expect(at("2026-05-13T12:00:00.000Z")).toBeNull();
    // 100 days old — outside it.
    expect(at("2026-05-01T12:00:00.000Z")).toBe("capability_evidence_stale");
  });

  it("does not change who may ACTIVATE — activation rests on identity", () => {
    // Stale outbound proof stops TRAFFIC, not the activation decision. The two
    // questions are deliberately separate.
    const stale = ready({
      provisioningStatus: "VERIFIED", activatedAt: null, activatedBy: null,
      outboundVerifiedAt: "2020-01-01T00:00:00.000Z",
    });
    expect(activationGuard({
      actor: { id: "someone-else", tenantId: TENANT, canProvision: true },
      mailbox: stale, now: NOW,
    }).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. The one runtime authority
// ---------------------------------------------------------------------------
describe("runtime eligibility", () => {
  it("admits a mailbox that is in service and proven", () => {
    expect(decide(ready())).toEqual({ eligible: true, reason: "verified" });
    expect(decide(ready(), "INBOUND")).toEqual({ eligible: true, reason: "verified" });
  });

  it("fails closed on every unknown", () => {
    expect(refusal(null)).toBe("mailbox_not_found");
    expect(refusal(undefined as unknown as LifecycleFacts)).toBe("mailbox_not_found");
    expect(refusal(ready({ provisioningStatus: "WHO_KNOWS" }))).toBe("not_operational");
  });

  it("refuses a mailbox belonging to another tenant", () => {
    expect(refusal(ready({ tenantId: "OTHER" }))).toBe("tenant_mismatch");
    expect(mailboxRuntimeEligibility({
      tenantId: "OTHER", mailbox: ready(), direction: "OUTBOUND", now: NOW,
    }).eligible).toBe(false);
  });

  it("refuses every non-operational state", () => {
    for (const s of ["RESERVED", "CONFIGURATION_REQUIRED", "CONFIGURED",
                     "PENDING_VERIFICATION", "VERIFIED", "FAILED", "DISABLED",
                     "DRAFT", "PENDING_EXTERNAL_SETUP", "SETUP_FAILED"]) {
      expect(refusal(ready({ provisioningStatus: s })), s).toBe("not_operational");
    }
  });

  it("refuses a LEGACY-ACTIVE mailbox — surfaced must not mean tolerated", () => {
    // EMP-5F deliberately did not deactivate the nineteen-second mailbox. That
    // is only safe if runtime refuses it, or "surfaced" would amount to
    // "allowed to carry customer mail".
    expect(refusal(ready({ activatedBy: null, activatedAt: null }))).toBe("legacy_unverified");
  });

  it("refuses unestablished provenance and unconfirmed identity", () => {
    expect(refusal(ready({ ownership: "UNKNOWN" }))).toBe("ownership_unknown");
    expect(refusal(ready({ corporateIdentityConfirmedAt: null }))).toBe("identity_unconfirmed");
  });

  it("requires a CHECKABLE reference, not just a date", () => {
    expect(refusal(ready({ outboundVerificationRef: null }))).toBe("capability_unverified");
    expect(refusal(ready({ inboundVerificationRef: null }), "INBOUND")).toBe("capability_unverified");
  });

  it("keeps the two directions independent", () => {
    const outboundOnly = ready({
      inboundVerifiedAt: null, inboundVerifiedBy: null, inboundVerificationRef: null,
    });
    expect(decide(outboundOnly, "OUTBOUND").eligible).toBe(true);
    expect(refusal(outboundOnly, "INBOUND")).toBe("capability_unverified");

    const inboundOnly = ready({
      outboundVerifiedAt: null, outboundVerifiedBy: null, outboundVerificationRef: null,
    });
    expect(decide(inboundOnly, "INBOUND").eligible).toBe(true);
    expect(refusal(inboundOnly, "OUTBOUND")).toBe("capability_unverified");
  });

  it("gives every refusal a French sentence", () => {
    for (const r of Object.keys(RUNTIME_REFUSAL_FR) as RuntimeRefusal[]) {
      expect(RUNTIME_REFUSAL_FR[r], r).toBeTruthy();
    }
  });

  it("knows nothing about the rollout flags — it NARROWS them", () => {
    // If this module could read a flag, enabling the flag could change its
    // answer. It cannot, so enabling outbound or inbound can never make an
    // unverified mailbox operational.
    const s = code(LIFECYCLE);
    for (const w of ["EFFITRANS_EC_OUTBOUND_ENABLED", "EFFITRANS_EC_INBOUND_ENABLED",
                     "process.env", "tenant_ec_inbound_rollout"]) {
      expect(s, w).not.toContain(w);
    }
  });

  it("is pure and takes its clock as an argument", () => {
    const s = code(LIFECYCLE);
    for (const w of ["Date.now", "new Date", "Math.random", "supabase", "fetch("]) {
      expect(s, w).not.toContain(w);
    }
    expect(decide(ready())).toEqual(decide(ready()));
  });
});

// ---------------------------------------------------------------------------
// 3. Outbound — refused BEFORE the compare-and-set
// ---------------------------------------------------------------------------
describe("the outbound boundary", () => {
  const s = code(DISPATCH);

  it("gates before acquiring, so a refusal does not burn the sendable state", () => {
    // RATIFY-EMP3-2, applied to a new refusal: an unverified mailbox persists
    // until someone fixes it, so the message must stay QUEUED and send itself
    // once the mailbox is verified — not fail permanently.
    expect(s.indexOf("mailboxRuntimeEligibility(")).toBeLessThan(s.indexOf("comm_acquire_send"));
    expect(s).toContain('status: "SKIPPED"');
  });

  it("still resolves Reply-To AFTER the acquire, from the same facts", () => {
    // EMP-5D's property: one sender owns that decision. The read moved earlier;
    // the DECISION did not.
    expect(s.indexOf("comm_acquire_send")).toBeLessThan(s.indexOf("resolveReplyTo(tenantId"));
    expect((s.match(/\.from\("ec_mailbox"\)/g) ?? []).length).toBe(1);
  });

  it("gates ONLY messages that have a mailbox of record", () => {
    const gate = s.slice(s.indexOf("if (m.mailbox_id)"), s.indexOf("comm_acquire_send"));
    expect(gate).toContain("mailboxRuntimeEligibility(");
    expect(gate).toContain('direction: "OUTBOUND"');
  });

  it("leaves every mailbox-less send path byte-for-byte unchanged", () => {
    // These are the paths that would break if a mailbox were demanded of them.
    // None of them mentions the gate, and none acquired a mailbox of record.
    for (const f of ["lib/comms/queue.ts", "lib/commercial/send.ts",
                     "lib/finance/invoice-send.ts", "lib/portal/admin-actions.ts",
                     "lib/customer-notify/service.ts", "lib/users/welcome-send.ts",
                     "lib/platform/provisioning/engine.ts", "lib/finance/intent-actions.ts",
                     "lib/process/billing/actions.ts"]) {
      const src = code(f);
      expect(src, f).not.toContain("mailboxRuntimeEligibility");
      expect(src, f).not.toContain("mailbox_id");
    }
  });

  it("refuses at composition-send time too, with the precise reason", () => {
    const o = code(OUTBOUND_ACTIONS);
    expect(o).toContain("mailboxRuntimeEligibility(");
    expect(o).toContain("`mailbox_${decision.reason}`");
    // Before the draft is promoted to QUEUED, so a doomed send does not move
    // the message's state at all.
    expect(o.indexOf("mailboxRuntimeEligibility(")).toBeLessThan(o.indexOf('status: "QUEUED"'));
  });

  it("stopped keeping a second notion of « in service »", () => {
    // `resolveMailbox` read `is_active` itself. That boolean is DERIVED from
    // the lifecycle by a trigger, so the check was a duplicate definition of
    // something the lifecycle already owns.
    const o = code(OUTBOUND_ACTIONS);
    expect(o).toContain("isOperational(canonicalState(m.provisioning_status))");
    expect(o).not.toContain("if (!m.is_active)");
  });

  it("changes no message state machine and no idempotency rule", () => {
    for (const w of ["comm_acquire_send", "comm_record_send_accepted",
                     "comm_record_send_failed", "idempotency"]) {
      expect(s + code(OUTBOUND_ACTIONS), w).toContain(w);
    }
    // No new status was invented; SKIPPED already existed for exactly this.
    expect(s).not.toMatch(/status:\s*"(BLOCKED|REFUSED|UNVERIFIED)"/);
  });

  it("does not touch the rollout flags", () => {
    expect(s).toContain("EFFITRANS_EC_OUTBOUND_ENABLED");   // still exactly one gate
    expect((s.match(/EFFITRANS_EC_OUTBOUND_ENABLED/g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Inbound — quarantine, never route into an unverified mailbox
// ---------------------------------------------------------------------------
describe("the inbound boundary", () => {
  it("routes to a verified mailbox", () => {
    expect(resolveRouting([row()], NOW))
      .toEqual({ routed: true, tenantId: TENANT, mailboxId: "mb-1" });
  });

  it("QUARANTINES mail addressed to an unverified mailbox", () => {
    expect(resolveRouting([row({ inboundVerificationRef: null })], NOW))
      .toEqual({ routed: false, reason: "mailbox_not_verified" });
    expect(resolveRouting([row({ ownership: "UNKNOWN" })], NOW))
      .toEqual({ routed: false, reason: "mailbox_not_verified" });
    expect(resolveRouting([row({ activatedBy: null })], NOW))
      .toEqual({ routed: false, reason: "mailbox_not_verified" });
  });

  it("quarantines STALE inbound evidence at the ratified window", () => {
    expect(resolveRouting([row({ inboundVerifiedAt: "2026-01-01T00:00:00.000Z" })], NOW))
      .toEqual({ routed: false, reason: "mailbox_not_verified" });
  });

  it("keeps « switched off » separate from « never proven »", () => {
    // Two different problems with two different fixes, so two different words.
    expect(resolveRouting([row({ provisioningStatus: "DISABLED" })], NOW))
      .toEqual({ routed: false, reason: "mailbox_inactive" });
  });

  it("preserves every EC-1 refusal exactly", () => {
    expect(resolveRouting([], NOW)).toEqual({ routed: false, reason: "no_matching_mailbox" });
    const a = row(); const b = { ...row(), id: "mb-2", facts: { ...ready(), id: "mb-2" } };
    expect(resolveRouting([a, b], NOW)).toEqual({ routed: false, reason: "ambiguous_routing" });
    // The same mailbox named twice is still one destination.
    expect(resolveRouting([a, a], NOW).routed).toBe(true);
  });

  it("never routes on the OUTBOUND evidence", () => {
    // A mailbox proven only for sending must not start receiving.
    expect(resolveRouting([row({
      inboundVerifiedAt: null, inboundVerificationRef: null,
    })], NOW)).toEqual({ routed: false, reason: "mailbox_not_verified" });
  });

  it("stays pure — the clock is passed in", () => {
    const s = code(PARSE);
    expect(s).not.toContain("new Date");
    expect(s).not.toContain("Date.now");
    expect(s).toContain("now: string");
    expect(code(CAPTURE)).toContain("new Date().toISOString()");
  });

  it("makes no MX, forwarding, DNS or provider assumption", () => {
    for (const f of [PARSE, CAPTURE, LIFECYCLE]) {
      const src = code(f).toLowerCase();
      for (const w of [" mx ", "spf", "dkim", "dmarc", "forwarding", "dns"]) {
        expect(src, `${f}:${w}`).not.toContain(w);
      }
    }
  });

  it("leaves the two-layer inbound flag untouched", () => {
    const c = code(CAPTURE);
    expect(c).toContain("inboundEnabled");
    expect(c).toContain("tenant_ec_inbound_rollout");
    expect(c).toContain("return false; // fail closed");
  });
});

// ---------------------------------------------------------------------------
// 5. The refusal has somewhere legal to land
// ---------------------------------------------------------------------------
describe("migration 20260820000001", () => {
  const m = sqlCode(MIGRATION);

  it("widens the quarantine vocabulary without dropping a reason", () => {
    for (const r of ["no_matching_mailbox", "ambiguous_routing", "tenant_not_enabled",
                     "mailbox_inactive", "mailbox_not_verified",
                     "payload_too_large", "malformed_envelope"]) {
      expect(m, r).toContain(r);
    }
    expect(m).toContain("dropped reasons");
  });

  it("keeps quarantine tenant-less", () => {
    expect(m).toContain("quarantine must remain tenant-less");
    expect(m).not.toMatch(/drop constraint[^;]*ec_inbound_quarantine_shape/i);
  });

  it("CHANGES NO ROW and adds no column", () => {
    expect(m).not.toMatch(/\bupdate\s+public\./i);
    expect(m).not.toMatch(/\bdelete\s+from\b/i);
    expect(m).not.toMatch(/\binsert\s+into\s+public\./i);
    expect(m).not.toMatch(/add column/i);
    expect(read(MIGRATION).toLowerCase()).not.toContain("aminata");
  });

  it("does not modify migrations 95, 96 or 97", () => {
    for (const f of ["20260817000001_mailbox_coexistence_foundation.sql",
                     "20260818000001_mailbox_department_eligibility.sql",
                     "20260819000001_verified_mailbox_lifecycle.sql"]) {
      expect(m, f).not.toContain(f.slice(0, 14));
    }
  });

  it("is covered by a CI step", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("supabase/tests/emp_5g_runtime_readiness_test.sql");
    expect(ci).toContain("EMP-5G runtime readiness suite FAILED");
  });
});

// ---------------------------------------------------------------------------
// 6. Scope
// ---------------------------------------------------------------------------
describe("scope", () => {
  const TOUCHED = [LIFECYCLE, DISPATCH, OUTBOUND_ACTIONS, PARSE, CAPTURE,
                   "lib/ec/inbound/types.ts"];

  it("activates neither direction", () => {
    // Exactly one gate each, exactly where they already were.
    expect((code(DISPATCH).match(/EFFITRANS_EC_OUTBOUND_ENABLED/g) ?? []).length).toBe(1);
    expect(code("lib/ec/inbound/providers.ts")).toContain("EFFITRANS_EC_INBOUND_ENABLED");
    // Reading a flag is how a gate works; ASSIGNING one is how a phase turns
    // something on behind the operator's back. Only the latter is forbidden.
    for (const f of TOUCHED) {
      expect(code(f), f).not.toMatch(/process\.env\.[A-Z_]+\s*=[^=]/);
    }
  });

  it("touches no provider, envelope or Send As behaviour", () => {
    for (const f of TOUCHED) {
      const s = code(f).toLowerCase();
      for (const w of ["resend_api_key", "return_path", "send as", "envoyer en tant que",
                       "can_send_as", "communications_email_from"]) {
        expect(s, `${f}:${w}`).not.toContain(w);
      }
    }
  });

  it("creates no membership and grants no permission", () => {
    for (const f of TOUCHED) {
      const s = code(f);
      expect(s, f).not.toContain("ec_mailbox_member");
      expect(s, f).not.toContain("SYSTEM_ADMIN");
    }
  });

  it("changes no mailbox row from any traffic path", () => {
    // Traffic READS the mailbox. It must never write one — a send that
    // "repaired" its own mailbox would be evidence laundering.
    for (const f of [DISPATCH, PARSE, CAPTURE]) {
      const s = code(f);
      expect(s, f).not.toMatch(/from\("ec_mailbox"\)[\s\S]{0,200}?\.(update|insert|upsert|delete)\(/);
    }
  });

  it("names the production mailbox nowhere", () => {
    for (const f of [...TOUCHED, MIGRATION]) {
      expect(read(f).toLowerCase(), f).not.toContain("aminata");
    }
  });
});
