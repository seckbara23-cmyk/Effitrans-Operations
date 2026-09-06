/**
 * OPS-CUSTOMS-GAINDE-04 slice 3 — ONE French vocabulary for process refusals.
 * ---------------------------------------------------------------------------
 * THE DEFECT. Six private `ERROR_FR` maps had grown across the process
 * surfaces. Two were byte-identical for twenty-one entries. Between the others
 * the same code carried different sentences, and — the part that actually hurt
 * operators — several surfaces had NO sentence for refusals they can genuinely
 * receive, so a precise decision arrived as « L'action a échoué. Réessayez. »
 *
 * WHAT THIS FILE HOLDS, AND WHY EACH PART IS LOAD-BEARING.
 *
 *   COVERAGE — every code an action can return is nameable. Derived from the
 *   engine's own `EngineError` union and from each module's source, never from
 *   a hand-written list, so adding a refusal without a sentence turns this red.
 *
 *   NO DEAD VOCABULARY — ratified at UAT-00009: a sentence for a code nothing
 *   emits hides the gap where a live code has none. `intake-panel` carried two
 *   such entries for months.
 *
 *   SINGLENESS — the private maps are gone and cannot come back. The one
 *   allowance, `SURFACE_ERROR_FR`, is bounded and enumerated here so it cannot
 *   quietly become a seventh map.
 *
 *   BOTH VOCABULARIES — `step_gate_*` codes resolve too. Only the customs panel
 *   ever composed the two, and a contextual surface that mixes step actions with
 *   dossier controls will receive both.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EVIDENCE_STATUS_FR,
  PROCESS_ERROR_FR,
  PROCESS_ERROR_GENERIC,
  SURFACE_ERROR_FR,
  hasProcessErrorFr,
  processErrorFr,
  type ProcessErrorSurface,
} from "@/lib/process/error-fr";
import { CONTROL_GATE_MESSAGE_FR } from "@/lib/process/control-gate";
import { BILLING_ERROR_FR } from "@/lib/process/billing/state";

const NEWLINE = String.fromCharCode(10);
const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
/** Source with comments stripped — a code named only in prose is not emitted. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PANELS = [
  "components/process/step-actions.tsx",
  "components/process/queue-row-actions.tsx",
  "components/process/transit-panel.tsx",
  "components/process/intake-panel.tsx",
  "components/process/finance-panel.tsx",
  "components/files/commercial-owner.tsx",
];

/** Modules whose refusals reach one of those surfaces. */
const ACTION_MODULES = [
  "lib/process/engine/actions.ts",
  "lib/process/engine/intake-actions.ts",
  "lib/process/engine/structures-actions.ts",
  "lib/process/engine/transit-actions.ts",
  "lib/finance/request-actions.ts",
  "lib/process/handoff-routes.ts",
  "lib/process/engine/state.ts",
];

/**
 * Everywhere a code could legitimately come from. Wider than ACTION_MODULES on
 * purpose: liveness is "something in the platform emits this", and a code the
 * workflow policy resolver returns is live even though no panel imports that
 * module directly.
 */
const LIVENESS_MODULES = ACTION_MODULES.concat([
  "lib/workflow/policy/resolver.ts",
  "lib/files/actions.ts",
  "lib/process/queues/actions.ts",
  "lib/process/engine/promote.ts",
]);

/** The engine's own declared error union — the authoritative set. */
function engineErrorUnion(): string[] {
  const t = code("lib/process/engine/types.ts");
  const i = t.indexOf("export type EngineError =");
  expect(i, "EngineError union not found").toBeGreaterThan(-1);
  const u = t.slice(i, t.indexOf(";", i));
  return [...new Set([...u.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))];
}

