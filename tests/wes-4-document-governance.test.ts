/**
 * Phase WES-4 — canonical document doctrine, BAE governance, reason codes.
 *
 * `code()` strips TS comments, `sqlCode()` strips SQL `--`. Asserting against
 * raw text lets a comment satisfy a test about code — the mistake WES-9A had
 * to correct.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  DOCUMENT_DOCTRINE,
  DOCUMENT_STATUSES,
  canTransitionDocument,
  canonicalStatus,
  documentDoctrine,
  isClientSafeDocument,
  isInternalArtifact,
  isShareable,
  isVerified,
} from "@/lib/documents/doctrine";
import {
  REASON_CODES,
  eventReasonMetadata,
  isOverrideCode,
  isRejectionCode,
  rejectionCodes,
  validateReason,
} from "@/lib/documents/reason-codes";
import { resolveEvidenceRequirements } from "@/lib/documents/requirements";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260727000003_document_governance.sql";
const sql = () => sqlCode(MIGRATION);

// ---------------------------------------------------------------------------
// WES-4 doctrine
// ---------------------------------------------------------------------------
describe("WES-4 document doctrine", () => {
  it("classifies every catalog type as external evidence or internal artifact", () => {
    for (const d of DOCUMENT_DOCTRINE) {
      expect(["EXTERNAL_EVIDENCE", "INTERNAL_ARTIFACT"]).toContain(d.category);
    }
  });

  it("names TRANSPORT_ORDER an INTERNAL artifact — the category-B leak", () => {
    // It is an uploadable document_type today. Classifying it is step one;
    // retiring the upload waits for a generated replacement (WES-4G).
    expect(isInternalArtifact("TRANSPORT_ORDER")).toBe(true);
    expect(sql()).not.toMatch(/delete from public\.document_type/i);
  });

  it("adds BAE as external evidence, which did not exist before", () => {
    const bae = documentDoctrine("BAE");
    expect(bae?.category).toBe("EXTERNAL_EVIDENCE");
    expect(bae?.earliestStage).toBe("customs");
    expect(sql()).toMatch(/insert into public\.document_type[\s\S]{0,300}'BAE'/);
  });

  it("keeps the BAE off the customer feed", () => {
    expect(isClientSafeDocument("BAE")).toBe(false);
    expect(isClientSafeDocument("CUSTOMS_DECLARATION")).toBe(false);
  });

  it("does not require the BAE via the type-only required_for column", () => {
    // That column is the requirement model WES-4C replaces.
    expect(sql()).toMatch(/'BAE'[\s\S]{0,120}'\{\}'/);
  });
});

// ---------------------------------------------------------------------------
// WES-4A lifecycle
// ---------------------------------------------------------------------------
describe("WES-4A canonical lifecycle", () => {
  it("carries the canonical vocabulary plus read-only legacy aliases", () => {
    for (const s of ["UPLOADED", "UNDER_REVIEW", "VERIFIED", "CONSUMED_AS_EVIDENCE", "REJECTED", "SUPERSEDED"]) {
      expect(DOCUMENT_STATUSES).toContain(s);
    }
    expect(canonicalStatus("APPROVED")).toBe("VERIFIED");
    expect(canonicalStatus("PENDING_REVIEW")).toBe("UNDER_REVIEW");
  });

  it("never lets a superseded version become current again", () => {
    for (const to of DOCUMENT_STATUSES) {
      expect(canTransitionDocument("SUPERSEDED", to)).toBe(false);
    }
    expect(sql()).toContain("a superseded version cannot be reopened");
  });

  it("replaces a rejected version rather than verifying it in place", () => {
    expect(canTransitionDocument("REJECTED", "VERIFIED")).toBe(false);
    expect(canTransitionDocument("REJECTED", "SUPERSEDED")).toBe(true);
    expect(sql()).toContain("a rejected version is replaced, not verified in place");
  });

  it("never returns a verified version to review", () => {
    // Re-examination means a NEW version, so a verified version's meaning is
    // stable forever.
    expect(canTransitionDocument("VERIFIED", "UNDER_REVIEW")).toBe(false);
  });

  it("treats legacy APPROVED as verified", () => {
    expect(isVerified("APPROVED")).toBe(true);
    expect(isVerified("VERIFIED")).toBe(true);
    expect(isVerified("UPLOADED")).toBe(false);
  });

  it("freezes bytes and identity from upload, in every state", () => {
    const s = sql();
    expect(s).toContain("a version is immutable once uploaded");
    expect(s).toMatch(/new\.storage_path is distinct from old\.storage_path/);
    expect(s).toMatch(/new\.version is distinct from old\.version/);
  });

  it("records supersession once and never clears it", () => {
    expect(sql()).toContain("supersession cannot be changed once recorded");
  });
});

// ---------------------------------------------------------------------------
// WES-4C stage-aware requirements
// ---------------------------------------------------------------------------
describe("WES-4C stage-aware evidence requirements", () => {
  const base = {
    fileType: "IMP",
    transportMode: "SEA",
    customsApplicable: true,
    policyResolved: true,
    facts: [] as { typeCode: string; status: string }[],
  };

  it("does NOT require a POD during customs preparation — the reported defect", () => {
    const r = resolveEvidenceRequirements({
      ...base,
      stage: "customs",
      policyRequiredTypes: ["DELIVERY_NOTE", "CUSTOMS_DECLARATION"],
    });
    const pod = r.requirements.find((x) => x.typeCode === "DELIVERY_NOTE");
    expect(pod?.state).toBe("required_later");
    expect(r.missingNow.map((m) => m.typeCode)).not.toContain("DELIVERY_NOTE");
  });

  it("does not require the BAE before the customs stage", () => {
    const r = resolveEvidenceRequirements({
      ...base, stage: "documentation", policyRequiredTypes: ["BAE"],
    });
    expect(r.requirements[0].state).toBe("required_later");
    expect(r.missingNow).toHaveLength(0);
  });

  it("requires the BAE once the dossier reaches customs", () => {
    const r = resolveEvidenceRequirements({
      ...base, stage: "customs", policyRequiredTypes: ["BAE"],
    });
    expect(r.missingNow.map((m) => m.typeCode)).toContain("BAE");
  });

  it("does not apply maritime documents to an air shipment", () => {
    const r = resolveEvidenceRequirements({
      ...base, transportMode: "AIR", stage: "documentation",
      policyRequiredTypes: ["BILL_OF_LADING", "AIRWAY_BILL"],
    });
    expect(r.requirements.find((x) => x.typeCode === "BILL_OF_LADING")?.state).toBe("not_applicable");
    expect(r.requirements.find((x) => x.typeCode === "AIRWAY_BILL")?.state).toBe("missing");
  });

  it("does not apply air documents to a maritime shipment", () => {
    const r = resolveEvidenceRequirements({
      ...base, transportMode: "SEA", stage: "documentation",
      policyRequiredTypes: ["BILL_OF_LADING", "AIRWAY_BILL"],
    });
    expect(r.requirements.find((x) => x.typeCode === "AIRWAY_BILL")?.state).toBe("not_applicable");
    expect(r.requirements.find((x) => x.typeCode === "BILL_OF_LADING")?.state).toBe("missing");
  });

  it("manufactures no obligation from an unknown transport mode", () => {
    const r = resolveEvidenceRequirements({
      ...base, transportMode: null, stage: "documentation",
      policyRequiredTypes: ["BILL_OF_LADING", "AIRWAY_BILL"],
    });
    // Demanding two mutually exclusive documents because nobody recorded the
    // mode would invent work from missing data.
    expect(r.missingNow).toHaveLength(0);
  });

  it("skips customs evidence entirely when there is no customs leg", () => {
    const r = resolveEvidenceRequirements({
      ...base, customsApplicable: false, stage: "customs",
      policyRequiredTypes: ["BAE", "CUSTOMS_DECLARATION"],
    });
    expect(r.missingNow).toHaveLength(0);
    for (const req of r.requirements) expect(req.state).toBe("not_applicable");
  });

  it("never treats an internal artifact as external evidence to chase", () => {
    const r = resolveEvidenceRequirements({
      ...base, stage: "transport", policyRequiredTypes: ["TRANSPORT_ORDER"],
    });
    expect(r.requirements).toHaveLength(0);
  });

  it("counts an uploaded-but-unreviewed document as unmet, not satisfied", () => {
    const r = resolveEvidenceRequirements({
      ...base, stage: "documentation",
      policyRequiredTypes: ["COMMERCIAL_INVOICE"],
      facts: [{ typeCode: "COMMERCIAL_INVOICE", status: "UPLOADED" }],
    });
    expect(r.missingNow.map((m) => m.typeCode)).toContain("COMMERCIAL_INVOICE");
  });

  it("treats a verified document as satisfied, legacy alias included", () => {
    for (const status of ["VERIFIED", "APPROVED", "CONSUMED_AS_EVIDENCE"]) {
      const r = resolveEvidenceRequirements({
        ...base, stage: "documentation",
        policyRequiredTypes: ["COMMERCIAL_INVOICE"],
        facts: [{ typeCode: "COMMERCIAL_INVOICE", status }],
      });
      expect(r.satisfied.map((x) => x.typeCode)).toContain("COMMERCIAL_INVOICE");
    }
  });

  it("FAILS CLOSED when the pinned policy cannot be resolved", () => {
    const r = resolveEvidenceRequirements({
      ...base, stage: "customs", policyResolved: false,
      policyRequiredTypes: ["BAE"],
    });
    expect(r.resolved).toBe(false);
    expect(r.requirements).toHaveLength(0);
  });

  it("keeps future requirements OUT of the blocking set", () => {
    const r = resolveEvidenceRequirements({
      ...base, stage: "documentation",
      policyRequiredTypes: ["COMMERCIAL_INVOICE", "DELIVERY_NOTE", "PAYMENT_RECEIPT"],
    });
    expect(r.requiredLater.map((x) => x.typeCode).sort()).toEqual(["DELIVERY_NOTE", "PAYMENT_RECEIPT"]);
    expect(r.missingNow.map((x) => x.typeCode)).toEqual(["COMMERCIAL_INVOICE"]);
  });

  it("is NOT yet wired into the projection — a recorded, deliberate boundary", () => {
    // Rewiring changes missingRequired -> responsibleDepartment -> WES-3
    // visibility for every existing dossier. That is WES-5's reconciliation.
    expect(code("lib/files/lifecycle.ts")).not.toContain("resolveEvidenceRequirements");
    expect(code("lib/workflow/projection.ts")).not.toContain("resolveEvidenceRequirements");
  });
});

// ---------------------------------------------------------------------------
// WES-4F reason governance
// ---------------------------------------------------------------------------
describe("WES-4F reason and override governance", () => {
  it("is a closed registry split into rejection and override scopes", () => {
    expect(REASON_CODES.length).toBeGreaterThan(8);
    expect(isRejectionCode("DOCUMENT_ILLEGIBLE")).toBe(true);
    expect(isOverrideCode("EMERGENCY_OPERATIONAL_RECOVERY")).toBe(true);
    expect(isRejectionCode("EMERGENCY_OPERATIONAL_RECOVERY")).toBe(false);
  });

  it("rejects an unknown code rather than storing it as free text", () => {
    expect(validateReason({ code: "MADE_UP", scope: "REJECTION" })).toEqual({
      ok: false, error: "unknown_reason_code",
    });
  });

  it("refuses a code used in the wrong scope", () => {
    expect(validateReason({ code: "DATA_CORRECTION", scope: "REJECTION" })).toEqual({
      ok: false, error: "wrong_scope",
    });
  });

  it("demands an explanation where the code cannot stand alone", () => {
    expect(validateReason({ code: "DOCUMENT_MISMATCH", scope: "REJECTION" })).toEqual({
      ok: false, error: "explanation_required",
    });
    expect(
      validateReason({ code: "DOCUMENT_MISMATCH", explanation: "  ", scope: "REJECTION" }),
    ).toEqual({ ok: false, error: "explanation_required" });
  });

  it("requires an explanation for EVERY override", () => {
    for (const c of REASON_CODES.filter((r) => r.scope === "OVERRIDE")) {
      expect(c.explanationRequired).toBe(true);
    }
  });

  it("NEVER puts the explanation into event metadata", () => {
    const meta = eventReasonMetadata({
      code: "DOCUMENT_MISMATCH",
      explanation: "the consignee name does not match the BL",
      reviewId: "rev-1",
    });
    expect(meta.reason_code).toBe("DOCUMENT_MISMATCH");
    expect(meta.has_reason).toBe(true);
    expect(meta.reason_reference_id).toBe("rev-1");
    expect(JSON.stringify(meta)).not.toContain("consignee");
  });

  it("marks an override with its own code and reference", () => {
    const meta = eventReasonMetadata({
      code: "DATA_CORRECTION", explanation: "x", reviewId: "rev-2", isOverride: true,
    });
    expect(meta.is_override).toBe(true);
    expect(meta.override_reference_id).toBe("rev-2");
  });

  it("keeps the free-text explanation out of the SQL event payload too", () => {
    const s = sql();
    const rpc = s.slice(s.indexOf("create or replace function public.review_document"));
    expect(rpc).toContain("'has_reason'");
    expect(rpc).toContain("'reason_reference_id'");
    // The explanation is inserted into document_review and never into the event.
    expect(rpc).not.toMatch(/jsonb_build_object\([^;]*'explanation'/);
  });

  it("stores the explanation ONLY in the protected record", () => {
    const s = sql();
    expect(s).toMatch(/create table public\.document_review[\s\S]{0,900}explanation\s+text/);
    expect(s).toContain("prevent_mutation");
  });
});

// ---------------------------------------------------------------------------
// WES-4D/4E BAE governance
// ---------------------------------------------------------------------------
describe("WES-4D/4E BAE governance", () => {
  it("separates recording the reference from recording the release", () => {
    const s = sql();
    expect(s).toContain("create or replace function public.record_bae_reference");
    expect(s).toContain("create or replace function public.record_customs_release");
    // Recording the reference must NOT touch the customs status.
    const rec = s.slice(
      s.indexOf("create or replace function public.record_bae_reference"),
    );
    expect(rec).not.toMatch(/update public\.customs_record[\s\S]{0,200}set status/);
  });

  it("exposes the split at the action layer", () => {
    const src = code("lib/customs/actions.ts");
    expect(src).toContain("export async function recordBaeReference");
    expect(src).toContain("export async function recordCustomsRelease");
  });

  it("keeps the old single action only as a delegator", () => {
    const src = code("lib/customs/actions.ts");
    const fn = src.slice(src.indexOf("export async function releaseCustoms"));
    const body = fn.slice(0, fn.indexOf("export async function deleteCustoms"));
    expect(body).toContain("recordCustomsRelease");
    expect(body).not.toMatch(/\.from\("customs_record"\)[\s\S]{0,120}\.update\(/);
  });

  it("does NOT advance the process engine from a document phase", () => {
    const s = sql();
    expect(s).not.toMatch(/update public\.process_step_execution/i);
    expect(s).not.toMatch(/insert into public\.process_step_execution/i);
    expect(s).not.toMatch(/update public\.process_instance/i);
  });

  it("never says Effitrans approves Customs", () => {
    const raw = read(MIGRATION) + read("lib/customs/actions.ts") + read("lib/documents/doctrine.ts");
    expect(raw).not.toMatch(/BAE approuv|Douane approuv|approuv[ée]e? par Effitrans/i);
    expect(raw).toMatch(/mainlevée/i);
  });

  it("renames Approuver to Vérifier on the document surface", () => {
    const raw = read("components/documents/document-row.tsx");
    expect(raw).toContain("Vérifier");
    expect(code("components/documents/document-row.tsx")).not.toContain("approveDocument");
  });
});

// ---------------------------------------------------------------------------
// WES-4H maker-checker and policy consumption
// ---------------------------------------------------------------------------
describe("WES-4H policy consumption and maker-checker", () => {
  const src = () => code("lib/documents/governance.ts");

  it("resolves uploader and verifier seats from the PINNED policy", () => {
    const s = src();
    expect(s).toContain("resolveSeatEligibility");
    expect(s).toMatch(/"uploader"/);
    expect(s).toMatch(/"verifier"/);
    expect(s).toContain("processInstanceId");
  });

  it("hardcodes no BAE role anywhere", () => {
    const s = src() + code("lib/customs/actions.ts") + code("lib/documents/actions.ts");
    expect(s).not.toMatch(/CUSTOMS_DECLARANT|CHIEF_OF_TRANSIT/);
  });

  it("always maker-checks the BAE", () => {
    expect(src()).toMatch(/ALWAYS_MAKER_CHECKED[\s\S]{0,80}"BAE"/);
  });

  it("refuses self-verification when maker-checker applies", () => {
    const s = src();
    expect(s).toMatch(/input\.uploaderId === input\.actorId/);
    expect(s).toContain('error: "self_verification"');
    // …and again in the database, which cannot be bypassed.
    expect(sql()).toContain("the uploader cannot verify their own document");
  });

  it("gives SYSTEM_ADMIN no verifier authority", () => {
    const s = src();
    expect(s).not.toMatch(/is_system_admin|isSystemAdmin|SYSTEM_ADMIN/);
  });

  it("fails closed when policy cannot be resolved", () => {
    const s = src();
    expect(s).toMatch(/if \(!verifier\.resolved\) return UNRESOLVED/);
    expect(s).toMatch(/error: "policy_unresolved"/);
    // UNRESOLVED assumes maker-checker is REQUIRED, never waived.
    expect(s).toMatch(/UNRESOLVED[\s\S]{0,160}makerCheckerRequired: true/);
  });
});

// ---------------------------------------------------------------------------
// WES-4I atomicity
// ---------------------------------------------------------------------------
describe("WES-4I atomic document events", () => {
  it("writes status, review record and event in ONE function", () => {
    const s = sql();
    const rpc = s.slice(
      s.indexOf("create or replace function public.review_document"),
      s.indexOf("create or replace function public.supersede_document"),
    );
    expect(rpc).toContain("insert into public.document_review");
    expect(rpc).toContain("update public.document");
    expect(rpc).toContain("emit_business_event");
  });

  it("never updates the document status directly from application code", () => {
    const src = code("lib/documents/actions.ts");
    expect(src).not.toMatch(/\.from\("document"\)[\s\S]{0,160}\.update\(\s*\{[^}]*status/);
    expect(src).toContain('supabase.rpc("review_document"');
  });

  it("gives review events a SINGLE owner — no double emission", () => {
    // The WES-9 trigger emitted DOCUMENT_REJECTED on the status edge and the
    // RPC emits it too; left alone, one rejection would append two events.
    const s = sql();
    const trig = s.slice(s.indexOf("create or replace function public.emit_document_events"));
    expect(trig).toContain("DOCUMENT_UPLOADED");
    expect(trig).not.toContain("DOCUMENT_VERIFIED");
    expect(trig).not.toContain("DOCUMENT_REJECTED");
  });

  it("keeps the WES-9A non-swallowing contract in the rewritten trigger", () => {
    const s = sql();
    const trig = s.slice(s.indexOf("create or replace function public.emit_document_events"));
    expect(trig).toMatch(/when sqlstate 'EF001' then\s*\n\s*raise;/);
    expect(trig).toContain("using errcode = 'EF001'");
    expect(trig).not.toMatch(/raise warning[^;]*;\s*return null;\s*end;/);
  });

  it("records its own event source rather than borrowing one", () => {
    expect(sql()).toContain("'document_rpc'");
  });

  it("does not touch audit_log or the event ledger schema", () => {
    const s = sql();
    expect(s).not.toMatch(/insert into public\.audit_log/i);
    expect(s).not.toMatch(/alter table public\.business_event\s+add column/i);
  });
});

// ---------------------------------------------------------------------------
// WES-4J sharing
// ---------------------------------------------------------------------------
describe("WES-4J sharing alignment", () => {
  it("shares only client-safe, verified, current versions", () => {
    expect(isShareable({ typeCode: "COMMERCIAL_INVOICE", status: "VERIFIED", supersededById: null })).toBe(true);
    expect(isShareable({ typeCode: "BAE", status: "VERIFIED", supersededById: null })).toBe(false);
    expect(isShareable({ typeCode: "COMMERCIAL_INVOICE", status: "REJECTED", supersededById: null })).toBe(false);
    expect(isShareable({ typeCode: "COMMERCIAL_INVOICE", status: "UPLOADED", supersededById: null })).toBe(false);
    expect(isShareable({ typeCode: "COMMERCIAL_INVOICE", status: "VERIFIED", supersededById: "x" })).toBe(false);
  });

  it("gives the portal no route to the protected review record", () => {
    const s = sql();
    const policy = s.slice(s.indexOf("create policy document_review_select"));
    expect(policy).toContain("can_read_file(file_id)");
    expect(s).not.toMatch(/create policy[\s\S]{0,200}document_review[\s\S]{0,200}client_user/i);
    expect(s).not.toMatch(/grant (insert|update|delete) on public\.document_review/);
  });
});

// ---------------------------------------------------------------------------
// WES-4L legacy honesty
// ---------------------------------------------------------------------------
describe("WES-4L legacy compatibility", () => {
  it("classifies existing rows honestly instead of claiming compliance", () => {
    const s = sql();
    for (const p of ["LEGACY_VERIFIED", "LEGACY_UNVERIFIED", "LEGACY_REVIEWER_UNKNOWN", "LEGACY_GENERATION_UNKNOWN"]) {
      expect(s).toContain(p);
    }
    expect(s).toMatch(/status = 'APPROVED' and reviewed_by is null\s*then 'LEGACY_REVIEWER_UNKNOWN'/);
  });

  it("computes no hash for rows that were never hashed", () => {
    const s = sql();
    expect(s).not.toMatch(/update public\.document[\s\S]{0,200}set content_sha256/);
  });

  it("keeps legacy status values legal rather than rewriting history", () => {
    const s = sql();
    expect(s).toMatch(/document_status_check[\s\S]{0,300}'PENDING_REVIEW', 'APPROVED'/);
    expect(s).not.toMatch(/update public\.document[\s\S]{0,120}set status = 'VERIFIED'/);
  });
});

// ---------------------------------------------------------------------------
// scope discipline
// ---------------------------------------------------------------------------
describe("WES-4 scope discipline", () => {
  it("does not start WES-5, WES-8 or WES-6", () => {
    const all = sql() + code("lib/documents/requirements.ts") + code("lib/documents/governance.ts");
    expect(all).not.toMatch(/\bmission\b/i);
    expect(all).not.toMatch(/\bsla_clock\b|\bbreach\b|\bescalation\b/i);
    expect(all).not.toMatch(/reconcil/i);
  });

  it("ships exactly one migration of its own", () => {
    // Pinned by CONTENT: WES-4G legitimately adds a later migration, and
    // asserting "newest" would make every future phase edit this test.
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(files.filter((f) => /document_governance/.test(f))).toHaveLength(1);
  });

  it("leaves the canonical projection and progress formula untouched", () => {
    const p = code("lib/workflow/projection.ts");
    expect(p).not.toContain("document_review");
    expect(p).not.toContain("resolveEvidenceRequirements");
  });

  it("does not implement internal document generation (WES-4G, deferred)", () => {
    const s = sql();
    // The columns exist so the artifact metadata has a home; nothing generates.
    expect(s).toContain("source_sha256");
    // WES-4 itself generated nothing; WES-4G added the generator in its own
    // migration, which is where that event now lives.
    expect(s).not.toMatch(/INTERNAL_DOCUMENT_GENERATED/);
  });
});
