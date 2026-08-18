/**
 * EC-3C — Commercial workspace. Pins the activation decisions as hard as the
 * behaviour: the ratified matrix, the widened read composition, the explicit
 * application gate over an RLS-bypassing client, role-sensitive queues that
 * never offer an act the server would refuse, and Commercial still creating no
 * dossier.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  visibleQueues, partition, canEditLines, canSubmit, canValidate, canSend,
  canRecordDecision, canRevise, canCancel, validationBlockedReason,
  QUEUE_LABEL_FR,
} from "@/lib/commercial/queues";
import type { QuotationStatus } from "@/lib/commercial/model";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const ACTIVATION = "supabase/migrations/20260807000001_commercial_activation.sql";
const SERVICE = "lib/commercial/service.ts";
const SEND = "lib/commercial/send.ts";
const QUEUES = "lib/commercial/queues.ts";

const AGENT = ["quotation:create", "quotation:send", "quotation:approve"];
const VALIDATOR = ["quotation:validate"];

function q(status: QuotationStatus, preparedBy = "agent-1") {
  return { id: "q1", status, preparedBy, version: 1 };
}

// ---------------------------------------------------------------------------
describe("migration 83 — the ratified matrix and nothing else", () => {
  it("grants exactly the DEC-C32 matrix", () => {
    const sql = code(ACTIVATION);
    expect(sql).toMatch(/r\.code = 'QUOTATION_MANAGER'/);
    expect(sql).toMatch(/r\.code = 'OPS_SUPERVISOR'/);
    expect(sql).toContain("'quotation:create', 'quotation:send', 'quotation:approve'");
    expect(sql).toMatch(/p\.code = 'quotation:validate'/);
  });

  it("never grants anything to SYSTEM_ADMIN, and re-asserts the removal", () => {
    const sql = code(ACTIVATION);
    // SYSTEM_ADMIN appears ONLY inside a delete.
    for (const stmt of sql.split(/;\s*\n/)) {
      if (stmt.includes("SYSTEM_ADMIN")) {
        expect(stmt, "SYSTEM_ADMIN named outside a delete").toMatch(/delete from/i);
      }
    }
    expect(sql).toMatch(/delete from public\.role_permission[\s\S]*?SYSTEM_ADMIN/);
  });

  it("does NOT give OPS_SUPERVISOR quotation:create to make rows readable", () => {
    const sql = code(ACTIVATION);
    for (const stmt of sql.split(/;\s*\n/)) {
      if (!/insert into public\.role_permission/i.test(stmt)) continue;
      if (!stmt.includes("OPS_SUPERVISOR")) continue;
      expect(stmt).not.toMatch(/quotation:(create|send|approve)/);
    }
  });

  it("widens ALL THREE select policies to create OR validate — and invents no quotation:read", () => {
    const sql = code(ACTIVATION);
    for (const t of ["quotation_request", "quotation", "quotation_line"]) {
      const re = new RegExp(
        `create policy ${t}_select on public\\.${t}[\\s\\S]{0,320}?has_permission\\('quotation:create'\\)[\\s\\S]{0,120}?has_permission\\('quotation:validate'\\)`,
      );
      expect(sql, `${t} select policy not widened`).toMatch(re);
    }
    expect(sql).not.toContain("quotation:read");
    // Still SELECT-only for authenticated: writes remain RPC-only.
    expect(sql).not.toMatch(/for (insert|update|delete) to authenticated/);
  });

  it("is additive: no table, column or constraint is dropped", () => {
    const sql = code(ACTIVATION);
    expect(sql).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b|\bdrop constraint\b/i);
    // Dropping a POLICY to recreate it is the sanctioned way to change one.
    expect(sql).toMatch(/drop policy if exists/);
  });

  it("sits at position 83, immediately after EC-3B, and moved nothing before it", () => {
    const all = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(all[82]).toBe("20260807000001_commercial_activation.sql");
    expect(all[81]).toBe("20260806000001_commercial_quotation.sql");
  });
});

// ---------------------------------------------------------------------------
describe("application read gate — RLS is NOT what protects these reads", () => {
  it("every exported read asserts the gate before touching the admin client", () => {
    const src = read(join("lib", "commercial", "service.ts"));
    const readers = [
      "listRequests", "listVersions", "getQuotation", "listLines",
      "commercialCounts", "listQuotations", "listCommercialClients", "listQuotationHandoffs",
    ];
    for (const fn of readers) {
      const i = src.indexOf(`export async function ${fn}`);
      expect(i, `${fn} not found`).toBeGreaterThan(-1);
      const body = src.slice(i, i + 900);
      const gate = body.indexOf("assertCommercialRead");
      const client = body.indexOf("getAdminSupabaseClient()");
      expect(gate, `${fn} does not gate`).toBeGreaterThan(-1);
      // The gate must come FIRST — a check after the read is not a gate.
      if (client > -1) expect(gate, `${fn} reads before gating`).toBeLessThan(client);
    }
  });

  it("the gate checks BOTH the permission set and tenant ownership", () => {
    const src = code(SERVICE);
    expect(src).toMatch(/user\.tenantId !== tenantId/);
    expect(src).toMatch(/COMMERCIAL_READ_PERMISSIONS\.some/);
    expect(src).toMatch(/if \(!user\) throw new CommercialAccessError/);
  });

  it("the readable set is exactly create OR validate — the same pair the policies name", () => {
    const src = code(SERVICE);
    const m = src.match(/COMMERCIAL_READ_PERMISSIONS = \[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const codes = [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
    expect(codes).toEqual(["quotation:create", "quotation:validate"]);
  });

  it("the signed-URL path is gated too — a private bucket has no other door", () => {
    const src = code(SEND);
    const i = src.indexOf("export async function quotationArtifactUrl");
    const body = src.slice(i);
    expect(body).toContain("assertCommercialRead");
    expect(body.indexOf("assertCommercialRead")).toBeLessThan(body.indexOf("createSignedDownloadUrl"));
  });
});

// ---------------------------------------------------------------------------
describe("role-sensitive queues", () => {
  it("an agent sees the preparation and customer-facing queues", () => {
    const v = visibleQueues(AGENT);
    expect(v).toContain("drafts");
    expect(v).toContain("readyToSend");
    expect(v).toContain("sent");
  });

  it("a validate-only supervisor is NOT shown drafts they can neither see nor act on", () => {
    const v = visibleQueues(VALIDATOR);
    expect(v).not.toContain("drafts");
    expect(v).not.toContain("readyToSend");
    expect(v).toContain("awaitingValidation");
  });

  it("both roles see the validation queue — that is the shared surface", () => {
    expect(visibleQueues(AGENT)).toContain("awaitingValidation");
    expect(visibleQueues(VALIDATOR)).toContain("awaitingValidation");
  });

  it("someone with neither authority sees no queue at all", () => {
    expect(visibleQueues(["file:read"])).toEqual([]);
  });

  it("every queue key has a French label", () => {
    for (const k of visibleQueues([...AGENT, ...VALIDATOR])) {
      expect(QUEUE_LABEL_FR[k], k).toBeTruthy();
    }
  });

  it("partition routes each status to exactly one queue", () => {
    const rows = [
      q("DRAFT"), q("PENDING_VALIDATION"), q("VALIDATED"), q("SENT"),
      q("ACCEPTED"), q("DECLINED"), q("CANCELLED"), q("CONVERTED"),
    ];
    const p = partition(rows);
    expect(p.drafts).toHaveLength(1);
    expect(p.awaitingValidation).toHaveLength(1);
    expect(p.readyToSend).toHaveLength(1);
    expect(p.sent).toHaveLength(1);
    expect(p.accepted).toHaveLength(2); // ACCEPTED + CONVERTED
    expect(p.declined).toHaveLength(1);
    expect(p.cancelled).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("capabilities mirror the server gates — never offer a refused act", () => {
  it("agents cannot validate, supervisors cannot edit draft lines", () => {
    expect(canValidate(q("PENDING_VALIDATION"), AGENT, "someone")).toBe(false);
    expect(canEditLines(q("DRAFT"), VALIDATOR)).toBe(false);
    expect(canSubmit(q("DRAFT"), VALIDATOR)).toBe(false);
  });

  it("the maker-checker is surfaced: you may not validate what you prepared", () => {
    expect(canValidate(q("PENDING_VALIDATION", "sup-1"), VALIDATOR, "sup-1")).toBe(false);
    expect(canValidate(q("PENDING_VALIDATION", "agent-1"), VALIDATOR, "sup-1")).toBe(true);
    // And the refusal is NAMED rather than silent.
    expect(validationBlockedReason(q("PENDING_VALIDATION", "sup-1"), VALIDATOR, "sup-1"))
      .toMatch(/séparation des tâches/);
    expect(validationBlockedReason(q("PENDING_VALIDATION", "agent-1"), VALIDATOR, "sup-1")).toBeNull();
  });

  it("sending requires a VALIDATED quotation — never a draft or a pending one", () => {
    expect(canSend(q("VALIDATED"), AGENT)).toBe(true);
    for (const s of ["DRAFT", "PENDING_VALIDATION", "SENT", "ACCEPTED"] as QuotationStatus[]) {
      expect(canSend(q(s), AGENT), s).toBe(false);
    }
  });

  it("a customer decision may only be recorded on a SENT quotation", () => {
    expect(canRecordDecision(q("SENT"), AGENT)).toBe(true);
    expect(canRecordDecision(q("VALIDATED"), AGENT)).toBe(false);
    expect(canRecordDecision(q("SENT"), VALIDATOR)).toBe(false);
  });

  it("lines are editable only while DRAFT — a sent quotation is immutable", () => {
    expect(canEditLines(q("DRAFT"), AGENT)).toBe(true);
    for (const s of ["PENDING_VALIDATION", "VALIDATED", "SENT", "ACCEPTED"] as QuotationStatus[]) {
      expect(canEditLines(q(s), AGENT), s).toBe(false);
    }
  });

  it("revision is offered where a new version is the only way forward", () => {
    expect(canRevise(q("SENT"), AGENT)).toBe(true);
    expect(canRevise(q("DECLINED"), AGENT)).toBe(true);
    expect(canRevise(q("DRAFT"), AGENT)).toBe(false);
    expect(canCancel(q("CONVERTED"), AGENT)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("workspace routes — one route per capability", () => {
  it("exposes the landing, the creation route and the detail route", () => {
    expect(existsSync(join(root, "app", "commercial", "page.tsx"))).toBe(true);
    expect(existsSync(join(root, "app", "commercial", "layout.tsx"))).toBe(true);
    expect(existsSync(join(root, "app", "commercial", "quotations", "new", "page.tsx"))).toBe(true);
    expect(existsSync(join(root, "app", "commercial", "quotations", "[id]", "page.tsx"))).toBe(true);
  });

  it("has NO second list route duplicating the landing", () => {
    // /commercial IS the list, organised by state. A /commercial/quotations
    // index would show the same rows under a different heading.
    expect(existsSync(join(root, "app", "commercial", "quotations", "page.tsx"))).toBe(false);
  });

  it("every page gates itself before reading anything", () => {
    for (const p of [
      "app/commercial/page.tsx",
      "app/commercial/quotations/new/page.tsx",
      "app/commercial/quotations/[id]/page.tsx",
    ]) {
      const src = code(p);
      expect(src, p).toContain("notFound()");
      expect(src, p).toMatch(/hasPermission|COMMERCIAL_READ_PERMISSIONS/);
    }
  });

  it("the creation route requires quotation:create, not merely read access", () => {
    const src = code("app/commercial/quotations/new/page.tsx");
    expect(src).toMatch(/hasPermission\(permissions, "quotation:create"\)/);
  });

  it("DÉPARTEMENTS holds only DEPARTMENTS — the workspace lives on the hub", () => {
    // PIN MOVED (TMS-5B, 2026-08-18): Transport became a DEPARTMENT by business
    // decision, so the section holds four. The point this case makes is unchanged:
    // a WORKSPACE never earns a top-level entry.

    const nav = code("lib/nav.ts");
    const i = nav.indexOf('label: "Départements"');
    const section = nav.slice(i, nav.indexOf("key: \"management\"", i));
    const hrefs = [...section.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      "/departments/operations", "/departments/transit",
      "/departments/transport", "/departments/finance",
    ]);
    // And /commercial is reachable from the Operations hub instead.
    expect(code("app/departments/operations/page.tsx")).toContain('href: "/commercial"');
  });

  it("a quotation agent can actually reach the hub that holds the tile", () => {
    // QUOTATION_MANAGER holds none of file:read / client:read / document:read,
    // so without this the hub 404'd and the workspace was unreachable.
    const hub = code("app/departments/operations/page.tsx");
    expect(hub).toMatch(/HUB_ANY_OF[\s\S]{0,200}quotation:create/);
    expect(code("lib/nav.ts")).toMatch(/permissionsAnyOf: \[[\s\S]{0,200}quotation:create/);
  });
});

// ---------------------------------------------------------------------------
describe("boundaries held", () => {
  it("no second email engine — delivery reuses lib/comms and the STORED artifact", () => {
    const src = code(SEND);
    expect(src).toContain('from "@/lib/comms/provider"');
    expect(src).not.toContain("renderQuotationPdf");
    expect(src).toMatch(/downloadObject\(q\.artifact_storage_path\)/);
    expect(src).not.toMatch(/nodemailer|smtp|new Resend\(/i);
  });

  it("no tax or pricing rule is encoded anywhere in the workspace", () => {
    for (const p of [QUEUES, SEND, "components/commercial/quotation-studio.tsx"]) {
      const src = code(p);
      expect(src, p).not.toMatch(/\b0?\.18\b|\bTVA 18|18\s*%/);
      expect(src, p).not.toMatch(/\btarif|price[_ ]?list|rate[_ ]?card\b/i);
    }
  });

  it("Commercial writes nothing into dossier internals", () => {
    for (const p of ["lib/commercial/service.ts", "lib/commercial/send.ts", "lib/commercial/queues.ts"]) {
      const src = code(p);
      expect(src, p).not.toMatch(/from\("operational_file"\)[\s\S]{0,80}\.(insert|update|upsert|delete)\(/);
    }
  });

  it("EC-2 semantics are untouched: the handoff is READ, never written or auto-converted", () => {
    const src = code(SERVICE);
    const i = src.indexOf("export async function listQuotationHandoffs");
    const body = src.slice(i, i + 1400);
    expect(body).toContain('eq("outcome", "HANDOFF_TO_QUOTATION")');
    // No write of any kind to the triage table.
    expect(src).not.toMatch(/from\("ec_triage_item"\)[\s\S]{0,120}\.(insert|update|upsert|delete)\(/);
    // Nothing creates a quotation as a side effect of a handoff existing.
    expect(body).not.toContain("quotation_create");
  });

  it("the client component imports only pure modules, never the server-only service", () => {
    // Comments stripped: the file legitimately *mentions* server-only when
    // explaining why it must not import it.
    const studio = code("components/commercial/quotation-studio.tsx");
    expect(studio).not.toContain('from "@/lib/commercial/service"');
    expect(studio).not.toMatch(/import\s+["']server-only["']/);
    expect(studio.startsWith('"use client"')).toBe(true);
  });

  it("money stays in integer minor units — no float arithmetic in the queue layer", () => {
    const src = code(QUEUES);
    expect(src).not.toMatch(/parseFloat|Number\(.*\)\s*[*/+-]\s*100\b/);
  });
});
