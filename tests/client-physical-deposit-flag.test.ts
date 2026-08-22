/**
 * FIN-UAT / DEFECT-FIN1-A — the physical-deposit requirement gets a write path.
 * ---------------------------------------------------------------------------
 * The deposit custody chain refuses to start unless
 * `client.requires_physical_invoice_deposit` is true ("a deposit is NEVER
 * implicitly required"). The column was read in four places and written in none,
 * so the entire lane was unreachable in production: 0 of 3 clients configured,
 * and no UI or action could ever change that.
 *
 * The fix is one toggle on the EXISTING `client:update` gate — no permission, no
 * role, no migration. These cases pin the three properties that make it safe:
 * it can be set AND unset, an unauthorized caller cannot change it, and a
 * payload that omits it can never silently turn it ON.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const actions = read("../lib/clients/actions.ts");
const form = read("../components/clients/client-form.tsx");
const types = read("../lib/clients/types.ts");
const service = read("../lib/clients/service.ts");
const i18n = read("../lib/i18n.ts");
const deposit = read("../lib/deposit/actions.ts");

/** The updateClient body only — so a pin can never be satisfied by createClient. */
function updateSlice(): string {
  const start = actions.indexOf("export async function updateClient");
  const end = actions.indexOf("async function setClientStatus");
  expect(start, "updateClient not found").toBeGreaterThan(-1);
  expect(end, "slice boundary moved").toBeGreaterThan(start);
  return actions.slice(start, end);
}
/**
 * The `.update({...})` object literal ONLY. Necessary because the audit entry
 * below it carries an IDENTICAL `requires_physical_invoice_deposit: Boolean(...)`
 * line: a pin over the whole function is satisfied by the audit even when the
 * real write has been deleted. Verified by mutation — M1 passed until this
 * slice existed.
 */
function updateWriteSlice(): string {
  const u = updateSlice();
  const start = u.indexOf(".update({");
  // Searched FROM the update: the tenant-scope SELECT above it also ends with
  // `.eq("id", id)`, and anchoring on the first occurrence yields an empty slice.
  const end = u.indexOf('.eq("id", id)', start);
  expect(start, "update call not found").toBeGreaterThan(-1);
  expect(end, "write slice boundary moved").toBeGreaterThan(start);
  return u.slice(start, end);
}

function createSlice(): string {
  const start = actions.indexOf("export async function createClient");
  const end = actions.indexOf("export async function updateClient");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return actions.slice(start, end);
}

describe("FIN-UAT — client physical-deposit requirement", () => {
  it("is WRITTEN by updateClient, under the existing client:update gate", () => {
    const u = updateSlice();
    // Bound to the WRITE, never to the whole function — see updateWriteSlice.
    expect(updateWriteSlice()).toContain(
      "requires_physical_invoice_deposit: Boolean(input.requiresPhysicalInvoiceDeposit)",
    );
    expect(u).toContain('assertPermission("client:update")');
    // The unauthorized path returns forbidden BEFORE any write is attempted.
    expect(u).toMatch(/catch\s*{\s*return\s*{\s*ok:\s*false,\s*error:\s*"forbidden"\s*};?\s*}/);
    expect(u.indexOf('assertPermission("client:update")')).toBeLessThan(
      u.indexOf("requires_physical_invoice_deposit"),
    );
  });

  it("omitting the field can never turn the circuit ON (Boolean coercion, not undefined)", () => {
    const w = updateWriteSlice();
    // The coercion IS the guarantee: Boolean(undefined) === false, so a payload
    // without the key writes false rather than leaving/settings a truthy value.
    expect(w).toContain("Boolean(input.requiresPhysicalInvoiceDeposit)");
    expect(w).not.toMatch(/requires_physical_invoice_deposit:\s*input\.requiresPhysicalInvoiceDeposit\b/);
    expect(Boolean(undefined)).toBe(false);
    expect(Boolean(false)).toBe(false);
    expect(Boolean(true)).toBe(true);
  });

  it("introduces NO new permission, role or migration", () => {
    for (const forbidden of ["client:deposit", "deposit:configure", "client:manage"]) {
      expect(actions, forbidden).not.toContain(forbidden);
    }
    // The only permissions this file asserts are the pre-existing client ones.
    const perms = [...actions.matchAll(/assertPermission\("([a-z_:]+)"\)/g)].map((m) => m[1]);
    expect([...new Set(perms)].sort()).toEqual([
      "client:create",
      "client:delete",
      "client:update",
    ]);
  });

  it("keeps creation at the database default — no create-time write path", () => {
    const c = createSlice();
    expect(c).not.toContain("requires_physical_invoice_deposit");
    // …and the form does not pretend otherwise: the toggle lives INSIDE the
    // edit-only block. Sliced rather than windowed, so the pin fails if the
    // toggle is ever moved out of that block instead of merely drifting apart.
    const open = form.indexOf('{mode === "edit" && (');
    const close = form.indexOf("{/* Contacts */}");
    expect(open, "edit-only block not found").toBeGreaterThan(-1);
    expect(close, "slice boundary moved").toBeGreaterThan(open);
    expect(form.slice(open, close)).toContain("t.clients.form.requiresPhysicalInvoiceDeposit");
  });

  it("round-trips: the stored value is READ back and pre-fills the toggle", () => {
    expect(service).toContain("requires_physical_invoice_deposit");
    expect(service).toContain("requiresPhysicalInvoiceDeposit: Boolean(client.requires_physical_invoice_deposit)");
    expect(types).toContain("requiresPhysicalInvoiceDeposit: boolean;");
    expect(form).toContain("Boolean(initial?.requiresPhysicalInvoiceDeposit)");
    // Unset is reachable: the checkbox writes the unchecked value straight back.
    expect(form).toContain("setRequiresDeposit(e.target.checked)");
    expect(form).toMatch(/updateClient\(clientId,\s*{\s*\.\.\.payload,\s*requiresPhysicalInvoiceDeposit: requiresDeposit\s*}\)/);
  });

  it("carries the ratified French label and is never inferred from other facts", () => {
    expect(i18n).toContain('requiresPhysicalInvoiceDeposit: "Dépôt physique des factures requis"');
    expect(form).toContain("t.clients.form.requiresPhysicalInvoiceDeposit");
    // No derivation anywhere: the flag is only ever read from the client row.
    expect(actions).not.toMatch(/requiresPhysicalInvoiceDeposit\s*=\s*(segment|type|paymentTerms)/);
    expect(deposit).toContain("clientRequiresDeposit: Boolean((client as Row | null)?.requires_physical_invoice_deposit)");
  });

  it("changes to the requirement are auditable", () => {
    const u = updateSlice();
    expect(u).toMatch(/after:\s*{[\s\S]{0,200}requires_physical_invoice_deposit: Boolean\(input\.requiresPhysicalInvoiceDeposit\)/);
  });

  it("leaves every other client field's behaviour untouched", () => {
    const u = updateSlice();
    for (const f of [
      "name: input.name.trim()",
      "ninea: normalizeNinea(input.ninea)",
      "segment: input.segment?.trim() || null",
      "email: input.email?.trim() || null",
      "phone: input.phone?.trim() || null",
      "address: input.address?.trim() || null",
      "account_manager_id: input.accountManagerId || null",
    ]) {
      expect(u, f).toContain(f);
    }
  });
});