/** Refusal literals a module can actually return, read from its source. */
function emittedCodes(path: string): string[] {
  const s = code(path);
  const out = new Set<string>();
  for (const m of s.matchAll(/(?:fail|failWithEvidence)\(\s*"([a-z_]+)"/g)) out.add(m[1]);
  for (const m of s.matchAll(/error:\s*"([a-z_]+)"/g)) out.add(m[1]);
  // Guard helpers hand their refusal back as a bare string (`return
  // "engine_disabled";`) and the caller wraps it, so a pattern that only knew
  // fail() and `error:` would call four live codes dead.
  for (const m of s.matchAll(/return\s+"([a-z_]+)"\s*;/g)) out.add(m[1]);
  return [...out];
}

/**
 * Every snake_case literal in a module. Deliberately imprecise, and safe where
 * it is used: the caller intersects it with the engine's declared union, so a
 * stray literal cannot invent a code. Refusals reach a caller through at least
 * four different shapes — fail(), `error:`, a bare return, and a `reason:` in a
 * ternary inside the pure state core — and chasing each shape with its own
 * pattern is how a live code gets reported dead.
 */
function mentionedCodes(path: string): string[] {
  return [...new Set([...code(path).matchAll(/"([a-z][a-z_]*)"/g)].map((m) => m[1]))];
}

// ===========================================================================
// COVERAGE — nothing an action can say is left without words
// ===========================================================================

describe("every refusal the engine can return has a French sentence", () => {
  it("01 — every LIVE member of the EngineError union resolves, and only those", () => {
    // Two-sided on purpose. Declaring a code and never emitting it is the same
    // failure as emitting one and never naming it: `already_initialized` has sat
    // in this union with no emitter anywhere in the repository, and a private
    // map carried a sentence for it. So the union is intersected with what is
    // actually emitted rather than trusted.
    const union = engineErrorUnion();
    expect(union.length, "the union must not be empty").toBeGreaterThan(15);
    const emitted = new Set(LIVENESS_MODULES.flatMap(mentionedCodes));
    const live = union.filter((c) => emitted.has(c));
    expect(live.length, "the live subset must not be empty").toBeGreaterThan(15);
    for (const c of live) {
      expect(hasProcessErrorFr(c), `${c} has no French sentence`).toBe(true);
    }
    for (const c of union.filter((c) => !emitted.has(c))) {
      expect(
        PROCESS_ERROR_FR[c],
        `${c} is declared in EngineError but emitted nowhere: it must not carry a sentence`,
      ).toBeUndefined();
    }
  });

  it("02 — and so does every code the surfaced action modules emit", () => {
    // Two exclusions, each named rather than assumed: `handoff-routes` and
    // `state` also return CUSTODY STATES and GATE KEYS through the same
    // `return "…"` shape, and those are not refusals.
    const NOT_REFUSALS = new Set([
      "awaiting_reception", "awaiting_transmission", "not_applicable", "received",
      "billing_readiness", "closure_readiness",
    ]);
    const seen = new Set<string>();
    for (const mod of ACTION_MODULES) {
      for (const c of emittedCodes(mod)) {
        if (NOT_REFUSALS.has(c)) continue;
        seen.add(c);
        expect(hasProcessErrorFr(c), `${c} (from ${mod}) has no French sentence`).toBe(true);
      }
    }
    expect(seen.size, "the emitted set must not be empty").toBeGreaterThan(20);
  });

  it("03 — the control gate's own family resolves through the same door", () => {
    // The composition only the customs panel ever did. A contextual surface
    // mixing step actions with dossier controls receives both vocabularies.
    for (const reason of Object.keys(CONTROL_GATE_MESSAGE_FR)) {
      const c = `step_gate_${reason}`;
      expect(hasProcessErrorFr(c), c).toBe(true);
      expect(processErrorFr(c)).toBe(CONTROL_GATE_MESSAGE_FR[reason]);
    }
  });

  it("04 — so does the billing union, without being flattened into this map", () => {
    // BILLING_ERROR_FR is Record<BillingError, string> and gets compile-time
    // exhaustiveness from that. Merging it would throw that away; resolving
    // through it keeps both properties.
    for (const c of Object.keys(BILLING_ERROR_FR)) {
      expect(hasProcessErrorFr(c), c).toBe(true);
    }
    expect(Object.keys(PROCESS_ERROR_FR)).not.toContain("invoice_missing");
  });

  it("05 — an unknown or empty code degrades to the generic sentence, never to the code", () => {
    for (const junk of ["", null, undefined, "nonexistent_code_xyz"]) {
      const out = processErrorFr(junk as string | null | undefined);
      expect(out).toBe(PROCESS_ERROR_GENERIC);
      expect(out).not.toContain("_");
    }
  });
});

// ===========================================================================
// NO DEAD VOCABULARY — ratified UAT-00009
// ===========================================================================

describe("no sentence survives for a code nothing emits", () => {
  it("06 — every canonical entry is emitted somewhere in the platform", () => {
    // A sentence for a dead code hides the gap where a live one has none —
    // which is how `transit-panel` kept five refusals silent for months while
    // looking well-covered.
    const haystack = LIVENESS_MODULES.map((m) => code(m)).join(NEWLINE);
    for (const c of Object.keys(PROCESS_ERROR_FR)) {
      expect(haystack.includes(`"${c}"`), `${c} is dead vocabulary`).toBe(true);
    }
  });

  it("07 — the two codes intake-panel invented are gone", () => {
    // `owner_forbidden` / `owner_not_found` appear in NO action in this
    // repository; the panel even carried a `code.replace(/^owner_/, "")` hack
    // to make them resolve.
    expect(PROCESS_ERROR_FR.owner_forbidden).toBeUndefined();
    expect(PROCESS_ERROR_FR.owner_not_found).toBeUndefined();
    for (const p of PANELS) expect(code(p), p).not.toContain("owner_forbidden");
  });

  it("08 — and so is `feature_disabled` on the process surfaces", () => {
    // It belongs to billing's union and is resolved from there; keeping a
    // second copy here is how the two would drift.
    expect(PROCESS_ERROR_FR.feature_disabled).toBeUndefined();
  });
});

// ===========================================================================
// SINGLENESS — the private maps are gone and cannot come back
// ===========================================================================

describe("there is one vocabulary, not six", () => {
  it("09 — no process surface declares a private error map any more", () => {
    for (const p of PANELS) {
      const s = code(p);
      expect(s, p).not.toMatch(/const\s+ERROR_FR\s*[:=]/);
      expect(s, p).not.toMatch(/const\s+ERR\s*:\s*Record<string, string>/);
    }
  });

  it("10 — every process surface resolves through the shared function", () => {
    for (const p of PANELS) {
      expect(code(p), p).toContain("processErrorFr(");
      expect(code(p), p).toContain('from "@/lib/process/error-fr"');
    }
  });

  it("11 — no surface keeps its own generic fallback string", () => {
    // Three different "something went wrong" sentences existed; the fallback
    // now belongs to the resolver, so there is one.
    for (const p of PANELS) {
      const s = code(p);
      expect(s, p).not.toContain("L'action a échoué. Réessayez.");
      expect(s, p).not.toContain("Action refusée.");
    }
    expect(PROCESS_ERROR_GENERIC).toBe("L'action a échoué. Veuillez réessayer.");
  });

  it("12 — the evidence-status words are shared too, not re-declared twice", () => {
    for (const p of PANELS) {
      expect(code(p), p).not.toMatch(/const\s+EVIDENCE_STATUS_FR\s*[:=]/);
    }
    expect(EVIDENCE_STATUS_FR.missing).toBe("manquant");
    // `unauthorized` is new: the evaluator can report it and no map had a word
    // for it, so it rendered as the raw status.
    expect(EVIDENCE_STATUS_FR.unauthorized).toBeTruthy();
  });
});

// ===========================================================================
// THE ONE ALLOWANCE, BOUNDED
// ===========================================================================

describe("surface overrides are an enumerated exception, not a loophole", () => {
  it("13 — every override narrows a canonical sentence that exists", () => {
    for (const [surface, entries] of Object.entries(SURFACE_ERROR_FR)) {
      for (const [c, sentence] of Object.entries(entries as Record<string, string>)) {
        expect(PROCESS_ERROR_FR[c], `${surface}.${c} narrows nothing`).toBeTruthy();
        expect(sentence, `${surface}.${c}`).not.toBe(PROCESS_ERROR_FR[c]);
        expect(sentence.length).toBeGreaterThan(10);
      }
    }
  });

  it("14 — and they stay few: an override is an argued exception", () => {
    const total = Object.values(SURFACE_ERROR_FR).reduce(
      (n, e) => n + Object.keys(e as Record<string, string>).length,
      0,
    );
    expect(total, "overrides are creeping back toward six private maps").toBeLessThanOrEqual(12);
  });

  it("15 — a surface only ever narrows: it can never widen or invent", () => {
    for (const surface of Object.keys(SURFACE_ERROR_FR) as ProcessErrorSurface[]) {
      for (const c of Object.keys(PROCESS_ERROR_FR)) {
        // With or without the surface, the code always resolves to something.
        expect(hasProcessErrorFr(c, surface), `${surface}/${c}`).toBe(true);
      }
    }
  });

  it("16 — the transit and intake overrides exist for the reason claimed", () => {
    // `engine_disabled` is emitted by four modules behind four flags, so the
    // canonical sentence names none of them and these two name theirs.
    expect(processErrorFr("engine_disabled", "transit")).toContain("Transit");
    expect(processErrorFr("engine_disabled", "intake")).toContain("ouverture");
    expect(processErrorFr("engine_disabled")).not.toContain("Transit");
  });
});

// ===========================================================================
// THE DIVERGENCES THAT STARTED THIS
// ===========================================================================

describe("the codes that carried two different sentences now carry one", () => {
  it("17 — self_validation_forbidden says the same thing everywhere", () => {
    // « Vous ne pouvez pas valider votre propre travail. » on one screen and
    // « Vous avez enregistré ce BAE : sa vérification revient à une autre
    // personne. » on another — for the SAME code. The canonical sentence is
    // true in both situations and still names the consequence.
    const s = processErrorFr("self_validation_forbidden");
    expect(s).toContain("votre propre travail");
    expect(s).toContain("une autre personne");
    // BAE-specific wording is gone: the code is emitted for every step.
    expect(s).not.toContain("BAE");
    for (const surface of Object.keys(SURFACE_ERROR_FR) as ProcessErrorSurface[]) {
      expect(processErrorFr("self_validation_forbidden", surface), surface).toBe(s);
    }
  });

  it("18 — invalid_state had five wordings and now has one, plus one narrowing", () => {
    const canonical = processErrorFr("invalid_state");
    expect(canonical).toContain("Rafraîchissez");
    for (const surface of ["transit", "intake", "finance", "commercialOwner"] as const) {
      expect(processErrorFr("invalid_state", surface), surface).toBe(canonical);
    }
    // The queue refreshes a file, not a page — the one narrowing kept.
    expect(processErrorFr("invalid_state", "queue")).toContain("file");
  });

  it("19 — the five refusals transit-panel could receive and could not name", () => {
    // The operator-visible half of the defect: each of these arrived as
    // « L'action a échoué. Réessayez. » on the Transit screen.
    for (const c of [
      "evidence_missing",
      "evidence_unauthorized",
      "prerequisites_unmet",
      "handoff_not_sent",
      "handoff_reception_required",
    ]) {
      expect(hasProcessErrorFr(c, "transit"), c).toBe(true);
      expect(processErrorFr(c, "transit")).not.toBe(PROCESS_ERROR_GENERIC);
    }
  });
});

// ===========================================================================
// OPERATOR-FACING QUALITY
// ===========================================================================

describe("what an operator reads", () => {
  it("20 — no sentence leaks an internal code, a UUID or an email", () => {
    const all = [
      ...Object.values(PROCESS_ERROR_FR),
      ...Object.values(SURFACE_ERROR_FR).flatMap((e) => Object.values(e as Record<string, string>)),
    ];
    for (const s of all) {
      expect(s, s).not.toMatch(/[a-z]+_[a-z_]+/);
      expect(s, s).not.toMatch(/@|[0-9a-f]{8}-[0-9a-f]{4}/);
    }
  });

  it("21 — every sentence is a sentence: capitalised, punctuated, non-trivial", () => {
    for (const [c, s] of Object.entries(PROCESS_ERROR_FR)) {
      expect(s.length, c).toBeGreaterThanOrEqual(12);
      expect(s[0], c).toBe(s[0].toUpperCase());
      expect(s.trimEnd().endsWith("."), c).toBe(true);
    }
  });

  it("22 — a refusal never names the person who holds the work", () => {
    // The control gate ratified this and the engine vocabulary must match it:
    // a reader must not learn who else could act from a refusal.
    expect(processErrorFr("step_assigned_to_other")).not.toMatch(/@/);
    expect(processErrorFr("step_gate_assigned_to_another")).not.toMatch(/@/);
  });
});
