/**
 * OPS-CUSTOMS-GAINDE-04 — slices 1 and 2: the customs panel tells the truth,
 * and saving one form no longer erases another.
 * ---------------------------------------------------------------------------
 * TWO DEFECT FAMILIES, FOUND IN UAT ON EFT-IMP-2026-00011.
 *
 * (a) THE PANEL SAID THINGS THAT WERE NOT SO. A step the workflow had not
 *     reached yet was reported as « terminée ou n'est plus ouverte » (UI-1). The
 *     Déclarant's maker controls — the governed ICTD elements, the declaration
 *     metadata and the recevabilité verdict — were drawn for anybody holding
 *     `customs:update`, which on this platform includes the Chef de Transit who
 *     is supposed to be CHECKING them (UI-2/3/4/5). The GAINDE registration
 *     button ignored its own step gate and explained nothing (UI-6). The whole
 *     rattachement vocabulary shipped unaccented (UI-7) with one dead string
 *     (UI-8). And the BAE/mainlevée button was hidden from the field agent
 *     because the block around it was scoped on somebody else's step (UI-9).
 *
 * (b) SAVING ONE FORM ERASED ANOTHER. `updateCustoms` wrote seven columns
 *     unconditionally while two callers share it and one is partial by design.
 *     Saving the five governed elements therefore NULLed the declaration
 *     number, the bureau, the régime, the declaration date, the GAINDE/Orbus
 *     reference and the notes, and reset the inspection — silently, with an
 *     audit row that said only « customs.updated ».
 *
 * WHY SOURCE ASSERTIONS AND NOT A RENDER. This panel is a client component
 * whose authority comes entirely from server-computed verdicts passed as props;
 * there is no render harness for it in this repo, and the thing that must not
 * regress is precisely which verdict guards which control. Assertions are
 * BOUNDED to one section for the same reason `debt-customs-error-scoping`
 * bounds its own: the file contains seven near-identical control blocks, and a
 * whole-file `toContain` would be satisfied by a neighbour.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { t } from "@/lib/i18n";
import {
  CONTROL_GATE_MESSAGE_FR,
  CONTROL_OWNING_STEP,
  controlGateError,
  evaluateControlGate,
} from "@/lib/process/control-gate";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const PANEL = "components/customs/customs-panel.tsx";
const ACTIONS = "lib/customs/actions.ts";
const panel = read(PANEL);
const actions = read(ACTIONS);

/** Source with comments stripped — an assertion about code must not match prose. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Bounded slice. Throws when a boundary moves: a silently widened slice is how
 * a pin stops testing anything.
 */
function between(start: string, end: string): string {
  const a = panel.indexOf(start);
  if (a < 0) throw new Error(`start marker not found: ${start}`);
  const b = panel.indexOf(end, a + start.length);
  if (b < 0) throw new Error(`end marker not found: ${end}`);
  const slice = panel.slice(a, b);
  if (slice.length < 80) throw new Error(`slice suspiciously small for ${start}`);
  return slice;
}

const S = {
  workflow: () => between("{/* Workflow actions */}", "{/* MAYA-P1.1 — CEO step 8"),
  gainde: () => between("{/* MAYA-P1.1 — CEO step 8", "{/* MAYA-P1.11 — CEO step 9"),
  attachment: () => between("{/* MAYA-P1.11 — CEO step 9", "{/* MAYA-P0.8-A (PG-1)"),
  validation: () => between("{/* MAYA-P0.8-A (PG-1)", "{/* MAYA-P0.7-A —"),
  receivability: () => between("{/* MAYA-P0.7-A —", "<GovernedCustomsFields"),
  governed: () => between("<GovernedCustomsFields", "{/* Editable manual-reference"),
  metadata: () => between("{/* Editable manual-reference", "function ReadOnlyMetadata"),
};

// ===========================================================================
// UI-1 — not yet open is not the same fact as no longer open
// ===========================================================================

