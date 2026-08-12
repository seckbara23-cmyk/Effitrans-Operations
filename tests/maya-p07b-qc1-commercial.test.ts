/**
 * MAYA-P0.7-B — Contrôle Qualité N°1 (Service Commercial).
 * ---------------------------------------------------------------------------
 * The Effitrans Quality Manual lists seven controls for the Service Commercial.
 * This phase makes the evidence for them readable WITHOUT building a second
 * commercial system: every value is derived from `quotation_request` and
 * `quotation`, which stay the only places those facts live.
 *
 * Four properties this suite defends:
 *
 *   1. NO INVENTED CONFORMITY. No threshold, no PASS/FAIL, no « Conforme ».
 *      The platform has no authoritative commercial deadline — EC-3A rule 4
 *      gave quotations no expiry and no scheduler — so only the observed
 *      duration is reported.
 *   2. UNKNOWN IS NOT FAILURE. A control with no authoritative fact reports
 *      `not_represented` WITH ITS REASON, never `0` and never a red mark.
 *   3. NOTHING IS STORED, NOTHING IS DUPLICATED. Pure derivation; no migration,
 *      no table, no second quotation/document/communication authority.
 *   4. NOTHING ELSE MOVED. No workflow, no QC3 change, no Q5, no MAYA APPLY.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  deriveQC1,
  minutesBetween,
  formatDelay,
  formatInstant,
  firstSentQuotation,
  firstPreparedQuotation,
  QC1_DEFERRED,
} from "@/lib/commercial/qc1";
import type { QuotationRequest, Quotation } from "@/lib/commercial/service";

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/^\s*--.*$/gm, "");

const PURE = "lib/commercial/qc1.ts";
const PANEL = "components/commercial/qc1-panel.tsx";
const PAGE = "app/commercial/quotations/[id]/page.tsx";

const req = (over: Partial<QuotationRequest> = {}): QuotationRequest => ({
  id: "r1",
  clientId: "c1",
  clientName: "Dakar Trading",
  reference: "REQ-1",
  subject: "Import conteneur",
  triageItemId: null,
  status: "OPEN",
  createdAt: "2026-08-12T08:14:00.000Z",
  ...over,
});

const quo = (over: Partial<Quotation> = {}): Quotation => ({
  id: "q1", requestId: "r1", clientId: "c1", quotationNumber: null, version: 1,
  supersedesId: null, status: "DRAFT", currency: "XOF", terms: null, validityNote: null,
  preparedBy: null, validatedBy: null, validatedAt: null, rejectionReasonCode: null,
  sentAt: null, acceptanceKind: null, acceptedOn: null, acceptanceDocumentId: null,
  acceptanceMessageId: null, declinedOn: null, convertedFileId: null, convertedAt: null,
  cancellationReasonCode: null, artifactStoragePath: null, artifactSha256: null,
  createdAt: "2026-08-12T08:30:00.000Z", ...over,
});

const TZ = "Africa/Dakar";

const byKey = (e: ReturnType<typeof deriveQC1>, k: string) =>
  e.controls.find((c) => c.key === k)!;

// ===========================================================================
describe("the seven controls of the manual are all accounted for", () => {
  it("every control the manual lists is present, in its own wording", () => {
    const e = deriveQC1(req(), [], TZ);
    const labels = e.controls.map((c) => c.labelFr);
    for (const l of ["Demande reçue", "Accusé de réception", "Analyse de la demande",
                     "Relance effectuée", "Pièces reçues", "Cotation envoyée",
                     "Délai de réponse constaté"]) {
      expect(labels, l).toContain(l);
    }
  });

  it("each control reports exactly one of the three states", () => {
    const e = deriveQC1(req(), [quo({ sentAt: "2026-08-12T09:02:00.000Z" })], TZ);
    for (const c of e.controls) {
      expect(["observed", "absent", "not_represented"], c.key).toContain(c.state);
    }
  });
});

// ===========================================================================
describe("no conformity is invented", () => {
  it("the delay is reported as a duration, never as a verdict", () => {
    const e = deriveQC1(req(), [quo({ sentAt: "2026-08-12T09:02:00.000Z" })], TZ);
    const d = byKey(e, "responseDelay");
    expect(d.state).toBe("observed");
    expect(d.value).toBe("48 min");
  });

  it("no threshold, deadline or pass/fail vocabulary exists anywhere in the slice", () => {
    for (const f of [PURE, PANEL]) {
      const s = code(f);
      // Semantic, not substring-blind: these are the SHAPES a verdict takes.
      expect(s, f).not.toMatch(/\bconforme\b/i);
      expect(s, f).not.toMatch(/threshold|slaMinutes|maxDelay|deadlineMinutes|isLate|onTime/i);
      expect(s, f).not.toMatch(/\bPASS\b|\bFAIL\b/);
      // No hard-coded duration constant standing in for a policy.
      expect(s, f).not.toMatch(/\b(2|24|48|72)\s*\*\s*60\b/);
    }
  });

  it("the panel never renders a compliance judgement", () => {
    expect(read(PANEL)).toContain("sans jugement de conformité");
    // COMMENTS STRIPPED: the panel's own doc-comment legitimately writes
    // « Conforme » / « Non conforme » to record that it renders neither, so a
    // raw-text check would fail on the very honesty it is verifying.
    const p = code(PANEL);
    expect(p).not.toMatch(/Non conforme|Conforme</);
    expect(p).not.toMatch(/>\s*(Non )?[Cc]onforme\s*</);
  });
});

// ===========================================================================
describe("unknown is not failure", () => {
  it("the three unrepresented controls say so, each with its reason", () => {
    const e = deriveQC1(req(), [], TZ);
    for (const k of ["acknowledgement", "followUp", "documentsReceived"]) {
      const c = byKey(e, k);
      expect(c.state, k).toBe("not_represented");
      expect(c.value, k).toBeNull();
      expect(c.reason, k).toBe(QC1_DEFERRED[k]);
      expect((c.reason ?? "").length, k).toBeGreaterThan(20);
    }
  });

  it("a request with no quotation reads ABSENT, never zero or failed", () => {
    const e = deriveQC1(req(), [], TZ);
    expect(byKey(e, "analysis").state).toBe("absent");
    expect(byKey(e, "quotationSent").state).toBe("absent");
    expect(byKey(e, "responseDelay").state).toBe("absent");
    expect(e.responseMinutes).toBeNull();
    // Nothing anywhere reports a numeric 0 for an unmeasured control.
    expect(e.controls.every((c) => c.value !== "0")).toBe(true);
  });

  it("the panel distinguishes 'not recorded by us' from 'has not happened'", () => {
    const p = read(PANEL);
    expect(p).toContain("Non renseigné");
    expect(p).toContain("Non suivi par la plateforme");
  });
});

// ===========================================================================
describe("the facts are derived from the commercial authority, verbatim", () => {
  it("the request's own timestamp is the reception fact", () => {
    const e = deriveQC1(req({ createdAt: "2026-08-12T08:14:00.000Z" }), [], TZ);
    expect(byKey(e, "requestReceived").state).toBe("observed");
    expect(byKey(e, "requestReceived").value).toContain("08:14");
  });

  it("analysis evidence is that a quotation was prepared — no criteria invented", () => {
    const e = deriveQC1(req(), [quo({ createdAt: "2026-08-12T08:30:00.000Z" })], TZ);
    const a = byKey(e, "analysis");
    expect(a.state).toBe("observed");
    expect(a.value).toContain("Cotation préparée");
    // No checklist, score, or approval rule exists in the module.
    const s = code(PURE);
    expect(s).not.toMatch(/checklist|criteri|score|requiredFields|mandatory/i);
  });

  it("the sent fact carries the minted number when there is one", () => {
    const e = deriveQC1(req(), [quo({ sentAt: "2026-08-12T09:02:00.000Z", quotationNumber: "COT-2026-0001" })], TZ);
    expect(byKey(e, "quotationSent").value).toContain("COT-2026-0001");
  });

  it("the FIRST send is what a response delay measures, not the latest version", () => {
    // A revision supersedes an earlier offer, but the client first heard back
    // at the earlier send — that is the response.
    const v1 = quo({ id: "q1", version: 1, sentAt: "2026-08-12T09:02:00.000Z" });
    const v2 = quo({ id: "q2", version: 2, sentAt: "2026-08-14T11:00:00.000Z" });
    expect(firstSentQuotation([v2, v1])!.id).toBe("q1");
    expect(deriveQC1(req(), [v2, v1], TZ).responseMinutes).toBe(48);
  });

  it("an unsent draft is not a response", () => {
    expect(firstSentQuotation([quo({ sentAt: null })])).toBeNull();
    expect(deriveQC1(req(), [quo({ sentAt: null })], TZ).responseMinutes).toBeNull();
  });

  it("the earliest prepared version is the analysis evidence", () => {
    const a = quo({ id: "qa", createdAt: "2026-08-12T10:00:00.000Z" });
    const b = quo({ id: "qb", createdAt: "2026-08-12T08:30:00.000Z" });
    expect(firstPreparedQuotation([a, b])!.id).toBe("qb");
  });
});

// ===========================================================================
describe("duration arithmetic is honest", () => {
  it("measures real elapsed minutes", () => {
    expect(minutesBetween("2026-08-12T08:14:00.000Z", "2026-08-12T09:02:00.000Z")).toBe(48);
  });

  it("never returns a negative delay", () => {
    // Clock skew must not read as "answered before asked".
    expect(minutesBetween("2026-08-12T09:02:00.000Z", "2026-08-12T08:14:00.000Z")).toBe(0);
  });

  it("returns null rather than NaN on an unusable timestamp", () => {
    expect(minutesBetween("not-a-date", "2026-08-12T09:02:00.000Z")).toBeNull();
  });

  it("instants render in the TENANT's zone, not the server's", () => {
    // Same instant, two zones, two correct renderings. A server-clock formatter
    // would return the same string for both and be wrong for one of them.
    const iso = "2026-08-12T23:30:00.000Z";
    expect(formatInstant(iso, "Africa/Dakar")).toBe("12/08/2026 23:30");
    expect(formatInstant(iso, "Asia/Dubai")).toBe("13/08/2026 03:30");
    // An unusable zone still reports the fact, and SAYS it is UTC.
    expect(formatInstant(iso, "Not/AZone")).toContain("UTC");
    // An unusable instant is returned untouched rather than as "Invalid Date".
    expect(formatInstant("nope", "Africa/Dakar")).toBe("nope");
  });

  it("formats minutes, hours and days without rounding a fact away", () => {
    expect(formatDelay(48)).toBe("48 min");
    expect(formatDelay(60)).toBe("1 h");
    expect(formatDelay(192)).toBe("3 h 12 min");
    expect(formatDelay(1440)).toBe("1 j");
    expect(formatDelay(1680)).toBe("1 j 4 h");
  });
});

// ===========================================================================
describe("no duplicate authority, no new storage", () => {
  it("the module is PURE — no database, no client, no action", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/supabase|\.from\(|\.rpc\(|await |server-only|use server/);
    // It reads the commercial projections rather than redefining them.
    expect(s).toMatch(/import type \{ QuotationRequest, Quotation \} from "\.\/service"/);
  });

  it("it creates no second quotation, document or communication authority", () => {
    const s = code(PURE);
    // Assert the CAPABILITY — that no TABLE is named — rather than banning the
    // word: "document" is a legitimate part of the control key
    // `documentsReceived`, which names a control the manual itself lists.
    const tableNames = ["quotation_request", "quotation_line", "document", "communication_message",
                        "ec_inbound_attachment", "ec_triage_item"];
    for (const t of tableNames) {
      // A table is only reachable through a quoted identifier or a query call.
      expect(s, t).not.toContain(`"${t}"`);
      expect(s, t).not.toContain(`'${t}'`);
      expect(s, t).not.toContain(`from("${t}")`);
    }
    // …and the module has no query surface at all.
    expect(s).not.toMatch(/\.from\(|\.rpc\(|\.select\(/);
  });

  it("QC1 costs no extra query: it derives from what the page already loaded", () => {
    const p = code(PAGE);
    expect(p).toMatch(/deriveQC1\(request, versions, timezone\)/);
    // The tenant zone joins the EXISTING parallel batch — no extra round trip.
    expect(p).toMatch(/Promise\.all\(\[[\s\S]*commercialTimezone\(user\.tenantId\)[\s\S]*\]\)/);
    // No new await was introduced for it.
    const before = p.slice(0, p.indexOf("deriveQC1"));
    expect(before).not.toMatch(/await\s+\w*[Qq]c1/);
    expect(p).not.toMatch(/getQC1|loadQC1|fetchQC1/);
  });

  it("no migration was added by this phase", () => {
    const migrations = readdirSync(fileURLToPath(new URL("../supabase/migrations", import.meta.url)))
      .filter((f) => f.endsWith(".sql"));
    const declared = Number(/MIGRATION_COUNT = (\d+)/.exec(read("lib/platform/ops/build-info.ts"))![1]);
    // DURABLE FORM. A literal count asserts "no migration exists anywhere",
    // which breaks the moment a LATER phase legitimately ships one — as
    // MAYA-P0.8-A did. What stays true is that the declared count matches the
    // files on disk, and that THIS phase contributed none of them.
    expect(migrations).toHaveLength(declared);
    expect(migrations.filter((f) => /qc1|quality|commercial_control/i.test(f))).toEqual([]);
  });
});

// ===========================================================================
describe("nothing else moved", () => {
  it("no workflow, status transition or gate was introduced", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/process_instance|emitBusinessEvent|advance|transition|handoff/i);
    // QC1 never writes a request or quotation status.
    expect(s).not.toMatch(/status\s*=|\.status\s*=/);
    for (const f of ["lib/process/applicability.ts", "lib/workflow/projection.ts", "lib/files/status.ts"]) {
      expect(code(f), f).not.toMatch(/qc1|deriveQC1/i);
    }
  });

  it("QC3 recevabilité is untouched", () => {
    const r = code("lib/customs/receivability.ts");
    expect(r).toContain("RECEIVABILITY_OUTCOMES");
    expect(code("lib/customs/actions.ts")).toContain('assertPermission("customs:update")');
    // Its trust contract survives.
    expect(read("supabase/migrations/20260824000001_customs_receivability.sql"))
      .toMatch(/assert_actor_authority\(p_actor, v_tenant, 'customs:update', 'SERVICE'\)/);
  });

  it("no Q5, groupage or parent/child semantics", () => {
    for (const f of [PURE, PANEL]) {
      expect(code(f).toLowerCase(), f).not.toContain("groupage");
      expect(code(f), f).not.toMatch(/parent_file_id|dossiermere|consolidat/i);
    }
  });

  it("no MAYA staging, APPLY or client bulk-creation", () => {
    const s = code(PURE);
    expect(s).not.toMatch(/maya_import|APPLY|promote/);
    // No client master data is fabricated by this phase.
    expect(s).not.toMatch(/ninea|insert into public\.client/i);
  });

  it("reads nothing the commercial gate does not already permit", () => {
    // The panel and module take already-authorised projections as arguments;
    // the page's existing assertCommercialRead is the only gate involved.
    expect(code(PURE)).not.toMatch(/assertPermission|hasPermission|getEffectivePermissions/);
    expect(code(PAGE)).toMatch(/getQuotation|getRequest/);
  });
});
