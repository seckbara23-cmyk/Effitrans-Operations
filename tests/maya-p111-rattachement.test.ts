/**
 * MAYA-P1.11 — Rattachement (CEO step 9), implemented.
 * ---------------------------------------------------------------------------
 * P1.3 refused to build this because nothing said what « rattachement »
 * attaches. Effitrans answered, and the answer turned out to describe a step
 * that already existed: registry step 11 `gainde_document_submission`, whose
 * owner (CUSTOMS_DECLARANT), permission (customs:update), manual nature and
 * prerequisite (the Finance GAINDE registration) all match the ratified words.
 * Only the durable fact was missing.
 *
 * The risk this suite exists for is the MAYA-P1.2 one. Five other customs facts
 * sit around this step — the declaration, the GAINDE registration, the BAE, the
 * release, the provider clock — and any of them could quietly be allowed to
 * prove it. None may.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FACT_RULES, evaluateStep, type ModuleFacts } from "@/lib/process/reconcile/satisfaction";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";
import { getEventType } from "@/lib/workflow/events/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260828000001_customs_attachment.sql";
const ACTIONS = "lib/customs/actions.ts";
const PANEL = "components/customs/customs-panel.tsx";
const SATISFACTION = "lib/process/reconcile/satisfaction.ts";
const DONE = "2026-08-14T10:00:00.000Z";

function actionBody(): string {
  const s = code(ACTIONS);
  const start = s.indexOf("export async function recordCustomsAttachment");
  expect(start, "recordCustomsAttachment must exist").toBeGreaterThan(-1);
  return s.slice(start, s.indexOf("export async function", start + 1));
}

/** Every customs fact EXCEPT the attachment. */
const facts = (attachmentCompletedAt: string | null = null): ModuleFacts => ({
  fileType: "IMP",
  fileStatus: "IN_PROGRESS",
  customs: {
    status: "RELEASED",
    required: true,
    declarationNumber: "IMP-2026-000123",
    baeReference: "BAE-1",
    gaindeRegisteredAt: "2026-08-13T09:30:00.000Z",
    attachmentCompletedAt,
  },
  transport: { status: "POD_RECEIVED" },
  verifiedPodDocumentId: "pod-1",
  verifiedBaeDocumentId: "bae-1",
});

const evalStep = (f: ModuleFacts, state: string | null) =>
  evaluateStep({
    stepKey: "gainde_document_submission",
    facts: f,
    execution: state ? { stepKey: "gainde_document_submission", state } : null,
  });

