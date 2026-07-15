/**
 * Phase 6.0H — workspace switcher (platform ↔ tenant). UX only.
 *
 * The menu shape is a pure function (buildWorkspaceMenu) tested across every required
 * scenario. The server verification (own-row reads, reused identity stack, no new
 * permission, no isolation change) is asserted structurally against source.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  buildWorkspaceMenu,
  monogram,
  platformRoleLabel,
  type TenantMembershipInput,
} from "@/lib/workspace/model";
import { PLATFORM_PERMISSIONS } from "@/lib/platform/roles";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const switcher = read("../lib/workspace/switcher.ts");
const actions = read("../lib/workspace/actions.ts");
const route = read("../app/api/workspaces/route.ts");
const component = read("../components/workspace/workspace-switcher.tsx");

const NOW = Date.parse("2026-07-15T00:00:00Z");
const day = 86_400_000;

function membership(over: Partial<TenantMembershipInput> = {}): TenantMembershipInput {
  return {
    tenantId: "t1", status: "active", name: "Effitrans Operations",
    lifecycleStatus: "ACTIVE", trialEndsAt: null, roleCodes: ["SYSTEM_ADMIN"], ...over,
  };
}

// ---------------------------------------------------------------- visibility ----

describe("menu visibility per identity", () => {
  it("tenant user (one tenant, no platform) → NO switch", () => {
    const m = buildWorkspaceMenu({ email: "a@x", memberships: [membership()], platform: null, now: NOW });
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].kind).toBe("tenant");
    expect(m.hasSwitch).toBe(false);
  });

  it("platform-only user (no membership) → only Platform Administration", () => {
    const m = buildWorkspaceMenu({ email: "a@x", memberships: [], platform: { role: "PLATFORM_SUPER_ADMIN" }, now: NOW });
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0].kind).toBe("platform");
    expect(m.entries[0].href).toBe("/platform");
    expect(m.hasSwitch).toBe(false);
  });

  it("platform admin WITH a tenant → both, switchable", () => {
    const m = buildWorkspaceMenu({ email: "a@x", memberships: [membership()], platform: { role: "PLATFORM_SUPER_ADMIN" }, now: NOW });
    expect(m.entries.map((e) => e.kind)).toEqual(["tenant", "platform"]);
    expect(m.hasSwitch).toBe(true);
  });

  it("multiple tenant memberships are all shown (general case, if the schema ever allows it)", () => {
    const m = buildWorkspaceMenu({
      email: "a@x",
      memberships: [membership({ tenantId: "t1", name: "Effitrans Operations" }), membership({ tenantId: "t2", name: "Teranga Logistics", roleCodes: ["DRIVER"] })],
      platform: { role: "PLATFORM_SUPER_ADMIN" },
      now: NOW,
    });
    expect(m.entries).toHaveLength(3);
    expect(m.hasSwitch).toBe(true);
  });
});

// ---------------------------------------------------------------- disabled states ----

describe("suspended / archived / expired / inactive memberships", () => {
  it("a suspended tenant is shown DISABLED with a reason", () => {
    const m = buildWorkspaceMenu({ email: "a@x", memberships: [membership({ lifecycleStatus: "SUSPENDED" })], platform: { role: "PLATFORM_SUPPORT" }, now: NOW });
    const t = m.entries.find((e) => e.kind === "tenant")!;
    expect(t.disabled).toBe(true);
    expect(t.disabledReason).toBe("Suspendu");
  });

  it("an archived tenant is disabled with 'Archivé'", () => {
    const m = buildWorkspaceMenu({ email: "a@x", memberships: [membership({ lifecycleStatus: "ARCHIVED" })], platform: null, now: NOW });
    expect(m.entries[0].disabled).toBe(true);
    expect(m.entries[0].disabledReason).toBe("Archivé");
  });

  it("an expired trial is disabled with 'Essai expiré'", () => {
    const m = buildWorkspaceMenu({
      email: "a@x",
      memberships: [membership({ lifecycleStatus: "TRIAL", trialEndsAt: new Date(NOW - day).toISOString() })],
      platform: null, now: NOW,
    });
    expect(m.entries[0].disabled).toBe(true);
    expect(m.entries[0].disabledReason).toBe("Essai expiré");
  });

  it("an operable trial is enabled", () => {
    const m = buildWorkspaceMenu({
      email: "a@x",
      memberships: [membership({ lifecycleStatus: "TRIAL", trialEndsAt: new Date(NOW + day).toISOString() })],
      platform: null, now: NOW,
    });
    expect(m.entries[0].disabled).toBe(false);
  });

  it("an INACTIVE membership is HIDDEN (not a workspace the user has)", () => {
    const m = buildWorkspaceMenu({ email: "a@x", memberships: [membership({ status: "inactive" })], platform: { role: "PLATFORM_SUPER_ADMIN" }, now: NOW });
    expect(m.entries.every((e) => e.kind === "platform")).toBe(true);
  });
});

// ---------------------------------------------------------------- role summary ----

describe("role summary is a French label, never a code", () => {
  it("driver-only → Chauffeur; system admin → Administrateur système", () => {
    const driver = buildWorkspaceMenu({ email: "a@x", memberships: [membership({ roleCodes: ["DRIVER"] })], platform: null, now: NOW });
    expect(driver.entries[0].roleSummary).toBe("Chauffeur");
    const admin = buildWorkspaceMenu({ email: "a@x", memberships: [membership({ roleCodes: ["SYSTEM_ADMIN"] })], platform: null, now: NOW });
    expect(admin.entries[0].roleSummary).toBe("Administrateur système");
  });

  it("platform role label + monogram", () => {
    expect(platformRoleLabel("PLATFORM_SUPER_ADMIN")).toBe("Super administrateur");
    expect(monogram("Effitrans Operations")).toBe("EO");
    expect(monogram("Teranga")).toBe("T");
  });
});

// ---------------------------------------------------------------- server safety ----

describe("selection is server-verified and reuses the identity stack (no impersonation)", () => {
  it("the action verifies membership by matching the resolved tenant — client cannot pick another", () => {
    expect(actions).toContain("getCurrentUser()");
    expect(actions).toContain("user.tenantId !== tenantId");
    expect(actions).toContain('error: "not_member"');
  });

  it("the destination reuses the existing landing resolver — identity routing is not duplicated", () => {
    expect(actions).toContain("getLandingRoute()");
    // No re-implementation of driver/courier routing here.
    expect(code("../lib/workspace/actions.ts")).not.toContain("postLoginPath");
    expect(code("../lib/workspace/actions.ts")).not.toContain('"/driver"');
  });

  it("the menu resolver reads OWN rows only (RLS server client), reuses getPlatformUser", () => {
    expect(switcher).toContain('.eq("id", user.id)');
    expect(switcher).toContain("getPlatformUser()");
    // Uses the RLS-respecting server client, NOT the service-role admin client.
    expect(code("../lib/workspace/switcher.ts")).not.toContain("getAdminSupabaseClient");
    expect(switcher).toContain("getServerSupabaseClient");
  });

  it("the API route 401s when signed out", () => {
    expect(route).toContain('new NextResponse("Unauthorized", { status: 401 })');
  });

  it("introduces NO new permission (RBAC unchanged)", () => {
    expect(PLATFORM_PERMISSIONS).not.toContain("platform:workspace:switch" as never);
    for (const src of [switcher, actions, read("../lib/workspace/model.ts")]) {
      expect(src).not.toMatch(/PLATFORM_PERMISSIONS\s*=|assertPermission\(|new .*Permission/);
    }
  });
});

describe("the client switcher holds no authority", () => {
  it("no admin client / service role / provider; renders nothing without a switch", () => {
    for (const forbidden of ["getAdminSupabaseClient", "service_role"]) {
      expect(code("../components/workspace/workspace-switcher.tsx"), forbidden).not.toContain(forbidden);
    }
    expect(component).toContain("if (!menu || !menu.hasSwitch) return null;");
    expect(component).toContain('fetch("/api/workspaces")');
    expect(component).toContain("selectTenantWorkspace(entry.id)");
  });
});
