/**
 * MAYA-P1.10 — `transport:request`: stale, not missing.
 * ---------------------------------------------------------------------------
 * It looked exactly like `customs:register` before P1.1: catalogued, granted to
 * four roles, consumed by nothing. The difference is what the act is anchored to.
 *
 *   customs:register   declared by registry step 9, owner named, evidence
 *                      spelled out, and Finance could not act at all without it.
 *   transport:request  declared by NO step, no owner, no evidence — and nothing
 *                      is blocked: step 3 has the Account Manager COLLECT the
 *                      transport request under `document:create`, which they
 *                      hold, and both first-party sources say so.
 *
 * So nothing was built and nothing was deleted. These guards keep the finding
 * from decaying in either direction: they fail if the permission quietly gains a
 * consumer without the business answer, and they fail if step 3's real authority
 * silently changes underneath it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EFFITRANS_PROCESS } from "@/lib/process/effitrans-process";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const step3 = () => EFFITRANS_PROCESS.find((s) => s.key === "am_dossier_opening")!;

function holders(permission: string): string[] {
  const s = read("lib/platform/role-templates.ts");
  const out: string[] = [];
  for (const m of s.matchAll(/key: "(\w+)"/g)) {
    const next = s.indexOf('key: "', m.index! + 6);
    if (s.slice(m.index!, next === -1 ? undefined : next).includes(`"${permission}"`)) out.push(m[1]);
  }
  return out;
}

// ===========================================================================
describe("the act is unanchored — that is why this is not P1.1", () => {
  it("no registry step declares transport:request", () => {
    const declaring = EFFITRANS_PROCESS.filter((s) => s.permissions?.includes("transport:request"));
    expect(declaring.map((s) => s.key)).toEqual([]);
  });

  it("step 3 gives the Account Manager document:create, not transport:request", () => {
    // Both first-party sources agree the AM COLLECTS the request as an inbound
    // document. The permission they need for that, they have.
    const s = step3();
    expect(s.role).toBe("ACCOUNT_MANAGER");
    expect(s.permissions).toContain("document:create");
    expect(s.permissions).not.toContain("transport:request");
    expect(s.requiredDocuments).toContain("TRANSPORT_REQUEST");
    expect(holders("document:create")).toContain("ACCOUNT_MANAGER");
  });

  it("the business workflow says COLLECT, not raise", () => {
    const wf = read("docs/workflow/effitrans-business-workflow.md");
    expect(wf).toContain("collect transport request");
    expect(wf).toMatch(/\*\*Documents received:\*\* transport request/);
  });

  it("the permission is still granted and still unconsumed", () => {
    // Granted to four roles including the AM…
    expect(holders("transport:request").sort())
      .toEqual(["ACCOUNT_MANAGER", "OPS_SUPERVISOR", "SYSTEM_ADMIN", "TRANSPORT_OFFICER"]);
    expect(read("supabase/migrations/20260713000001_process_engine.sql"))
      .toContain("Raise a transport request for a dossier");
    // …and asserted by nothing. If this ever fails, §6 of the audit was
    // answered — or someone wired a consumer without answering it.
    for (const f of [
      "lib/transport/actions.ts", "lib/transport/driver-actions.ts",
      "lib/documents/artifacts/actions.ts", "lib/files/actions.ts",
    ]) {
      expect(code(f), f).not.toContain("transport:request");
    }
  });

  it("it was NOT deleted — removal is its own deprecation decision", () => {
    expect(read("lib/platform/role-templates.ts")).toContain('"transport:request"');
  });
});

// ===========================================================================
describe("request and order are distinct artifacts, one authority", () => {
  it("the Demande names its requester; the Ordre names driver and vehicle", () => {
    const r = code("lib/documents/artifacts/render.ts");
    const demande = r.slice(r.indexOf("DEMANDE_TRANSPORT: ["), r.indexOf("TRANSPORT_ORDER: ["));
    expect(demande).toContain('"requestedBy"');
    expect(demande).toContain('"requestedAt"');
    expect(demande).not.toContain('"vehiclePlate"');
    const ordre = r.slice(r.indexOf("TRANSPORT_ORDER: ["));
    expect(ordre.slice(0, 300)).toContain('"vehiclePlate"');
    // An order without a driver and a vehicle is not an order.
    const src = code("lib/documents/artifacts/source.ts");
    const mandOrder = src.slice(src.indexOf("TRANSPORT_ORDER: ["));
    expect(mandOrder.slice(0, 260)).toContain('"driverName"');
  });

  it("both are produced under transport:manage — the ASSIGNERS' authority", () => {
    // The recorded consequence: the AM holds `transport:request` and cannot
    // produce a Demande de transport. Whether that is wrong is §6's question,
    // so this pins the CURRENT state rather than asserting a fix.
    expect(code("lib/documents/artifacts/actions.ts")).toContain('assertPermission("transport:manage")');
    expect(holders("transport:manage")).not.toContain("ACCOUNT_MANAGER");
    expect(holders("transport:request")).toContain("ACCOUNT_MANAGER");
  });

  it("nothing was built: no migration, no new object, no new permission", () => {
    // MAYA-P1.11 made this a moving number. What the phase actually meant is
    // that the ledger stays self-consistent, which is durable.
    expect(readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f: string) => f.endsWith(".sql")).length)
      .toBe(Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]));
    const doc = read("docs/maya/maya-p1-10-transport-request-audit.md");
    expect(doc).toContain("stale / unanchored permission");
    expect(doc).toContain("Two active document types share one French label");
  });
});