// ===========================================================================
describe("the act, its owner and its authority", () => {
  it("maps to the step that already described it", () => {
    const s = EFFITRANS_PROCESS.find((x) => x.key === "gainde_document_submission")!;
    expect(s.stepNumber).toBe(11);
    expect(s.role).toBe("CUSTOMS_DECLARANT");
    expect(s.prerequisites).toContain("gainde_registration");
    expect(s.requiredDocuments).toContain("GAINDE_SUBMISSION_EVIDENCE");
  });

  it("asserts the step's own permission, and creates none", () => {
    expect([...actionBody().matchAll(/assertPermission\("([^"]+)"\)/g)].map((m) => m[1]))
      .toEqual(["customs:update"]);
    // No new permission, no new grant — the Declarant already held it.
    expect(read(MIGRATION)).not.toMatch(/insert into public\.(permission|role_permission)/);
    const roles = read("lib/platform/role-templates.ts");
    const i = roles.indexOf('key: "CUSTOMS_DECLARANT"');
    expect(roles.slice(i, roles.indexOf('key: "', i + 6))).toContain('"customs:update"');
  });

  it("the database re-checks the caller-declared actor (INV-7)", () => {
    expect(read(MIGRATION))
      .toMatch(/assert_actor_authority\(p_actor, v_tenant, 'customs:update', 'SERVICE'\)/);
    for (const who of ["public", "anon", "authenticated"]) {
      expect(read(MIGRATION), who)
        .toContain(`revoke execute on function public.record_customs_attachment(uuid, text[], uuid) from ${who}`);
    }
  });

  it("no maker-checker was invented — Effitrans said he does it himself", () => {
    const m = code(MIGRATION);
    expect(m).not.toMatch(/created_by = p_actor|updated_by = p_actor|may not validate/);
    expect(actionBody()).not.toMatch(/self_valid|maker|checker/i);
  });
});

// ===========================================================================
describe("only the attachment proves the attachment", () => {
  it("the attachment completes the step", () => {
    for (const state of [null, "PENDING", "AVAILABLE", "ACTIVE", "BLOCKED"]) {
      expect(evalStep(facts(DONE), state).satisfaction, state ?? "none").toBe("SATISFIED");
    }
  });

  it("NO other customs fact completes it — the P1.2 protection", () => {
    // Declaration + GAINDE registration + BAE + release + POD, all present,
    // attachment absent. Each of these is a different act by a different owner.
    expect(FACT_RULES.gainde_document_submission.satisfied(facts(null))).toBe(false);
    expect(evalStep(facts(null), "AVAILABLE").satisfaction).not.toBe("SATISFIED");
  });

  it("each neighbouring fact alone is powerless", () => {
    const only = (over: Partial<NonNullable<ModuleFacts["customs"]>>): ModuleFacts => ({
      fileType: "IMP", fileStatus: "IN_PROGRESS",
      customs: {
        status: "NOT_STARTED", required: true, declarationNumber: null,
        baeReference: null, gaindeRegisteredAt: null, attachmentCompletedAt: null, ...over,
      },
      transport: null, verifiedPodDocumentId: null, verifiedBaeDocumentId: null,
    });
    const rule = FACT_RULES.gainde_document_submission;
    expect(rule.satisfied(only({ declarationNumber: "D-1" })), "declaration").toBe(false);
    expect(rule.satisfied(only({ status: "DECLARED" })), "declared").toBe(false);
    expect(rule.satisfied(only({ gaindeRegisteredAt: DONE })), "gainde registration").toBe(false);
    expect(rule.satisfied(only({ baeReference: "BAE-1" })), "bae").toBe(false);
    expect(rule.satisfied(only({ status: "RELEASED" })), "release").toBe(false);
    // …and the attachment alone is enough.
    expect(rule.satisfied(only({ attachmentCompletedAt: DONE }))).toBe(true);
  });

  it("the rule reads the attachment column and no other", () => {
    const s = code(SATISFACTION);
    const rule = s.slice(s.indexOf("gainde_document_submission: {"), s.indexOf("customs_field_clearance: {"));
    expect(rule).toContain("satisfied: (f) => Boolean(f.customs?.attachmentCompletedAt)");
    expect(rule).not.toContain("baeReference");
    expect(rule).not.toContain("declarationNumber");
    // The service must actually read the column, or the rule reads undefined.
    expect(code("lib/process/reconcile/service.ts")).toContain("attachment_completed_at");
    expect(code("lib/process/reconcile/service.ts"))
      .toContain("attachmentCompletedAt: customs.data.attachment_completed_at");
  });

  it("it converges through WES-5, not a second mechanism", () => {
    const b = actionBody();
    expect(b).toContain("reconcileDossierProcess");
    expect(b).toContain('cause: "customs_attachment"');
    expect(b.indexOf(".rpc(")).toBeLessThan(b.indexOf("reconcileDossierProcess"));
    expect(b).not.toMatch(/process_step_execution|reconcile_step_completion/);
  });
});

// ===========================================================================
describe("retry, history and separation of concerns", () => {
  it("re-recording is allowed — it is the ratified failure path", () => {
    // record_gainde_registration refuses a duplicate; this must NOT, because a
    // retry is normally the same documents in the same systems.
    const m = code(MIGRATION);
    expect(m).not.toMatch(/is not distinct from|already recorded/);
    expect(m).toMatch(/'repeated', v_prev is not null/);
  });

  it("the event registry declares the attempt marker", () => {
    const def = getEventType("CUSTOMS_ATTACHMENT_RECORDED")!;
    expect(def.domain).toBe("customs");
    expect(def.emission).toBe("rpc");
    expect(def.metadataKeys).toContain("repeated");
    expect(def.clientSafe).toBe(false);
    // Emitted by the RPC only — no trigger, so no double emission (WES-9).
    expect(read(MIGRATION)).not.toMatch(/create (or replace )?trigger/i);
  });

  it("recevabilité is neither read nor written by the attachment", () => {
    const m = code(MIGRATION);
    const fn = m.slice(m.indexOf("as $$"), m.indexOf("$$;"));
    expect(fn).not.toMatch(/receivability/);
    expect(actionBody()).not.toMatch(/receivability|recordReceivability/);
  });

  it("no other customs act is touched", () => {
    const m = code(MIGRATION);
    const upd = m.slice(m.indexOf("update public.customs_record"), m.indexOf("perform public.emit_business_event"));
    expect(upd).toContain("attachment_completed_at");
    expect(upd).toContain("attachment_completed_by");
    expect(upd).toContain("attachment_systems");
    for (const foreign of ["status", "intel_status", "gainde_registered", "reviewed_", "bae_reference", "release_date", "provider_"]) {
      expect(upd, foreign).not.toContain(foreign);
    }
  });
});

// ===========================================================================
describe("nothing is synchronised, and nothing is required that was not ratified", () => {
  it("no GAINDE/ORBUS synchronisation is claimed anywhere", () => {
    for (const f of [MIGRATION, ACTIONS, PANEL]) {
      expect(code(f), f).not.toMatch(/synchronis[ée]\s+(avec\s+)?(GAINDE|ORBUS)|GAINDE\s+API|ORBUS\s+API/i);
    }
    // The operator-facing hint says so positively — assert the claim, not a word.
    const i18n = read("lib/i18n.ts");
    const block = i18n.slice(i18n.indexOf("attachment: {"), i18n.indexOf("gainde: {"));
    expect(block).toMatch(/ne la verifie pas/);
    expect(block).toMatch(/ne se synchronise avec aucun systeme douanier/);
  });

  it("a screenshot is NEVER a precondition", () => {
    // « Peut-être » is not a rule. The evidence type already exists and is
    // attachable through the ordinary document path.
    const fn = code(MIGRATION);
    expect(fn).not.toMatch(/GAINDE_SUBMISSION_EVIDENCE|screenshot|capture/i);
    expect(actionBody()).not.toMatch(/GAINDE_SUBMISSION_EVIDENCE|document/i);
  });

  it("only the two ratified systems are accepted", () => {
    const m = read(MIGRATION);
    expect(m).toMatch(/array\['GAINDE', 'ORBUS'\]/);
    expect(m).toContain("customs_attachment_systems_known");
    const b = actionBody();
    expect(b).toContain('s === "GAINDE" || s === "ORBUS"');
    expect(b).toContain('"unknown_system"');
  });

  it("the UI offers the act to a customs:update holder and states its nature", () => {
    expect(code("app/files/[id]/page.tsx")).toContain('canAttach={hasPermission(permissions, "customs:update")}');
    expect(code(PANEL)).toMatch(/canAttach &&/);
    expect(code(PANEL)).toContain("recordCustomsAttachment(record.id, set)");
  });

  it("the ledger is consistent and the migration is re-run safe", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    const bi = read("lib/platform/ops/build-info.ts");
    expect(migrations).toHaveLength(Number(/MIGRATION_COUNT = (\d+)/.exec(bi)![1]));
    // LATEST_MIGRATION moves on; that THIS migration shipped is durable:
    expect(migrations).toContain("20260828000001_customs_attachment.sql");
    const m = read(MIGRATION);
    expect(m).toContain("add column if not exists");
    expect(m).toContain("create or replace function");
    expect(m).toMatch(/if not exists \(select 1 from pg_constraint/);
    // The P1.1 lesson: a prosrc assertion must strip comments first.
    expect(m).toContain("v_body := regexp_replace(v_src, '--.*$', '', 'ng')");
  });
});
