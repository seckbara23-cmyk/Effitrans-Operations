/**
 * TMS-4 — Transport Requests & Execution: the request act, anchored.
 * ---------------------------------------------------------------------------
 * The execution machine (states, gates, evidence, driver flow) was COMPLETE
 * and is reused unchanged — these pins protect that as hard as they protect
 * the one new thing: requestTransport, the act `transport:request` now gates.
 * Governing contract: docs/tms/tms-4-transport-requests.md.
 */
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(__dirname, "..");
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), "utf-8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const actions = read("lib", "transport", "actions.ts");
const actionsCode = strip(actions);
const gates = read("lib", "transport", "gates.ts");
const panel = read("components", "transport", "transport-panel.tsx");
const templates = read("lib", "platform", "role-templates.ts");

const requestSlice = actions.slice(
  actions.indexOf("export async function requestTransport"),
  actions.indexOf("export async function createTransport"),
);

// ========================================================== the request act ====

describe("TMS-4 — requestTransport is what transport:request gates", () => {
  it("asserts transport:request — not create, not manage — plus dossier visibility", () => {
    expect(requestSlice).toContain('assertPermission("transport:request")');
    expect(requestSlice).not.toContain('assertPermission("transport:create")');
    expect(requestSlice).toContain("isFileVisible(user.id, user.tenantId, fileId)");
  });

  it("a live transport refuses — the request never doubles or resets an engaged execution", () => {
    expect(requestSlice).toContain('if (!existing.deleted_at) return { ok: false, error: "already_exists" }');
  });

  it("revival is WES-1C: clearing deleted_at is the WHOLE operation — planning history preserved", () => {
    const revival = requestSlice.slice(
      requestSlice.indexOf("if (existing) {"),
      requestSlice.indexOf("} else {"),
    );
    expect(revival).toContain(".update({ deleted_at: null })");
    expect(revival).not.toContain("status");
    expect(revival).not.toContain("notes");
  });

  it("a fresh request lands NOT_STARTED with the requester as created_by and the précision quarantined in notes", () => {
    expect(requestSlice).toContain('status: "NOT_STARTED"');
    expect(requestSlice).toContain("created_by: user.id");
    expect(requestSlice).toContain("`Demande de transport — ${precision}`");
    expect(requestSlice).toContain('.trim().slice(0, 500)');
  });

  it("the act is audited as TRANSPORT_REQUESTED", () => {
    expect(requestSlice).toContain("AuditActions.TRANSPORT_REQUESTED");
    expect(read("lib", "audit", "events.ts")).toContain('TRANSPORT_REQUESTED: "transport.requested"');
  });

  it("notifies ACTIVE TRANSPORT_OFFICER holders, skipping the requester, via the EXISTING type", () => {
    expect(requestSlice).toContain('m.role?.code !== "TRANSPORT_OFFICER"');
    expect(requestSlice).toContain('m.user.status !== "active"');
    expect(requestSlice).toContain("m.user.id === user.id || notified.has(m.user.id)");
    expect(requestSlice).toContain('type: "FILE_ASSIGNED"');
    // NO new notification type: the vocabulary is untouched
    expect(read("lib", "notifications", "types.ts")).not.toContain("TRANSPORT_REQUESTED");
  });

  it("NO app-emitted business event — the insert trigger owns TRANSPORT_PLANNING_CREATED (WES-4 double-emission trap)", () => {
    expect(requestSlice).not.toContain("business_event");
    expect(requestSlice).not.toContain("emit_business_event");
    expect(requestSlice).not.toContain("publish");
  });
});

// ===================================================== authority unchanged ====

