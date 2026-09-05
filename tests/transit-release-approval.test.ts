/**
 * TRANSIT-CUSTODY-05 — the Chef de Transit's final verification before the
 * Transport leg.
 * ---------------------------------------------------------------------------
 * TRANSIT-CUSTODY-03 reported guard 4 as blocked: `recordCustomsRelease` is
 * bound by a ratified 2026-08-24 control (`assertControlStep("customs.release")`)
 * to whoever CLAIMED step 13 — the field agent. Moving the release to the Chef
 * would have meant weakening that control.
 *
 * Design B clears the block by inverting the question. The release stays exactly
 * where it was; what it gained is a PRECONDITION only the Chef can set:
 *
 *   field agent records the mainlevée  → release_approval_status = PENDING
 *   Chef de Transit verifies           → APPROVED (or REJECTED, with a motif)
 *   field agent finalises the release  → customs_record RELEASED
 *
 * Three acts, two people, no new status, no 27th step, no weakened control.
 *
 * What this suite proves, in order: the schema is additive and self-checking;
 * the two RPCs assert actor authority and maker/checker in the database; the
 * server refuses a release without the verdict; the seat is the Chef's rather
 * than any `customs:validate` holder's; the ledger is registered; and every
 * surface says which of the three acts is outstanding.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mayApproveRelease, RELEASE_APPROVAL_ROLES } from "@/lib/process/handoff-routes";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { EVENT_TYPES } from "@/lib/workflow/events/types";
import { getStep } from "@/lib/process/effitrans-process";
import { canPickup } from "@/lib/transport/gates";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const NL = String.fromCharCode(10);

const MIGRATION = "supabase/migrations/20260930000001_customs_release_approval.sql";
const sql = read(MIGRATION).replace(/^\s*--.*$/gm, "");
const customsActions = strip(read("lib/customs/actions.ts"));
const transitActions = strip(read("lib/process/engine/transit-actions.ts"));
const panel = strip(read("components/process/transit-panel.tsx"));
const customsPanel = strip(read("components/customs/customs-panel.tsx"));
const processPage = strip(read("app/files/[id]/process/page.tsx"));

/** The body of one exported function, bounded at the next top-level export. */
const fn = (src: string, name: string) => {
  const i = src.indexOf(`export async function ${name}(`);
  expect(i, `${name} must exist`).toBeGreaterThan(-1);
  const rest = src.slice(i);
  const j = rest.indexOf(NL + "export ", 1);
  return j > 0 ? rest.slice(0, j) : rest;
};

/** The body of one SQL function, bounded at its own `revoke execute`. */
const sqlFn = (name: string) => {
  const i = sql.indexOf(`create or replace function public.${name}(`);
  expect(i, `${name} must exist`).toBeGreaterThan(-1);
  const rest = sql.slice(i);
  const j = rest.indexOf("revoke execute");
  expect(j, `${name} must be revoked from public`).toBeGreaterThan(-1);
  return rest.slice(0, j);
};

const perms = (r: string) =>
  TENANT_ROLE_TEMPLATES.find((t) => t.key === r)!.permissions as readonly string[];
const holdersOf = (p: string) =>
  TENANT_ROLE_TEMPLATES.filter((t) => (t.permissions as readonly string[]).includes(p)).map((t) => t.key);

// ═══════════ the schema — additive, and no new status ══════════════════════

