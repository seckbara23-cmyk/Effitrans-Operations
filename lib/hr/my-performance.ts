import "server-only";

/**
 * HR-B2 — « Mes évaluations » reads: the employee's own performance record and
 * the manager's review queue. SERVER-ONLY, admin client; the app-level gate is
 * IDENTITY — every query is scoped to the caller's linked employee (their own
 * evaluations, the evaluations whose SNAPSHOTTED manager they are), or to the
 * org-wide finalization queue for holders of `hr:performance:finalize`. That
 * scoping IS the gate (the EC-3C rule for admin-client reads), and the C3
 * prose is disclosed per the ratified Q2 lanes (./performance/disclosure).
 *
 * THE SNAPSHOT IS THE SCOPE. A manager's queue is built from
 * `hr_evaluation.manager_employee_id` — the manager of record at cycle-open —
 * not from a live assignment lookup. HR-B1's leave queue reads the live open
 * PRIMARY assignment because a leave request concerns today; an evaluation
 * concerns a period, and the person who must review it is the person who
 * managed it then. Same registry, same relationship, deliberately different
 * moment. No second hierarchy exists.
 *
 * NOT « Mon Travail », for the reason HR-B1 recorded: the workbench is the
 * process engine's surface and an evaluation is not a dossier step.
 */
import { getAdminSupabaseClient } from "@/lib/supabase/admin";
import { departmentLabelFr, isCanonicalDepartment } from "@/lib/organization/departments";
import { resolveLinkedEmployee, type LinkedEmployee } from "./identity";
import { listEvaluations, listObjectives, listCycles } from "./performance";
import type { Evaluation, Objective, PerformanceCycle } from "./performance/scoring";

export type EvaluationLine = {
  evaluation: Evaluation;
  cycleLabel: string;
  cycleStatus: string;
  employeeName: string;
  employeeNumber: string;
  departmentFr: string;
  objectives: Objective[];
};

export type MyPerformanceWorkspace = {
  employee: LinkedEmployee | null;
  /** The caller's own evaluations, newest cycle first. */
  mine: EvaluationLine[];
  /** Evaluations whose SNAPSHOTTED manager is the caller. */
  team: EvaluationLine[];
  /** MANAGER_SUBMITTED evaluations org-wide — only for finalization seats. */
  awaitingFinalization: EvaluationLine[];
};

function deptFr(code: string): string {
  return isCanonicalDepartment(code) ? departmentLabelFr(code) : code;
}

export async function getMyPerformanceWorkspace(
  user: { id: string; tenantId: string },
  opts: { canFinalize: boolean; canReadSensitive: boolean },
): Promise<MyPerformanceWorkspace> {
  const employee = await resolveLinkedEmployee(user.tenantId, user.id);
  const active = employee && employee.status === "ACTIVE" ? employee : null;
  const reader = { canReadSensitive: opts.canReadSensitive, viewerEmployeeId: active?.id ?? null };

  const [cycles, mineRaw, teamRaw, orgRaw] = await Promise.all([
    listCycles(user.tenantId),
    active ? listEvaluations(user.tenantId, { employeeId: active.id, ...reader }) : Promise.resolve([]),
    active ? listEvaluations(user.tenantId, { managerEmployeeId: active.id, ...reader }) : Promise.resolve([]),
    opts.canFinalize ? listEvaluations(user.tenantId, reader) : Promise.resolve([]),
  ]);

  const cycleById = new Map(cycles.map((c: PerformanceCycle) => [c.id, c]));
  const ids = [...new Set([...mineRaw, ...teamRaw, ...orgRaw].map((e) => e.employeeId))];

  const s = getAdminSupabaseClient();
  const { data: people } = ids.length
    ? await s.from("employee").select("id, employee_number, first_name, last_name, department")
        .eq("tenant_id", user.tenantId).in("id", ids)
    : { data: [] };
  const byId = new Map((people ?? []).map((p) => [p.id, p]));

  // Objectives for the caller's own record and their team's — the numbers a
  // review is about. Bounded by the same identity scope as the evaluations.
  const objectives = active
    ? await listObjectives(user.tenantId, { employeeId: active.id })
    : [];
  const objectivesByEmployee = new Map<string, Objective[]>();
  for (const o of objectives) {
    const list = objectivesByEmployee.get(o.employeeId) ?? [];
    list.push(o);
    objectivesByEmployee.set(o.employeeId, list);
  }

  const line = (e: Evaluation): EvaluationLine => {
    const person = byId.get(e.employeeId);
    const cycle = cycleById.get(e.cycleId);
    return {
      evaluation: e,
      cycleLabel: cycle?.labelFr ?? "Cycle",
      cycleStatus: cycle?.status ?? "",
      employeeName: person ? `${person.first_name} ${person.last_name}` : "—",
      employeeNumber: person?.employee_number ?? "—",
      departmentFr: person ? deptFr(person.department) : "—",
      objectives: objectivesByEmployee.get(e.employeeId) ?? [],
    };
  };

  const teamIds = new Set(teamRaw.map((e) => e.id));
  const mineIds = new Set(mineRaw.map((e) => e.id));
  return {
    employee,
    mine: mineRaw.map(line),
    team: teamRaw.map(line),
    awaitingFinalization: orgRaw
      .filter((e) => e.status === "MANAGER_SUBMITTED" && !teamIds.has(e.id) && !mineIds.has(e.id))
      .map(line),
  };
}