describe("TMS-4 — no silent widening", () => {
  function holders(permission: string): string[] {
    const out: string[] = [];
    for (const m of templates.matchAll(/key: "(\w+)"/g)) {
      const next = templates.indexOf('key: "', (m.index ?? 0) + 6);
      if (templates.slice(m.index, next === -1 ? undefined : next).includes(`"${permission}"`)) out.push(m[1]);
    }
    return out;
  }

  it("the ACCOUNT_MANAGER still holds NO execution authority", () => {
    for (const p of ["transport:create", "transport:manage", "transport:assign", "transport:complete", "transport:delete"]) {
      expect(holders(p), p).not.toContain("ACCOUNT_MANAGER");
    }
  });

  it("transport:request holders are exactly the four catalogued roles — unchanged", () => {
    expect(holders("transport:request").sort()).toEqual([
      "ACCOUNT_MANAGER", "OPS_SUPERVISOR", "SYSTEM_ADMIN", "TRANSPORT_OFFICER",
    ]);
  });

  it("execution actions keep their original gates", () => {
    const createSlice = actions.slice(actions.indexOf("export async function createTransport"), actions.indexOf("export async function updateTransport"));
    expect(createSlice).toContain('assertPermission("transport:create")');
    expect(actionsCode).toContain('toStatus === "DELIVERED" || toStatus === "POD_RECEIVED" ? "transport:complete" : "transport:update"');
  });
});

// ================================================ interlocks & evidence ====

describe("TMS-4 — the customs interlock and evidence gates are byte-stable", () => {
  it("canPickup: IMP/EXP refuse until customs RELEASED unless not-required or the audited override", () => {
    expect(gates).toContain('if (fileType !== "IMP" && fileType !== "EXP") return true;');
    expect(gates).toContain("if (customsOverride) return true;");
    expect(gates).toContain("if (!customs || !customs.required) return true;");
    expect(gates).toContain('return customs.status === "RELEASED";');
  });

  it("changeTransportStatus still enforces the gate at PICKED_UP and the POD gate at POD_RECEIVED", () => {
    expect(actionsCode).toContain('if (toStatus === "PICKED_UP")');
    expect(actionsCode).toContain('return { ok: false, error: "customs_not_released" }');
    expect(actionsCode).toContain("if (!canReceivePod(approved))");
  });

  it("POD evidence still means an APPROVED DELIVERY_NOTE — no second document store", () => {
    expect(gates).toContain('approvedDocTypeCodes.includes("DELIVERY_NOTE")');
  });
});

// ================================================================== UI ====

describe("TMS-4 — the request lane in the panel", () => {
  it("renders ONLY for a request-holder who cannot already start execution, on a dossier with no record", () => {
    expect(panel).toContain("{!canCreate && canRequest && (");
    expect(panel).toContain("Demander le transport");
  });

  it("carries an optional capped précision and calls the request action", () => {
    expect(panel).toContain("maxLength={500}");
    expect(panel).toContain("requestTransport(fileId, requestNote.trim() || null)");
  });

  it("the dossier page wires canRequest from the permission", () => {
    expect(read("app", "files", "[id]", "page.tsx")).toContain(
      'canRequest={hasPermission(permissions, "transport:request")}',
    );
  });

  it("no permission code or SQLSTATE reaches the screen", () => {
    expect(panel).not.toContain(">transport:request<");
    expect(panel).not.toMatch(/HR6\d\d|TM\d\d\d|EFA\d\d/);
  });
});

// ========================================================== scope guard ====

describe("TMS-4 — scope guard (no TMS-5/TMS-6 pre-build)", () => {
  it("TMS-4 shipped NO migration — the latest is still TMS-2's", () => {
    const migrations = fs.readdirSync(path.join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(migrations[migrations.length - 1]).toBe("20260907000001_shipment_geography.sql");
  });

  it("the external boundary stays free text + TRANSPORT_ORDER — no registry pre-built", () => {
    const migration = read("supabase", "migrations", "20260615000003_create_transport.sql");
    expect(migration).toContain("transport_company    text");
    expect(fs.existsSync(path.join(root, "lib", "subcontractors"))).toBe(false);
  });

  it("no vehicle/fleet surface appeared", () => {
    for (const dir of ["lib", "components", "app"]) {
      const names: string[] = [];
      const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory()) { names.push(e.name); walk(path.join(d, e.name)); }
        }
      };
      walk(path.join(root, dir));
      expect(names.some((n) => /fleet|vehicle|fuel|maintenance/i.test(n)), dir).toBe(false);
    }
  });
});
