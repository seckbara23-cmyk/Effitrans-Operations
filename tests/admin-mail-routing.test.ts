/**
 * ADMIN-MAIL-ROUTING — the Administration Mail route map.
 *
 * This phase fixed a production 404 and a double-highlighted sidebar. Both were
 * introduced by EMP-IA-1, and both were the same mistake in different clothes:
 * an entry advertised to more people than its destination would admit, sitting
 * at a path that made it a child of an unrelated module.
 *
 * The two defects, stated so the tests below have a subject:
 *
 *   404 — the sidebar entry was visible to holders of ANY of three permissions,
 *         but pointed at a page accepting only two of them. A holder of
 *         `communication:manage` alone saw the entry and got notFound().
 *
 *   BOTH HIGHLIGHTED — the entry lived at /users/enterprise-mail, and the
 *         sidebar highlighted any entry whose href was a prefix of the current
 *         path, so /users (« Utilisateurs ») matched too.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { buildNavigation } from "@/lib/navigation/build";
import { resolveProcessFlags } from "@/lib/process/flags";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import type { NavigationContext } from "@/lib/navigation/types";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ROUTER = "app/admin/enterprise-mail/page.tsx";
const LAYOUT = "app/admin/enterprise-mail/layout.tsx";
const SIDEBAR = "components/shell/sidebar.tsx";
const NAV = "lib/nav.ts";

const CANONICAL = [
  "app/admin/enterprise-mail/page.tsx",
  "app/admin/enterprise-mail/layout.tsx",
  "app/admin/enterprise-mail/access/page.tsx",
  "app/admin/enterprise-mail/mailboxes/page.tsx",
  "app/admin/enterprise-mail/capture/page.tsx",
  "app/admin/enterprise-mail/journal/page.tsx",
];

const LEGACY = {
  "app/users/enterprise-mail/page.tsx": "/admin/enterprise-mail/mailboxes",
  "app/users/enterprise-mail/bulk/page.tsx": "/admin/enterprise-mail/access",
  "app/users/enterprise-mail/capture/page.tsx": "/admin/enterprise-mail/capture",
  "app/users/enterprise-mail/journal/page.tsx": "/admin/enterprise-mail/journal",
};

// ---------------------------------------------------------------------------
// 1. Direct URL access — every canonical route exists
// ---------------------------------------------------------------------------
describe("the canonical administration module exists", () => {
  it("has a page for every ratified surface", () => {
    for (const p of CANONICAL) expect(existsSync(join(root, p)), p).toBe(true);
  });

  it("is not a child of the user-management module", () => {
    // Being under /users is what made the sidebar highlight two entries.
    for (const p of CANONICAL) expect(p.startsWith("app/admin/"), p).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. The 404 — a landing route must admit everyone it is shown to
// ---------------------------------------------------------------------------
describe("the landing route cannot 404 the people the sidebar shows it to", () => {
  it("is a router, not a page", () => {
    const s = code(ROUTER);
    expect(s).toContain("redirect(");
    // It renders nothing of its own, so it cannot inherit a page's gate.
    expect(s).not.toContain("PageHeader");
  });

  it("resolves every permission the sidebar entry advertises", () => {
    // THE REGRESSION TEST. Each permission that makes the entry visible must
    // have a destination in the router, or that holder lands on notFound().
    const entry = code(NAV).slice(code(NAV).indexOf('key: "enterprise-mail-admin"'));
    const advertised = [...entry.slice(0, entry.indexOf("},")).matchAll(/"(communication:[a-z:]+)"/g)]
      .map((m) => m[1]);
    expect(advertised.length).toBeGreaterThan(0);

    const router = code(ROUTER);
    for (const perm of advertised) {
      expect(router, `${perm} is advertised but has no destination`)
        .toContain(`hasPermission(permissions, "${perm}")`);
    }
  });

  it("still 404s a caller holding no mail-administration authority", () => {
    // The router must not invent access for someone the sidebar never offered
    // it to. That 404 is the correct answer, not a bug.
    expect(code(ROUTER)).toContain("notFound()");
  });

  it("grants nothing in order to land", () => {
    expect(code(ROUTER)).not.toMatch(/grant|role_permission|insert/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Active-state matching — the double highlight
// ---------------------------------------------------------------------------
describe("only one sidebar entry is ever active", () => {
  it("uses longest-match, not prefix-match", () => {
    const s = code(SIDEBAR);
    expect(s).toContain("b.length > a.length");
    // The old rule, which lit every ancestor of the current path.
    expect(s).not.toContain('item.href !== "/dashboard"');
  });

  it("competes only among entries the user can actually see", () => {
    // Using the unfiltered list could let a hidden entry win the match and
    // leave nothing highlighted.
    expect(code(SIDEBAR)).toContain("visible.flatMap");
  });

  it("matches on the path only, never the query string", () => {
    const s = code(SIDEBAR);
    expect(s).toContain("pathname === href");
    expect(s).not.toContain("searchParams");
    expect(s).not.toContain("window.location");
  });

  it("the mail administration entry is nested under no other entry", () => {
    // Nesting per se is legitimate and still occurs — /dashboard/executive sits
    // under /dashboard, which is exactly why longest-match is the rule rather
    // than a ban. What must not recur is THIS module being a child of an
    // unrelated one, which is what put « Utilisateurs » and it in the same
    // highlight.
    const hrefs = [...code(NAV).matchAll(/href:\s*"(\/[^"]*)"/g)].map((m) => m[1]);
    const mail = "/admin/enterprise-mail";
    expect(hrefs).toContain(mail);
    for (const h of hrefs) {
      if (h !== mail) {
        expect(mail.startsWith(`${h}/`), `${mail} is nested under ${h}`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Sidebar navigation and authorization
// ---------------------------------------------------------------------------
describe("sidebar visibility follows real authority", () => {
  // Permissions come from the role templates themselves, not a regex over the
  // source: the point is to prove what a REAL role sees.
  const permsFor = (roleCodes: string[]) => [
    ...new Set(
      roleCodes.flatMap(
        (rc) => TENANT_ROLE_TEMPLATES.find((t) => t.key === rc)?.permissions ?? [],
      ),
    ),
  ];

  const hrefsFor = (roleCodes: string[]) => {
    const ctx: NavigationContext = {
      userId: "u1",
      tenantId: "t1",
      roleCodes,
      permissions: permsFor(roleCodes),
      // Without this the builder returns an empty shell — a tenant identity is
      // what the staff sidebar is built for at all.
      identityType: "tenant",
      featureFlags: resolveProcessFlags({}),
    };
    return buildNavigation(ctx).sections.flatMap((s) => s.items.map((i) => i.href));
  };

  it("MAIL_ADMIN sees Administration Mail", () => {
    expect(hrefsFor(["MAIL_ADMIN"])).toContain("/admin/enterprise-mail");
  });

  it("SYSTEM_ADMIN does NOT — the EMP-4A ratification still holds", () => {
    // EMP-IA-1 had added communication:manage to the entry, which SYSTEM_ADMIN
    // holds, silently overturning a ratified boundary AND causing the 404.
    expect(hrefsFor(["SYSTEM_ADMIN"])).not.toContain("/admin/enterprise-mail");
  });

  it("the reported production account sees no entry it cannot open", () => {
    // The exact combination from the incident: HR_OFFICER + SYSTEM_ADMIN, whose
    // topbar shows « Chargé RH » because that is the primary operational label.
    // SYSTEM_ADMIN holds communication:manage, which is what EMP-IA-1 had
    // advertised the entry on — so the entry appeared and /users/enterprise-mail
    // answered notFound(). Neither role holds a mailbox-administration
    // permission, so the correct outcome is no entry at all.
    const h = hrefsFor(["HR_OFFICER", "SYSTEM_ADMIN"]);
    expect(h).not.toContain("/admin/enterprise-mail");
    // …and the general-purpose user administration module is still offered.
    expect(h).toContain("/users");
  });

  it("an ordinary mail user sees no administrative mail entry", () => {
    for (const role of ["ACCOUNT_MANAGER", "FINANCE_OFFICER", "BILLING_OFFICER"]) {
      expect(hrefsFor([role]), role).not.toContain("/admin/enterprise-mail");
    }
  });

  it("the entry never points at a route with no page", () => {
    const hrefs = [...code(NAV).matchAll(/href:\s*"(\/[^"]*)"/g)].map((m) => m[1]);
    for (const h of hrefs) {
      const p = join(root, "app", ...h.replace(/^\//, "").split("/"), "page.tsx");
      expect(existsSync(p), `${h} has no page.tsx`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Legacy routes
// ---------------------------------------------------------------------------
describe("legacy /users/enterprise-mail links keep working", () => {
  it("every old route redirects to its canonical replacement", () => {
    for (const [file, target] of Object.entries(LEGACY)) {
      expect(existsSync(join(root, file)), file).toBe(true);
      const s = code(file);
      expect(s, file).toContain("permanentRedirect");
      expect(s, file).toContain(`"${target}"`);
    }
  });

  it("cannot loop — no target redirects back under /users", () => {
    for (const target of Object.values(LEGACY)) {
      expect(target.startsWith("/admin/enterprise-mail")).toBe(true);
      const p = join(root, "app", ...target.replace(/^\//, "").split("/"), "page.tsx");
      expect(existsSync(p), `${target} must be a real page, not another redirect`).toBe(true);
      expect(code(`app${target}/page.tsx`)).not.toContain("permanentRedirect");
    }
  });

  it("the legacy stubs carry no gate of their own", () => {
    // A redirect that 404s first is not a redirect. Authorization belongs to
    // the destination, which enforces it.
    for (const file of Object.keys(LEGACY)) {
      expect(code(file), file).not.toContain("notFound()");
      expect(code(file), file).not.toContain("hasPermission");
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Nothing about the security model moved
// ---------------------------------------------------------------------------
describe("no permission or boundary changed", () => {
  it("adds no migration", () => {
    expect(existsSync(join(root, "supabase/migrations/20260815000001_admin_mail_routing.sql")))
      .toBe(false);
  });

  it("every administrative page still enforces its own gate", () => {
    for (const p of ["app/admin/enterprise-mail/mailboxes/page.tsx",
                     "app/admin/enterprise-mail/access/page.tsx",
                     "app/admin/enterprise-mail/capture/page.tsx",
                     "app/admin/enterprise-mail/journal/page.tsx"]) {
      const s = code(p);
      expect(s, p).toContain("getEffectivePermissions");
      expect(s, p).toContain("notFound()");
    }
  });

  it("introduces no new correspondence permission", () => {
    for (const p of [...CANONICAL, SIDEBAR, NAV]) {
      expect(code(p), p).not.toMatch(/communication:[a-z:]*(create|write|delete)/);
    }
  });

  it("names SYSTEM_ADMIN nowhere in the routing surfaces", () => {
    for (const p of [...CANONICAL, SIDEBAR, NAV]) {
      expect(code(p), p).not.toContain("SYSTEM_ADMIN");
    }
  });

  it("the employee workspace is untouched by this phase", () => {
    // /mail keeps its frozen five; administration moving does not change it.
    const hrefs = [...code("app/mail/layout.tsx").matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      "/mail/inbox", "/mail/compose", "/mail/drafts", "/mail/sent", "/mail/mailboxes",
    ]);
  });
});
