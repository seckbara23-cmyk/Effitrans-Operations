/**
 * Task completion UX — the « Terminer » failure.
 *
 * Clicking « Terminer » on « Dossier prêt pour archivage » returned
 * « L'action a échoué. Veuillez réessayer. » The task engine and the dossier
 * lifecycle are separate systems, and three things were wrong at once:
 *
 *   1. `completeTask` correctly refused with WES-3B's `not_assigned`, but that
 *      code had NO French translation, so a precise refusal was flattened into
 *      the generic message;
 *   2. the INTERVENTION path existed server-side and was unreachable from the
 *      UI — the row always called `completeTask(id)` with no reason;
 *   3. the task was named as though completing it archived the dossier. It
 *      never did: closure runs through FileWorkflow -> transitionFile.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { mayCompleteWork } from "@/lib/workflow/access/resolver";
import { t } from "@/lib/i18n";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const access = (over: Partial<Record<string, boolean>> = {}) => ({
  canViewSummary: true,
  canViewCurrentDepartmentDetail: true,
  canViewHistoricalDepartmentDetail: true,
  canViewDocuments: true,
  canActOnCurrentStep: true,
  canCompleteAssignedTask: false,
  canReassignWithinDepartment: false,
  canIntervene: false,
  visibilityReason: "department" as const,
  reasons: [],
  ...over,
}) as unknown as Parameters<typeof mayCompleteWork>[0];

// ---------------------------------------------------------------------------
describe("WES-3B completion authority (unchanged)", () => {
  it("the assignee completes their own task", () => {
    expect(mayCompleteWork(access({ canCompleteAssignedTask: true }), { intervening: false, reason: null }))
      .toEqual({ ok: true });
  });

  it("a non-assignee who does not declare an intervention is refused", () => {
    expect(mayCompleteWork(access(), { intervening: false, reason: null }))
      .toEqual({ ok: false, error: "not_assigned" });
  });

  it("an UNAUTHORIZED non-assignee cannot intervene", () => {
    expect(mayCompleteWork(access({ canIntervene: false }), { intervening: true, reason: "x" }))
      .toEqual({ ok: false, error: "forbidden" });
  });

  it("an authorized intervention REQUIRES a reason", () => {
    expect(mayCompleteWork(access({ canIntervene: true }), { intervening: true, reason: null }))
      .toEqual({ ok: false, error: "reason_required" });
    expect(mayCompleteWork(access({ canIntervene: true }), { intervening: true, reason: "   " }))
      .toEqual({ ok: false, error: "reason_required" });
  });

  it("an authorized intervention WITH a reason succeeds", () => {
    expect(mayCompleteWork(access({ canIntervene: true }), { intervening: true, reason: "Titulaire absent" }))
      .toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
describe("the operator is told WHY — the actual defect", () => {
  it("not_assigned is translated and explains what to do", () => {
    const m = (t.tasks.errors as Record<string, string>).not_assigned;
    expect(m).toBeTruthy();
    expect(m).not.toBe(t.tasks.errors.generic);
    // it must say how to proceed, not merely that it failed
    expect(m.toLowerCase()).toContain("assignez");
    expect(m.toLowerCase()).toContain("motif");
  });

  it("reason_required is translated", () => {
    const m = (t.tasks.errors as Record<string, string>).reason_required;
    expect(m).toBeTruthy();
    expect(m).not.toBe(t.tasks.errors.generic);
  });

  it("EVERY code mayCompleteWork can return is translated", () => {
    const errors = t.tasks.errors as Record<string, string>;
    for (const c of ["not_assigned", "reason_required", "forbidden"]) {
      expect(errors[c], c).toBeTruthy();
    }
  });

  it("every code completeTask itself can return is translated", () => {
    const errors = t.tasks.errors as Record<string, string>;
    for (const c of ["forbidden", "not_found", "invalid_transition"]) {
      expect(errors[c], c).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
describe("the intervention path is reachable from the UI", () => {
  const row = () => code("components/tasks/task-row.tsx");

  it("an own task completes directly; another's opens the reason dialog", () => {
    expect(row()).toMatch(/isMine \? run\(\(\) => completeTask\(task\.id\)\) : setIntervening\(true\)/);
  });

  it("the dialog passes the reason to the server action", () => {
    expect(row()).toMatch(/completeTask\(task\.id, \{ reason \}\)/);
  });

  it("reuses the existing accessible dialog — no second modal", () => {
    const r = row();
    expect(r).toContain("PromptDialog");
    expect(r).toContain('from "@/components/finance/prompt-dialog"');
    expect(r).toContain("required");
  });

  it("labels the intervention distinctly", () => {
    expect(row()).toContain("t.tasks.actions.completeForOther");
    expect(t.tasks.actions.completeForOther).not.toBe(t.tasks.actions.complete);
  });

  it("an unassigned task is treated as not-mine, so the reason is required", () => {
    // task.assignedToId null => isMine false => intervention dialog
    expect(row()).toMatch(/Boolean\(currentUserId && task\.assignedToId && task\.assignedToId === currentUserId\)/);
  });

  it("the client never decides authority — the server re-checks", () => {
    const actions = code("lib/tasks/actions.ts");
    const fn = actions.slice(actions.indexOf("export async function completeTask"));
    expect(fn).toContain('assertPermission("task:update")');
    expect(fn).toContain("mayCompleteWork(");
    expect(fn).toMatch(/if \(!verdict\.ok\) return \{ ok: false, error: verdict\.error \}/);
  });
});

// ---------------------------------------------------------------------------
describe("intervention is audited as an intervention", () => {
  it("records the reason and the displaced assignee", () => {
    const actions = code("lib/tasks/actions.ts");
    expect(actions).toMatch(/intervention: true/);
    expect(actions).toMatch(/previous_assignee: assignee/);
    expect(actions).toContain("AuditActions.TASK_COMPLETED");
  });
});

// ---------------------------------------------------------------------------
describe("the two engines stay separate", () => {
  it("completeTask NEVER changes the dossier status", () => {
    const actions = code("lib/tasks/actions.ts");
    const fn = actions.slice(
      actions.indexOf("export async function completeTask"),
      actions.indexOf("export async function cancelTask"),
    );
    expect(fn).not.toContain("transitionFile");
    expect(fn).not.toContain('"CLOSED"');
    expect(fn).not.toMatch(/from\("operational_file"\)[\s\S]{0,120}\.update\(/);
  });

  it("closure remains exclusive to transitionFile with its guard", () => {
    const files = code("lib/files/actions.ts");
    expect(files).toContain("closureBlockers({");
    expect(files).toMatch(/if \(toStatus === "CLOSED"\)/);
    // and the closure guard was NOT modified by this fix
    expect(files).toContain("if (blockers.length > 0) return { ok: false, error: blockers[0] };");
  });

  it("the task no longer claims to archive anything", () => {
    expect(t.handoffs.titles.ARCHIVE_HANDOFF).toBe("Vérifier que le dossier est prêt pour clôture");
    expect(t.handoffs.titles.ARCHIVE_HANDOFF).not.toContain("archivage");
  });

  it("the closure control keeps its own distinct heading", () => {
    expect(code("components/files/file-workflow.tsx")).toContain("Clôture du dossier");
    expect(code("components/files/file-workflow.tsx")).toContain('id="closure"');
  });
});
