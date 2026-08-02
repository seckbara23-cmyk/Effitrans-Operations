/**
 * EC-3B — Commercial / Quotation foundation. Pins the frozen boundaries as hard
 * as the behaviour: maker-checker structural, integer money only, no pricing or
 * tax rule, no duplicated Finance/PDF/numbering/communication engine, and
 * Commercial owning no dossier.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  QUOTATION_STATUSES, QUOTATION_STATUS_FR, LIVE_QUOTATION_STATUSES,
  TERMINAL_QUOTATION_STATUSES, ACCEPTANCE_KINDS, ACCEPTANCE_KIND_FR,
  isLive, isTerminal, isFrozen, canTransition, validateAcceptance, isAcceptanceKind,
} from "@/lib/commercial/model";
import {
  parseQuantityMilli, parseAmountMinor, parseRateBp,
  lineSubtotalMinor, lineTaxMinor, quotationTotals,
  formatAmountMinor, formatQuantityMilli, formatRateBp,
  QUANTITY_SCALE, RATE_SCALE,
} from "@/lib/commercial/money";
import { renderQuotationPdf, quotationArtifactPath, QUOTATION_RENDERER_VERSION } from "@/lib/commercial/pdf";
import { EVENT_DOMAINS, EVENT_TYPES, getEventType } from "@/lib/workflow/events/types";
import { registryMetadataViolations } from "@/lib/workflow/events/metadata";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const MIG = "supabase/migrations/20260806000001_commercial_quotation.sql";
/** EC-3C — the activation migration that assigns the ratified matrix. */
const ACTIVATION = "supabase/migrations/20260807000001_commercial_activation.sql";
const ACTIONS = "lib/commercial/actions.ts";
const MONEY = "lib/commercial/money.ts";
const PDF = "lib/commercial/pdf.ts";
const SERVICE = "lib/commercial/service.ts";

// ---------------------------------------------------------------------------
describe("migration chain", () => {
  it("EC-3B is migration 82 and EC-3C adds exactly one more, touching none before", () => {
    const all = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(all.length).toBe(83);
    expect(all[82]).toBe("20260807000001_commercial_activation.sql");
    expect(all[81]).toBe("20260806000001_commercial_quotation.sql");
    expect(all[80]).toBe("20260805000001_ec_triage_outcomes.sql");
  });

  it("is idempotent and makes no destructive schema change", () => {
    const sql = code(MIG);
    for (const t of ["quotation_request", "quotation", "quotation_line", "quotation_counter"]) {
      expect(sql, t).toContain(`create table if not exists public.${t}`);
    }
    expect(sql).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b/i);
  });
});

