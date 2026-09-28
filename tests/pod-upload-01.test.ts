/**
 * POD-UPLOAD-01 — the signed Bordereau de Livraison is findable.
 *
 * Nothing about the POD contract was broken. `DELIVERY_NOTE` is the signed
 * delivery note and the sole authority for transport receipt, step 17
 * reconciliation, billing readiness and closure; `BORDEREAU_LIVRAISON` is the
 * unsigned slip the pickup gate reads; `DRIVER_SIGNATURE` is the driver app's
 * own evidence kind. All three were, and remain, distinct.
 *
 * What was broken is that one code answered to two names. The 5.0D split
 * renamed the artefact in the registry and deliberately left the catalogue row
 * alone, so the dossier card said « Déposer le bordereau signé », step 17 said
 * « Bordereau de Livraison signé (POD) », and the dropdown offered « Bon de
 * livraison / POD » three rows below « Bordereau de Livraison (non signé) » —
 * the one entry that contained the words the operator had just read, and the
 * wrong artefact. On EFT-IMP-2026-00013 the signed bordereau was filed as
 * « Signature de livraison » and nothing advanced.
 *
 * These tests pin the repair AND — at least as deliberately — every part of the
 * contract that must not have moved.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { mapDocument, documentLabelForTypeCode, DOCUMENT_MAPPINGS } from "@/lib/process/documents";
import { documentDoctrine, isVerified } from "@/lib/documents/doctrine";
import { canReceivePod } from "@/lib/transport/gates";
import { podReceived, type EvidenceSnapshot } from "@/lib/process/engine/evidence";
import { evaluateBillingGate, evaluateClosureGate } from "@/lib/process/engine/gates";
import { LATEST_MIGRATION, MIGRATION_COUNT } from "@/lib/platform/ops/build-info";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Source with comments stripped — a pin must match CODE, never a comment. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const CARD = "components/transport/delivery-proof-panel.tsx";
const PANEL = "components/documents/documents-panel.tsx";
const REGISTRY = "lib/process/documents.ts";
const MIGRATION = "supabase/migrations/20261007000001_delivery_note_signed_label.sql";
const VERIFIER = "supabase/verifiers/20261007000001_delivery_note_signed_label.verify.sql";

const SIGNED_LABEL = "Bordereau de Livraison signé (POD)";
const UNSIGNED_LABEL = "Bordereau de Livraison (non signé)";

const snapshot = (docs: { typeCode: string; status: string }[]): EvidenceSnapshot => ({
  fileType: "IMP",
  access: { documents: true, customs: true, transport: true, finance: true },
  documents: docs,
  customs: null,
  transport: null,
  invoices: [],
});

// ===========================================================================
// 1 — the deep link carries the type
// ===========================================================================
describe("1 · « Déposer le bordereau signé » arrives with its document type", () => {
  it("1 — the button links to ?docType=DELIVERY_NOTE#documents", () => {
    const src = code(CARD);
    expect(src).toContain("`/files/${fileId}?docType=${POD.typeCode}#documents`");
    // Still the same anchor, so the existing scroll target keeps working.
    expect(src).toContain("#documents");
  });

  it("1b — the code comes from the registry, never spelled out in the component", () => {
    const src = code(CARD);
    expect(src).toContain('mapDocument("SIGNED_DELIVERY_NOTE")');
    expect(src).not.toContain('"DELIVERY_NOTE"');
    expect(mapDocument("SIGNED_DELIVERY_NOTE").typeCode).toBe("DELIVERY_NOTE");
  });

  it("1c — the VERIFY link is left alone: preselecting an upload type aids nobody there", () => {
    const src = code(CARD);
    const verify = src.slice(src.indexOf("Vérifier le bordereau") - 400, src.indexOf("Vérifier le bordereau"));
    expect(verify).toContain("#documents");
    expect(verify).not.toContain("docType");
  });

  it("1d — the panel still offers no upload or verify control of its own (UAT-1)", () => {
    const src = code(CARD);
    expect(src).not.toContain("uploadDocument");
    expect(src).not.toContain("verifyDocument");
    expect(src).not.toContain("<form");
    expect(src).not.toContain("<input");
  });
});

// ===========================================================================
// 2 — preselection, and its safe degradation
// ===========================================================================
describe("2 · the documents panel opens on the type it was asked for", () => {
  const src = code(PANEL);

  it("2 — a requested type is preselected", () => {
    expect(src).toContain('searchParams?.get("docType")');
    expect(src).toContain('defaultValue={expected?.code ?? ""}');
  });

  it("3 — with NO query parameter, the form opens exactly as before", () => {
    // `requestedType` null -> `expected` null -> defaultValue "" -> the
    // untouched « Sélectionner un type… » placeholder, and no hint.
    expect(src).toContain('const requestedType = searchParams?.get("docType") ?? null;');
    expect(src).toContain("const expected = requestedType ? (types.find((ty) => ty.code === requestedType) ?? null) : null;");
    expect(src).toContain('<option value="">{t.documents.selectType}</option>');
  });

  it("4 — an unknown, inactive or otherwise unoffered type is IGNORED", () => {
    // The validation is the offered list itself: `types` is already the active,
    // non-generatable catalogue, so anything absent from it degrades with no
    // special case to keep in sync.
    expect(src).toContain("types.find((ty) => ty.code === requestedType)");
    expect(code("lib/documents/service.ts")).toContain('.eq("active", true)');
    expect(code("lib/documents/service.ts")).toContain("!isGeneratableArtifact(t.code)");
  });

  it("5 — the hint names the expected document in the PROCESS vocabulary", () => {
    expect(src).toContain("documentLabelForTypeCode(expected.code) ?? expected.labelFr");
    expect(src).toContain("{t.documents.expectedType} : {expectedLabel}");
    expect(documentLabelForTypeCode("DELIVERY_NOTE")).toBe(SIGNED_LABEL);
    expect(read("lib/i18n.ts")).toContain('expectedType: "Type attendu"');
  });

  it("5b — the label is derived, not a second constant", () => {
    // The only French wording in the panel comes from i18n or the registry.
    expect(src).not.toContain(SIGNED_LABEL);
    expect(src).toContain("documentLabelForTypeCode");
  });

  it("6 — NOTHING is submitted automatically", () => {
    // The deep link chooses a value in a dropdown. It does not upload a file —
    // there isn't one — and it must never call the action on its own.
    expect(src).toContain("function onSubmit(e: React.FormEvent<HTMLFormElement>)");
    expect(src).toMatch(/onSubmit=\{onSubmit\}/);
    // No effect, no auto-click, no submit outside the user's own event.
    expect(src).not.toContain("useEffect");
    expect(src).not.toContain("requestSubmit");
    expect(src).not.toContain(".submit()");
    expect(src).not.toContain("autoSubmit");
    // `uploadDocument` is reached from exactly one place: the form handler.
    expect((src.match(/uploadDocument\(/g) ?? []).length).toBe(1);
  });

  it("6b — the field stays the operator's: uncontrolled, still changeable", () => {
    // `defaultValue`, never `value` — a controlled select with no onChange
    // would freeze the operator on the preselected type.
    expect(src).toMatch(/<select[\s\S]{0,200}defaultValue=/);
    expect(src).not.toMatch(/<select[\s\S]{0,200}\svalue=\{/);
    // Every catalogue entry is still offered.
    expect(src).toContain("{types.map((ty) => (");
  });
});

// ===========================================================================
// 7-9 — the POD authority, unchanged
// ===========================================================================
describe("7-9 · DELIVERY_NOTE remains the sole POD authority", () => {
  it("7 — a VERIFIED DELIVERY_NOTE is the POD, everywhere it is asked", () => {
    const snap = snapshot([{ typeCode: "DELIVERY_NOTE", status: "VERIFIED" }]);
    expect(podReceived(snap)).toBe(true);
    expect(canReceivePod(["DELIVERY_NOTE"])).toBe(true);
    expect(evaluateBillingGate([], snap).missing).not.toContain("pod_received");
    expect(evaluateClosureGate([], snap).requirements.find((r) => r.key === "pod_received")?.satisfied)
      .toBe(true);
  });

  it("7b — and the legacy/consumed verified statuses still count", () => {
    for (const status of ["VERIFIED", "APPROVED", "CONSUMED_AS_EVIDENCE"]) {
      expect(isVerified(status), status).toBe(true);
      expect(podReceived(snapshot([{ typeCode: "DELIVERY_NOTE", status }])), status).toBe(true);
    }
    for (const status of ["UPLOADED", "UNDER_REVIEW", "REJECTED", "EXPIRED", "SUPERSEDED"]) {
      expect(podReceived(snapshot([{ typeCode: "DELIVERY_NOTE", status }])), status).toBe(false);
    }
  });

  it("8 — the UNSIGNED Bordereau de Livraison can never satisfy the POD", () => {
    const snap = snapshot([{ typeCode: "BORDEREAU_LIVRAISON", status: "VERIFIED" }]);
    expect(podReceived(snap)).toBe(false);
    expect(canReceivePod(["BORDEREAU_LIVRAISON"])).toBe(false);
    expect(evaluateBillingGate([], snap).missing).toContain("pod_received");
    expect(evaluateClosureGate([], snap).requirements.find((r) => r.key === "pod_received")?.detail)
      .toBe("no_approved_pod");
    // …and it keeps its OWN name and its own authority.
    expect(mapDocument("BORDEREAU_LIVRAISON").labelFr).toBe(UNSIGNED_LABEL);
    expect(mapDocument("BORDEREAU_LIVRAISON").typeCode).toBe("BORDEREAU_LIVRAISON");
  });

  it("9 — DRIVER_SIGNATURE can never satisfy the POD either (the 00013 mis-filing)", () => {
    const snap = snapshot([{ typeCode: "DRIVER_SIGNATURE", status: "VERIFIED" }]);
    expect(podReceived(snap)).toBe(false);
    expect(canReceivePod(["DRIVER_SIGNATURE"])).toBe(false);
    expect(evaluateBillingGate([], snap).missing).toContain("pod_received");
  });

  it("9b — DRIVER_SIGNATURE is untouched by this slice", () => {
    expect(code("lib/driver/event-kinds.ts")).toContain('signature: "DRIVER_SIGNATURE"');
    // Its own label is unchanged; only the `pod` kind — which uploads a
    // DELIVERY_NOTE — follows the document it actually files.
    expect(read("lib/i18n.ts")).toContain('signature: "Signature"');
    expect(code("lib/driver/event-kinds.ts")).toContain('pod: "DELIVERY_NOTE"');
  });
});

// ===========================================================================
// 10 — no second mechanism
// ===========================================================================
describe("10 · no second POD, upload, verification or state mechanism", () => {
  it("10 — the three files this slice touches perform no act of their own", () => {
    // The card READS `state.podReceived` and the transport status to decide what
    // to render — that is UAT-1's design and is left alone. What none of them
    // may do is PERFORM anything: no receipt, no review, no transition, no write.
    const touched = code(CARD) + code(PANEL) + code(REGISTRY);
    for (const forbidden of [
      "recordPodReceiptFromVerifiedEvidence",
      "review_document",
      "verifyDocument",
      "changeTransportStatus",
      "reconcileDossierProcess",
      "transport_record",
      "assertPermission",
      "getAdminSupabaseClient",
    ]) {
      expect(touched, forbidden).not.toContain(forbidden);
    }
    expect(touched).not.toMatch(/\.(insert|update|delete)\(/);
    // …and the only server action reached from any of them is the existing upload.
    expect(code(CARD)).not.toContain("uploadDocument");
    expect(code(REGISTRY)).not.toContain("uploadDocument");
  });

  it("10b — the POD receipt still fires from document verification alone", () => {
    const actions = code("lib/documents/actions.ts");
    expect(actions).toMatch(/if \(doc\.type_code === "DELIVERY_NOTE"\) \{[\s\S]{0,200}recordPodReceiptFromVerifiedEvidence/);
    // Exactly one CALL SITE (the import above it is not one).
    expect((actions.match(/await recordPodReceiptFromVerifiedEvidence\(/g) ?? []).length).toBe(1);
  });

  it("10c — maker-checker, permissions and the transport gate are untouched", () => {
    const actions = code("lib/documents/actions.ts");
    expect(actions).toContain('runReview(id, "VERIFIED", "document:approve", null, null)');
    expect(actions).toContain('assertPermission("document:create")');
    expect(code("lib/transport/gates.ts")).toContain('approvedDocTypeCodes.includes("DELIVERY_NOTE")');
    expect(code("lib/process/engine/evidence.ts")).toContain('mapDocument("SIGNED_DELIVERY_NOTE")');
  });

  it("10d — step 17 reconciliation still reads the same fact", () => {
    expect(code("lib/process/reconcile/satisfaction.ts")).toContain("transport_pod_handoff");
    expect(code("lib/process/reconcile/service.ts")).toContain('currentVerifiedDocument(supabase, input.tenantId, input.fileId, "DELIVERY_NOTE")');
    expect(code("lib/process/requirement-class.ts"))
      .toContain('"transport_pod_handoff::SIGNED_DELIVERY_NOTE": hard(OBJECT_OF_THE_ACT)');
  });
});

// ===========================================================================
// vocabulary — one code, one name
// ===========================================================================
describe("vocabulary · the signed POD has one name in code", () => {
  it("the registry, the doctrine and the reverse lookup all agree", () => {
    expect(mapDocument("SIGNED_DELIVERY_NOTE").labelFr).toBe(SIGNED_LABEL);
    expect(documentDoctrine("DELIVERY_NOTE")?.labelFr).toBe(SIGNED_LABEL);
    expect(documentLabelForTypeCode("DELIVERY_NOTE")).toBe(SIGNED_LABEL);
  });

  it("the doctrine row is otherwise unchanged", () => {
    const d = documentDoctrine("DELIVERY_NOTE");
    expect(d?.category).toBe("EXTERNAL_EVIDENCE");
    expect(d?.clientSafe).toBe(true);
    // WES-5C: a POD is transport-stage evidence and must never gate documentation.
    expect(d?.earliestStage).toBe("transport");
  });

  it("the two artefacts never share a name", () => {
    expect(documentLabelForTypeCode("BORDEREAU_LIVRAISON")).toBe(UNSIGNED_LABEL);
    expect(documentLabelForTypeCode("DELIVERY_NOTE")).not.toBe(documentLabelForTypeCode("BORDEREAU_LIVRAISON"));
  });

  it("the reverse lookup is first-wins and never fabricates a label", () => {
    // PAYMENT_RECEIPT is claimed by two registry keys — deterministic, not arbitrary.
    const claimants = DOCUMENT_MAPPINGS.filter((d) => d.typeCode === "PAYMENT_RECEIPT");
    expect(claimants.length).toBeGreaterThan(1);
    expect(documentLabelForTypeCode("PAYMENT_RECEIPT")).toBe(claimants[0].labelFr);
    // A code the process does not name gets null, so the caller falls back to
    // the catalogue's own wording rather than an invented one.
    expect(documentLabelForTypeCode("PICKUP_PHOTO")).toBeNull();
    expect(documentLabelForTypeCode("NOT_A_TYPE")).toBeNull();
  });
});

// ===========================================================================
// the catalogue migration
// ===========================================================================
describe("migration · the catalogue row is aligned, and nothing else", () => {
  const sql = read(MIGRATION);
  const verifier = read(VERIFIER);
  /** SQL with `--` comments stripped: a DDL ban must scan statements, not prose. */
  const stripSql = (s: string) => s.replace(/^\s*--.*$/gm, "");
  const sqlStatements = stripSql(sql);
  const verifierStatements = stripSql(verifier);

  it("renames exactly one row, in both languages", () => {
    expect(sql).toContain("update public.document_type");
    expect(sql).toContain("set label_fr = 'Bordereau de Livraison signé (POD)'");
    expect(sql).toContain("label_en = 'Signed delivery note (POD)'");
    expect(sql).toContain("where code = 'DELIVERY_NOTE'");
    expect((sql.match(/^\s*update public\.document_type/gm) ?? []).length).toBe(1);
  });

  it("is data-only: no schema, no RLS, no grant, no policy, no trigger", () => {
    for (const forbidden of [
      /create table/i, /alter table/i, /drop table/i, /add column/i,
      /create policy/i, /alter policy/i, /drop policy/i, /row level security/i,
      /\bgrant\b/i, /\brevoke\b/i, /create trigger/i, /create index/i, /create type/i,
    ]) {
      expect(sqlStatements, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it("touches no document row and no other type", () => {
    expect(sqlStatements).not.toMatch(/update\s+public\.document\b/);
    expect(sqlStatements).not.toMatch(/delete\s+from/i);
    expect(sqlStatements).not.toMatch(/insert\s+into/i);
    // BORDEREAU_LIVRAISON and DRIVER_SIGNATURE are read in assertions, never set.
    expect(sqlStatements).not.toMatch(/set[\s\S]{0,120}BORDEREAU_LIVRAISON/);
    expect(sqlStatements).not.toMatch(/set[\s\S]{0,120}DRIVER_SIGNATURE/);
  });

  it("refuses to record itself against a catalogue it did not change", () => {
    expect(sql).toContain("raise exception");
    expect(sql).toContain("is absent — the signed POD type must exist before it can be renamed");
    expect(sql).toContain("must keep its own label");
  });

  it("declares the default executor and controls no transaction", () => {
    expect(sql).toContain("-- migrate:executor db-query");
    expect(sqlStatements).not.toMatch(/\b(begin|commit|rollback)\b\s*;/i);
  });

  it("ships a read-only verifier returning the (ok, detail) contract", () => {
    expect(verifier).toMatch(/select\s+[\s\S]*bool_and\(ok\) as ok/);
    expect(verifier).toContain("detail");
    for (const forbidden of [/\binsert\b/i, /\bupdate\b/i, /\bdelete\b/i, /\bcreate\b/i, /\balter\b/i, /\bdrop\b/i, /\bgrant\b/i]) {
      expect(verifierStatements, String(forbidden)).not.toMatch(forbidden);
    }
    // A verifier's evidence is the SCHEMA, never the ledger.
    expect(verifier).not.toContain("supabase_migrations");
  });

  it("the verifier asserts the INVARIANT, not just the string", () => {
    expect(verifier).toContain("BORDEREAU_LIVRAISON keeps its own name");
    expect(verifier).toContain("no other document type answers to the signed POD");
    expect(verifier).toContain("DRIVER_SIGNATURE is untouched");
    expect(verifier).toContain("every document still points at a type the catalogue defines");
  });

  it("the verifier asserts ONLY what this migration establishes", () => {
    // It must not demand global label uniqueness: TRANSPORT_REQUEST and
    // DEMANDE_TRANSPORT have shared « Demande de transport » since 5.0D
    // (MAYA-P1.10 §5), so that check failed against production BEFORE this
    // migration and would have reported VERIFY_FAILED after a correct apply —
    // the #139 failure the policy records. Verified read-only against
    // production 2026-09-28: all eight blast-radius checks pass today; exactly
    // the three rename postconditions fail, because it is not applied yet.
    expect(verifier).not.toMatch(/group by label_fr\s+having count\(\*\) > 1/);
    expect(verifier).toContain("F-08");
  });

  it("build-info tracks the new migration in lockstep", () => {
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(MIGRATION_COUNT).toBe(files.length);
    expect(files.at(-1)).toBe(`${LATEST_MIGRATION}.sql`);
    expect(LATEST_MIGRATION).toBe("20261007000001_delivery_note_signed_label");
  });

  it("the application does not depend on it having been applied", () => {
    // The card preselects by CODE and the panel resolves the wording from the
    // registry, so the operator sees the right name before the catalogue moves.
    expect(code(CARD)).toContain("POD.typeCode");
    expect(code(PANEL)).toContain("documentLabelForTypeCode");
  });
});
