/**
 * Phase WES-5 — module / process-engine reconciliation.
 *
 * The satisfaction model and the evidence resolver are PURE, so the doctrine
 * is tested at runtime. Structural SQL assertions use `sqlCode()` (strips `--`)
 * so a migration header can never satisfy a test about its code.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  FACT_PROVABLE_STEP_KEYS,
  evaluateStep,
  mayReconcileComplete,
  type ModuleFacts,
} from "@/lib/process/reconcile/satisfaction";
import { missingDocumentationEvidence } from "@/lib/documents/requirements";
import { getEventType, isKnownEventType } from "@/lib/workflow/events/types";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260727000005_process_reconciliation.sql";
const sql = () => sqlCode(MIGRATION);

const FACTS: ModuleFacts = {
  fileType: "IMP",
  fileStatus: "IN_PROGRESS",
  customs: {
    status: "RELEASED", required: true, declarationNumber: "D-2026-001", baeReference: "BAE-1",
    gaindeRegisteredAt: "2026-08-13T09:30:00.000Z",
    attachmentCompletedAt: null,
  },
  transport: { status: "POD_RECEIVED" },
  verifiedPodDocumentId: "pod-doc-1",
  verifiedBaeDocumentId: "bae-doc-1",
};

// ---------------------------------------------------------------------------
// WES-5B satisfaction model
// ---------------------------------------------------------------------------
describe("WES-5B step satisfaction", () => {
  it("keeps the fact-provable set SHORT and fail-closed", () => {
    // Every entry must survive: "could this step mean anything other than
    // this fact?" Absence means human-only, so the model can under-automate
    // but never over-automate.
    // MAYA-P1.11 added `gainde_document_submission` (CEO step 9, rattachement)
    // once Effitrans ratified the act, its owner and its manual nature. The set
    // grows only when a business answer arrives — never to make a step tidy.
    // H-1/H-2 (2026-09-03) REMOVED `am_dossier_opening`. Its proxy was « the
    // dossier left DRAFT », held back only by step 3's four required documents;
    // once those were ratified away the proxy would have stood alone and
    // completed the Account Manager's preparation — the readiness act itself —
    // from any document verification. The set shrinks the same way it grows:
    // only on a business answer.
    expect([...FACT_PROVABLE_STEP_KEYS].sort()).toEqual([
      "customs_field_clearance",
      "gainde_document_submission",
      "gainde_registration",
      "pickup",
      "transport_pod_handoff",
    ]);
  });

  it("SATISFIES customs field clearance from the RELEASED fact", () => {
    const r = evaluateStep({ stepKey: "customs_field_clearance", facts: FACTS, execution: { stepKey: "customs_field_clearance", state: "ACTIVE" } });
    expect(r.satisfaction).toBe("SATISFIED");
  });

  it("leaves the step open while the fact is absent", () => {
    const facts = { ...FACTS, customs: { ...FACTS.customs!, status: "DECLARED" } };
    const r = evaluateStep({ stepKey: "customs_field_clearance", facts, execution: { stepKey: "customs_field_clearance", state: "ACTIVE" } });
    expect(r.satisfaction).toBe("IN_PROGRESS");
  });

  it("proves GAINDE from the FINANCE milestone, not the Declarant's paperwork", () => {
    // MAYA-P1.2 replaced the old proxy (« DECLARED + declaration number »).
    // That proxy completed a step the registry assigns to Finance using a fact
    // the Declarant writes — and had already done so once in production.
    const declaredOnly = {
      ...FACTS,
      customs: { ...FACTS.customs!, declarationNumber: "D-2026-001", gaindeRegisteredAt: null },
    };
    expect(evaluateStep({ stepKey: "gainde_registration", facts: declaredOnly, execution: null }).satisfaction)
      .not.toBe("SATISFIED");
    expect(evaluateStep({ stepKey: "gainde_registration", facts: FACTS, execution: null }).satisfaction)
      .toBe("SATISFIED");
  });

  it("the milestone alone proves it — a reference edit cannot reopen the act", () => {
    // `external_ref` stays writable through customs:update. Keying on the
    // reference would let an unrelated edit reopen an act Finance signed.
    const noNumber = { ...FACTS, customs: { ...FACTS.customs!, declarationNumber: "  " } };
    expect(evaluateStep({ stepKey: "gainde_registration", facts: noNumber, execution: null }).satisfaction)
      .toBe("SATISFIED");
  });

  it("a step completed on the OLD proxy becomes CONFLICT — reported, never regressed", () => {
    // Exactly one production dossier is in this state: COMPLETED, provenance
    // RECONCILED, fact CUSTOMS_DECLARED, and no Finance registration. WES-5
    // makes that visible rather than resolving it, and NOTHING is back-filled:
    // inventing a registration date and actor is precisely the lie to avoid.
    const legacy = { ...FACTS, customs: { ...FACTS.customs!, gaindeRegisteredAt: null } };
    const r = evaluateStep({
      stepKey: "gainde_registration",
      facts: legacy,
      execution: { stepKey: "gainde_registration", state: "COMPLETED" },
    });
    expect(r.satisfaction).toBe("CONFLICT");
  });

  it("an unregistered dossier still projects as pending, exactly as before", () => {
    const legacy = { ...FACTS, customs: { ...FACTS.customs!, gaindeRegisteredAt: null } };
    expect(evaluateStep({ stepKey: "gainde_registration", facts: legacy, execution: { stepKey: "gainde_registration", state: "AVAILABLE" } }).satisfaction)
      .toBe("IN_PROGRESS");
  });

  it("proves pickup from any later transport state — the ladder is monotonic", () => {
    for (const status of ["PICKED_UP", "IN_TRANSIT", "DELIVERED", "POD_RECEIVED"]) {
      const facts = { ...FACTS, transport: { status } };
      expect(evaluateStep({ stepKey: "pickup", facts, execution: null }).satisfaction).toBe("SATISFIED");
    }
    const planned = { ...FACTS, transport: { status: "PLANNED" } };
    expect(evaluateStep({ stepKey: "pickup", facts: planned, execution: null }).satisfaction).toBe("IN_PROGRESS");
  });

  it("proves POD from the verified document OR the transport status", () => {
    const docOnly = { ...FACTS, transport: { status: "DELIVERED" } };
    const r = evaluateStep({ stepKey: "transport_pod_handoff", facts: docOnly, execution: null });
    expect(r.satisfaction).toBe("SATISFIED");
    // …and the EXACT version is named for consumption (WES-5D).
    expect(r.evidenceDocumentId).toBe("pod-doc-1");

    const statusOnly = { ...FACTS, verifiedPodDocumentId: null };
    expect(evaluateStep({ stepKey: "transport_pod_handoff", facts: statusOnly, execution: null }).satisfaction).toBe("SATISFIED");
  });

  it("reports CONFLICT when the engine says done but the fact is absent — never resolves it", () => {
    const facts = { ...FACTS, customs: { ...FACTS.customs!, status: "DECLARED" } };
    const r = evaluateStep({ stepKey: "customs_field_clearance", facts, execution: { stepKey: "customs_field_clearance", state: "COMPLETED" } });
    expect(r.satisfaction).toBe("CONFLICT");
  });

  it("NEVER completes over a pending maker-checker review", () => {
    const r = evaluateStep({ stepKey: "customs_field_clearance", facts: FACTS, execution: { stepKey: "customs_field_clearance", state: "SUBMITTED" } });
    expect(r.satisfaction).toBe("IN_PROGRESS");
    expect(mayReconcileComplete("SUBMITTED")).toBe(false);
  });

  it("never touches a human decision", () => {
    for (const state of ["APPROVED", "REJECTED", "CANCELLED"]) {
      expect(mayReconcileComplete(state)).toBe(false);
    }
    for (const state of [null, "PENDING", "AVAILABLE", "ACTIVE", "BLOCKED"]) {
      expect(mayReconcileComplete(state)).toBe(true);
    }
  });

  it("marks customs steps NOT_APPLICABLE when customs is not required", () => {
    const facts = { ...FACTS, customs: { ...FACTS.customs!, required: false } };
    expect(evaluateStep({ stepKey: "customs_field_clearance", facts, execution: null }).satisfaction).toBe("NOT_APPLICABLE");
    expect(evaluateStep({ stepKey: "gainde_registration", facts, execution: null }).satisfaction).toBe("NOT_APPLICABLE");
  });

  it("keeps human-only steps human-only", () => {
    // A review step is never in FACT_RULES: its meaning IS a person's judgement.
    for (const humanOnly of ["transit_validation", "finance_invoice_validation", "coordinator_reception"]) {
      expect(FACT_PROVABLE_STEP_KEYS).not.toContain(humanOnly);
      const done = evaluateStep({ stepKey: humanOnly, facts: FACTS, execution: { stepKey: humanOnly, state: "COMPLETED" } });
      expect(done.satisfaction).toBe("SATISFIED"); // persisted human decision respected
      const open = evaluateStep({ stepKey: humanOnly, facts: FACTS, execution: null });
      expect(open.satisfaction).toBe("NOT_STARTED"); // and never auto-completed
    }
  });

  it("never lists billing/deposit/collections — already engine-integrated", () => {
    // Their module actions call submitStep themselves; a second completion
    // path here would be the dual authority WES-5 removes.
    for (const k of ["billing_draft", "courier_deposit", "collections"]) {
      expect(FACT_PROVABLE_STEP_KEYS).not.toContain(k);
    }
  });
});

// ---------------------------------------------------------------------------
// WES-5C/5K the POD fix
// ---------------------------------------------------------------------------
describe("WES-5C stage-aware evidence in the lifecycle", () => {
  const required = ["COMMERCIAL_INVOICE", "PACKING_LIST", "CUSTOMS_DECLARATION", "DELIVERY_NOTE"];

  it("FIXES THE DEFECT: a missing POD does not block documentation", () => {
    const missing = missingDocumentationEvidence({
      fileType: "IMP",
      requiredCodes: required,
      facts: [
        { typeCode: "COMMERCIAL_INVOICE", status: "APPROVED" },
        { typeCode: "PACKING_LIST", status: "APPROVED" },
      ],
    });
    // Invoice + packing list approved => documentation is COMPLETE, even
    // though the POD (transport stage) and the declaration (customs stage)
    // do not exist yet.
    expect(missing).toEqual([]);
  });

  it("still blocks on genuinely missing documentation-stage evidence", () => {
    const missing = missingDocumentationEvidence({
      fileType: "IMP", requiredCodes: required, facts: [],
    });
    expect(missing.map((m) => m.code).sort()).toEqual(["COMMERCIAL_INVOICE", "PACKING_LIST"]);
  });

  it("does not count rejected or superseded versions as satisfaction", () => {
    const missing = missingDocumentationEvidence({
      fileType: "IMP",
      requiredCodes: ["COMMERCIAL_INVOICE"],
      facts: [{ typeCode: "COMMERCIAL_INVOICE", status: "REJECTED" }],
    });
    expect(missing.map((m) => m.code)).toContain("COMMERCIAL_INVOICE");
  });

  it("accepts verified, legacy-approved and consumed versions", () => {
    for (const status of ["VERIFIED", "APPROVED", "CONSUMED_AS_EVIDENCE"]) {
      const missing = missingDocumentationEvidence({
        fileType: "IMP",
        requiredCodes: ["COMMERCIAL_INVOICE"],
        facts: [{ typeCode: "COMMERCIAL_INVOICE", status }],
      });
      expect(missing).toEqual([]);
    }
  });

  it("never demands an internal artifact as external evidence", () => {
    const missing = missingDocumentationEvidence({
      fileType: "TRP", requiredCodes: ["TRANSPORT_ORDER", "PACKING_LIST"], facts: [],
    });
    expect(missing.map((m) => m.code)).toEqual(["PACKING_LIST"]);
  });

  it("is used by EVERY lifecycle assembler — one resolver, one answer", () => {
    for (const f of [
      "lib/documents/service.ts",
      "lib/control-tower/service.ts",
      "lib/portal/shipments.ts",
      "lib/portal/tracking.ts",
      "lib/workflow/access/service.ts",
      "lib/workflow/access/queue.ts",
    ]) {
      expect(code(f), `${f} must use the canonical helper`).toContain("missingDocumentationEvidence");
    }
  });

  it("leaves no raw required_for subtraction in any assembler", () => {
    for (const f of [
      "lib/control-tower/service.ts",
      "lib/portal/shipments.ts",
      "lib/portal/tracking.ts",
      "lib/workflow/access/queue.ts",
    ]) {
      expect(code(f)).not.toMatch(/filter\(\(?c(ode)?\)? => !approved\.has/);
    }
  });

  it("preserves the WES-2 formula: projection and progress untouched", () => {
    const p = code("lib/workflow/projection.ts");
    expect(p).not.toContain("missingDocumentationEvidence");
    expect(p).not.toContain("reconcile");
    // The single formula still lives there and only there.
    expect(p).toContain("Math.round((completed.length / applicable.length) * 100)");
  });
});

// ---------------------------------------------------------------------------
// WES-5E atomicity
// ---------------------------------------------------------------------------
describe("WES-5E atomic reconciliation", () => {
  it("writes transition + consumption + event in ONE function", () => {
    const body = sql().slice(sql().indexOf("create or replace function public.reconcile_step_completion"));
    expect(body).toContain("update public.process_step_execution");
    expect(body).toContain("insert into public.evidence_consumption");
    expect(body).toContain("emit_business_event");
  });

  it("is idempotent in SQL: COMPLETED returns already=true and writes nothing", () => {
    expect(sql()).toMatch(/if v_state in \('COMPLETED', 'SKIPPED', 'APPROVED'\) then\s*\n\s*return jsonb_build_object\('execution_id', p_execution_id, 'already', true\);/);
  });

  it("refuses SUBMITTED (maker-checker) and human decisions, in SQL", () => {
    const s = sql();
    expect(s).toContain("reconciliation must not bypass it");
    expect(s).toContain("reconciliation cannot override it");
  });

  it("locks the execution row against concurrent reconciliation", () => {
    expect(sql()).toMatch(/for update of e;/);
  });

  it("dedupes evidence consumption at the database", () => {
    expect(sql()).toContain("uq_evidence_consumption");
    expect(sql()).toMatch(/on conflict \(step_execution_id, document_id\) do nothing/);
  });

  it("keeps the consumption ledger append-only with no cascades", () => {
    const s = sql();
    expect(s).toMatch(/before update on public\.evidence_consumption[\s\S]{0,120}prevent_mutation/);
    expect(s).toMatch(/before delete on public\.evidence_consumption[\s\S]{0,120}prevent_mutation/);
    const table = s.slice(s.indexOf("create table public.evidence_consumption"), s.indexOf("create unique index uq_evidence_consumption"));
    expect(table).not.toContain("on delete cascade");
    expect(table).not.toMatch(/step_execution_id\s+uuid not null references/);
    expect(table).not.toMatch(/document_id\s+uuid not null references/);
  });

  it("records provenance honestly — RECONCILED is never HUMAN", () => {
    expect(sql()).toContain("'HUMAN', 'RECONCILED', 'LEGACY_RECONCILED'");
    expect(sql()).toMatch(/case when p_legacy then 'LEGACY_RECONCILED' else 'RECONCILED' end/);
  });

  it("consumes evidence forward-only: only verified versions become CONSUMED", () => {
    expect(sql()).toMatch(/set status = 'CONSUMED_AS_EVIDENCE'\s*\n\s*where id = p_evidence_doc_id\s*\n\s*and status in \('VERIFIED', 'APPROVED'\)/);
  });
});

// ---------------------------------------------------------------------------
// WES-5A the service
// ---------------------------------------------------------------------------
describe("WES-5A reconciliation service", () => {
  const svc = () => code("lib/process/reconcile/service.ts");

  it("never throws — reconciliation failure cannot break the module action", () => {
    expect(svc()).toMatch(/try \{\s*\n\s*return await run\(input\);\s*\n\s*\} catch \{\s*\n\s*return \{ \.\.\.EMPTY, ok: false \};/);
  });

  it("applies completions ONLY through the atomic RPC", () => {
    const s = svc();
    expect(s).toContain('rpc("reconcile_step_completion"');
    expect(s).not.toMatch(/\.from\("process_step_execution"\)[\s\S]{0,200}\.update\(/);
  });

  it("reports conflicts instead of resolving them", () => {
    const s = svc();
    expect(s).toMatch(/if \(evaluation\.satisfaction === "CONFLICT"\) \{\s*\n\s*result\.conflicts\.push/);
  });

  it("fabricates no process instance for legacy dossiers", () => {
    const s = svc();
    expect(s).not.toMatch(/\.from\("process_instance"\)[\s\S]{0,160}\.insert\(/);
  });

  it("is wired into customs release, document verification and transport", () => {
    for (const f of ["lib/customs/actions.ts", "lib/documents/actions.ts", "lib/transport/actions.ts"]) {
      expect(code(f), f).toContain("reconcileDossierProcess");
    }
  });

  it("infers nothing from task completion", () => {
    const s = svc() + code("lib/process/reconcile/satisfaction.ts");
    expect(s).not.toMatch(/\.from\("task"\)/);
    expect(s).not.toMatch(/task\.status|assigned_to/);
  });
});

// ---------------------------------------------------------------------------
// WES-5L events
// ---------------------------------------------------------------------------
describe("WES-5L reconciliation events", () => {
  it("declares the process domain with the two RPC-backed types", () => {
    expect(getEventType("PROCESS_STEP_COMPLETED")?.emission).toBe("rpc");
    expect(getEventType("PROCESS_STEP_COMPLETED")?.domain).toBe("process");
    expect(getEventType("EVIDENCE_CONSUMED")?.emission).toBe("rpc");
  });

  it("declares NO event without an action behind it", () => {
    // Conflicts are returned by the service, not emitted: an idempotent re-run
    // would duplicate them without a dedup key. Documented deferral.
    for (const absent of ["PROCESS_STEP_CONFLICT_DETECTED", "RECONCILIATION_COMPLETED", "RECONCILIATION_REQUIRES_REVIEW", "PROCESS_STEP_SATISFIED"]) {
      expect(isKnownEventType(absent)).toBe(false);
    }
  });

  it("keeps reconciliation events off the customer feed", () => {
    expect(getEventType("PROCESS_STEP_COMPLETED")?.clientSafe).toBe(false);
    expect(getEventType("EVIDENCE_CONSUMED")?.clientSafe).toBe(false);
  });

  it("adds the domain and source to the SQL vocabulary", () => {
    expect(sql()).toContain("'process'");
    expect(sql()).toContain("'reconcile_rpc'");
  });
});

// ---------------------------------------------------------------------------
// scope discipline
// ---------------------------------------------------------------------------
describe("WES-5 scope discipline", () => {
  it("starts no WES-8 SLA and no WES-6 Mission work", () => {
    const all = sql() + code("lib/process/reconcile/service.ts") + code("lib/process/reconcile/satisfaction.ts");
    expect(all).not.toMatch(/\bsla\b|breach|escalation/i);
    expect(all).not.toMatch(/\bmission\b/i);
  });

  it("ships exactly one migration of its own", () => {
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(files.filter((f) => /process_reconciliation/.test(f))).toHaveLength(1);
  });

  it("adds no second progress formula anywhere", () => {
    const all = code("lib/process/reconcile/service.ts") + code("lib/process/reconcile/satisfaction.ts");
    expect(all).not.toMatch(/Math\.round\([^)]*100\)/);
  });
});
