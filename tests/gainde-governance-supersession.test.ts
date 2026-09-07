/**
 * OPS-CUSTOMS-GAINDE-04 slice 7 — the record says what is true, and still shows
 * what it used to say.
 * ---------------------------------------------------------------------------
 * TWO DOCUMENTS WERE ACTIVELY WRONG. `effitrans-business-workflow.md` and
 * `wes-5-reconciliation.md` both described step 9 as AUTO-COMPLETING from the
 * Déclarant's `DECLARED` status plus a declaration number — precisely the proxy
 * MAYA-P1.2 retired in favour of Finance's own `gainde_registered_at` milestone.
 * A third, `phase-9.0d`, placed T7 « Vérification du rattachement » on step 10,
 * while the migration that created the rattachement fact placed it on step 11.
 * The platform held two live answers to one question, and the answer people read
 * was the wrong one.
 *
 * THE PRECEDENT IS `QC2_TRANSMISSION_CONFLICT` + DEC-C33..C36. When two
 * first-party sources disagree, the platform does NOT delete the loser: it keeps
 * the divergence verbatim, prepends a dated ratification, and adds new register
 * rows rather than editing old ones. A contradiction that is deleted cannot be
 * learned from, and the next person re-derives it from scratch.
 *
 * WHAT THIS FILE PINS. That the corrections are present, that the superseded
 * wording is still visible beside each of them, and that the register grew
 * rather than being rewritten. Prose is easy to un-correct in a tidy-up; this is
 * what makes that fail loudly.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

const REGISTER = read("docs/decision-register.md");
const WORKFLOW = read("docs/workflow/effitrans-business-workflow.md");
const WES5 = read("docs/workflow/wes-5-reconciliation.md");
const P90D = read("docs/workflow/phase-9.0d-transit-execution.md");
const MAYA = read("docs/maya/maya-p1-0-ceo-workflow-reconciliation.md");
const MATRIX = read("docs/process/leniency-classification-matrix.md");

// ===========================================================================
// THE RULINGS ARE RECORDED
// ===========================================================================

describe("the decision register carries the GAINDE rulings", () => {
  const IDS = ["DEC-C37", "DEC-C38", "DEC-C39", "DEC-C40", "DEC-C41", "DEC-C42", "DEC-C43", "DEC-C44", "DEC-C45"];

  it("01 — every ruling has exactly one row", () => {
    // Counted as ROW STARTS. A decision id also appears in later rows' « Related »
    // column, and counting every mention would let this pass on a cross-reference
    // while the row itself had gone.
    for (const id of IDS) {
      const n = (REGISTER.match(new RegExp(`^\\| ${id} \\|`, "gm")) ?? []).length;
      expect(n, id).toBe(1);
    }
  });

  it("02 — the hard invariant is stated: capture is not registration", () => {
    const row = REGISTER.slice(REGISTER.indexOf("| DEC-C37 |"));
    const c37 = row.slice(0, row.indexOf("\n"));
    expect(c37).toContain("saisie du Déclarant n'est pas l'enregistrement de la Finance");
    expect(c37).toContain("external_ref");
  });

  it("03 — and why one column cannot carry both acts", () => {
    const row = REGISTER.slice(REGISTER.indexOf("| DEC-C38 |"));
    const c38 = row.slice(0, row.indexOf("\n"));
    // The mechanical consequence, not just the principle: the duplicate-reference
    // refusal makes a step-6 capture into `external_ref` permanently disable
    // Finance's step 9.
    expect(c38).toContain("reference_unchanged");
    expect(c38).toContain("inexécutable");
  });

  it("04 — step 9 is a PAYMENT with a breakdown, and it is internal data", () => {
    const row = REGISTER.slice(REGISTER.indexOf("| DEC-C39 |"));
    const c39 = row.slice(0, row.indexOf("\n"));
    expect(c39).toContain("PAIEMENT");
    expect(c39).toContain("ventilation");
    expect(c39).toContain("portail");
  });

  it("05 — T7 follows the Déclarant to step 11, with no renumbering", () => {
    const row = REGISTER.slice(REGISTER.indexOf("| DEC-C40 |"));
    const c40 = row.slice(0, row.indexOf("\n"));
    expect(c40).toContain("étape 11");
    expect(c40).toContain("Aucune renumérotation");
  });

  it("06 — supervision creates no maker authority", () => {
    const row = REGISTER.slice(REGISTER.indexOf("| DEC-C43 |"));
    const c43 = row.slice(0, row.indexOf("\n"));
    expect(c43).toContain("Surveillance");
    expect(c43).toContain("QC4");
    expect(c43).toContain("Service Qualité");
    expect(c43).toContain("affectation explicite et auditée");
  });

  it("07 — and the leniency doctrine is a register row, not only a prompt", () => {
    const row = REGISTER.slice(REGISTER.indexOf("| DEC-C44 |"));
    const c44 = row.slice(0, row.indexOf("\n"));
    for (const k of ["HARD_GATE", "SOFT_GATE", "CONTROLLED_EXCEPTION", "INFORMATIONAL"]) {
      expect(c44, k).toContain(k);
    }
    expect(c44).toContain("fail-closed");
    expect(c44).toContain("leniency-classification-matrix.md");
  });

  it("08 — nothing was rewritten: the earlier rulings are untouched", () => {
    // The register grows. DEC-C33..C36 recorded the QC2 precedent this slice
    // follows, and they must still read exactly as they did.
    for (const id of ["DEC-C33", "DEC-C34", "DEC-C35", "DEC-C36"]) {
      expect(REGISTER, id).toContain(`| ${id} |`);
    }
    expect(REGISTER).toContain("QC2_TRANSMISSION_CONFLICT");
  });
});

// ===========================================================================
// THE CORRECTIONS, WITH THE DIVERGENCE KEPT
// ===========================================================================

describe("the two actively wrong documents are corrected", () => {
  it("09 — the retired proxy survives ONLY as quoted history, never as the claim", () => {
    // The defect was a Déclarant's fact closing a Finance step. The wording is
    // deliberately still in the files — deleting it would erase the reason the
    // ruling was needed — so what is asserted is that every occurrence now sits
    // inside a dated supersession, and none of them is the document speaking.
    const cases = [
      { name: "workflow", doc: WORKFLOW, needle: "`gainde_registration` completes from `DECLARED`", marker: "SUPERSEDES THE LINE BELOW" },
      { name: "wes-5", doc: WES5, needle: "status ≥ DECLARED", marker: "Divergence historique conservée" },
    ];
    for (const { name, doc, needle, marker } of cases) {
      let from = 0;
      let seen = 0;
      for (;;) {
        const at = doc.indexOf(needle, from);
        if (at < 0) break;
        seen += 1;
        const start = doc.lastIndexOf("\n", at) + 1;
        const end = doc.indexOf("\n", at);
        const line = doc.slice(start, end < 0 ? undefined : end);
        expect(line, `${name}: an occurrence that is not marked as superseded`).toContain(marker);
        from = at + 1;
      }
      expect(seen, `${name}: the superseded wording must remain visible`).toBeGreaterThan(0);
    }
  });

  it("10 — and each correction keeps the superseded wording beside it", () => {
    // The QC2 precedent: preserve, date, supersede. A divergence that is
    // deleted cannot be learned from.
    for (const [name, doc] of [["workflow", WORKFLOW], ["wes-5", WES5]] as const) {
      expect(doc, name).toContain("Divergence historique conservée");
      expect(doc, name).toContain("DECLARED");
      expect(doc, name).toContain("2026-09-06");
    }
  });

  it("11 — step 9 now names Finance's own milestone", () => {
    expect(WORKFLOW).toContain("gainde_registered_at");
    expect(WES5).toContain("gainde_registered_at");
    expect(WES5).toContain("GAINDE_REGISTERED");
  });

  it("12 — the « nothing is aspirational » guarantee is KEPT, and explained", () => {
    // Withdrawing it would have been the easy repair and the wrong one: the
    // guarantee was not false, two of its statements had stopped being true.
    expect(WORKFLOW).toContain("Nothing in this document is aspirational");
    expect(WORKFLOW).toContain("Superseding note — 2026-09-06");
    expect(WORKFLOW).toContain("by CORRECTING the two statements");
  });

  it("13 — the mermaid diagram no longer shows the retired proxy", () => {
    expect(WORKFLOW).not.toContain("9 GAINDE registration - AUTO on DECLARED");
    expect(WORKFLOW).toContain("11 Declarant rattachement GAINDE/ORBUS + verification");
  });
});

describe("T7 is superseded rather than silently moved", () => {
  it("14 — phase-9.0d carries the dated ruling above its old paragraph", () => {
    expect(P90D).toContain("RATIFIED 2026-09-06 (DEC-C40)");
    expect(P90D).toContain("gainde_document_submission");
    // …and the old paragraph is still there, which is the point.
    expect(P90D).toContain("The `coordinator_to_declarant` step models the post-registration attachment/");
    expect(P90D).toContain("Divergence historique conservée");
  });

  it("15 — the MAYA row that ORIGINATED the ambiguity says so", () => {
    // Row 9 straddled « 10–11 » and was class F. Deleting it would remove the
    // only explanation of why two registries ended up disagreeing.
    expect(MAYA).toContain("RATIFIED 2026-09-06 (DEC-C40)");
    expect(MAYA).toContain("is the ORIGIN of the step-10/step-11 ambiguity");
  });

  it("16 — and the row that read CLOSED admits what it closed, and what it did not", () => {
    expect(MAYA).toContain("PARTIALLY REOPENED 2026-09-06");
    expect(MAYA).toContain("The act is owned correctly; its CONTENT is incomplete");
  });
});

// ===========================================================================
// THE MATRIX IS HONEST ABOUT ITSELF
// ===========================================================================

describe("the classification matrix states its own limits", () => {
  it("17 — it says the adversarial half did not run", () => {
    // An unverified proposal presented as a result is worse than no document.
    expect(MATRIX).toContain("MOITIÉ ADVERSARIALE N'A PAS TOURNÉ");
    // The sentence wraps inside a blockquote, so a line break, a `>` and CRLF
    // all fall between the words. Flatten before matching rather than pin the
    // place the line happens to break.
    const flat = MATRIX.replace(/[\r\n>]+/g, " ").replace(/\s+/g, " ");
    expect(flat).toMatch(/0 des \d+ classifications HARD n'a été contestée/);
  });

  it("18 — and that it drives no behaviour yet", () => {
    expect(MATRIX).toContain("registre `CLASSIFIED` **vide**");
    expect(MATRIX).toContain("ne change pas ce que le moteur");
  });

  it("19 — the requirements to arbitrate are counted, not buried", () => {
    expect(MATRIX).toContain("À ARBITRER");
    expect(MATRIX).toMatch(/\d+ exigences \(\d+ %\)/);
  });

  it("20 — every one of the 26 steps has a section", () => {
    for (let n = 1; n <= 26; n++) {
      expect(MATRIX, `step ${n}`).toContain(`### Étape ${n} — `);
    }
  });
});
