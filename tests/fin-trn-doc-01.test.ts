/**
 * FIN-TRN-DOC-01 — Finance + Transport document trigger alignment.
 *
 * The audit found no defect in WHEN the platform produces a document; it found
 * that the platform could not SAY so. Every message EFT-IMP-2026-00013 showed
 * was true and unreadable: a Demande refused for « Enlèvement prévu » with no
 * hint that the field is typed on the transport panel, « Type non générable »
 * about an invoice the platform generates reliably at issuance, and a closure
 * gate reporting « solde restant dû » on a dossier nobody had ever billed.
 *
 * These tests pin the corrections AND, just as deliberately, the rules that did
 * NOT change: the mandatory fields, the absence of any customs coupling, and
 * the position of invoicing at the end of the chain.
 *
 * Ratified 2026-09-28 — DEC-FIN-TRN-01..05.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  artifactFeasibility,
  automaticTriggerLabelFr,
  generatableArtifacts,
  isGeneratableArtifact,
  isOnDemandArtifact,
  onDemandArtifacts,
} from "@/lib/documents/artifacts/feasibility";
import {
  ARTIFACT_GENERATION_PERMISSION,
  artifactGenerationPermission,
} from "@/lib/documents/artifacts/authority";
import {
  isTransportOwnedSourceField,
  mandatoryFieldsFor,
  resolveArtifactSource,
  SOURCE_FIELD_LABELS_FR,
  type ArtifactSourceInput,
} from "@/lib/documents/artifacts/source";
import {
  artifactLabelsRequiringField,
  transportArtifactGaps,
  type TransportSourceFields,
} from "@/lib/documents/artifacts/transport-requirements";
import { documentDoctrine, isInternalArtifact, isClientSafeDocument } from "@/lib/documents/doctrine";
import { hasPermission } from "@/lib/rbac/check";
import { GATE_DETAIL_LABELS_FR, gateDetailLabelFr } from "@/lib/process/gate-labels";
import { evaluateBillingGate, evaluateClosureGate, evaluatePickupGate } from "@/lib/process/engine/gates";
import { evaluateClosure } from "@/lib/process/engine/closure";
import type { EvidenceSnapshot } from "@/lib/process/engine/evidence";
import type { ExecutionView } from "@/lib/process/engine/state";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
/** Source with comments stripped — a pin must match CODE, never a comment. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ACTIONS = "lib/documents/artifacts/actions.ts";
const SERVICE = "lib/documents/artifacts/service.ts";
const PANEL = "components/documents/artifact-panel.tsx";
const TRANSPORT_PANEL = "components/transport/transport-panel.tsx";
const GATES = "lib/process/engine/gates.ts";
const CLOSURE = "lib/process/engine/closure.ts";
const EVIDENCE = "lib/process/engine/evidence.ts";
const AUTHORITY = "lib/process/engine/gate-authority.ts";
const ENGINE_SERVICE = "lib/process/engine/service.ts";
const REGISTRY = "lib/process/effitrans-process.ts";

/** A complete, internally-executed transport source. */
const FULL: ArtifactSourceInput = {
  fileNumber: "EFT-IMP-2026-00013", fileType: "IMP", clientName: "Caetano SA",
  transportMode: "SEA", origin: "Dakar", destination: "Dakar",
  cargoType: "Riz", containerRef: "MSKU1234567",
  pickupLocation: "10 Ngor Almadies", deliveryLocation: "Chez katia restaurant Ngor Almadies",
  pickupPlanned: "2026-09-29T08:00:00Z", deliveryPlanned: "2026-09-29T12:00:00Z",
  driverName: "UAT Chauffeur", driverUserId: "d-1", vehiclePlate: "DK-4567-AB",
  providerId: null, trailerOrContainer: null, transportCompany: "Effitrans Logistics",
  requestedBy: "Transport Demo", requestedAt: "2026-09-26",
};

const transport = (over: Partial<TransportSourceFields> = {}): TransportSourceFields => ({
  pickupLocation: FULL.pickupLocation,
  deliveryLocation: FULL.deliveryLocation,
  pickupPlanned: FULL.pickupPlanned,
  deliveryPlanned: FULL.deliveryPlanned,
  driverName: FULL.driverName,
  vehiclePlate: FULL.vehiclePlate,
  transportCompany: FULL.transportCompany,
  trailerOrContainer: FULL.trailerOrContainer,
  providerId: null,
  ...over,
});

