/**
 * MAYA-P0.7-C — Contrôle Qualité N°2 (Account Manager).
 * ---------------------------------------------------------------------------
 * The manual lists four controls. Two are derivable from authoritative facts,
 * two are not — and the reason one of them is not is a genuine CONFLICT between
 * two first-party Effitrans documents, recorded rather than resolved.
 *
 * Five properties this suite defends:
 *
 *   1. « OUVERT » IS NOT « OUVERT CORRECTEMENT ». Existence is never promoted
 *      into a pass; the missing criterion is stated.
 *   2. UPLOADED IS NOT VERIFIED. Counts run through the document authority's own
 *      `isVerified` predicate, so unreviewed uploads can never read as verified.
 *   3. RESTRICTED IS NOT ZERO. A viewer without `document:read` is told so, and
 *      is never shown "0 documents".
 *   4. THE TRANSMISSION CONFLICT IS NAMED, NOT SILENTLY DECIDED.
 *   5. NOTHING ELSE MOVED. No storage, no workflow, QC1 and QC3 intact.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  deriveQC2,
  tallyDocuments,
  describeTally,
  QC2_TRANSMISSION_CONFLICT,
  QC2_NO_PROCEDURE_CRITERIA,
  QC2_NO_OPENING_CRITERIA,
  type QC2Input,
} from "@/lib/files/qc2";
import type { DocumentItem } from "@/lib/documents/types";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const PURE = "lib/files/qc2.ts";
const PANEL = "components/files/qc2-panel.tsx";
const PAGE = "app/files/[id]/page.tsx";
const TZ = "Africa/Dakar";

const doc = (status: string, id = String(Math.random())): DocumentItem => ({
  id, fileId: "f1", typeCode: "BL", typeLabel: "Connaissement", title: null,
  status: status as DocumentItem["status"], version: 1, expiryDate: null,
  expiryState: "none" as DocumentItem["expiryState"], mimeType: null, sizeBytes: null,
  uploadedByEmail: null, reviewedByEmail: null, reviewNote: null, sharedWithClient: false,
  createdAt: "2026-08-12T09:00:00.000Z",
});

const input = (over: Partial<QC2Input> = {}): QC2Input => ({
  fileNumber: "EFT-IMP-2026-00042",
  createdAt: "2026-08-12T09:14:00.000Z",
  clientName: "Dakar Trading",
  canReadDocuments: true,
  documents: [],
  missingRequiredCount: 0,
  timeZone: TZ,
  ...over,
});

const byKey = (e: ReturnType<typeof deriveQC2>, k: string) => e.controls.find((c) => c.key === k)!;

// ===========================================================================
describe("the four controls of the manual are all accounted for", () => {
  it("each control the manual lists is present", () => {
    const labels = deriveQC2(input()).controls.map((c) => c.labelFr);
    for (const l of ["Ouverture du dossier", "Vérification des documents",
                     "Transmission aux opérations", "Respect des procédures"]) {
      expect(labels, l).toContain(l);
    }
  });
});

// ===========================================================================
describe("« ouvert » is not « ouvert correctement »", () => {
  it("reports the opening as a FACT, with number, date and client", () => {
    const c = byKey(deriveQC2(input()), "dossierOpened");
    expect(c.state).toBe("observed");
    expect(c.value).toContain("EFT-IMP-2026-00042");
    expect(c.value).toContain("09:14");
    expect(c.value).toContain("Dakar Trading");
  });

  it("states that no additional correctness criterion is configured", () => {
    expect(byKey(deriveQC2(input()), "dossierOpened").reason).toBe(QC2_NO_OPENING_CRITERIA);
    expect(QC2_NO_OPENING_CRITERIA).toMatch(/aucun critère/i);
  });

  it("never promotes existence into a pass", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/\bconforme\b/i);
    expect(s).not.toMatch(/isCorrect|correctlyOpened|openingValid|passed/i);
  });
});

// ===========================================================================
describe("uploaded is not verified", () => {
  it("an unreviewed upload counts as received and pending, never verified", () => {
    const t = tallyDocuments([doc("UPLOADED")], 0);
    expect(t).toEqual({ received: 1, verified: 0, pendingReview: 1, rejected: 0, missingRequired: 0 });
  });

  it("verification uses the document authority's own predicate", () => {
    // VERIFIED and CONSUMED_AS_EVIDENCE both count; APPROVED is the legacy
    // alias the doctrine already canonicalises.
    expect(tallyDocuments([doc("VERIFIED")], 0).verified).toBe(1);
    expect(tallyDocuments([doc("CONSUMED_AS_EVIDENCE")], 0).verified).toBe(1);
    expect(tallyDocuments([doc("APPROVED")], 0).verified).toBe(1);
    expect(code(PURE)).toContain("isVerified");
    expect(code(PURE)).toContain("canonicalStatus");
  });

  it("rejected and pending stay distinguishable", () => {
    const t = tallyDocuments([doc("REJECTED"), doc("UNDER_REVIEW"), doc("VERIFIED")], 0);
    expect(t).toMatchObject({ received: 3, verified: 1, pendingReview: 1, rejected: 1 });
  });

  it("SUPERSEDED and EXPIRED are counted as received but in no judgement bucket", () => {
    // Inventing a bucket for them would be a second document vocabulary.
    const t = tallyDocuments([doc("SUPERSEDED"), doc("EXPIRED")], 0);
    expect(t).toMatchObject({ received: 2, verified: 0, pendingReview: 0, rejected: 0 });
  });

  it("missing REQUIRED documents come from the catalog, not from a guess", () => {
    const t = tallyDocuments([doc("VERIFIED")], 3);
    expect(t.missingRequired).toBe(3);
    // The module never decides WHICH documents are required.
    const s = code(PURE);
    expect(s).not.toMatch(/required_for|REQUIRED_DOCS|documentCatalog/);
  });

  it("the tally reads as a sentence, omitting empty buckets", () => {
    expect(describeTally({ received: 6, verified: 5, pendingReview: 1, rejected: 0, missingRequired: 0 }))
      .toBe("6 reçus · 5 vérifiés · 1 en attente");
    expect(describeTally({ received: 1, verified: 1, pendingReview: 0, rejected: 0, missingRequired: 0 }))
      .toBe("1 reçu · 1 vérifié");
  });
});

// ===========================================================================
describe("restricted is not zero", () => {
  it("a viewer without document:read gets NO tally at all", () => {
    const e = deriveQC2(input({ canReadDocuments: false, documents: [doc("VERIFIED")] }));
    expect(e.tally).toBeNull();
    const c = byKey(e, "documentsVerified");
    expect(c.state).toBe("restricted");
    expect(c.value).toBeNull();
  });

  it("a permitted viewer with genuinely no documents reads ABSENT, not restricted", () => {
    const c = byKey(deriveQC2(input({ canReadDocuments: true, documents: [] })), "documentsVerified");
    expect(c.state).toBe("absent");
  });

  it("the page passes the real permission through rather than assuming it", () => {
    const p = code(PAGE);
    expect(p).toMatch(/canReadDocuments: canReadDocs/);
    expect(p).toMatch(/const canReadDocs = hasPermission\(permissions, "document:read"\)/);
  });

  it("the panel renders the two absences differently", () => {
    const p = read(PANEL);
    expect(p).toContain("Non visible avec vos accès");
    expect(p).toContain("Non renseigné");
    expect(p).toContain("Non suivi par la plateforme");
  });
});

// ===========================================================================
describe("the transmission conflict is named, not decided", () => {
  it("transmission is reported as not represented, with the conflict stated", () => {
    const c = byKey(deriveQC2(input()), "transmissionToOperations");
    expect(c.state).toBe("not_represented");
    expect(c.value).toBeNull();
    expect(c.reason).toBe(QC2_TRANSMISSION_CONFLICT);
  });

  it("the stated conflict names BOTH directions, so neither is silently chosen", () => {
    expect(QC2_TRANSMISSION_CONFLICT).toMatch(/manuel qualité/i);
    expect(QC2_TRANSMISSION_CONFLICT).toMatch(/Account Manager/);
    expect(QC2_TRANSMISSION_CONFLICT).toMatch(/Coordinateur/);
  });

  it("the platform's canonical process really does run the other way", () => {
    // The evidence behind the conflict, pinned so it cannot drift unnoticed.
    const reg = read("lib/process/effitrans-process.ts");
    expect(reg).toMatch(/key: "operations_intake"[\s\S]{0,400}department: "operations"/);
    expect(reg).toMatch(/key: "am_dossier_opening"[\s\S]{0,400}department: "account_management"/);
    // Slice the actual step block rather than guessing a character distance —
    // the registry entries carry long descriptions and audit verdicts.
    const amStep = reg.slice(reg.indexOf('key: "am_dossier_opening"'), reg.indexOf('key: "coordinator_reception"'));
    expect(amStep).toContain('department: "account_management"');
    expect(amStep).toContain('nextSteps: ["coordinator_reception"]');
    expect(amStep).not.toMatch(/nextSteps: \[[^\]]*operations/);
  });

  it("neither handoff mechanism can express « aux opérations »", () => {
    // task.handoff_type has four values and none is Operations.
    const rules = read("lib/handoffs/rules.ts");
    expect(rules).toContain('"CUSTOMS_HANDOFF" | "TRANSPORT_HANDOFF" | "FINANCE_HANDOFF" | "ARCHIVE_HANDOFF"');
    expect(rules).not.toMatch(/OPERATIONS_HANDOFF|ACCOUNT_MANAGER_HANDOFF/);
  });

  it("no second 'transmitted to operations' flag was invented", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/transmittedAt|transmitted_to|operationsTransmitted|handoffDone/i);
  });
});

// ===========================================================================
describe("procedures are not evaluated, because no référentiel exists", () => {
  it("reports not-evaluated with the reason", () => {
    const c = byKey(deriveQC2(input()), "procedures");
    expect(c.state).toBe("not_represented");
    expect(c.reason).toBe(QC2_NO_PROCEDURE_CRITERIA);
    expect(QC2_NO_PROCEDURE_CRITERIA).toMatch(/non évalué/i);
  });

  it("no procedure catalog, rule set or compliance check was invented", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/PROCEDURES\s*=|procedureCatalog|complianceRule|ruleSet/);
  });
});

// ===========================================================================
describe("pure derivation, no new storage, no extra dossier query", () => {
  it("the module is PURE — no database, no client, no action", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/supabase|\.from\(|\.rpc\(|await |server-only|use server/);
  });

  it("it reads the authorities rather than redefining them", () => {
    const s = code(PURE);
    expect(s).toContain('from "@/lib/documents/doctrine"');
    expect(s).toContain('from "@/lib/operations/kpi/windows"');
    // No table is named anywhere.
    for (const t of ["operational_file", "document", "process_handoff", "task"]) {
      expect(s, t).not.toContain(`"${t}"`);
    }
  });

  it("QC2 derives from data the page already loaded", () => {
    const p = code(PAGE);
    expect(p).toMatch(/deriveQC2\(\{/);
    expect(p).toMatch(/documents,/);
    expect(p).toMatch(/missingRequiredCount: missingDocs\.length/);
  });

  it("the only added read is the tenant zone, and it is gated and tenant-scoped", () => {
    const svc = code("lib/files/service.ts");
    const body = svc.slice(svc.indexOf("export async function getTenantTimezone"));
    const fn = body.slice(0, body.indexOf("export async function", 1));
    expect(fn).toContain('assertPermission("file:read")');
    expect(fn).toContain('.eq("id", user.tenantId)');
    expect(fn).toContain("resolveTimezone");
    // It cannot read another tenant's row by construction.
    expect(fn).not.toMatch(/tenantId:\s*string/);
  });

  it("instants render in the TENANT's zone, via the one tenant-time mechanic", () => {
    const a = deriveQC2(input({ createdAt: "2026-08-12T23:30:00.000Z", timeZone: "Africa/Dakar" }));
    const b = deriveQC2(input({ createdAt: "2026-08-12T23:30:00.000Z", timeZone: "Asia/Dubai" }));
    expect(byKey(a, "dossierOpened").value).toContain("12/08/2026 23:30");
    expect(byKey(b, "dossierOpened").value).toContain("13/08/2026 03:30");
    expect(code(PURE)).toContain("formatTenantInstant");
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
    expect(migrations.filter((f) => /qc2|quality|account_manager/i.test(f))).toEqual([]);
  });
});

// ===========================================================================
describe("nothing else moved", () => {
  it("no workflow, lifecycle, closure or applicability change", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/process_instance|emitBusinessEvent|advance|transition/i);
    for (const f of ["lib/process/applicability.ts", "lib/workflow/projection.ts",
                     "lib/files/status.ts", "lib/files/closure.ts", "lib/files/lifecycle.ts"]) {
      expect(code(f), f).not.toMatch(/qc2|deriveQC2/i);
    }
  });

  it("QC1 is intact, and now shares the ONE tenant-instant formatter", () => {
    const q1 = code("lib/commercial/qc1.ts");
    expect(q1).toContain("QC1_DEFERRED");
    expect(q1).toContain("formatTenantInstant");
    // Its deferrals were not quietly closed here.
    expect(q1).toMatch(/acknowledgement:/);
    expect(q1).toMatch(/followUp:/);
    expect(q1).toMatch(/documentsReceived:/);
  });

  it("QC3 recevabilité and its trust contract are untouched", () => {
    expect(code("lib/customs/receivability.ts")).toContain("RECEIVABILITY_OUTCOMES");
    expect(read("supabase/migrations/20260824000001_customs_receivability.sql"))
      .toMatch(/assert_actor_authority\(p_actor, v_tenant, 'customs:update', 'SERVICE'\)/);
  });

  it("no Q5, MAYA APPLY or client import", () => {
    for (const f of [PURE, PANEL]) {
      expect(code(f).toLowerCase(), f).not.toContain("groupage");
      expect(code(f), f).not.toMatch(/parent_file_id|dossiermere|maya_import|ninea/i);
    }
  });

  it("no new permission was introduced", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/assertPermission|hasPermission/);
    const svc = code("lib/files/service.ts");
    const perms = new Set([...svc.matchAll(/assertPermission\("([^"]+)"\)/g)].map((m) => m[1]));
    for (const p of perms) {
      expect(["file:read", "file:assign", "transport:read"], p).toContain(p);
    }
  });
});