describe("TRANSIT-CUSTODY-05 — the six fields are additive and nullable", () => {
  it("01 — all six columns are added nullable, so no existing row is invalidated", () => {
    for (const col of [
      "bae_recorded_by", "bae_recorded_at", "release_approval_status",
      "release_approval_by", "release_approval_at", "release_approval_note",
    ]) {
      expect(sql).toMatch(new RegExp(`add column if not exists\\s+${col}\\b`));
    }
    // A `not null` on any of them would have rejected every dossier that
    // predates this slice — the whole reason the fields are nullable.
    const alter = sql.slice(sql.indexOf("alter table"), sql.indexOf("create or replace function public."));
    expect(alter).not.toMatch(/add column if not exists\s+(bae_recorded|release_approval)\w*[^;]*not null/);
  });

  it("02 — no new customs status was invented", () => {
    // The lifecycle vocabulary is unchanged; the verdict is a separate field.
    // Asserted on the status module rather than on the migration text, which
    // NAMES the forbidden value in order to assert its own absence.
    const status = read("lib/customs/status.ts");
    expect(status).not.toContain("PENDING_RELEASE");
    expect(status).not.toContain("AWAITING_APPROVAL");
    expect(sql).not.toMatch(/customs_record[\s\S]{0,200}status[\s\S]{0,80}'PENDING_RELEASE'/);
  });

  it("03 — the verdict vocabulary is closed by a CHECK", () => {
    expect(sql).toMatch(/release_approval_status[\s\S]{0,200}in\s*\(\s*'PENDING'\s*,\s*'APPROVED'\s*,\s*'REJECTED'\s*\)/);
  });

  it("04 — a decision cannot exist half-recorded", () => {
    // Status, author and timestamp travel together; a rejection also carries a
    // motif. Three named constraints, so a later migration cannot drop one by
    // accident without the name showing up in the diff.
    for (const c of [
      "customs_bae_recording_complete",
      "customs_release_decision_complete",
      "customs_release_rejection_reasoned",
    ]) {
      expect(sql).toContain(c);
    }
  });

  it("05 — the constraints are added idempotently", () => {
    const adds = sql.match(/add constraint/g) ?? [];
    const guards = sql.match(/from pg_constraint where conname/g) ?? [];
    expect(adds.length).toBeGreaterThanOrEqual(3);
    expect(guards.length).toBeGreaterThanOrEqual(adds.length);
  });
});

// ═══════════ the two RPCs — authority in the database ══════════════════════

