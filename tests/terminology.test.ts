/**
 * Phase 5.0E-2C, Deliverable 7 — the words the product uses.
 *
 * Two claims, and they are not cosmetic:
 *
 *  1. NOTHING presents an unratified internal threshold as a contractual SLA. Four
 *     legacy thresholds are live and none has been ratified by management (an open
 *     item since 5.0A). A dashboard headed "Dépassements SLA" tells a director that
 *     Effitrans has breached a customer commitment. It has not. It has crossed a
 *     number a developer picked, and the UI must say so.
 *
 *  2. NO raw key reaches a human. Step keys and document codes are database
 *     identifiers. "Preuves manquantes : BORDEREAU_LIVRAISON" requires the reader to
 *     know our schema, and silently changes meaning if the key is ever renamed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { t } from "@/lib/i18n";
import { stepLabel, documentLabel, blockerSentence } from "@/lib/process/labels";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";
import { DOCUMENT_MAPPINGS } from "@/lib/process/documents";
import { SLA_UNCONFIGURED_LABEL, PROCESS_SLA_POLICIES } from "@/lib/process/sla-policies";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

/** Every user-facing string in the French catalog. */
function allStrings(o: unknown, out: string[] = []): string[] {
  if (typeof o === "string") out.push(o);
  else if (o && typeof o === "object") for (const v of Object.values(o)) allStrings(v, out);
  return out;
}
const STRINGS = allStrings(t);

// ------------------------------------------------------------ SLA wording ----

describe("unratified thresholds are never presented as a contractual SLA", () => {
  it("has retired the wording that claimed a breach of commitment", () => {
    for (const banned of [
      "Dépassements SLA",
      "Principaux goulots (SLA)",
      "Surveillance SLA",
      "Conformité SLA",
      "Suivi SLA",
      "Statut SLA",
      "Rapport SLA",
    ]) {
      expect(STRINGS, banned).not.toContain(banned);
    }
  });

  it("uses the approved internal wording instead", () => {
    for (const approved of [
      "Alertes de délai internes",
      "Surveillance des délais internes",
      "Goulots opérationnels",
    ]) {
      expect(STRINGS, approved).toContain(approved);
    }
    // The legacy thresholds are named for what they are: provisional and internal.
    expect(STRINGS.some((s) => s.includes("Seuil opérationnel provisoire"))).toBe(true);
  });

  it("keeps 'SLA' ONLY where it names an unconfigured OFFICIAL policy", () => {
    // "SLA non configuré" is the approved 5.0A label: it says a policy is absent, which
    // is the opposite of claiming one was breached. That is the only survivor.
    const withSla = STRINGS.filter((s) => /\bSLA\b/.test(s));
    expect(withSla).toEqual([SLA_UNCONFIGURED_LABEL]);
  });

  it("still has NO ratified SLA policy — the wording change is not a fix for that", () => {
    // Renaming the label does not configure a policy. The management decision is
    // still open, and this test exists so nobody mistakes cosmetics for a resolution.
    const configured = PROCESS_SLA_POLICIES.filter((p) => p.state !== "unconfigured");
    expect(configured.every((p) => p.state === "unratified")).toBe(true);
  });

  it("marks the legacy thresholds as provisional wherever they are shown", () => {
    expect(t.sla.panel.warningThreshold).toContain("Seuil opérationnel provisoire");
    expect(t.sla.panel.criticalThreshold).toContain("Seuil opérationnel provisoire");
  });

  it("never implies a CUSTOMER CONTRACTUAL breach anywhere", () => {
    // The four live thresholds are numbers a developer picked. Until management ratifies
    // them, no string may suggest Effitrans broke a commitment to a client.
    for (const s of STRINGS) {
      expect(s, s).not.toMatch(/contractuel|engagement client|pénalité/i);
    }
  });
});

// -------------------------------------------------------------- raw keys ----

