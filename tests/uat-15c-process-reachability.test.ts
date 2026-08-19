/**
 * TMS-7 / DEFECT-UAT15c — the opening surface you could not navigate to.
 * ---------------------------------------------------------------------------
 * UAT-15 part 2 failed three times on a dossier that was never opened through
 * the process engine. The diagnostics route proved every flag, permission and
 * projection was green, so the intake action was simply never invoked.
 *
 * The reason was navigational, not authorizational. `ProcessJourneyPanel` held
 * the ONLY link to /files/{id}/process, and it returned null whenever the
 * dossier had no process instance — so the surface where a process is opened
 * was unreachable from the dossier page for exactly the dossiers needing it.
 * The operator used the controls that were visible instead (« Responsable » and
 * « Faire avancer → Ouvert »), which set operational_file.status = OPENED and
 * create no instance.
 *
 * Same class as the TMS-5A Parc & Flotte reachability defect: the capability
 * existed and worked; nothing led to it.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");

const journey = read("components", "process", "process-journey.tsx");
const fileWorkflow = read("components", "files", "file-workflow.tsx");
const filesActions = read("lib", "files", "actions.ts");

/** The panel body with comments stripped — a doctrine comment must never satisfy a pin. */
const code = journey.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("DEFECT-UAT15c — a dossier without a process can reach the surface that opens one", () => {
  it("the panel no longer returns null the moment there is no process state", () => {
    // The defect verbatim. If this line comes back, the link disappears again.
    expect(code).not.toContain("if (!model) return null;");
  });

  it("it offers the intake surface instead", () => {
    expect(code).toContain("if (!model) {");
    expect(code).toContain("href={`/files/${fileId}/process`}");
  });

  it("the invitation names the action, not the page", () => {
    expect(journey).toContain("Ouvrir le processus officiel");
  });

  it("it says plainly that the dossier's STATUS is not the process", () => {
    // The exact confusion that cost three attempts: « Ouvert » is a file status,
    // not an opened process.
    expect(journey).toContain("statut du dossier ne suffit pas");
  });
});

describe("DEFECT-UAT15c — the signpost is gated, and it opens nothing", () => {
  it("eligibility is decided by the real intake resolver, not a local re-check", () => {
    // getIntakeState enforces the intake flags, process:read and file
    // visibility. Re-deriving those here is how a rollout rule gets forked.
    expect(code).toContain("await getIntakeState(fileId)");
    expect(code).toContain("if (!intake || intake.hasInstance) return null;");
  });

  it("an ineligible viewer still sees nothing at all", () => {
    const guard = code.slice(code.indexOf("if (!model) {"), code.indexOf("return (", code.indexOf("if (!model) {")));
    expect(guard).toContain("return null;");
  });

  it("the panel performs no write and opens no process", () => {
    for (const write of ["openDossierWorkflow", "assignProcessOwner", "transitionFile", "createProcessInstance"]) {
      expect(code, write).not.toContain(write);
    }
  });

  it("no flag is re-read locally — the resolvers stay the single gate", () => {
    for (const flag of ["globalKillSwitch", "getTenantProcessFlags", "getProcessFlags"]) {
      expect(code, flag).not.toContain(flag);
    }
  });
});

describe("DEFECT-UAT15c — the control that misled is unchanged, and still not the process", () => {
  it("« Faire avancer » remains an operational_file status transition only", () => {
    expect(fileWorkflow).toContain("transitionFile(file.id, to)");
    // It must not have been quietly wired to the engine to paper over the gap:
    // two ratified concepts, deliberately kept separate.
    expect(fileWorkflow).not.toContain("openDossierWorkflow");
  });

  it("transitionFile still creates no process instance", () => {
    const fn = filesActions.slice(
      filesActions.indexOf("export async function transitionFile"),
      filesActions.indexOf("export async function", filesActions.indexOf("export async function transitionFile") + 40),
    );
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).not.toContain("process_instance");
    expect(fn).not.toContain("openDossierWorkflow");
  });
});
