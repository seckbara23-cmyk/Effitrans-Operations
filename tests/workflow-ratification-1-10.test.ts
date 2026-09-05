/**
 * WORKFLOW RATIFICATION — Operations → Account Manager → Transit (H-1..H-10).
 * ---------------------------------------------------------------------------
 * Ratified 2026-09-03 on docs/process/workflow-semantic-audit-steps-1-10.md.
 * The principle: ALLOW THE WORK, CONTROL THE HANDOFF.
 *
 *   H-1  the opening act completes step 2 — the Account Manager starts at once
 *   H-2  readiness for Transit is unchanged in shape and lighter in content
 *   H-3  SPENDING_AUTHORIZATION is corporate Finance's, not an AM opening gate
 *   H-4  VENDOR_INVOICE is not a universal precondition for Transit
 *   H-5  TRANSPORT_REQUEST is conditional on the dossier needing transport
 *   H-6  BORDEREAU_LIVRAISON stays hard where it controls something: pickup
 *   H-7  cotation is Operations', not Transit's
 *   H-8  T5 validates the customs dossier, never a devis
 *   H-9  the Operations Supervisor maintains the dossier (file:update)
 *   H-10 every dossier edit records what changed, from what, to what
 *
 * What this file exists to stop: a later change quietly turning leniency into
 * weakness. Every control that must stay hard is asserted here alongside every
 * rule that was deliberately relaxed, so the two can never be confused.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getStep, getActivity } from "@/lib/process/effitrans-process";
import { FACT_RULES, FACT_PROVABLE_STEP_KEYS } from "@/lib/process/reconcile/satisfaction";
import { DECLARABLE_EVIDENCE_KEYS, NON_DECLARABLE_EVIDENCE_KEYS } from "@/lib/process/evidence-absence";
import { ROLE_CANONICAL_DEPARTMENT, QUEUE_DEPARTMENT_TO_CANONICAL } from "@/lib/organization/departments";
import { TRANSIT_STAGES } from "@/lib/process/transit";
import { TRANSIT_SOURCE_MAP } from "@/lib/process/lifecycle-map";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const intakeActions = strip(read("lib/process/engine/intake-actions.ts"));
const engineActions = strip(read("lib/process/engine/actions.ts"));
const evidence = strip(read("lib/process/engine/evidence.ts"));
const filesActions = strip(read("lib/files/actions.ts"));
const seed = read("supabase/seed.sql");
const migration = read("supabase/migrations/20260929000001_ops_supervisor_file_update.sql");

const perms = (role: string) =>
  TENANT_ROLE_TEMPLATES.find((r) => r.key === role)!.permissions as readonly string[];

const fnSlice = (src: string, name: string) => {
  const i = src.indexOf(`export async function ${name}`);
  const rest = src.slice(i);
  const j = rest.indexOf("\nexport ", 1);
  return j > 0 ? rest.slice(0, j) : rest;
};

// ═══════════ A. opening and assignment ═════════════════════════════════════

describe("H-1 — the opening act is the intake act", () => {
  it("openDossierWorkflow completes step 2 itself, and says why", () => {
    expect(intakeActions).toContain("await completeIntakeFromOpening(ctx, fileId);");
    expect(read("lib/process/engine/intake-actions.ts")).toContain("THE INTAKE FACT");
  });

  it("the completion is narrow by construction — one step, one state, one path", () => {
    const helper = intakeActions.slice(intakeActions.indexOf("async function completeIntakeFromOpening"));
    const body = helper.slice(0, helper.indexOf("\nexport "));
    // Only this step key, and only out of ACTIVE.
    expect(body).toContain('e.stepKey === "operations_intake"');
    expect(body).toContain('exec.state !== "ACTIVE"');
    expect(body).toContain('.eq("state", "ACTIVE")');
    // Never any other step.
    for (const other of ["am_dossier_opening", "coordinator_reception", "cotation"]) {
      expect(body, other).not.toContain(other);
    }
    // Attributed to a real principal — never a fabricated or null actor.
    expect(body).toContain("actorId: ctx.userId");
    expect(body).not.toMatch(/actorId:\s*null/);
    // Not exported: it cannot become a general "complete anything" helper.
    expect(intakeActions).not.toContain("export async function completeIntakeFromOpening");
  });

  it("step 3 opens through the ORDINARY promotion path, not a special case", () => {
    const helper = intakeActions.slice(intakeActions.indexOf("async function completeIntakeFromOpening"));
    expect(helper.slice(0, helper.indexOf("\nexport "))).toContain("promoteSuccessors(");
    // The ladder relation is untouched: step 3 still declares step 2.
    expect(getStep("am_dossier_opening")!.prerequisites).toEqual(["operations_intake"]);
    expect(getStep("coordinator_reception")!.prerequisites).toEqual(["am_dossier_opening"]);
  });

  it("a failure to complete leaves the dossier exactly as before — never worse", () => {
    const helper = intakeActions.slice(intakeActions.indexOf("async function completeIntakeFromOpening"));
    const body = helper.slice(0, helper.indexOf("\nexport "));
    // Every early exit is a plain `return`, never a thrown error that would
    // abort an opening that has already committed.
    expect(body).toContain("if (!exec || exec.state !== \"ACTIVE\") return;");
    expect(body).toContain('if ((data?.length ?? 0) !== 1) return;');
    expect(body).not.toContain("throw ");
  });

  it("no unauthorized actor gains anything: opening keeps its own two permissions", () => {
    const open = fnSlice(intakeActions, "openDossierWorkflow");
    expect(open).toContain('intakeGuard("process:manage"');
    expect(read("app/files/[id]/process/page.tsx")).toContain('hasPermission(permissions, "process:owner:assign")');
  });
});

// ═══════════ B. step 3's evidence ══════════════════════════════════════════

describe("H-3..H-6 — the four documents are no longer a universal gate", () => {
  it("step 3 requires no document at all", () => {
    expect(getStep("am_dossier_opening")!.requiredDocuments).toEqual([]);
  });

  it.each(["SPENDING_AUTHORIZATION", "VENDOR_INVOICE", "TRANSPORT_REQUEST", "BORDEREAU_LIVRAISON"])(
    "%s is not a universal requirement anywhere in steps 1-10",
    (key) => {
      const stepsOneToTen = [
        "cotation", "operations_intake", "am_dossier_opening", "coordinator_reception",
        "transit_declarant_assignment", "customs_preparation", "transit_validation",
        "coordinator_to_finance", "gainde_registration", "coordinator_to_declarant",
      ];
      for (const k of stepsOneToTen) {
        expect(getStep(k)!.requiredDocuments, `${k} must not require ${key}`).not.toContain(key);
      }
    },
  );

  it("none of the four document TYPES was deleted — they left a gate, not the platform", () => {
    const catalogue = read("lib/process/documents.ts");
    for (const key of ["SPENDING_AUTHORIZATION", "VENDOR_INVOICE", "TRANSPORT_REQUEST", "BORDEREAU_LIVRAISON"]) {
      expect(catalogue, key).toContain(`key: "${key}"`);
    }
    const rows = read("supabase/migrations/20260714000001_billing_deposit_collections.sql");
    for (const key of ["SPENDING_AUTHORIZATION", "VENDOR_INVOICE", "TRANSPORT_REQUEST", "BORDEREAU_LIVRAISON"]) {
      expect(rows, key).toContain(`('${key}',`);
    }
  });

  it("H-6 — BORDEREAU_LIVRAISON stays HARD at the transport/pickup control", () => {
    expect(getActivity("transport_docs_transmission")!.requiredDocuments).toContain("BORDEREAU_LIVRAISON");
    expect(strip(read("lib/process/engine/gates.ts"))).toContain('checkEvidence("BORDEREAU_LIVRAISON", snap)');
    // …and it is still never waivable, and still not the signed POD.
    expect(NON_DECLARABLE_EVIDENCE_KEYS).toContain("BORDEREAU_LIVRAISON");
    expect(read("lib/process/documents.ts")).toContain('labelFr: "Bordereau de Livraison (non signé)"');
    expect(strip(read("lib/process/engine/evidence.ts"))).toContain('mapDocument("SIGNED_DELIVERY_NOTE")');
  });

  it("H-3 — the Finance authorization chain is untouched, and the AM is not in it", () => {
    const types = read("lib/finance/expense/types.ts");
    for (const visa of ["VISA_DEMANDEUR", "VISA_CHEF_TRANSIT", "VISA_COORDONNATEUR",
                        "VISA_OPERATIONS", "VISA_TRESORIERE", "VISA_DAF", "VISA_DG"]) {
      expect(types, visa).toContain(visa);
    }
    expect(strip(read("lib/finance/expense/actions.ts"))).toContain('guard("finance:expense:create")');
    expect(perms("ACCOUNT_MANAGER")).not.toContain("finance:expense:create");
    expect(perms("OPS_SUPERVISOR")).not.toContain("finance:expense:create");
  });

  it("C-3 declared absence is untouched — the same closed set, the same motif", () => {
    expect([...DECLARABLE_EVIDENCE_KEYS].sort()).toEqual(
      ["SPENDING_AUTHORIZATION", "TRANSPORT_REQUEST", "VENDOR_INVOICE"],
    );
    const check = read("supabase/migrations/20260915000001_evidence_absence_declaration.sql");
    expect(check).toContain("evidence_key in ('VENDOR_INVOICE', 'SPENDING_AUTHORIZATION', 'TRANSPORT_REQUEST')");
  });

  it("removing the documents did not open a reconciliation side door", () => {
    // The proxy « the dossier left DRAFT » would have stood alone behind an
    // emptied evidence set and completed the AM's readiness act from any
    // document verification. The rule is gone; the gate that held it remains.
    expect(FACT_RULES["am_dossier_opening"]).toBeUndefined();
    expect(FACT_PROVABLE_STEP_KEYS).not.toContain("am_dossier_opening");
    expect(strip(read("lib/process/reconcile/service.ts"))).toContain("evaluateStepEvidence");
  });
});

// ═══════════ C. the handoff — every control intact ═════════════════════════

describe("H-2 — readiness for Transit: lighter content, identical shape", () => {
  const handoff = fnSlice(intakeActions, "handDossierToTransit");

  it("the from-step guard (D-2) still refuses before anything is sent", () => {
    expect(handoff).toContain("if (!amOpening || !isDone(amOpening.state))");
    expect(handoff.indexOf("am_opening_incomplete")).toBeLessThan(handoff.indexOf("sendHandoff("));
  });

  it("the generic C-2 guard still lives inside sendHandoff", () => {
    expect(engineActions).toContain('if (!from || !isDone(from.state)) return fail("from_step_incomplete");');
  });

  it("blocking blockers still stop the transmission", () => {
    expect(handoff).toContain("HANDOFF_BLOCKING_CATEGORIES");
    expect(handoff.indexOf("blocked_by_intake_blockers")).toBeLessThan(handoff.indexOf("sendHandoff("));
  });

  it("the send is explicit and the reception is explicit", () => {
    expect(handoff).toContain('sendHandoff(fileId, "am_dossier_opening", "coordinator_reception")');
    // Reception is enforced through the route-aware custody rule
    // (UAT-WF-HANDOFF-01B), which is strictly stronger than the previous
    // outstanding-transfer check it replaced.
    expect(engineActions).toContain("custodyRefusal(");
    const routes = strip(read("lib/process/handoff-routes.ts"));
    expect(routes).toContain('"handoff_reception_required"');
    expect(routes).toContain("requiresReception: true");
  });

  it("the sender is still authorized, and no new document gate was invented", () => {
    expect(handoff).toContain('intakeGuard("process:handoff:send", fileId)');
    for (const doc of ["BILL_OF_LADING", "COMMERCIAL_INVOICE", "PACKING_LIST", "gates_customs"]) {
      expect(handoff, doc).not.toContain(doc);
    }
  });
});

// ═══════════ D. documents ══════════════════════════════════════════════════

describe("documents — verification unchanged", () => {
  it("an upload is still not an approval, and the uploader is not the verifier", () => {
    expect(evidence).toContain("isVerified(d.status)");
    expect(evidence).toContain('status: "pending_review", detail: "awaiting_approval"');
    expect(strip(read("lib/documents/actions.ts"))).toContain("makerChecker");
  });
});

// ═══════════ E/F. Finance and cotation ═════════════════════════════════════

describe("H-7 — cotation belongs to Operations", () => {
  it("no PROVISIONAL Transit ownership of cotation remains", () => {
    expect(ROLE_CANONICAL_DEPARTMENT.QUOTATION_MANAGER).toBe("OPERATIONS");
    expect(QUEUE_DEPARTMENT_TO_CANONICAL.cotation).toBe("OPERATIONS");
    const depts = read("lib/organization/departments.ts");
    expect(depts).not.toMatch(/QUOTATION_MANAGER: "TRANSIT"/);
    expect(depts).not.toMatch(/cotation: "TRANSIT"/);
  });

  it("T1 no longer claims the commercial cotation", () => {
    const t1 = TRANSIT_STAGES.find((t) => t.key === "T1")!;
    expect(t1.labelFr).toBe("Réception et vérification sommaire");
    expect(t1.labelFr).not.toContain("cotation");
    const src = TRANSIT_SOURCE_MAP.find((t) => t.key === "T1")!;
    expect(src.labelFr).not.toContain("cotation");
    expect(src.stepKeys).not.toContain("cotation");
  });

  it("H-8 — T5 names what it actually validates", () => {
    const t5 = TRANSIT_SOURCE_MAP.find((t) => t.key === "T5")!;
    expect(t5.labelFr).not.toContain("devis");
    expect(t5.stepKeys).toEqual(["transit_validation"]);
    // and the maker-checker behind it is unchanged
    expect(getStep("transit_validation")!.permissions).toContain("customs:validate");
    expect(getStep("transit_validation")!.rejectsTo).toBe("customs_preparation");
  });

  it("« Sans devis » still works and quotation is still not mandatory", () => {
    const open = fnSlice(intakeActions, "openDossierWorkflow");
    expect(open).toContain("Ouverture directe — dossier sans devis.");
    expect(open).toContain('skipStep(fileId, "cotation"');
    expect(read("components/files/commercial-origin.tsx")).toContain("Sans devis");
  });
});

// ═══════════ G. Operations editability ═════════════════════════════════════

describe("H-9 — the Operations Supervisor maintains the dossier", () => {
  it("holds file:update in all three grant sources", () => {
    expect(perms("OPS_SUPERVISOR")).toContain("file:update");
    expect(seed).toMatch(/p\.code = 'file:update'[\s\S]{0,200}OPS_SUPERVISOR/);
    expect(migration).toContain("'file:update'");
    expect(migration).toContain("OPS_SUPERVISOR");
  });

  it("file:create was deliberately NOT granted", () => {
    expect(perms("OPS_SUPERVISOR")).not.toContain("file:create");
    // The EXECUTABLE sql, not the prose: the migration's comment explains why
    // file:create is withheld, and a substring ban would trip on the sentence.
    const sql = migration.replace(/^\s*--.*$/gm, "");
    expect(sql).not.toContain("file:create");
    expect(sql).toContain("'file:update'");
  });

  it("the migration asserts its own outcome and touches nothing else", () => {
    expect(migration).toContain("raise exception");
    expect(migration).not.toMatch(/create table|drop |alter table|create policy|drop policy/i);
  });

  it("editing confers no authority over independently governed records", () => {
    const update = fnSlice(filesActions, "updateFile");
    for (const table of ["expense_authorization", "customs_record", "invoice", "payment", "document"]) {
      expect(update, table).not.toContain(`from("${table}")`);
    }
    expect(update).toContain('assertPermission("file:update")');
  });

  it("editing and advancing the ladder remain two distinct authorities", () => {
    expect(strip(read("lib/files/actions.ts"))).toContain('assertPermission("file:transition")');
    expect(perms("CEO")).not.toContain("file:update");
  });
});

describe("H-10 — an editable record with an immutable history", () => {
  const update = fnSlice(filesActions, "updateFile");

  it("reads the previous values before writing", () => {
    expect(update).toContain('.select("id, tenant_id, type, client_id, priority');
    expect(update).toContain('.from("shipment")');
  });

  it("audits BOTH sides, and only the fields that changed", () => {
    expect(update).toContain("before,");
    expect(update).toContain("after,");
    expect(update).toContain("if (String(was) === String(now)) continue;");
    expect(update).toContain("AuditActions.FILE_UPDATED");
    // The old audit recorded the resulting object and nothing else.
    expect(update).not.toContain("after: { type: input.type, client_id: input.clientId }");
  });

  it("covers shipment fields, which carried no history at all before", () => {
    expect(update).toContain('diff((existingShipment as Record<string, unknown> | null) ?? null, nextShipment, "shipment.")');
  });

  it("reuses the existing audit infrastructure — no parallel subsystem", () => {
    expect(update).toContain("writeAudit({");
    expect(strip(read("lib/audit/log.ts"))).toContain("before:");
  });

  it("does not force a reason on an ordinary correction (ratified for this slice)", () => {
    expect(update).not.toMatch(/reason_required|return \{ ok: false, error: "reason/);
  });
});

// ═══════════ H. scope discipline ═══════════════════════════════════════════

describe("scope — steps 4-10 and the pilot dossier are untouched", () => {
  it("every step 4-10 keeps its owner, prerequisite and evidence", () => {
    const expected: Record<string, { prereq: string[]; docs: string[] }> = {
      coordinator_reception: { prereq: ["am_dossier_opening"], docs: [] },
      transit_declarant_assignment: { prereq: ["coordinator_reception"], docs: [] },
      customs_preparation: { prereq: ["transit_declarant_assignment"], docs: ["CUSTOMS_DOSSIER"] },
      transit_validation: { prereq: ["customs_preparation"], docs: ["CUSTOMS_DOSSIER"] },
      coordinator_to_finance: { prereq: ["transit_validation"], docs: [] },
      gainde_registration: { prereq: ["coordinator_to_finance"], docs: [] },
      coordinator_to_declarant: { prereq: ["gainde_registration"], docs: [] },
    };
    for (const [key, want] of Object.entries(expected)) {
      const node = getStep(key)!;
      expect(node.prerequisites, key).toEqual(want.prereq);
      expect(node.requiredDocuments, key).toEqual(want.docs);
    }
  });

  it("the GAINDE milestone is still Finance's, and still needs a real reference", () => {
    expect(FACT_RULES["gainde_registration"]).toBeDefined();
    expect(getStep("gainde_registration")!.permissions).toContain("customs:register");
    expect(evidence).toContain('detail: "no_gainde_reference"');
  });

  it("exactly one migration was added, and it is the newest", () => {
    const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
    const files = readdirSync(dir).filter((f: string) => f.endsWith(".sql")).sort();
    expect(files.at(-1)).toBe("20260930000001_customs_release_approval.sql");
    expect(read("lib/platform/ops/build-info.ts")).toContain("MIGRATION_COUNT = 138");
  });

  it("EFT-IMP-2026-00009 is named nowhere in the slice", () => {
    for (const f of ["lib/process/engine/intake-actions.ts", "lib/process/effitrans-process.ts",
                     "lib/files/actions.ts", "lib/organization/departments.ts",
                     "supabase/migrations/20260929000001_ops_supervisor_file_update.sql"]) {
      expect(read(f), f).not.toMatch(/EFT-IMP-2026-00009|00009/);
    }
  });
});
