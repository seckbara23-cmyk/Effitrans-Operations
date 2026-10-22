/**
 * CEO-ALIGNMENT WP1-A / WP1-B1 / WP1-C — commercial naming, customer PO,
 * expected customs regime.
 * ---------------------------------------------------------------------------
 * Pure behaviour where there is behaviour; structural assertions where the
 * property is « this path exists / this path does NOT exist ». Every structural
 * read strips comments first, so a sentence in a comment can never satisfy —
 * or fail — an assertion about code.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { validateFile } from "@/lib/files/validate";
import {
  CLIENT_PO_MAX,
  REGIME_DECLARED_MAX,
  clientPoDueForFileType,
  normalizeOpeningText,
  openingAdvisories,
  regimeDeclaredNoticeFr,
  validateOpeningFacts,
} from "@/lib/files/opening";
import { roleLabel } from "@/lib/navigation/roles";
import { TENANT_ROLE_TEMPLATES as ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { getStep } from "@/lib/process/effitrans-process";
import { CUSTOMS_REGIME_SUGGESTIONS } from "@/lib/customs/regime-suggestions";
import { t } from "@/lib/i18n";
import type { FileInput } from "@/lib/files/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (p: string) => read(p).replace(/--[^\n]*/g, "");

const base: FileInput = {
  type: "IMP",
  clientId: "11111111-1111-4111-8111-111111111111",
};

// ===================================================================== WP1-A
describe("WP1-A — « Business Development Manager » (DEC-CEO-01)", () => {
  it("the displayed name changed everywhere the platform names the role", () => {
    expect(roleLabel("QUOTATION_MANAGER")).toBe("Business Development Manager");
    const tpl = ROLE_TEMPLATES.find((r) => r.key === "QUOTATION_MANAGER");
    expect(tpl?.labelFr).toBe("Business Development Manager");
    expect(tpl?.labelEn).toBe("Business Development Manager");
    expect(read("supabase/seed.sql")).toContain(
      "('QUOTATION_MANAGER',     'Business Development Manager', 'Business Development Manager')",
    );
  });

  it("the technical identifier is untouched — key, template key, migration predicate", () => {
    expect(ROLE_TEMPLATES.some((r) => r.key === "QUOTATION_MANAGER")).toBe(true);
    expect(ROLE_TEMPLATES.some((r) => /BUSINESS/i.test(r.key))).toBe(false);
    const m = sql("supabase/migrations/20261021000001_role_label_business_development_manager.sql");
    // The migration sets LABELS, for ONE code, and never the code itself.
    expect(m).toMatch(/update\s+public\.role\s+set\s+label_fr\s*=\s*'Business Development Manager'/i);
    expect(m).toMatch(/code\s*=\s*'QUOTATION_MANAGER'/);
    // The SET list — and only the SET list — must not assign the code. (The
    // WHERE clause naming the code is the predicate, not a write.)
    const setList = (m.match(/\bset\b([\s\S]*?)\bwhere\b/i) ?? [])[1] ?? "";
    expect(setList).toMatch(/label_fr/);
    expect(setList).not.toMatch(/\bcode\b/);
    expect(m).not.toMatch(/\b(delete|insert|grant|revoke)\b/i);
  });

  it("the old wording survives in no code constant", () => {
    for (const f of ["lib/navigation/roles.ts", "lib/platform/role-templates.ts"]) {
      expect(code(f), f).not.toContain("Responsable des cotations");
      expect(code(f), f).not.toContain("Responsable cotation\"");
      expect(code(f), f).not.toContain("\"Quotation Manager\"");
    }
  });
});

