/**
 * MAYA-P0.8-A (PG-1) — the Chef de Transit validation event.
 * ---------------------------------------------------------------------------
 * `customs:validate` had existed since the customs module shipped, held by the
 * checker roles and deliberately withheld from the preparer — and NOTHING ever
 * consumed it. The permission model expressed a control the application could
 * not perform. This closes that, and only that.
 *
 * Four properties this suite defends:
 *
 *   1. THE DATABASE ENFORCES MAKER-CHECKER, not the button. A CHIEF_OF_TRANSIT
 *      holds `customs:update` too, so the same human can prepare and then be
 *      tempted to validate; a UI-only rule would be one request away from
 *      being bypassed.
 *   2. THE ACTOR IS VERIFIED, NEVER BELIEVED — the OPS-SEC-2A contract.
 *   3. VALIDATION IS NOT A VERDICT. It moves no lifecycle and QC4 reports it as
 *      a fact, never as « conforme ».
 *   4. ONE-TIME. Re-validation is refused rather than overwriting the first
 *      validator's evidence.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deriveQC4, QC4_VALIDATION_IS_NOT_A_VERDICT, QC4_NO_VALIDATION_RECORD } from "@/lib/files/qc4";
import type { CustomsRecord } from "@/lib/customs/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260825000001_customs_validation_event.sql";
// MAYA-P0.8-B (PG-6) — the editor half, added by a later migration that REPLACES
// the function. Assertions about the LIVE rule must read this one.
const MIGRATION_PG6 = "supabase/migrations/20260826000001_customs_editor_attribution.sql";
const ACTIONS = "lib/customs/actions.ts";
const PANEL = "components/customs/customs-panel.tsx";
const PAGE = "app/files/[id]/page.tsx";
const TZ = "Africa/Dakar";

function actionBody(): string {
  const s = code(ACTIONS);
  const start = s.indexOf("export async function recordCustomsValidation");
  expect(start).toBeGreaterThan(-1);
  return s.slice(start, s.indexOf("export async function", start + 1));
}

const customs = (over: Partial<CustomsRecord> = {}): CustomsRecord => ({
  id: "c1", fileId: "f1", status: "DECLARED", required: true,
  declarationNumber: null, customsOffice: null, regime: null, declarationDate: null,
  baeReference: null, releaseDate: null, inspectionStatus: "NOT_REQUIRED",
  externalRef: null, notes: null,
  receivabilityStatus: null, receivabilityAt: null, receivabilityNote: null,
  providerCode: "manual", providerSyncedAt: null,
  reviewedAt: null, reviewedByEmail: null, ...over,
});

// ===========================================================================
describe("the permission finally has a consumer", () => {
  it("an action asserts customs:validate — the gap PG-1 named", () => {
    expect(actionBody()).toContain('assertPermission("customs:validate")');
  });

  it("customs:update alone is not sufficient", () => {
    const b = actionBody();
    expect(b).not.toContain('assertPermission("customs:update")');
    const perms = [...b.matchAll(/assertPermission\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(perms).toEqual(["customs:validate"]);
  });

  it("the checker roles are exactly the existing three; the Déclarant is not one", () => {
    const roles = read("lib/platform/role-templates.ts");
    const holders: string[] = [];
    for (const m of roles.matchAll(/key: "(\w+)"/g)) {
      const next = roles.indexOf('key: "', m.index! + 6);
      if (roles.slice(m.index!, next === -1 ? undefined : next).includes('"customs:validate"')) {
        holders.push(m[1]);
      }
    }
    expect(holders.sort()).toEqual(["CHIEF_OF_TRANSIT", "OPS_SUPERVISOR", "SYSTEM_ADMIN"]);
    expect(holders).not.toContain("CUSTOMS_DECLARANT");
  });

  it("no new permission was created", () => {
    expect(read(MIGRATION)).not.toMatch(/insert into public\.(permission|role_permission)/);
  });
});

// ===========================================================================
describe("maker-checker is enforced by the DATABASE", () => {
  it("the RPC refuses the preparer, using the table's real authorship field", () => {
    const m = read(MIGRATION_PG6);
    expect(m).toMatch(/v_creator = p_actor/);
    expect(m).toContain("the preparer of a customs record may not validate it");
    expect(code("lib/customs/actions.ts")).toContain("created_by: user.id");
  });

  it("PG-6 — it ALSO refuses the last EDITOR, closing PG-1's own hole", () => {
    // PG-1 could only see created_by, so a checker who edited someone else's
    // record could validate their own edit. Both halves now disqualify.
    const m = read(MIGRATION_PG6);
    expect(m).toMatch(/v_editor = p_actor/);
    expect(m).toContain("the last editor of a customs record may not validate it");
    expect(m).toMatch(/select tenant_id, file_id, created_by, updated_by, reviewed_at/);
    // The edit is attributed where it happens.
    expect(code("lib/customs/actions.ts")).toContain("updated_by: user.id");
    expect(actionBody()).toContain('"self_validation_editor"');
  });

  it("PG-6 strengthens PG-1 without weakening it — the contract survived", () => {
    const m = read(MIGRATION_PG6);
    expect(m).toMatch(/assert_actor_authority\(p_actor, v_tenant, 'customs:validate', 'SERVICE'\)/);
    expect(m).toMatch(/for update;/);
    expect(m).toContain("this customs record is already validated");
    // …and the migration proves all three of those itself.
    expect(m).toContain("the creator half of maker-checker was lost");
    expect(m).toContain("the actor-authority contract was lost");
  });

  it("PG-6 does not treat status, BAE or recevabilité as editorship", () => {
    // Only updateCustoms attributes an edit. Moving a dossier along is not
    // authorship of the information whose exactitude is certified.
    const s = code("lib/customs/actions.ts");
    expect((s.match(/updated_by: user\.id/g) ?? []).length).toBe(1);
    const upd = s.slice(s.indexOf("export async function updateCustoms"), s.indexOf("export async function changeCustomsStatus"));
    expect(upd).toContain("updated_by: user.id");
  });

  it("the server ALSO refuses early, so the operator gets a clear message", () => {
    const b = actionBody();
    expect(b).toMatch(/rec\.created_by === user\.id/);
    expect(b).toContain('"self_validation"');
    // …but the server check is not the boundary: the RPC repeats it.
    expect(read(MIGRATION)).toMatch(/v_creator is not null and v_creator = p_actor/);
  });

  it("the button is never the security boundary", () => {
    // The panel hides the action, and that is a courtesy, not a control.
    const p = code(PANEL);
    expect(p).toMatch(/canValidate && !record\.reviewedAt/);
    expect(code(PAGE)).toContain('canValidate={hasPermission(permissions, "customs:validate")}');
  });
});

// ===========================================================================
describe("the actor is verified, never believed", () => {
  it("the RPC carries the OPS-SEC-2A trust contract for customs:validate", () => {
    const m = read(MIGRATION);
    expect(m).toMatch(/assert_actor_authority\(p_actor, v_tenant, 'customs:validate', 'SERVICE'\)/);
    // Authority is established BEFORE the maker check and before the write.
    expect(m.indexOf("assert_actor_authority")).toBeLessThan(m.indexOf("v_creator = p_actor"));
    expect(m.indexOf("assert_actor_authority")).toBeLessThan(m.indexOf("update public.customs_record"));
  });

  it("INV-9: the fail-closed lane is never invoked in the function body", () => {
    const m = read(MIGRATION);
    const body = m.slice(m.indexOf("as $$", m.indexOf("record_customs_validation")));
    expect(body.slice(0, body.indexOf("$$;"))).not.toContain("SYSTEM");
  });

  it("the RPC is service_role only (OPS-SEC-1)", () => {
    const m = read(MIGRATION);
    for (const who of ["public", "anon", "authenticated"]) {
      expect(m, who).toContain(`revoke execute on function public.record_customs_validation(uuid, uuid) from ${who}`);
    }
    expect(m).toContain("grant  execute on function public.record_customs_validation(uuid, uuid) to service_role");
  });

  it("the tenant is derived from the record, never accepted from the caller", () => {
    const m = read(MIGRATION);
    expect(m).toMatch(/select tenant_id[\s\S]{0,120}into v_tenant/);
    expect(m).not.toMatch(/p_tenant\s+uuid/);
  });
});

// ===========================================================================
describe("one-time, and concurrency-safe", () => {
  it("the row is locked, so two simultaneous validators cannot both win", () => {
    expect(read(MIGRATION)).toMatch(/for update;/);
  });

  it("re-validation is refused rather than overwriting the first validator", () => {
    const m = read(MIGRATION);
    expect(m).toContain("this customs record is already validated");
    expect(m).toMatch(/if v_at is not null then/);
    expect(actionBody()).toContain('"already_validated"');
  });

  it("an instant always has an author — and legacy rows are not falsified", () => {
    const m = read(MIGRATION);
    expect(m).toContain("customs_review_complete");
    // ONE-SIDED on purpose. Production already held rows with reviewed_by and
    // no instant; the symmetric form failed to apply, and satisfying it would
    // have meant inventing a timestamp for a control decision.
    expect(m).toMatch(/check \(\s*reviewed_at is null or reviewed_by is not null\s*\)/);
    expect(m).toContain("would fabricate evidence about a");
    // No backfill was attempted.
    expect(m).not.toMatch(/update public\.customs_record\s+set reviewed_at = (now\(\)|updated_at)/);
  });
});

// ===========================================================================
describe("validation is a fact, not a verdict", () => {
  it("no customs status or lifecycle moves", () => {
    // Comments stripped: the honesty comment between the write and the emit
    // legitimately explains WHICH columns the WES-9 trigger watches, and names
    // status to do so.
    const m = code(MIGRATION);
    const upd = m.slice(m.indexOf("update public.customs_record"), m.indexOf("perform public.emit_business_event"));
    expect(upd).toContain("reviewed_by = p_actor");
    expect(upd).toContain("reviewed_at = now()");
    expect(upd).not.toMatch(/\bstatus\b|intel_status/);
    // No handoff, notification or process reconciliation is triggered.
    const b = actionBody();
    expect(b).not.toMatch(/reconcileDossierProcess|onCustomsReleased|custCustomsCleared|changeCustomsStatus/);
  });

  it("QC4 reports the validation as an observed FACT", () => {
    const e = deriveQC4({
      canReadCustoms: true, canReadDocuments: true,
      customs: customs({ reviewedAt: "2026-08-12T10:30:00.000Z", reviewedByEmail: "chef@effitrans.com" }),
      documents: [], missingRequiredCount: 0, timeZone: TZ,
    });
    const c = e.controls.find((x) => x.key === "informationAccuracy")!;
    expect(c.state).toBe("observed");
    expect(c.value).toContain("12/08/2026 10:30");
    expect(c.value).toContain("chef@effitrans.com");
  });

  it("…and NEVER as « conforme » — the business criterion is still open", () => {
    const e = deriveQC4({
      canReadCustoms: true, canReadDocuments: true,
      customs: customs({ reviewedAt: "2026-08-12T10:30:00.000Z" }),
      documents: [], missingRequiredCount: 0, timeZone: TZ,
    });
    const c = e.controls.find((x) => x.key === "informationAccuracy")!;
    expect(c.reason).toBe(QC4_VALIDATION_IS_NOT_A_VERDICT);
    expect(QC4_VALIDATION_IS_NOT_A_VERDICT).toMatch(/ne vaut pas conformité/);
    expect(code("lib/files/qc4.ts")).not.toMatch(/["'>]\s*(Non )?[Cc]onforme\s*["'<]/);
  });

  it("an unvalidated record still reads ABSENT, honestly", () => {
    const e = deriveQC4({
      canReadCustoms: true, canReadDocuments: true, customs: customs(),
      documents: [], missingRequiredCount: 0, timeZone: TZ,
    });
    const c = e.controls.find((x) => x.key === "informationAccuracy")!;
    expect(c.state).toBe("absent");
    expect(c.reason).toBe(QC4_NO_VALIDATION_RECORD);
  });

  it("without customs:read the validation is RESTRICTED, not absent", () => {
    const e = deriveQC4({
      canReadCustoms: false, canReadDocuments: true,
      customs: customs({ reviewedAt: "2026-08-12T10:30:00.000Z", reviewedByEmail: "chef@effitrans.com" }),
      documents: [], missingRequiredCount: 0, timeZone: TZ,
    });
    const c = e.controls.find((x) => x.key === "informationAccuracy")!;
    expect(c.state).toBe("restricted");
    expect(JSON.stringify(e)).not.toContain("chef@effitrans.com");
  });
});

// ===========================================================================
describe("audit, timeline and blast radius", () => {
  it("the event is registered once, as an rpc emission, and is internal", () => {
    const reg = read("lib/workflow/events/types.ts");
    expect((reg.match(/CUSTOMS_VALIDATED/g) ?? []).length).toBe(1);
    const entry = reg.slice(reg.indexOf('type: "CUSTOMS_VALIDATED"'));
    expect(entry.slice(0, 220)).toContain('emission: "rpc"');
    expect(entry.slice(0, 220)).toContain("clientSafe: false");
  });

  it("the RPC emits it in the same transaction as the write", () => {
    const m = read(MIGRATION);
    expect(m.indexOf("update public.customs_record")).toBeLessThan(m.indexOf("emit_business_event"));
    expect(m).toContain("'policy_rpc'");
  });

  it("no trigger was added, so no double emission is possible", () => {
    expect(read(MIGRATION)).not.toMatch(/create (or replace )?trigger/i);
  });

  it("only customs_record is altered, additively", () => {
    const m = read(MIGRATION).replace(/--.*$/gm, "");
    expect(new Set([...m.matchAll(/alter table public\.(\w+)/g)].map((x) => x[1]))).toEqual(new Set(["customs_record"]));
    expect(m).not.toMatch(/drop (table|column|constraint)/i);
    const added = [...m.matchAll(/add column if not exists (\w+)/g)].map((x) => x[1]);
    expect(added).toEqual(["reviewed_at"]);
  });

  it("both validation migrations are on disk and the ledger agrees", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    const bi = read("lib/platform/ops/build-info.ts");
    // DURABLE: compare against the DECLARED count, never a literal — a literal
    // asserts "no migration exists beyond this one" and any later phase
    // invalidates it. What stays true is that both of THESE exist and that the
    // declared count matches the files on disk.
    expect(migrations).toHaveLength(Number(/MIGRATION_COUNT = (\d+)/.exec(bi)![1]));
    expect(migrations).toContain("20260825000001_customs_validation_event.sql");
    expect(migrations).toContain("20260826000001_customs_editor_attribution.sql");
    // The LIVE function is the later one, since it replaces the earlier.
    expect(bi).toContain('LATEST_MIGRATION = "20260826000001_customs_editor_attribution"');
  });
});

// ===========================================================================
describe("scope lock — nothing else moved", () => {
  it("post-validation editing is NOT silently frozen", () => {
    // §M: the repository never defined post-review immutability, so PG-1 does
    // not invent it. updateCustoms still has no review guard, and that is
    // recorded as unresolved rather than changed.
    const s = code("lib/customs/actions.ts");
    const upd = s.slice(s.indexOf("export async function updateCustoms"), s.indexOf("export async function changeCustomsStatus"));
    expect(upd).not.toMatch(/reviewed_at|already_validated|frozen/);
  });

  it("QC1, QC2, QC3, QC5 and QC6 are untouched", () => {
    expect(code("lib/commercial/qc1.ts")).toContain("QC1_DEFERRED");
    expect(code("lib/files/qc2.ts")).toContain("QC2_TRANSMISSION_CONFLICT");
    expect(code("lib/files/qc5.ts")).toContain("QC5_NO_VEHICLE_CONFORMITY");
    expect(code("lib/files/qc6.ts")).toContain("QC6_NO_ARCHIVE_AUTHORITY");
    expect(code("lib/customs/receivability.ts")).toContain("RECEIVABILITY_OUTCOMES");
    // QC3's own trust contract still stands.
    expect(read("supabase/migrations/20260824000001_customs_receivability.sql"))
      .toMatch(/assert_actor_authority\(p_actor, v_tenant, 'customs:update', 'SERVICE'\)/);
  });

  it("QC4's OTHER business questions remain open", () => {
    const q4 = code("lib/files/qc4.ts");
    expect(q4).toContain("QC4_NO_CHECKLIST");
    expect(q4).toContain("QC4_NO_TRANSMISSION_FACT");
    // Thresholds are still unconfigured — PG-1 answered no business question.
    expect(read("lib/process/sla-policies.ts")).toMatch(/chief_transit_validation[\s\S]{0,120}unconfigured/);
  });

  it("no Q5, Sage, MAYA APPLY or client import", () => {
    for (const f of [MIGRATION, ACTIONS]) {
      const s = code(f);
      expect(s.toLowerCase(), f).not.toContain("groupage");
      expect(s, f).not.toMatch(/maya_import|ninea|\bsage\b/i);
    }
  });
});
