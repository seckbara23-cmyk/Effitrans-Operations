/**
 * EMP-5E — department eligibility activation.
 *
 * The defect this phase closes: whether a mailbox was ever proposed to anyone
 * depended on the SPELLING of a free-text label. `ec_mailbox.purpose` is tenant
 * vocabulary with `default 'GENERAL'`, and two independent code paths compared
 * it against the six-value department set by string equality — so a mailbox
 * typed `Operations`, or with a trailing space, was offered to nobody while
 * looking perfectly healthy in administration.
 *
 * The classifier, the eligibility rule and the readiness assessment are all
 * PURE, so almost everything below is tested BEHAVIOURALLY: real inputs in,
 * decisions asserted. Source assertions are reserved for the wiring a pure
 * function cannot show — which column the server reads, and what the write path
 * is structurally incapable of touching.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  previewBulkAssignment, previewFingerprint, writableDecisions, summarize,
  OUTCOME_FR, type BulkCandidate, type BulkCapabilities, type PreviewContext,
} from "@/lib/ec/mailboxes/bulk";
import {
  eligibleMailboxes, isDepartmentEligibility, canHoldDepartmentEligibility,
  DEPARTMENT_ELIGIBILITY_VALUES,
} from "@/lib/ec/mailboxes/eligibility";
import { mailboxReadiness, readinessTone, type ReadinessInput } from "@/lib/ec/mailboxes/readiness";
import {
  purposeLabelFr, eligibilityLabelFr, ELIGIBILITY_OPTIONS, ELIGIBILITY_NONE_FR,
  MAILBOX_PURPOSE_OPTIONS, MAILBOX_TYPE_FR, MAILBOX_TYPE_MEANING_FR,
} from "@/lib/ec/mailboxes/vocabulary";
import { resolveReplyTo } from "@/lib/comms/reply-to";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** SQL with `--` comments stripped: a comment EXPLAINING what a migration does
 *  not do must not be read as the migration doing it. */
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

/**
 * ONE function's body, bounded by the next export.
 *
 * Slicing to end-of-file instead would silently include every function that
 * happens to come after it — which is how a "this function never touches
 * memberships" assertion ends up reading `setMembershipCapabilities` and
 * failing for the wrong reason, or worse, passing while proving nothing.
 */
const fnBody = (src: string, name: string): string => {
  const start = src.indexOf(`export async function ${name}`);
  expect(start, name).toBeGreaterThan(-1);
  const next = src.indexOf("export async function ", start + 1);
  return next === -1 ? src.slice(start) : src.slice(start, next);
};

const BULK = "lib/ec/mailboxes/bulk.ts";
const BULK_ACTIONS = "lib/ec/mailboxes/bulk-actions.ts";
const ADMIN_ACTIONS = "lib/ec/mailboxes/admin-actions.ts";
const ELIGIBILITY = "lib/ec/mailboxes/eligibility.ts";
const READINESS = "lib/ec/mailboxes/readiness.ts";
const USER_PAGE = "app/users/[id]/enterprise-mail/page.tsx";
const USER_PANEL = "components/ec/user-mailbox-panel.tsx";
const ADMIN_PANEL = "components/ec/mailbox-admin-panel.tsx";
const BULK_PANEL = "components/ec/bulk-assign-panel.tsx";
const MIGRATION_96 = "supabase/migrations/20260818000001_mailbox_department_eligibility.sql";

const TOUCHED = [BULK, BULK_ACTIONS, ADMIN_ACTIONS, ELIGIBILITY, READINESS,
                 "lib/ec/mailboxes/vocabulary.ts", "lib/ec/mailboxes/membership.ts",
                 USER_PAGE, USER_PANEL, ADMIN_PANEL, BULK_PANEL];

const TENANT = "t1";
const CAPS: BulkCapabilities = {
  canRead: true, canSend: false, canManageMembers: false, isDefaultSender: false,
};

const cand = (p: Partial<BulkCandidate> & { userId: string }): BulkCandidate => ({
  name: "N", email: `${p.userId}@x.com`, tenantId: TENANT, roleCodes: ["COORDINATOR"],
  existing: null, hasOtherDefaultSender: false, ...p,
});