// ===================================================================== WP1-B1
describe("WP1-B1 — the customer PO (DEC-CEO-02)", () => {
  it("is optional at creation: absence and blank are valid", () => {
    expect(validateFile(base)).toBeNull();
    expect(validateFile({ ...base, clientPoReference: "" })).toBeNull();
    expect(validateFile({ ...base, clientPoReference: "   " })).toBeNull();
    expect(validateFile({ ...base, clientPoReference: null })).toBeNull();
  });

  it("is bounded to the database CHECK (64), with a stable error code", () => {
    expect(CLIENT_PO_MAX).toBe(64);
    expect(validateFile({ ...base, clientPoReference: "x".repeat(64) })).toBeNull();
    expect(validateFile({ ...base, clientPoReference: "x".repeat(65) })).toBe("invalid_client_po_reference");
    expect(t.files.errors.invalid_client_po_reference).toBe("Le PO client ne peut pas dépasser 64 caractères.");
    const m = sql("supabase/migrations/20261021000002_file_client_po_and_regime.sql");
    expect(m).toMatch(/length\(client_po_reference\)\s*<=\s*64/);
  });

  it("normalises whitespace and never stores an empty string", () => {
    expect(normalizeOpeningText("  PO-4500 123  ")).toBe("PO-4500 123");
    expect(normalizeOpeningText("   ")).toBeNull();
    expect(normalizeOpeningText(undefined)).toBeNull();
  });

  it("is due for IMPORT dossiers only", () => {
    expect(clientPoDueForFileType("IMP")).toBe(true);
    for (const t2 of ["EXP", "TRP", "HND"]) expect(clientPoDueForFileType(t2)).toBe(false);
  });

  it("a missing PO is ONE non-blocking advisory, in the ratified register", () => {
    const a = openingAdvisories({ stored: true, type: "IMP", status: "OPENED", clientPoReference: null });
    expect(a).toHaveLength(1);
    expect(a[0].messageFr).toBe(
      "Information à compléter : PO client (ouverture du dossier, étape 3). Vous pouvez poursuivre les opérations autorisées.",
    );
    // Same opening words as requirementMessageFr's non-blocking register.
    expect(a[0].messageFr.startsWith("Information à compléter : ")).toBe(true);
    expect(a[0].messageFr).not.toMatch(/Action requise/);
  });

  it("asks for nothing when the PO exists, the type is not import, the dossier is closed, or the schema cannot store it", () => {
    expect(openingAdvisories({ stored: true, type: "IMP", status: "OPENED", clientPoReference: "PO-1" })).toEqual([]);
    expect(openingAdvisories({ stored: true, type: "EXP", status: "OPENED", clientPoReference: null })).toEqual([]);
    expect(openingAdvisories({ stored: true, type: "IMP", status: "CLOSED", clientPoReference: null })).toEqual([]);
    expect(openingAdvisories({ stored: true, type: "IMP", status: "CANCELLED", clientPoReference: null })).toEqual([]);
    expect(openingAdvisories({ stored: false, type: "IMP", status: "OPENED", clientPoReference: null })).toEqual([]);
  });

  it("is NOT a step-evidence requirement: step 3's ratified required set stays empty (PR-2 changes it, with DEC-CEO-19)", () => {
    // The queue marks a step `blocked` on ANY missing evidence regardless of
    // its leniency class, so a registry key here would read « Pièces
    // manquantes » on every import dossier. B1 must stay out of the engine.
    expect(getStep("am_dossier_opening")!.requiredDocuments).toEqual([]);
    expect(code("lib/process/engine/evidence.ts")).not.toContain("CLIENT_PO_REFERENCE");
    expect(code("lib/process/requirement-class.ts")).not.toContain("CLIENT_PO_REFERENCE");
    expect(code("lib/process/evidence-absence.ts")).not.toContain("CLIENT_PO_REFERENCE");
  });

  it("is written only when the schema can hold it (N-1 compatible), and audited", () => {
    const a = code("lib/files/actions.ts");
    // Probed in BOTH writers before any statement names the columns.
    expect(a.match(/await openingFieldsStored\(\)/g) ?? []).toHaveLength(2);
    expect(a).toContain("const opening = openingStored ? openingFacts(input) : {};");
    expect(a).toContain("...(opening as object),");
    // The update reads the stored values for the before/after diff, on its own
    // narrow select, tenant-scoped.
    expect(a).toContain('.select("client_po_reference, customs_regime_declared" as never)');
    expect(a).toContain("diff({ ...(existing as Record<string, unknown>), ...(existingOpening ?? {}) }, nextFile, \"\");");
    // The shared literal select stays literal (typed) and never names them.
    expect(a).toMatch(/\.select\("id, tenant_id, type, client_id, priority, parent_file_id, client_reference, on_behalf_of, processing_due_date"\)/);
  });

  it("is read on its own narrow select, behind the probe", () => {
    const s = code("lib/files/service.ts");
    const at = s.indexOf("if (await openingFieldsStored())");
    expect(at).toBeGreaterThan(-1);
    expect(s.slice(at, at + 400)).toContain('.select("client_po_reference, customs_regime_declared" as never)');
    // …and never inside getFile's shared literal projection.
    expect(s).not.toMatch(/"id, tenant_id, file_number[^"]*client_po_reference/);
  });

  it("the form offers the fields only when they can be stored", () => {
    const f = code("components/files/file-form.tsx");
    expect(f.match(/\{openingFieldsAvailable && \(/g) ?? []).toHaveLength(2);
    expect(f).toContain("...(openingFieldsAvailable ? { clientPoReference, customsRegimeDeclared } : {}),");
    expect(t.files.form.clientPoReference).toBe("PO client");
  });
});

// ====================================================================== WP1-C
describe("WP1-C — the expected customs regime (DEC-CEO-03)", () => {
  it("is optional and bounded to its CHECK (80)", () => {
    expect(REGIME_DECLARED_MAX).toBe(80);
    expect(validateOpeningFacts({ customsRegimeDeclared: "x".repeat(80) })).toBeNull();
    expect(validateFile({ ...base, customsRegimeDeclared: "x".repeat(81) })).toBe("invalid_customs_regime_declared");
  });

  it("lives on the DOSSIER, never on the governed customs record", () => {
    const m = sql("supabase/migrations/20261021000002_file_client_po_and_regime.sql");
    expect(m).toMatch(/alter\s+table\s+public\.operational_file/i);
    // No STATEMENT acts on the governed record. (Its name may appear inside a
    // column comment's string, which documents the separation.)
    expect(m).not.toMatch(/\b(alter\s+table|update|insert\s+into|delete\s+from)\s+public\.customs_record\b/i);
    expect(m).not.toMatch(/\bon\s+public\.customs_record\b/i);
    // The file actions build the opening facts without touching customs.
    const a = code("lib/files/actions.ts");
    const fn = a.slice(a.indexOf("function openingFacts("), a.indexOf("export async function createFile"));
    expect(fn).not.toMatch(/customs_record|\bregime:/);
  });

  it("is shown READ-ONLY to Transit and never pre-fills the Déclarant's field", () => {
    const p = code("components/customs/customs-panel.tsx");
    expect(p).toContain("const regimeNotice = regimeDeclaredNoticeFr(regimeDeclared);");
    expect(p.match(/\{regimeNotice && <p className="text-xs text-slate-600">\{regimeNotice\}<\/p>\}/g) ?? []).toHaveLength(2);
    // The governed field still defaults to the GOVERNED value only.
    expect(p).toContain('defaultValue={record.regime ?? ""}');
    expect(p).not.toMatch(/defaultValue=\{[^}]*regimeDeclared/);
    expect(p).not.toMatch(/updateCustoms\([^)]*regimeDeclared/);
    expect(regimeDeclaredNoticeFr("Mise à la consommation")).toBe(
      "Régime douanier prévu à l'ouverture : Mise à la consommation — information préliminaire des Opérations, non déclarative.",
    );
    expect(regimeDeclaredNoticeFr("  ")).toBeNull();
  });

  it("grants the Account Manager no customs authority", () => {
    const am = ROLE_TEMPLATES.find((r) => r.key === "ACCOUNT_MANAGER")!;
    for (const p of ["customs:update", "customs:validate", "customs:correct", "customs:revalidate", "customs:release"]) {
      expect(am.permissions, p).not.toContain(p);
    }
    // The seed grants customs:update to the customs chain, not to the AM.
    const seed = read("supabase/seed.sql");
    const grant = seed.slice(seed.indexOf("join public.permission p on p.code in ('customs:create', 'customs:update')"));
    const roles = grant.slice(0, grant.indexOf("on conflict"));
    expect(roles).not.toContain("ACCOUNT_MANAGER");
  });

  it("both regime fields propose the SAME suggestions (one shared list)", () => {
    expect(CUSTOMS_REGIME_SUGGESTIONS).toContain("Mise à la consommation");
    expect(code("components/customs/customs-panel.tsx")).toContain("const REGIMES = CUSTOMS_REGIME_SUGGESTIONS;");
    expect(code("components/files/file-form.tsx")).toContain("CUSTOMS_REGIME_SUGGESTIONS.map(");
  });
});

// ================================================== the schema probes (N-1)
describe("WP1 schema probes — the ratified shape (OPS-UAT-CONVERGENCE-01 §19)", () => {
  for (const probe of ["lib/files/opening-fields-158.ts", "lib/ec/ingest/message-provenance-160.ts"]) {
    it(`${probe}: one column, one SQLSTATE, zero rows, per request, marked for deletion`, () => {
      const src = code(probe);
      expect(src).toContain('const UNDEFINED_COLUMN = "42703"');
      expect(src).toContain("if (error.code === UNDEFINED_COLUMN) return false;");
      expect(src).toContain(".limit(0)");
      expect(src).toContain('import { cache } from "react"');
      expect(src).not.toContain("try {");
      expect(src).not.toContain("catch");
      expect(read(probe)).toContain("DELETE THIS FILE");
      expect(read("tests/tenant-scope.test.ts")).toContain(`"${probe}::`);
    });
  }

  it("lib/documents/expiry-governance-161.ts: a TABLE probe, exactly two « not applied » codes", () => {
    const src = code("lib/documents/expiry-governance-161.ts");
    expect(src).toContain('const UNDEFINED_RELATION_POSTGREST = "PGRST205"');
    expect(src).toContain('const UNDEFINED_RELATION = "42P01"');
    expect(src).toContain(".limit(0)");
    expect(src).toContain('import { cache } from "react"');
    expect(src).not.toContain("try {");
    expect(src).not.toContain("catch");
    expect(src).toMatch(/throw new Error\(`\[documents\] expiry-governance schema probe failed:/);
    expect(read("lib/documents/expiry-governance-161.ts")).toContain("DELETE THIS FILE");
    expect(read("tests/tenant-scope.test.ts")).toContain('"lib/documents/expiry-governance-161.ts::document_expiry_change"');
  });
});
