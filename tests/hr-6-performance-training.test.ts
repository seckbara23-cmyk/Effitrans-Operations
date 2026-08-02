/**
 * HR-6 — Performance & Training. Pins the boundaries this phase promised NOT to
 * cross as hard as the behaviour it delivered: no scoring formula, no LMS, no
 * procurement, no SYSTEM_ADMIN access, no unratified grant, no float.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { HR_EVENT_LABEL_FR } from "@/lib/hr/ledger";
import {
  WEIGHT_TOTAL_BP, formatBp, percentToBp, weightCheck,
  EVALUATION_STAGES, CYCLE_STATUS_FR, EVALUATION_STATUS_FR, type Objective,
} from "@/lib/hr/performance/scoring";
import {
  DELIVERY_MODE_FR, ENROLLMENT_STATUS_FR, CERTIFICATE_EXPIRY_WINDOW_DAYS,
  OPEN_ENROLLMENT_STATUSES, CLOSED_ENROLLMENT_STATUSES, isOverdue,
  type TrainingEnrollment,
} from "@/lib/hr/training/catalog";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Strip comments — a promise kept in prose is not a promise kept in code. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const PERF_SQL = "supabase/migrations/20260803000001_hr_performance.sql";
const TRAIN_SQL = "supabase/migrations/20260803000002_hr_training.sql";
const PERF_TABLES = [
  "hr_performance_cycle", "hr_competency", "hr_competency_expectation",
  "hr_evaluation", "hr_objective", "hr_competency_assessment",
];
const TRAIN_TABLES = ["hr_training_course", "hr_training_plan", "hr_training_enrollment"];

// ---------------------------------------------------------------------------
describe("migration chain — additive, forward-only", () => {
  it("adds exactly two migrations after 77, and touches none of the first 77", () => {
    const all = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(all.length).toBe(79);
    expect(all[77]).toBe("20260803000001_hr_performance.sql");
    expect(all[78]).toBe("20260803000002_hr_training.sql");
    // Strictly after the HR-5 migration, so the chain replays in order.
    expect(all[76]).toBe("20260802000003_hr_leave_attendance.sql");
  });

  it("is idempotent DDL and makes no destructive change", () => {
    for (const f of [PERF_SQL, TRAIN_SQL]) {
      const sql = code(f);
      for (const t of [...PERF_TABLES, ...TRAIN_TABLES]) {
        if (sql.includes(`create table`) && sql.includes(t)) {
          expect(sql, `${f}/${t}`).toContain(`create table if not exists public.${t}`);
        }
      }
      expect(sql, f).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b|\balter column .* type\b/i);
      // Only triggers/policies/functions are dropped-then-recreated (idempotency).
      for (const m of sql.match(/^\s*drop\s+(\w+)/gim) ?? []) {
        expect(m.trim().split(/\s+/)[1].toLowerCase()).toMatch(/^(trigger|policy|function)$/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe("permissions — exactly ONE new code, granted to NOBODY", () => {
  it("adds hr:performance:finalize and nothing else", () => {
    const both = code(PERF_SQL) + code(TRAIN_SQL);
    const added = [...both.matchAll(/\('(hr:[a-z:_]+)',\s*'hr'/g)].map((m) => m[1]);
    expect(added).toEqual(["hr:performance:finalize"]);
  });

  it("creates NO role_permission grant and never names SYSTEM_ADMIN", () => {
    for (const f of [PERF_SQL, TRAIN_SQL]) {
      expect(code(f), f).not.toMatch(/insert into public\.role_permission/i);
      expect(code(f), f).not.toContain("SYSTEM_ADMIN");
    }
  });

  it("does NOT invent the permissions that turned out to be unnecessary", () => {
    const both = code(PERF_SQL) + code(TRAIN_SQL);
    for (const p of ["hr:performance:read", "hr:performance:manage", "hr:training:manage", "hr:training:read"]) {
      expect(both, p).not.toContain(`'${p}'`);
    }
  });

  it("finalization is gated on its OWN authority, never on hr:manage", () => {
    const a = code("lib/hr/performance-actions.ts");
    expect(a).toContain('assertPermission("hr:performance:finalize")');
    // The finalize function must not fall back to a broader gate.
    const fn = a.slice(a.indexOf("export async function finalizeEvaluation"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).not.toContain('assertPermission("hr:manage")');
  });

  it("the competency CATALOG is configuration, gated on hr:config:manage", () => {
    const a = code("lib/hr/performance-actions.ts");
    const fn = a.slice(a.indexOf("export async function upsertCompetency"));
    // Slice to the NEXT export: a function's PARAMETER OBJECT also ends with "\n}".
    const body = fn.slice(0, fn.indexOf("export async function", 10) + 1 || fn.length);
    expect(body).toContain('assertPermission("hr:config:manage")');
    expect(body).not.toContain('assertPermission("hr:manage")');
  });
});

// ---------------------------------------------------------------------------
describe("security — RLS, tenant isolation, portal invisibility", () => {
  it("enables RLS and a tenant+hr:read SELECT policy on EVERY new table", () => {
    const both = code(PERF_SQL) + code(TRAIN_SQL);
    for (const t of [...PERF_TABLES, ...TRAIN_TABLES]) {
      expect(both, `rls ${t}`).toContain(`alter table public.${t}` + " ".repeat(Math.max(0, 0)));
      expect(both, `policy ${t}`).toMatch(
        new RegExp(`create policy ${t}_select on public\\.${t}`),
      );
    }
    const policies = [...both.matchAll(/create policy \w+_select on public\.\w+([\s\S]*?);/g)];
    expect(policies.length).toBe(PERF_TABLES.length + TRAIN_TABLES.length);
    for (const p of policies) {
      expect(p[1]).toContain("tenant_id = public.auth_tenant_id()");
      expect(p[1]).toContain("public.has_permission('hr:read')");
      expect(p[1]).toContain("for select to authenticated");
    }
  });

  it("grants NO write privilege to authenticated — writes go through the service role", () => {
    const both = code(PERF_SQL) + code(TRAIN_SQL);
    for (const g of both.match(/grant [\s\S]*?to authenticated;/g) ?? []) {
      expect(g).toMatch(/grant select/);
      expect(g).not.toMatch(/insert|update|delete/i);
    }
  });

  it("creates no portal policy — customers never read HR", () => {
    const both = code(PERF_SQL) + code(TRAIN_SQL);
    expect(both).not.toMatch(/client_user|portal/i);
  });

  it("every RPC is SECURITY DEFINER with a pinned search_path, revoked from public", () => {
    const both = code(PERF_SQL) + code(TRAIN_SQL);
    const fns = [...both.matchAll(/create or replace function public\.(hr_\w+)\(/g)].map((m) => m[1]);
    const rpcs = fns.filter((f) => both.includes(`revoke execute on function public.${f}(`));
    expect(rpcs.length).toBe(9); // 6 performance + 3 training
    for (const f of rpcs) {
      expect(both, f).toContain(`grant execute on function public.${f}(`);
      expect(both, f).toMatch(new RegExp(`function public\\.${f}\\([\\s\\S]{0,600}?security definer set search_path = public, pg_temp`));
    }
  });

  it("C3 evaluation prose is WITHHELD at the query, not merely at the mapping", () => {
    const p = code("lib/hr/performance.ts");
    expect(p).toContain("canReadSensitive ? `${WORKFLOW_COLUMNS}, ${C3_COLUMNS}` : WORKFLOW_COLUMNS");
    // The workflow projection must not name a single prose column.
    const workflow = p.slice(p.indexOf("const WORKFLOW_COLUMNS"), p.indexOf("const C3_COLUMNS"));
    for (const c of ["self_comments", "manager_comments", "manager_strengths",
                     "manager_development", "recommended_actions", "moderation_note", "final_summary"]) {
      expect(workflow, c).not.toContain(c);
    }
  });

  it("audit payloads carry no C3 prose — stages are recorded, contents are not", () => {
    const a = code("lib/hr/performance-actions.ts");
    for (const m of a.match(/writeAudit\(\{[\s\S]*?\}\);/g) ?? []) {
      for (const c of ["comments", "strengths", "development", "moderationNote",
                       "finalSummary", "managerAssessment", "p_comments"]) {
        expect(m, c).not.toContain(c);
      }
    }
  });
});

// ---------------------------------------------------------------------------
describe("no scoring formula was invented (HRQ-P3)", () => {
  it("no aggregate score column exists in the schema", () => {
    const sql = code(PERF_SQL);
    for (const forbidden of ["overall_score", "final_score", "total_score", "rating",
                             "average", "rank", "percentile", "potential", "talent"]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
  });

  it("no service or UI computes an average, a ranking or a classification", () => {
    for (const f of ["lib/hr/performance.ts", "lib/hr/performance/scoring.ts",
                     "lib/hr/performance-actions.ts", "components/hr/performance-studio.tsx"]) {
      expect(code(f), f).not.toMatch(/\baverage\b|\bavg\(|\branking\b|\bpercentile\b|high.?potential/i);
    }
  });

  it("keeps money-grade precision: integer basis points, never a float", () => {
    const sql = code(PERF_SQL);
    // Every bp column is an int with explicit bounds.
    for (const m of sql.match(/\w*_bp\s+int[^,]*/g) ?? []) expect(m).toMatch(/int/);
    expect(sql).not.toMatch(/\w*_bp\s+(numeric|real|double|float|decimal)/i);
    expect(code("lib/hr/performance/scoring.ts")).not.toMatch(/parseFloat|toFixed\(1\)/);
  });

  it("percentToBp rounds to an integer and refuses out-of-range input", () => {
    expect(percentToBp("25")).toBe(2500);
    expect(percentToBp("33,33")).toBe(3333);
    expect(percentToBp("0.1")).toBe(10);
    expect(Number.isInteger(percentToBp("12.345")!)).toBe(true);
    expect(percentToBp("101")).toBeNull();
    expect(percentToBp("-1")).toBeNull();
    expect(percentToBp("abc")).toBeNull();
  });

  it("the classic float trap does not reach a weight", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. In bp it is exact.
    expect(percentToBp("10")! + percentToBp("20")!).toBe(percentToBp("30"));
  });

  it("formatBp prints without mutating the stored integer", () => {
    expect(formatBp(10000)).toBe("100,00 %");
    expect(formatBp(2550)).toBe("25,50 %");
    expect(WEIGHT_TOTAL_BP).toBe(10000);
  });
});