describe("UI-1 — a step waiting its turn says NOT YET, never FINISHED", () => {
  it("01 — PENDING refuses with its own reason code", () => {
    const r = evaluateControlGate({
      hasInstance: true,
      step: { state: "PENDING", assignedUserId: null },
      userId: "me",
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("step_not_open");
    expect(controlGateError(r.reason)).toBe("step_gate_step_not_open");
  });

  it("02 — the sentence is the one Effitrans ratified", () => {
    expect(CONTROL_GATE_MESSAGE_FR.step_not_open).toBe("Cette étape n'est pas encore ouverte.");
  });

  it("03 — it cannot be confused with the closed sentence", () => {
    // The whole defect: one sentence served both, and it was the wrong one for
    // 25 steps out of 26.
    expect(CONTROL_GATE_MESSAGE_FR.step_not_open).not.toBe(CONTROL_GATE_MESSAGE_FR.step_closed);
    expect(CONTROL_GATE_MESSAGE_FR.step_not_open).not.toMatch(/termin|n'est plus/i);
    expect(CONTROL_GATE_MESSAGE_FR.step_closed).toMatch(/termin/i);
  });

  it("04 — terminal states keep the closed sentence; the block itself is unchanged", () => {
    for (const state of ["COMPLETED", "APPROVED", "SKIPPED", "REJECTED", "CANCELLED"] as const) {
      const r = evaluateControlGate({
        hasInstance: true,
        step: { state, assignedUserId: null },
        userId: "me",
      });
      expect(r, state).toEqual({ allowed: false, reason: "step_closed" });
    }
  });

  it("05 — an open step is still open: no state changed sides", () => {
    for (const state of ["AVAILABLE", "ACTIVE", "BLOCKED", "SUBMITTED"] as const) {
      expect(
        evaluateControlGate({ hasInstance: true, step: { state, assignedUserId: null }, userId: "me" })
          .allowed,
        state,
      ).toBe(true);
    }
  });

  it("06 — an absent execution row keeps its OWN distinct reason", () => {
    // Three different facts, three different sentences: no row at all, a row
    // waiting its turn, a row that is done.
    const r = evaluateControlGate({ hasInstance: true, step: null, userId: "me" });
    expect(r.reason).toBe("step_not_started");
    expect(CONTROL_GATE_MESSAGE_FR.step_not_started).not.toBe(CONTROL_GATE_MESSAGE_FR.step_not_open);
  });
});

// ===========================================================================
// UI-2 / UI-3 / UI-4 / UI-5 — maker controls belong to the maker
// ===========================================================================

describe("UI-2 — the governed ICTD elements are editable by the step-6 owner only", () => {
  it("07 — GovernedCustomsFields receives ownership, not bare permission", () => {
    expect(S.governed()).toContain('canUpdate={canUpdate && owns("customs.update")}');
  });

  it("08 — the bare prop is gone, so a Chef cannot rewrite what he certifies", () => {
    expect(code(panel)).not.toMatch(/canUpdate=\{canUpdate\}/);
  });
});

describe("UI-3 / UI-5 — declaration metadata: the maker edits, the checker reads", () => {
  it("09 — the form is drawn only for the owner of step 6", () => {
    expect(S.metadata()).toContain('{canUpdate && owns("customs.update") ? (');
  });

  it("10 — a non-owner gets the read-only view rather than nothing at all", () => {
    // UI-5. Hiding it would leave the Chef certifying facts the screen refused
    // to show him.
    expect(S.metadata()).toContain("<ReadOnlyMetadata record={record} />");
    expect(panel).toContain("function ReadOnlyMetadata(");
  });

  it("11 — the read-only view carries every field the form carries", () => {
    const view = panel.slice(panel.indexOf("function ReadOnlyMetadata("), panel.indexOf("function Field("));
    for (const field of [
      "c.fields.declarationNumber",
      "c.fields.customsOffice",
      "c.fields.regime",
      "c.fields.declarationDate",
      "c.fields.inspection",
      "c.fields.externalRef",
      "c.fields.notes",
    ]) {
      expect(view, field).toContain(field);
    }
  });

  it("12 — the read-only view is READ ONLY: it invokes nothing and mutates nothing", () => {
    const view = panel.slice(panel.indexOf("function ReadOnlyMetadata("), panel.indexOf("function Field("));
    for (const forbidden of ["onClick", "onSubmit", "<button", "<input", "<form", "updateCustoms"]) {
      expect(view, forbidden).not.toContain(forbidden);
    }
  });
});

describe("UI-4 — recevabilité is the Déclarant's judgement, not every holder's", () => {
  it("13 — the outcome buttons are drawn on ownership of their own control", () => {
    expect(S.receivability()).toContain('{canUpdate && owns("customs.receivability") && (');
  });

  it("14 — and are pressable only when the server would allow it", () => {
    expect(S.receivability()).toContain('disabled={pending || !gateOpen("customs.receivability")}');
  });

  it("15 — a drawn-but-refused control explains itself", () => {
    expect(S.receivability()).toContain('<GateHint reason={gateReason("customs.receivability")} />');
  });
});

// ===========================================================================
// UI-6 — the GAINDE control obeys its own gate
// ===========================================================================

describe("UI-6 — GAINDE registration behaves like its siblings", () => {
  it("16 — the button is disabled when the step gate refuses", () => {
    expect(S.gainde()).toContain('disabled={pending || !gateOpen("customs.gainde_registration")}');
  });

  it("17 — and says why", () => {
    expect(S.gainde()).toContain('<GateHint reason={gateReason("customs.gainde_registration")} />');
  });

  it("18 — every GATED control consults a verdict, none is left on `disabled={pending}`", () => {
    // The class of defect, not the instance. Scoped to the controls the gate
    // map actually owns: `deleteCustoms` is deliberately NOT in
    // CONTROL_OWNING_STEP — it is governed by `customs:delete` alone — so it
    // has no verdict to consult and asserting one would be asserting a fiction.
    for (const control of [
      "customs.status",
      "customs.gainde_registration",
      "customs.attachment",
      "customs.validation",
      "customs.receivability",
    ]) {
      expect(CONTROL_OWNING_STEP[control], control).toBeTruthy();
      expect(panel, control).toContain(`gateOpen("${control}")`);
    }
    // The BAE / mainlevée pair resolves its control by name at the call site.
    expect(S.workflow()).toContain("gateOpen(releaseControl)");
    // And the only bare `disabled={pending}` left in a control section is the
    // ungated delete button; the gated ones all carry a condition.
    // Every other action button in the panel now carries a verdict condition.
    const bare = (panel.match(/disabled=\{pending\}/g) ?? []).length;
    expect(bare, "the only ungated button left is deleteCustoms").toBe(1);
    expect(panel).toContain('disabled={pending || !gateOpen("customs.create")}');
    expect(panel).toContain('disabled={pending || !gateOpen("customs.update")}');
  });
});

// ===========================================================================
// UI-9 — the BAE button was hidden from the only role that may press it
// ===========================================================================

describe("UI-9 — each control in the workflow block is drawn on its own verdict", () => {
  it("19 — the two controls in this block belong to two DIFFERENT steps", () => {
    // Which is the whole reason one verdict could not speak for both.
    expect(CONTROL_OWNING_STEP["customs.status"]).toBe("customs_preparation");
    expect(CONTROL_OWNING_STEP["customs.bae"]).toBe("customs_field_clearance");
    expect(CONTROL_OWNING_STEP["customs.release"]).toBe("customs_field_clearance");
    expect(CONTROL_OWNING_STEP["customs.status"]).not.toBe(CONTROL_OWNING_STEP["customs.bae"]);
  });

  it("20 — the block is no longer scoped on customs.status alone", () => {
    const w = S.workflow();
    expect(w).toContain('(canUpdate && owns("customs.status"))');
    expect(w).toContain('(canRelease && owns("customs.bae"))');
    // The old single-owner condition, which hid the mainlevée from the field
    // agent because step 6 was by then completed and assigned to somebody else.
    expect(w).not.toContain('(canUpdate || canRelease) && owns("customs.status")');
  });

  it("21 — the BAE / mainlevée button consults the field-clearance controls", () => {
    const w = S.workflow();
    expect(w).toContain('const releaseControl = verified ? "customs.release" : "customs.bae";');
    expect(w).toContain("disabled={pending || !gateOpen(releaseControl)}");
    expect(w).toContain('canRelease && owns("customs.bae") ?');
  });

  it("22 — the status ladder consults its own", () => {
    const w = S.workflow();
    expect(w).toContain('if (!canUpdate || !owns("customs.status")) return null;');
    expect(w).toContain('disabled={pending || !gateOpen("customs.status")}');
  });

  it("23 — TC-05's two acts stay two acts: recording is not releasing", () => {
    // Guard on the slice: this changed what is DRAWN, never what is RECORDED.
    const w = S.workflow();
    expect(w).toContain("recordBaeReference(record.id, bae.trim())");
    expect(w).toContain("releaseCustoms(record.id, bae.trim())");
    expect(w).toContain('const verified = record.releaseApprovalStatus === "APPROVED";');
  });
});

// ===========================================================================
// UI-7 / UI-8 — the French, and the string nobody reads
// ===========================================================================

describe("UI-7 — the rattachement block is written in French", () => {
  const a = t.customs.attachment;

  it("24 — the accented forms are the ones shipped", () => {
    expect(a.doneOn).toBe("Rattaché le");
    expect(a.notDone).toBe("Non rattaché");
    expect(a.systems).toBe("Systèmes");
  });

  it("25 — the hint no longer reads as machine output", () => {
    for (const fragment of ["Déclarant", "lui-même", "l'opération déclarée", "vérifie", "système", "à la recevabilité"]) {
      expect(a.hint, fragment).toContain(fragment);
    }
  });

  it("26 — no unaccented artefact survives anywhere in the block", () => {
    const blob = JSON.stringify(a);
    for (const wrong of [
      "Rattache le",
      "Non rattache",
      "Systemes",
      "l'operation declaree",
      "lui-meme",
      "recevabilite",
      "systeme douanier",
      "a ete fait",
    ]) {
      expect(blob, wrong).not.toContain(wrong);
    }
  });

  it("27 — its neighbours were already correct and stay correct", () => {
    expect(t.customs.gainde.registeredOn).toBe("Enregistré le");
    expect(t.customs.receivability.notAssessed).toBe("Non évaluée");
  });
});

describe("UI-8 — the dead prompt is gone", () => {
  it("28 — the attachment block no longer defines a prompt", () => {
    expect(Object.keys(t.customs.attachment)).not.toContain("prompt");
  });

  it("29 — because the attachment UI asks nothing: it offers three fixed sets", () => {
    expect(S.attachment()).toContain("ATTACHMENT_SYSTEM_SETS.map");
    expect(S.attachment()).not.toContain("window.prompt");
  });
});

// ===========================================================================
// SLICE 2 — saving one customs form must not erase another
// ===========================================================================

describe("the customs payload — undefined means NOT SUPPLIED, never CLEAR", () => {
  /** The update payload, sliced out of updateCustoms so neighbours cannot satisfy it. */
  const payload = (() => {
    const fn = actions.slice(
      actions.indexOf("export async function updateCustoms"),
      actions.indexOf("export async function changeCustomsStatus"),
    );
    const a = fn.indexOf('.update({');
    const b = fn.indexOf('.eq("id", id)', a);
    if (a < 0 || b < 0) throw new Error("updateCustoms payload slice not found");
    // Collapsed whitespace: the payload is prettier-wrapped, and an assertion
    // that depends on where a line happens to break tests the formatter.
    return fn.slice(a, b).replace(/\s+/g, " ");
  })();

  const COLUMNS: [string, string][] = [
    ["input.declarationNumber", "declaration_number"],
    ["input.customsOffice", "customs_office"],
    ["input.regime", "regime"],
    ["input.declarationDate", "declaration_date"],
    ["input.inspectionStatus", "inspection_status"],
    ["input.externalRef", "external_ref"],
    ["input.notes", "notes"],
  ];

  it("30 — every metadata column is written CONDITIONALLY", () => {
    // The defect verbatim: seven columns written unconditionally while a
    // caller (governed-fields) legitimately sends only five other fields.
    for (const [field, column] of COLUMNS) {
      expect(payload, column).toContain(`...(${field} === undefined ? {} : {`);
    }
  });

  it("31 — no metadata column is written unconditionally any more", () => {
    for (const [, column] of COLUMNS) {
      // An unconditional write looks like `column: <expr>,` at the start of a
      // payload line; a guarded one always sits inside `{ column: … }`.
      expect(payload, column).not.toMatch(new RegExp(`\\n\\s+${column}:`));
    }
  });

  it("32 — the inspection no longer silently resets to NOT_REQUIRED", () => {
    // `inspection_status: input.inspectionStatus ?? "NOT_REQUIRED"` turned an
    // omitted field into a business fact: a PASSED inspection became a
    // not-required one when somebody saved the ICTD block.
    expect(payload).not.toContain('input.inspectionStatus ?? "NOT_REQUIRED"');
  });

  it("33 — the D4 five keep the same idiom, so there is ONE rule not two", () => {
    for (const field of [
      "input.shPositionCount",
      "input.declarationType",
      "input.dpiRegime",
      "input.exemptionTitleOrigin",
      "input.tariffClassificationOrigin",
      "input.required",
    ]) {
      expect(payload, field).toContain(`...(${field} === undefined ? {} : {`);
    }
  });

  it("34 — an explicit empty string still CLEARS: the metadata form must keep working", () => {
    // The distinction the fix rests on. The panel form always sends every
    // field, using "" to mean "cleared"; only an ABSENT key is left alone.
    expect(payload).toContain("input.declarationNumber?.trim() || null");
    expect(payload).toContain("input.externalRef?.trim() || null");
    expect(payload).toContain("input.notes?.trim() || null");
  });

  it("35 — updated_by is still stamped, so maker/checker still sees the edit", () => {
    // Omitting the stamp would not be a simplification; PG-6 refuses a
    // validation by the last editor, and an unstamped edit is invisible to it.
    expect(payload).toContain("updated_by: user.id,");
  });

  it("36 — the partial caller is real: governed-fields sends five fields and no more", () => {
    const gf = read("components/customs/governed-fields.tsx");
    const toPayload = gf.slice(gf.indexOf("function toPayload("), gf.indexOf("\n}", gf.indexOf("function toPayload(")));
    for (const sent of [
      "shPositionCount",
      "declarationType",
      "dpiRegime",
      "exemptionTitleOrigin",
      "tariffClassificationOrigin",
    ]) {
      expect(toPayload, sent).toContain(sent);
    }
    for (const notSent of ["declarationNumber", "customsOffice", "externalRef", "notes", "regime"]) {
      expect(toPayload, notSent).not.toContain(notSent);
    }
  });

  it("37 — the D4 certification lock is untouched", () => {
    const fn = actions.slice(
      actions.indexOf("export async function updateCustoms"),
      actions.indexOf("export async function changeCustomsStatus"),
    );
    expect(fn).toContain('if (rec.reviewed_at) return { ok: false, error: "validated_use_correction" };');
  });

  it("38 — and so is the composed step + ownership gate", () => {
    const fn = actions.slice(
      actions.indexOf("export async function updateCustoms"),
      actions.indexOf("export async function changeCustomsStatus"),
    );
    expect(fn).toContain('customsControlGate("customs.update", rec.file_id, user)');
    expect(fn).toContain('assertPermission("customs:update")');
  });
});
