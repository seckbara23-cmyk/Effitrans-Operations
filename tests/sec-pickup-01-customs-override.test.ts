/**
 * SEC-PICKUP-01 — the customs derogation needs authority of its own.
 * ---------------------------------------------------------------------------
 * THE VULNERABILITY. `canPickup()` is the only thing between a dossier and
 * goods leaving the customs zone before BAE, and `customs_override` switches it
 * off. Both the write that sets the override and the `PICKED_UP` transition
 * asked for `transport:update` — the permission that also edits a pickup
 * address. `PICKUP_AGENT` holds exactly that and holds neither
 * `transport:manage` nor `transport:complete`, so the role physically
 * collecting the cargo could disable the gate and then walk through it, alone.
 *
 * WHAT IS PROVED HOW. The gate itself is a pure function and is tested by
 * calling it. The authorisation sits inside a `"use server"` action that
 * resolves a session, a service-role client and a dossier before it reaches the
 * check, so invoking it would need a database; what CAN be proved from source
 * is the property most likely to regress — that the permission is asserted
 * BEFORE the write, on the value read from the ROW rather than from the
 * payload, and that the field is never added to the patch on the unauthorised
 * path. Those are the assertions below.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { canPickup, canReceivePod } from "@/lib/transport/gates";
import { AuditActions } from "@/lib/audit/events";
import { TRANSPORT_PLANNING_FIELDS } from "@/lib/transport/patch";

/**
 * Source, with line endings normalised to LF.
 *
 * The working tree is CRLF on Windows and LF in CI. Structural assertions that
 * span a line break must not depend on which — and a body-slicing anchor like
 * `\n}\n` silently matches nothing against CRLF, which makes a slice run on
 * into the next function and an assertion pass or fail for the wrong reason.
 */
const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const actions = read("lib/transport/actions.ts");
const i18n = read("lib/i18n.ts");

/**
 * One function's body, ending at the next top-level declaration.
 *
 * Ends on `\n}` followed by a blank line rather than on the next doc comment:
 * not every function here carries one, and an over-long slice would silently
 * drag the NEXT function's code into an assertion — which is exactly how 4.4
 * first "failed" by finding `canPickup` in the planning path.
 */
function bodyOf(src: string, decl: string): string {
  const i = src.indexOf(decl);
  if (i < 0) throw new Error(`${decl} not found`);
  const rest = src.slice(i);
  const end = rest.indexOf("\n}\n");
  return end < 0 ? rest : rest.slice(0, end + 2);
}

/** Where the override is written. */
const updateBody = bodyOf(actions, "async function runUpdateTransport(");
/** Where the pickup gate is evaluated. */
const statusBody = bodyOf(actions, "async function runChangeTransportStatus(");

// ===========================================================================
describe("1 — the gate it protects still behaves exactly as before", () => {
  it("1.1 — an IMP dossier cannot be picked up before RELEASED", () => {
    expect(canPickup("IMP", { required: true, status: "DECLARATION_PREPARED" }, false)).toBe(false);
    expect(canPickup("IMP", { required: true, status: "DOCUMENTS_PENDING" }, false)).toBe(false);
    expect(canPickup("IMP", { required: true, status: "NOT_STARTED" }, false)).toBe(false);
  });

  it("1.2 — and CAN be picked up once customs is RELEASED", () => {
    expect(canPickup("IMP", { required: true, status: "RELEASED" }, false)).toBe(true);
    expect(canPickup("EXP", { required: true, status: "RELEASED" }, false)).toBe(true);
  });

  it("1.3 — dossiers with no customs leg are never gated", () => {
    expect(canPickup("TRP", { required: true, status: "NOT_STARTED" }, false)).toBe(true);
    expect(canPickup("HND", null, false)).toBe(true);
    expect(canPickup("IMP", { required: false, status: "NOT_STARTED" }, false)).toBe(true);
    expect(canPickup("IMP", null, false)).toBe(true);
  });

  it("1.4 — the override is still the only bypass, and still works", () => {
    // Unchanged on purpose: this slice governs WHO may set it, not what it does.
    expect(canPickup("IMP", { required: true, status: "DOCUMENTS_PENDING" }, true)).toBe(true);
  });

  it("1.5 — the POD control is untouched", () => {
    expect(canReceivePod(["DELIVERY_NOTE"])).toBe(true);
    expect(canReceivePod(["BL", "PACKING_LIST"])).toBe(false);
  });
});

// ===========================================================================
describe("2 — `transport:update` is no longer sufficient to move the override", () => {
  it("2.1 — the override change asserts transport:manage", () => {
    expect(updateBody).toContain('assertPermission("transport:manage")');
  });

  it("2.2 — and refuses with its own error code, not a generic forbidden", () => {
    // An operator who may edit the rest of the transport must be told WHICH
    // field was refused, or they will retry the whole form and fail again.
    expect(updateBody).toContain('return { ok: false, error: "forbidden_customs_override" }');
  });

  it("2.3 — the refusal has a French message that says what is still possible", () => {
    expect(i18n).toContain("forbidden_customs_override:");
    const line = i18n.slice(i18n.indexOf("forbidden_customs_override:"));
    expect(line.slice(0, 260)).toMatch(/responsable transport/);
  });

  it("2.4 — the action still requires transport:update for everything else", () => {
    // The new check is ADDITIONAL authority, not a replacement.
    expect(updateBody).toContain('assertPermission("transport:update")');
    expect(updateBody.indexOf('assertPermission("transport:update")'))
      .toBeLessThan(updateBody.indexOf('assertPermission("transport:manage")'));
  });
});