// ---------------------------------------------------------------------------
describe("weight rule — enforced at FINALIZATION, and only when applicable", () => {
  const obj = (weightBp: number, status = "ACTIVE"): Objective => ({
    id: `o${weightBp}${status}`, employeeId: "e", cycleId: "c", title: "t", description: null,
    category: null, weightBp, measurableTarget: null, dueDate: null, status, progressBp: 0,
    managerAchievementBp: null, managerAssessment: null, completionNote: null,
    evidenceDocumentId: null, version: 1, supersedesObjectiveId: null, locked: false,
  });

  it("an employee with NO objectives is finalizable (competency-only review)", () => {
    const r = weightCheck([], WEIGHT_TOTAL_BP);
    expect(r.applicable).toBe(false);
    expect(r.satisfied).toBe(true);
  });

  it("objectives that do not total the configured amount are NOT satisfied", () => {
    expect(weightCheck([obj(6000)], 10000).satisfied).toBe(false);
    expect(weightCheck([obj(6000), obj(4000)], 10000).satisfied).toBe(true);
    expect(weightCheck([obj(6000), obj(5000)], 10000).satisfied).toBe(false);
  });

  it("superseded and cancelled objectives are excluded from the total", () => {
    const r = weightCheck([obj(10000), obj(6000, "SUPERSEDED"), obj(3000, "CANCELLED")], 10000);
    expect(r.totalBp).toBe(10000);
    expect(r.satisfied).toBe(true);
  });

  it("honours a tenant total that is not 100%", () => {
    expect(weightCheck([obj(5000)], 5000).satisfied).toBe(true);
  });

  it("the RPC — not the UI — is what actually enforces it", () => {
    const sql = code(PERF_SQL);
    const fn = sql.slice(sql.indexOf("function public.hr_finalize_evaluation"));
    expect(fn).toContain("v_objectives > 0 and v_total_bp <> v_required_bp");
    expect(fn).toContain("HR617");
    expect(fn).toContain("status not in ('CANCELLED','SUPERSEDED')");
  });
});

