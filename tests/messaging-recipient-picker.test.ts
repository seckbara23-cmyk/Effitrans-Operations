/**
 * Effitrans Messaging Center — searchable recipient picker (Phase 8.6A).
 * ---------------------------------------------------------------------------
 * Replaces the raw "Identifiant du collègue (user id)" input with a searchable
 * combobox. Pure-logic tests exercise the real search/rank rule directly; the
 * rest is asserted structurally (component render, no jsdom in this repo's test
 * setup), matching tests/messaging.test.ts's established convention.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { searchStaffDirectory, roleDepartmentCode, type StaffRecipient } from "@/lib/messaging/access";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const messagingCenter = code("../components/messaging/messaging-center.tsx");
const messagingCenterRaw = read("../components/messaging/messaging-center.tsx");
const picker = code("../components/messaging/staff-recipient-picker.tsx");
const pickerRaw = read("../components/messaging/staff-recipient-picker.tsx");
const directory = code("../lib/messaging/staff-directory.ts");
const staffActions = code("../lib/messaging/actions.ts");
const migration = read("../supabase/migrations/20260722000001_messaging_center.sql");
const seed = read("../supabase/seed.sql");

const AWA: StaffRecipient = { id: "u-awa", name: "Awa Ndiaye", email: "awa.ndiaye@effitrans.sn", roleLabel: "Administrateur système", departmentLabel: null };
const MOUSSA: StaffRecipient = { id: "u-moussa", name: "Moussa Diop", email: "moussa.diop@effitrans.sn", roleLabel: "Déclarant en douane", departmentLabel: "Douane" };
const FATOU: StaffRecipient = { id: "u-fatou", name: "Fatou Sarr", email: "fatou.sarr@effitrans.sn", roleLabel: "Chargé finance", departmentLabel: "Finance" };
const POOL = [AWA, MOUSSA, FATOU];

// -------------------------------------------------- 1: raw UUID field removed ----

describe("1 — the raw user-id field is gone", () => {
  it("the new-conversation form no longer asks for a user id", () => {
    expect(messagingCenter).not.toContain("Identifiant du collègue");
    expect(messagingCenter).not.toContain("user id");
  });

  it("NewConversationForm renders the searchable picker, not a plain text input for the recipient", () => {
    expect(messagingCenter).toContain("<StaffRecipientPicker");
    expect(messagingCenter).toContain("participantUserId: recipient.id");
  });
});

// -------------------------------------------------- 2: search input rendered ----

describe("2 — the picker renders a real search combobox", () => {
  it("has a text input with role=combobox and the expected placeholder/label", () => {
    expect(picker).toContain('role="combobox"');
    expect(picker).toContain('placeholder="Rechercher un collègue…"');
    expect(picker).toContain('label = "Destinataire"');
  });
});

// -------------------------------------------------- 3-6: server-side exclusions ----

describe("3-6 — the search reader excludes everyone it must", () => {
  it("excludes the current user (never a client-supplied id)", () => {
    expect(directory).toContain('.neq("id", user.id)');
  });
  it("excludes inactive/archived staff", () => {
    expect(directory).toContain('.eq("status", "active")');
  });
  it("only ever queries app_user — never client_user (portal) or platform_admin", () => {
    expect(directory).toContain('.from("app_user")');
    expect(directory).not.toMatch(/\.from\("client_user"\)/);
    expect(directory).not.toMatch(/\.from\("platform_admin"\)/);
  });
  it("scopes to the CALLER'S OWN tenant, resolved server-side — never a client-supplied tenant id", () => {
    expect(directory).toContain('.eq("tenant_id", user.tenantId)');
    expect(directory).toContain("const user = await getCurrentUser();");
    // The exported function's own signature takes only a query string — no tenantId parameter to trust.
    expect(directory).toMatch(/export async function searchStaffRecipients\(query: string\)/);
  });
  it("is gated on messaging:send, the same permission conversation creation requires", () => {
    expect(directory).toContain('hasPermission(permissions, "messaging:send")');
  });
});

// -------------------------------------------------- 7-10: search fields ----

describe("7-10 — pure search/rank matches on every displayed field", () => {
  it("matches by first or last name", () => {
    expect(searchStaffDirectory(POOL, "Awa", 8)).toEqual([AWA]);
    expect(searchStaffDirectory(POOL, "Ndiaye", 8)).toEqual([AWA]);
    expect(searchStaffDirectory(POOL, "diop", 8)).toEqual([MOUSSA]);
  });
  it("matches by email", () => {
    expect(searchStaffDirectory(POOL, "fatou.sarr@effitrans.sn", 8)).toEqual([FATOU]);
    expect(searchStaffDirectory(POOL, "@effitrans.sn", 8)).toHaveLength(3);
  });
  it("matches by role label", () => {
    expect(searchStaffDirectory(POOL, "Administrateur", 8)).toEqual([AWA]);
    expect(searchStaffDirectory(POOL, "Déclarant", 8)).toEqual([MOUSSA]);
  });
  it("matches by department label", () => {
    expect(searchStaffDirectory(POOL, "Douane", 8)).toEqual([MOUSSA]);
    expect(searchStaffDirectory(POOL, "Finance", 8)).toEqual([FATOU]);
  });
  it("is case-insensitive and matches on a verbatim substring (not fuzzy)", () => {
    expect(searchStaffDirectory(POOL, "AWA", 8)).toEqual([AWA]); // case-insensitive
    expect(searchStaffDirectory(POOL, "Awa Ndiaye", 8)).toEqual([AWA]); // partial, no exact match required
    expect(searchStaffDirectory(POOL, "xyz-no-such-colleague", 8)).toEqual([]); // no match, no fallback guessing
  });
  it("an empty query returns nothing (the reader itself also enforces a minimum length)", () => {
    expect(searchStaffDirectory(POOL, "", 8)).toEqual([]);
    expect(searchStaffDirectory(POOL, "   ", 8)).toEqual([]);
  });
});

// -------------------------------------------------- 11: bounded result count ----

describe("11 — result count is bounded, at both layers", () => {
  it("searchStaffDirectory never returns more than the requested limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `u${i}`, name: `Test User ${i}`, email: `u${i}@effitrans.sn`, roleLabel: null, departmentLabel: null }));
    expect(searchStaffDirectory(many, "Test", 8)).toHaveLength(8);
  });
  it("the reader caps the RESULT it returns to the client and the CANDIDATE set it ever fetches from the DB", () => {
    expect(directory).toMatch(/const RESULT_LIMIT = 8/);
    expect(directory).toMatch(/const CANDIDATE_CEILING = 200/);
    expect(directory).toContain(".limit(CANDIDATE_CEILING)");
  });
});

// -------------------------------------------------- 12/13: selected recipient display ----

describe("12/13 — the selected recipient card shows name/role/department, never a raw id", () => {
  it("renders name, role label, and department label", () => {
    expect(picker).toContain("{selected.name}");
    expect(picker).toContain("[selected.roleLabel, selected.departmentLabel]");
    expect(picker).toContain("{selected.email}");
  });
  it("never renders a recipient's raw .id as visible text — it is used only as a React key / submission value", () => {
    // The only occurrence of `.id` is `key={r.id}` (a React list key — a prop value,
    // never rendered text) and (in messaging-center.tsx) the submission payload
    // `participantUserId: recipient.id`. Neither is a TEXT NODE between JSX tags —
    // that pattern would look like `>{r.id}<` or `>{selected.id}<`, which never occurs.
    expect(pickerRaw).toContain("key={r.id}");
    expect(pickerRaw).not.toMatch(/>\s*\{selected\.id\}\s*</);
    expect(pickerRaw).not.toMatch(/>\s*\{r\.id\}\s*</);
  });
});

// -------------------------------------------------- 14/15: keyboard + clear ----

describe("14/15 — keyboard navigation and clearing the selection", () => {
  it("ArrowDown/ArrowUp move the active option, Enter selects it, Escape closes the list", () => {
    expect(picker).toContain('e.key === "ArrowDown"');
    expect(picker).toContain('e.key === "ArrowUp"');
    expect(picker).toContain('e.key === "Enter"');
    expect(picker).toContain('e.key === "Escape"');
    expect(picker).toContain("choose(results[activeIndex])");
  });
  it("a 'Changer' control clears the current selection", () => {
    expect(picker).toContain("Changer");
    expect(picker).toContain("onClick={onClear}");
  });
});

// -------------------------------------------------- 16/17: create button gating ----

describe("16/17 — Créer is disabled until a valid recipient AND a non-empty message exist", () => {
  it("the submit button's disabled expression checks both, plus the pending state", () => {
    expect(messagingCenter).toContain("disabled={pending || !recipient || !message.trim()}");
  });
  it("submit() itself is also guarded (defense in depth beyond the disabled attribute)", () => {
    const submitFn = messagingCenter.slice(messagingCenter.indexOf("function submit(e: React.FormEvent)"));
    expect(submitFn.slice(0, 200)).toContain("if (!recipient || !message.trim()) return;");
  });
});

// -------------------------------------------------- 18/19: server re-validation ----

describe("18/19 — the server action re-validates the recipient, never trusts the picker's word", () => {
  it("rejects a recipient id that doesn't resolve to an app_user in the caller's own tenant", () => {
    expect(staffActions).toContain("other.tenant_id !== user.tenantId");
  });
  it("rejects an inactive recipient", () => {
    expect(staffActions).toContain('other.status !== "active"');
  });
  it("a stale/unavailable recipient surfaces a French retry message in the UI, not a raw error code", () => {
    expect(messagingCenter).toContain("n'est plus disponible");
  });
});

// -------------------------------------------------- 20: reuse-or-create ----

describe("20 — a repeated direct conversation with the same colleague is reused, not duplicated", () => {
  it("createDirectConversation looks for an existing OPEN direct_staff thread before creating one", () => {
    expect(staffActions).toContain("findOpenDirectConversation");
    expect(staffActions).toContain('.eq("type", "direct_staff")');
    expect(staffActions).toContain('.neq("status", "closed")');
  });
  it("a CLOSED prior thread does not count as reusable — a fresh one begins", () => {
    const fn = staffActions.slice(staffActions.indexOf("async function findOpenDirectConversation"), staffActions.indexOf("export async function createDirectConversation"));
    expect(fn).toContain('.neq("status", "closed")');
  });
  it("dedup requires BOTH users to still be CURRENT (non-removed) participants of the same conversation", () => {
    const fn = staffActions.slice(staffActions.indexOf("async function findOpenDirectConversation"), staffActions.indexOf("export async function createDirectConversation"));
    expect(fn.match(/\.is\("removed_at", null\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

// -------------------------------------------------- 21/22: identity + permissions unchanged ----

describe("21/22 — sender identity is server-derived and messaging:send is still enforced", () => {
  it("createDirectConversation still gates on assertPermission('messaging:send') and derives sender_user_id from the session", () => {
    const fn = staffActions.slice(staffActions.indexOf("export async function createDirectConversation"), staffActions.indexOf("export async function createDossierConversation"));
    expect(fn).toContain('assertPermission("messaging:send")');
    expect(fn).toContain("sender_user_id: user.id");
  });
  it("the recipient search shares the exact same permission gate — no new, weaker gate was invented for it", () => {
    expect(directory).toContain('hasPermission(permissions, "messaging:send")');
  });
});

// -------------------------------------------------- 23: mobile touch targets ----

describe("23 — mobile layout stays usable", () => {
  it("every interactive element in the picker meets the 44px touch-target minimum", () => {
    expect(picker).toMatch(/min-h-\[44px\]/);
    const minHeights = [...picker.matchAll(/min-h-\[(\d+)px\]/g)].map((m) => Number(m[1]));
    expect(minHeights.every((h) => h >= 44)).toBe(true);
  });
});

// -------------------------------------------------- 24: customer support unaffected ----

describe("24 — customer-support conversations are untouched by this change", () => {
  it("the dedup helper only ever looks at type = direct_staff — customer_support/dossier/department are unaffected", () => {
    const fn = staffActions.slice(staffActions.indexOf("async function findOpenDirectConversation"), staffActions.indexOf("export async function createDirectConversation"));
    expect(fn).not.toMatch(/customer_support|dossier|department/);
  });
  it("createSupportConversation (portal) was not modified by this phase", () => {
    const portalActions = code("../lib/portal/messaging-actions.ts");
    expect(portalActions).toContain('type: "customer_support"');
  });
});

// -------------------------------------------------- department label parity ----

describe("department labels shown in search results stay in sync with the seed.sql role grants", () => {
  it("every mapped role in roleDepartmentCode genuinely holds ONLY that department's messaging:read grant (never ambiguous)", () => {
    const mapped: Record<string, string> = {
      DOCUMENTATION_OFFICER: "documentation",
      CUSTOMS_DECLARANT: "customs",
      CUSTOMS_FINANCE_OFFICER: "customs",
      CUSTOMS_FIELD_AGENT: "customs",
      TRANSPORT_OFFICER: "transport",
      PICKUP_AGENT: "transport",
      WAREHOUSE_COORDINATOR: "transport",
      FINANCE_OFFICER: "finance",
      BILLING_OFFICER: "finance",
      COLLECTIONS_OFFICER: "finance",
      ADMINISTRATIVE_OFFICER: "general",
      CEO: "general",
    };
    for (const [role, dept] of Object.entries(mapped)) {
      expect(roleDepartmentCode(role), role).toBe(dept);
      expect(seed, `${role} should be granted messaging:read:${dept}`).toMatch(
        new RegExp(`messaging:read:${dept}[\\s\\S]{0,400}?'${role}'`),
      );
    }
  });

  it("ambiguous multi-department roles are deliberately excluded (CHIEF_OF_TRANSIT holds BOTH customs and transport)", () => {
    expect(roleDepartmentCode("CHIEF_OF_TRANSIT")).toBeNull();
    expect(roleDepartmentCode("SYSTEM_ADMIN")).toBeNull();
    expect(roleDepartmentCode("OPS_SUPERVISOR")).toBeNull();
    expect(roleDepartmentCode("COORDINATOR")).toBeNull();
    expect(roleDepartmentCode("ACCOUNT_MANAGER")).toBeNull();
  });

  it("roles with no department permission at all resolve to null, not a guessed label", () => {
    expect(roleDepartmentCode("QUOTATION_MANAGER")).toBeNull();
    expect(roleDepartmentCode("COMPLIANCE_HSSE")).toBeNull();
  });
});

// -------------------------------------------------- sanity: no new schema needed ----

describe("sanity — this phase adds no new table/RLS surface", () => {
  it("the picker reads only pre-existing tables (app_user, user_role) — no new migration required", () => {
    expect(directory).toContain('.from("app_user")');
    expect(directory).toContain('.from("user_role")');
    expect(directory).not.toMatch(/\.from\("staff_director|\.from\("recipient/);
  });

  it("the Phase 8.7 messaging schema migration is untouched (still the only messaging migration)", () => {
    expect(migration).toContain("create table public.conversation");
  });
});