const snapshot = (over: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => ({
  fileType: "IMP",
  access: { documents: true, customs: true, transport: true, finance: true },
  documents: [],
  customs: null,
  transport: null,
  invoices: [],
  ...over,
});

const done = (...keys: string[]): ExecutionView[] =>
  keys.map((stepKey) => ({ stepKey, state: "COMPLETED" as const }));

// ===========================================================================
// DEC-FIN-TRN-03 — the planned pickup stays mandatory
// ===========================================================================
describe("1-2 · « Enlèvement prévu » remains mandatory for both transport documents", () => {
  it("1 — DEMANDE_TRANSPORT requires pickupPlanned, and refuses by name without it", () => {
    expect(mandatoryFieldsFor("DEMANDE_TRANSPORT", { providerId: null })).toContain("pickupPlanned");

    const r = resolveArtifactSource("DEMANDE_TRANSPORT", { ...FULL, pickupPlanned: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.missing.map((m) => m.field)).toEqual(["pickupPlanned"]);
      expect(r.missing[0].labelFr).toBe("Enlèvement prévu");
    }
  });

  it("2 — TRANSPORT_ORDER requires pickupPlanned, on BOTH execution branches", () => {
    expect(mandatoryFieldsFor("TRANSPORT_ORDER", { providerId: null })).toContain("pickupPlanned");
    expect(mandatoryFieldsFor("TRANSPORT_ORDER", { providerId: "p-1" })).toContain("pickupPlanned");

    for (const providerId of [null, "p-1"]) {
      const r = resolveArtifactSource("TRANSPORT_ORDER", { ...FULL, providerId, pickupPlanned: null });
      expect(r.ok, `providerId=${providerId}`).toBe(false);
      if (!r.ok) expect(r.missing.map((m) => m.field)).toContain("pickupPlanned");
    }
  });

  it("2b — whitespace is not a planned date", () => {
    const r = resolveArtifactSource("DEMANDE_TRANSPORT", { ...FULL, pickupPlanned: "   " });
    expect(r.ok).toBe(false);
  });
});

// ===========================================================================
// DEC-FIN-TRN-04 — early transport; no customs coupling anywhere
// ===========================================================================
describe("3 · no BAE / customs requirement exists for either transport document", () => {
  it("3 — neither mandatory set names a customs fact, on any branch", () => {
    const customsish = /bae|customs|douane|declaration|release|mainlev/i;
    for (const artifactCode of ["DEMANDE_TRANSPORT", "TRANSPORT_ORDER"]) {
      for (const providerId of [null, "p-1"]) {
        for (const f of mandatoryFieldsFor(artifactCode, { providerId }) ?? []) {
          expect(String(f), `${artifactCode}/${providerId}`).not.toMatch(customsish);
        }
      }
    }
  });

  it("3b — a dossier with NO customs record at all still resolves both documents", () => {
    // The source reader never reads customs_record; this proves the contract
    // agrees. An order is issuable the day the mission is planned.
    expect(resolveArtifactSource("DEMANDE_TRANSPORT", FULL).ok).toBe(true);
    expect(resolveArtifactSource("TRANSPORT_ORDER", FULL).ok).toBe(true);
  });

  it("3c — the generator and its source contract never consult customs", () => {
    for (const f of [ACTIONS, SERVICE, "lib/documents/artifacts/source.ts"]) {
      expect(code(f), f).not.toContain("customs_record");
      expect(code(f), f).not.toContain("bae_reference");
    }
  });
});

describe("20 · step 14 gained no customs prerequisite", () => {
  it("20 — transport_assignment still depends on am_dossier_opening ALONE", () => {
    const src = code(REGISTRY);
    const at = src.indexOf('key: "transport_assignment"');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(at, src.indexOf("stepNumber: 15", at));
    expect(block).toContain('prerequisites: ["am_dossier_opening"]');
    expect(block).not.toContain("customs_field_clearance");
  });

  it("20b — pickup still converges on customs: the BAE gate is untouched", () => {
    // The physical act stays governed. Only the DOCUMENTS were ever free of it.
    const src = code(REGISTRY);
    const at = src.indexOf('key: "pickup"');
    const block = src.slice(at, src.indexOf("stepNumber: 16", at));
    expect(block).toContain('prerequisites: ["customs_field_clearance", "transport_assignment"]');
    expect(src).toContain('key: "customs_released"');
  });
});

// ===========================================================================
// The mandatory sets themselves — unchanged by this feature
// ===========================================================================
describe("4-6 · the source contract is preserved exactly", () => {
  it("4 — a Demande is still producible before any driver or vehicle exists", () => {
    const r = resolveArtifactSource("DEMANDE_TRANSPORT", {
      ...FULL, driverName: null, driverUserId: null, vehiclePlate: null,
    });
    expect(r.ok).toBe(true);
  });

  it("5 — an internally-executed Ordre still requires driver AND vehicle", () => {
    expect(mandatoryFieldsFor("TRANSPORT_ORDER", { providerId: null })).toEqual([
      "fileNumber", "clientName", "pickupLocation", "deliveryLocation",
      "pickupPlanned", "driverName", "vehiclePlate",
    ]);
    const r = resolveArtifactSource("TRANSPORT_ORDER", { ...FULL, driverName: null, vehiclePlate: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing.map((m) => m.field).sort()).toEqual(["driverName", "vehiclePlate"]);
  });

  it("6 — RQ-18: a subcontracted Ordre names the carrier, not a driver", () => {
    expect(mandatoryFieldsFor("TRANSPORT_ORDER", { providerId: "p-1" })).toEqual([
      "fileNumber", "clientName", "pickupLocation", "deliveryLocation",
      "pickupPlanned", "transportCompany",
    ]);
    const external = { ...FULL, providerId: "p-1", driverName: null, vehiclePlate: null };
    expect(resolveArtifactSource("TRANSPORT_ORDER", external).ok).toBe(true);

    const noCarrier = resolveArtifactSource("TRANSPORT_ORDER", { ...external, transportCompany: null });
    expect(noCarrier.ok).toBe(false);
    if (!noCarrier.ok) expect(noCarrier.missing.map((m) => m.field)).toEqual(["transportCompany"]);
  });
});

// ===========================================================================
// S4 — DEC-FIN-TRN-01 / 02, per-artifact authority
// ===========================================================================
describe("7-9 · generation authority is per artifact", () => {
  // Isolated sets. The UAT Account Manager seat also holds COORDINATOR (and so
  // transport:manage), which is exactly what would hide a regression here.
  const REQUEST_ONLY = ["transport:request"];
  const MANAGE_ONLY = ["transport:manage"];

  const may = (permissions: string[], artifactCode: string) => {
    const required = artifactGenerationPermission(artifactCode);
    return required !== null && hasPermission(permissions, required);
  };

  it("7 — transport:request alone CAN generate the Demande", () => {
    expect(artifactGenerationPermission("DEMANDE_TRANSPORT")).toBe("transport:request");
    expect(may(REQUEST_ONLY, "DEMANDE_TRANSPORT")).toBe(true);
  });

  it("8 — transport:request alone CANNOT generate the Ordre", () => {
    expect(may(REQUEST_ONLY, "TRANSPORT_ORDER")).toBe(false);
  });

  it("9 — transport:manage keeps the Ordre, and does not lose the Demande… ", () => {
    expect(artifactGenerationPermission("TRANSPORT_ORDER")).toBe("transport:manage");
    expect(may(MANAGE_ONLY, "TRANSPORT_ORDER")).toBe(true);
    // …but it is NOT the Demande's authority any more: that is the narrowing.
    expect(may(MANAGE_ONLY, "DEMANDE_TRANSPORT")).toBe(false);
  });

  it("9b — nobody at all may generate an unmapped artifact", () => {
    expect(artifactGenerationPermission("OFFICIAL_INVOICE")).toBeNull();
    expect(may(["transport:manage", "transport:request", "finance:issue"], "OFFICIAL_INVOICE")).toBe(false);
    expect(may([], "MISSION_SHEET")).toBe(false);
  });

  it("9c — the SERVER asserts the mapped permission; the panel only mirrors it", () => {
    const src = code(ACTIONS);
    expect(src).toContain("artifactGenerationPermission(input.artifactCode)");
    expect(src).toContain("await assertPermission(permission)");
    // No residual single gate for both artifacts.
    expect(src).not.toContain('assertPermission("transport:manage")');
    // Visibility is still re-checked server-side.
    expect(src).toContain("isFileVisible");
  });

  it("9d — every on-demand artifact has a ratified authority, and only those", () => {
    for (const a of onDemandArtifacts()) {
      expect(artifactGenerationPermission(a.code), a.code).not.toBeNull();
    }
    for (const artifactCode of Object.keys(ARTIFACT_GENERATION_PERMISSION)) {
      expect(isOnDemandArtifact(artifactCode), artifactCode).toBe(true);
    }
  });

  it("9e — no permission was invented: both codes already exist in the seed", () => {
    const seed = read("supabase/migrations/20260713000001_process_engine.sql");
    expect(seed).toContain("'transport:request'");
    const perms = new Set(Object.values(ARTIFACT_GENERATION_PERMISSION));
    expect([...perms].sort()).toEqual(["transport:manage", "transport:request"]);
  });
});

// ===========================================================================
// S2 — the panel tells the truth about how each artifact comes into being
// ===========================================================================
describe("10-12 · on-demand versus automatic", () => {
  it("10 — OFFICIAL_INVOICE is generatable but NEVER on demand", () => {
    // Both halves matter: the feasibility verdict UAT-2B ratified is untouched.
    expect(isGeneratableArtifact("OFFICIAL_INVOICE")).toBe(true);
    expect(artifactFeasibility("OFFICIAL_INVOICE")?.verdict).toBe("GENERATABLE_NOW");
    expect(isOnDemandArtifact("OFFICIAL_INVOICE")).toBe(false);
    expect(onDemandArtifacts().map((a) => a.code).sort()).toEqual([
      "DEMANDE_TRANSPORT", "TRANSPORT_ORDER",
    ]);
    // …and it still cannot be hand-uploaded, because that catalogue subtracts
    // the FEASIBILITY list, which still contains it.
    expect(generatableArtifacts().map((a) => a.code)).toContain("OFFICIAL_INVOICE");
    expect(code("lib/documents/service.ts")).toMatch(/filter\(\(t\) => !isGeneratableArtifact\(t\.code\)\)/);
  });

  it("10b — the generator refuses it explicitly, by its own reason code", () => {
    const src = code(ACTIONS);
    expect(src).toContain("isOnDemandArtifact(input.artifactCode)");
    expect(src).toContain('error: "artifact_not_on_demand"');
    // Refused BEFORE the source is resolved — never via « Type non générable ».
    expect(src.indexOf("isOnDemandArtifact")).toBeLessThan(src.indexOf("resolveArtifactSource("));
    expect(code(PANEL)).toContain("artifact_not_on_demand");
  });

  it("11 — the invoice PDF is still produced by ISSUANCE, and only there", () => {
    const finance = code("lib/finance/actions.ts");
    const fn = finance.slice(
      finance.indexOf("export async function issueInvoice"),
      finance.indexOf("export async function voidInvoice"),
    );
    expect(fn).toContain("ensureOfficialInvoiceArtifact");
    // …after the official number is allocated.
    expect(fn.indexOf("ensureOfficialInvoiceArtifact")).toBeGreaterThan(fn.indexOf("next_invoice_number"));
    // The on-demand generator never touches that path.
    expect(code(ACTIONS)).not.toContain("ensureOfficialInvoiceArtifact");
  });

  it("11b — the operator is told which act produces it", () => {
    const fr = automaticTriggerLabelFr("OFFICIAL_INVOICE");
    expect(fr).toBe("Générée automatiquement à l'émission de la facture (étape 22).");
    expect(automaticTriggerLabelFr("DEMANDE_TRANSPORT")).toBeNull();
    expect(automaticTriggerLabelFr("MISSION_SHEET")).toBeNull();
    expect(code(PANEL)).toContain("item.automaticTriggerFr");
  });

  it("12 — « Type non générable » is unreachable for any listed artifact", () => {
    // Structural proof, on the two rules that together made it appear:
    //   * every ON-DEMAND artifact HAS a mandatory-field rule, so the
    //     "no MANDATORY entry" branch cannot fire for one;
    //   * completeness is not asked about the others at all.
    for (const a of onDemandArtifacts()) {
      for (const providerId of [null, "p-1"]) {
        expect(mandatoryFieldsFor(a.code, { providerId }), a.code).toBeDefined();
      }
      const r = resolveArtifactSource(a.code, { ...FULL, providerId: null });
      if (!r.ok) expect(r.missing.map((m) => m.labelFr)).not.toContain("Type non générable");
    }
    expect(code(SERVICE)).toContain("onDemand ? resolveArtifactSource(a.code, source) : null");
    // The refusal survives for a code nobody declared — that path is still right.
    const unknown = resolveArtifactSource("NOT_AN_ARTIFACT", FULL);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.missing[0].labelFr).toBe("Type non générable");
  });

  it("12b — an automatic row renders no refusal and no Générer button", () => {
    const src = code(PANEL);
    // Completeness is a tri-state; the amber block is drawn only on a real false.
    expect(src).toContain("item.sourceComplete === false");
    expect(src).toContain("{item.onDemand && item.canGenerate && (");
    expect(code(SERVICE)).toContain("sourceComplete: resolution === null ? null : resolution.ok");
  });

  it("12c — the download of an existing official invoice is preserved", () => {
    // It stays in the panel list, so its versions and their download remain.
    expect(generatableArtifacts().map((a) => a.code)).toContain("OFFICIAL_INVOICE");
    expect(code(SERVICE)).toContain("generatableArtifacts().map");
    expect(code(PANEL)).toContain("createDocumentDownloadUrl");
  });
});

// ===========================================================================
// S1 — the transport panel says where the missing fact is filled
// ===========================================================================
describe("18-19 · the transport planning surface", () => {
  it("18 — « Enlèvement prévu » is declared required for BOTH documents", () => {
    const labels = artifactLabelsRequiringField("pickupPlanned", { providerId: null });
    expect(labels.sort()).toEqual(["Demande de transport", "Ordre de transport"]);
  });

  it("18b — an empty planned pickup is reported against both documents", () => {
    const gaps = transportArtifactGaps(transport({ pickupPlanned: null }));
    expect(gaps.map((g) => g.artifactCode).sort()).toEqual(["DEMANDE_TRANSPORT", "TRANSPORT_ORDER"]);
    for (const g of gaps) {
      expect(g.missing.map((m) => m.labelFr)).toEqual(["Enlèvement prévu"]);
    }
  });

  it("18c — EFT-IMP-2026-00013's exact state: assignment complete, date absent", () => {
    // driver + vehicle bound, locations set, pickup_planned NULL.
    const gaps = transportArtifactGaps(transport({ pickupPlanned: null, deliveryPlanned: null }));
    expect(gaps).toHaveLength(2);
    expect(gaps.every((g) => g.missing.every((m) => m.field === "pickupPlanned"))).toBe(true);
  });

  it("18d — a complete mission reports no gap at all", () => {
    expect(transportArtifactGaps(transport())).toEqual([]);
  });

  it("18e — RQ-18 is honoured by the panel too: a carrier order wants no driver", () => {
    const gaps = transportArtifactGaps(transport({ providerId: "p-1", driverName: null, vehiclePlate: null }));
    expect(gaps).toEqual([]);
    expect(artifactLabelsRequiringField("driverName", { providerId: "p-1" })).toEqual([]);
    expect(artifactLabelsRequiringField("driverName", { providerId: null })).toEqual(["Ordre de transport"]);
  });

  it("18f — the panel renders the requirement from the contract, not from prose", () => {
    const src = code(TRANSPORT_PANEL);
    expect(src).toContain("transportArtifactGaps(artifactSource)");
    expect(src).toContain('requiredFor("pickupPlanned")');
    // No mandatory-field list restated in the component.
    expect(src).not.toContain("MANDATORY");
    expect(src).not.toMatch(/\[\s*"fileNumber"/);
  });

  it("18g — the artifact panel points at the section that can fix it", () => {
    const src = code(PANEL);
    expect(src).toContain("isTransportOwnedSourceField(m.field)");
    expect(src).toContain('href="#transport-record"');
    // …and only for fields that panel actually owns.
    expect(isTransportOwnedSourceField("pickupPlanned")).toBe(true);
    expect(isTransportOwnedSourceField("fileNumber")).toBe(false);
    expect(isTransportOwnedSourceField("clientName")).toBe(false);
  });

  it("19 — NO planned date is ever auto-filled, defaulted or derived", () => {
    const panel = code(TRANSPORT_PANEL);
    // The input's ONLY value is the stored one, and an absent one renders empty.
    expect(panel).toContain("defaultValue={toLocal(record.pickupPlanned)}");
    expect(panel).toContain('return iso ? iso.slice(0, 16) : "";');
    // Nothing anywhere in this panel proposes "now" as a date.
    expect(panel).not.toContain("Date.now");
    expect(panel).not.toMatch(/new Date\(\s*\)/);
    // Nothing in the requirement machinery invents a value either.
    const requirements = code("lib/documents/artifacts/transport-requirements.ts");
    expect(requirements).not.toContain("new Date");
    expect(requirements).not.toContain("Date.now");
    // …and planned is still never promoted from actual.
    expect(panel).not.toMatch(/pickupPlanned[^\n]*pickupActual/);
  });
});

// ===========================================================================
// S3 — gate explanations
// ===========================================================================
describe("13-14 · « aucune facture » is not « solde restant dû »", () => {
  const closureViews = done("pickup");

  it("13 — a dossier with NO invoice reports no_invoice", () => {
    const gate = evaluateClosureGate(closureViews, snapshot({ invoices: [] }));
    const paidReq = gate.requirements.find((r) => r.key === "fully_paid");
    expect(paidReq?.satisfied).toBe(false); // the REQUIREMENT is unchanged
    expect(paidReq?.detail).toBe("no_invoice");
    expect(gateDetailLabelFr("no_invoice")).toBe("Aucune facture émise");
  });

  it("13b — a DRAFT invoice is not an issued one", () => {
    const gate = evaluateClosureGate(closureViews, snapshot({ invoices: [{ status: "DRAFT", balance: 0 }] }));
    expect(gate.requirements.find((r) => r.key === "fully_paid")?.detail).toBe("no_invoice");
  });

  it("14 — an ISSUED invoice with a balance still reports balance_outstanding", () => {
    const gate = evaluateClosureGate(
      closureViews,
      snapshot({ invoices: [{ status: "ISSUED", balance: 250_000 }] }),
    );
    const paidReq = gate.requirements.find((r) => r.key === "fully_paid");
    expect(paidReq?.satisfied).toBe(false);
    expect(paidReq?.detail).toBe("balance_outstanding");
    expect(gateDetailLabelFr("balance_outstanding")).toBe("Facture émise, solde restant dû");
  });

  it("14b — a settled invoice satisfies the requirement and states no reason", () => {
    const gate = evaluateClosureGate(
      closureViews,
      snapshot({ invoices: [{ status: "PAID", balance: 0 }] }),
    );
    const paidReq = gate.requirements.find((r) => r.key === "fully_paid");
    expect(paidReq?.satisfied).toBe(true);
    expect(paidReq?.detail).toBeUndefined();
  });

  it("14c — closure must still eventually be paid: the rule did not soften", () => {
    for (const invoices of [[], [{ status: "ISSUED", balance: 1 }]]) {
      expect(evaluateClosureGate(closureViews, snapshot({ invoices })).ready).toBe(false);
    }
  });
});

describe("15 · every gate reason code has an operator-facing French label", () => {
  /**
   * The source text of ONE expression starting at `from`, bounded properly.
   *
   * A fixed-width window was the obvious thing and it was wrong: it spilled into
   * the next requirement and collected its KEY as though it were a reason code.
   * This walks brackets and strings and stops where the expression does — at a
   * `,` or a closing bracket at depth zero.
   */
  const expressionAt = (src: string, from: number): string => {
    let depth = 0;
    let quote: string | null = null;
    for (let i = from; i < src.length; i += 1) {
      const c = src[i];
      if (quote) {
        if (c === "\\") i += 1;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if ("([{".includes(c)) depth += 1;
      else if (")]}".includes(c)) {
        if (depth === 0) return src.slice(from, i);
        depth -= 1;
      } else if (c === "," && depth === 0) return src.slice(from, i);
    }
    return src.slice(from);
  };

  const bareCodes = (text: string): string[] =>
    [...text.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((s) => /^[a-z][a-z0-9_]*$/.test(s));

  /** Reason codes written as `detail: <expression>` in an engine. */
  const detailLiterals = (src: string): string[] => {
    const found: string[] = [];
    for (const m of src.matchAll(/detail:/g)) {
      found.push(...bareCodes(expressionAt(src, (m.index ?? 0) + "detail:".length)));
    }
    return found;
  };

  /** closure.ts passes its reason as the 4th positional argument of S(...). */
  const closureLiterals = (src: string): string[] => {
    const found: string[] = [];
    for (const m of src.matchAll(/\bS\(/g)) {
      const open = (m.index ?? 0) + m[0].length;
      const args: string[] = [];
      let at = open;
      // Walk the argument list one bounded expression at a time.
      while (at < src.length && args.length < 6) {
        const arg = expressionAt(src, at);
        args.push(arg);
        at += arg.length;
        if (src[at] !== ",") break;
        at += 1;
      }
      // Drop the requirement KEY (first argument); a French label carries spaces
      // or accents and is excluded by the bare-code shape.
      for (const a of args.slice(1)) found.push(...bareCodes(a));
    }
    return found;
  };

  it("15 — statically: every literal reason in gates/closure/evidence is mapped", () => {
    const codes = new Set([
      ...detailLiterals(code(GATES)),
      ...detailLiterals(code(CLOSURE)),
      ...detailLiterals(code(EVIDENCE)),
      ...closureLiterals(code(CLOSURE)),
    ]);
    expect(codes.size).toBeGreaterThan(15);
    const unmapped = [...codes].filter((c) => !GATE_DETAIL_LABELS_FR[c]);
    expect(unmapped, `unlabelled gate reason codes:\n${unmapped.join("\n")}`).toEqual([]);
  });

  it("15b — behaviourally: every reason the evaluators actually emit is mapped", () => {
    const emitted = new Set<string>();
    const collect = (rs: { detail?: string }[]) => {
      for (const r of rs) if (r.detail) emitted.add(r.detail);
    };

    const empty = snapshot();
    const rich = snapshot({
      customs: { required: true, status: "INSPECTION", baeReference: null, declarationNumber: null, externalRef: null },
      transport: { status: "PLANNED", vehiclePlate: null, driverName: null, driverUserId: null },
      documents: [{ typeCode: "BON_A_DELIVRER", status: "UPLOADED" }, { typeCode: "PRE_GATE_AUTHORIZATION", status: "REJECTED" }],
      invoices: [{ status: "ISSUED", balance: 10 }],
    });

    for (const snap of [empty, rich]) {
      collect(evaluatePickupGate(snap, []).requirements);
      collect(evaluateBillingGate([], snap).requirements);
      collect(evaluateClosureGate([], snap).requirements);
      collect(
        evaluateClosureGate([], snap, {
          invoiceValidated: false, invoiceEmailed: false, depositRequired: true,
          depositProofAccepted: false, handedToCollections: false, unresolvedCorrections: 2,
        }).requirements,
      );
    }
    collect(
      evaluateClosure({
        evaluatedAt: "2026-09-28T00:00:00Z",
        access: { finance: true, documents: true, transport: true },
        transportDelivered: false, podApproved: false, podDocumentId: null,
        coordinatorCompletenessDone: false, amCompletenessDone: false,
        invoiceId: null, invoiceValidated: false, invoiceEmailed: false,
        depositRequired: false, depositProofAccepted: false, depositProofDocumentId: null,
        handedToCollections: false, outstandingBalance: 5, disputeOpen: true,
        collectionsCompleted: false,
        stepStates: [{ stepKey: "pickup", state: "PENDING" }],
        unresolvedCorrections: 1,
      }).requirements,
    );

    expect(emitted.size).toBeGreaterThan(10);
    const unmapped = [...emitted].filter((c) => !gateDetailLabelFr(c));
    expect(unmapped, `emitted but unlabelled:\n${unmapped.join("\n")}`).toEqual([]);
  });

  it("15c — an unknown code renders NOTHING rather than a raw identifier", () => {
    expect(gateDetailLabelFr("some_future_code")).toBeNull();
    expect(gateDetailLabelFr(undefined)).toBeNull();
    expect(gateDetailLabelFr("")).toBeNull();
    // …but a declared-absence motif, which is already French prose, survives.
    expect(gateDetailLabelFr("Absence déclarée : non applicable à ce dossier"))
      .toBe("Absence déclarée : non applicable à ce dossier");
  });

  it("15d — the inspector renders the label, never the code", () => {
    const page = code("app/files/[id]/process/page.tsx");
    expect(page).toContain("gateDetailLabelFr(r.detail)");
    expect(page).not.toMatch(/\(\{r\.detail\}\)/);
  });

  it("15e — no label leaks an amount, a client or a document's contents", () => {
    for (const [key, label] of Object.entries(GATE_DETAIL_LABELS_FR)) {
      expect(label.length, key).toBeGreaterThan(0);
      expect(label, key).not.toMatch(/\d{3,}/); // no figures
      expect(label, key).not.toMatch(/\$\{/); // no interpolation
    }
  });
});

describe("16-17 · closure readiness is evaluated, or honestly reported as unevaluated", () => {
  const satisfiedSnapshot = snapshot({
    documents: [{ typeCode: "DELIVERY_NOTE", status: "VERIFIED" }],
    invoices: [{ status: "PAID", balance: 0 }],
  });

  it("16 — the display path asks for the post-delivery context", () => {
    expect(code(ENGINE_SERVICE)).toContain(
      "authoritativeGates(user.tenantId, fileId, { withClosureContext: true })",
    );
    const authority = code(AUTHORITY);
    // …and takes those facts from the EXISTING closure loader, not a second one.
    expect(authority).toContain("loadClosureInput(tenantId, fileId, [...GATE_FULL_READ])");
    expect(authority).toContain("evaluateClosureGate(views, snap.evidence, closureContext)");
  });

  it("16b — WITH the context, the post-delivery chain is evaluated requirement by requirement", () => {
    const gate = evaluateClosureGate([], satisfiedSnapshot, {
      invoiceValidated: true, invoiceEmailed: true, depositRequired: false,
      depositProofAccepted: false, handedToCollections: false, unresolvedCorrections: 0,
    });
    expect(gate.requirements.map((r) => r.key)).toContain("invoice_validated");
    expect(gate.requirements.map((r) => r.key)).not.toContain("post_delivery_chain");
    expect(gate.unauthorized).toEqual([]);
    // Nothing fabricated: with every requirement met, the gate really opens.
    expect(gate.ready).toBe(true);
  });

  it("17 — WITHOUT it, the chain is reported UNEVALUATED, never as a blocker", () => {
    const gate = evaluateClosureGate([], satisfiedSnapshot);
    const chain = gate.requirements.find((r) => r.key === "post_delivery_chain");
    expect(chain?.unauthorized).toBe(true);
    expect(chain?.detail).toBe("post_delivery_context_unavailable");
    // Not counted as a blocker…
    expect(gate.missing).not.toContain("post_delivery_chain");
    expect(gate.unauthorized).toEqual(["post_delivery_chain"]);
  });

  it("17b — and it NEVER fabricates an open gate", () => {
    // Everything else satisfied, context absent: still shut. Not knowing is not
    // passing — the same rule evaluateClosure applies to its own unauthorized.
    const gate = evaluateClosureGate([], satisfiedSnapshot);
    expect(gate.missing).toEqual([]);
    expect(gate.ready).toBe(false);
  });

  it("17c — the unevaluated row discloses nothing", () => {
    const chain = evaluateClosureGate([], satisfiedSnapshot).requirements
      .find((r) => r.key === "post_delivery_chain");
    expect(JSON.stringify(chain)).not.toMatch(/\d{3,}/);
    expect(gateDetailLabelFr(chain?.detail)).toBe(
      "Chaîne facturation / dépôt / recouvrement non évaluée sur cette vue",
    );
  });

  it("17d — the inspector draws unevaluated differently from failed", () => {
    const page = code("app/files/[id]/process/page.tsx");
    expect(page).toContain("r.unauthorized ? \"🔒\"");
  });

  it("17e — the two hot callers do NOT pay for the context they never read", () => {
    const authority = code(AUTHORITY);
    expect(authority).toContain("opts.withClosureContext");
    expect(authority).toContain("authoritativeBillingReady");
    // Neither convenience wrapper opts in.
    const billing = authority.slice(authority.indexOf("export async function authoritativeBillingReady"));
    expect(billing).not.toContain("withClosureContext");
  });
});

// ===========================================================================
// DEC-FIN-TRN-05 — Finance is unchanged
// ===========================================================================
describe("DEC-FIN-TRN-05 · finance semantics untouched", () => {
  it("no automatic finance_request is created from a customs or GAINDE payment", () => {
    const requests = code("lib/finance/request-actions.ts");
    // Step 9's duty payment lives on the GAINDE path and stays there.
    expect(requests).not.toContain("gainde_tax_payment");
    // The customs boundary, as finance-execution test 38 states it: the module
    // may REFERENCE a customs record (finance_request.customs_record_id is a
    // column) but never writes one and never clears customs.
    expect(requests).not.toContain('from("customs_record")');
    expect(requests).not.toContain("releaseCustoms");
    // The register is still raised explicitly, by a person.
    expect(requests).toContain("export async function createFinanceRequest");
    // …and nothing in the GAINDE payment path creates one either.
    const gainde = code("lib/customs/actions.ts");
    expect(gainde).not.toContain("finance_request");
  });

  it("invoicing did not move earlier: step 20 still needs POD + both completeness checks", () => {
    const billing = code("lib/process/billing/actions.ts");
    expect(billing).toContain('if (!(await billingReady(c, fileId))) return fail("dossier_not_billing_ready")');
    expect(billing).toContain("authoritativeBillingReady(ctx.tenantId, fileId)");
    const gate = evaluateBillingGate([], snapshot());
    expect(gate.ready).toBe(false);
    expect(gate.missing.sort()).toEqual(["am_completeness", "coordinator_completeness", "pod_received"]);
  });

  it("this feature writes nothing to finance, customs or the process", () => {
    for (const f of [ACTIONS, SERVICE, "lib/documents/artifacts/authority.ts",
                     "lib/documents/artifacts/transport-requirements.ts", "lib/process/gate-labels.ts"]) {
      expect(code(f), f).not.toMatch(/\.(insert|update|delete)\(/);
    }
  });
});

// ===========================================================================
// S5 — doctrine
// ===========================================================================
describe("doctrine · DEMANDE_TRANSPORT is declared", () => {
  it("is an INTERNAL artifact, not client-safe, due from dossier opening", () => {
    const d = documentDoctrine("DEMANDE_TRANSPORT");
    expect(d).not.toBeNull();
    expect(d?.category).toBe("INTERNAL_ARTIFACT");
    expect(isInternalArtifact("DEMANDE_TRANSPORT")).toBe(true);
    // An internal instruction to our own Transport function — never portal-exposed.
    expect(isClientSafeDocument("DEMANDE_TRANSPORT")).toBe(false);
    // DEC-FIN-TRN-04: preparable before the transport phase, and long before customs.
    expect(d?.earliestStage).toBe("open");
    expect(d?.earliestStage).not.toBe("customs");
  });

  it("every generatable artifact now has a doctrine row", () => {
    for (const a of generatableArtifacts()) {
      expect(documentDoctrine(a.code), a.code).not.toBeNull();
    }
  });
});