const preview = (
  candidates: BulkCandidate[],
  o: Partial<{ eligibility: string | null; type: string; requireEligibility: boolean }> = {},
) => previewBulkAssignment({
  tenantId: TENANT,
  mailboxEligibility: o.eligibility === undefined ? "OPERATIONS" : o.eligibility,
  mailboxType: o.type ?? "SHARED",
  capabilities: CAPS,
  candidates,
  requireEligibility: o.requireEligibility ?? true,
});

const ctx = (o: Partial<PreviewContext> = {}): PreviewContext => ({
  mailboxId: "mb1", capabilities: CAPS, requireEligibility: true,
  mailboxEligibility: "OPERATIONS", mailboxType: "SHARED", ...o,
});

const readyRow = (over: Partial<ReadinessInput> = {}): ReadinessInput => ({
  address: "operations@effitrans.com",
  mailboxType: "SHARED",
  ownership: "PLATFORM_MANAGED",
  provisioningStatus: "ACTIVE",
  isActive: true,
  departmentEligibility: "OPERATIONS",
  corporateIdentityConfirmedAt: null,
  outboundVerifiedAt: "2026-08-01T00:00:00Z",
  inboundVerifiedAt: null,
  activeMembers: 3,
  // EMP-5F — a mailbox activated through the governed lifecycle records WHO did
  // it. Without that, an ACTIVE mailbox is legacy-unverified, which is a
  // separate finding these EMP-5E cases are not about.
  activatedBy: "admin-1",
  ...over,
});

// ---------------------------------------------------------------------------
// 1. Purpose no longer decides anything about eligibility
// ---------------------------------------------------------------------------
describe("purpose is a label again", () => {
  it("is not an input to the classifier at all", () => {
    // The strongest possible statement of "spelling cannot matter": there is
    // nowhere for a purpose to enter the decision. Not a looser comparison — no
    // comparison.
    expect(code(BULK)).not.toContain("purpose");
    expect(code(BULK)).not.toContain("Purpose");
  });

  it("is not even read by the server action that builds the preview", () => {
    const s = code(BULK_ACTIONS);
    const select = s.slice(s.indexOf('.from("ec_mailbox")'), s.indexOf("mailbox_not_found"));
    expect(select).toContain("department_eligibility");
    expect(select).toContain("mailbox_type");
    expect(select).not.toContain("purpose");
  });

  it("rejects a mistyped eligibility instead of silently proposing nobody", () => {
    // This is the behavioural difference. Before, `Operations` was accepted into
    // a free-text column and quietly matched nothing forever. Now the same
    // string is not a valid key, so it can never be stored — the mistake
    // surfaces at the moment it is made.
    for (const bad of ["Operations", "OPERATIONS ", " OPERATIONS", "operations",
                       "GENERAL", "QUOTATION", "", "OPÉRATIONS"]) {
      expect(isDepartmentEligibility(bad), bad).toBe(false);
    }
    for (const good of DEPARTMENT_ELIGIBILITY_VALUES) {
      expect(isDepartmentEligibility(good), good).toBe(true);
    }
  });

  it("keeps GENERAL and QUOTATION valid, each with a French label", () => {
    // EC-1 designed `purpose` as free tenant vocabulary and defaulted it to
    // GENERAL; the triage engine keys on QUOTATION. Outlawing either would have
    // broken working behaviour, which is why EMP-5C refused to constrain it.
    expect(MAILBOX_PURPOSE_OPTIONS).toContain("GENERAL");
    expect(MAILBOX_PURPOSE_OPTIONS).toContain("QUOTATION");
    expect(purposeLabelFr("GENERAL")).toBe("Correspondance générale");
    expect(purposeLabelFr("QUOTATION")).toBe("Devis");
    // Free vocabulary: an unknown value is shown verbatim, not hidden as "Autre".
    expect(purposeLabelFr("RECLAMATIONS CLIENTS")).toBe("RECLAMATIONS CLIENTS");
    expect(purposeLabelFr(null)).toBe("—");
  });

  it("adds no competing constraint on purpose", () => {
    const m = sqlCode(MIGRATION_96);
    expect(m).not.toMatch(/add constraint ec_mailbox_purpose_check/i);
    expect(read(MIGRATION_96)).toContain("purpose must remain unconstrained free vocabulary");
  });

  it("still uses purpose where purpose belongs — the triage hint", () => {
    // Proof the two concepts really are distinct rather than one renamed: this
    // is a legitimate reader of the label, and EMP-5E leaves it alone.
    expect(code("lib/ec/triage/model.ts")).toContain('mailboxPurpose === "QUOTATION"');
  });
});

