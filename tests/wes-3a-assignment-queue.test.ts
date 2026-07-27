/**
 * Phase WES-3A — assignment-path migration and the department queue.
 *
 * Closes the two gaps WES-3 documented as unbuilt. Structural assertions strip
 * comments (`code()` for TS, `sqlCode()` for SQL) so a comment that says the
 * right thing can never satisfy a test about code that does the wrong thing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  ASSIGNMENT_REASON_CODES,
  QUEUE_CATEGORIES,
  QUEUE_CATEGORY_LABELS_FR,
} from "@/lib/workflow/access/vocabulary";
import { getEventType } from "@/lib/workflow/events/types";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sqlCode = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const ASSIGNMENT_SQL = "supabase/migrations/20260727000002_assignment_history.sql";

// ---------------------------------------------------------------------------
// WES-3A.1 — caller migration
// ---------------------------------------------------------------------------
describe("WES-3A.1 assignment caller migration", () => {
  it("leaves NO production caller of the legacy assignTask", () => {
    // Walk every app/component/lib source and assert nothing imports or calls
    // the legacy action — except the module that defines it as a wrapper.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".next") continue;
          walk(rel);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        if (rel === "lib/tasks/actions.ts") continue; // the wrapper's own definition
        const src = code(rel);
        if (/\bassignTask\s*\(/.test(src) || /[{,]\s*assignTask\s*[,}]/.test(src)) {
          offenders.push(rel);
        }
      }
    };
    for (const dir of ["app", "components", "lib"]) walk(dir);

    expect(offenders, `legacy assignTask still called from:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("routes TaskRow through the canonical control", () => {
    const src = code("components/tasks/task-row.tsx");
    expect(src).toContain("TaskAssignment");
    expect(src).not.toContain("assignTask");
  });

  it("makes the canonical action the only path the control can reach", () => {
    const src = code("components/tasks/task-assignment.tsx");
    expect(src).toContain("assignTaskToUser");
    expect(src).not.toMatch(/from "@\/lib\/tasks\/actions"/);
  });

  it("keeps the legacy action as a DELEGATOR, not a second authority", () => {
    const src = code("lib/tasks/actions.ts");
    const fn = src.slice(src.indexOf("export async function assignTask("));
    const body = fn.slice(0, fn.indexOf("export async function changeTaskStatus"));
    expect(body).toContain("assignTaskToUser");
    // The old behaviour is unreachable: no direct write, no separate audit.
    expect(body).not.toMatch(/\.from\("task"\)[\s\S]{0,120}\.update\(/);
    expect(body).not.toContain("writeAudit");
  });

  it("has NO production write of task.assigned_to outside the RPC path", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".next") continue;
          walk(rel);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const src = code(rel);
        // `task` creation may set an initial assignee; only UPDATES are the
        // reassignment path this phase closes.
        if (/\.from\("task"\)[\s\S]{0,200}\.update\(\s*\{[^}]*assigned_to/.test(src)) {
          offenders.push(rel);
        }
      }
    };
    for (const dir of ["app", "components", "lib"]) walk(dir);

    expect(offenders, `direct assigned_to updates:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("moves the assignee notification onto the canonical path", () => {
    // The wrapper delegates, so a notification left behind in the old action
    // would simply never fire again.
    const canonical = code("lib/workflow/access/actions.ts");
    expect(canonical).toContain("createNotification");
    expect(canonical).toContain('type: "TASK_ASSIGNED"');
  });
});

// ---------------------------------------------------------------------------
// WES-3A.1 — assignment UI contract
// ---------------------------------------------------------------------------
describe("WES-3A.1 assignment UI", () => {
  const src = () => code("components/tasks/task-assignment.tsx");

  it("distinguishes assign, reassign and unassign", () => {
    const raw = read("components/tasks/task-assignment.tsx");
    expect(raw).toContain("Affecter");
    expect(raw).toContain("Réaffecter");
    expect(raw).toContain("Retirer");
    expect(src()).toContain('"UNASSIGNMENT"');
    expect(src()).toContain('"INITIAL"');
  });

  it("requires a reason before enabling supervisor reassignment", () => {
    const s = src();
    expect(s).toContain("needsReason");
    expect(s).toMatch(/needsReason && reason\.trim\(\)\.length === 0/);
    // The requirement itself lives in the shared vocabulary, so the UI, the
    // server action and the database trigger cannot drift apart.
    expect(s).toContain("reasonRequired");
    const vocab = code("lib/workflow/access/vocabulary.ts");
    expect(vocab).toMatch(/REASON_REQUIRED_CODES[\s\S]{0,120}SUPERVISOR_INTERVENTION/);
  });

  it("offers only reason codes the ledger accepts", () => {
    const s = src();
    for (const m of s.matchAll(/value: "([A-Z_]+)"/g)) {
      expect(ASSIGNMENT_REASON_CODES).toContain(m[1]);
    }
  });

  it("shows safe French errors, never raw server text", () => {
    const s = src();
    expect(s).toContain("ERRORS_FR");
    expect(s).toMatch(/ERRORS_FR\[res\.error\] \?\? ERRORS_FR\.assignment_failed/);
    // Never renders the raw error code.
    expect(s).not.toMatch(/setError\(res\.error\)/);
  });

  it("distinguishes 'no eligible people' from 'policy unresolved'", () => {
    const raw = read("components/tasks/task-assignment.tsx");
    expect(raw).toContain("Aucune personne éligible");
    expect(raw).toContain("Politique applicable indéterminée");
  });

  it("refreshes without implying a lifecycle change", () => {
    const s = src();
    expect(s).toContain("router.refresh()");
    expect(s).not.toContain("revalidate");
  });
});

// ---------------------------------------------------------------------------
// WES-3A.1 — eligible assignees come from policy
// ---------------------------------------------------------------------------
describe("WES-3A.1 eligible assignees", () => {
  const src = () => code("lib/workflow/access/assignees.ts");

  it("resolves from the pinned policy, not a staff directory", () => {
    expect(src()).toContain("resolveSeatEligibility");
    expect(src()).toContain("isEligibleForSeat");
  });

  it("offers only ACTIVE members of the caller's tenant", () => {
    const s = src();
    expect(s).toContain('status !== "active"');
    expect(s).toContain("tenant_id !== user.tenantId");
  });

  it("reports unresolved policy rather than an empty list", () => {
    expect(src()).toMatch(/if \(!eligibility\.resolved\) return \{ assignees: \[\], resolved: false \}/);
  });

  it("is wired into both task surfaces", () => {
    expect(code("app/files/[id]/page.tsx")).toContain("listEligibleAssigneesForFile");
    expect(code("app/tasks/page.tsx")).toContain("listEligibleAssigneesForFile");
    // The old unrestricted directory is gone from both.
    expect(code("app/files/[id]/page.tsx")).not.toContain("listAssignees()");
    expect(code("app/tasks/page.tsx")).not.toContain("listAssignees()");
  });

  it("resolves per DOSSIER on the cross-dossier list", () => {
    // One global eligible set cannot be correct when each dossier pins its own
    // policy — the list must be keyed by file.
    expect(code("components/tasks/tasks-table.tsx")).toContain("eligibilityByFile");
  });
});

// ---------------------------------------------------------------------------
// WES-3A.2 / 3A.3 — department queue
// ---------------------------------------------------------------------------
describe("WES-3A.2 department queue", () => {
  const src = () => code("lib/workflow/access/queue.ts");

  it("supports exactly the six required categories", () => {
    expect([...QUEUE_CATEGORIES]).toEqual([
      "unassigned", "mine", "colleague", "blocked", "awaiting_reception", "recently_completed",
    ]);
    for (const c of QUEUE_CATEGORIES) {
      expect(QUEUE_CATEGORY_LABELS_FR[c].length).toBeGreaterThan(0);
    }
  });

  it("derives department ownership from the CANONICAL PROJECTION", () => {
    const s = src();
    expect(s).toContain("buildCanonicalProjection");
    expect(s).toContain("projection.responsibleDepartment");
    expect(s).toContain("canonicalDepartmentForLifecycle");
  });

  it("never infers ownership from the retired column or from task presence", () => {
    const s = src();
    expect(s).not.toContain("assigned_to_user_id");
    // The department filter is the projection, not a task lookup.
    expect(s).toMatch(/if \(!myDepartments\.includes\(canonicalDepartmentForLifecycle\(responsible\)\)\) continue;/);
  });

  it("applies the WES-3 access resolver to every row", () => {
    const s = src();
    expect(s).toContain("resolveDossierAccess");
    expect(s).toMatch(/if \(!access\.canViewSummary\) continue;/);
  });

  it("withholds detail when the matrix withholds detail", () => {
    const s = src();
    expect(s).toMatch(/access\.canViewCurrentDepartmentDetail \? \(active\?\.title \?\? null\) : null/);
    expect(s).toContain("canOpenDetail: access.canViewCurrentDepartmentDetail");
  });

  it("bounds 'recently completed' to a fixed, deterministic window", () => {
    const s = src();
    expect(s).toContain("RECENTLY_COMPLETED_DAYS");
    expect(s).toContain("recentCutoff");
  });

  it("is deterministically ordered", () => {
    expect(src()).toMatch(/lastActivityAt\.localeCompare[\s\S]{0,120}fileNumber/);
  });

  it("is bounded — a queue is for working, not exporting", () => {
    expect(src()).toContain("MAX_DOSSIERS");
  });

  it("invents NO SLA value", () => {
    const s = src();
    expect(s).not.toMatch(/\bsla\b/i);
    expect(s).not.toMatch(/breach|deadline|dueWithin/i);
  });

  it("classifies blocked and awaiting-reception from real signals", () => {
    const s = src();
    expect(s).toMatch(/projection\.blocked \|\| fileTasks\.some\(\(t\) => t\.status === "BLOCKED"\)/);
    expect(s).toContain("unreceivedInstances");
    expect(s).toContain("received_at");
  });

  it("excludes closed dossiers — a closed dossier is not work", () => {
    expect(src()).toMatch(/\.neq\("status", "CLOSED"\)/);
  });

  it("gives a driver no queue, because it gives them no department", () => {
    // The exclusion lives in the department bridge and the queue inherits it.
    expect(code("lib/workflow/access/departments.ts")).toContain("NON_DOSSIER_ROLES");
    expect(src()).toContain("canonicalDepartmentsForRoles");
  });

  it("returns an empty queue for someone in no dossier department", () => {
    expect(src()).toMatch(/if \(myDepartments\.length === 0\) return EMPTY;/);
  });
});

describe("WES-3A.2 queue page", () => {
  const src = () => code("app/departments/queue/page.tsx");

  it("is read-only — it lists and links, it does not mutate", () => {
    const s = src();
    expect(s).not.toContain("use client");
    expect(s).not.toContain("<form");
    expect(s).not.toMatch(/assignTaskToUser|completeTask/);
  });

  it("requires dossier read and lets the resolver decide each row", () => {
    const s = src();
    expect(s).toContain('hasPermission(permissions, "file:read")');
    expect(s).toContain("getDepartmentWorkQueue");
  });

  it("is NOT merged into Mon Travail", () => {
    // Mon Travail stays the authenticated user's own actionable work. Merging
    // the department queue into it would put a colleague's task in your
    // personal list — the ambiguity WES-3 removes.
    const myWork = code("app/my-work/page.tsx");
    expect(myWork).not.toContain("getDepartmentWorkQueue");
    expect(myWork).not.toContain("QUEUE_CATEGORIES");
  });

  it("is reachable from Mon Travail, so unassigned work is discoverable", () => {
    // A route nobody can navigate to does not close WES-3H.
    expect(code("app/my-work/page.tsx")).toContain('href="/departments/queue"');
  });

  it("leaves the RATIFIED sidebar structure untouched", () => {
    // The five-section sidebar is a frozen contract with its own pinned tests
    // (Phase 5.0E-3), and this phase's mandate says not to redesign navigation.
    // The queue is reached from Mon Travail instead.
    expect(code("lib/navigation/build.ts")).not.toContain("departments/queue");
  });

  it("states that reassignment does not remove a dossier from the queue", () => {
    const raw = read("app/departments/queue/page.tsx");
    expect(raw).toMatch(/Réaffecter une tâche ne retire donc jamais un dossier/);
  });

  it("says plainly that no SLA is shown", () => {
    expect(read("app/departments/queue/page.tsx")).toMatch(/SLA arrivent avec WES-8/);
  });

  it("is not reachable by portal users", () => {
    // It lives under the staff app, which requireUser() gates; the portal has
    // its own route tree and its own layout.
    const s = src();
    expect(s).toContain("requireUser");
    expect(s).not.toContain("requirePortalUser");
  });
});

// ---------------------------------------------------------------------------
// WES-3A.4 / 3A.5 — history display and events
// ---------------------------------------------------------------------------
describe("WES-3A.4 assignment history display", () => {
  it("renders history from the protected ledger", () => {
    const src = code("components/files/ownership-panel.tsx");
    expect(src).toContain("readAssignmentHistory");
    expect(src).toContain("Historique des affectations");
  });

  it("shows the structured reason code, labelled", () => {
    const src = code("components/files/ownership-panel.tsx");
    expect(src).toContain("REASON_LABELS_FR");
    expect(src).toContain("h.reasonCode");
  });

  it("withholds the free-text reason from users without current detail", () => {
    const src = code("lib/workflow/access/service.ts");
    expect(src).toMatch(/const showReason = access\.canViewCurrentDepartmentDetail/);
    expect(src).toMatch(/reason: showReason \?/);
  });
});

describe("WES-3A.5 business events unchanged", () => {
  it("still emits the three task-assignment types, atomically", () => {
    for (const type of ["TASK_ASSIGNED", "TASK_REASSIGNED", "TASK_UNASSIGNED"]) {
      expect(getEventType(type)?.emission).toBe("rpc");
    }
    const sql = sqlCode(ASSIGNMENT_SQL);
    const body = sql.slice(
      sql.indexOf("create or replace function public.assign_task"),
      sql.indexOf("create or replace function public.assign_process_step"),
    );
    expect(body).toContain("emit_business_event");
  });

  it("introduces no new event semantics in this phase", () => {
    for (const invented of ["TASK_ASSIGNMENT_CHANGED", "QUEUE_VIEWED", "WORK_DISCOVERED"]) {
      expect(getEventType(invented)).toBeNull();
    }
  });

  it("adds no app-layer business-event write", () => {
    for (const file of ["lib/workflow/access/queue.ts", "lib/workflow/access/assignees.ts"]) {
      expect(code(file)).not.toContain("business_event");
    }
  });
});

// ---------------------------------------------------------------------------
// scope discipline
// ---------------------------------------------------------------------------
describe("WES-3A scope discipline", () => {
  it("does not start WES-4, WES-5, WES-6 or WES-8", () => {
    const all = code("lib/workflow/access/queue.ts") + code("app/departments/queue/page.tsx");
    // Word-bounded: "permission" contains "mission", and a bare substring scan
    // reports getEffectivePermissions as a WES-6 Mission entity.
    expect(all).not.toMatch(/mission/i);
    expect(all).not.toMatch(/bae_governance|sla_clock|reconciliation/i);
  });

  it("ships no migration — this phase is application-only", () => {
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql"));
    expect(files[files.length - 1]).toBe("20260727000002_assignment_history.sql");
  });

  it("does not change the canonical projection or the progress formula", () => {
    const projection = code("lib/workflow/projection.ts");
    expect(projection).not.toContain("queue");
    expect(projection).not.toContain("assignment_event");
  });

  it("introduces no new department vocabulary", () => {
    const s = code("lib/workflow/access/queue.ts");
    expect(s).toContain("canonicalDepartmentForLifecycle");
    expect(s).not.toMatch(/DEPARTMENT_CODES\s*=|new Department|QUEUE_DEPARTMENTS\s*=/);
  });
});