describe("TRANSIT-CUSTODY-05 — the database is the boundary, not the UI", () => {
  it("06 — recording the mainlevée asserts the actor's authority (INV-7)", () => {
    const f = sqlFn("record_customs_bae");
    expect(f).toMatch(/assert_actor_authority\s*\(\s*p_actor[\s\S]{0,160}'customs:release'[\s\S]{0,60}'SERVICE'/);
  });

  it("07 — the verdict asserts the CHECKER's authority, a different permission", () => {
    const f = sqlFn("record_customs_release_approval");
    expect(f).toMatch(/assert_actor_authority\s*\(\s*p_actor[\s\S]{0,160}'customs:validate'[\s\S]{0,60}'SERVICE'/);
  });

  it("08 — maker/checker is enforced in the RPC, on the RECORDED author", () => {
    // Not on the caller's claim, and not in the action layer where a second
    // entry point could route around it.
    const f = sqlFn("record_customs_release_approval");
    // The recorded author is READ from the row, and COMPARED to the caller, and
    // that comparison is what raises. Asserting the three separately would pass
    // on a function that reads the author and then ignores it — which is
    // exactly the mutation this assertion exists to kill.
    expect(f).toMatch(/into[\s\S]{0,120}v_recorder/);
    expect(f).toMatch(/v_recorder\s*=\s*p_actor\s+then[\s\S]{0,200}raise exception 'self_approval_forbidden/);
  });

  it("09 — recording opens the verification and clears any earlier verdict", () => {
    const f = sqlFn("record_customs_bae");
    expect(f).toMatch(/release_approval_status\s*=\s*'PENDING'/);
    expect(f).toMatch(/release_approval_by\s*=\s*null/);
    expect(f).toMatch(/release_approval_at\s*=\s*null/);
  });

  it("10 — an already-released record refuses a new mainlevée", () => {
    expect(sqlFn("record_customs_bae")).toMatch(/RELEASED/);
  });

  it("11 — the verdict requires a mainlevée and an outstanding decision", () => {
    const f = sqlFn("record_customs_release_approval");
    expect(f).toMatch(/bae_required/);
    expect(f).toMatch(/already_decided/);
  });

  it("12 — a rejection without a motif is refused in the database too", () => {
    expect(sqlFn("record_customs_release_approval")).toMatch(/reason_required/);
  });

  it("12b — every refusal carries a stable token, and the actions read the token", () => {
    // Matching on prose is how a precise refusal silently degrades into a
    // generic one the day somebody rewords an exception.
    for (const t of ["reason_required", "bae_required", "self_approval_forbidden",
                     "already_decided", "invalid_transition"]) {
      expect(sql, t).toContain(`raise exception '${t}: `);
    }
    for (const a of ["recordCustomsReleaseApproval", "recordBaeReference"]) {
      expect(fn(customsActions, a), a).toContain('(error.message ?? "").split(":")[0]');
    }
  });

  it("13 — neither RPC is executable by anon or authenticated (OPS-SEC-1)", () => {
    for (const name of ["record_customs_bae", "record_customs_release_approval"]) {
      const i = sql.indexOf(`create or replace function public.${name}(`);
      const tail = sql.slice(i);
      const k = tail.indexOf("revoke execute");
      const revoke = tail.slice(k, k + 900);
      expect(revoke).toMatch(/from\s+public/);
      expect(revoke).toMatch(/grant\s+execute[\s\S]{0,200}to\s+service_role/);
      expect(revoke).not.toMatch(/to\s+(anon|authenticated)\b/);
    }
  });

  it("14 — the migration verifies itself when applied", () => {
    expect(sql).toMatch(/do \$\$[\s\S]*raise exception/);
  });
});

// ═══════════ the server refuses — regardless of what the UI offered ════════

describe("TRANSIT-CUSTODY-05 — the release is refused without the verdict", () => {
  it("14b — a refusal without a motif is refused by the action, not only the UI", () => {
    const f = fn(customsActions, "recordCustomsReleaseApproval");
    expect(f).toMatch(/status === "REJECTED" && !\(note \?\? ""\)\.trim\(\)/);
    expect(f).toContain('error: "reason_required"');
    // And the engine wrapper refuses before it ever reaches the action.
    expect(fn(transitActions, "decideTransitRelease"))
      .toMatch(/status === "REJECTED" && !\(note \?\? ""\)\.trim\(\)/);
  });

  it("15 — recordCustomsRelease checks the approval itself", () => {
    const f = fn(customsActions, "recordCustomsRelease");
    expect(f).toMatch(/release_approval_status\s*!==\s*"APPROVED"/);
    expect(f).toContain("release_not_approved");
  });

  it("16 — and that check sits AFTER the ratified control gate, not instead of it", () => {
    const f = fn(customsActions, "recordCustomsRelease");
    expect(f).toContain('assertControlStep("customs.release"');
    expect(f.indexOf('assertControlStep("customs.release"'))
      .toBeLessThan(f.indexOf("release_not_approved"));
  });

  it("17 — the projection actually reads the column the check depends on", () => {
    // A check against a field the query never selected is a silent pass; this
    // is the assertion that would have caught it.
    const i = customsActions.indexOf("async function loadCustoms");
    const load = customsActions.slice(i, customsActions.indexOf(NL + "}", i));
    expect(load).toContain("release_approval_status");
  });

  it("18 — recording the mainlevée no longer releases anything", () => {
    const f = fn(transitActions, "recordBae");
    expect(f).toContain("recordBaeReference(customs.id");
    expect(f).not.toContain("releaseCustoms(");
    expect(f).not.toContain("recordCustomsRelease(");
  });

  it("19 — the finalisation is a separate act and re-checks the verdict", () => {
    const f = fn(transitActions, "finalizeTransitRelease");
    expect(f).toContain('release_approval_status !== "APPROVED"');
    expect(f).toContain("recordCustomsRelease(");
  });

  it("20 — the workspace's other status route still cannot reach RELEASED", () => {
    expect(fn(customsActions, "changeCustomsStatus")).toContain('toStatus === "RELEASED"');
  });
});

// ═══════════ the seat — the Chef, not every capable holder ═════════════════

describe("TRANSIT-CUSTODY-05 — the verification is the Chef de Transit's seat", () => {
  it("21 — the Chef approves", () => {
    expect(mayApproveRelease(["CHIEF_OF_TRANSIT"])).toBe(true);
  });

  it("22 — Operations does NOT, though it holds customs:validate", () => {
    // The ruling is explicit: possessing the capability must not silently make
    // Operations or platform administration the everyday approvers.
    expect(perms("OPS_SUPERVISOR")).toContain("customs:validate");
    expect(mayApproveRelease(["OPS_SUPERVISOR"])).toBe(false);
    expect(RELEASE_APPROVAL_ROLES).not.toContain("OPS_SUPERVISOR");
    expect(RELEASE_APPROVAL_ROLES).not.toContain("SYSTEM_ADMIN");
  });

  it("23 — neither does the Déclarant nor the field agent", () => {
    for (const r of ["CUSTOMS_DECLARANT", "CUSTOMS_FIELD_AGENT"]) {
      expect(mayApproveRelease([r])).toBe(false);
      expect(perms(r)).not.toContain("customs:validate");
    }
  });

  it("24 — the role scope is checked IN ADDITION to the permission", () => {
    const f = fn(transitActions, "decideTransitRelease");
    expect(f).toContain('transitGuard("customs:validate"');
    expect(f).toContain("mayApproveRelease(ctx.roles)");
    expect(f).toContain("not_authorized_approver");
  });

  it("25 — and the verification needs Transit custody, like the other Chef acts", () => {
    expect(fn(transitActions, "decideTransitRelease")).toContain("transitCustody(");
  });

  it("26 — customs:validate was not re-granted to anyone to make this work", () => {
    expect(holdersOf("customs:validate").sort())
      .toEqual(["CHIEF_OF_TRANSIT", "OPS_SUPERVISOR", "SYSTEM_ADMIN"]);
  });

  it("27 — no break-glass path was opened in this slice", () => {
    expect(transitActions).not.toMatch(/break[_-]?glass/i);
    expect(fn(transitActions, "decideTransitRelease")).not.toContain("SYSTEM_ADMIN");
  });
});

// ═══════════ the ledger ════════════════════════════════════════════════════

describe("TRANSIT-CUSTODY-05 — the three facts are on the record", () => {
  it("28 — the three events are registered and RPC-emitted", () => {
    for (const t of [
      "CUSTOMS_BAE_RECORDED_PENDING_VERIFICATION",
      "CUSTOMS_RELEASE_APPROVED",
      "CUSTOMS_RELEASE_REJECTED",
    ]) {
      const e = EVENT_TYPES.find((x) => x.type === t);
      expect(e, `${t} must be registered`).toBeTruthy();
      expect(e!.emission).toBe("rpc");
      expect(e!.clientSafe).toBe(false);
      expect(sql).toContain(t);
    }
  });

  it("29 — the verdict is audited under its own action, both ways", () => {
    const events = read("lib/audit/events.ts");
    expect(events).toContain("CUSTOMS_RELEASE_APPROVED");
    expect(events).toContain("CUSTOMS_RELEASE_REJECTED");
    const f = fn(customsActions, "recordCustomsReleaseApproval");
    // The `before` must carry the state that actually changed. An empty object
    // satisfies "contains before" and records nothing — the mutation this
    // assertion exists to kill.
    expect(f).toMatch(/before:\s*\{\s*release_approval_status:/);
    expect(f).toMatch(/after:\s*\{\s*release_approval_status:\s*status/);
  });

  it("30 — re-recording a mainlevée says so rather than looking like the first", () => {
    expect(sqlFn("record_customs_bae")).toMatch(/replaced/);
    expect(sqlFn("record_customs_bae")).toMatch(/after_rejection/);
  });

  it("31 — the migration ledger advanced with the file", () => {
    const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    expect(files.at(-1)).toBe("20260930000001_customs_release_approval.sql");
    const info = read("lib/platform/ops/build-info.ts");
    expect(info).toContain('LATEST_MIGRATION = "20260930000001_customs_release_approval"');
    expect(info).toContain(`MIGRATION_COUNT = ${files.length}`);
  });
});

// ═══════════ the surfaces — each says which act is outstanding ═════════════

describe("TRANSIT-CUSTODY-05 — the screens tell the three acts apart", () => {
  it("32 — the Transit panel names the pending verification in French", () => {
    expect(panel).toContain("BAE enregistré — vérification du Chef de Transit requise");
  });

  it("33 — recorded, verified and released are three distinct renders", () => {
    expect(panel).toContain("state.bae.released");
    expect(panel).toContain("state.bae.recorded");
    expect(panel).toContain('state.bae.approvalStatus === "APPROVED"');
    expect(panel).toContain('state.bae.approvalStatus === "REJECTED"');
  });

  it("34 — the Chef's two controls are offered only to the Chef", () => {
    expect(panel).toContain("Vérifier et libérer vers le Transport");
    expect(panel).toContain("Refuser avec motif");
    // `{canApproveRelease &&`, with the brace — not the bare substring, which
    // the negated branch `{!canApproveRelease &&` also satisfies and which
    // therefore survives deleting the guard on the buttons themselves.
    expect(panel).toContain("{canApproveRelease &&");
    expect(processPage).toContain("mayApproveRelease(user.roles ?? [])");
    expect(processPage).toContain('hasPermission(permissions, "customs:validate")');
  });

  it("35 — a refusal cannot be submitted without a motif", () => {
    expect(panel).toMatch(/disabled=\{pending \|\| !releaseNote\.trim\(\)\}/);
  });

  it("36 — a recorded refusal is shown with its motif", () => {
    expect(panel).toContain("state.bae.approvalNote");
    expect(panel).toContain("Libération refusée par le Chef de Transit");
  });

  it("37 — the state read reports who recorded the mainlevée and when", () => {
    const f = transitActions.slice(transitActions.indexOf("export async function getTransitState"));
    expect(f).toContain("bae_recorded_by");
    expect(f).toContain("recordedByName");
    expect(f).toContain("release_approval_status");
    // `recorded` comes from the REFERENCE and `released` from the STATUS. Read
    // off the same expression they would be one fact wearing two names, and the
    // panel's three-state render would collapse to two.
    expect(f).toMatch(/recorded:\s*Boolean\(customs\?\.bae_reference\)/);
    expect(f).toMatch(/released:\s*customs\?\.status === "RELEASED"/);
  });

  it("38 — the customs workspace records rather than offering a release it cannot do", () => {
    // The recording branch must be the one the UNVERIFIED path takes. Asserting
    // that both calls merely appear somewhere passes on a panel that offers the
    // release first and records only as a fallback — the opposite of the rule.
    expect(customsPanel).toMatch(
      /const verified = record\.releaseApprovalStatus === "APPROVED"[\s\S]{0,600}c\.baeRecordPrompt[\s\S]{0,200}recordBaeReference\(record\.id/,
    );
    expect(customsPanel).toMatch(/if \(verified\)[\s\S]{0,300}releaseCustoms\(record\.id/);
    expect(customsPanel).toContain("baePendingVerification");
  });

  it("39 — every new refusal has a French sentence on every surface that shows one", () => {
    for (const f of [
      "components/process/transit-panel.tsx",
      "components/process/step-actions.tsx",
      "components/process/queue-row-actions.tsx",
    ]) {
      const src = read(f);
      expect(src, f).toContain("not_authorized_approver:");
      expect(src, f).toContain("release_not_approved:");
    }
    const i18n = read("lib/i18n.ts");
    expect(i18n).toContain("release_not_approved:");
    expect(i18n).toContain("self_approval_forbidden:");
  });
});

// ═══════════ what must NOT have moved ══════════════════════════════════════

describe("TRANSIT-CUSTODY-05 — the ratified frame is untouched", () => {
  it("40 — no 27th step, and step 13 keeps its own permission", () => {
    expect(getStep("customs_field_clearance")!.permissions).toEqual(["customs:release"]);
    expect(perms("CUSTOMS_FIELD_AGENT")).toContain("customs:release");
  });

  it("41 — the transport gate is unchanged: it still reads RELEASED", () => {
    expect(canPickup("IMP", { required: true, status: "DECLARED" }, false)).toBe(false);
    expect(canPickup("IMP", { required: true, status: "RELEASED" }, false)).toBe(true);
    // A dossier with no customs leg never waits for a verification it has no
    // reason to have.
    expect(canPickup("TRP", { required: false, status: "NOT_REQUIRED" }, false)).toBe(true);
  });

  it("42 — assertControlStep was not weakened anywhere", () => {
    const gate = read("lib/process/control-gate.ts") + read("lib/process/control-gate-server.ts");
    expect(gate).toContain("assignedUserId");
    expect(gate).not.toMatch(/customs:validate|release_approval/);
  });
});