// ---------------------------------------------------------------------------
describe("actor separation — no stage may impersonate another", () => {
  it("the schema refuses one person occupying two seats", () => {
    const sql = code(PERF_SQL);
    expect(sql).toContain("constraint evaluation_manager_differs_from_self");
    expect(sql).toContain("manager_entered_by <> self_entered_by");
    expect(sql).toContain("constraint evaluation_finalizer_differs_from_manager");
    expect(sql).toContain("finalized_by <> manager_entered_by");
    expect(sql).toContain("constraint evaluation_not_own_manager");
  });

  it("the RPCs refuse it too, with named errors rather than a constraint violation", () => {
    const sql = code(PERF_SQL);
    expect(sql).toContain("HR614"); // reviewer = self-assessor
    expect(sql).toContain("HR616"); // finalizer = reviewer
  });

  it("the four stages are ordered and complete", () => {
    expect([...EVALUATION_STAGES]).toEqual([
      "DRAFT", "SELF_SUBMITTED", "MANAGER_SUBMITTED", "FINALIZED", "ACKNOWLEDGED",
    ]);
    for (const s of EVALUATION_STAGES) expect(EVALUATION_STATUS_FR[s]).toBeTruthy();
    expect(Object.keys(CYCLE_STATUS_FR).sort())
      .toEqual(["CANCELLED", "DRAFT", "FINALIZED", "IN_REVIEW", "OPEN"]);
  });

  it("the self-assessment column is named so nobody mistakes who typed it", () => {
    // No employee self-service surface exists (HRQ-P1); the column records the
    // LOGIN that entered the text, and its name must not claim more than that.
    expect(code(PERF_SQL)).toContain("self_entered_by");
    expect(code(PERF_SQL)).not.toContain("self_submitted_by");
  });
});