// ---------------------------------------------------------------------------
// 2. department_eligibility decides who is proposed
// ---------------------------------------------------------------------------
describe("department_eligibility controls proposals", () => {
  it("proposes a mailbox to a department whose roles imply it", () => {
    expect(preview([cand({ userId: "a" })])[0].outcome).toBe("GRANT_NEW");
  });

  it("skips a user whose department implies a different bucket", () => {
    const d = preview([cand({ userId: "a" })], { eligibility: "FINANCE" });
    expect(d[0].outcome).toBe("SKIPPED_NOT_ELIGIBLE");
    expect(d[0].writes).toBe(false);
  });

  it("switching the mailbox's eligibility changes who is proposed", () => {
    const users = [cand({ userId: "ops", roleCodes: ["COORDINATOR"] }),
                   cand({ userId: "fin", roleCodes: ["FINANCE_OFFICER"] })];
    const asOps = preview(users);
    const asFin = preview(users, { eligibility: "FINANCE" });
    expect(asOps.map((d) => d.outcome)).toEqual(["GRANT_NEW", "SKIPPED_NOT_ELIGIBLE"]);
    expect(asFin.map((d) => d.outcome)).toEqual(["SKIPPED_NOT_ELIGIBLE", "GRANT_NEW"]);
  });

  it("NULL means nobody is proposed — not GENERAL, and not everybody", () => {
    const d = preview([cand({ userId: "a" }), cand({ userId: "b", roleCodes: ["FINANCE_OFFICER"] })],
                      { eligibility: null });
    expect(d.map((x) => x.outcome))
      .toEqual(["SKIPPED_MAILBOX_NOT_DEPARTMENTAL", "SKIPPED_MAILBOX_NOT_DEPARTMENTAL"]);
    expect(writableDecisions(d)).toHaveLength(0);
    // And it says WHY in a sentence about the mailbox, not about the person:
    // the fact is mailbox-level and applies identically to everyone.
    expect(d[0].reason).toMatch(/aucun département éligible/i);
  });

  it("names the unproposed mailbox as an outcome of its own", () => {
    // Folding this into SKIPPED_NOT_ELIGIBLE would tell an administrator that
    // forty departments were wrong, when one mailbox is unclassified.
    expect(OUTCOME_FR.SKIPPED_MAILBOX_NOT_DEPARTMENTAL).toBeTruthy();
    const s = summarize(preview([cand({ userId: "a" })], { eligibility: null }));
    expect(s.SKIPPED_MAILBOX_NOT_DEPARTMENTAL).toBe(1);
    expect(Object.keys(s).sort()).toEqual(Object.keys(OUTCOME_FR).sort());
  });

  it("does not infer eligibility from the address or the label", () => {
    // A mailbox literally addressed operations@ with an Opérations label is
    // STILL proposed to nobody while its eligibility is NULL.
    const d = preview([cand({ userId: "a" })], { eligibility: null });
    expect(d[0].outcome).toBe("SKIPPED_MAILBOX_NOT_DEPARTMENTAL");
    const s = code(BULK);
    expect(s).not.toContain("address");
    expect(s).not.toContain("label");
  });

  it("does not duplicate the canonical department registry", () => {
    // DEPARTMENT_MAILBOXES stays the single source of department → buckets.
    expect(code(ELIGIBILITY)).toContain("DEPARTMENT_MAILBOXES");
    for (const f of [BULK, BULK_ACTIONS, ADMIN_ACTIONS, ADMIN_PANEL, USER_PAGE]) {
      expect(code(f), f).not.toContain("DEPARTMENT_MAILBOXES");
    }
    expect(sqlCode(MIGRATION_96)).not.toContain("DEPARTMENT_MAILBOXES");
  });
});

