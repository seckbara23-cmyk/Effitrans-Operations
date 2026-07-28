/**
 * Production blocker — cross-user canonical dossier state.
 *
 * A Finance user without `customs:read` was shown « Préparation douane » as the
 * next action on a dossier that was delivered, invoiced and paid, because the
 * workflow input was assembled from permission-gated reads: `customs: null` is
 * indistinguishable, to the projection, from "customs never started".
 *
 * ABSENCE OF PERMISSION MUST NEVER READ AS ABSENCE OF PROGRESS.
 *
 * These tests prove it two ways: behaviourally (the same facts produce the same
 * state, and a gated fact produces a DIFFERENT one — which is the bug), and
 * structurally (no surface may assemble workflow inputs from gated reads).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getDossierLifecycle } from "@/lib/files/lifecycle";
import { buildCanonicalProjection } from "@/lib/workflow/projection";
import { canonicalWorkflowInput, type CanonicalWorkflowInput } from "@/lib/workflow/canonical-input";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The UAT dossier: delivered, POD verified, invoiced, paid. */
const COMPLETE_FACTS = {
  fileId: "eft-imp-2026-00003",
  file: { status: "DELIVERED", type: "IMP" },
  documents: [{ status: "VERIFIED" }],
  missingRequired: [],
  customs: { status: "RELEASED", required: true },
  transport: { status: "POD_RECEIVED" },
  invoices: [{ status: "PAID", balance: 0 }],
  podApproved: true,
};
const canonical = (over: Record<string, unknown> = {}): CanonicalWorkflowInput =>
  canonicalWorkflowInput({ ...COMPLETE_FACTS, ...over } as never);

/** What a viewer sees. Identical for every authorized role, by requirement. */
const observed = (input: CanonicalWorkflowInput) => {
  const lc = getDossierLifecycle(input);
  const pr = buildCanonicalProjection(input);
  return {
    stage: lc.currentStep,
    nextAction: lc.nextAction?.reasonCode ?? null,
    department: pr.responsibleDepartment,
    progress: pr.progressPercent,
    blocked: pr.blocked,
  };
};

// The six representative roles. Every one resolves the SAME canonical facts —
// which is precisely the point: the resolver takes no viewer.
const ROLES = ["SYSTEM_ADMIN", "OPS_SUPERVISOR", "CHIEF_OF_TRANSIT", "TRANSPORT_OFFICER", "FINANCE_OFFICER", "CEO"] as const;

// ---------------------------------------------------------------------------
describe("identical canonical state for every role", () => {
  it("all six roles observe the same stage, next action and department", () => {
    const results = ROLES.map(() => observed(canonical()));
    const first = JSON.stringify(results[0]);
    for (let i = 1; i < results.length; i++) {
      expect(JSON.stringify(results[i]), ROLES[i]).toBe(first);
    }
  });

  it.each([
    ["customs completed", { customs: { status: "RELEASED", required: true } }],
    ["transport delivered", { transport: { status: "DELIVERED" }, podApproved: false }],
    ["invoice issued", { invoices: [{ status: "ISSUED", balance: 750_000 }] }],
    ["payment registered", { invoices: [{ status: "PARTIALLY_PAID", balance: 100 }] }],
    ["payment verified", { invoices: [{ status: "PAID", balance: 0 }] }],
    ["dossier closed", { file: { status: "CLOSED", type: "IMP" } }],
  ])("after %s, every role still observes the same state", (_label, over) => {
    const results = ROLES.map(() => observed(canonical(over as Record<string, unknown>)));
    const first = JSON.stringify(results[0]);
    for (const r of results) expect(JSON.stringify(r)).toBe(first);
  });
});

// ---------------------------------------------------------------------------
describe("the defect itself, pinned", () => {
  it("a GATED customs read produces a DIFFERENT state — this is the bug", () => {
    const complete = observed(canonical());
    // What a Finance user without customs:read used to send in.
    const gated = observed(canonical({ customs: null }));
    expect(gated).not.toEqual(complete);
    // …and specifically: it reports customs as outstanding work.
    expect(gated.stage).toContain("customs");
    expect(complete.stage).not.toContain("customs");
  });

  it("a GATED transport read hides delivery", () => {
    expect(observed(canonical({ transport: null })).stage).not.toBe(observed(canonical()).stage);
  });

  it("a GATED finance read hides invoicing and payment", () => {
    expect(observed(canonical({ invoices: [] })).stage).not.toBe(observed(canonical()).stage);
  });

  it("the complete facts put a delivered, paid dossier past customs", () => {
    const s = observed(canonical());
    expect(s.stage).not.toBe("customs_preparation");
    expect(s.nextAction).not.toBe("declare");
  });
});

