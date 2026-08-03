/**
 * EC-3D — customer acceptance & dossier conversion.
 *
 * The load-bearing claim of this phase is a NEGATIVE one: Commercial does not
 * create dossiers, it asks Operations to. Most of what follows pins that, plus
 * the metric arithmetic (pure, so it can be tested at a timezone boundary — the
 * place "accepted today" actually breaks).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { commercialMetrics, type MetricQuotation } from "@/lib/commercial/metrics";
import {
  canConvert, conversionBlockedReason, partition, visibleQueues, QUEUE_LABEL_FR,
} from "@/lib/commercial/queues";
import { CUSTOMER_EVENTS, CUSTOMER_EVENT_KEYS, emailAllowed } from "@/lib/customer-notify/events";
import { TEMPLATES } from "@/lib/comms/templates";
import { EVENT_TYPES, getEventType } from "@/lib/workflow/events/types";
import type { QuotationStatus } from "@/lib/commercial/model";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const CONVERT = "lib/commercial/convert.ts";
const MIGRATION = "supabase/migrations/20260808000001_commercial_conversion.sql";

function q(p: Partial<MetricQuotation> & { status: QuotationStatus }): MetricQuotation {
  return {
    sentAt: null, acceptedOn: null, declinedOn: null,
    convertedAt: null, convertedFileId: null, ...p,
  };
}

// ---------------------------------------------------------------------------
describe("Commercial never owns Operations", () => {
  it("the conversion module writes to NO dossier table", () => {
    const src = code(CONVERT);
    expect(src).not.toMatch(/from\("operational_file"\)/);
    expect(src).not.toMatch(/from\("file_shipment"\)/);
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(src).not.toContain("next_file_number");
  });

  it("it calls the EXISTING Operations contract rather than a copy of it", () => {
    const src = code(CONVERT);
    expect(src).toContain('from "@/lib/files/actions"');
    expect(src).toMatch(/await createFile\(/);
  });

  it("it does not drive the Operations workflow after creating the dossier", () => {
    // openDossierWorkflow owns the process instance, the owner assignment and
    // the `file_opened` customer milestone. Calling it from Commercial would be
    // Commercial modifying the Operations workflow, and would double-notify.
    const src = code(CONVERT);
    expect(src).not.toContain("openDossierWorkflow");
    expect(src).not.toContain("transitionFile");
    expect(src).not.toContain("file_opened");
  });

  it("conversion requires the OPERATIONS authority, not a commercial one", () => {
    const src = code(CONVERT);
    expect(src).toMatch(/assertPermission\("file:create"\)/);
    // and still refuses a caller who may not READ the quotation
    expect(src).toContain("assertCommercialRead");
  });

  it("records the link through the RPC, which is what emits the keystone event", () => {
    const src = code(CONVERT);
    expect(src).toContain("quotation_record_conversion");
  });

  it("a failed link does not delete the Operations row", () => {
    const src = code(CONVERT);
    const i = src.indexOf("conversion_not_recorded");
    expect(i).toBeGreaterThan(-1);
    // No compensating delete anywhere in the module.
    expect(src).not.toMatch(/delete\(\)/);
  });
});

// ---------------------------------------------------------------------------
describe("capability: who may convert", () => {
  const OPS = ["file:create"];
  const AGENT = ["quotation:create", "quotation:send", "quotation:approve"];

  it("needs file:create AND an ACCEPTED quotation", () => {
    expect(canConvert({ id: "1", status: "ACCEPTED", preparedBy: null, version: 1 }, OPS)).toBe(true);
    expect(canConvert({ id: "1", status: "SENT", preparedBy: null, version: 1 }, OPS)).toBe(false);
  });

  it("a quotation agent alone cannot convert — Commercial does not create dossiers", () => {
    expect(canConvert({ id: "1", status: "ACCEPTED", preparedBy: null, version: 1 }, AGENT)).toBe(false);
  });

  it("a seat holding BOTH can convert — permissions union across roles", () => {
    expect(canConvert({ id: "1", status: "ACCEPTED", preparedBy: null, version: 1 }, [...AGENT, ...OPS])).toBe(true);
  });

  it("the refusal is explained rather than silently hidden", () => {
    const reason = conversionBlockedReason({ id: "1", status: "ACCEPTED", preparedBy: null, version: 1 }, AGENT);
    expect(reason).toMatch(/Opérations/);
    expect(conversionBlockedReason({ id: "1", status: "ACCEPTED", preparedBy: null, version: 1 }, OPS)).toBeNull();
    expect(conversionBlockedReason({ id: "1", status: "SENT", preparedBy: null, version: 1 }, AGENT)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("queues: the conversion states", () => {
  it("ready-for-conversion is ACCEPTED — the same set, not a second flag", () => {
    const rows = [
      { id: "a", status: "ACCEPTED" as QuotationStatus, preparedBy: null, version: 1 },
      { id: "b", status: "CONVERTED" as QuotationStatus, preparedBy: null, version: 1 },
    ];
    const p = partition(rows);
    expect(p.readyForConversion.map((r) => r.id)).toEqual(["a"]);
    expect(p.converted.map((r) => r.id)).toEqual(["b"]);
    // The outcome view keeps both.
    expect(p.accepted).toHaveLength(2);
  });

  it("both conversion queues are shown to anyone who can read commercial data", () => {
    for (const perms of [["quotation:create"], ["quotation:validate"]]) {
      expect(visibleQueues(perms)).toContain("readyForConversion");
      expect(visibleQueues(perms)).toContain("converted");
    }
    expect(visibleQueues(["file:create"])).toEqual([]);
  });

  it("every queue key still has a French label", () => {
    for (const k of visibleQueues(["quotation:create", "quotation:validate"])) {
      expect(QUEUE_LABEL_FR[k], k).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
describe("dashboard metrics", () => {
  const TZ = "Africa/Dakar";
  // 2026-08-07 23:30 UTC. Dakar is UTC+0, so the tenant day is the 7th.
  const NOW = new Date("2026-08-07T23:30:00Z");

  it("counts what awaits the customer and what awaits Operations", () => {
    const m = commercialMetrics([
      q({ status: "SENT" }), q({ status: "SENT" }),
      q({ status: "ACCEPTED" }),
      q({ status: "CONVERTED", convertedFileId: "f1", convertedAt: "2026-08-02" }),
    ], TZ, NOW);
    expect(m.awaitingCustomer).toBe(2);
    expect(m.pendingConversion).toBe(1);
    expect(m.convertedThisMonth).toBe(1);
  });

  it("a converted quotation stops counting as pending conversion", () => {
    const m = commercialMetrics(
      [q({ status: "CONVERTED", convertedFileId: "f1" })], TZ, NOW,
    );
    expect(m.pendingConversion).toBe(0);
  });

  it("today is TENANT-local, not UTC", () => {
    // 2026-08-08T00:30 in Dakar (UTC+0) is still the 8th; in a UTC-3 zone the
    // tenant day is the 7th. Same instant, different day — which is the bug.
    const instant = new Date("2026-08-08T00:30:00Z");
    const dakar = commercialMetrics([q({ status: "ACCEPTED", acceptedOn: "2026-08-08" })], "Africa/Dakar", instant);
    const west = commercialMetrics([q({ status: "ACCEPTED", acceptedOn: "2026-08-08" })], "America/Sao_Paulo", instant);
    expect(dakar.acceptedToday).toBe(1);
    expect(west.acceptedToday).toBe(0);
  });

  it("average response time uses only decided quotations", () => {
    const m = commercialMetrics([
      q({ status: "ACCEPTED", sentAt: "2026-08-01T00:00:00Z", acceptedOn: "2026-08-05" }), // 4 days
      q({ status: "DECLINED", sentAt: "2026-08-01T00:00:00Z", declinedOn: "2026-08-03" }), // 2 days
      q({ status: "SENT", sentAt: "2026-08-01T00:00:00Z" }),                               // undecided
    ], TZ, NOW);
    expect(m.averageResponseDays).toBe(3);
  });

  it("no decision yet means no average — not zero", () => {
    // Reporting 0 days would read as "we answer instantly" on an empty pipeline.
    expect(commercialMetrics([q({ status: "SENT" })], TZ, NOW).averageResponseDays).toBeNull();
  });

  it("carries no money", () => {
    const src = code("lib/commercial/metrics.ts");
    expect(src).not.toMatch(/Minor|amount|currency|total/i);
  });
});

// ---------------------------------------------------------------------------
describe("notifications reuse the one pipeline", () => {
  it("adds the two decision events to the EXISTING registry", () => {
    expect(CUSTOMER_EVENT_KEYS).toContain("quotation_accepted");
    expect(CUSTOMER_EVENT_KEYS).toContain("quotation_declined");
    expect(CUSTOMER_EVENTS.quotation_accepted.category).toBe("commercial");
    expect(TEMPLATES.quotation_accepted).toBeTruthy();
    expect(TEMPLATES.quotation_declined).toBeTruthy();
  });

  it("the templates speak of a QUOTATION, never a dossier that does not exist yet", () => {
    for (const k of ["quotation_accepted", "quotation_declined"] as const) {
      expect(TEMPLATES[k].subject).toContain("{{quotationNumber}}");
      expect(TEMPLATES[k].text).not.toContain("{{fileNumber}}");
    }
  });

  it("a customer who muted shipment mail is not emailed a commercial decision", () => {
    const on = { notify_email: true, notify_shipment: true, notify_invoice: true, notify_payment: true };
    expect(emailAllowed(on, "commercial")).toBe(true);
    expect(emailAllowed({ ...on, notify_shipment: false }, "commercial")).toBe(false);
    expect(emailAllowed({ ...on, notify_email: false }, "commercial")).toBe(false);
  });

  it("no second notification engine — the decision action calls notifyCustomer", () => {
    const src = code("lib/commercial/actions.ts");
    expect(src).toContain("notifyCustomer");
    expect(src).toMatch(/quotation_accepted|quotation_declined/);
    // « Dossier créé » is NOT re-sent from Commercial.
    expect(src).not.toContain("file_opened");
  });

  it("the resolver gains a quotation branch instead of a parallel resolver", () => {
    const src = code("lib/customer-notify/service.ts");
    expect(src).toMatch(/quotationId/);
    expect(src).toMatch(/from\("quotation"\)/);
    // Still one function, not two.
    expect((src.match(/export async function notifyCustomer/g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("Digital-LOS events", () => {
  it("all four required types already exist — EC-3D registers none", () => {
    for (const t of [
      "QUOTATION_ACCEPTED", "QUOTATION_DECLINED",
      "QUOTATION_CANCELLED", "QUOTATION_CONVERTED_TO_DOSSIER",
    ]) {
      const def = getEventType(t);
      expect(def, t).toBeTruthy();
      expect(def?.domain).toBe("commercial");
      expect(def?.emission).toBe("rpc");
    }
    expect(code(MIGRATION)).not.toContain("emit_business_event");
  });

  it("the conversion event carries the DOSSIER as subject and dossier_id", () => {
    const sql = code("supabase/migrations/20260806000001_commercial_quotation.sql");
    expect(sql).toMatch(/'QUOTATION_CONVERTED_TO_DOSSIER'[\s\S]{0,120}'operational_file', v_file, v_file/);
  });

  it("no payload carries a customer message body", () => {
    const sql = code("supabase/migrations/20260806000001_commercial_quotation.sql");
    for (const m of sql.matchAll(/jsonb_build_object\(([\s\S]*?)\)\);/g)) {
      expect(m[1]).not.toMatch(/body|message_body|text|subject|comment/i);
    }
    // Identifiers only.
    expect(EVENT_TYPES.filter((e) => e.domain === "commercial").length).toBeGreaterThanOrEqual(9);
  });
});

// ---------------------------------------------------------------------------
describe("migration 84", () => {
  it("adds NO commercial schema — EC-3B already shipped the acceptance model", () => {
    const sql = code(MIGRATION);
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/create or replace function/i);
    expect(sql).not.toMatch(/alter table public\.quotation\b/);
  });

  it("widens the notification category instead of mislabelling a commercial message", () => {
    const sql = code(MIGRATION);
    expect(sql).toMatch(/check \(category in \('shipment', 'invoice', 'payment', 'commercial'\)\)/);
    // Additive: the existing values survive.
    for (const v of ["shipment", "invoice", "payment"]) expect(sql).toContain(`'${v}'`);
  });

  it("gives the notification a quotation to point at, nullable and ON DELETE SET NULL", () => {
    const sql = code(MIGRATION);
    expect(sql).toMatch(/add column if not exists quotation_id uuid references public\.quotation \(id\) on delete set null/);
  });

  it("is additive and touches nothing before it", () => {
    const sql = code(MIGRATION);
    expect(sql).not.toMatch(/\bdrop table\b|\bdrop column\b|\btruncate\b/i);
    const all = readdirSync(join(root, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    expect(all[all.length - 1]).toBe("20260808000001_commercial_conversion.sql");
    expect(all.length).toBe(84);
  });
});
