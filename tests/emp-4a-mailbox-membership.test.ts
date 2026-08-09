/**
 * EMP-4A — mailbox membership, provisioning and administration.
 *
 * The RLS behaviour is proven against a real database by migration 89's own
 * assertions (six personas, ALLOWED/DENIED/BROKEN) and by the EC-1/EC-2 suites,
 * which now carry membership fixtures. These are the contracts source alone can
 * hold: what is absent, what is gated, and what does not claim to exist.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { eligibleMailboxes, suggestPersonalAddress, DEPARTMENT_ELIGIBILITY_VALUES } from "@/lib/ec/mailboxes/eligibility";
import { TENANT_ROLE_TEMPLATES } from "@/lib/platform/role-templates";
import { ROLE_CANONICAL_DEPARTMENT } from "@/lib/organization/departments";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (p: string) => read(p).replace(/^\s*--.*$/gm, "");

const MIGRATION = "supabase/migrations/20260813000001_mailbox_membership.sql";
const ADMIN_ACTIONS = "lib/ec/mailboxes/admin-actions.ts";
const MEMBERSHIP = "lib/ec/mailboxes/membership.ts";
const PANEL = "components/ec/mailbox-admin-panel.tsx";
// ADMIN-MAIL-ROUTING moved the module to its own administrative route;
// /users/enterprise-mail is now a permanent redirect to it.
const PAGE = "app/admin/enterprise-mail/mailboxes/page.tsx";

// ---------------------------------------------------------------------------
// 1. can_send_as does not exist anywhere
// ---------------------------------------------------------------------------
describe("can_send_as was ratified out and is absent", () => {
  it("is not a column, a capability, or a control", () => {
    // sql() strips `--`, code() strips `//` and `/* */` — the migration
    // explains in prose WHY can_send_as is absent, and prose is not a column.
    expect(sql(MIGRATION)).not.toContain("can_send_as ");
    for (const f of [ADMIN_ACTIONS, MEMBERSHIP, PANEL, PAGE, "lib/ec/mailboxes/eligibility.ts"]) {
      expect(code(f), f).not.toContain("can_send_as");
      expect(code(f), f).not.toContain("canSendAs");
    }
  });

  it("no surface claims a Send As identity to the user", () => {
    for (const f of [PANEL, PAGE]) {
      // code(), not read(): the component's own comment explains why no such
      // control exists, and that explanation must not trip the check.
      const s = code(f).toLowerCase();
      expect(s, f).not.toContain("send as");
      expect(s, f).not.toContain("envoyer en tant que");
    }
  });

  it("the migration records exactly the four ratified capabilities", () => {
    const s = sql(MIGRATION);
    const table = s.slice(s.indexOf("create table if not exists public.ec_mailbox_member"),
                          s.indexOf("comment on table public.ec_mailbox_member"));
    for (const c of ["can_read", "can_send", "can_manage_members", "is_default_sender"]) {
      expect(table).toContain(c);
    }
    expect(table).not.toContain("can_reply_as");
  });

  it("states that can_send makes no envelope claim", () => {
    expect(sql(MIGRATION)).toContain("It makes no claim about the provider envelope");
  });
});

// ---------------------------------------------------------------------------
// 2. Governance: the darkness is preserved
// ---------------------------------------------------------------------------
describe("RATIFY-EC1-1 survives EMP-4A", () => {
  it("MAIL_ADMIN does NOT hold communication:inbound:read", () => {
    const mailAdmin = TENANT_ROLE_TEMPLATES.find((t) => t.key === "MAIL_ADMIN");
    expect(mailAdmin).toBeTruthy();
    expect(mailAdmin?.permissions).not.toContain("communication:inbound:read");
  });

  it("no role holds communication:inbound:read", () => {
    for (const t of TENANT_ROLE_TEMPLATES) {
      expect(t.permissions, t.key).not.toContain("communication:inbound:read");
    }
  });

  it("SYSTEM_ADMIN receives none of the mailbox permissions", () => {
    const sysadmin = TENANT_ROLE_TEMPLATES.find((t) => t.key === "SYSTEM_ADMIN");
    for (const p of sysadmin?.permissions ?? []) {
      expect(p).not.toMatch(/^communication:(mailbox|membership|diagnostics)/);
    }
    // And the migration asserts it too, so a seed drift cannot reintroduce it.
    expect(sql(MIGRATION)).toContain("SYSTEM_ADMIN holds %");
  });

  it("MAIL_ADMIN holds mailbox administration and nothing unrelated", () => {
    const p = TENANT_ROLE_TEMPLATES.find((t) => t.key === "MAIL_ADMIN")?.permissions ?? [];
    expect(p).toContain("communication:mailbox:provision");
    expect(p).toContain("communication:membership:manage");
    expect(p).toContain("communication:diagnostics:read");
    for (const forbidden of ["admin:", "finance:", "document:delete", "admin:roles:manage", "file:delete"]) {
      expect(p.some((x) => x.startsWith(forbidden)), forbidden).toBe(false);
    }
  });

  it("every permission code is a well-formed three-segment token", () => {
    const p = TENANT_ROLE_TEMPLATES.find((t) => t.key === "MAIL_ADMIN")?.permissions ?? [];
    for (const c of p) expect(c).toMatch(/^[a-z_]+:[a-z_]+(:[a-z_]+)?$/);
  });
});

// ---------------------------------------------------------------------------
// 3. Membership narrows, never grants
// ---------------------------------------------------------------------------
describe("membership is ANDed with the correspondence authority", () => {
  it("every rewritten policy keeps has_permission('communication:inbound:read')", () => {
    const s = sql(MIGRATION);
    for (const table of ["ec_mailbox", "ec_inbound_message", "ec_inbound_attachment", "ec_triage_item"]) {
      const start = s.indexOf(`create policy ${table}_select`);
      expect(start, table).toBeGreaterThan(-1);
      const policy = s.slice(start, s.indexOf(";", start));
      expect(policy, table).toContain("has_permission('communication:inbound:read')");
      expect(policy, table).toContain("public.auth_tenant_id()");
      expect(policy, table).toContain("user_can_read_mailbox");
    }
  });

  it("ec_webhook_event is NOT membership-scoped, per RATIFY-EMP4A-3", () => {
    const s = sql(MIGRATION);
    const start = s.indexOf("create policy ec_webhook_event_select");
    const policy = s.slice(start, s.indexOf(";", start));
    expect(policy).not.toContain("user_can_read_mailbox");
    expect(policy).toContain("communication:diagnostics:read");
  });

  it("the shadowed column is qualified in both nested policies", () => {
    const s = sql(MIGRATION);
    expect(s).toContain("m.id = ec_inbound_attachment.message_id");
    expect(s).toContain("m.id = ec_triage_item.message_id");
    // ec_inbound_message has its OWN message_id (the RFC header, text), so an
    // unqualified reference binds to the inner table and compares uuid to text.
    expect(s).not.toMatch(/where m\.id = message_id/);
  });

  it("the resolver's bootstrap path is one permission, not a general bypass", () => {
    const s = sql(MIGRATION);
    const fn = s.slice(s.indexOf("create or replace function public.user_can_read_mailbox"),
                       s.indexOf("revoke all on function public.user_can_read_mailbox"));
    expect(fn).toContain("has_permission('communication:membership:manage')");
    expect(fn).toContain("m.revoked_at is null");
    // It must not admit the correspondence permission itself — that term lives
    // in the policies, so a mail administrator without it still sees nothing.
    expect(fn).not.toContain("communication:inbound:read");
  });
});

// ---------------------------------------------------------------------------
// 4. Provisioning claims nothing it cannot do
// ---------------------------------------------------------------------------
describe("provisioning is operator-assisted and says so", () => {
  it("contacts no provider, domain, IMAP, POP3 or Exchange", () => {
    for (const f of [ADMIN_ACTIONS, MEMBERSHIP, PANEL, PAGE]) {
      const s = code(f).toLowerCase();
      for (const forbidden of ["imap", "pop3", "exchange", "resend", "createmailbox", "dns", "fetch("]) {
        expect(s, `${f}:${forbidden}`).not.toContain(forbidden);
      }
    }
    // The migration names IMAP/POP3/Exchange only to say it integrates none of
    // them, so it is checked for CALLS rather than for the words.
    const m = sql(MIGRATION).toLowerCase();
    for (const forbidden of ["createmailbox", "http", "curl"]) {
      expect(m, forbidden).not.toContain(forbidden);
    }
  });

  it("a retry increments attempts and calls nothing", () => {
    const s = code(ADMIN_ACTIONS);
    const fn = s.slice(s.indexOf("export async function retryProvisioning"));
    expect(fn).toContain("provisioning_attempts");
    // EMP-5F renamed the target state; a retry still returns the mailbox to the
    // step that needs an operator, and still calls nothing.
    expect(fn).toContain("CONFIGURATION_REQUIRED");
    expect(fn).not.toContain("fetch(");
  });

  it("failure is only ever recorded by a human", () => {
    // EMP-5F replaced `recordSetupOutcome` with the governed steps. The
    // property is unchanged and stronger: the outcome is still a PARAMETER,
    // never derived from an observation the platform cannot make.
    const s = code(ADMIN_ACTIONS);
    expect(s).toContain("recordVerificationOutcome");
    expect(s).toContain("passed: boolean");
    expect(s).toContain('capability: "IDENTITY" | "OUTBOUND" | "INBOUND"');
    expect(s).toContain('evidence_kind: "manual"');
  });

  it("the UI states that provider creation stays manual", () => {
    // The page is JSX, so the apostrophe is an entity in the source.
    expect(read(PAGE)).toMatch(/n&apos;intègre aucun fournisseur de messagerie/);
  });

  it("routing follows the lifecycle through a derivation, not a second write", () => {
    const s = sql(MIGRATION);
    expect(s).toContain("new.is_active := (new.provisioning_status = 'ACTIVE')");
    // The application never writes is_active directly.
    expect(code(ADMIN_ACTIONS)).not.toContain("is_active:");
  });
});

// ---------------------------------------------------------------------------
// 5. Authorization on the write paths
// ---------------------------------------------------------------------------
describe("administration is gated and audited", () => {
  it("membership and provisioning are separate authorities", () => {
    const s = code(ADMIN_ACTIONS);
    expect(s).toContain('gate("communication:membership:manage")');
    expect(s).toContain('gate("communication:mailbox:provision")');
  });

  it("both sides of a grant are tenant-checked", () => {
    const s = code(ADMIN_ACTIONS);
    const fn = s.slice(s.indexOf("export async function grantMembership"), s.indexOf("export async function revokeMembership"));
    expect((fn.match(/\.eq\("tenant_id", user\.tenantId\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("revoke never deletes", () => {
    const s = code(ADMIN_ACTIONS);
    expect(s).not.toContain(".delete()");
    const fn = s.slice(s.indexOf("export async function revokeMembership"));
    expect(fn.slice(0, 900)).toContain("revoked_at");
    // A revoked row must not keep deciding anything.
    expect(fn.slice(0, 900)).toContain("is_default_sender: false");
  });

  it("every write is audited", () => {
    const s = code(ADMIN_ACTIONS);
    // EMP-5E added `setDepartmentEligibility`; EMP-5F replaced
    // `recordSetupOutcome` with the four governed steps, each of which is its
    // own audited act because each is performed by a person who must be
    // nameable afterwards.
    const writes = ["grantMembership", "revokeMembership", "provisionMailbox",
                    "retryProvisioning", "setMailboxEnabled",
                    "setMembershipCapabilities", "setDepartmentEligibility",
                    "recordMailboxConfiguration", "submitMailboxForVerification",
                    "recordVerificationOutcome", "activateMailbox",
                    "recordLegacyActiveDecision"];
    for (const w of writes) expect(s, w).toContain(`export async function ${w}`);
    expect((s.match(/writeAudit\(/g) ?? []).length).toBe(writes.length);
  });

  it("the admin surface lives under Administration, not in the mail workspace", () => {
    // ADMIN-MAIL-ROUTING moved the module out of /users, where being a child
    // of the user-management route made the sidebar highlight two entries at
    // once. The EMP-4A property this asserts — administration lives under
    // Administration, not in the mail workspace — is strengthened, not weakened.
    expect(read("lib/nav.ts")).toContain('href: "/admin/enterprise-mail"');
    expect(read("lib/nav.ts")).not.toContain('href: "/users/enterprise-mail"');
    expect(code("app/mail/layout.tsx")).not.toContain("enterprise-mail");
  });
});

// ---------------------------------------------------------------------------
// 6. Eligibility suggests, never grants (pure)
// ---------------------------------------------------------------------------
describe("eligibility is a suggestion", () => {
  it("derives from the role-derived department, since users have no department column", () => {
    const ops = eligibleMailboxes(["COORDINATOR"]);
    expect(ops.map((e) => e.eligibility)).toContain("OPERATIONS");
    expect(ops.every((e) => e.reason.includes("rôle"))).toBe(true);
  });

  it("proposes nothing for cross-cutting or external roles", () => {
    for (const role of ["SYSTEM_ADMIN", "MAIL_ADMIN", "CEO", "CLIENT_USER", "PARTNER_AGENT"]) {
      expect(ROLE_CANONICAL_DEPARTMENT[role]).toBeNull();
      expect(eligibleMailboxes([role]), role).toEqual([]);
    }
  });

  it("never implies COMMERCIAL from OPERATIONS — quoting is a distinct authority", () => {
    expect(eligibleMailboxes(["COORDINATOR"]).map((e) => e.eligibility)).not.toContain("COMMERCIAL");
  });

  it("is stable and de-duplicated across several roles", () => {
    const a = eligibleMailboxes(["COORDINATOR", "CHIEF_OF_TRANSIT"]);
    const b = eligibleMailboxes(["CHIEF_OF_TRANSIT", "COORDINATOR"]);
    expect(a).toEqual(b);
    expect(new Set(a.map((e) => e.eligibility)).size).toBe(a.length);
    for (const e of a) expect(DEPARTMENT_ELIGIBILITY_VALUES).toContain(e.eligibility);
  });

  it("suggests no personal address without a configured domain", () => {
    // No domain provisioning exists, so this is the normal case today.
    expect(suggestPersonalAddress("Awa Diop", "awa@x.com", null)).toBeNull();
    expect(suggestPersonalAddress("Awa Diop", "awa@x.com", "effitrans.sn")).toBe("awa.diop@effitrans.sn");
  });

  it("nothing in the eligibility module can write", () => {
    const s = code("lib/ec/mailboxes/eligibility.ts");
    for (const w of ["insert", "update", "supabase", "grantMembership"]) {
      expect(s.toLowerCase()).not.toContain(w);
    }
  });
});

// ---------------------------------------------------------------------------
// 6B. The production-only path — regression for the append-only cleanup defect
// ---------------------------------------------------------------------------
describe("the migration-time probe persists nothing", () => {
  // CI cannot reach this path: at migration time its `organization` table is
  // empty (seed runs afterwards), so the probe returns early and only ever
  // executes on a database that already has data. The defect it guards against
  // was found in production, not by CI, so the guard is structural.

  it("deletes nothing at all — the probe rolls back instead of cleaning up", () => {
    const s = sql(MIGRATION);
    expect(s).not.toMatch(/delete\s+from/i);
  });

  it("never attempts a forbidden operation on an append-only EC table", () => {
    // prevent_mutation refuses UPDATE *and DELETE* on these three.
    const s = sql(MIGRATION);
    for (const t of ["ec_inbound_message", "ec_inbound_attachment", "ec_webhook_event"]) {
      expect(s, `delete ${t}`).not.toMatch(new RegExp(`delete\s+from\s+public\.${t}`, "i"));
      expect(s, `update ${t}`).not.toMatch(new RegExp(`update\s+public\.${t}\s+set`, "i"));
    }
  });

  it("uses a subtransaction with a sentinel, and judges outside it", () => {
    const s = sql(MIGRATION);
    expect(s).toContain("raise exception 'EMP4A_PROBE_ROLLBACK'");
    expect(s).toContain("if sqlerrm <> 'EMP4A_PROBE_ROLLBACK' then raise; end if;");
    // Measurements are judged after the rollback, so they must be variables
    // initialised to a value that cannot be mistaken for a pass.
    expect(s).toContain("m_norights      int := -1;");
    expect(s).toContain("v_completed     boolean := false;");
    expect(s).toContain("if not v_completed then");
  });

  it("re-raises anything that is not its own sentinel", () => {
    // Otherwise a genuine error inside the probe would be swallowed and the
    // migration would report success having proven nothing.
    const s = sql(MIGRATION);
    const handler = s.slice(s.indexOf("when others then", s.indexOf("EMP4A_PROBE_ROLLBACK")));
    expect(handler.slice(0, 400)).toContain("raise;");
  });

  it("still exercises all six personas", () => {
    const s = sql(MIGRATION);
    for (const m of ["m_norights", "m_member_msg", "m_member_mbx", "m_noread",
                     "m_bootstrap", "m_cross", "m_alias_blocked"]) {
      expect(s, m).toContain(m);
    }
  });

  it("reports an unexercised cross-tenant check instead of passing silently", () => {
    expect(sql(MIGRATION)).toContain("NOT EXERCISED (single tenant)");
  });
});

// ---------------------------------------------------------------------------
// 7. Scope
// ---------------------------------------------------------------------------
describe("EMP-4A stays inside its scope", () => {
  it("is migration 89 and nothing before it moved", () => {
    const files = readdirSync(join(root, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(files.indexOf("20260813000001_mailbox_membership.sql")).toBe(88);
    expect(files.indexOf("20260812000001_document_ingest_provenance.sql")).toBe(87);
  });

  it("creates no bucket and no second identity model", () => {
    const s = sql(MIGRATION);
    expect(s).not.toMatch(/storage\.buckets/i);
    // Membership keys on app_user — the login identity — not on a new one.
    expect(s).toContain("user_id            uuid not null references public.app_user (id)");
    expect(s).not.toMatch(/create table.*identity/i);
  });

  it("adds no AI and no customer visibility", () => {
    for (const f of [ADMIN_ACTIONS, MEMBERSHIP, PANEL, PAGE, "lib/ec/mailboxes/eligibility.ts"]) {
      const s = code(f).toLowerCase();
      for (const forbidden of ["openai", "anthropic", "portal", "clientsafe"]) {
        expect(s, `${f}:${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("does not modify createUser — onboarding must never be rolled back by mail", () => {
    const s = code("lib/users/actions.ts");
    expect(s).not.toContain("ec_mailbox");
    expect(s).not.toContain("grantMembership");
  });
});
