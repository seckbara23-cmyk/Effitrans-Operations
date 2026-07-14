/**
 * Phase 5.0E-4 — "Processus officiel" inside Administration → Paramètres.
 *
 * The page was never unreachable; it was MISNAMED. "Console pilote" reads like a
 * developer tool, so it was treated like one — it sat behind a card nobody opened while
 * the tenant quietly had no rollout row for two phases. Naming is not cosmetic here: it
 * is the difference between a diagnostic being found and not being found.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { buildNavigation } from "@/lib/navigation/build";
import type { NavigationContext } from "@/lib/navigation/types";
import { resolveProcessFlags } from "@/lib/process/flags";
import { getTenantRoleTemplate, TENANT_ROLE_KEYS } from "@/lib/platform/role-templates";
import { PLATFORM_ROLE_PERMISSIONS } from "@/lib/platform/roles";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

/** The CODE, without the prose about it — a doc comment that explains the old name is not the old name. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const hub = code("../app/settings/page.tsx");
const page = code("../app/settings/pilot/page.tsx");

const FLAGS_ON = resolveProcessFlags({
  EFFITRANS_PROCESS_ENGINE_ENABLED: "true",
  EFFITRANS_PROCESS_WORKSPACES_ENABLED: "true",
});

const ctx = (over: Partial<NavigationContext> = {}): NavigationContext => ({
  userId: "u1",
  tenantId: "t1",
  roleCodes: [],
  permissions: [],
  identityType: "tenant",
  featureFlags: FLAGS_ON,
  ...over,
});

describe("Processus officiel lives under Paramètres", () => {
  it("is named for what it is, not for the phase that built it", () => {
    expect(hub).toContain('title: "Processus officiel"');
    expect(hub).not.toContain('title: "Console pilote"');
    expect(page).toContain("Processus officiel Effitrans");
    expect(page).not.toContain("Console pilote");
  });

  it("carries the agreed subtitle", () => {
    expect(page).toContain(
      "État du moteur de processus, activation des espaces de travail, diagnostic du",
    );
    expect(page).toContain("déploiement et validation du parcours officiel.");
  });

  it("points at /settings/pilot", () => {
    expect(hub).toContain('href: "/settings/pilot"');
  });

  it("adds NO new top-level sidebar entry", () => {
    // It is a settings page, reached through Paramètres. ADMINISTRATION stays at three.
    const admin = buildNavigation(
      ctx({
        roleCodes: ["SYSTEM_ADMIN"],
        permissions: ["admin:users:manage", "audit:read:all", "admin:config:manage", "process:read"],
      }),
    ).sections.find((s) => s.key === "administration")!;

    expect(admin.items.map((i) => i.label)).toEqual([
      "Utilisateurs",
      "Journal d'audit",
      "Paramètres",
    ]);
    expect(admin.items.map((i) => i.href)).not.toContain("/settings/pilot");
  });
});

describe("RBAC: SYSTEM_ADMIN only — and that is what the permission already means", () => {
  it("admin:config:manage is held by SYSTEM_ADMIN and by NO other tenant role", () => {
    // This is the whole argument for gating on the permission rather than hardcoding the
    // role name: the two are already equivalent, and a second copy of the rule is a
    // second thing to keep in sync. If a future role ever gains admin:config:manage, this
    // test fails and forces the decision to be made deliberately rather than discovered.
    const holders = TENANT_ROLE_KEYS.filter((k) =>
      getTenantRoleTemplate(k)?.permissions.includes("admin:config:manage"),
    );
    expect(holders).toEqual(["SYSTEM_ADMIN"]);
  });

  it("gates the hub card and re-checks on the route", () => {
    expect(hub).toContain('permission: "admin:config:manage"');
    // A hidden link has never been the authorization.
    expect(page).toContain('hasPermission(permissions, "admin:config:manage")');
    expect(page).toContain("notFound()");
  });

  it("shows nothing to a non-admin — no card, no Paramètres, no page", () => {
    for (const role of ["CUSTOMS_DECLARANT", "BILLING_OFFICER", "ACCOUNT_MANAGER", "COORDINATOR"]) {
      const perms = getTenantRoleTemplate(role)?.permissions ?? [];
      expect(perms, role).not.toContain("admin:config:manage");

      const nav = buildNavigation(ctx({ roleCodes: [role], permissions: [...perms] }));
      const hrefs = nav.sections.flatMap((s) => s.items.map((i) => i.href));
      expect(hrefs, role).not.toContain("/settings");
      expect(hrefs, role).not.toContain("/settings/pilot");
    }
  });

  it("a PLATFORM_SUPER_ADMIN reaches the toggles at /platform/rollout, NOT here", () => {
    // They have no app_user, so requireUser() bounces them to /login — the Phase 4.0B
    // identity boundary. Faking a tenant session for them would be worth far less than
    // the boundary. Their console already exists and holds the actual switches.
    expect(PLATFORM_ROLE_PERMISSIONS.PLATFORM_SUPER_ADMIN).toContain("platform:rollout:manage");
    expect(page).toContain("requireUser");
    expect(read("../lib/platform/nav.ts")).toContain("/platform/rollout");
    // ...and the tenant sidebar never offers a platform route.
    const hrefs = buildNavigation(
      ctx({ roleCodes: ["SYSTEM_ADMIN"], permissions: ["admin:config:manage"] }),
    ).sections.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs.some((h) => h.startsWith("/platform"))).toBe(false);
  });
});

describe("nothing about the rollout itself changed", () => {
  it("did not touch the resolver, the flags, or the engine", () => {
    // 5.0E-4 is naming and placement. If it altered behaviour, it would be the second
    // time a "UX-only" change moved a gate.
    const proof = read("../lib/pilot/rollout-proof.ts");
    expect(proof).toContain("globalKillSwitch()");
    expect(proof).toContain("getTenantProcessFlags(tenantId)");
    expect(page).toContain("getTenantProcessFlags(user.tenantId)");
    // The diagnostics all still render.
    for (const marker of ["Global Engine", "Effective Workspaces", "Organization Slug"]) {
      expect(page, marker).toContain(marker);
    }
  });

  it("still shows the page when the process is OFF — that is when it is needed", () => {
    expect(hub).not.toContain("requiresProcess");
  });

  it("no route file was added or removed", () => {
    const settings = readdirSync(fileURLToPath(new URL("../app/settings", import.meta.url)));
    expect(settings.sort()).toEqual(["ai", "audit", "page.tsx", "pilot"]);
  });
});
