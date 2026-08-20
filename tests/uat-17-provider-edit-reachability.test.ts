/**
 * TMS-7 / UAT-17 — editing the subcontractor master record.
 * ---------------------------------------------------------------------------
 * `updateProvider` was complete, permission-gated and audited, and NOTHING
 * called it: a repo-wide search found it defined once and referenced nowhere.
 * So a phone number or a misspelled raison sociale could not be corrected at
 * all, and the only remedy was retiring the row and creating a duplicate —
 * which fragments exactly the carrier history TMS-6 exists to preserve.
 *
 * Third instance of the same class, after TMS-5A (Parc & Flotte) and
 * DEFECT-UAT15c (the intake surface): the capability was built; nothing led
 * to it.
 *
 * THE INVARIANT UNDER TEST. Editing touches the MASTER row only.
 * `transport_record.transport_company` is a snapshot taken when the provider
 * was bound, and a later rename must never rewrite it — the printed ORDRE DE
 * TRANSPORT has to keep naming the carrier as it was called then. These tests
 * exist as much to stop a future "helpful" cascade as to prove the form works.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");

const console_ = read("components", "subcontractors", "provider-console.tsx");
const actions = read("lib", "subcontractors", "actions.ts");
const transport = read("lib", "transport", "actions.ts");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const consoleCode = strip(console_);
const actionsCode = strip(actions);

/** The body of updateProvider alone — bounded, so a neighbour cannot satisfy a pin. */
const updateFn = (() => {
  const start = actionsCode.indexOf("export async function updateProvider");
  const end = actionsCode.indexOf("export async function", start + 40);
  const slice = actionsCode.slice(start, end);
  if (start < 0 || end < 0 || slice.length < 200) throw new Error("updateProvider slice not found");
  return slice;
})();

describe("UAT-17 — the master record is editable at last", () => {
  it("the console calls the EXISTING action, not a new one", () => {
    expect(consoleCode).toContain("updateProvider,");
    expect(consoleCode).toContain("updateProvider(target, {");
  });

  it("no competing mutation was invented", () => {
    for (const rival of ["renameProvider", "editProvider", "patchProvider", "saveProvider"]) {
      expect(consoleCode, rival).not.toContain(rival);
      expect(actionsCode, rival).not.toContain(rival);
    }
  });

  it("every field updateProvider supports is offered, and only those", () => {
    for (const f of ["u_name", "u_ninea", "u_contactName", "u_phone", "u_email", "u_address", "u_notes"]) {
      expect(consoleCode, f).toContain(`name="${f}"`);
    }
    // Status and directory membership keep their own controls; the details form
    // must not smuggle them in.
    for (const forbidden of ["u_status", "u_isActive", "u_transportCount"]) {
      expect(consoleCode, forbidden).not.toContain(forbidden);
    }
  });

  it("the form is re-keyed per provider, so details cannot be saved onto another", () => {
    expect(consoleCode).toContain("key={selected.id}");
  });
});

describe("UAT-17 — the historical snapshot stays immutable", () => {
  it("updateProvider writes ONLY to the master table", () => {
    expect(updateFn).toContain('.from("transport_provider")');
    expect(updateFn).not.toContain("transport_record");
  });

  it("a rename never propagates into a transport's carrier text", () => {
    // The whole point of UAT-17. If this string ever appears in updateProvider,
    // past ORDRE DE TRANSPORT documents start lying about who carried the goods.
    expect(updateFn).not.toContain("transport_company");
  });

  it("the console's edit path touches no transport either", () => {
    const form = consoleCode.slice(
      consoleCode.indexOf("updateProvider(target, {"),
      consoleCode.indexOf("Agrément :"),
    );
    expect(form.length).toBeGreaterThan(100);
    expect(form).not.toContain("transport_company");
    expect(form).not.toContain("assignTransport");
  });

  it("the snapshot is still taken at ASSIGNMENT time, where it belongs", () => {
    expect(transport).toContain('(patch as Record<string, unknown>).transport_company = provider.name;');
  });
});

describe("UAT-17 — nothing else was touched", () => {
  it("authority is still transport:manage, asserted server-side", () => {
    expect(updateFn).toContain('assertPermission("transport:manage")');
  });

  it("duplicate-name validation survives", () => {
    expect(updateFn).toContain('if (error.code === "23505") return { ok: false, error: "duplicate_name" };');
    expect(updateFn).toContain('if (!name) return { ok: false, error: "name_required" };');
  });

  it("the PROVIDER_UPDATED audit row survives", () => {
    expect(updateFn).toContain("action: AuditActions.PROVIDER_UPDATED");
  });

  it("the update is tenant-scoped", () => {
    expect(updateFn).toContain('.eq("tenant_id", user.tenantId)');
  });

  it("the lifecycle controls are unchanged", () => {
    expect(consoleCode).toContain("setProviderStatus(target, s)");
    expect(consoleCode).toContain("setProviderActive(target, !selected.isActive)");
  });

  it("the refusal messages the form can hit are all mapped", () => {
    for (const code of ["forbidden", "name_required", "duplicate_name", "generic"]) {
      expect(consoleCode, code).toContain(`${code}:`);
    }
  });
});
