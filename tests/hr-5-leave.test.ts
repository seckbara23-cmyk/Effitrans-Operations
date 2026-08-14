/** HR-5 — Leave & Attendance: pure engines + structural contracts. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeBalance, formatTenths, spanTenths, DAY } from "@/lib/hr/leave/balance";
import { derivePresence, isOnLeaveOn, PRESENCE_LABEL_FR } from "@/lib/hr/leave/presence";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (p: string) => read(p).replace(/^\s*--.*$/gm, "");
const MIG = "supabase/migrations/20260802000003_hr_leave_attendance.sql";
const ACTIONS = "lib/hr/leave-actions.ts";

// ---------------------------------------------------------------------------
describe("balance engine — integer day-tenths, no floats", () => {
  it("computes remaining as opening + accrued − taken", () => {
    const b = computeBalance({ openingTenths: 100, accruedTenths: 50, takenTenths: 30 });
    expect(b.remainingTenths).toBe(120);
    expect(b.overdrawn).toBe(false);
  });

  it("surfaces an overdraw instead of clamping it away", () => {
    const b = computeBalance({ openingTenths: 0, accruedTenths: 10, takenTenths: 25 });
    expect(b.remainingTenths).toBe(-15);
    expect(b.overdrawn).toBe(true);
  });

  it("refuses non-integer or negative inputs — a half-day is 5, never 0.5", () => {
    expect(() => computeBalance({ openingTenths: 0.5, accruedTenths: 0, takenTenths: 0 })).toThrow();
    expect(() => computeBalance({ openingTenths: -1, accruedTenths: 0, takenTenths: 0 })).toThrow();
  });

  it("formats in French, showing a half only when there is one", () => {
    expect(formatTenths(120)).toBe("12 j");
    expect(formatTenths(125)).toBe("12,5 j");
    expect(formatTenths(-15)).toBe("-1,5 j");
    expect(formatTenths(0)).toBe("0 j");
  });

  it("spans inclusive calendar days", () => {
    expect(spanTenths("2026-03-02", "2026-03-02")).toBe(DAY);
    expect(spanTenths("2026-03-02", "2026-03-04")).toBe(3 * DAY);
    expect(() => spanTenths("2026-03-04", "2026-03-02")).toThrow();
  });

  it("invents no working-day calendar — the span is calendar days by construction", () => {
    // A weekend inside the range is counted: which days are working days depends
    // on a holiday calendar and a work pattern that HR-5 must not invent.
    expect(spanTenths("2026-03-06", "2026-03-09")).toBe(4 * DAY); // Fri→Mon
  });
});

// ---------------------------------------------------------------------------
describe("ON_LEAVE is derived, never stored", () => {
  const win = (status: string, s: string, e: string) => ({ status, startISO: s, endISO: e });

  it("an APPROVED window containing the date makes an ACTIVE employee ON_LEAVE", () => {
    expect(derivePresence("ACTIVE", [win("APPROVED", "2026-03-02", "2026-03-04")], "2026-03-03")).toBe("ON_LEAVE");
  });

  it("boundaries are inclusive", () => {
    const w = [win("APPROVED", "2026-03-02", "2026-03-04")];
    expect(isOnLeaveOn(w, "2026-03-02")).toBe(true);
    expect(isOnLeaveOn(w, "2026-03-04")).toBe(true);
    expect(isOnLeaveOn(w, "2026-03-05")).toBe(false);
  });

  it("a submitted or cancelled request makes nobody absent", () => {
    for (const s of ["SUBMITTED", "DRAFT", "REFUSED", "CANCELLED"]) {
      expect(derivePresence("ACTIVE", [win(s, "2026-03-02", "2026-03-04")], "2026-03-03")).toBe("ACTIVE");
    }
  });

  it("employment state is the stronger fact — a terminated person is not 'on leave'", () => {
    for (const s of ["SUSPENDED", "TERMINATED", "ARCHIVED", "DRAFT"]) {
      expect(derivePresence(s, [win("APPROVED", "2026-03-02", "2026-03-04")], "2026-03-03")).toBe(s);
    }
  });

  it("no ON_LEAVE column, status value or transition exists in the migration", () => {
    const m = sql(MIG);
    expect(m).not.toMatch(/ON_LEAVE/);
    expect(m).not.toMatch(/alter table public\.employee/);
  });

  it("nothing anywhere writes ON_LEAVE into employee.status", () => {
    for (const p of [ACTIONS, "lib/hr/leave.ts", "lib/hr/actions.ts"]) {
      expect(code(p), p).not.toMatch(/status:\s*["']ON_LEAVE["']/);
    }
    expect(PRESENCE_LABEL_FR.ON_LEAVE).toBe("En congé");
  });
});

// ---------------------------------------------------------------------------
describe("approval is a separate authority", () => {
  const m = sql(MIG);
  const a = code(ACTIONS);

  it("hr:leave:approve is catalogued here and granted here to NO role — HR-B1 grants it, elsewhere, to Direction", () => {
    // Migration 77 (HR-5) stays what it was: catalogue only. The activation
    // lives in migration 108, ONLY on the Direction seats.
    expect(m).toContain("'hr:leave:approve'");
    expect(m).not.toContain("role_permission");
    const b1 = sql("supabase/migrations/20260830000001_hr_leave_approval_activation.sql");
    expect(b1).toMatch(/p\.code = 'hr:leave:approve'[\s\S]{0,80}r\.code in \('DGA', 'DAF'\)/);
  });

  it("the decide action never rides hr:manage — HR-B1 moved the authority into the RPC", () => {
    const from = a.indexOf("export async function decideLeaveRequest");
    const to = a.indexOf("export async function", from + 1);
    const decide = a.slice(from, to === -1 ? undefined : to);
    expect(decide).not.toContain('assertPermission("hr:manage")');
    // No flat permission gate either: it would BLOCK the manager lane. The
    // database decides (manager relationship or assert_actor_authority).
    expect(decide).not.toContain('assertPermission("hr:leave:approve")');
    expect(decide).toContain('rpc("hr_decide_leave_request"');
  });

  it("requesting and submitting stay on hr:manage — they are not decisions", () => {
    for (const fn of ["createLeaveRequest", "submitLeaveRequest"]) {
      const seg = a.slice(a.indexOf(`export async function ${fn}`));
      expect(seg.slice(0, 700)).toContain('assertPermission("hr:manage")');
    }
  });

  it("the maker-checker rule is enforced in the schema AND the RPC", () => {
    expect(m).toContain("leave_approver_differs");
    expect(m).toContain("approved_by <> requested_by");
    expect(m).toContain("séparation des tâches");
  });

  it("a ratification request exists rather than a silent grant", () => {
    const doc = read("docs/hr/hr-5-permission-ratification.md");
    expect(doc).toContain("hr:leave:approve");
    expect(doc).toContain("must not be `hr:manage`");
  });
});

// ---------------------------------------------------------------------------
describe("no legal value is invented", () => {
  const m = sql(MIG);

  it("seeded categories carry vocabulary only — is_paid NULL, provisional true", () => {
    expect(m).toContain("null::boolean");
    expect(m).toContain("is_provisional");
    // No quantity anywhere in the seed.
    const seed = m.slice(m.indexOf("insert into public.hr_leave_category"), m.indexOf("3. ENTITLEMENTS"));
    expect(seed).not.toMatch(/\b(2[0-9]|30|18|14|jours|days)\b/);
  });

  it("no accrual formula, holiday calendar or retention period exists", () => {
    expect(m).not.toMatch(/accrual|accrue_per|holiday|jour_ferie|retention/i);
    expect(code("lib/hr/leave/balance.ts")).not.toMatch(/accrual|holiday|statut(ory|aire)/i);
  });

  it("entitlement quantities are entered, never computed", () => {
    const a = code(ACTIONS);
    const seg = a.slice(a.indexOf("export async function upsertEntitlement"));
    expect(seg).toContain("Number.isInteger(input.openingTenths)");
    expect(seg).not.toMatch(/\*\s*\d|Math\.(round|floor|ceil)\(/);
  });

  it("the approval RPC decrements an existing period but never creates one", () => {
    const fn = m.slice(m.indexOf("function public.hr_decide_leave_request"), m.indexOf("function public.hr_cancel_leave_request"));
    expect(fn).toContain("update public.hr_leave_entitlement");
    expect(fn).not.toContain("insert into public.hr_leave_entitlement");
  });
});

// ---------------------------------------------------------------------------
describe("history, transactions and attendance", () => {
  const m = sql(MIG);

  it("a decided request is immutable, with one governed exit to CANCELLED", () => {
    expect(m).toContain("hr_leave_request_immutable_once_decided");
    expect(m).toContain("the one governed exit".replace("the one governed exit", "return new"));
    expect(m).toContain("une demande décidée est immuable");
  });

  it("decision and cancellation are transactional RPCs that emit inside themselves", () => {
    for (const fn of ["hr_decide_leave_request", "hr_cancel_leave_request"]) {
      expect(m).toContain(`create or replace function public.${fn}`);
      expect(m).toContain(`revoke execute on function public.${fn}`);
    }
    const decide = m.slice(m.indexOf("function public.hr_decide_leave_request"), m.indexOf("function public.hr_cancel_leave_request"));
    expect(decide).toContain("insert into public.hr_employee_event");
  });

  it("attendance is an input contract: recorded minutes, bounded, no device integration", () => {
    expect(m).toContain("worked_minutes int not null check (worked_minutes >= 0 and worked_minutes <= 1440)");
    expect(m).toContain("check (source in ('MANUAL','IMPORT','DEVICE'))");
    expect(m).not.toMatch(/biometric|gps|fingerprint|geoloc/i);
  });

  it("attendance is deliberately NOT emitted to the employee timeline", () => {
    const a = code(ACTIONS);
    const seg = a.slice(a.indexOf("export async function recordAttendance"));
    expect(seg).not.toContain("emitHrEvent");
    expect(seg).toContain("writeAudit");
  });

  it("RLS + hr:read policy on all four tables; no portal policy", () => {
    for (const t of ["hr_leave_category", "hr_leave_entitlement", "hr_leave_request", "hr_attendance_day"]) {
      expect(m, t).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
      expect(m, t).toContain(`create policy ${t}_select`);
    }
    expect(m).not.toContain("client_user");
    expect(m).not.toContain("SYSTEM_ADMIN");
  });
});

// ---------------------------------------------------------------------------
describe("CI runs the HR-5 suite last", () => {
  it("appended after HR-4, before Stop", () => {
    const ci = read(".github/workflows/ci.yml");
    const hr4 = ci.indexOf("rls_hr_onboarding_test.sql");
    const hr5 = ci.indexOf("rls_hr_leave_test.sql");
    expect(hr5).toBeGreaterThan(hr4);
    expect(ci.indexOf("Stop local Supabase")).toBeGreaterThan(hr5);
  });
});
