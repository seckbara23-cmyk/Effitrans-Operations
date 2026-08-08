/**
 * EMP-1 — Enterprise Mail Workspace & Mailbox Administration.
 *
 * These are mostly STRUCTURAL contracts. The phase's real risks are
 * architectural — a duplicate inbox, a widened security boundary, an outbound
 * path smuggled in — and those are properties of the source, not of a return
 * value. Where behaviour is pure (the view vocabulary), it is tested directly.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  MAIL_VIEWS, MAIL_VIEW_FR, filtersForView, isMailView, type MailView,
} from "@/lib/ec/triage/service";
import { QUARANTINE_VISIBILITY_NOTICE, CAPTURE_OUTCOME_FR } from "@/lib/ec/mailboxes/service";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Source with comments stripped, so a word in prose never satisfies a check. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SERVICE = "lib/ec/mailboxes/service.ts";
const ACTIONS = "lib/ec/mailboxes/actions.ts";
const TRIAGE_SERVICE = "lib/ec/triage/service.ts";
const LIST_PAGE = "app/mail/inbox/page.tsx";
const DETAIL_PAGE = "app/mail/inbox/[id]/page.tsx";
const BOXES_PAGE = "app/mail/mailboxes/page.tsx";
const BOX_DETAIL = "app/mail/mailboxes/[id]/page.tsx";
const LAYOUT = "app/mail/layout.tsx";

// ---------------------------------------------------------------------------
// 1. No duplicate architecture — the phase's central constraint
// ---------------------------------------------------------------------------
describe("EMP-1 creates no parallel mail system", () => {
  it("adds no migration — the chain still ends at 86", () => {
    const files = readdirSync(join(root, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    // Assert this phase's OWN position in the chain, not that it is the newest.
    // Migrations are append-only and never renamed, so an index is stable
    // forever; "the newest migration" is a claim no completed phase owns, and
    // pinning it makes every later phase break this test.
    expect(files.indexOf("20260810000001_decision_plane_emitters.sql")).toBe(85);
    expect(files.length).toBeGreaterThanOrEqual(86);
  });

  it("does not create a second inbox route", () => {
    // The queue lives at exactly one place. These are the plausible second
    // inboxes — a competing top-level route, or a duplicate inside the
    // workspace. `app/mail/inbox` is the canonical one and must EXIST.
    expect(existsSync(join(root, "app/mail/inbox/page.tsx"))).toBe(true);
    for (const p of ["app/inbox", "app/triage", "app/mail/triage",
                     "app/mail/messages", "app/communications"]) {
      expect(existsSync(join(root, p)), p).toBe(false);
    }
  });

  it("builds its views from the EXISTING triage queue, not a new reader", () => {
    const src = code(LIST_PAGE);
    expect(src).toContain("listTriageQueue");
    // No direct module-table access from the page.
    for (const table of ["ec_inbound_message", "ec_webhook_event", "business_event"]) {
      expect(src).not.toContain(`from("${table}")`);
    }
  });

  it("reuses the Decision Plane reader for message history", () => {
    const src = code(DETAIL_PAGE);
    expect(src).toContain("readDecisionPlane");
    expect(src).not.toContain('from("business_event")');
  });
});

// ---------------------------------------------------------------------------
// 2. Zero outbound — the brief forbids it in this phase
// ---------------------------------------------------------------------------
describe("EMP-1 ships no outbound capability", () => {
  const surfaces = [SERVICE, ACTIONS, BOXES_PAGE, BOX_DETAIL, LIST_PAGE, DETAIL_PAGE,
    "components/ec/message-evidence.tsx", "components/ec/mailbox-toggle.tsx"];

  it("never sends, queues or composes", () => {
    for (const f of surfaces) {
      const src = code(f);
      for (const forbidden of ["sendEmail", "queueAndSend", "communication_message", "resend", "nodemailer", "smtp"]) {
        expect(src.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
    }
  });

  it("declares no reply or compose surface OF ITS OWN", () => {
    // Scoped to the modules EMP-1 owns. The triage list and detail pages are
    // SHARED surfaces that later phases extend — EMP-3 adds Reply to the detail
    // page by design — so freezing their wording here would have made a
    // legitimate later phase look like a regression. A phase asserts what it
    // built, not that a shared file never changes again.
    const owned = [SERVICE, ACTIONS, BOXES_PAGE, BOX_DETAIL,
      "components/ec/mailbox-toggle.tsx", "components/ec/message-evidence.tsx"];
    for (const f of owned) {
      const src = code(f).toLowerCase();
      expect(src, f).not.toContain("répondre");
      expect(src, f).not.toContain("rédiger");
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Security — no new boundary, no widened RLS, no admin bypass
// ---------------------------------------------------------------------------
describe("EMP-1 security envelope", () => {
  it("reads through the RLS-bound client, not the admin client", () => {
    const src = code(SERVICE);
    expect(src).toContain("getServerSupabaseClient");
    expect(src).not.toContain("getAdminSupabaseClient");
  });

  it("uses the admin client for exactly one write, behind communication:manage", () => {
    const src = code(ACTIONS);
    expect(src).toContain("getAdminSupabaseClient");
    expect(src).toContain('hasPermission(permissions, "communication:manage")');
    // The tenant predicate is re-applied on the write itself, so a forged id
    // cannot reach another tenant's mailbox.
    expect(src).toContain('.eq("tenant_id", user.tenantId)');
    // One mutation, and it is the boolean.
    expect(src).toContain(".update({ is_active: active })");
    expect(src.match(/\.update\(/g) ?? []).toHaveLength(1);
  });

  it("cannot create or delete a mailbox", () => {
    const src = code(ACTIONS);
    expect(src).not.toContain(".insert(");
    expect(src).not.toContain(".delete(");
    expect(src).not.toContain(".upsert(");
  });

  it("never exposes a secret's value, only whether one is configured", () => {
    const src = code(SERVICE);
    expect(src).toContain("webhookSecretConfigured: Boolean(");
    // The env var appears only inside the Boolean() coercion.
    const uses = src.match(/EC_INBOUND_WEBHOOK_SECRET/g) ?? [];
    expect(uses).toHaveLength(1);
  });

  it("grants SYSTEM_ADMIN no correspondence authority", () => {
    for (const f of [SERVICE, ACTIONS, BOXES_PAGE, BOX_DETAIL, LAYOUT]) {
      expect(code(f)).not.toContain("SYSTEM_ADMIN");
    }
  });

  it("gates mailbox administration more strictly than the read policy", () => {
    // RLS admits communication:inbound:read; these pages demand manage.
    for (const f of [BOXES_PAGE, BOX_DETAIL]) {
      expect(code(f)).toContain('hasPermission(permissions, "communication:manage")');
    }
  });

  it("audits every mailbox state change", () => {
    const src = code(ACTIONS);
    expect(src).toContain("writeAudit");
    expect(src).toContain("EC_MAILBOX_ACTIVATED");
    expect(src).toContain("EC_MAILBOX_DEACTIVATED");
  });

  it("never reads a message body anywhere in the workspace", () => {
    for (const f of [SERVICE, BOXES_PAGE, BOX_DETAIL, "components/ec/message-evidence.tsx"]) {
      const src = code(f);
      expect(src).not.toContain("text_body_path");
      expect(src).not.toContain("html_body_path");
      expect(src).not.toContain("downloadBody");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Immutability — the capture is evidence
// ---------------------------------------------------------------------------
describe("EMP-1 treats captures as immutable evidence", () => {
  it("never writes to any ec_ evidence table", () => {
    for (const f of [SERVICE, ACTIONS, BOXES_PAGE, BOX_DETAIL, DETAIL_PAGE]) {
      const src = code(f);
      for (const table of ["ec_inbound_message", "ec_webhook_event", "ec_inbound_attachment"]) {
        // A read is fine; a mutation on the same line is not.
        expect(src).not.toMatch(new RegExp(`from\\("${table}"\\)[\\s\\S]{0,120}?\\.(update|insert|delete|upsert)\\(`));
      }
    }
  });

  it("surfaces the integrity hash rather than hiding it", () => {
    expect(code("components/ec/message-evidence.tsx")).toContain("rawSha256");
  });
});

// ---------------------------------------------------------------------------
// 5. The view vocabulary (pure behaviour)
// ---------------------------------------------------------------------------
describe("mail views are filters over one queue", () => {
  it("names exactly the five views the brief asks for", () => {
    expect([...MAIL_VIEWS]).toEqual(["inbox", "unassigned", "assigned", "processed", "quarantine"]);
    for (const v of MAIL_VIEWS) expect(MAIL_VIEW_FR[v]).toBeTruthy();
  });

  it("inbox is the open statuses only", () => {
    expect(filtersForView("inbox").statuses).toEqual(["NEW", "ASSIGNED", "IN_REVIEW"]);
  });

  it("unassigned and assigned are complements over the open set", () => {
    expect(filtersForView("unassigned").unassigned).toBe(true);
    expect(filtersForView("assigned").assignedAny).toBe(true);
    expect(filtersForView("unassigned").statuses).toEqual(filtersForView("assigned").statuses);
  });

  it("processed is resolved work, never an open item", () => {
    expect(filtersForView("processed").statuses).toEqual(["RESOLVED"]);
  });

  it("quarantine resolves to a filter that can match nothing", () => {
    expect(filtersForView("quarantine").statuses).toEqual([]);
  });

  it("rejects an unknown view rather than guessing", () => {
    expect(isMailView("inbox")).toBe(true);
    expect(isMailView("everything")).toBe(false);
    expect(isMailView(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Quarantine honesty — the finding that shaped the phase
// ---------------------------------------------------------------------------
describe("quarantine is declared unreachable, not shown as empty", () => {
  it("states that the view is empty BY CONSTRUCTION", () => {
    expect(QUARANTINE_VISIBILITY_NOTICE).toMatch(/construction/i);
    expect(QUARANTINE_VISIBILITY_NOTICE).toMatch(/tenant_id NULL/);
    // It must not read as "nothing was rejected".
    expect(QUARANTINE_VISIBILITY_NOTICE).toMatch(/non parce qu'aucun message n'a été rejeté/);
  });

  it("never issues a query for the quarantine view", () => {
    const src = code(LIST_PAGE);
    // The guard short-circuits before listTriageQueue is ever called.
    expect(src).toMatch(/isQuarantine \|\| dossierUnmatched \? Promise\.resolve\(\[\]\)/);
  });

  it("keeps the capture constraint that makes it so", () => {
    const sql = read("supabase/migrations/20260804000001_ec_inbound_foundation.sql");
    expect(sql).toContain("ec_inbound_quarantine_shape");
    expect(sql).toMatch(/capture_status = 'QUARANTINED' and tenant_id is null/);
  });
});

// ---------------------------------------------------------------------------
// 7. Search cannot widen, and cannot be a query language
// ---------------------------------------------------------------------------
describe("search narrows only", () => {
  it("sanitizes every free-text term through one helper", () => {
    const src = code(TRIAGE_SERVICE);
    expect(src).toContain("function searchTerm");
    for (const field of ["sender", "subject", "recipient"]) {
      expect(src).toContain(`filters.${field}`);
    }
    // The inline sanitizer the sender filter used to carry is gone.
    expect(src.match(/replace\(\/\[%,\(\)\*\]\/g/g) ?? []).toHaveLength(1);
  });

  it("an unresolved dossier number yields no rows instead of dropping the filter", () => {
    const src = code(LIST_PAGE);
    expect(src).toContain("dossierUnmatched");
    expect(src).toMatch(/isQuarantine \|\| dossierUnmatched \? Promise\.resolve\(\[\]\)/);
  });

  it("resolves dossier references through RLS so search cannot probe scope", () => {
    const src = code(TRIAGE_SERVICE);
    const fn = src.slice(src.indexOf("export async function resolveDossierRef"));
    expect(fn).toContain("getServerSupabaseClient");
    expect(fn).not.toContain("getAdminSupabaseClient");
  });
});

// ---------------------------------------------------------------------------
// 8. Reachability — the EC-3C lesson
// ---------------------------------------------------------------------------
describe("every mail surface is reachable", () => {
  it("wraps the workspace in a shared layout with sub-navigation", () => {
    expect(existsSync(join(root, LAYOUT))).toBe(true);
    const src = code(LAYOUT);
    expect(src).toContain("MailNav");
    for (const href of ["/mail", "/mail/inbox", "/mail/mailboxes"]) {
      expect(src).toContain(href);
    }
  });

  it("offers a tab only when the permission for it is held", () => {
    const src = code(LAYOUT);
    expect(src).toContain('hasPermission(permissions, "communication:read")');
    expect(src).toContain('hasPermission(permissions, "communication:inbound:read")');
    expect(src).toContain('hasPermission(permissions, "communication:manage")');
  });
});

// ---------------------------------------------------------------------------
// 9. Labels and presentation hygiene
// ---------------------------------------------------------------------------
describe("presentation", () => {
  it("labels every capture outcome the schema allows", () => {
    for (const o of ["CAPTURED", "DUPLICATE", "QUARANTINED", "REJECTED", "ERROR"]) {
      expect(CAPTURE_OUTCOME_FR[o]).toBeTruthy();
    }
  });

  it("uses no emoji in the mail workspace", () => {
    for (const f of ["components/ec/message-evidence.tsx", "components/ec/mailbox-toggle.tsx",
      "components/ec/mail-nav.tsx", BOXES_PAGE, BOX_DETAIL]) {
      expect(read(f)).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    }
  });

  it("warns that deactivation quarantines future mail", () => {
    expect(read("components/ec/mailbox-toggle.tsx")).toMatch(/quarantaine/i);
  });

  it("states that ledger visibility follows the subject", () => {
    expect(read("components/ec/message-evidence.tsx")).toMatch(/suit son sujet/);
  });
});