// ---------------------------------------------------------------------------
// 3. Mailbox type semantics
// ---------------------------------------------------------------------------
describe("PERSONAL / SHARED / FUNCTIONAL", () => {
  it("never department-proposes a PERSONAL mailbox, even if one carries a bucket", () => {
    const d = preview([cand({ userId: "a" })], { type: "PERSONAL", eligibility: "OPERATIONS" });
    expect(d[0].outcome).toBe("SKIPPED_MAILBOX_NOT_DEPARTMENTAL");
    expect(d[0].reason).toMatch(/personnelle/i);
    expect(canHoldDepartmentEligibility("PERSONAL")).toBe(false);
  });

  it("department-proposes SHARED and FUNCTIONAL alike", () => {
    for (const type of ["SHARED", "FUNCTIONAL"]) {
      expect(canHoldDepartmentEligibility(type), type).toBe(true);
      expect(preview([cand({ userId: "a" })], { type })[0].outcome, type).toBe("GRANT_NEW");
    }
  });

  it("makes FUNCTIONAL explicit — it proposes nobody without a bucket", () => {
    expect(preview([cand({ userId: "a" })], { type: "FUNCTIONAL", eligibility: null })[0].outcome)
      .toBe("SKIPPED_MAILBOX_NOT_DEPARTMENTAL");
  });

  it("gives every type a French name and a stated meaning", () => {
    for (const t of ["PERSONAL", "SHARED", "FUNCTIONAL"]) {
      expect(MAILBOX_TYPE_FR[t], t).toBeTruthy();
      expect(MAILBOX_TYPE_MEANING_FR[t], t).toBeTruthy();
    }
    expect(MAILBOX_TYPE_MEANING_FR.PERSONAL).toMatch(/personne physique/);
    expect(MAILBOX_TYPE_MEANING_FR.FUNCTIONAL).toMatch(/fonction/);
  });

  it("refuses a department bucket on a personal mailbox at the write path", () => {
    const s = code(ADMIN_ACTIONS);
    expect(s).toContain("personal_not_departmental");
    expect(s).toContain("canHoldDepartmentEligibility");
  });

  it("keeps aliases out of membership entirely — by construction", () => {
    // An alias is not an independent membership container: memberships point at
    // `ec_mailbox`, and every write path resolves the id against that table, so
    // an alias id yields `mailbox_not_found` rather than a grant.
    const s = code(ADMIN_ACTIONS);
    expect(s).not.toContain("ec_mailbox_alias");
    const grant = s.slice(s.indexOf("export async function grantMembership"),
                          s.indexOf("export async function revokeMembership"));
    expect(grant).toContain('.from("ec_mailbox").select("id, address")');
    expect(grant).toContain('return { ok: false, error: "mailbox_not_found" }');
  });
});