// ---------------------------------------------------------------------------
describe("permissions — act 2 gains its authority; the blanket grant is revoked", () => {
  it("adds exactly one permission: quotation:validate", () => {
    const sql = code(MIG);
    const added = [...sql.matchAll(/\('(quotation:[a-z:]+)',\s*'quotation'/g)].map((m) => m[1]);
    expect(added).toEqual(["quotation:validate"]);
  });

  it("REVOKES the Phase-5.0D blanket grant of create/send/approve", () => {
    const sql = code(MIG);
    expect(sql).toMatch(/delete from public\.role_permission/);
    expect(sql).toContain("'quotation:create', 'quotation:send', 'quotation:approve'");
    // The seed's original blanket grant is what is being corrected.
    const seed = code("supabase/migrations/20260713000001_process_engine.sql");
    expect(seed).toMatch(/quotation:create[\s\S]{0,200}SYSTEM_ADMIN/);
  });

  it("the EXACT ratified matrix holds at all THREE sources (DEC-C32)", () => {
    // This contract began life as "no quotation grant exists anywhere", which
    // was right while EC-3B held every authority ungranted. Migration 83 makes
    // some grants legitimate, so an absence check would now fail correctly and
    // invite being weakened or deleted — and deleting it would remove the only
    // guard on the three-source rule. It became an EXACT-MATRIX assertion
    // instead: the same lesson as the information_schema absence check.
    //
    // The migration's DELETE only cleans rows that already exist; the seed runs
    // AFTER migrations under `supabase db reset`; the templates provision every
    // NEW tenant. All three must state the same matrix or the database
    // disagrees with itself — which is exactly the defect CI caught in EC-3B.
    const MATRIX: Record<string, string[]> = {
      QUOTATION_MANAGER: ["quotation:approve", "quotation:create", "quotation:send"],
      OPS_SUPERVISOR: ["quotation:validate"],
    };
    const ALL = ["quotation:create", "quotation:send", "quotation:approve", "quotation:validate"];

    /** Quotation codes a role receives, per source, as a sorted set. */
    function fromSeed(role: string): string[] {
      const seed = code("supabase/seed.sql");
      const found = new Set<string>();
      for (const stmt of seed.split(/;\s*\n/)) {
        if (!/insert into public\.role_permission/i.test(stmt)) continue;
        if (!new RegExp(`'${role}'`).test(stmt)) continue;
        for (const c of ALL) if (stmt.includes(`'${c}'`)) found.add(c);
      }
      return [...found].sort();
    }
    function fromTemplate(role: string): string[] {
      const tpl = code("lib/platform/role-templates.ts");
      const start = tpl.indexOf(`key: "${role}"`);
      expect(start, `${role} missing from role-templates`).toBeGreaterThan(-1);
      const next = tpl.indexOf('key: "', start + 10);
      const block = tpl.slice(start, next === -1 ? tpl.length : next);
      return ALL.filter((c) => block.includes(`"${c}"`)).sort();
    }
    function fromMigration(role: string): string[] {
      const sql = code(ACTIVATION);
      const found = new Set<string>();
      for (const stmt of sql.split(/;\s*\n/)) {
        if (!/insert into public\.role_permission/i.test(stmt)) continue;
        if (!new RegExp(`'${role}'`).test(stmt)) continue;
        for (const c of ALL) if (stmt.includes(`'${c}'`)) found.add(c);
      }
      return [...found].sort();
    }

    for (const [role, expected] of Object.entries(MATRIX)) {
      const want = [...expected].sort();
      expect(fromMigration(role), `migration 83: ${role}`).toEqual(want);
      expect(fromSeed(role), `seed.sql: ${role}`).toEqual(want);
      expect(fromTemplate(role), `role-templates: ${role}`).toEqual(want);
    }

    // SYSTEM_ADMIN holds NOTHING, at every source. Checked separately and
    // explicitly, because this is the invariant the whole model rests on.
    expect(fromSeed("SYSTEM_ADMIN"), "seed.sql grants SYSTEM_ADMIN a quotation authority").toEqual([]);
    expect(fromTemplate("SYSTEM_ADMIN"), "a template grants SYSTEM_ADMIN a quotation authority").toEqual([]);
    expect(fromMigration("SYSTEM_ADMIN"), "migration 83 grants SYSTEM_ADMIN a quotation authority").toEqual([]);

    // And no OTHER role may pick one up anywhere.
    const templates = code("lib/platform/role-templates.ts");
    for (const role of Object.keys(MATRIX)) void role;
    const holders = [...templates.matchAll(/key: "([A-Z_]+)"/g)].map((m) => m[1]);
    for (const role of holders) {
      if (role in MATRIX) continue;
      expect(fromTemplate(role), `${role} must hold no quotation authority`).toEqual([]);
    }
  });

  it("grants nothing and never names SYSTEM_ADMIN as a recipient", () => {
    const sql = code(MIG);
    expect(sql).not.toMatch(/insert into public\.role_permission/i);
    expect(sql).not.toContain("SYSTEM_ADMIN");
  });

  it("corrects the misleading description rather than renaming the code", () => {
    const sql = code(MIG);
    expect(sql).toMatch(/update public\.permission[\s\S]*?where code = 'quotation:approve'/);
    // The code itself must survive — the process registry references it.
    expect(code("lib/process/effitrans-process.ts")).toContain('"quotation:approve"');
  });

  it("each of the four acts has its own gate in the action layer", () => {
    const a = code(ACTIONS);
    expect(a).toContain('assertPermission("quotation:create")');
    expect(a).toContain('assertPermission("quotation:validate")');
    expect(a).toContain('assertPermission("quotation:send")');
    expect(a).toContain('assertPermission("quotation:approve")');
  });
});

// ---------------------------------------------------------------------------
describe("maker-checker is STRUCTURAL", () => {
  it("a CHECK constraint refuses validator = preparer", () => {
    const sql = code(MIG);
    expect(sql).toContain("constraint quotation_validator_differs");
    expect(sql).toContain("validated_by <> prepared_by");
  });

  it("the RPC refuses it too, with a named error", () => {
    const sql = code(MIG);
    const fn = sql.slice(sql.indexOf("function public.quotation_validate"));
    expect(fn).toContain("v_prepared = p_actor");
    expect(fn).toContain("QT606");
  });

  it("validation cannot be reached from any state but PENDING_VALIDATION", () => {
    expect(code(MIG)).toContain("QT605");
    expect(canTransition("DRAFT", "VALIDATED")).toBe(false);
    expect(canTransition("PENDING_VALIDATION", "VALIDATED")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("integer money only — no float anywhere", () => {
  it("every monetary column is an integer type", () => {
    const sql = code(MIG);
    const lineBlock = sql.slice(sql.indexOf("create table if not exists public.quotation_line"));
    expect(lineBlock).toContain("quantity_milli bigint");
    expect(lineBlock).toContain("unit_amount_minor bigint");
    expect(lineBlock).toContain("tax_rate_bp    int");
    // The Finance types must NOT appear on any commercial money column.
    expect(sql).not.toMatch(/numeric\(\d+, ?\d+\)/);
    expect(sql).not.toMatch(/\b(real|double precision|float)\b/i);
  });

  it("parsing produces integers or null, never a float", () => {
    expect(parseQuantityMilli("1.5")).toBe(1500);
    expect(parseQuantityMilli("1,5")).toBe(1500);
    expect(parseQuantityMilli("0")).toBeNull();
    expect(parseQuantityMilli("-1")).toBeNull();
    expect(parseAmountMinor("150 000")).toBe(15_000_000);
    expect(parseAmountMinor("1234,56")).toBe(123_456);
    expect(parseAmountMinor("abc")).toBeNull();
    expect(parseRateBp("18")).toBe(1800);
    expect(parseRateBp("")).toBe(0);
    expect(parseRateBp("2000")).toBeNull();
    for (const v of [parseQuantityMilli("1.5"), parseAmountMinor("1234,56"), parseRateBp("18")]) {
      expect(Number.isInteger(v!)).toBe(true);
    }
  });

  it("arithmetic refuses non-integers outright", () => {
    expect(() => lineSubtotalMinor(1.5, 100)).toThrow();
    expect(() => lineTaxMinor(100, 1.5)).toThrow();
  });

  it("the classic float trap cannot reach a total", () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point; in minor units it is exact.
    const a = parseAmountMinor("0.10")!;
    const b = parseAmountMinor("0.20")!;
    expect(a + b).toBe(parseAmountMinor("0.30"));
  });

  it("subtotal and tax are exact integer arithmetic", () => {
    expect(lineSubtotalMinor(2000, 15_000_000)).toBe(30_000_000);
    expect(lineSubtotalMinor(1500, 100)).toBe(150);
    expect(lineTaxMinor(10_000, 0)).toBe(0);
    expect(lineTaxMinor(10_000, 1800)).toBe(1800);
    expect(QUANTITY_SCALE).toBe(1000);
    expect(RATE_SCALE).toBe(10000);
  });

  it("totals are derived, tax-free by default, and never stored", () => {
    const t = quotationTotals([
      { quantityMilli: 2000, unitAmountMinor: 15_000_000, taxRateBp: 0 },
      { quantityMilli: 1000, unitAmountMinor: 5_000_000, taxRateBp: 0 },
    ]);
    expect(t.subtotalMinor).toBe(35_000_000);
    expect(t.taxMinor).toBe(0);
    expect(t.taxFree).toBe(true);
    // No total column exists on any table.
    expect(code(MIG)).not.toMatch(/total_minor|subtotal|total_amount/);
    // And the service computes them at read time.
    expect(code(SERVICE)).toContain("quotationTotals(lines)");
  });

  it("formats for display without mutating the stored integer", () => {
    expect(formatAmountMinor(35_000_000, "XOF")).toBe("350 000,00 XOF");
    expect(formatQuantityMilli(1500)).toBe("1,5");
    expect(formatRateBp(1800)).toBe("18,00 %");
  });
});

// ---------------------------------------------------------------------------
describe("no pricing rule, no tax rule, no statutory value", () => {
  it("the tax rate defaults to ZERO and no rate is encoded", () => {
    const sql = code(MIG);
    expect(sql).toContain("tax_rate_bp    int not null default 0");
    for (const forbidden of ["1800", "0.18", "18%", "TVA", "500", "CA 5"]) {
      expect(sql, forbidden).not.toContain(forbidden);
    }
  });

  it("no tariff, price list or rate card is created", () => {
    const sql = code(MIG);
    for (const t of ["tariff", "price_list", "rate_card", "pricing"]) {
      expect(sql, t).not.toContain(t);
    }
  });

  it("the renderer prints no tax block when nothing carries a rate", () => {
    const p = code(PDF);
    expect(p).toContain("if (!totals.taxFree)");
    const bytes = renderQuotationPdf({
      quotationNumber: "DEV-2026-00001", version: 1, issuedOn: "2026-08-06",
      currency: "XOF", tenantName: "T", clientName: "C",
      lines: [{ position: 1, description: "Transit", quantityMilli: 1000, unitAmountMinor: 100_000, taxRateBp: 0 }],
    });
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.startsWith("%PDF")).toBe(true);
    expect(text).not.toContain("Total TTC");
  });

  it("renders deterministically — same input, same bytes", () => {
    const input = {
      quotationNumber: "DEV-2026-00002", version: 2, issuedOn: "2026-08-06",
      currency: "XOF", tenantName: "T", clientName: "C",
      lines: [{ position: 1, description: "Ligne", quantityMilli: 1000, unitAmountMinor: 1, taxRateBp: 0 }],
    };
    expect(Buffer.from(renderQuotationPdf(input)).equals(Buffer.from(renderQuotationPdf(input)))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("versioning and immutability", () => {
  it("only ONE live version may exist per request", () => {
    const sql = code(MIG);
    expect(sql).toContain("uq_quotation_one_live_version");
    expect(sql).toContain("where status in ('DRAFT','PENDING_VALIDATION','VALIDATED','SENT')");
  });

  it("a sent quotation is immutable and its lines are frozen", () => {
    const sql = code(MIG);
    expect(sql).toContain("function public.quotation_immutable_once_sent");
    expect(sql).toContain("QT610");
    expect(sql).toContain("function public.quotation_line_frozen_guard");
    expect(sql).toContain("QT612");
    expect(isFrozen("SENT")).toBe(true);
    expect(isFrozen("DRAFT")).toBe(false);
  });

  it("revision creates a NEW row and supersedes the old one, which survives", () => {
    const sql = code(MIG);
    const fn = sql.slice(sql.indexOf("function public.quotation_revise"));
    expect(fn).toContain("set status = 'SUPERSEDED'");
    expect(fn).toContain("insert into public.quotation");
    expect(fn).toContain("v_old.version + 1");
    // Never a delete: history is permanent.
    expect(fn).not.toMatch(/delete from public\.quotation\b/);
  });

  it("terminal states are terminal", () => {
    expect([...TERMINAL_QUOTATION_STATUSES]).toEqual(["SUPERSEDED", "CANCELLED", "CONVERTED"]);
    for (const s of TERMINAL_QUOTATION_STATUSES) {
      expect(isTerminal(s)).toBe(true);
      expect(canTransition(s, "DRAFT")).toBe(false);
    }
    expect(code(MIG)).toContain("QT611");
  });

  it("the status vocabulary is complete and labelled", () => {
    expect(QUOTATION_STATUSES.length).toBe(9);
    for (const s of QUOTATION_STATUSES) expect(QUOTATION_STATUS_FR[s]).toBeTruthy();
    expect([...LIVE_QUOTATION_STATUSES].every(isLive)).toBe(true);
  });

  it("there is NO expiry state, no expiry date and no scheduler", () => {
    const sql = code(MIG);
    expect([...QUOTATION_STATUSES]).not.toContain("EXPIRED");
    expect(sql).not.toMatch(/valid_until|expires_at|expiry_date|EXPIRED/);
    for (const f of [ACTIONS, SERVICE, "lib/commercial/model.ts"]) {
      expect(code(f), f).not.toMatch(/setInterval|\bcron\b|node-schedule/i);
    }
  });
});

// ---------------------------------------------------------------------------
describe("acceptance is evidence, never inferred", () => {
  it("the three ratified kinds, and only those", () => {
    expect([...ACCEPTANCE_KINDS]).toEqual(["SIGNED_QUOTATION", "EMAIL", "WRITTEN_AGREEMENT"]);
    for (const k of ACCEPTANCE_KINDS) expect(ACCEPTANCE_KIND_FR[k]).toBeTruthy();
    expect(isAcceptanceKind("VERBAL")).toBe(false);
    expect(validateAcceptance({ kind: "VERBAL" })).toBe("invalid_kind");
    expect(validateAcceptance({ kind: "EMAIL" })).toBeNull();
    expect(validateAcceptance({ kind: "EMAIL", on: "06-08-2026" })).toBe("invalid_date");
  });

  it("the database demands a kind, a date and a recorder", () => {
    const sql = code(MIG);
    expect(sql).toContain("constraint quotation_accepted_has_evidence");
    expect(sql).toContain("acceptance_kind is not null");
    expect(sql).toContain("acceptance_recorded_by is not null");
    expect(sql).toContain("QT613");
  });

  it("nothing derives acceptance from an inbound message", () => {
    const all = code(MIG) + code(ACTIONS) + code(SERVICE);
    // The message is REFERENCED as evidence, never read to decide.
    expect(code(MIG)).toContain("acceptance_message_id  uuid references public.ec_inbound_message (id)");
    expect(all).not.toMatch(/auto_accept|infer_accept|from\("ec_inbound_message"\)/);
  });
});

// ---------------------------------------------------------------------------
describe("bounded context — Commercial owns no dossier, no finance, no comms", () => {
  it("creates no dossier: conversion RECORDS a file Operations created", () => {
    const sql = code(MIG);
    expect(sql).not.toMatch(/insert into public\.operational_file/i);
    const fn = sql.slice(sql.indexOf("function public.quotation_record_conversion"));
    expect(fn).toContain("select id into v_file from public.operational_file");
    expect(fn).not.toMatch(/insert into public\.operational_file/i);
    expect(code(ACTIONS)).not.toMatch(/from\("operational_file"\)[\s\S]{0,80}\.insert\(/);
  });

  it("writes no Finance table", () => {
    const all = code(MIG) + code(ACTIONS) + code(SERVICE);
    for (const t of ["invoice_line", "billing_charge", "payment"]) {
      expect(all, t).not.toMatch(new RegExp(`insert into public\\.${t}|from\\("${t}"\\)`));
    }
    expect(code(MIG)).not.toMatch(/insert into public\.invoice\b/i);
  });

  it("duplicates no PDF engine — it reuses lib/reports/pdf", () => {
    expect(code(PDF)).toContain('from "@/lib/reports/pdf"');
    expect(code(PDF)).not.toMatch(/pdfkit|jspdf|puppeteer/i);
  });

  it("duplicates no numbering engine — it follows the established pattern", () => {
    const sql = code(MIG);
    expect(sql).toContain("create table if not exists public.quotation_counter");
    expect(sql).toContain("function public.next_quotation_number");
    // And it does NOT repeat next_invoice_number's hardcoded tenant prefix.
    expect(sql).not.toContain("'EFT-'");
    expect(sql).toContain("'DEV-'");
  });

  it("duplicates no communication engine and sends no mail", () => {
    const all = code(ACTIONS) + code(SERVICE) + code(PDF);
    expect(all).not.toMatch(/sendEmail|queueAndSend|nodemailer|resend/i);
  });

  it("stores the artifact privately without claiming a dossier it does not have", () => {
    const a = code(ACTIONS);
    expect(a).toContain("uploadObject(path, bytes");
    expect(a).toContain("sha256Hex(bytes)");
    expect(a).toContain("QUOTATION_RENDERER_VERSION");
    // finalize_generated_artifact needs a file_id; a quotation has none yet.
    expect(a).not.toContain("finalize_generated_artifact");
    expect(quotationArtifactPath("t", "q", 2)).toBe("t/quotations/q/v2.pdf");
    expect(QUOTATION_RENDERER_VERSION).toMatch(/^quotation-pdf@\d+$/);
  });
});

// ---------------------------------------------------------------------------
describe("Digital LOS events", () => {
  const REQUIRED = [
    "QUOTATION_CREATED", "QUOTATION_VALIDATED", "QUOTATION_SENT",
    "QUOTATION_ACCEPTED", "QUOTATION_REVISED",
    "QUOTATION_CONVERTED_TO_DOSSIER", "QUOTATION_CANCELLED",
  ];

  it("the commercial domain is registered in code and widened in SQL", () => {
    expect([...EVENT_DOMAINS]).toContain("commercial");
    const sql = code(MIG);
    expect(sql).toContain("drop constraint if exists business_event_event_domain_check");
    expect(sql).toContain("'commercial'");
  });

  it("every mandated event type is registered with a French label", () => {
    for (const t of REQUIRED) {
      const def = getEventType(t);
      expect(def, t).toBeTruthy();
      expect(def!.domain).toBe("commercial");
      expect(def!.labelFr).toBeTruthy();
    }
  });

  it("every mandated event is actually emitted", () => {
    // Quoting differs by origin: the RPCs emit with SQL single quotes, while
    // QUOTATION_CREATED is emitted from the action layer in double quotes.
    const sql = code(MIG) + code(ACTIONS);
    for (const t of REQUIRED) expect(sql, t).toMatch(new RegExp(`['"]${t}['"]`));
  });

  it("state-changing events are emitted inside the RPC transaction", () => {
    const sql = code(MIG);
    for (const fn of ["quotation_create", "quotation_validate", "quotation_send", "quotation_record_decision",
                      "quotation_revise", "quotation_cancel", "quotation_record_conversion"]) {
      const body = sql.slice(sql.indexOf(`function public.${fn}`));
      expect(body.slice(0, 3000), fn).toContain("perform public.emit_business_event");
    }
    for (const def of EVENT_TYPES.filter((d) => d.domain === "commercial")) {
      expect(def.emission, def.type).toBe("rpc");
    }
  });

  it("the conversion event carries the DOSSIER as subject AND dossier_id", () => {
    const sql = code(MIG);
    const emit = sql.slice(sql.indexOf("'QUOTATION_CONVERTED_TO_DOSSIER'"));
    expect(emit.slice(0, 300)).toContain("'operational_file', v_file, v_file");
  });

  it("no amount, price or currency travels in a payload", () => {
    expect(registryMetadataViolations()).toEqual([]);
    for (const def of EVENT_TYPES.filter((d) => d.domain === "commercial")) {
      for (const k of def.metadataKeys) {
        expect(["quotation_id", "request_id", "supersedes_id", "reason_code", "acceptance_kind"],
          `${def.type}.${k}`).toContain(k);
      }
    }
    const sql = code(MIG);
    for (const m of sql.match(/jsonb_build_object\([\s\S]*?\)/g) ?? []) {
      for (const forbidden of ["amount", "unit_amount", "total", "currency", "price"]) {
        expect(m, forbidden).not.toContain(forbidden);
      }
    }
  });

  it("audit payloads carry no money either", () => {
    for (const m of code(ACTIONS).match(/after: \{[\s\S]*?\}/g) ?? []) {
      for (const forbidden of ["unitAmount", "amount", "total", "subtotal", "price"]) {
        expect(m, forbidden).not.toContain(forbidden);
      }
    }
  });

  it("the dossier timeline acknowledges the new domain", () => {
    expect(code("components/files/event-timeline.tsx")).toContain("commercial:");
  });
});

// ---------------------------------------------------------------------------
describe("security and scope", () => {
  it("RLS on all three tables, gated, SELECT-only, no portal policy", () => {
    const sql = code(MIG);
    for (const t of ["quotation_request", "quotation", "quotation_line"]) {
      expect(sql, t).toContain(`alter table public.${t}`);
      expect(sql, t).toMatch(new RegExp(`create policy ${t}_select on public\\.${t}`));
    }
    const policies = [...sql.matchAll(/create policy \w+_select on public\.\w+([\s\S]*?);/g)];
    expect(policies.length).toBe(3);
    for (const p of policies) {
      expect(p[1]).toContain("tenant_id = public.auth_tenant_id()");
      expect(p[1]).toContain("public.has_permission('quotation:create')");
    }
    expect(sql).not.toMatch(/client_user|portal/i);
    // Anchored to `grant select`: a loose /grant [\s\S]*?to authenticated;/
    // starts at an earlier `grant execute` and swallows the whole RPC block.
    const authGrants = sql.match(/grant select[\s\S]*?to authenticated;/g) ?? [];
    expect(authGrants.length).toBeGreaterThan(0);
    for (const g of authGrants) expect(g).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(sql).not.toMatch(/grant (insert|update|delete)[^;]*to authenticated/i);
  });

  it("every RPC is SECURITY DEFINER, search_path pinned, revoked from public", () => {
    const sql = code(MIG);
    const fns = [...sql.matchAll(/create or replace function public\.(quotation\w*|next_quotation_number)\(/g)]
      .map((m) => m[1]);
    const rpcs = [...new Set(fns)].filter((f) => sql.includes(`revoke execute on function public.${f}(`));
    expect(rpcs.length).toBeGreaterThanOrEqual(8);
    for (const f of rpcs) {
      expect(sql, f).toContain(`grant execute on function public.${f}(`);
      expect(sql, f).toMatch(new RegExp(`function public\\.${f}\\([\\s\\S]{0,700}?security definer set search_path = public, pg_temp`));
    }
  });

  it('all "use server" exports are async', () => {
    const a = read(ACTIONS);
    expect(a.startsWith('"use server"')).toBe(true);
    for (const m of a.match(/^export (?!type )(?:async )?function/gm) ?? []) {
      expect(m).toContain("async");
    }
  });

  it("the pure layers import no server-only module", () => {
    for (const f of ["lib/commercial/model.ts", MONEY]) {
      expect(read(f), f).not.toMatch(/import\s+"server-only"/);
    }
  });

  it("is registered in CI, and the earlier EC suites still run", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).toContain("rls_commercial_quotation_test.sql");
    expect(ci).toContain("EC-3B FAIL");
    expect(ci).toContain("rls_ec_inbound_test.sql");
    expect(ci).toContain("rls_ec_triage_test.sql");
  });

  it("no SQL suite resolves a triage item without an outcome (EC-2's cross-suite guard still holds)", () => {
    const dir = join(root, "supabase", "tests");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
      const sql = readFileSync(join(dir, f), "utf8");
      for (const m of sql.matchAll(/update public\.ec_triage_item[\s\S]*?;/g)) {
        if (!/status *= *'RESOLVED'/.test(m[0])) continue;
        const preceding = sql.slice(Math.max(0, m.index! - 200), m.index!);
        if (preceding.includes("EXPECT-FAIL")) continue;
        expect(m[0], `${f}`).toMatch(/outcome *=/);
      }
    }
  });

  it("no SQL suite asserts a table's ABSENCE via information_schema (cross-phase guard)", () => {
    // EC-2's suite asserted "no quotation TABLE exists" — true then, and
    // legitimately invalidated by migration 82, which breaks that suite in CI.
    // An absence claim about the SCHEMA is a claim about every future phase; an
    // absence claim about ROWS is a claim about the phase's own behaviour, and
    // only the second is durable. This flags the fragile form.
    const dir = join(root, "supabase", "tests");
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
      const sql = readFileSync(join(dir, f), "utf8").replace(/^\s*--.*$/gm, "");
      expect(sql, `${f}: asserts table absence via information_schema`)
        .not.toMatch(/from information_schema\.tables[\s\S]{0,200}?table_name in \(/);
    }
  });

  it("EC-3D scope is not started: Commercial still creates no dossier", () => {
    // This marker used to assert that app/commercial did not exist. EC-3C
    // legitimately created it, so the claim was re-aimed at what EC-3D owns
    // rather than deleted — a phase-boundary marker is only useful while it
    // names the NEXT boundary.
    expect(existsSync(join(root, "app", "commercial"))).toBe(true);
    const a = code(ACTIONS);
    // recordConversion RECORDS a dossier Operations made; it never makes one.
    expect(a).toContain("export async function recordConversion");
    expect(a).not.toContain("createFile(");
    // No commercial surface writes into dossier internals, at any layer.
    for (const f of ["lib/commercial/actions.ts", "lib/commercial/service.ts",
                     "lib/commercial/send.ts", "lib/commercial/queues.ts"]) {
      const src = code(f);
      expect(src, `${f} inserts into operational_file`)
        .not.toMatch(/from\("operational_file"\)[\s\S]{0,80}\.(insert|update|upsert|delete)\(/);
    }
  });
});
