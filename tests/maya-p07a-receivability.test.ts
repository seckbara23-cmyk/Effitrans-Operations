/**
 * MAYA-P0.7-A — Recevabilité (Quality Control N°3, Déclarant en Douane).
 * ---------------------------------------------------------------------------
 * First-party evidence (the Effitrans « Manuel de Contrôle Qualité ») settled
 * what MAYA-0 Q2 could not: WHO owns recevabilité and WHERE it sits. It did NOT
 * settle the criteria. This suite defends that distinction above all else.
 *
 * Four properties:
 *
 *   1. THE CRITERIA ARE NOT INVENTED. No checklist, no required-document list,
 *      no rule decides the outcome. The declarant decides; the platform records.
 *   2. IT GATES NOTHING. No status, step, closure, handoff or document rule
 *      reads the decision. A NON_RECEVABLE dossier behaves exactly as before.
 *   3. ONE OWNER FOR THE FACT. Only the RPC emits the event; the WES-9 customs
 *      trigger does not watch these columns, so no double emission is possible.
 *   4. NO NEW AUTHORITY. `customs:update` — which the Déclarant already holds —
 *      and deliberately NOT `customs:validate`, the Chef de Transit's checker
 *      half, which must stay separate from the preparer's own work.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  RECEIVABILITY_OUTCOMES,
  RECEIVABILITY_LABELS_FR,
  isReceivabilityOutcome,
  reasonRequired,
  validateReceivability,
  isAssessed,
} from "@/lib/customs/receivability";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
/**
 * Source with comments stripped — block, line AND SQL `--`.
 *
 * The SQL strip matters: this migration's comments deliberately NAME the things
 * it refuses to build ("checklist", "criteria", "intel_status"), so a raw-text
 * assertion would fail on the very honesty it is checking for.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260824000001_customs_receivability.sql";
const PURE = "lib/customs/receivability.ts";
const ACTIONS = "lib/customs/actions.ts";
const PANEL = "components/customs/customs-panel.tsx";

function actionBody(): string {
  const s = code(ACTIONS);
  const start = s.indexOf("export async function recordReceivability");
  expect(start).toBeGreaterThan(-1);
  return s.slice(start, s.indexOf("export async function", start + 1));
}

// ===========================================================================
describe("the decision vocabulary comes from the Effitrans manual", () => {
  it("exactly three outcomes, in the manual's own words", () => {
    expect(RECEIVABILITY_OUTCOMES).toEqual(["RECEVABLE", "NON_RECEVABLE", "SOUS_RESERVE"]);
    expect(Object.keys(RECEIVABILITY_LABELS_FR).sort()).toEqual([...RECEIVABILITY_OUTCOMES].sort());
  });

  it("rejects anything outside that vocabulary", () => {
    for (const bad of ["RECEIVABLE", "ok", "", "recevable", null, undefined]) {
      expect(isReceivabilityOutcome(bad as string), String(bad)).toBe(false);
    }
    expect(validateReceivability({ outcome: "MAYBE", note: "x" }, null)).toEqual({
      ok: false, error: "invalid_outcome",
    });
  });
});

// ===========================================================================
describe("a reason is required for everything but a clean acceptance", () => {
  it("RECEVABLE needs no reason; the other two do", () => {
    expect(reasonRequired("RECEVABLE")).toBe(false);
    expect(reasonRequired("NON_RECEVABLE")).toBe(true);
    expect(reasonRequired("SOUS_RESERVE")).toBe(true);
  });

  it("a refusal without a stated reason is refused", () => {
    for (const o of ["NON_RECEVABLE", "SOUS_RESERVE"]) {
      expect(validateReceivability({ outcome: o, note: null }, null), o).toEqual({
        ok: false, error: "reason_required",
      });
      expect(validateReceivability({ outcome: o, note: "   " }, null), o).toEqual({
        ok: false, error: "reason_required",
      });
    }
  });

  it("a clean acceptance may carry a reason but need not", () => {
    expect(validateReceivability({ outcome: "RECEVABLE", note: null }, null)).toEqual({
      ok: true, decision: { outcome: "RECEVABLE", note: null },
    });
    expect(validateReceivability({ outcome: "RECEVABLE", note: " tout est là " }, null)).toEqual({
      ok: true, decision: { outcome: "RECEVABLE", note: "tout est là" },
    });
  });

  it("the database enforces the same rule, so no caller can route around it", () => {
    const m = read(MIGRATION);
    expect(m).toContain("customs_receivability_reason_required");
    expect(m).toMatch(/receivability_status = 'RECEVABLE'\s*\n\s*or coalesce\(btrim\(receivability_note\), ''\) <> ''/);
  });
});

// ===========================================================================
describe("re-deciding is allowed; repeating the identical decision is not", () => {
  it("a refused file can later become receivable", () => {
    const r = validateReceivability(
      { outcome: "RECEVABLE", note: null },
      { outcome: "NON_RECEVABLE", note: "facture manquante" },
    );
    expect(r.ok).toBe(true);
  });

  it("the same outcome with a NEW reason is a real change", () => {
    const r = validateReceivability(
      { outcome: "SOUS_RESERVE", note: "certificat à fournir" },
      { outcome: "SOUS_RESERVE", note: "facture manquante" },
    );
    expect(r.ok).toBe(true);
  });

  it("the identical outcome AND reason is refused, not silently repeated", () => {
    expect(
      validateReceivability(
        { outcome: "NON_RECEVABLE", note: "facture manquante" },
        { outcome: "NON_RECEVABLE", note: "facture manquante" },
      ),
    ).toEqual({ ok: false, error: "unchanged" });
    // …including for the no-reason outcome.
    expect(validateReceivability({ outcome: "RECEVABLE", note: null }, { outcome: "RECEVABLE", note: null }))
      .toEqual({ ok: false, error: "unchanged" });
  });

  it("the database refuses the identical repeat too", () => {
    expect(read(MIGRATION)).toContain("identical receivability decision already recorded");
  });
});

// ===========================================================================
describe("unassessed is a THIRD state, not a default", () => {
  it("null is neither receivable nor refused", () => {
    expect(isAssessed(null)).toBe(false);
    expect(isAssessed(undefined)).toBe(false);
    expect(isAssessed("RECEVABLE")).toBe(true);
    expect(isAssessed("NON_RECEVABLE")).toBe(true);
  });

  it("all four columns are nullable and move together", () => {
    const m = read(MIGRATION);
    expect(m).toContain("customs_receivability_complete");
    // The migration proves its own nullability rather than asserting it in prose.
    expect(m).toMatch(/receivability columns must all be nullable/);
    expect(m).not.toMatch(/receivability_status text not null/);
    expect(m).not.toMatch(/default 'RECEVABLE'/);
  });
});

// ===========================================================================
describe("the criteria are deliberately NOT invented", () => {
  it("no checklist, rule set or required-document list exists", () => {
    // The TS surfaces must not even mention the concept.
    for (const f of [PURE, ACTIONS, PANEL]) {
      expect(code(f), f).not.toMatch(/CRITERIA|checklist|requiredDocs|REQUIRED_FOR_RECEIVAB/i);
    }
    // The migration NAMES it — in the guard that proves no such structure was
    // built — so assert the CAPABILITY: it creates no table and no criteria
    // column, only the four decision columns on the existing record.
    const m = code(MIGRATION);
    expect(m).not.toMatch(/create table/i);
    const added = [...m.matchAll(/add column if not exists (\w+)/g)].map((x) => x[1]);
    expect(added.sort()).toEqual([
      "receivability_at", "receivability_by", "receivability_note", "receivability_status",
    ]);
  });

  it("no document code decides the outcome", () => {
    const s = code(PURE);
    // Assert the COUPLING is absent, not a letter sequence: "BL" lives inside
    // RECEVABLE, so a substring check would fail on the vocabulary itself.
    expect(s).not.toMatch(/from "@\/lib\/documents|documentType|typeCode|docCode/);
    expect(s).not.toContain("requiredCustomsDocCodes");
    expect(s).not.toMatch(/^import .*documents/m);
    expect(actionBody()).not.toContain("requiredCustomsDocCodes");
  });

  it("the migration refuses to create a criteria structure", () => {
    expect(read(MIGRATION)).toContain("no receivability criteria structure may exist yet");
  });
});

// ===========================================================================
describe("it gates nothing", () => {
  it("recevabilité is not a customs status or intelligence state", () => {
    const m = read(MIGRATION);
    expect(m).toMatch(/receivability must not enter the status ladder/);
    // The status CHECK was not rewritten by this migration.
    expect(m).not.toMatch(/status in \('NOT_STARTED'/);
    // The migration must not WRITE or constrain the lifecycle columns; naming
    // them in a comment to say so is exactly what it should do.
    expect(code(MIGRATION)).not.toMatch(/intel_status|status\s*=/);
  });

  it("no gate, lifecycle, closure or handoff module reads the decision", () => {
    for (const f of ["lib/customs/gates.ts", "lib/files/closure.ts", "lib/files/lifecycle.ts",
                     "lib/files/status.ts", "lib/handoffs/triggers.ts", "lib/process/applicability.ts",
                     "lib/workflow/projection.ts", "lib/customer-notify/triggers.ts"]) {
      expect(code(f), f).not.toMatch(/receivab|recevab/i);
    }
  });

  it("the action completes no step and fires no handoff", () => {
    const b = actionBody();
    expect(b).not.toMatch(/reconcileDossierProcess|onCustomsReleased|custCustomsCleared|changeCustomsStatus/);
  });

  it("the panel says so, so an operator is not misled about its effect", () => {
    expect(read("lib/i18n.ts")).toMatch(/ne conditionne aucune étape/);
  });
});

// ===========================================================================
describe("authorization and attribution", () => {
  it("uses customs:update — the permission the Déclarant already holds", () => {
    expect(actionBody()).toContain('assertPermission("customs:update")');
  });

  it("does NOT borrow customs:validate, the Chef de Transit's checker half", () => {
    const b = actionBody();
    expect(b).not.toContain("customs:validate");
    // Sanity: that permission still belongs to the supervisor role only.
    const roles = read("lib/platform/role-templates.ts");
    const declarant = roles.slice(roles.indexOf('key: "CUSTOMS_DECLARANT"'), roles.indexOf('key: "DOCUMENTATION_OFFICER"'));
    expect(declarant).toContain('"customs:update"');
    expect(declarant).not.toContain('"customs:validate"');
  });

  it("no new permission was created", () => {
    const perms = [...actionBody().matchAll(/assertPermission\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(perms).toEqual(["customs:update"]);
    // The catalog is untouched by this phase.
    expect(read(MIGRATION)).not.toMatch(/insert into public\.permission/);
    expect(read(MIGRATION)).not.toMatch(/insert into public\.role_permission/);
  });

  it("dossier visibility is enforced before anything is written", () => {
    const b = actionBody();
    const vis = b.indexOf("isFileVisible");
    expect(vis).toBeGreaterThan(-1);
    expect(vis).toBeLessThan(b.indexOf(".rpc("));
  });

  it("the RPC is service-role only — never anon or authenticated (OPS-SEC-1)", () => {
    const m = read(MIGRATION);
    for (const who of ["public", "anon", "authenticated"]) {
      expect(m, who).toContain(`revoke execute on function public.record_customs_receivability(uuid, text, text, uuid) from ${who}`);
    }
    expect(m).toContain("grant  execute on function public.record_customs_receivability(uuid, text, text, uuid) to service_role");
  });

  it("the decision records WHO and WHEN, from the server not the caller", () => {
    const m = read(MIGRATION);
    expect(m).toMatch(/receivability_at\s*= now\(\)/);
    expect(m).toMatch(/receivability_by\s*= p_actor/);
    expect(actionBody()).toContain("p_actor: user.id");
  });
});

// ===========================================================================
describe("one owner for the fact, and the reason text stays off the ledger", () => {
  it("the RPC emits the event, in the same transaction as the write", () => {
    const m = read(MIGRATION);
    const upd = m.indexOf("update public.customs_record");
    const emit = m.indexOf("emit_business_event");
    expect(upd).toBeGreaterThan(-1);
    expect(emit).toBeGreaterThan(upd);
    expect(m).toContain("CUSTOMS_RECEIVABILITY_DECIDED");
  });

  it("the WES-9 trigger cannot double-emit: it does not watch these columns", () => {
    // The trigger predates the columns and this migration does not touch it.
    expect(read(MIGRATION)).not.toMatch(/create (or replace )?trigger/i);
    expect(read(MIGRATION)).not.toMatch(/wes9|emit_customs_events/i);
  });

  it("the event is registered once, as an rpc emission", () => {
    const reg = read("lib/workflow/events/types.ts");
    expect((reg.match(/CUSTOMS_RECEIVABILITY_DECIDED/g) ?? []).length).toBe(1);
    expect(reg).toMatch(/CUSTOMS_RECEIVABILITY_DECIDED"[^}]*emission: "rpc"/);
  });

  it("the reason TEXT never enters the immutable ledger — only whether one exists", () => {
    const m = read(MIGRATION);
    const emitBlock = m.slice(m.indexOf("emit_business_event"), m.indexOf("return jsonb_build_object"));
    expect(emitBlock).toContain("'has_reason'");
    expect(emitBlock).not.toMatch(/'reason'|v_note\s*\)/);
    // …and the registry declares the same metadata contract.
    const reg = read("lib/workflow/events/types.ts");
    const entry = reg.slice(reg.indexOf('type: "CUSTOMS_RECEIVABILITY_DECIDED"'));
    expect(entry.slice(0, 300)).toContain('"has_reason"');
  });

  it("the event is internal — a refusal must not reach the customer portal", () => {
    const reg = read("lib/workflow/events/types.ts");
    const entry = reg.slice(reg.indexOf('type: "CUSTOMS_RECEIVABILITY_DECIDED"'));
    expect(entry.slice(0, 300)).toContain("clientSafe: false");
  });
});

// ===========================================================================
describe("migration discipline and blast radius", () => {
  it("migration 102 exists and the ledger constants match", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    expect(migrations).toHaveLength(102);
    const bi = read("lib/platform/ops/build-info.ts");
    expect(bi).toContain("MIGRATION_COUNT = 102");
    expect(bi).toContain('LATEST_MIGRATION = "20260824000001_customs_receivability"');
  });

  it("it is additive: no drop, no rename, no not-null on an existing column", () => {
    const m = read(MIGRATION).replace(/--.*$/gm, "");
    expect(m).not.toMatch(/drop (table|column|constraint)/i);
    expect(m).not.toMatch(/rename/i);
    expect(m).toMatch(/add column if not exists/);
  });

  it("only customs_record is altered", () => {
    const tables = [...read(MIGRATION).replace(/--.*$/gm, "").matchAll(/alter table public\.(\w+)/g)].map((x) => x[1]);
    expect(new Set(tables)).toEqual(new Set(["customs_record"]));
  });

  it("no Q5, groupage or related-dossier semantics were touched", () => {
    for (const f of [MIGRATION, PURE, ACTIONS]) {
      expect(code(f).toLowerCase(), f).not.toContain("groupage");
      expect(code(f), f).not.toMatch(/parent_file_id|dossiermere/i);
    }
  });

  it("no MAYA staging, APPLY or Sage coupling", () => {
    for (const f of [MIGRATION, PURE, ACTIONS]) {
      //  matters: /sage/ alone matches "message" and "usage".
      expect(code(f), f).not.toMatch(/maya_import|sage/i);
    }
  });

  it("P0.6-D carriage and P0.6-C search are untouched", () => {
    expect(code("lib/files/filter.ts")).not.toMatch(/receivab/i);
    expect(code("lib/files/service.ts")).not.toMatch(/receivab/i);
  });
});