// ---------------------------------------------------------------------------
// 4. Eligibility proposes; it never grants and never revokes
// ---------------------------------------------------------------------------
describe("eligibility moves no membership", () => {
  it("leaves an existing membership untouched when eligibility is cleared", () => {
    // The person keeps their access: it came from an administrator's decision
    // recorded on a membership row, not from this column.
    const held = cand({ userId: "a", existing: {
      id: "m1", canRead: true, canSend: false, canManageMembers: false,
      isDefaultSender: false, revokedAt: null,
    } });
    for (const eligibility of ["OPERATIONS", "FINANCE", null]) {
      const d = preview([held], { eligibility });
      expect(d[0].writes, String(eligibility)).toBe(false);
      expect(writableDecisions(d), String(eligibility)).toHaveLength(0);
    }
  });

  it("has a write path that can only touch one column", () => {
    const fn = fnBody(code(ADMIN_ACTIONS), "setDepartmentEligibility");
    // The whole safety property, read off the source: nothing about members.
    expect(fn).toContain(".update({ department_eligibility: eligibility })");
    for (const forbidden of ["ec_mailbox_member", "revoked_at", "granted_by", "can_read",
                             "is_default_sender", ".upsert(", ".delete(", ".insert("]) {
      expect(fn, forbidden).not.toContain(forbidden);
    }
  });

  it("audits classification as its own act, not as a membership change", () => {
    const fn = fnBody(code(ADMIN_ACTIONS), "setDepartmentEligibility");
    expect(fn).toContain("EC_MAILBOX_CLASSIFIED");
    expect(fn).not.toContain("EC_MAILBOX_MEMBER_GRANTED");
    expect(fn).not.toContain("EC_MAILBOX_MEMBER_REVOKED");
    expect(read("lib/audit/events.ts")).toContain('EC_MAILBOX_CLASSIFIED: "ec.mailbox.classified"');
  });

  it("says so where the control is", () => {
    const s = read(ADMIN_PANEL);
    expect(s).toMatch(/proposés\s*\n?\s*automatiquement/);
    expect(s).toMatch(/ne retire\s*\n?\s*aucun accès existant/);
  });

  it("keeps individual assignment available whatever the eligibility", () => {
    // Eligibility filters PROPOSALS. `grantMembership` never consults it.
    const s = code(ADMIN_ACTIONS);
    const grant = s.slice(s.indexOf("export async function grantMembership"),
                          s.indexOf("export async function revokeMembership"));
    expect(grant).not.toContain("department_eligibility");
    expect(grant).not.toContain("eligib");
    expect(read(USER_PANEL)).toMatch(/attribution manuelle reste possible sur toute boîte/);
  });

  it("honours a hand-picked audience even on an unclassified mailbox", () => {
    // requireEligibility=false means the administrator chose these people
    // themselves; their choice stands.
    const d = preview([cand({ userId: "a", roleCodes: ["SYSTEM_ADMIN"] })],
                      { eligibility: null, requireEligibility: false });
    expect(d[0].outcome).toBe("GRANT_NEW");
  });
});

// ---------------------------------------------------------------------------
// 5. The preview must not survive a reclassification
// ---------------------------------------------------------------------------
describe("fingerprint binds the classification", () => {
  it("differs across eligibility values even when the decisions are identical", () => {
    // The case a decisions-only fingerprint misses: this user's roles make them
    // eligible for BOTH buckets, so both previews say GRANT_NEW — the same
    // outcome on a different authorization basis.
    const both = cand({ userId: "a", roleCodes: ["COORDINATOR", "FINANCE_OFFICER"] });
    const ops = preview([both]);
    const fin = preview([both], { eligibility: "FINANCE" });
    expect(ops.map((d) => d.outcome)).toEqual(fin.map((d) => d.outcome));
    expect(previewFingerprint(ops, ctx()))
      .not.toBe(previewFingerprint(fin, ctx({ mailboxEligibility: "FINANCE" })));
  });

  it("differs when the classification is cleared, on an empty candidate list", () => {
    // With no candidates the body is empty, so only the head can carry it.
    expect(previewFingerprint([], ctx()))
      .not.toBe(previewFingerprint([], ctx({ mailboxEligibility: null })));
  });

  it("differs when the mailbox type changes", () => {
    expect(previewFingerprint([], ctx()))
      .not.toBe(previewFingerprint([], ctx({ mailboxType: "PERSONAL" })));
  });

  it("is stable for the same preview", () => {
    const a = preview([cand({ userId: "a" }), cand({ userId: "b" })]);
    const b = preview([cand({ userId: "b" }), cand({ userId: "a" })]);
    expect(previewFingerprint(a, ctx())).toBe(previewFingerprint(b, ctx()));
  });

  it("is recomputed server-side and refused when stale", () => {
    const s = code(BULK_ACTIONS);
    const fn = s.slice(s.indexOf("export async function executeBulkAssignment"));
    expect(fn).toContain("await previewBulkAssignmentAction");
    expect(fn).toContain("preview.fingerprint !== input.fingerprint");
    expect(fn).toContain("preview_stale");
    // And the recomputation reads the CURRENT classification, so a mailbox
    // reclassified between preview and confirmation produces a different one.
    expect(s).toContain("mailboxEligibility,");
  });
});

