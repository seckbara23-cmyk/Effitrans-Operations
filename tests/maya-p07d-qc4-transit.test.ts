/**
 * MAYA-P0.7-D — Contrôle Qualité N°4 (Opérations Transit).
 * ---------------------------------------------------------------------------
 * Seven controls. Three derive from authoritative facts, one derives a duration
 * with no threshold to judge it by, and three cannot be represented at all —
 * each for a reason the census established rather than assumed.
 *
 * Five properties this suite defends:
 *
 *   1. « SYNCHRONISÉ » IS NEVER CLAIMED. GAINDE has no API contract and ORBUS
 *      has no model; a customs reference is reported WITH ITS PROVENANCE.
 *   2. ELAPSED TIME IS NOT COMPLIANCE. Every relevant SLA policy is
 *      `unconfigured`, and the registry forbids a late status for those.
 *   3. RESTRICTED IS NOT ABSENT. No customs:read ⇒ no BAE, no GAINDE reference,
 *      no delay. No document:read ⇒ no tally.
 *   4. THE BAE IS REFERENCED, NEVER COPIED.
 *   5. NOTHING ELSE MOVED. QC1/QC2/QC3 intact, no migration, no workflow.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  deriveQC4, slaPolicy, describeThreshold, hoursBetween, formatHours, baeDocumentState,
  QC4_NO_CHECKLIST, QC4_NO_VALIDATION_RECORD, QC4_NO_TRANSMISSION_FACT,
  QC4_VALIDATION_IS_NOT_A_VERDICT,
  type QC4Input,
} from "@/lib/files/qc4";
import type { DocumentItem } from "@/lib/documents/types";
import type { CustomsRecord } from "@/lib/customs/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const PURE = "lib/files/qc4.ts";
const PANEL = "components/files/qc4-panel.tsx";
const PAGE = "app/files/[id]/page.tsx";
const TZ = "Africa/Dakar";

const doc = (typeCode: string, status: string, id = String(Math.random())): DocumentItem => ({
  id, fileId: "f1", typeCode, typeLabel: typeCode, title: null,
  status: status as DocumentItem["status"], version: 1, expiryDate: null,
  expiryState: "none" as DocumentItem["expiryState"], mimeType: null, sizeBytes: null,
  uploadedByEmail: null, reviewedByEmail: null, reviewNote: null, sharedWithClient: false,
  createdAt: "2026-08-12T09:00:00.000Z",
});

const customs = (over: Partial<CustomsRecord> = {}): CustomsRecord => ({
  id: "c1", fileId: "f1", status: "RELEASED", required: true,
  declarationNumber: "IM4-2026-88123", customsOffice: "DKR", regime: null,
  declarationDate: "2026-08-10T08:00:00.000Z", baeReference: "BAE-2026-556",
  releaseDate: "2026-08-11T01:00:00.000Z", inspectionStatus: "NOT_REQUIRED",
  externalRef: "GND-77421", notes: null,
  receivabilityStatus: null, receivabilityAt: null, receivabilityNote: null,
  providerCode: "manual", providerSyncedAt: null,
  reviewedAt: null, reviewedByEmail: null, ...over,
});

const input = (over: Partial<QC4Input> = {}): QC4Input => ({
  canReadCustoms: true, canReadDocuments: true, customs: customs(),
  documents: [], missingRequiredCount: 0, timeZone: TZ, ...over,
});

const byKey = (e: ReturnType<typeof deriveQC4>, k: string) => e.controls.find((c) => c.key === k)!;

// ===========================================================================
describe("all seven controls of the manual are accounted for", () => {
  it("each control is present, in the manual's wording", () => {
    const labels = deriveQC4(input()).controls.map((c) => c.labelFr);
    for (const l of ["Respect checklist", "Exactitude des informations", "Conformité documentaire",
                     "Suivi ORBUS / GAINDE", "Obtention du BAE",
                     "Transmission rapide des documents", "Respect du délai interne"]) {
      expect(labels, l).toContain(l);
    }
  });
});

// ===========================================================================
describe("nothing is invented where Effitrans defined nothing", () => {
  it("no Transit checklist is manufactured", () => {
    const c = byKey(deriveQC4(input()), "checklist");
    expect(c.state).toBe("not_represented");
    expect(c.reason).toBe(QC4_NO_CHECKLIST);
    // No checklist engine, item list or completion model exists in the module.
    const s = code(PURE);
    expect(s).not.toMatch(/CHECKLIST_ITEMS|checklistItems|completeChecklist/);
  });

  it("no accuracy score, percentage or green indicator is produced", () => {
    const c = byKey(deriveQC4(input()), "informationAccuracy");
    expect(c.state).toBe("absent");
    expect(c.reason).toBe(QC4_NO_VALIDATION_RECORD);
    const s = code(PURE);
    expect(s).not.toMatch(/accuracyScore|percent|scorePct|isAccurate/i);
  });

  it("the validation gap is CLOSED by P0.8-A — the pin fired as designed", () => {
    // This test previously asserted that NOTHING consumed customs:validate and
    // that reviewed_by was never written. MAYA-P0.8-A (PG-1) closed exactly
    // that gap, so the pin now asserts the new truth rather than the old one.
    const actions = code("lib/customs/actions.ts");
    expect(actions).toContain('assertPermission("customs:validate")');
    expect(actions).toContain("record_customs_validation");
    // What is STILL open is the business criterion, not the software.
    expect(QC4_NO_VALIDATION_RECORD).toMatch(/Chef de Transit/);
    expect(QC4_VALIDATION_IS_NOT_A_VERDICT).toMatch(/ne vaut pas conformité/);
  });

  it("no internal transmission fact is fabricated from client sharing", () => {
    const c = byKey(deriveQC4(input()), "documentTransmission");
    expect(c.state).toBe("not_represented");
    expect(c.reason).toBe(QC4_NO_TRANSMISSION_FACT);
    // shared_with_client is NOT reinterpreted as a Transit transmission.
    expect(code(PURE)).not.toMatch(/sharedWithClient|shared_with_client/);
  });

  it("never renders a conformity verdict", () => {
    for (const f of [PURE, PANEL]) {
      expect(code(f), f).not.toMatch(/\bconforme\b/i);
      // NOT a word ban: « Transmission rapide des documents » is the manual's
      // own label and is preserved verbatim. What must be absent is the
      // VERDICT — a speed judgement rendered as a value or computed as a flag.
      expect(code(f), f).not.toMatch(/isRapid|isFast|speedOk|withinTarget/i);
      expect(code(f), f).not.toMatch(/isLate|onTime|breached|overdue/i);
    }
  });
});

// ===========================================================================
describe("ORBUS / GAINDE — provenance, never synchronisation", () => {
  it("reports the reference WITH its source", () => {
    const c = byKey(deriveQC4(input()), "customsTracking");
    expect(c.state).toBe("observed");
    expect(c.value).toContain("GND-77421");
    expect(c.value).toContain("saisie manuelle");
  });

  it("never claims a live link", () => {
    for (const f of [PURE, PANEL]) {
      expect(code(f), f).not.toMatch(/synchronis/i);
      expect(code(f), f).not.toMatch(/connected|live link|API GAINDE/i);
    }
    expect(byKey(deriveQC4(input()), "customsTracking").reason)
      .toMatch(/aucune intégration/i);
  });

  it("the platform really has no GAINDE integration — pinned", () => {
    const cfg = read("lib/customs/intelligence/config.ts");
    expect(cfg).toMatch(/there is NO official GAINDE API contract wired/);
    expect(cfg).toMatch(/GAINDE is therefore reported as[\s\S]{0,40}unsupported/);
  });

  it("a dossier with no reference reads ABSENT, not synchronised", () => {
    const c = byKey(deriveQC4(input({ customs: customs({ externalRef: null, declarationNumber: null }) })), "customsTracking");
    expect(c.state).toBe("absent");
    expect(c.value).toBeNull();
  });
});

// ===========================================================================
describe("BAE — referenced, never copied", () => {
  it("reports the authoritative reference and release date", () => {
    const c = byKey(deriveQC4(input()), "bae");
    expect(c.state).toBe("observed");
    expect(c.value).toContain("BAE-2026-556");
    expect(c.value).toContain("11/08/2026");
  });

  it("distinguishes a verified BAE document from a merely uploaded one", () => {
    expect(baeDocumentState([doc("BAE", "VERIFIED")])).toBe("verified");
    expect(baeDocumentState([doc("BAE", "UPLOADED")])).toBe("present_unverified");
    expect(baeDocumentState([doc("INVOICE", "VERIFIED")])).toBe("absent");
    const v = byKey(deriveQC4(input({ documents: [doc("BAE", "VERIFIED")] })), "bae");
    expect(v.value).toContain("pièce vérifiée");
    const u = byKey(deriveQC4(input({ documents: [doc("BAE", "UPLOADED")] })), "bae");
    expect(u.value).toContain("en attente de vérification");
  });

  it("stores no BAE fact of its own", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/quality_bae|baeObtainedAt|baeNumber\s*=/);
    // It reads the customs record's field; it never assigns one.
    expect(s).toContain("c.baeReference");
    expect(s).not.toMatch(/baeReference\s*=/);
  });

  it("a dossier without a BAE reads ABSENT, never failed", () => {
    const c = byKey(deriveQC4(input({ customs: customs({ baeReference: null }) })), "bae");
    expect(c.state).toBe("absent");
    expect(c.value).toBeNull();
  });
});

// ===========================================================================
describe("elapsed time is a fact; compliance is not claimed", () => {
  it("derives the declaration → BAE duration", () => {
    const c = byKey(deriveQC4(input()), "internalDelay");
    expect(c.state).toBe("observed");
    expect(c.value).toBe("Durée constatée : 17 h");
  });

  it("names the threshold state from the OFFICIAL registry, not a local number", () => {
    expect(byKey(deriveQC4(input()), "internalDelay").reason).toContain("seuil non configuré");
    // The registry really does leave it unconfigured.
    expect(slaPolicy("bae_followup")!.state).toBe("unconfigured");
    expect(slaPolicy("bae_followup")!.warningHours).toBeNull();
    expect(describeThreshold("bae_followup")).toBe("seuil non configuré");
  });

  it("an UNRATIFIED policy is labelled as such rather than presented as a target", () => {
    expect(slaPolicy("customs_preparation")!.state).toBe("unratified");
    expect(describeThreshold("customs_preparation")).toContain("non ratifié");
  });

  it("no hour threshold is hard-coded anywhere in the slice", () => {
    for (const f of [PURE, PANEL]) {
      const s = code(f);
      expect(s, f).not.toMatch(/\b(24|48|72|96|144)\s*(\*|h\b)/);
      expect(s, f).not.toMatch(/warningHours:\s*\d/);
    }
  });

  it("durations are honest arithmetic", () => {
    expect(hoursBetween("2026-08-10T08:00:00Z", "2026-08-11T01:00:00Z")).toBe(17);
    expect(hoursBetween("2026-08-11T01:00:00Z", "2026-08-10T08:00:00Z")).toBe(0);
    expect(hoursBetween("nope", "2026-08-11T01:00:00Z")).toBeNull();
    expect(formatHours(17)).toBe("17 h");
    expect(formatHours(24)).toBe("1 j");
    expect(formatHours(28)).toBe("1 j 4 h");
  });

  it("a dossier without both instants reports no duration", () => {
    expect(byKey(deriveQC4(input({ customs: customs({ releaseDate: null }) })), "internalDelay").state).toBe("absent");
  });
});

// ===========================================================================
describe("restricted is not absent", () => {
  it("without customs:read, no customs fact is disclosed at all", () => {
    const e = deriveQC4(input({ canReadCustoms: false }));
    for (const k of ["customsTracking", "bae", "internalDelay"]) {
      const c = byKey(e, k);
      expect(c.state, k).toBe("restricted");
      expect(c.value, k).toBeNull();
    }
    // The whole rendered evidence must not contain the restricted values.
    const rendered = JSON.stringify(e);
    expect(rendered).not.toContain("BAE-2026-556");
    expect(rendered).not.toContain("GND-77421");
    expect(rendered).not.toContain("IM4-2026-88123");
  });

  it("without document:read, there is no tally — never a zeroed one", () => {
    const e = deriveQC4(input({ canReadDocuments: false, documents: [doc("BAE", "VERIFIED")] }));
    expect(e.tally).toBeNull();
    expect(byKey(e, "documentaryConformity").state).toBe("restricted");
  });

  it("a permitted viewer with no documents reads ABSENT, not restricted", () => {
    expect(byKey(deriveQC4(input({ documents: [] })), "documentaryConformity").state).toBe("absent");
  });

  it("the BAE document annotation is omitted when documents are restricted", () => {
    const c = byKey(deriveQC4(input({ canReadDocuments: false })), "bae");
    // Customs is readable, so the reference shows — but nothing about documents.
    expect(c.value).toContain("BAE-2026-556");
    expect(c.value).not.toMatch(/pièce/);
  });

  it("the page passes BOTH real permission flags through", () => {
    const p = code(PAGE);
    expect(p).toMatch(/canReadCustoms,/);
    expect(p).toMatch(/canReadDocuments: canReadDocs/);
  });
});

// ===========================================================================
describe("pure derivation, no duplicate authority, no migration", () => {
  it("the module is PURE and names no table", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/supabase|\.from\(|\.rpc\(|await |server-only/);
    for (const t of ["customs_record", "document", "process_handoff", "task"]) {
      expect(s, t).not.toContain(`"${t}"`);
    }
  });

  it("it reuses the existing authorities rather than restating them", () => {
    const s = code(PURE);
    expect(s).toContain('from "@/lib/documents/doctrine"');
    expect(s).toContain('from "@/lib/process/sla-policies"');
    // The document tally is QC2's, not a second implementation.
    expect(s).toContain("tallyDocuments");
    expect(s).toContain("describeTally");
  });

  it("QC4 adds no query — and the tenant zone is read ONCE for all panels", () => {
    const p = code(PAGE);
    expect((p.match(/getTenantTimezone\(\)/g) ?? []).length).toBe(1);
    expect(p).toMatch(/deriveQC4\(\{/);
  });

  it("no migration was added by this phase", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    const declared = Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]);
    // DURABLE FORM. A literal count asserts "no migration exists anywhere",
    // which breaks the moment a LATER phase legitimately ships one — as
    // MAYA-P0.8-A did. What stays true is that the declared count matches the
    // files on disk, and that THIS phase contributed none of them.
    expect(migrations).toHaveLength(declared);
  });
});

// ===========================================================================
describe("nothing else moved", () => {
  it("no workflow, customs status or applicability change", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/changeCustomsStatus|process_instance|emitBusinessEvent|transition/i);
    for (const f of ["lib/process/applicability.ts", "lib/workflow/projection.ts", "lib/files/status.ts"]) {
      expect(code(f), f).not.toMatch(/qc4|deriveQC4/i);
    }
    // The SLA registry itself was not edited to suit QC4.
    expect(read("lib/process/sla-policies.ts")).toMatch(/state: "unconfigured", warningHours: null/);
  });

  it("QC3 recevabilité and its trust contract are untouched", () => {
    expect(code("lib/customs/receivability.ts")).toContain("RECEIVABILITY_OUTCOMES");
    expect(read("supabase/migrations/20260824000001_customs_receivability.sql"))
      .toMatch(/assert_actor_authority\(p_actor, v_tenant, 'customs:update', 'SERVICE'\)/);
    // QC4 does not reinterpret recevabilité as one of its own controls.
    expect(code(PURE)).not.toMatch(/receivab/i);
  });

  it("QC1 and QC2 are intact, with their gaps still open", () => {
    expect(code("lib/commercial/qc1.ts")).toContain("QC1_DEFERRED");
    const q2 = code("lib/files/qc2.ts");
    expect(q2).toContain("QC2_TRANSMISSION_CONFLICT");
    // The Account Manager conflict and identity gap remain UNRESOLVED.
    expect(q2).toMatch(/Coordinateur/);
    expect(code("lib/files/actions.ts")).toContain("account_manager_id: admin.id");
  });

  it("no Q5, Sage, client import or MAYA APPLY", () => {
    for (const f of [PURE, PANEL]) {
      const s = code(f);
      expect(s.toLowerCase(), f).not.toContain("groupage");
      expect(s, f).not.toMatch(/parent_file_id|dossiermere|maya_import|ninea|\bsage\b/i);
    }
  });

  it("no new permission was introduced", () => {
    expect(code(PURE)).not.toMatch(/assertPermission|hasPermission/);
  });
});
