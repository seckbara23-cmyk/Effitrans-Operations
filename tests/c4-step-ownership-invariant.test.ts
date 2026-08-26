/**
 * C-4 — a step's OWNER must be able to perform it.
 * ---------------------------------------------------------------------------
 * This program has now met the same defect twice. Step 1 (Cotation) required
 * evidence its owning role could not read; step 16 (« suivre la livraison »)
 * required a permission its owning role did not hold. In both cases the step
 * appeared in the owner's queue — F-1 visibility is derived from ownership —
 * and refused them when they acted on it. Neither deadlocked, because a
 * supervisor holding file:read:all could always step in, which is precisely why
 * both survived: the workflow kept moving on hidden intervention.
 *
 * So this stops being a finding and becomes an invariant.
 *
 * BOTH SIDES ARE GENERATED, never transcribed. The owning role comes from
 * `process_step_owning_role` (migration 122) — the table that actually decides
 * whose queue a step lands in, so it is the one whose disagreement with the
 * permission matrix causes the defect. The execution permission comes from the
 * registry's `permissions[0]`, which is what `stepPermission()` returns and
 * what `guard()` asserts. The grants come from role-templates.ts, whose parity
 * with seed.sql is asserted by tests/role-templates.test.ts.
 *
 * A handwritten matrix would have to be updated by the same change that breaks
 * the invariant, which is the one thing it must not depend on.
 *
 * NOT the registry's own `role` field. That field carries descriptive labels —
 * COTATION_OFFICER, OPERATIONS_MANAGER, CHIEF_TRANSIT — which are not role
 * codes and match nothing in the permission model. It is documentation, like
 * `implementation`, and treating it as authority would produce five false
 * mismatches and hide the real one.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getNode, ALL_NODE_KEYS } from "@/lib/process/engine/state";
import { getTenantRoleTemplate } from "@/lib/platform/role-templates";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const OWNING_ROLE_MIGRATION = "supabase/migrations/20260914000001_responsibility_visibility.sql";

/** (step_key, role_code) exactly as the visibility model reads them. */
function owningRoles(): { stepKey: string; roleCode: string }[] {
  const sql = read(OWNING_ROLE_MIGRATION);
  const start = sql.indexOf("insert into public.process_step_owning_role");
  expect(start, "the owning-role seed must exist").toBeGreaterThan(-1);
  const block = sql.slice(start, sql.indexOf(";", start));
  return [...block.matchAll(/\('([a-z_]+)',\s*'([A-Z_]+)'/g)].map((m) => ({
    stepKey: m[1],
    roleCode: m[2],
  }));
}

type Row = {
  stepKey: string;
  owningRole: string;
  executionPermission: string | null;
  roleHoldsIt: boolean;
};

function auditOwnership(): Row[] {
  return owningRoles().map(({ stepKey, roleCode }) => {
    const executionPermission = getNode(stepKey)?.permissions?.[0] ?? null;
    const tpl = getTenantRoleTemplate(roleCode);
    return {
      stepKey,
      owningRole: roleCode,
      executionPermission,
      roleHoldsIt: Boolean(executionPermission && tpl?.permissions.includes(executionPermission)),
    };
  });
}

describe("C-4 — every step's owning role can execute it", () => {
  const rows = auditOwnership();

  it("the mapping is real and complete, so this test cannot pass by finding nothing", () => {
    // A regex that silently matched zero rows would make every assertion below
    // vacuously true. The 26 official steps each have exactly one owner.
    expect(rows.length).toBe(26);
    for (const r of rows) {
      expect(ALL_NODE_KEYS, `${r.stepKey} is not a registry node`).toContain(r.stepKey);
      expect(getTenantRoleTemplate(r.owningRole), `${r.owningRole} is not a real role`).toBeDefined();
      expect(r.executionPermission, `${r.stepKey} declares no permission`).toBeTruthy();
    }
  });

  it("NO owning role is shown work it would be refused", () => {
    const mismatches = rows.filter((r) => !r.roleHoldsIt);
    // The message is the point: it names the step, the owner, the permission
    // and the verdict, so a future failure is actionable without investigation.
    const detail = mismatches
      .map((m) => `  ${m.stepKey}: owner ${m.owningRole} does NOT hold ${m.executionPermission}`)
      .join("\n");
    expect(
      mismatches,
      mismatches.length
        ? `\n${mismatches.length} step(s) whose owner cannot perform them:\n${detail}\n\n` +
            "Grant the permission to the owning role in ALL THREE sources " +
            "(role-templates.ts, seed.sql, a forward migration) — or, if the " +
            "step genuinely belongs to another role, change the OWNER after " +
            "business ratification. Do NOT reorder permissions[] to change " +
            "which permission gates the step: that silently changes the gate " +
            "for every role, to make one case pass."
        : "",
    ).toEqual([]);
  });

  it("step 16 specifically — the case that produced this invariant", () => {
    const s16 = rows.find((r) => r.stepKey === "am_delivery_followup");
    expect(s16).toBeDefined();
    expect(s16!.owningRole).toBe("ACCOUNT_MANAGER");
    // The gate is now the step's OWN act. It was transport:complete, which
    // conflated the Account Manager's follow-up with Transport's status change
    // and locked the owner out of its own step.
    expect(s16!.executionPermission).toBe("process:delivery:followup");
    expect(s16!.roleHoldsIt).toBe(true);
  });

  it("step 1 specifically — the earlier case, still closed", () => {
    const s1 = rows.find((r) => r.stepKey === "cotation");
    expect(s1!.owningRole).toBe("QUOTATION_MANAGER");
    expect(s1!.roleHoldsIt).toBe(true);
    // Its evidence half is asserted in tests/c4-evidence-authority.ts; being
    // able to START a step and being able to CLOSE it are different questions.
    expect(getTenantRoleTemplate("QUOTATION_MANAGER")!.permissions).toContain("document:read");
  });
});

describe("C-4 — the step-16 capability, in all three authoritative sources", () => {
  const MIGRATION = "supabase/migrations/20260917000001_delivery_followup_capability.sql";
  const CAPABILITY = "process:delivery:followup";

  /** The roles that legitimately perform step 16 — not "whoever held the old gate". */
  const HOLDERS = ["ACCOUNT_MANAGER", "OPS_SUPERVISOR", "SYSTEM_ADMIN"];

  it("role-templates.ts (provisioning) grants it to exactly the ratified roles", () => {
    for (const role of HOLDERS) {
      expect(getTenantRoleTemplate(role)!.permissions, role).toContain(CAPABILITY);
    }
    // TRANSPORT_OFFICER holds transport:complete but does NOT own step 16.
    // Copying the old gate's holders across is the reasoning that produced the
    // defect, so its absence is asserted rather than left to chance.
    expect(getTenantRoleTemplate("TRANSPORT_OFFICER")!.permissions).not.toContain(CAPABILITY);
  });

  it("seed.sql (fresh database) catalogues AND grants it", () => {
    const seed = read("supabase/seed.sql");
    // An uncataloged permission grants nothing and fails silently — the
    // transport:manage lesson. The catalog row is as required as the grant.
    expect(seed).toContain(`('${CAPABILITY}', 'process'`);
    const blocks = seed.match(/insert into public\.role_permission[\s\S]*?on conflict do nothing;/g) ?? [];
    const granted = blocks.some((b) => b.includes(`'${CAPABILITY}'`) && b.includes("ACCOUNT_MANAGER"));
    expect(granted, "no seed block grants the capability to ACCOUNT_MANAGER").toBe(true);
  });

  it("migration 125 (existing tenants) catalogues, grants and verifies itself", () => {
    const m = read(MIGRATION);
    expect(m).toContain("insert into public.permission");
    expect(m).toContain(CAPABILITY);
    for (const role of HOLDERS) expect(m, role).toContain(role);
    expect(m).toMatch(/raise exception 'M125/);
  });

  it("the capability is NARROW — it is a workflow act, not a Transport one", () => {
    // The whole reason this exists instead of granting transport:complete.
    const am = getTenantRoleTemplate("ACCOUNT_MANAGER")!.permissions;
    for (const forbidden of [
      "transport:complete", "transport:assign", "transport:create",
      "transport:manage", "transport:delete",
    ]) {
      expect(am, `ACCOUNT_MANAGER must not hold ${forbidden} — TMS-4`).not.toContain(forbidden);
    }
    // …and the database defends the same boundary.
    expect(read(MIGRATION)).toContain("TMS-4 forbids this");
  });

  it("TMS-4's boundary is re-proved here, not merely left alone", () => {
    // If someone later grants transport:complete to ACCOUNT_MANAGER to "simplify"
    // step 16, TMS-4 fails — and so does this, next to the reason why.
    const tms4 = read("tests/tms-4-transport-request.test.ts");
    expect(tms4).toContain("the ACCOUNT_MANAGER still holds NO execution authority");
    expect(tms4).toContain('"transport:complete"');
  });

  it("the owner was NOT changed to satisfy the invariant", () => {
    // The cheap way to make the invariant pass is to reassign the step to a role
    // that already holds the permission. That would contradict the registry's
    // label, department and description, and is refused here.
    const sql = read(OWNING_ROLE_MIGRATION);
    expect(sql).toContain("('am_delivery_followup', 'ACCOUNT_MANAGER'");
    const node = getNode("am_delivery_followup") as { department?: string; labelFr?: string };
    expect(node.department).toBe("account_management");
    expect(node.labelFr).toContain("Account Manager");
  });

  it("the gate was NOT quietly weakened to communication:send", () => {
    // The other cheap fix: reorder permissions[] so the permission the role
    // already holds becomes the gate. That silently changes the gate for every
    // role, to make one case pass.
    const node = getNode("am_delivery_followup")!;
    expect(node.permissions[0]).toBe(CAPABILITY);
    expect(node.permissions).toContain("communication:send");
  });
});

/**
 * C-4 — the RECEPTION twin of the ownership invariant.
 * ---------------------------------------------------------------------------
 * Ownership answers "can the actor EXECUTE its step". Reception answers "can the
 * actor ACCEPT work routed to it". They are different tables, different
 * permissions and different failure modes, so they are separate invariants —
 * the ownership sweep was green while Recouvrement could not accept the handoff
 * the platform routed to it.
 */
describe("C-4 — every routed receiver can actually receive", () => {
  const RECEIVING_MIGRATION = "supabase/migrations/20260913000001_handoff_receiver_visibility.sql";

  /** (step_key, role_code) exactly as the routing model registers them. */
  function receivingRoles(): { stepKey: string; roleCode: string }[] {
    const sql = read(RECEIVING_MIGRATION);
    const start = sql.indexOf("insert into public.process_step_receiving_role");
    expect(start, "the receiving-role seed must exist").toBeGreaterThan(-1);
    const block = sql.slice(start, sql.indexOf(";", start));
    return [...block.matchAll(/\('([a-z_]+)',\s*'([A-Z_]+)'/g)].map((m) => ({
      stepKey: m[1],
      roleCode: m[2],
    }));
  }

  const rows = receivingRoles();

  it("the routing table is real and non-empty, so this cannot pass by finding nothing", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(getTenantRoleTemplate(r.roleCode), `${r.roleCode} is not a real role`).toBeDefined();
    }
  });

  it("EVERY registered receiver holds process:handoff:receive", () => {
    const missing = rows.filter(
      (r) => !getTenantRoleTemplate(r.roleCode)!.permissions.includes("process:handoff:receive"),
    );
    const detail = missing.map((m) => `  ${m.stepKey}: ${m.roleCode} cannot receive`).join("\n");
    expect(
      missing,
      missing.length
        ? `\n${missing.length} routed receiver(s) that cannot accept their own work:\n${detail}\n\n` +
            "Grant process:handoff:receive in ALL THREE sources — or, if the role " +
            "is not really the receiver, change the ROUTING after ratification. " +
            "Do NOT relax receiveHandoff: eligibility is what keeps the grant narrow."
        : "",
    ).toEqual([]);
  });

  it("collections specifically — the case that produced this invariant", () => {
    for (const role of ["COLLECTIONS_OFFICER", "FINANCE_OFFICER"] as const) {
      expect(rows.some((r) => r.stepKey === "collections" && r.roleCode === role), role).toBe(true);
      expect(getTenantRoleTemplate(role)!.permissions, role).toContain("process:handoff:receive");
    }
  });

  it("THE INVERSE — holding the permission does NOT make a role eligible", () => {
    // The half that keeps the grant narrow. Eligibility comes from routing; the
    // permission only says the actor may receive SOMETHING.
    const engine = read("lib/process/engine/actions.ts");
    expect(engine).toContain('if (!isRoutedReceiver(c, h.toStepKey)) return fail("not_eligible_receiver");');
    expect(engine).toContain("function isRoutedReceiver(ctx: Ctx, toStepKey: string): boolean");
    // …resolved from the REGISTRY, not from the projection that calls itself
    // "never a source of mutation authority".
    expect(engine).toContain("QUEUES.find((q) => q.key === department)");
    // CODE ONLY: the doc comment legitimately NAMES the projection table to
    // explain why it is not read, and a whole-file check fails on that prose.
    const engineCode = engine.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(engineCode).not.toContain("process_step_receiving_role");
    // …and rejecting is guarded too: refusing work routed elsewhere is equally
    // not yours to do.
    expect((engine.match(/isRoutedReceiver\(c, h\.toStepKey\)/g) ?? []).length).toBe(2);
  });

  it("the grant lives in all three authoritative sources", () => {
    const seed = read("supabase/seed.sql");
    const blocks = seed.match(/insert into public\.role_permission[\s\S]*?on conflict do nothing;/g) ?? [];
    const granted = blocks.some(
      (b) => b.includes("'process:handoff:receive'") && b.includes("COLLECTIONS_OFFICER") && b.includes("FINANCE_OFFICER"),
    );
    expect(granted, "seed.sql must grant it to both roles").toBe(true);

    const m = read("supabase/migrations/20260918000001_collections_handoff_reception.sql");
    expect(m).toContain("'process:handoff:receive'");
    expect(m).toContain("COLLECTIONS_OFFICER");
    expect(m).toContain("FINANCE_OFFICER");
    expect(m).toMatch(/raise exception 'M126/);
  });
});