// ---------------------------------------------------------------------------
// 6. Onboarding
// ---------------------------------------------------------------------------
describe("onboarding proposes on the controlled key", () => {
  it("matches the mailbox's eligibility, never its label", () => {
    const s = code(USER_PAGE);
    expect(s).toContain("m.departmentEligibility === e.eligibility");
    expect(s).not.toContain("m.purpose");
  });

  it("excludes personal mailboxes from both proposal and manual list", () => {
    const s = code(USER_PAGE);
    expect(s).toContain('mailboxes.filter((m) => m.mailboxType !== "PERSONAL")');
    expect(s).toContain("allMailboxes={assignable}");
  });

  it("still proposes nothing for cross-cutting roles", () => {
    expect(eligibleMailboxes(["SYSTEM_ADMIN", "CEO", "MAIL_ADMIN"])).toEqual([]);
    expect(eligibleMailboxes([])).toEqual([]);
  });

  it("assigns nothing on load — proposals need a click", () => {
    const s = code(USER_PANEL);
    expect(s).not.toContain("useEffect");
    const section = s.slice(s.indexOf("Boîtes proposées"));
    expect(section).toContain("onClick");
    expect(section).toContain("grantMembership");
  });
});

// ---------------------------------------------------------------------------
// 7. Readiness — descriptive, deterministic, powerless
// ---------------------------------------------------------------------------
describe("readiness warnings", () => {
  it("are deterministic and stably ordered", () => {
    const row = readyRow({ ownership: "UNKNOWN", outboundVerifiedAt: null, activeMembers: 0 });
    const a = mailboxReadiness(row);
    const b = mailboxReadiness(row);
    expect(a).toEqual(b);
    expect(new Set(a.map((n) => n.code)).size).toBe(a.length);
    expect(a.map((n) => n.code)).toEqual([...a].map((n) => n.code));
  });

  it("describes the production mailbox exactly as it stands", () => {
    // ownership UNKNOWN, ACTIVE with no verification evidence, no members, no
    // eligibility, nominative address on a SHARED mailbox.
    const notes = mailboxReadiness(readyRow({
      address: "prenom@effitrans.com", ownership: "UNKNOWN", departmentEligibility: null,
      outboundVerifiedAt: null, inboundVerifiedAt: null, activeMembers: 0,
    }));
    const codes = notes.map((n) => n.code);
    expect(codes).toContain("OWNERSHIP_UNKNOWN");
    expect(codes).toContain("ACTIVE_WITHOUT_VERIFICATION");
    expect(codes).toContain("PERSONAL_LOOKING_ADDRESS");
    expect(codes).toContain("NO_DEPARTMENT_ELIGIBILITY");
    expect(codes).toContain("NO_MEMBERS");
    // The two sentences the brief names, verbatim.
    expect(notes.find((n) => n.code === "OWNERSHIP_UNKNOWN")?.messageFr)
      .toContain("Classification à confirmer");
    expect(notes.find((n) => n.code === "ACTIVE_WITHOUT_VERIFICATION")?.messageFr)
      .toContain("Boîte active sans preuve de vérification");
  });

  it("does NOT call manual assignment unhealthy", () => {
    const notes = mailboxReadiness(readyRow({ departmentEligibility: null }));
    const n = notes.find((x) => x.code === "NO_DEPARTMENT_ELIGIBILITY");
    expect(n?.severity).toBe("info");
    expect(n?.messageFr).toMatch(/manuellement/);
  });

  it("recognises a functional address rather than flagging every mailbox", () => {
    for (const addr of ["operations@effitrans.com", "support@effitrans.com",
                        "devis@effitrans.sn", "no-reply@effitrans.com"]) {
      expect(mailboxReadiness(readyRow({ address: addr })).map((n) => n.code), addr)
        .not.toContain("PERSONAL_LOOKING_ADDRESS");
    }
  });

  it("flags a personal mailbox that carries a department bucket", () => {
    const codes = mailboxReadiness(readyRow({
      mailboxType: "PERSONAL", address: "awa.diop@effitrans.com",
    })).map((n) => n.code);
    expect(codes).toContain("PERSONAL_WITH_ELIGIBILITY");
  });

  it("flags an eligible mailbox that is inactive or unverified", () => {
    expect(mailboxReadiness(readyRow({ provisioningStatus: "DISABLED", isActive: false }))
      .map((n) => n.code)).toContain("ELIGIBILITY_ON_INACTIVE_MAILBOX");
    expect(mailboxReadiness(readyRow({ outboundVerifiedAt: null }))
      .map((n) => n.code)).toContain("ELIGIBLE_BUT_UNVERIFIED");
  });

  it("stays silent about a mailbox with nothing to report", () => {
    expect(mailboxReadiness(readyRow({ ownership: "PLATFORM_MANAGED" }))).toEqual([]);
    expect(readinessTone([])).toBeNull();
  });

  it("cannot change anything — it is pure, and it has no clock", () => {
    const s = code(READINESS);
    for (const w of ["supabase", "fetch(", "insert", "update", "delete",
                     "Date.now", "new Date", "Math.random", "revalidatePath"]) {
      expect(s, w).not.toContain(w);
    }
    expect(read(ADMIN_PANEL)).toMatch(/aucun n&apos;a désactivé, modifié ou/);
  });
});

