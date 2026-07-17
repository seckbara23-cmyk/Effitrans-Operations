/**
 * Phase 8.1A — user lifecycle: ARCHIVE (no operational delete). The pure lifecycle module is
 * exercised directly (transitions, display attribution); the server actions / directory reader /
 * auth gates / assignment exclusions / UI are verified structurally: the point of this phase is
 * REUSE (one lifecycle module, the existing auth gate, the existing ban lever, the existing
 * picker filters) with archive layered on top — these tests pin exactly that.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  STAFF_STATUSES, isStaffStatus, toStaffStatus, canTransition, staffDisplayName, STAFF_STATUS_LABEL,
} from "@/lib/users/lifecycle";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------- pure lifecycle ----
describe("lifecycle transitions — one source of truth", () => {
  it("suspend/reactivate stay legal; archive is reachable from active AND inactive", () => {
    expect(canTransition("active", "inactive")).toBe(true);
    expect(canTransition("inactive", "active")).toBe(true);
    expect(canTransition("active", "archived")).toBe(true);
    expect(canTransition("inactive", "archived")).toBe(true);
  });
  it("restore is the ONLY exit from archived, and it re-enters as ACTIVE", () => {
    expect(canTransition("archived", "active")).toBe(true);
    expect(canTransition("archived", "inactive")).toBe(false);
    expect(canTransition("archived", "archived")).toBe(false);
  });
  it("no self-transition is legal", () => {
    for (const s of STAFF_STATUSES) expect(canTransition(s, s)).toBe(false);
  });
  it("unknown raw values normalize DEFENSIVELY to inactive — never to active", () => {
    expect(toStaffStatus("banana")).toBe("inactive");
    expect(toStaffStatus("archived")).toBe("archived");
    expect(isStaffStatus("archived")).toBe(true);
  });
});

describe("historical attribution — never 'Unknown user', never dropped", () => {
  it("an archived user renders name + (Archivé)", () => {
    expect(staffDisplayName("Aminata Mbaye", "archived")).toBe("Aminata Mbaye (Archivé)");
  });
  it("active and suspended users render unchanged", () => {
    expect(staffDisplayName("Aminata Mbaye", "active")).toBe("Aminata Mbaye");
    expect(staffDisplayName("Aminata Mbaye", "inactive")).toBe("Aminata Mbaye");
  });
  it("a missing name still renders a placeholder with the archive marker", () => {
    expect(staffDisplayName(null, "archived")).toBe("— (Archivé)");
    expect(staffDisplayName("  ", null)).toBe("—");
  });
  it("labels come from the single label map", () => {
    expect(STAFF_STATUS_LABEL.archived).toBe("Archivé");
    expect(STAFF_STATUS_LABEL.inactive).toBe("Suspendu");
  });
});

// ---------------------------------------------------------------- migration ----
describe("migration — additive status extension, nothing destructive", () => {
  const sql = read("../supabase/migrations/20260720000001_user_archive.sql");
  it("extends the check constraint to the three-state vocabulary", () => {
    expect(sql).toContain("'active', 'inactive', 'archived'");
    expect(sql).toMatch(/drop constraint if exists app_user_status_check/);
  });
  it("adds no delete path and touches no rows", () => {
    expect(sql).not.toMatch(/delete from|drop table|truncate|on delete/i);
    expect(sql).not.toMatch(/insert into/i);
  });
});

// ---------------------------------------------------------------- actions ----
describe("archive/restore actions — SYSTEM_ADMIN gate, ban reuse, audit, no delete", () => {
  const src = code("../lib/users/actions.ts");

  it("archiveUser and restoreUser gate on admin:users:manage (held ONLY by SYSTEM_ADMIN)", () => {
    const archive = src.slice(src.indexOf("export async function archiveUser"));
    const restore = src.slice(src.indexOf("export async function restoreUser"));
    expect(archive).toContain('assertPermission("admin:users:manage")');
    expect(restore).toContain('assertPermission("admin:users:manage")');
  });
  it("archive refuses self (no self-lockout) and uses the lifecycle module for legality", () => {
    expect(src).toMatch(/archiveUser[\s\S]{0,400}userId === admin\.id/);
    expect((src.match(/canTransition\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
  it("REUSES the session-revocation ban lever — no duplicate updateUserById ban logic here", () => {
    expect(src).toContain('setUserAuthBan');
    expect(src).toContain('from "@/lib/platform/session-revocation"');
    expect(src).not.toMatch(/ban_duration/); // the lever lives in ONE module
  });
  it("audits USER_ARCHIVED / USER_RESTORED with before/after status", () => {
    expect(src).toContain("AuditActions.USER_ARCHIVED");
    expect(src).toContain("AuditActions.USER_RESTORED");
    const ev = read("../lib/audit/events.ts");
    expect(ev).toContain('USER_ARCHIVED: "user.archived"');
    expect(ev).toContain('USER_RESTORED: "user.restored"');
  });
  it("suspend (setUserStatus) can no longer touch an archived user", () => {
    const s = src.slice(src.indexOf("export async function setUserStatus"), src.indexOf("export async function archiveUser"));
    expect(s).toContain("canTransition");
    expect(s).toContain('"user_archived"');
  });
  it("an archived user receives NO invitation / setup link", () => {
    const w = src.slice(src.indexOf("export async function sendWelcomeEmail"), src.indexOf("export async function setUserStatus"));
    expect(w).toMatch(/archived/);
    expect(w).toContain('"user_archived"');
  });
  it("NO delete of operational users exists anywhere in the user actions", () => {
    // The ONLY auth deletion allowed is the createUser COMPENSATION path (undoing an auth
    // user this very call created). No app_user row is ever deleted.
    expect(src).not.toMatch(/from\("app_user"\)\s*\.delete/);
    const deletions = src.match(/auth\.admin\.deleteUser/g) ?? [];
    expect(deletions.length).toBe(1); // the pre-existing compensation only
    // ...and that one call is the documented createUser compensation (raw source keeps comments).
    expect(read("../lib/users/actions.ts")).toMatch(/COMPENSATE[\s\S]{0,400}auth\.admin\.deleteUser/);
  });
});

// ---------------------------------------------------------------- directory ----
describe("directory — archived hidden by default, excluded at QUERY level", () => {
  const svc = code("../lib/users/service.ts");
  it("listUsers excludes archived in the SQL query unless explicitly included", () => {
    expect(svc).toMatch(/if \(!opts\.includeArchived\) query = query\.neq\("status", "archived"\)/);
  });
  it("the page passes the filter from searchParams — no React-side filtering of archived", () => {
    const page = code("../app/users/page.tsx");
    expect(page).toContain('searchParams?.archived === "1"');
    expect(page).toContain("includeArchived: showArchived");
    const ui = code("../components/users/users-admin.tsx");
    expect(ui).not.toMatch(/users\.filter\([^)]*archived/);
  });
  it("presence summary keeps counting ACTIVE users only (archived never counted)", () => {
    expect(svc).toMatch(/filter\(\(u\) => u\.status === "active"\)/);
  });
});

// ---------------------------------------------------------------- authentication ----
describe("authentication — archived cannot authenticate, refresh, or reset", () => {
  it("the single app-layer gate denies ANY non-active status (covers archived)", () => {
    const cu = code("../lib/auth/current-user.ts");
    expect(cu).toMatch(/if \(profile\.status !== "active"\) return null/);
  });
  it("password reset already requires an ACTIVE staff user (covers archived)", () => {
    const pr = code("../lib/auth/password-reset.ts");
    expect(pr).toMatch(/isActiveStaff/);
  });
  it("the auth-layer ban lever exists in ONE module and tenant revocation reuses it", () => {
    const sr = code("../lib/platform/session-revocation.ts");
    expect(sr).toContain("export async function setUserAuthBan");
    expect((sr.match(/ban_duration/g) ?? []).length).toBe(1); // single lever
    expect(sr).toMatch(/setUserAuthBan\(admin, id, banned\)/); // tenant path delegates
  });
});

// ---------------------------------------------------------------- assignment exclusion ----
describe("assignments — archived excluded by the EXISTING filters (no duplicates added)", () => {
  it("every assignment picker filters status='active' at query level", () => {
    for (const [file, fn] of [
      ["../lib/files/service.ts", "listAssignableStaff"],
      ["../lib/tasks/service.ts", "listAssignees"],
    ] as const) {
      const src = code(file);
      const body = src.slice(src.indexOf(fn));
      expect(body, `${file} ${fn}`).toMatch(/eq\("status", "active"\)/);
    }
    // Brand Center member list — same query-level filter.
    expect(code("../lib/brand/server/service.ts")).toMatch(/eq\("status", "active"\)/);
  });
  it("assignment WRITES also validate the target is active (server-side, not just UI)", () => {
    expect(code("../lib/files/actions.ts")).toMatch(/active: cand\?\.status === "active"/);
    expect(code("../lib/collections/actions.ts")).toMatch(/candidate\.status !== "active"/);
    expect(code("../lib/deposit/actions.ts")).toMatch(/candidate\.status !== "active"/);
  });
});

// ---------------------------------------------------------------- historical rendering ----
describe("historical views — archived users stay attributed with the (Archivé) marker", () => {
  it("the audit reader resolves actor status and formats through the single helper", () => {
    const ar = code("../lib/audit/read.ts");
    expect(ar).toContain("actor:actor_id(email, status)");
    expect(ar).toContain("staffDisplayName");
  });
  it("the dossier assignee lookup carries status and formats through the same helper", () => {
    const fs2 = code("../lib/files/service.ts");
    expect(fs2).toMatch(/select\("name, email, status"\)/);
    expect(fs2).toContain("staffDisplayName(a.name, a.status)");
  });
});

// ---------------------------------------------------------------- UI ----
describe("Users page UI — suspend/archive/restore, confirmation, filter, NO delete", () => {
  const ui = read("../components/users/users-admin.tsx");
  it("offers Suspendre + Archiver for live users and Restaurer for archived", () => {
    expect(ui).toContain("t.users.actions.archive");
    expect(ui).toContain("t.users.actions.restore");
    expect(ui).toContain("restoreUser(user.id)");
    expect(ui).toContain("archiveUser(user.id)");
  });
  it("archive requires an explicit confirmation with the departure consequences", () => {
    expect(ui).toContain("confirmArchive");
    expect(ui).toContain("t.users.archive.confirmTitle");
    expect(ui).toContain("t.users.archive.cancel");
    const i18n = read("../lib/i18n.ts");
    expect(i18n).toContain("Archiver cet utilisateur ?");
    expect(i18n).toContain("perdra son accès");
    expect(i18n).toContain("restera dans le journal d'audit");
  });
  it("the archived filter re-queries the server (?archived=1) — never a client filter", () => {
    expect(ui).toContain('"/users?archived=1"');
    expect(ui).toContain("t.users.archive.showArchived");
  });
  it("an archived row is read-only except Restore (no role edits, no welcome resend)", () => {
    expect(ui).toMatch(/canEditRoles = canManageRoles && user\.status !== "archived"/);
  });
  it("offers NO delete action for users anywhere", () => {
    expect(ui).not.toMatch(/deleteUser|Supprimer l'utilisateur|supprimer définitivement/i);
  });
});