describe("no raw process key or document code reaches a human", () => {
  it("gives every one of the 26 steps a French label", () => {
    for (const s of EFFITRANS_PROCESS) {
      expect(stepLabel(s.key), s.key).toBe(s.labelFr);
      expect(stepLabel(s.key)).not.toBe(s.key);
    }
  });

  it("gives every catalog document a French label, by key AND by type code", () => {
    // By KEY the answer is exact. By CODE it may be ambiguous — "Reçu" and "Preuve de
    // paiement" deliberately share the PAYMENT_RECEIPT type — so we require only that
    // the code resolves to a real label belonging to an artefact that uses it. What
    // must never happen is the code being echoed back raw.
    const labelsForCode = new Map<string, string[]>();
    for (const d of DOCUMENT_MAPPINGS) {
      expect(documentLabel(d.key), d.key).toBe(d.labelFr);
      if (d.typeCode) {
        labelsForCode.set(d.typeCode, [...(labelsForCode.get(d.typeCode) ?? []), d.labelFr]);
      }
    }
    for (const [code, labels] of labelsForCode) {
      expect(labels, code).toContain(documentLabel(code));
      expect(documentLabel(code), code).not.toBe(code);
    }
  });

  it("resolves a SHARED document code deterministically (first registry entry wins)", () => {
    // Not last-write-wins: that would make the label depend on declaration order and
    // change under an innocent reorder that nobody would think to re-check.
    const sharers = DOCUMENT_MAPPINGS.filter((d) => d.typeCode === "PAYMENT_RECEIPT");
    expect(sharers.length).toBeGreaterThan(1);
    expect(documentLabel("PAYMENT_RECEIPT")).toBe(sharers[0].labelFr);
  });

  it("never echoes an unknown key back verbatim", () => {
    // An awkward label is a bug report. A raw SCREAMING_KEY just looks like the product.
    expect(documentLabel("SOME_NEW_CODE")).toBe("Some new code");
    expect(stepLabel("brand_new_step")).toBe("Brand new step");
    expect(documentLabel("SOME_NEW_CODE")).not.toBe("SOME_NEW_CODE");
  });

  it("builds the blocker sentence from LABELS, not identifiers", () => {
    const s = blockerSentence({
      blocked: true,
      missingPrerequisites: [],
      missingEvidence: ["BORDEREAU_LIVRAISON", "BILL_OF_LADING"],
    });
    expect(s).not.toContain("BORDEREAU_LIVRAISON");
    expect(s).not.toContain("BILL_OF_LADING");
    expect(s).toContain("Pièces manquantes");
  });

  it("names the missing PREREQUISITE steps in French too", () => {
    const s = blockerSentence({
      blocked: true,
      missingPrerequisites: ["declaration_preparation"],
      missingEvidence: [],
    });
    expect(s).not.toContain("declaration_preparation");
    expect(s).toContain("Prérequis manquants");
  });

  it("returns null when nothing is blocked — no empty 'Étape bloquée' badge", () => {
    expect(blockerSentence({ blocked: false, missingPrerequisites: [], missingEvidence: [] })).toBeNull();
  });

  it("the queue service no longer joins raw keys into the sentence", () => {
    const src = read("../lib/process/queues/service.ts");
    expect(src).toContain("blockerSentence(");
    expect(src).not.toContain("`Prérequis manquants : ${missingPrereqs.join");
    expect(src).not.toContain("`Preuves manquantes : ${evidence.missing.join");
  });

  it("no staff-facing component prints a SCREAMING_SNAKE document code", () => {
    const dir = fileURLToPath(new URL("../components/process", import.meta.url));
    const codes = DOCUMENT_MAPPINGS.map((d) => d.typeCode).filter((c): c is string => Boolean(c));
    for (const f of readdirSync(dir)) {
      const src = readFileSync(`${dir}/${f}`, "utf8");
      for (const c of codes) {
        expect(src, `${f} prints the raw code ${c}`).not.toContain(`"${c}"`);
      }
    }
  });
});