// ---------------------------------------------------------------------------
// 8. The two fields are visibly two fields
// ---------------------------------------------------------------------------
describe("administration shows usage and eligibility separately", () => {
  it("labels both, in French, on the mailbox detail", () => {
    const s = read(ADMIN_PANEL);
    expect(s).toContain('label="Usage de la boîte"');
    expect(s).toContain('label="Département éligible"');
  });

  it("offers « Aucun » as a real answer rather than a blank", () => {
    expect(ELIGIBILITY_OPTIONS[0].value).toBe("");
    expect(ELIGIBILITY_OPTIONS[0].label).toBe(ELIGIBILITY_NONE_FR);
    expect(ELIGIBILITY_NONE_FR).toMatch(/attribution manuelle uniquement/);
    expect(eligibilityLabelFr(null)).toBe(ELIGIBILITY_NONE_FR);
    expect(ELIGIBILITY_OPTIONS).toHaveLength(DEPARTMENT_ELIGIBILITY_VALUES.length + 1);
  });

  it("shows no raw enum code where a French label exists", () => {
    const s = read(ADMIN_PANEL);
    // The old list rendered the code itself: `<option key={p} value={p}>{p}</option>`.
    expect(s).not.toMatch(/value=\{p\}>\{p\}</);
    expect(s).toContain("purposeLabelFr(p)");
    expect(s).toContain("eligibilityLabelFr(");
    expect(s).toContain("MAILBOX_TYPE_FR[");
    for (const label of Object.values(MAILBOX_TYPE_FR)) expect(s).not.toContain(`>${label.toUpperCase()}<`);
  });

  it("shows the basis the bulk preview actually used", () => {
    const s = code(BULK_PANEL);
    expect(s).toContain("eligibilityLabelFr(m.departmentEligibility)");
    expect(s).toContain("res.mailboxEligibility");
    expect(s).not.toContain("m.purpose");
  });
});

