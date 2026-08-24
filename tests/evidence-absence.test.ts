/**
 * C-3 — audited declared absence of evidence (ratified 2026-08-24).
 * ---------------------------------------------------------------------------
 * Step 3 requires four documents, but three of them exist only when the dossier
 * actually has that thing — a third-party payable, an advance expense, an
 * Effitrans-run transport. Enforcing them unconditionally made legitimate
 * dossiers impossible to complete, and step 3 gates the Transit handoff, so the
 * whole journey stopped there. The remedy is the « Sans devis » idiom
 * generalised: a declaration on the record, with a motif and an author.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  DECLARABLE_EVIDENCE_KEYS,
  NON_DECLARABLE_EVIDENCE_KEYS,
  isDeclarableEvidence,
  validateAbsenceReason,
  absenceLabelFr,
  MAX_ABSENCE_REASON,
} from "@/lib/process/evidence-absence";
import { checkEvidence, type EvidenceSnapshot } from "@/lib/process/engine/evidence";
import { getStep } from "@/lib/process/effitrans-process";
import { CONTROL_OWNING_STEP } from "@/lib/process/control-gate";
import { validateAuditEvent } from "@/lib/audit/validate";
import { AuditActions } from "@/lib/audit/events";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const action = read("../lib/process/evidence-absence-actions.ts");
const migration = read("../supabase/migrations/20260915000001_evidence_absence_declaration.sql");

const snap = (absences: { key: string; reason: string }[]): EvidenceSnapshot => ({
  fileType: "IMP",
  declaredAbsences: absences,
  access: { documents: true, customs: true, transport: true, finance: true },
  documents: [],
  customs: null,
  transport: null,
  invoices: [],
});

describe("C-3 — the ratified scope, and only that", () => {
  it("declarable is exactly the three ratified types", () => {
    expect([...DECLARABLE_EVIDENCE_KEYS].sort()).toEqual(
      ["SPENDING_AUTHORIZATION", "TRANSPORT_REQUEST", "VENDOR_INVOICE"],
    );
  });

  it("BORDEREAU_LIVRAISON and step-18 receipts are never declarable", () => {
    for (const key of ["BORDEREAU_LIVRAISON", "RECEIPT", "PAYMENT_PROOF"]) {
      expect(isDeclarableEvidence(key), key).toBe(false);
      expect(NON_DECLARABLE_EVIDENCE_KEYS, key).toContain(key);
    }
  });

  it("a declaration for a NON-declarable type satisfies nothing", () => {
    // Even if a row somehow existed, resolution refuses to honour it.
    const s = snap([{ key: "BORDEREAU_LIVRAISON", reason: "pas de BL" }]);
    expect(checkEvidence("BORDEREAU_LIVRAISON", s).status).not.toBe("satisfied");
  });

  it("the database refuses non-declarable types and blank reasons too", () => {
    expect(migration).toContain("evidence_key in ('VENDOR_INVOICE', 'SPENDING_AUTHORIZATION', 'TRANSPORT_REQUEST')");
    expect(migration).toContain("length(btrim(reason)) > 0");
    expect(migration).toContain("MIGRATION FAILED: a non-declarable evidence type was accepted");
    expect(migration).toContain("MIGRATION FAILED: a blank reason was accepted");
  });
});

describe("C-3 — a declaration satisfies exactly one requirement", () => {
  it("satisfies the key it names, carrying the motif", () => {
    const s = snap([{ key: "VENDOR_INVOICE", reason: "aucun débours tiers sur ce dossier" }]);
    const item = checkEvidence("VENDOR_INVOICE", s);
    expect(item.status).toBe("satisfied");
    expect(item.detail).toBe("Sans objet — aucun débours tiers sur ce dossier");
  });

  it("does NOT satisfy the other requirements of the same step", () => {
    const s = snap([{ key: "VENDOR_INVOICE", reason: "aucun débours" }]);
    for (const other of ["TRANSPORT_REQUEST", "SPENDING_AUTHORIZATION", "BORDEREAU_LIVRAISON"]) {
      expect(checkEvidence(other, s).status, other).not.toBe("satisfied");
    }
  });

  it("no declaration means no change — evidence stays as strict as before", () => {
    for (const key of DECLARABLE_EVIDENCE_KEYS) {
      expect(checkEvidence(key, snap([])).status, key).not.toBe("satisfied");
    }
  });

  it("fabricates no document — the snapshot's document list stays empty", () => {
    const s = snap([{ key: "TRANSPORT_REQUEST", reason: "transport organisé par le client" }]);
    expect(s.documents).toHaveLength(0);
    expect(checkEvidence("TRANSPORT_REQUEST", s).status).toBe("satisfied");
  });
});

describe("C-3 — the motif is mandatory and bounded", () => {
  it("empty or whitespace-only is refused", () => {
    for (const bad of ["", "   ", "\n\t "]) {
      expect(validateAbsenceReason(bad)).toEqual({ ok: false, error: "reason_required" });
    }
    expect(validateAbsenceReason(null)).toEqual({ ok: false, error: "reason_required" });
  });

  it("a real motif is normalised and bounded", () => {
    const r = validateAbsenceReason("  aucun   débours\n tiers  ");
    expect(r).toEqual({ ok: true, reason: "aucun débours tiers" });
    const long = validateAbsenceReason("x".repeat(MAX_ABSENCE_REASON + 50));
    expect(r.ok && long.ok && long.reason.length).toBe(MAX_ABSENCE_REASON);
  });

  it("the label makes the waiver legible to a later reviewer", () => {
    expect(absenceLabelFr("transport client")).toBe("Sans objet — transport client");
  });
});

describe("C-3 — the write path is gated like every other mutation", () => {
  it("checks the ratified list and the motif BEFORE any I/O", () => {
    const declarableIdx = action.indexOf("isDeclarableEvidence(evidenceKey)");
    const permIdx = action.indexOf("assertPermission(");
    expect(declarableIdx).toBeGreaterThan(-1);
    expect(declarableIdx).toBeLessThan(permIdx);
    expect(action).toContain('return { ok: false, error: "evidence_not_declarable" }');
  });

  it("requires the permission AND the open step", () => {
    expect(action).toContain('assertPermission("file:create")');
    expect(action).toContain('assertControlStep("evidence.declare_absence", fileId, user.tenantId, user.id)');
    expect(action).toContain("if (gate) return { ok: false, error: gate };");
    // …and the gate points at step 3, which owns all three declarable types.
    expect(CONTROL_OWNING_STEP["evidence.declare_absence"]).toBe("am_dossier_opening");
    for (const key of DECLARABLE_EVIDENCE_KEYS) {
      expect(getStep("am_dossier_opening")!.requiredDocuments, key).toContain(key);
    }
  });

  it("is attributed and audited — with an event the real validator accepts", () => {
    expect(action).toContain("action: AuditActions.EVIDENCE_ABSENCE_DECLARED");
    expect(action).toContain("actorId: user.id");
    expect(() =>
      validateAuditEvent({
        action: AuditActions.EVIDENCE_ABSENCE_DECLARED,
        actorId: "22222222-2222-2222-2222-222222222222",
        entityId: "11111111-1111-1111-1111-111111111111",
      }),
    ).not.toThrow();
  });

  it("is tenant-scoped, visible to reviewers, and has no client write path", () => {
    expect(action).toContain("tenant_id: user.tenantId");
    expect(action).toContain("isFileVisible(user.id, user.tenantId, fileId)");
    // Readable by anyone who may read the dossier…
    expect(migration).toContain("using (tenant_id = public.auth_tenant_id() and public.can_read_file(file_id))");
    // …but writable only through the service role, i.e. only through this action.
    expect(migration).toContain("grant select on public.evidence_absence_declaration to authenticated;");
    expect(migration).not.toMatch(/for insert to authenticated/i);
  });

  it("is registered in the tenant-table guard", () => {
    expect(read("../lib/db/tenant-tables.ts")).toContain('"evidence_absence_declaration"');
  });
});
