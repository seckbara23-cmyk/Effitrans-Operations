/**
 * Customs panel — an error belongs to the control that produced it.
 * ---------------------------------------------------------------------------
 * One `error` string served NINE actions and was rendered ONCE, at the bottom of
 * the panel, immediately below the metadata form's save button. That made the
 * placement correct for exactly one action and, for the other eight, put the
 * message beside an UNRELATED control — a refusal from « → Déclaré » read as
 * "saving the metadata failed". It is why UAT-15 Part 3 Step 1 felt silent: the
 * message was correct, rendered, and 245 JSX lines below the button.
 *
 * Every assertion here is BOUNDED to one section. The file contains seven
 * near-identical `<ErrorLine …/>` elements, which is exactly the shape where a
 * whole-file `toContain` proves nothing — this session hit the
 * satisfied-by-neighbouring-text trap three times, most recently on a guard line
 * shared by two functions.
 *
 * Slicing is done on the RAW source because the section markers are comments;
 * the assertions target JSX that cannot appear inside them.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");
const panel = read("components", "customs", "customs-panel.tsx");
const i18n = read("lib", "i18n.ts");

/** Bounded slice. Throws when a boundary moves — a silently widened slice is how a pin stops testing anything. */
function section(startMarker: string, endMarker: string): string {
  const a = panel.indexOf(startMarker);
  const b = panel.indexOf(endMarker, a + startMarker.length);
  if (a < 0) throw new Error(`start marker not found: ${startMarker}`);
  if (b < 0) throw new Error(`end marker not found: ${endMarker}`);
  const slice = panel.slice(a, b);
  if (slice.length < 80) throw new Error(`slice suspiciously small for ${startMarker}`);
  return slice;
}

const SECTIONS = {
  create: section("if (!record) {", "const targets = nextStatuses"),
  workflow: section("{/* Workflow actions */}", "{/* MAYA-P1.1 — CEO step 8"),
  gainde: section("{/* MAYA-P1.1 — CEO step 8", "{/* MAYA-P1.11 — CEO step 9"),
  attachment: section("{/* MAYA-P1.11 — CEO step 9", "{/* MAYA-P0.8-A (PG-1)"),
  validation: section("{/* MAYA-P0.8-A (PG-1)", "{/* MAYA-P0.7-A —"),
  receivability: section("{/* MAYA-P0.7-A —", "{/* Editable manual-reference"),
  metadata: section("{/* Editable manual-reference", "function Field("),
} as const;

const SCOPES = Object.keys(SECTIONS) as (keyof typeof SECTIONS)[];
const line = (scope: string) => `<ErrorLine error={error} scope="${scope}" />`;

describe("customs errors — each scope renders in its OWN section", () => {
  it("every scope has exactly one render, in its own section", () => {
    for (const scope of SCOPES) {
      expect(SECTIONS[scope], scope).toContain(line(scope));
    }
  });

  it("no section renders ANOTHER section's error", () => {
    // The core guarantee: a workflow refusal cannot appear under the metadata
    // save button, which is precisely what used to happen.
    for (const scope of SCOPES) {
      for (const other of SCOPES) {
        if (other === scope) continue;
        expect(SECTIONS[scope], `${other} leaked into ${scope}`).not.toContain(line(other));
      }
    }
  });

  it("there are exactly seven renders in the file — no orphan, no duplicate", () => {
    expect((panel.match(/<ErrorLine /g) ?? []).length).toBe(SCOPES.length);
  });

  it("the old global trailing render is gone", () => {
    expect(panel).not.toContain('{error && <p className="text-xs text-red-600">{error}</p>}');
  });
});

