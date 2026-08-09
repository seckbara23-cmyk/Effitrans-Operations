/**
 * EMP-IA-1 — Enterprise Mail information architecture.
 *
 * The product rule this file defends:
 *
 *   Employees use Enterprise Mail to DO email.
 *   Administrators use Administration → Enterprise Mail to OPERATE and GOVERN it.
 *
 * The failure mode worth testing for is not a wrong label — it is the two
 * workspaces quietly merging again, which is what happened when the outbound
 * dispatch journal became the front door of a mail client. So these tests pin
 * the boundary in both directions: the employee bar stays five items, and the
 * administrative surfaces stay behind administrative authority.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const MAIL_LAYOUT = "app/mail/layout.tsx";
const MAIL_ROOT = "app/mail/page.tsx";
const MAIL_SENT = "app/mail/sent/page.tsx";
const MAIL_BOXES = "app/mail/mailboxes/page.tsx";
const ADMIN_LAYOUT = "app/admin/enterprise-mail/layout.tsx";
const ADMIN_JOURNAL = "app/admin/enterprise-mail/journal/page.tsx";
const ADMIN_CAPTURE = "app/admin/enterprise-mail/capture/page.tsx";
const ADMIN_HOME = "app/admin/enterprise-mail/mailboxes/page.tsx";
const NAV = "lib/nav.ts";
const MAIL_NAV = "components/ec/mail-nav.tsx";

/** Tab labels pushed by a layout, in source order. */
const tabsOf = (p: string) =>
  [...code(p).matchAll(/label:\s*"([^"]+)"\s*\}/g)].map((m) => m[1]);

const hrefsOf = (p: string) =>
  [...code(p).matchAll(/href:\s*"([^"]+)"/g)].map((m) => m[1]);