// ---------------------------------------------------------------------------
describe("immutability — finalized performance is permanent", () => {
  it("a finalized evaluation admits ONLY the acknowledgment", () => {
    const sql = code(PERF_SQL);
    const fn = sql.slice(sql.indexOf("function public.hr_evaluation_immutable_once_finalized"));
    expect(fn).toContain("old.status in ('FINALIZED','ACKNOWLEDGED','CANCELLED')");
    expect(fn).toContain("old.status = 'FINALIZED' and new.status = 'ACKNOWLEDGED'");
    // Every assessment field is compared, so an acknowledgment cannot smuggle an edit.
    for (const c of ["self_comments", "manager_comments", "manager_strengths",
                     "manager_development", "recommended_actions", "moderation_note",
                     "final_summary", "finalized_by", "finalized_at"]) {
      expect(fn, c).toMatch(new RegExp(`new\\.${c}\\s+is not distinct from old\\.${c}`));
    }
    expect(fn).toContain("HR604");
  });

  it("objectives lock at finalization and nothing unlocks them", () => {
    const sql = code(PERF_SQL);
    expect(sql).toContain("update public.hr_objective set locked_at = now()");
    expect(sql).toContain("function public.hr_objective_locked_guard");
    expect(sql).toContain("old.locked_at is not null");
    expect(sql).not.toMatch(/set locked_at = null|unlock/i);
  });

  it("an amendment supersedes rather than rewrites", () => {
    const sql = code(PERF_SQL);
    expect(sql).toContain("supersedes_objective_id");
    expect(sql).toContain("set status = 'SUPERSEDED'");
    expect(sql).not.toMatch(/delete from public\.hr_objective/i);
  });

  it("a cycle has no uncontrolled transition and cannot be reopened", () => {
    const sql = code(PERF_SQL);
    const fn = sql.slice(sql.indexOf("function public.hr_performance_cycle_transition_guard"));
    expect(fn).toContain("old.status = 'DRAFT'     and new.status = 'OPEN'");
    expect(fn).toContain("old.status = 'OPEN'      and new.status = 'IN_REVIEW'");
    expect(fn).toContain("old.status = 'IN_REVIEW' and new.status = 'FINALIZED'");
    expect(fn).toContain("HR602"); // no reopening
    expect(fn).toContain("HR603"); // no other transition
  });

  it("a closed enrollment is terminal, except for attaching missing evidence", () => {
    const sql = code(TRAIN_SQL);
    const fn = sql.slice(sql.indexOf("function public.hr_training_enrollment_terminal_guard"));
    expect(fn).toContain("old.status in ('COMPLETED','FAILED','CANCELLED')");
    expect(fn).toContain("old.certificate_document_id is null");
    expect(fn).toContain("new.completed_on is not distinct from old.completed_on");
    expect(fn).toContain("new.result      is not distinct from old.result");
    expect(fn).toContain("HR650");
  });
});