// ---------------------------------------------------------------------------
// 9. Scope — everything this phase must NOT have done
// ---------------------------------------------------------------------------
describe("scope", () => {
  it("is backed by exactly one migration, and it is EMP-5D's", () => {
    // EMP-5E itself added none: the column and its CHECK already existed. The
    // property worth defending is not "nothing came after" — EMP-5F legitimately
    // did — but that the eligibility key is introduced ONCE and never
    // re-shaped afterwards.
    const migrations = readdirSync(join(root, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql")).sort();
    const touching = migrations.filter((f) =>
      read(`supabase/migrations/${f}`).includes("department_eligibility"));
    expect(touching).toEqual(["20260818000001_mailbox_department_eligibility.sql"]);
  });

  it("modifies no existing mailbox automatically", () => {
    // No classification is inferred, backfilled or defaulted anywhere: the only
    // writes to the column are an explicit administrator action and the creation
    // of a NEW mailbox.
    for (const f of TOUCHED) {
      expect(code(f).toLowerCase(), f).not.toContain("aminata");
      expect(code(f), f).not.toMatch(/backfill|infer[A-Za-z]*Eligibility|autoClassif/i);
    }
    const writes = [...code(ADMIN_ACTIONS).matchAll(/department_eligibility/g)].length;
    expect(writes).toBeGreaterThan(0);
    // Both writes are id-scoped and value-explicit; neither is a bulk update.
    expect(code(ADMIN_ACTIONS)).not.toMatch(/\.update\(\{[^}]*department_eligibility[^}]*\}\)\s*(?!\s*\.eq\("id")/);
  });

  it("touches no provider, DNS, inbound or outbound switch", () => {
    for (const f of TOUCHED) {
      const s = code(f);
      for (const w of ["EFFITRANS_EC_INBOUND_ENABLED", "EFFITRANS_EC_OUTBOUND_ENABLED",
                       "COMMUNICATIONS_EMAIL_FROM", "COMMUNICATIONS_EMAIL_PROVIDER",
                       "RESEND_API_KEY", "resend", "tenant_ec_inbound_rollout",
                       "return_path", "dkim", "spf", "dmarc"]) {
        expect(s, `${f}:${w}`).not.toContain(w);
      }
    }
  });

  it("adds no permission and grants SYSTEM_ADMIN nothing", () => {
    const known = ["communication:mailbox:provision", "communication:membership:manage"];
    for (const f of TOUCHED) {
      const s = code(f);
      expect(s, f).not.toContain("SYSTEM_ADMIN");
      expect(s, f).not.toContain("communication:inbound:read");
      for (const p of [...s.matchAll(/"([a-z_]+:[a-z_:]+)"/g)].map((m) => m[1])) {
        if (p.startsWith("communication:")) expect(known, `${f}:${p}`).toContain(p);
      }
    }
  });

  it("has no Send As, anywhere", () => {
    for (const f of TOUCHED) {
      const s = code(f).toLowerCase();
      for (const w of ["can_send_as", "cansendas", "send as", "envoyer en tant que"]) {
        expect(s, `${f}:${w}`).not.toContain(w);
      }
    }
  });

  it("leaves EMP-5D's Reply-To rule exactly as it was", () => {
    expect(resolveReplyTo("t1", {
      id: "mb", tenantId: "t1", address: "operations@effitrans.com",
      isActive: true, provisioningStatus: "ACTIVE",
    })).toEqual({ replyTo: "operations@effitrans.com", reason: "mailbox_of_record" });
    expect(resolveReplyTo("t1", null).replyTo).toBeNull();
    const s = code("lib/comms/reply-to.ts");
    expect(s).not.toContain("eligib");
    expect(s).not.toContain("purpose");
  });

  it("keeps every read and write tenant-scoped", () => {
    const fn = fnBody(code(ADMIN_ACTIONS), "setDepartmentEligibility");
    expect((fn.match(/\.eq\("tenant_id", user\.tenantId\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(code(BULK_ACTIONS)).toContain('.eq("tenant_id", user.tenantId)');
    // Defence in depth: a candidate carrying another tenant is still rejected.
    expect(preview([cand({ userId: "a", tenantId: "OTHER" })])[0].outcome)
      .toBe("REJECTED_CROSS_TENANT");
    expect(preview([cand({ userId: "a", tenantId: "OTHER" })], { requireEligibility: false })[0].outcome)
      .toBe("REJECTED_CROSS_TENANT");
  });

  it("keeps the classifier pure", () => {
    const s = code(BULK);
    for (const w of ["supabase", "fetch(", "insert", "update", "Date.now", "new Date"]) {
      expect(s, w).not.toContain(w);
    }
  });
});