describe("customs errors — each action reports under its own control", () => {
  const CALLS: [keyof typeof SECTIONS, string][] = [
    ["create", 'run(() => createCustoms(fileId), "create")'],
    ["workflow", 'run(() => releaseCustoms(record.id, bae.trim()), "workflow")'],
    ["workflow", 'run(() => changeCustomsStatus(record.id, s), "workflow")'],
    ["workflow", 'run(() => deleteCustoms(record.id), "workflow")'],
    ["gainde", 'run(() => recordGaindeRegistration(record.id, ref.trim()), "gainde")'],
    ["attachment", 'run(() => recordCustomsAttachment(record.id, set), "attachment")'],
    ["validation", 'run(() => recordCustomsValidation(record.id), "validation")'],
    ["receivability", 'run(() => recordReceivability(record.id, o, reason.trim()), "receivability")'],
    ["receivability", 'run(() => recordReceivability(record.id, o, null), "receivability")'],
  ];

  it("all nine call sites pass a scope, inside their own section", () => {
    expect(CALLS.length).toBe(9);
    for (const [scope, call] of CALLS) {
      expect(SECTIONS[scope], call).toContain(call);
    }
  });

  it("the metadata form submits under the metadata scope", () => {
    // Its `run(...)` spans several lines, so it is pinned on the argument.
    const submit = panel.slice(panel.indexOf("function onSubmit"), panel.indexOf("return (", panel.indexOf("function onSubmit")));
    expect(submit).toContain("updateCustoms(record!.id, {");
    expect(submit).toContain('"metadata",');
  });

  it("no call site can omit its scope — the runner requires it", () => {
    expect(panel).toContain("function run(fn: () => Promise<ActionResult>, scope: ErrorScope) {");
  });

  it("the scope union is closed, so a typo cannot address a scope nothing renders", () => {
    for (const scope of SCOPES) {
      expect(panel, scope).toContain(`  | "${scope}"`);
    }
  });
});

describe("customs errors — accessibility", () => {
  it("the message carries role=\"alert\"", () => {
    expect(panel).toContain('return <p role="alert" className="text-xs text-red-600">{error.message}</p>;');
  });

  it("it renders only for its own scope", () => {
    expect(panel).toContain("if (!error || error.scope !== scope) return null;");
  });
});

describe("customs errors — clearing and the stale-result race", () => {
  it("starting any action clears the previous message", () => {
    const runFn = panel.slice(panel.indexOf("function run(fn:"), panel.indexOf("const header ="));
    expect(runFn).toContain("setError(null);");
    // Cleared BEFORE the await, so no failure can outlive the next interaction.
    expect(runFn.indexOf("setError(null);")).toBeLessThan(runFn.indexOf("await fn()"));
  });

  it("a superseded result is discarded rather than shown under a newer action", () => {
    const runFn = panel.slice(panel.indexOf("function run(fn:"), panel.indexOf("const header ="));
    expect(runFn).toContain("const seq = ++runSeq.current;");
    expect(runFn).toContain("if (seq !== runSeq.current) return;");
    // The guard must sit between the await and the setError, or it guards nothing.
    expect(runFn.indexOf("if (seq !== runSeq.current) return;")).toBeGreaterThan(runFn.indexOf("await fn()"));
    expect(runFn.indexOf("if (seq !== runSeq.current) return;")).toBeLessThan(runFn.indexOf("setError({ scope"));
  });

  it("a success sets no error and refreshes", () => {
    const runFn = panel.slice(panel.indexOf("function run(fn:"), panel.indexOf("const header ="));
    expect(runFn).toContain("router.refresh();");
  });
});

describe("customs errors — business behaviour is untouched", () => {
  it("the « documents manquants » context still sits above the workflow controls", () => {
    const before = panel.slice(0, panel.indexOf("{/* Workflow actions */}"));
    expect(before).toContain("{c.missingTitle}");
  });

  it("the same server actions are still invoked — none replaced or removed", () => {
    for (const fn of [
      "createCustoms", "releaseCustoms", "changeCustomsStatus", "deleteCustoms",
      "recordGaindeRegistration", "recordCustomsAttachment", "recordCustomsValidation",
      "recordReceivability", "updateCustoms",
    ]) {
      expect(panel, fn).toContain(fn);
    }
  });

  it("the error VOCABULARY is reused, not re-invented", () => {
    expect(panel).toContain("const map = c.errors as Record<string, string>;");
    expect(panel).toContain("map[res.error] ?? c.errors.generic");
  });

  it("the ratified French refusals still exist in i18n", () => {
    for (const code of ["customs_docs_missing", "invalid_transition", "use_release"]) {
      expect(i18n, code).toContain(`${code}:`);
    }
  });

  it("no permission or transition logic moved into the panel", () => {
    for (const forbidden of ["assertPermission", "canTransition(", "hasPermission("]) {
      expect(panel, forbidden).not.toContain(forbidden);
    }
  });
});
