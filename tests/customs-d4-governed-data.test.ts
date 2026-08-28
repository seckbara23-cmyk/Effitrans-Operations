/**
 * D4 — governed capture, validation, correction and recertification.
 * ---------------------------------------------------------------------------
 * RATIFIED 2026-08-28: « Déclarant saisit → Chef de Transit valide → toute
 * correction après validation est tracée. »
 *
 * These are source-and-schema proofs; the behavioural half (an actual
 * correction against a real database, cross-tenant refusal, WORM enforcement)
 * lives in supabase/tests/customs_d4_correction_test.sql, which runs on real
 * Postgres in CI. Both are required: the SQL suite proves the RPCs behave, and
 * this suite proves the authority model around them cannot be quietly widened.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { TENANT_SCOPED_TABLES } from "@/lib/db/tenant-tables";
import { DECLARATION_TYPES } from "@/lib/performance/declaration-type";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "").replace(/^\s*\/\/.*$/gm, "");

const MIGRATION = "supabase/migrations/20260920000001_customs_governed_data.sql";
const m = read(MIGRATION);
const mCode = strip(m);
const actions = strip(read("lib/customs/actions.ts"));

const fn = (name: string) => {
  const i = actions.indexOf(`export async function ${name}`);
  expect(i, `${name} not found`).toBeGreaterThan(-1);
  const j = actions.indexOf("export async function", i + 1);
  return actions.slice(i, j === -1 ? actions.length : j);
};
const holders = (permission: string) =>
  TENANT_ROLE_TEMPLATES.filter((t) => t.permissions.includes(permission)).map((t) => t.key).sort();

// ============================================== the five data elements ====

describe("D4 — the five governed elements exist and carry the ratified vocabularies", () => {
  it("all five columns are added to customs_record", () => {
    for (const col of [
      "sh_position_count",
      "declaration_type",
      "dpi_regime",
      "exemption_title_origin",
      "tariff_classification_origin",
    ]) {
      expect(mCode, col).toContain(`add column if not exists ${col}`);
    }
  });

  it("declaration_type admits exactly the four D1 types — DPE cannot be stored", () => {
    expect(mCode).toContain("declaration_type in ('SIMPLE','APE','DEP','OG')");
    const check = mCode.slice(mCode.indexOf("declaration_type text"), mCode.indexOf("dpi_regime"));
    expect(check, "DPE must be unstorable, not merely discouraged").not.toContain("DPE");
    // …and the CHECK matches the application vocabulary exactly.
    for (const t of DECLARATION_TYPES) expect(check).toContain(`'${t}'`);
  });

  it("the other vocabularies match the frozen ICTD contracts", () => {
    expect(mCode).toContain("dpi_regime in ('SANS_DPI','CLIENT_EXPEDITION','CLIENT_GLOBALE','EFFITRANS')");
    expect(mCode).toContain("exemption_title_origin in ('SANS_OBJET','CLIENT','EFFITRANS')");
    expect(mCode).toContain("tariff_classification_origin in ('CLIENT','EFFITRANS')");
  });

  it("all five are nullable — a dossier that predates the capture says so", () => {
    // Each CHECK is written `x is null or x in (…)`: null is legal, and a
    // NOT NULL would have silently invented a value for every existing record.
    for (const col of ["declaration_type", "dpi_regime", "exemption_title_origin", "tariff_classification_origin"]) {
      expect(mCode, col).toContain(`${col} is null or`);
    }
    expect(mCode).toContain("sh_position_count is null or sh_position_count >= 0");
  });

  it("the Déclarant enters them on the ordinary step-gated path", () => {
    const update = fn("updateCustoms");
    expect(update).toContain('assertPermission("customs:update")');
    expect(update).toContain('assertControlStep("customs.update"');
    for (const col of ["sh_position_count", "declaration_type", "dpi_regime", "exemption_title_origin", "tariff_classification_origin"]) {
      expect(update, col).toContain(col);
    }
  });
});

// ================================================ the correction door ====

describe("D4 — validated data does not change on the ordinary path", () => {
  it("updateCustoms refuses a validated record and names the correction door", () => {
    expect(fn("updateCustoms")).toContain('if (rec.reviewed_at) return { ok: false, error: "validated_use_correction" };');
  });

  it("…and that refusal is its own statement, not a by-product of step sequencing", () => {
    // The control gate happens to refuse today because the owning step is
    // closed by validation time. That is sequencing, not a rule about
    // certified data, and it would evaporate if a step ever reopened.
    const update = fn("updateCustoms");
    expect(update.indexOf("validated_use_correction")).toBeGreaterThan(update.indexOf("assertControlStep"));
  });
});

describe("D4 — correction is authorized, reasoned, traced and de-certifying", () => {
  const correct = fn("correctCustoms");

  it("it is gated on the dedicated capability, not on customs:update", () => {
    expect(correct).toContain('assertPermission("customs:correct")');
    expect(correct).not.toContain('assertPermission("customs:update")');
  });

  it("a motif is obligatory in the action AND in the database", () => {
    expect(correct).toContain('if (!reason) return { ok: false, error: "reason_required" };');
    expect(mCode).toContain("a correction requires a reason");
    expect(mCode).toContain("reason              text not null check (length(btrim(reason)) > 0)");
  });

  it("it applies only to a validated record", () => {
    expect(correct).toContain('if (!rec.reviewed_at) return { ok: false, error: "not_validated" };');
    expect(mCode).toContain("only a validated customs record passes through the correction door");
  });

  it("old values are read by the database, never accepted from the caller", () => {
    // The RPC takes only the NEW values plus the motif. Nothing in its
    // signature could carry a claimed "before".
    const sig = mCode.slice(mCode.indexOf("function public.record_customs_correction"), mCode.indexOf("returns jsonb"));
    expect(sig).not.toMatch(/p_old|p_previous|p_before/);
    expect(mCode).toContain("for update");
    expect(mCode).toContain("v_changes := v_changes || jsonb_build_object('declaration_type'");
  });

  it("a correction that changes nothing is refused — history records changes, not saves", () => {
    expect(mCode).toContain("a correction must change something");
  });

  it("the correction CLEARS the certification: corrected data is not validated data", () => {
    const body = mCode.slice(mCode.indexOf("function public.record_customs_correction"));
    const upd = body.slice(body.indexOf("update public.customs_record"), body.indexOf("insert into public.customs_correction"));
    expect(upd).toContain("reviewed_by                  = null");
    expect(upd).toContain("reviewed_at                  = null");
    expect(upd, "and the corrector becomes the last editor").toContain("updated_by                   = p_actor");
  });

  it("old → new, actor and timestamp are all preserved, with the displaced certification", () => {
    expect(mCode).toContain("corrected_by        uuid not null references public.app_user (id)");
    expect(mCode).toContain("corrected_at        timestamptz not null default now()");
    expect(mCode).toContain("changes             jsonb not null");
    expect(mCode).toContain("validated_by_before uuid not null");
    expect(mCode).toContain("validated_at_before timestamptz not null");
  });

  it("the history is append-only — WORM enforced by trigger, with no write policy", () => {
    expect(mCode).toContain("create trigger customs_correction_worm");
    expect(mCode).toContain("before update or delete on public.customs_correction");
    expect(mCode).toContain("customs_correction is append-only");
    const policies = mCode.slice(mCode.indexOf("alter table public.customs_correction enable row level security"));
    expect(policies).toContain("for select to authenticated");
    expect(policies.slice(0, policies.indexOf("-- 3.") + 1)).not.toMatch(/for (insert|update|delete)/);
  });

  it("CUSTOMS_CORRECTED is emitted as a mandatory event", () => {
    expect(mCode).toContain("'CUSTOMS_CORRECTED'");
    expect(mCode).toContain("perform public.emit_business_event");
    // WES-9: emit_business_event raises, so a refused ledger aborts the write.
    const body = mCode.slice(mCode.indexOf("function public.record_customs_correction"));
    expect(body.indexOf("insert into public.customs_correction")).toBeLessThan(body.indexOf("'CUSTOMS_CORRECTED'"));
  });
});

// ================================================== recertification ====

describe("D4 — recertification after correction", () => {
  const reval = fn("revalidateCustoms");

  it("it is gated on customs:revalidate", () => {
    expect(reval).toContain('assertPermission("customs:revalidate")');
  });

  it("it opens only after a governed correction — never as a first certification", () => {
    expect(reval).toContain('if (!last) return { ok: false, error: "never_corrected" };');
    expect(mCode).toContain("this record was never corrected");
  });

  it("maker≠checker is person-level: the corrector may not certify their own correction", () => {
    expect(reval).toContain('if (last.corrected_by === user.id) return { ok: false, error: "self_revalidation" };');
    expect(mCode).toContain("the corrector may not revalidate their own correction");
  });

  it("an already-validated record cannot be revalidated", () => {
    expect(reval).toContain('if (rec.reviewed_at) return { ok: false, error: "already_validated" };');
    expect(mCode).toContain("this customs record is already validated");
  });

  it("and the ordinary validation RPC needed no change — the corrector is the last editor", () => {
    // Migration 104 already refuses `updated_by = p_actor`, and the correction
    // sets updated_by to the corrector. The two compose without a new rule.
    const m104 = strip(read("supabase/migrations/20260826000001_customs_editor_attribution.sql"));
    expect(m104).toContain("the last editor of a customs record may not validate it");
  });
});

// ======================================================== authority ====

describe("D4 — the authority model, and what it deliberately does not widen", () => {
  it("customs:correct is the Chef's (plus administrative continuity)", () => {
    expect(holders("customs:correct")).toEqual(["CHIEF_OF_TRANSIT", "SYSTEM_ADMIN"]);
  });

  it("customs:revalidate is the Chef's AND the Déclarant's, exactly as ratified", () => {
    expect(holders("customs:revalidate")).toEqual(["CHIEF_OF_TRANSIT", "CUSTOMS_DECLARANT", "SYSTEM_ADMIN"]);
  });

  it("PG-6 stands: the Déclarant still holds no customs:validate", () => {
    expect(holders("customs:validate")).not.toContain("CUSTOMS_DECLARANT");
    expect(mCode).toContain("CUSTOMS_DECLARANT must not hold customs:validate");
  });

  it("the Déclarant gained recertification and nothing else", () => {
    const declarant = TENANT_ROLE_TEMPLATES.find((t) => t.key === "CUSTOMS_DECLARANT")!;
    expect(declarant.permissions).toContain("customs:revalidate");
    expect(declarant.permissions).not.toContain("customs:correct");
    expect(declarant.permissions).not.toContain("customs:validate");
  });

  it("role templates and the migration grant the same holders — three sources agree", () => {
    // Grants must exist in the template AND in the migration, or a fresh tenant
    // and an existing one disagree about who may act.
    for (const [perm, roles] of [
      ["customs:correct", ["CHIEF_OF_TRANSIT", "SYSTEM_ADMIN"]],
      ["customs:revalidate", ["CHIEF_OF_TRANSIT", "CUSTOMS_DECLARANT", "SYSTEM_ADMIN"]],
    ] as const) {
      const block = m.slice(m.indexOf(`p.code = '${perm}'`));
      const where = block.slice(0, block.indexOf("on conflict"));
      for (const r of roles) expect(where, `${perm} → ${r}`).toContain(`'${r}'`);
      expect(holders(perm)).toEqual([...roles].sort());
    }
  });

  it("both RPCs verify the caller-declared actor (INV-7) and are never browser-executable", () => {
    expect(mCode).toContain("assert_actor_authority(p_actor, v_tenant, 'customs:correct', 'SERVICE')");
    expect(mCode).toContain("assert_actor_authority(p_actor, v_tenant, 'customs:revalidate', 'SERVICE')");
    for (const f of [
      "record_customs_correction(uuid, uuid, text, int, text, text, text, text)",
      "record_customs_revalidation(uuid, uuid)",
    ]) {
      for (const who of ["public", "anon", "authenticated"]) {
        expect(mCode, `${f} ← ${who}`).toContain(`revoke execute on function public.${f} from ${who}`);
      }
      expect(mCode).toContain(`grant  execute on function public.${f} to service_role`);
    }
  });

  it("the new table is registered as tenant-scoped — invisible to the guard otherwise", () => {
    expect(TENANT_SCOPED_TABLES.has("customs_correction")).toBe(true);
    expect(TENANT_SCOPED_TABLES.has("hr_calendar_day")).toBe(true);
  });

  it("every read path is tenant-filtered", () => {
    expect(mCode).toContain("tenant_id = public.auth_tenant_id() and public.has_permission('customs:read')");
    expect(fn("revalidateCustoms")).toContain('.eq("tenant_id", user.tenantId)');
  });
});