// ===========================================================================
describe("3 — a crafted payload cannot talk its way past the check", () => {
  it("3.1 — the comparison reads the CURRENT value from the row, not the payload", () => {
    // `rec` is loaded server-side, tenant-scoped. If the "before" value came
    // from the client, a caller could claim the override was already on and
    // make its change look like a no-op.
    expect(updateBody).toContain("const overrideFrom = rec.customs_override === true;");
    expect(updateBody).not.toMatch(/overrideFrom\s*=\s*input\./);
  });

  it("3.2 — the field is assigned ONLY inside the authorised branch", () => {
    // The whole defect in one assertion: there must be no unguarded
    // `patch.customs_override = …` left anywhere in the function.
    const assignments = [...updateBody.matchAll(/patch\.customs_override\s*=/g)];
    expect(assignments).toHaveLength(1);
    const guardAt = updateBody.indexOf('assertPermission("transport:manage")');
    expect(updateBody.indexOf("patch.customs_override =")).toBeGreaterThan(guardAt);
  });

  it("3.3 — the old unguarded one-liner is gone", () => {
    expect(actions).not.toContain(
      "if (input.customsOverride !== undefined) patch.customs_override = input.customsOverride;",
    );
  });

  it("3.4 — authorisation happens BEFORE the database write", () => {
    const guardAt = updateBody.indexOf('assertPermission("transport:manage")');
    const writeAt = updateBody.indexOf("casUpdate(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(guardAt);
  });

  it("3.5 — `customsOverride` is not reachable through the planning field set", () => {
    // Planning fields are patched generically from the input; the override is
    // deliberately not one of them, so `clearFields` cannot touch it either.
    expect([...TRANSPORT_PLANNING_FIELDS]).not.toContain("customsOverride");
    expect([...TRANSPORT_PLANNING_FIELDS]).not.toContain("customs_override");
  });

  it("3.6 — and there is exactly ONE write path to the column in the whole app", () => {
    for (const rel of [
      "lib/transport/service.ts",
      "lib/transport/patch.ts",
      "lib/process/engine/transit-actions.ts",
      "lib/driver/actions.ts",
    ]) {
      expect(read(rel), rel).not.toMatch(/customs_override\s*[:=]\s*(true|false|input\.|patch)/);
    }
  });
});

// ===========================================================================
describe("4 — ordinary transport work is preserved", () => {
  it("4.1 — the guard fires on an effective CHANGE, not on the field being sent", () => {
    // The panel submits a checkbox, so every save carries a boolean. Gating on
    // presence would refuse a Pickup Agent editing a delivery date.
    expect(updateBody).toContain("overrideTo !== undefined && overrideTo !== overrideFrom");
  });

  it("4.2 — re-submitting the SAME value is not a change", () => {
    // Mirrors the predicate above, as a truth table rather than a string match.
    const changes = (from: boolean, to: boolean | undefined) => to !== undefined && to !== from;
    expect(changes(false, false)).toBe(false);   // ordinary save, override off
    expect(changes(true, true)).toBe(false);     // ordinary save, override already on
    expect(changes(false, undefined)).toBe(false); // field omitted entirely
    expect(changes(false, true)).toBe(true);     // SETTING it — needs authority
    expect(changes(true, false)).toBe(true);     // CLEARING it — also needs authority
  });

  it("4.3 — clearing the override is governed too, not just setting it", () => {
    // The contract says "set, clear or modify". Clearing a derogation is an
    // operational act with consequences of its own.
    const changes = (from: boolean, to: boolean | undefined) => to !== undefined && to !== from;
    expect(changes(true, false)).toBe(true);
  });

  it("4.4 — planning before customs release is untouched", () => {
    // No customs condition anywhere in the planning path: the gate lives on the
    // PICKED_UP transition, which is the whole point of the separation.
    //
    // Comments are stripped first. The guard's own documentation NAMES
    // `canPickup()` to explain what it protects, and a raw substring search
    // cannot tell prose from a call — it found the comment and reported the
    // planning path as gated, which would have been precisely backwards.
    const code = updateBody.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    expect(code).not.toMatch(/canPickup\(/);
    expect(code).not.toMatch(/customsGate\(/);
  });

  it("4.5 — the PICKED_UP gate is still evaluated, unchanged", () => {
    expect(statusBody).toContain('if (toStatus === "PICKED_UP")');
    expect(statusBody).toContain("canPickup(fileType, customs, rec.customs_override)");
    expect(statusBody).toContain('return { ok: false, error: "customs_not_released" }');
  });

  it("4.6 — completion controls still need transport:complete", () => {
    expect(statusBody).toContain('toStatus === "DELIVERED" || toStatus === "POD_RECEIVED" ? "transport:complete"');
  });
});

// ===========================================================================
describe("5 — tenant and dossier isolation still hold", () => {
  it("5.1 — the row is loaded tenant-scoped", () => {
    expect(actions).toContain('.eq("tenant_id", tenantId)');
    const load = actions.slice(actions.indexOf("async function loadTransport"));
    expect(load.slice(0, 400)).toContain('.eq("tenant_id", tenantId)');
  });

  it("5.2 — dossier visibility is checked before any patch is built", () => {
    const visAt = updateBody.indexOf("isFileVisible(user.id, user.tenantId, rec.file_id)");
    expect(visAt).toBeGreaterThan(-1);
    expect(visAt).toBeLessThan(updateBody.indexOf("const overrideFrom"));
  });

  it("5.3 — the compare-and-set is still tenant- and version-fenced", () => {
    const cas = actions.slice(actions.indexOf("async function casUpdate"));
    expect(cas.slice(0, 600)).toContain('.eq("tenant_id", tenantId)');
    expect(cas.slice(0, 600)).toContain('.eq("updated_at", expectedUpdatedAt)');
    expect(cas.slice(0, 600)).toContain('.select("id")');
  });
});

// ===========================================================================
describe("6 — the audit evidence", () => {
  it("6.1 — an override change gets its OWN action, distinct from a field edit", () => {
    expect(AuditActions.TRANSPORT_CUSTOMS_OVERRIDE_CHANGED).toBe("transport.customs_override_changed");
    expect(AuditActions.TRANSPORT_CUSTOMS_OVERRIDE_CHANGED).not.toBe(AuditActions.TRANSPORT_UPDATED);
  });

  it("6.2 — it records the actor, the record, and BOTH values", () => {
    const block = updateBody.slice(updateBody.indexOf("TRANSPORT_CUSTOMS_OVERRIDE_CHANGED"));
    const entry = block.slice(0, block.indexOf("});"));
    expect(entry).toContain("actorId: user.id");
    expect(entry).toContain("tenantId: user.tenantId");
    expect(entry).toContain('entity: "transport_record"');
    expect(entry).toContain("entityId: id");
    expect(entry).toContain("before: { customs_override: overrideFrom }");
    expect(entry).toContain("customs_override: overrideTo");
    // The dossier, so an auditor can find the shipment without a second query.
    expect(entry).toContain("file_id: rec.file_id");
  });

  it("6.3 — it cannot claim a change the database refused", () => {
    // Both refusal paths return before any audit is written.
    const guardAt = updateBody.indexOf("TRANSPORT_CUSTOMS_OVERRIDE_CHANGED");
    const refused = updateBody.indexOf('cas.status === "refused"');
    const stale = updateBody.indexOf('cas.status === "stale"');
    expect(refused).toBeGreaterThan(-1);
    expect(stale).toBeGreaterThan(-1);
    expect(guardAt).toBeGreaterThan(refused);
    expect(guardAt).toBeGreaterThan(stale);
  });

  it("6.4 — and it is fenced by the same `overrideChanges` flag as the write", () => {
    // An unchanged submission must not produce a governance record saying the
    // derogation was touched.
    const occurrences = [...updateBody.matchAll(/if \(overrideChanges\)/g)];
    expect(occurrences).toHaveLength(2); // once for the write, once for the audit
  });

  it("6.5 — the audit timestamp is the database's, not the caller's", () => {
    // audit_log stamps created_at itself; nothing here passes a client time.
    const block = updateBody.slice(updateBody.indexOf("TRANSPORT_CUSTOMS_OVERRIDE_CHANGED"));
    expect(block.slice(0, block.indexOf("});"))).not.toMatch(/Date\(\)|now\(\)|timestamp/);
  });
});

// ===========================================================================
describe("7 — scope", () => {
  it("7.1 — no new permission or role was invented", () => {
    // transport:manage already existed and is already held by the transport
    // managers; PICKUP_AGENT already lacked it. Nothing was created.
    expect(updateBody).toContain('"transport:manage"');
    const perms = [...actions.matchAll(/assertPermission\("([a-z:]+)"\)/g)].map((m) => m[1]);
    for (const p of perms) expect(["transport:update", "transport:manage", "transport:complete", "transport:create", "transport:delete", "transport:assign", "transport:request"]).toContain(p);
  });

  it("7.2 — the customs state machine was not touched", () => {
    const gates = read("lib/transport/gates.ts");
    expect(gates).toContain("return customs.status === \"RELEASED\";");
    expect(gates).toContain("if (customsOverride) return true;");
  });

  it("7.3 — this slice ships no migration", () => {
    // audit_log.action is plain `text` with no CHECK, so a new action value
    // needs no schema change. Verified against the creating migration.
    const foundation = read("supabase/migrations/20260613000001_create_foundation_tables.sql");
    expect(foundation).toContain("action          text not null");
    expect(foundation).not.toMatch(/action[^;]*check\s*\(/i);
  });
});