// ---------------------------------------------------------------------------
describe("the resolver cannot become viewer-dependent", () => {
  const src = () => code("lib/workflow/dossier-state.ts");

  it("takes no user and reads no session", () => {
    const s = src();
    expect(s).not.toContain("getCurrentUser");
    expect(s).not.toContain("userId");
    expect(s).toMatch(/async \(fileId: string, tenantId: string\)/);
  });

  it("consults NO permission helper", () => {
    const s = src();
    expect(s).not.toContain("hasPermission");
    expect(s).not.toContain("getEffectivePermissions");
    expect(s).not.toMatch(/canRead[A-Z]/);
  });

  it("reads on the admin client so the answer is complete", () => {
    expect(src()).toContain("getAdminSupabaseClient");
  });

  it("is request-memoized", () => {
    expect(src()).toMatch(/cache\(\s*\n?\s*async \(fileId/);
  });
});

// ---------------------------------------------------------------------------
describe("no surface may assemble workflow inputs from gated reads", () => {
  it("the dossier page consumes the resolver, not its own assembly", () => {
    const page = code("app/files/[id]/page.tsx");
    expect(page).toContain("getCanonicalDossierState(file.id, user.tenantId)");
    // the permission-gated lifecycleInput is gone
    expect(page).not.toMatch(/const lifecycleInput = \{/);
    expect(page).not.toContain("buildCanonicalProjection(");
  });

  it("the copilot consumes the resolver too", () => {
    expect(code("lib/copilot/context.ts")).toContain("getCanonicalDossierState");
  });

  it("no canonicalWorkflowInput block is assembled from gated reads", () => {
    // Scoped to the WORKFLOW input on purpose. Permission-based redaction
    // elsewhere is correct and expected — the risk panel, for instance,
    // legitimately omits customs detail from a user who may not see it. The
    // defect was gated reads reaching the workflow CALCULATION.
    for (const f of [
      "lib/workflow/access/service.ts",
      "lib/workflow/access/queue.ts",
      "lib/control-tower/service.ts",
      "lib/portal/shipments.ts",
      "lib/portal/tracking.ts",
      "lib/workflow/dossier-state.ts",
    ]) {
      const s = code(f);
      let i = s.indexOf("canonicalWorkflowInput(");
      while (i !== -1) {
        // the assembled object literal, bounded generously
        const block = s.slice(i, i + 1200);
        expect(block, `${f} @${i}`).not.toMatch(/canRead\w*\s*\?/);
        expect(block, `${f} @${i}`).not.toMatch(/access\.\w+\s*\?/);
        expect(block, `${f} @${i}`).not.toMatch(/hasPermission\([^)]*\)\s*\?/);
        i = s.indexOf("canonicalWorkflowInput(", i + 1);
      }
    }
  });

  it("the dossier page mints no workflow input of its own", () => {
    // It consumes the resolver; there is nothing left for it to assemble.
    expect(code("app/files/[id]/page.tsx")).not.toContain("canonicalWorkflowInput(");
  });

  it("the brand makes ad-hoc assembly a compile error, not a review question", () => {
    const b = code("lib/workflow/canonical-input.ts");
    expect(b).toContain("declare const CANONICAL_BRAND: unique symbol");
    expect(code("lib/workflow/projection.ts")).toContain("input: CanonicalWorkflowInput");
    expect(code("lib/files/lifecycle.ts")).toContain("input: CanonicalWorkflowInput");
  });
});

// ---------------------------------------------------------------------------
describe("RBAC still governs presentation", () => {
  it("the dossier page keeps its permission flags for panels and actions", () => {
    const page = code("app/files/[id]/page.tsx");
    for (const flag of ["canReadCustoms", "canReadTransport", "canReadFinance", "canReadDocs"]) {
      expect(page, flag).toContain(flag);
    }
    // …used to gate RENDERING, not the state
    expect(page).toMatch(/\{canReadCustoms && \(/);
    expect(page).toMatch(/\{canReadTransport && \(/);
  });

  it("the copilot still redacts detail by permission", () => {
    const s = code("lib/copilot/context.ts");
    expect(s).toContain("access.customs");
    expect(s).toContain("access.finance");
  });
});