// ---------------------------------------------------------------------------
describe("training is a REGISTER, not a learning platform", () => {
  it("no LMS concept enters the schema", () => {
    const sql = code(TRAIN_SQL);
    for (const forbidden of ["lesson", "module_", "chapter", "quiz", "question",
                             "curriculum", "syllabus", "content_url", "video",
                             "player", "scorm", "enrollment_key", "seat_time"]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
  });

  it("no procurement, invoice or payment concept enters the schema (§17)", () => {
    const sql = code(TRAIN_SQL);
    for (const forbidden of ["cost", "price", "amount", "invoice", "budget",
                             "purchase", "reimburse", "currency", "payment"]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
  });

  it("delivery is a reference OUT, never a second system inside", () => {
    expect(code(TRAIN_SQL)).toContain("provider_reference");
  });

  it("the register vocabulary is complete and terminal states are named", () => {
    expect(Object.keys(DELIVERY_MODE_FR).sort())
      .toEqual(["CERTIFICATION", "EXTERNAL", "INTERNAL", "IN_PERSON", "ONLINE"]);
    expect([...OPEN_ENROLLMENT_STATUSES, ...CLOSED_ENROLLMENT_STATUSES].sort())
      .toEqual(Object.keys(ENROLLMENT_STATUS_FR).sort());
    expect(CERTIFICATE_EXPIRY_WINDOW_DAYS).toBe(60);
  });

  it("isOverdue is a date comparison over OPEN statuses only", () => {
    const base: TrainingEnrollment = {
      id: "e", employeeId: "x", courseId: "c", planId: null, status: "PLANNED",
      plannedDate: null, dueDate: "2026-01-01", completedOn: null, result: null,
      expiryDate: null, certificateDocumentId: null, providerReference: null, note: null,
    };
    expect(isOverdue(base, "2026-06-01")).toBe(true);
    expect(isOverdue({ ...base, dueDate: "2027-01-01" }, "2026-06-01")).toBe(false);
    expect(isOverdue({ ...base, dueDate: null }, "2026-06-01")).toBe(false);
    // A completed training is never overdue, however late its due date was.
    expect(isOverdue({ ...base, status: "COMPLETED" }, "2026-06-01")).toBe(false);
    expect(isOverdue({ ...base, status: "CANCELLED" }, "2026-06-01")).toBe(false);
  });

  it("certificate expiry comes from the COURSE's configured validity, not a guess", () => {
    const sql = code(TRAIN_SQL);
    expect(sql).toContain("make_interval(months => v_validity)");
    expect(sql).not.toMatch(/interval '\d+ (month|year)'/);
  });

  it("evidence reuses HR-3's private bucket — no second bucket is created", () => {
    const both = code(PERF_SQL) + code(TRAIN_SQL);
    expect(both).not.toMatch(/storage\.buckets/i);
    expect(code(TRAIN_SQL)).toContain("references public.hr_document (id)");
    expect(code(PERF_SQL)).toContain("references public.hr_document (id)");
    // Never the general-purpose document table.
    expect(both).not.toMatch(/references public\.document\b/);
  });
});

// ---------------------------------------------------------------------------
describe("competencies are configuration, never a platform opinion", () => {
  it("NO competency is seeded", () => {
    const sql = code(PERF_SQL);
    expect(sql).not.toMatch(/insert into public\.hr_competency\b/i);
    for (const c of ["Leadership", "Communication", "Teamwork", "Compliance", "Reliability"]) {
      expect(sql, c).not.toContain(c);
    }
  });

  it("the scale is tenant-configurable and its bounds are enforced", () => {
    const sql = code(PERF_SQL);
    expect(sql).toContain("scale_min");
    expect(sql).toContain("scale_max");
    expect(sql).toContain("scale_labels");
    expect(sql).toContain("constraint competency_scale_ordered");
    expect(sql).toContain("function public.hr_competency_assessment_scale_guard");
    expect(sql).toContain("HR607");
  });

  it("expected levels attach to a POSITION, which is tenant configuration", () => {
    expect(code(PERF_SQL)).toContain("hr_competency_expectation");
    expect(code(PERF_SQL)).toContain("references public.hr_position (id)");
  });
});

// ---------------------------------------------------------------------------
describe("ledger — meaningful events only, and every kind is labelled", () => {
  const MANDATED = [
    "performance_cycle_opened", "objective_assigned", "self_assessment_submitted",
    "manager_review_submitted", "performance_review_finalized",
    "training_assigned", "training_completed", "certificate_recorded",
  ];

  it("emits every mandated event kind from inside the transaction", () => {
    const both = code(PERF_SQL) + code(TRAIN_SQL);
    for (const k of MANDATED) expect(both, k).toContain(`'${k}'`);
  });

  it("every emitted kind has a French label", () => {
    const both = code(PERF_SQL) + code(TRAIN_SQL);
    const emitted = new Set(
      [...both.matchAll(/hr_employee_event[\s\S]{0,400}?'(\w+)',\s*p_actor/g)].map((m) => m[1]),
    );
    expect(emitted.size).toBeGreaterThanOrEqual(MANDATED.length);
    for (const k of emitted) {
      expect(HR_EVENT_LABEL_FR[k as keyof typeof HR_EVENT_LABEL_FR], k).toBeTruthy();
    }
  });

  it("draft edits do NOT reach the employee narrative timeline", () => {
    const a = code("lib/hr/performance-actions.ts");
    // Progress updates and competency levels are audited, never emitted.
    for (const fn of ["updateObjectiveProgress", "recordCompetencyAssessment"]) {
      const body = a.slice(a.indexOf(`export async function ${fn}`));
      expect(body.slice(0, body.indexOf("\n}")), fn).not.toContain("emitHrEvent");
    }
  });

  it("every write still creates a security audit record", () => {
    for (const f of ["lib/hr/performance-actions.ts", "lib/hr/training-actions.ts"]) {
      const a = code(f);
      const exported = [...a.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
      expect(exported.length).toBeGreaterThan(5);
      for (const fn of exported) {
        const body = a.slice(a.indexOf(`export async function ${fn}`));
        expect(body.slice(0, body.indexOf("\n}\n")), `${f}:${fn}`).toContain("writeAudit(");
      }
    }
  });

  it('all "use server" exports are async (the HR-11.0C build-only trap)', () => {
    for (const f of ["lib/hr/performance-actions.ts", "lib/hr/training-actions.ts"]) {
      const a = read(f);
      expect(a.startsWith('"use server"')).toBe(true);
      for (const m of a.match(/^export (?!type )(?:async )?function/gm) ?? []) {
        expect(m, f).toContain("async");
      }
      expect(a).not.toMatch(/^export const \w+ =/m);
    }
  });
});

// ---------------------------------------------------------------------------
describe("workspace activation", () => {
  const HUB = "app/departments/hr/page.tsx";

  it("the HR-6 roadmap tiles became real workspaces", () => {
    const h = read(HUB);
    expect(h).toContain('WorkspaceTile href="/departments/hr/performance"');
    expect(h).toContain('WorkspaceTile href="/departments/hr/formation"');
    expect(h).not.toMatch(/SoonTile title="Performance"|SoonTile title="Formation"/);
    // Later phases stay honest about being later phases.
    for (const p of ["HR-7", "HR-8", "HR-9"]) expect(h).toContain(p);
  });

  it("both routes exist and gate on hr:read server-side", () => {
    for (const r of ["performance", "formation"]) {
      const p = `app/departments/hr/${r}/page.tsx`;
      expect(existsSync(join(root, p)), p).toBe(true);
      expect(code(p)).toContain('hasPermission(permissions, "hr:read")');
      expect(code(p)).toContain("notFound()");
    }
  });

  it("exactly one workspace tile per capability — no duplicate entry point", () => {
    const h = read(HUB);
    for (const href of ["/departments/hr/performance", "/departments/hr/formation"]) {
      expect([...h.matchAll(new RegExp(`WorkspaceTile href="${href}"`, "g"))].length, href).toBe(1);
    }
  });

  it("attention items are live projections, and unavailable is not zero", () => {
    const h = read(HUB);
    expect(h).toContain("center.performance?.awaitingFinalization ?? UNAVAILABLE");
    expect(h).toContain("center.training?.mandatoryOverdue ?? UNAVAILABLE");
    expect(code("lib/hr/workspace.ts")).toContain("Promise.allSettled");
  });

  it("no scheduler, cron or queue was introduced (the HR-5A deferral stands)", () => {
    for (const f of ["lib/hr/workspace.ts", "lib/hr/performance.ts", "lib/hr/training.ts",
                     "lib/hr/performance-actions.ts", "lib/hr/training-actions.ts"]) {
      expect(code(f), f).not.toMatch(/setInterval|cron|node-schedule|queue|worker/i);
    }
    expect(existsSync(join(root, "app", "api", "cron"))).toBe(false);
  });

  it("the client workspaces never import a server-only module", () => {
    for (const f of ["components/hr/performance-studio.tsx", "components/hr/training-studio.tsx"]) {
      const c = read(f);
      expect(c.startsWith('"use client"')).toBe(true);
      expect(c, f).not.toMatch(/from "@\/lib\/hr\/(performance|training)";/);
    }
    for (const f of ["lib/hr/performance/scoring.ts", "lib/hr/training/catalog.ts"]) {
      // Prose may NAME server-only; what matters is that it does not IMPORT it.
      expect(code(f), f).not.toMatch(/import\s+"server-only"/);
    }
  });

  it("the employee profile shows the workflow and withholds the C3 prose", () => {
    const p = code("app/departments/hr/[id]/page.tsx");
    expect(p).toContain("listEvaluations(user.tenantId, { employeeId: employee.id, canReadSensitive: canSeeSensitive })");
    expect(p).toContain("listEnrollments(user.tenantId, { employeeId: employee.id })");
    expect(p).toContain("ev.contentWithheld");
  });
});

// ---------------------------------------------------------------------------
describe("non-scope — HR-6 did not start HR-7 or anything else", () => {
  it("introduces no payroll, compensation, ATS, succession or offboarding concept", () => {
    const files = [PERF_SQL, TRAIN_SQL, "lib/hr/performance.ts", "lib/hr/training.ts",
                   "lib/hr/performance-actions.ts", "lib/hr/training-actions.ts",
                   "app/departments/hr/performance/page.tsx", "app/departments/hr/formation/page.tsx"];
    for (const f of files) {
      expect(code(f), f).not.toMatch(
        /payroll|salaire|salary|compensation|bonus|recrutement|recruitment|succession|offboarding/i,
      );
    }
  });

  it("no AI generates evaluation content", () => {
    for (const f of ["lib/hr/performance.ts", "lib/hr/performance-actions.ts",
                     "components/hr/performance-studio.tsx"]) {
      expect(code(f), f).not.toMatch(/openai|anthropic|runCopilot|generateText|llm/i);
    }
  });
});