// ---------------------------------------------------------------------------
// 1. The employee workspace
// ---------------------------------------------------------------------------
describe("the employee Enterprise Mail bar is the frozen five", () => {
  it("has exactly the five ratified tabs, in order", () => {
    expect(tabsOf(MAIL_LAYOUT)).toEqual([
      "Boîte de réception",
      "Nouveau message",
      "Brouillons",
      "Envoyés",
      "Boîtes aux lettres",
    ]);
  });

  it("routes them to the canonical mail URLs", () => {
    expect(hrefsOf(MAIL_LAYOUT)).toEqual([
      "/mail/inbox",
      "/mail/compose",
      "/mail/drafts",
      "/mail/sent",
      "/mail/mailboxes",
    ]);
  });

  it("does NOT contain the technical sending journal", () => {
    // The specific regression: an operational queue view at the front of a mail
    // client. Absent by label AND by route, so neither can creep back alone.
    const s = code(MAIL_LAYOUT);
    expect(s).not.toContain("Journal");
    expect(hrefsOf(MAIL_LAYOUT)).not.toContain("/mail");
    expect(hrefsOf(MAIL_LAYOUT)).not.toContain("/admin/enterprise-mail/journal");
  });

  it("offers no administrative mail surface", () => {
    for (const h of hrefsOf(MAIL_LAYOUT)) {
      expect(h.startsWith("/mail/"), h).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. The landing route
// ---------------------------------------------------------------------------
describe("/mail lands the user somewhere they can actually go", () => {
  it("redirects rather than rendering the journal", () => {
    const s = code(MAIL_ROOT);
    expect(s).toContain("redirect(");
    expect(s).not.toContain("listCommunications");
    expect(s).not.toContain("CommunicationRow");
  });

  it("prefers the inbox but does not hard-redirect to it", () => {
    // communication:inbound:read is granted to NO role (RATIFY-EC1-1), so an
    // unconditional redirect to /mail/inbox would 404 for every user alive.
    const s = code(MAIL_ROOT);
    expect(s).toContain('hasPermission(permissions, "communication:inbound:read")');
    expect(s).toContain('redirect("/mail/inbox")');
    expect(s).toContain('redirect("/mail/compose")');
  });

  it("grants nothing in order to land", () => {
    expect(code(MAIL_ROOT)).not.toMatch(/grant|role_permission|insert/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Envoyés vs Journal — the distinction that must not collapse
// ---------------------------------------------------------------------------
describe("Envoyés and the technical journal stay distinct", () => {
  it("Envoyés shows every non-draft message with its state", () => {
    // It used to filter to SENT only, which hid failed sends from the person
    // who sent them once the journal became administrative.
    const s = code(MAIL_SENT);
    expect(s).toContain("listOutboundCommunications()");
    expect(s).not.toContain('status: "SENT"');
  });

  it("the outbound list excludes drafts, which have their own tab", () => {
    expect(code("lib/comms/service.ts")).toContain('notStatus: "DRAFT"');
  });

  it("they read the same store — no second model", () => {
    // Both go through lib/comms/service; neither introduces a table or a query
    // of its own.
    expect(code(MAIL_SENT)).toContain('from "@/lib/comms/service"');
    expect(code(ADMIN_JOURNAL)).toContain('from "@/lib/comms/service"');
    expect(code(ADMIN_JOURNAL)).not.toMatch(/from\("communication_message"\)/);
    expect(code(MAIL_SENT)).not.toMatch(/from\("communication_message"\)/);
  });

  it("only the journal carries queue mechanics", () => {
    const j = code(ADMIN_JOURNAL);
    expect(j).toContain("QUEUED");
    expect(j).toContain("CANCELLED");
    expect(code(MAIL_SENT)).not.toContain("CANCELLED");
  });
});

// ---------------------------------------------------------------------------
// 4. The administrative workspace
// ---------------------------------------------------------------------------
describe("Administration → Enterprise Mail is a real workspace", () => {
  it("exists as a nested layout, because the sidebar is frozen", () => {
    expect(existsSync(join(root, ADMIN_LAYOUT))).toBe(true);
  });

  it("carries the four ratified surfaces, in order", () => {
    expect(tabsOf(ADMIN_LAYOUT)).toEqual([
      "Utilisateurs et accès",
      "Boîtes aux lettres",
      "État de la capture",
      "Journal technique des envois",
    ]);
  });

  it("every administrative page enforces its own gate", () => {
    expect(code(ADMIN_JOURNAL)).toContain('hasPermission(permissions, "communication:manage")');
    expect(code(ADMIN_CAPTURE)).toContain('hasPermission(permissions, "communication:manage")');
    expect(code(ADMIN_JOURNAL)).toContain("notFound()");
    expect(code(ADMIN_CAPTURE)).toContain("notFound()");
  });

  it("the tab gates match the gates the pages enforce", () => {
    // Navigation visibility must follow actual authority, not decorate it.
    const l = code(ADMIN_LAYOUT);
    expect(l).toContain('hasPermission(permissions, "communication:membership:manage")');
    expect(l).toContain('hasPermission(permissions, "communication:mailbox:provision")');
    expect(l).toContain('hasPermission(permissions, "communication:manage")');
  });

  it("an ordinary mail user reaches none of it", () => {
    // communication:read is held by 8 roles. It must open no administrative
    // page, or the split is cosmetic.
    for (const p of [ADMIN_JOURNAL, ADMIN_CAPTURE]) {
      const s = code(p);
      const gate = s.slice(s.indexOf("getEffectivePermissions"), s.indexOf("notFound()") + 12);
      expect(gate, p).not.toContain('"communication:read"');
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Boîtes aux lettres exists twice, deliberately, meaning different things
// ---------------------------------------------------------------------------
describe("the two Boîtes aux lettres are different questions", () => {
  it("the employee one reads the user's OWN memberships", () => {
    const s = code(MAIL_BOXES);
    expect(s).toContain("listUserMemberships");
    expect(s).toContain('hasPermission(permissions, "communication:read")');
  });

  it("the employee one is not gated on administrative authority", () => {
    // It was `communication:manage` before EMP-IA-1 — an operator surface in
    // the employee workspace, which is the whole thing this phase undid.
    const s = code(MAIL_BOXES);
    const gate = s.slice(s.indexOf("getEffectivePermissions"), s.indexOf("notFound()") + 12);
    expect(gate).not.toContain("communication:manage");
  });

  it("the employee one administers nothing", () => {
    const s = code(MAIL_BOXES);
    expect(s).not.toContain("MailboxToggle");
    expect(s).not.toContain("provisionMailbox");
    expect(s).not.toContain("grantMembership");
  });

  it("the administrative one keeps the operational dashboard", () => {
    // EMP-5F replaced the toggle with a read-only lifecycle badge: the control
    // it offered could not actually change anything (EMP-4A's trigger derives
    // `is_active` from the status), and the lifecycle now lives on the
    // Mailboxes tab. The operational dashboard itself is unchanged.
    expect(code(ADMIN_CAPTURE)).toContain("MailboxLifecycleBadge");
    expect(code(ADMIN_CAPTURE)).toContain("listMailboxHealth");
  });

  it("neither invents a competing mailbox store", () => {
    for (const p of [MAIL_BOXES, ADMIN_CAPTURE, ADMIN_HOME]) {
      expect(code(p), p).not.toMatch(/create\s+table|from\("ec_mailbox"\)/i);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Security boundary — EMP-4A and EC-1 must survive a navigation change
// ---------------------------------------------------------------------------
describe("no boundary moved to make navigation work", () => {
  it("introduces no migration", () => {
    expect(existsSync(join(root, "supabase/migrations/20260815000001_emp_ia_1.sql"))).toBe(false);
  });

  it("grants communication:inbound:read to nobody", () => {
    // RATIFY-EC1-1. The inbox being unreachable is a governance decision, and
    // this phase routes around it rather than overturning it.
    const templates = read("lib/platform/role-templates.ts");
    const holders = templates.split("communication:inbound:read").length - 1;
    // Mentioned only in MAIL_ADMIN's comment explaining its deliberate absence.
    expect(holders).toBeLessThanOrEqual(1);
  });

  it("adds no correspondence permission anywhere in this phase's surfaces", () => {
    for (const p of [MAIL_LAYOUT, MAIL_ROOT, MAIL_BOXES, ADMIN_LAYOUT, ADMIN_JOURNAL, ADMIN_CAPTURE]) {
      const s = code(p);
      expect(s, p).not.toMatch(/communication:[a-z:]*(create|write|delete)/);
    }
  });

  it("SYSTEM_ADMIN gains no correspondence access from the reorganisation", () => {
    for (const p of [MAIL_LAYOUT, MAIL_ROOT, MAIL_BOXES, ADMIN_LAYOUT, ADMIN_JOURNAL, ADMIN_CAPTURE, NAV]) {
      expect(code(p), p).not.toContain("SYSTEM_ADMIN");
    }
  });

  it("MAIL_ADMIN keeps every administrative surface", () => {
    // MAIL_ADMIN holds provision + membership:manage + manage, so all four
    // administrative tabs resolve for it.
    const l = code(ADMIN_LAYOUT);
    for (const perm of ["communication:mailbox:provision", "communication:membership:manage",
                        "communication:manage"]) {
      expect(l, perm).toContain(perm);
    }
  });

  it("the sidebar entry does not widen authority to become visible", () => {
    // permissionsAnyOf lists only permissions that already gate a page here.
    const s = code(NAV);
    const entry = s.slice(s.indexOf('key: "enterprise-mail-admin"'), s.indexOf('key: "brand-center"'));
    expect(entry).toContain("permissionsAnyOf");
    for (const perm of [...entry.matchAll(/"(communication:[a-z:]+)"/g)].map((m) => m[1])) {
      expect(["communication:mailbox:provision", "communication:membership:manage",
              "communication:manage"], perm).toContain(perm);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Deep links and nav mechanics
// ---------------------------------------------------------------------------
describe("existing deep links keep working", () => {
  it("keeps every employee mail route that existed before", () => {
    for (const p of ["app/mail/inbox/page.tsx", "app/mail/compose/page.tsx",
                     "app/mail/drafts/page.tsx", "app/mail/sent/page.tsx",
                     "app/mail/mailboxes/page.tsx", "app/mail/mailboxes/[id]/page.tsx",
                     "app/mail/inbox/[id]/page.tsx", "app/mail/threads/[messageId]/page.tsx"]) {
      expect(existsSync(join(root, p)), p).toBe(true);
    }
  });

  it("/mail redirects instead of 404ing a bookmarked front door", () => {
    expect(code(MAIL_ROOT)).toContain("redirect(");
  });

  it("the tab highlighter picks the longest match, not the first prefix", () => {
    // /admin/enterprise-mail is a prefix of its own children, so a naive
    // startsWith would light the parent tab on every child route.
    const s = code(MAIL_NAV);
    expect(s).toContain("b.href.length > a.href.length");
    expect(s).not.toContain('tab.href === "/mail"');
  });
});
